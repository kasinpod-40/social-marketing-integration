const DEFAULT_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 4_000, 8_000]);
const RETRYABLE_LARK_INTEGRITY_CODES = new Set([
  'REPORT_RUNTIME_CLOSEOUT_LARK_INCOMPLETE',
  'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_KEY_DRIFT',
  'REPORT_RUNTIME_WINDOW_REPAIR_METRIC_VALUE_DRIFT',
]);
const SHA_40 = /^[0-9a-f]{40}$/u;

export const REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE = 'exact_first_materialization_v1';
export const REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_MODE =
  'exact_fresh_materialization_config_dlq_v1';
const SUPPORTED_RECOVERY_MODES = new Set([
  REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE,
  REPORT_RUNTIME_FRESH_CONFIG_DLQ_RECOVERY_MODE,
]);

export async function pollReportRuntimeLarkIntegrity(input = {}) {
  const readState = requireFunction(input.readState, 'readState');
  const assertComplete = requireFunction(input.assertComplete, 'assertComplete');
  const assertIntegrity = requireFunction(input.assertIntegrity, 'assertIntegrity');
  const sleep = typeof input.sleepImpl === 'function' ? input.sleepImpl : sleepMs;
  const delaysMs = normalizeDelays(input.delaysMs ?? DEFAULT_DELAYS_MS);
  let lastState = null;
  let lastError = null;

  for (let index = 0; index < delaysMs.length; index += 1) {
    const delayMs = delaysMs[index];
    if (delayMs > 0) await sleep(delayMs);
    lastState = await readState();
    try {
      assertComplete(lastState);
      const integrity = assertIntegrity(lastState);
      return Object.freeze({
        state: lastState,
        integrity,
        attemptCount: index + 1,
        elapsedDelayMs: delaysMs.slice(0, index + 1).reduce((sum, value) => sum + value, 0),
      });
    } catch (error) {
      if (!RETRYABLE_LARK_INTEGRITY_CODES.has(error?.code)) throw error;
      lastError = error;
    }
  }

  throw recoveryError(
    'Bounded Lark Report reads did not converge to the completed D1 materialization',
    'REPORT_RUNTIME_CLOSEOUT_LARK_INTEGRITY_NOT_CONVERGED',
    {
      attemptCount: delaysMs.length,
      elapsedDelayMs: delaysMs.reduce((sum, value) => sum + value, 0),
      lastCode: lastError?.code ?? null,
      mismatchCount: finiteOrNull(lastError?.details?.mismatchCount),
      expectedCount: finiteOrNull(lastError?.details?.expectedCount),
      observedCount: finiteOrNull(lastError?.details?.observedCount),
      snapshots: finiteOrNull(lastState?.snapshots),
      metrics: finiteOrNull(lastState?.metrics),
      topContent: finiteOrNull(lastState?.topContent),
      duplicateMetricKeys: finiteOrNull(lastState?.duplicateMetricKeys),
    },
  );
}

export function resolveReportRuntimeCloseoutRecoveryMode(env = {}) {
  const mode = optionalText(env.MKT_REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE);
  if (mode === null) return null;
  if (!SUPPORTED_RECOVERY_MODES.has(mode)) throw recoveryError(
    'Report closeout recovery mode is unsupported',
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE_INVALID',
    { mode },
  );
  return mode;
}

export function assertReportRuntimeCloseoutRecoveryEvidence(input = {}) {
  const deploy = requireObject(input.deployAttempt, 'deployAttempt');
  const first = requireObject(input.sendFirstAttempt, 'sendFirstAttempt');
  const restore = requireObject(input.restoreAttempt, 'restoreAttempt');
  const candidate = requireObject(input.candidate, 'candidate');
  const activeConfigSha256 = requireSha256(input.activeConfigSha256, 'activeConfigSha256');
  const safeConfigSha256 = requireSha256(input.safeConfigSha256, 'safeConfigSha256');
  const jobSha256 = requireSha256(input.jobSha256, 'jobSha256');
  const operation = requireExact(first.operation, 'refresh', 'sendFirstAttempt.operation');
  const windowDays = requireInteger(deploy.windowDays, 'deployAttempt.windowDays');
  const requestedAt = requireInteger(first.requestedAt, 'sendFirstAttempt.requestedAt');
  const reportId = requireText(first.reportId, 'sendFirstAttempt.reportId');
  const originalRepositoryHead = requireGitHead(deploy.repositoryHead, 'deployAttempt.repositoryHead');

  if (input.summaryExists === true) throw recoveryError(
    'Report closeout recovery is unnecessary because a verified summary already exists',
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_SUMMARY_EXISTS',
  );
  if (windowDays !== 3
    || deploy.operation !== operation
    || deploy.selectedReportId !== reportId
    || candidate.operation !== operation
    || Number(candidate.windowDays) !== windowDays
    || candidate.reportId !== reportId
    || requireSha256(deploy.configSha256, 'deployAttempt.configSha256') !== activeConfigSha256
    || requireSha256(restore.configSha256, 'restoreAttempt.configSha256') !== safeConfigSha256
    || requireSha256(first.jobSha256, 'sendFirstAttempt.jobSha256') !== jobSha256) {
    throw recoveryError(
      'Report closeout recovery evidence differs from the exact failed 3D materialization',
      'REPORT_RUNTIME_CLOSEOUT_RECOVERY_EVIDENCE_MISMATCH',
      { operation, windowDays },
    );
  }

  const replay = input.replayAttempt === null || input.replayAttempt === undefined
    ? null
    : requireObject(input.replayAttempt, 'replayAttempt');
  if (replay && (
    replay.reportId !== reportId
    || replay.operation !== operation
    || Number(replay.requestedAt) !== requestedAt
    || requireSha256(replay.jobSha256, 'replayAttempt.jobSha256') !== jobSha256
  )) {
    throw recoveryError(
      'Recorded Report replay attempt differs from the exact failed 3D materialization',
      'REPORT_RUNTIME_CLOSEOUT_RECOVERY_REPLAY_EVIDENCE_MISMATCH',
    );
  }

  return Object.freeze({
    operation,
    windowDays,
    requestedAt,
    reportId,
    jobSha256,
    originalRepositoryHead,
    replayAttempted: replay !== null,
  });
}

function normalizeDelays(value) {
  if (!Array.isArray(value) || value.length === 0
    || value.some((delay) => !Number.isSafeInteger(delay) || delay < 0)) {
    throw new TypeError('Report Lark integrity delays must be non-negative integers');
  }
  return Object.freeze([...value]);
}

function requireFunction(value, fieldName) {
  if (typeof value !== 'function') throw new TypeError(`Report Lark integrity requires ${fieldName}`);
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw recoveryError(
    `Report closeout recovery requires ${fieldName}`,
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_EVIDENCE_MISSING',
    { fieldName },
  );
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw recoveryError(
    `Report closeout recovery requires ${fieldName}`,
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_VALUE_INVALID',
    { fieldName },
  );
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireExact(value, expected, fieldName) {
  const text = requireText(value, fieldName);
  if (text !== expected) throw recoveryError(
    `Report closeout recovery requires ${fieldName}=${expected}`,
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_VALUE_INVALID',
    { fieldName },
  );
  return text;
}

function requireInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw recoveryError(
    `Report closeout recovery requires a positive integer ${fieldName}`,
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_VALUE_INVALID',
    { fieldName },
  );
  return number;
}

function requireGitHead(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!SHA_40.test(text)) throw recoveryError(
    `Report closeout recovery requires a full Git SHA for ${fieldName}`,
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_VALUE_INVALID',
    { fieldName },
  );
  return text;
}

function requireSha256(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!/^[0-9a-f]{64}$/u.test(text)) throw recoveryError(
    `Report closeout recovery requires a SHA-256 value for ${fieldName}`,
    'REPORT_RUNTIME_CLOSEOUT_RECOVERY_VALUE_INVALID',
    { fieldName },
  );
  return text;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function sleepMs(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeCloseoutRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
