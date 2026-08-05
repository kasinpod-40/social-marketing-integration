import {
  dashboardMetricAvailabilityMessage,
  normalizeDashboardMetricAvailability,
} from '../../../config/src/dashboard-metric-readiness.js';
import {
  REPORT_LIVE_CLOSURE_WINDOWS,
  assertReportLiveClosureDescriptor,
} from './channel-descriptors.js';

export const REPORT_LIVE_CLOSURE_STAGES = Object.freeze([
  'repository_gate',
  'runtime_safe_state_gate',
  'source_readiness',
  'coverage_validation',
  'report_identity_planning',
  'materialization_plan',
  'd1_persistence',
  'lark_write',
  'd1_lark_parity',
  'same_input_replay',
  'zero_drift_verification',
  'safe_restore',
  'sanitized_evidence',
]);

export const REPORT_LIVE_CLOSURE_ADAPTER_AUTHORITIES = Object.freeze({
  repositoryGate: 'reviewed_repository_gate',
  runtimeGate: 'report_runtime_safe_state',
  sourceReadiness: 'report_platform_adapter_registry',
  coverageValidation: 'data_coverage_runs',
  identityPlanning: 'buildReportRuntimeCloseoutCandidates',
  materializationPlan: 'report_materializations',
  d1Persistence: 'report_materialization_repository',
  larkWrite: 'writeDashboardMaterializationToLark',
  parity: 'report_d1_lark_parity',
  sameInputReplay: 'assertReportRuntimeCloseoutReplay',
  zeroDrift: 'report_zero_drift',
  safeRestore: 'report_runtime_closeout_safe_restore',
  sanitizedEvidence: 'safeReportRuntimeCloseoutEvidence',
});

export const REPORT_MISSING_VALUE_CONTRACT = Object.freeze({
  unavailable: Object.freeze({ value: null, display: 'N/A', dataStatus: 'source_unavailable' }),
  missing: Object.freeze({ value: null, display: 'N/A', dataStatus: 'not_observed' }),
  incomplete: Object.freeze({ value: null, display: 'N/A', dataStatus: 'partial', partial: true }),
  covered_empty: Object.freeze({ value: null, dataStatus: 'no_data_confirmed' }),
  observed_zero: Object.freeze({ value: 0, dataStatus: 'complete' }),
});

const STAGE_TO_ADAPTER = Object.freeze({
  repository_gate: 'repositoryGate',
  runtime_safe_state_gate: 'runtimeGate',
  source_readiness: 'sourceReadiness',
  coverage_validation: 'coverageValidation',
  report_identity_planning: 'identityPlanning',
  materialization_plan: 'materializationPlan',
  d1_persistence: 'd1Persistence',
  lark_write: 'larkWrite',
  d1_lark_parity: 'parity',
  same_input_replay: 'sameInputReplay',
  zero_drift_verification: 'zeroDrift',
  safe_restore: 'safeRestore',
  sanitized_evidence: 'sanitizedEvidence',
});
const PLAN_STAGES = REPORT_LIVE_CLOSURE_STAGES.slice(0, 6);
const ACTIVE_STAGES = REPORT_LIVE_CLOSURE_STAGES.slice(6, 11);
const COVERAGE_STATUSES = new Set(['complete', 'partial', 'revisable', 'no_data_confirmed']);
const MATERIALIZATION_ACTIONS = new Set([
  'create_materialization',
  'refresh_or_repair_materialization',
  'reuse_or_idempotent_verify',
]);
const NOTIFICATION_RUNTIME_BASELINE_TRUE_FLAG_COUNTS = Object.freeze({
  inactive: 0,
  active: 3,
});
const BLOCKED_EVIDENCE_KEY = /(?:token|secret|authorization|cookie|password|consumer[_-]?key|consumer[_-]?secret|table.?id|database.?id|queue.?id|version.?id|uuid|raw)/iu;

export function resolveReportMissingValue(kind, partialMetadata = null) {
  const contract = REPORT_MISSING_VALUE_CONTRACT[kind];
  if (!contract) throw frameworkError(
    `Unsupported Report missing-value kind: ${kind}`,
    'REPORT_LIVE_CLOSURE_MISSING_VALUE_INVALID',
    { kind },
  );
  if (kind === 'incomplete' && (!partialMetadata || typeof partialMetadata !== 'object')) {
    throw frameworkError(
      'Incomplete Report values require partial metadata',
      'REPORT_LIVE_CLOSURE_PARTIAL_METADATA_REQUIRED',
    );
  }
  const availabilityStatus = kind === 'unavailable'
    ? 'source_unavailable'
    : kind === 'incomplete'
      ? 'baseline_incomplete'
      : normalizeDashboardMetricAvailability({
        currentValue: contract.value,
        dataStatus: contract.dataStatus,
      });
  return Object.freeze({
    value: contract.value,
    display: contract.display ?? (contract.value === null ? 'N/A' : String(contract.value)),
    data_status: contract.dataStatus,
    availability_status: availabilityStatus,
    availability_message: dashboardMetricAvailabilityMessage(availabilityStatus),
    partial_metadata: kind === 'incomplete' ? Object.freeze({ ...partialMetadata }) : null,
  });
}

export function validateReportLiveClosureCandidates(candidates, { descriptor, target }) {
  assertReportLiveClosureDescriptor(descriptor);
  assertTarget(target);
  if (!Array.isArray(candidates)) throw frameworkError(
    'Report identity planning must return candidates',
    'REPORT_LIVE_CLOSURE_IDENTITY_INVALID',
  );
  const indexed = new Map();
  for (const candidate of candidates) {
    const windowDays = positiveInteger(candidate?.windowDays, 'candidate.windowDays');
    if (!REPORT_LIVE_CLOSURE_WINDOWS.includes(windowDays) || indexed.has(windowDays)) throw frameworkError(
      'Report identity candidates must contain each 1/3/7/30 window exactly once',
      'REPORT_LIVE_CLOSURE_WINDOWS_INVALID',
      { windowDays },
    );
    const expectedSettingKey = `${target.customerProfile}:${descriptor.platform}:rolling:${windowDays}d`;
    if (candidate.reportSettingKey !== expectedSettingKey
      || candidate.period?.periodKind !== 'rolling_days'
      || Number(candidate.period?.windowDays) !== windowDays
      || typeof candidate.reportId !== 'string'
      || candidate.reportId.trim() === ''
      || !candidate.job || typeof candidate.job !== 'object') throw frameworkError(
      'Report identity candidate diverges from the existing closeout authority',
      'REPORT_LIVE_CLOSURE_IDENTITY_INVALID',
      { windowDays, expectedSettingKey },
    );
    indexed.set(windowDays, Object.freeze(candidate));
  }
  if (JSON.stringify([...indexed.keys()].sort((a, b) => a - b))
    !== JSON.stringify(REPORT_LIVE_CLOSURE_WINDOWS)) throw frameworkError(
    'Report identity planning must produce exactly 1/3/7/30',
    'REPORT_LIVE_CLOSURE_WINDOWS_INVALID',
  );
  const reportIds = [...indexed.values()].map((candidate) => candidate.reportId);
  if (new Set(reportIds).size !== reportIds.length) throw frameworkError(
    'Report identity planning produced duplicate existing report IDs',
    'REPORT_LIVE_CLOSURE_IDENTITY_INVALID',
  );
  return Object.freeze(REPORT_LIVE_CLOSURE_WINDOWS.map((windowDays) => indexed.get(windowDays)));
}

export async function runReportLiveClosureFramework({
  descriptor,
  target,
  adapters,
  reviewedHandoff = null,
  execute = false,
}) {
  assertReportLiveClosureDescriptor(descriptor);
  assertTarget(target);
  assertAdapters(adapters, { execute });
  const evidence = [];
  const context = Object.freeze({ descriptor, target: Object.freeze({ ...target }), execute });

  const repository = await runGate('repository_gate', adapters.repositoryGate, context, evidence);
  const runtime = await runGate('runtime_safe_state_gate', adapters.runtimeGate, {
    ...context, repository,
  }, evidence);
  const source = await runGate('source_readiness', adapters.sourceReadiness, {
    ...context, repository, runtime,
  }, evidence);
  const coverage = await runGate('coverage_validation', adapters.coverageValidation, {
    ...context, repository, runtime, source,
  }, evidence);
  const identityResult = await runGate('report_identity_planning', adapters.identityPlanning, {
    ...context, repository, runtime, source, coverage,
  }, evidence);
  const identities = validateReportLiveClosureCandidates(identityResult.candidates, { descriptor, target });
  const plan = await runGate('materialization_plan', adapters.materializationPlan, {
    ...context, repository, runtime, source, coverage, identities,
  }, evidence);

  const handoffReady = reviewedHandoff === null
    ? false
    : assertReviewedReportLiveClosureHandoff(reviewedHandoff, { descriptor, repository });
  if (!execute) return freezeSummary({
    descriptor,
    target,
    identities,
    plan,
    evidence,
    status: handoffReady ? 'READY_FOR_LIVE' : 'READINESS_PENDING',
    execute: false,
  });
  if (!handoffReady) throw frameworkError(
    'Live closure requires retained reviewed Audit handoff evidence',
    'REPORT_LIVE_CLOSURE_REVIEWED_HANDOFF_REQUIRED',
  );

  let persisted = null;
  let lark = null;
  let parity = null;
  let replay = null;
  let zeroDrift = null;
  let restore = null;
  let primaryError = null;
  let restoreError = null;
  let evidenceError = null;
  let activeWindowAttempted = false;
  try {
    activeWindowAttempted = true;
    persisted = await runGate('d1_persistence', adapters.d1Persistence, {
      ...context, identities, plan, reviewedHandoff,
    }, evidence);
    lark = await runGate('lark_write', adapters.larkWrite, {
      ...context, identities, plan, persisted, reviewedHandoff,
    }, evidence);
    parity = await runGate('d1_lark_parity', adapters.parity, {
      ...context, identities, persisted, lark, reviewedHandoff,
    }, evidence);
    replay = await runGate('same_input_replay', adapters.sameInputReplay, {
      ...context, identities, plan, persisted, lark, parity, reviewedHandoff,
    }, evidence);
    zeroDrift = await runGate('zero_drift_verification', adapters.zeroDrift, {
      ...context, identities, replay, reviewedHandoff,
    }, evidence);
  } catch (error) {
    primaryError = error;
  } finally {
    if (activeWindowAttempted) {
      try {
        restore = await runGate('safe_restore', adapters.safeRestore, {
          ...context, primaryError, zeroDrift, reviewedHandoff,
        }, evidence);
      } catch (error) {
        restoreError = error;
      }
    }
    try {
      await runGate('sanitized_evidence', adapters.sanitizedEvidence, {
        ...context,
        evidence: Object.freeze([...evidence]),
        restore,
        primaryError: sanitizeReportLiveClosureEvidence(primaryError),
        restoreError: sanitizeReportLiveClosureEvidence(restoreError),
        reviewedHandoff,
      }, evidence);
    } catch (error) {
      evidenceError = error;
    }
  }

  if (primaryError && restoreError) throw frameworkError(
    'Report closure failed and verified baseline restore also failed',
    'REPORT_LIVE_CLOSURE_RESTORE_FAILED_AFTER_PRIMARY_ERROR',
    {
      primaryCode: primaryError?.code ?? 'UNKNOWN',
      restoreCode: restoreError?.code ?? 'UNKNOWN',
      evidenceCode: evidenceError?.code ?? null,
    },
  );
  if (restoreError) throw restoreError;
  if (primaryError) throw primaryError;
  if (evidenceError) throw evidenceError;
  if (!isVerifiedExecutionBaseline(restore)) throw frameworkError(
    'Report closure requires a verified preserved execution baseline restore',
    'REPORT_LIVE_CLOSURE_RESTORE_NOT_VERIFIED',
  );

  return freezeSummary({
    descriptor,
    target,
    identities,
    plan,
    evidence,
    status: 'CLOSED',
    execute: true,
  });
}

export function assertReviewedReportLiveClosureHandoff(value, { descriptor, repository }) {
  const handoff = requireObject(value, 'reviewedHandoff');
  const sanitized = sanitizeReportLiveClosureEvidence(handoff);
  if (stableJson(sanitized) !== stableJson(handoff)) throw frameworkError(
    'Reviewed handoff contains credential or infrastructure identity fields',
    'REPORT_LIVE_CLOSURE_HANDOFF_NOT_SANITIZED',
  );
  const readiness = handoff.youtubeReadiness;
  const exactWindows = readiness?.assessment?.windows?.map((entry) => Number(entry.windowDays)).sort((a, b) => a - b);
  if (handoff.contractVersion !== 'multichannel_report_live_closure_handoff_v1'
    || handoff.liveMaterializationAuthorized !== true
    || handoff.metaRemoteLock?.released !== true
    || !isCommitSha(handoff.metaRemoteLock?.auditHead)
    || handoff.repository?.branch !== 'main'
    || handoff.repository?.clean !== true
    || handoff.repository?.head !== repository.head
    || handoff.repository?.reviewedHead !== repository.head
    || readiness?.contractVersion !== 'youtube_report_remote_readiness_reviewed_terminal_v1'
    || readiness?.ok !== true
    || readiness?.assessment?.readyForLive !== true
    || readiness?.assessment?.repositoryReady !== true
    || stableJson(exactWindows) !== stableJson(REPORT_LIVE_CLOSURE_WINDOWS)
    || handoff.closeoutAuthority?.operator !== 'scripts/report-runtime-closeout-operator.mjs'
    || handoff.closeoutAuthority?.contractVersion !== 'report_runtime_closeout_uat_v1'
    || handoff.closeoutAuthority?.platformScope !== descriptor.platform
    || handoff.closeoutAuthority?.capability !== descriptor.capability) throw frameworkError(
    'Reviewed handoff does not prove exact-head lock release and YouTube readiness',
    'REPORT_LIVE_CLOSURE_REVIEWED_HANDOFF_INVALID',
  );
  return true;
}

export function sanitizeReportLiveClosureEvidence(value) {
  if (Array.isArray(value)) return value.map(sanitizeReportLiveClosureEvidence);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !BLOCKED_EVIDENCE_KEY.test(key))
    .map(([key, nested]) => [key, sanitizeReportLiveClosureEvidence(nested)]));
}

async function runGate(stage, adapter, context, evidence) {
  try {
    const result = await adapter.run(context);
    validateGateResult(stage, result);
    evidence.push(freezeStage(stage, true, sanitizeReportLiveClosureEvidence(result)));
    return result;
  } catch (error) {
    evidence.push(freezeStage(stage, false, sanitizeReportLiveClosureEvidence({
      code: error?.code ?? 'REPORT_LIVE_CLOSURE_GATE_FAILED',
      message: error?.message ?? `${stage} failed`,
      details: error?.details ?? {},
    })));
    throw error;
  }
}

function validateGateResult(stage, result) {
  if (!result || typeof result !== 'object' || result.ok !== true) throw frameworkError(
    `${stage} did not pass`,
    'REPORT_LIVE_CLOSURE_GATE_BLOCKED',
    { stage },
  );
  if (stage === 'repository_gate' && (
    result.branch !== 'main'
    || result.clean !== true
    || !isCommitSha(result.head)
    || result.head !== result.reviewedHead
  )) throw gateEvidenceError(stage);
  if (stage === 'runtime_safe_state_gate' && (
    !isVerifiedExecutionBaseline(result)
    || Number(result.activeReportWorkCount ?? -1) !== 0
    || Number(result.activeReportLockCount ?? -1) !== 0
    || Number(result.openReportDlqCount ?? -1) !== 0
    || Number(result.openReportCriticalAlertCount ?? -1) !== 0
  )) throw gateEvidenceError(stage);
  if (stage === 'source_readiness' && result.ready !== true) throw gateEvidenceError(stage);
  if (stage === 'coverage_validation' && (
    !COVERAGE_STATUSES.has(result.status)
    || Number(result.failureCount ?? -1) !== 0
  )) throw gateEvidenceError(stage);
  if (stage === 'report_identity_planning' && !Array.isArray(result.candidates)) throw gateEvidenceError(stage);
  if (stage === 'materialization_plan') validateMaterializationPlan(result.windows);
  if (stage === 'd1_persistence' && (
    Number(result.materializationCount ?? -1) !== REPORT_LIVE_CLOSURE_WINDOWS.length
    || result.payloadsValid !== true
  )) throw gateEvidenceError(stage);
  if (stage === 'lark_write' && result.usedExistingWriter !== true) throw gateEvidenceError(stage);
  if (stage === 'd1_lark_parity' && (result.parity !== true || Number(result.driftCount ?? -1) !== 0)) {
    throw gateEvidenceError(stage);
  }
  if (stage === 'same_input_replay' && (
    result.sameInput !== true
    || result.sameReportIds !== true
    || result.samePayloadChecksums !== true
  )) throw gateEvidenceError(stage);
  if (stage === 'zero_drift_verification' && Number(result.driftCount ?? -1) !== 0) throw gateEvidenceError(stage);
  if (stage === 'safe_restore' && !isVerifiedExecutionBaseline(result)) throw gateEvidenceError(stage);
  if (stage === 'sanitized_evidence' && result.sanitized !== true) throw gateEvidenceError(stage);
}

function isVerifiedExecutionBaseline(result = {}) {
  const legacyAllFalse = result.allExecutionFlagsFalse === true
    && result.executionBaselineVerified !== true
    && (result.notificationRuntimeState === undefined || result.notificationRuntimeState === null)
    && (result.baselineTrueFlagCount === undefined || result.baselineTrueFlagCount === null)
    && result.notificationAdmissionEnabled !== true;
  if (legacyAllFalse) return true;

  const state = typeof result.notificationRuntimeState === 'string'
    ? result.notificationRuntimeState.trim().toLowerCase()
    : '';
  const expectedTrueFlagCount = NOTIFICATION_RUNTIME_BASELINE_TRUE_FLAG_COUNTS[state];
  const observedTrueFlagCount = Number(result.baselineTrueFlagCount);
  const baselineVerified = result.executionBaselineVerified === true
    || result.restoredBaseline === true;
  return baselineVerified
    && Number.isSafeInteger(expectedTrueFlagCount)
    && Number.isSafeInteger(observedTrueFlagCount)
    && observedTrueFlagCount === expectedTrueFlagCount
    && result.notificationAdmissionEnabled === false
    && !(state === 'active' && result.allExecutionFlagsFalse === true);
}

function validateMaterializationPlan(windows) {
  if (!Array.isArray(windows)) throw gateEvidenceError('materialization_plan');
  const indexed = new Map();
  for (const row of windows) {
    const windowDays = Number(row?.windowDays);
    if (!REPORT_LIVE_CLOSURE_WINDOWS.includes(windowDays)
      || indexed.has(windowDays)
      || !MATERIALIZATION_ACTIONS.has(row?.action)) throw gateEvidenceError('materialization_plan');
    indexed.set(windowDays, row.action);
  }
  if (stableJson([...indexed.keys()].sort((a, b) => a - b)) !== stableJson(REPORT_LIVE_CLOSURE_WINDOWS)) {
    throw gateEvidenceError('materialization_plan');
  }
}

function assertAdapters(adapters, { execute }) {
  const stages = execute ? REPORT_LIVE_CLOSURE_STAGES : PLAN_STAGES;
  for (const stage of stages) {
    const key = STAGE_TO_ADAPTER[stage];
    const adapter = adapters?.[key];
    if (!adapter || typeof adapter !== 'object'
      || adapter.authority !== REPORT_LIVE_CLOSURE_ADAPTER_AUTHORITIES[key]
      || typeof adapter.run !== 'function') throw frameworkError(
      `Reviewed adapter ${key} is required`,
      'REPORT_LIVE_CLOSURE_ADAPTER_MISSING',
      { stage, adapter: key, expectedAuthority: REPORT_LIVE_CLOSURE_ADAPTER_AUTHORITIES[key] },
    );
  }
  if (!execute && ACTIVE_STAGES.some((stage) => adapters?.[STAGE_TO_ADAPTER[stage]]?.run)) {
    // Plan mode may receive active adapters, but it must never invoke them.
  }
}

function assertTarget(target) {
  const value = requireObject(target, 'target');
  for (const field of ['customerKey', 'customerProfile', 'accountId']) requireText(value[field], `target.${field}`);
  if (/READ_FROM|PLACEHOLDER|REPLACE_WITH/iu.test(value.accountId)) throw frameworkError(
    'Report closure requires an exact account identity',
    'REPORT_LIVE_CLOSURE_TARGET_INVALID',
    { field: 'accountId' },
  );
}

function freezeSummary({ descriptor, target, identities, plan, evidence, status, execute }) {
  return Object.freeze({
    contractVersion: 'multichannel_report_live_closure_framework_v1',
    frameworkStatus: 'READY',
    firstAdopter: descriptor.platform === 'youtube' ? 'youtube' : null,
    channel: `${descriptor.platform}:${descriptor.capability}`,
    status,
    target: Object.freeze({ ...target }),
    identities,
    plan,
    evidence: Object.freeze(evidence),
    remoteWriteCount: execute ? null : 0,
    queueActionCount: execute ? null : 0,
    workerDeploymentCount: execute ? null : 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
}

function freezeStage(stage, ok, details) {
  return Object.freeze({ stage, ok, details: Object.freeze({ ...details }) });
}

function gateEvidenceError(stage) {
  return frameworkError(
    `${stage} evidence does not satisfy the reviewed contract`,
    'REPORT_LIVE_CLOSURE_GATE_EVIDENCE_INVALID',
    { stage },
  );
}

function positiveInteger(value, field) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw frameworkError(
    `${field} must be a positive integer`,
    'REPORT_LIVE_CLOSURE_IDENTITY_INVALID',
    { field },
  );
  return number;
}

function requireObject(value, field) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw frameworkError(
    `${field} must be an object`,
    'REPORT_LIVE_CLOSURE_INPUT_INVALID',
    { field },
  );
  return value;
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw frameworkError(
    `${field} is required`,
    'REPORT_LIVE_CLOSURE_INPUT_INVALID',
    { field },
  );
  return value.trim();
}

function isCommitSha(value) {
  return typeof value === 'string' && /^[0-9a-f]{40}$/u.test(value);
}

function stableJson(value) {
  return JSON.stringify(value);
}

function frameworkError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportLiveClosureFrameworkError';
  error.code = code;
  error.details = details;
  return error;
}
