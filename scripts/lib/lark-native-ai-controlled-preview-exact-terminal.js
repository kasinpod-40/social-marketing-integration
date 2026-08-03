import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_TARGET_TABLE,
} from '../../packages/config/src/lark-native-ai-controlled-preview-contract.js';
import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_ENV,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_WINDOWS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_SCHEMA_VERSION,
} from '../../packages/config/src/lark-native-ai-controlled-preview-exact-terminal-contract.js';
import { stableStringify } from '../../packages/application/src/use-cases/build-report-snapshot.js';

const SHA256 = /^[a-f0-9]{64}$/u;
const GIT_SHA = /^[a-f0-9]{40}$/u;
const SOURCE_KIND = 'retained_real_validated_report_evidence';

export function parseLarkNativeAiControlledPreviewExactTerminalArgs(args = []) {
  let execute = false;
  for (const raw of args) {
    const argument = String(raw ?? '').trim();
    if (argument === '--execute') execute = true;
    else if (argument !== '') throw exactTerminalError(
      `Unsupported Controlled Preview Exact Terminal argument: ${argument}`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_ARGUMENT_UNSUPPORTED',
      { argument },
    );
  }
  return Object.freeze({ execute });
}

export function assertLarkNativeAiControlledPreviewExactTerminalConfirmation(env = {}) {
  if (env.CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL
    !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION) {
    throw exactTerminalError(
      `Execution requires CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL=${LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION}`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION_REQUIRED',
    );
  }
  return true;
}

export function assertLarkNativeAiControlledPreviewExactTerminalRepository(value = {}) {
  const branch = text(value.branch);
  const head = gitSha(value.head);
  const originMain = gitSha(value.originMain ?? value.origin_main);
  if (branch !== 'main') throw exactTerminalError(
    'Controlled Preview Exact Terminal must run from main',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_MAIN_REQUIRED',
    { branch },
  );
  if (value.clean !== true) throw exactTerminalError(
    'Controlled Preview Exact Terminal requires a clean repository',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CLEAN_REQUIRED',
  );
  if (!head || !originMain || head !== originMain) throw exactTerminalError(
    'Local main must equal the freshly fetched origin/main Head',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_MAIN_NOT_CURRENT',
    { head, originMain },
  );
  return Object.freeze({ branch: 'main', clean: true, exactHeadSha: head });
}

export function assertLarkNativeAiControlledPreviewExactTerminalNodeVersion(version) {
  const major = Number(String(version ?? '').split('.')[0]);
  if (!Number.isInteger(major) || major < 22) throw exactTerminalError(
    'Controlled Preview Exact Terminal requires Node.js 22 or newer',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_NODE_VERSION_INVALID',
    { observedMajor: Number.isInteger(major) ? major : null },
  );
  return major;
}

export async function validateLarkNativeAiControlledPreviewSourcePackage(value, repository) {
  const source = requireObject(value, 'sourcePackage');
  if (source.schemaVersion !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_SCHEMA_VERSION
    || source.contractVersion !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION) {
    throw exactTerminalError(
      'Retained source package contract is invalid',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_CONTRACT_INVALID',
    );
  }
  const packageSha256 = sha256(source.packageSha256 ?? source.package_sha256, 'sourcePackage.packageSha256');
  const unsigned = structuredClone(source);
  delete unsigned.packageSha256;
  delete unsigned.package_sha256;
  const expectedSha256 = await sha256Hex(stableStringify(unsigned));
  if (packageSha256 !== expectedSha256) throw exactTerminalError(
    'Retained source package checksum does not match its content',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_CHECKSUM_INVALID',
    { checksumMatched: false },
  );

  const exactHeadSha = gitSha(source.repositoryHead ?? source.repository_head);
  if (!exactHeadSha || exactHeadSha !== repository?.exactHeadSha) throw exactTerminalError(
    'Retained source package Head must equal the current exact main Head',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_HEAD_MISMATCH',
    { sourceHead: exactHeadSha, repositoryHead: repository?.exactHeadSha ?? null },
  );

  const provenance = requireObject(source.provenance, 'sourcePackage.provenance');
  if (provenance.sourceKind !== SOURCE_KIND
    || provenance.validationStatus !== 'validated'
    || provenance.frozen !== true
    || provenance.fixtureData !== false
    || !SHA256.test(provenance.sourceEvidenceSha256 ?? '')) {
    throw exactTerminalError(
      'Retained source package must prove validated real Report evidence and reject Fixture data',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_PROVENANCE_INVALID',
    );
  }

  const schemaAuthority = validateSchemaAuthority(source.schemaAuthority ?? source.schema_authority);
  const remoteAuthority = validateRemoteAuthority(source.remoteAuthority ?? source.remote_authority);
  const offlineInputs = requireArray(source.offlineInputs ?? source.offline_inputs, 'sourcePackage.offlineInputs');
  if (offlineInputs.length !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.expectedWindows) {
    throw exactTerminalError(
      'Retained source package must contain exactly four Offline inputs',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_WINDOW_COUNT_INVALID',
      { expected: 4, actual: offlineInputs.length },
    );
  }

  const windows = new Set();
  const customerKeys = new Set();
  const normalizedInputs = offlineInputs.map((input, index) => {
    const item = requireObject(input, `sourcePackage.offlineInputs[${index}]`);
    const windowDays = positiveInteger(item.window?.windowDays ?? item.window?.window_days,
      `sourcePackage.offlineInputs[${index}].window.windowDays`);
    if (!LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_WINDOWS.includes(windowDays)
      || windows.has(windowDays)) {
      throw exactTerminalError(
        'Retained source package windows must be the unique set 1/3/7/30',
        'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_WINDOW_INVALID',
        { windowDays },
      );
    }
    windows.add(windowDays);
    const customerKey = identity(item.customer?.customerKey ?? item.customer?.customer_key,
      `sourcePackage.offlineInputs[${index}].customer.customerKey`);
    customerKeys.add(customerKey);
    const generationId = identity(item.generation?.generationId ?? item.generation?.generation_id,
      `sourcePackage.offlineInputs[${index}].generation.generationId`);
    if (/fixture|dummy|placeholder|sample/iu.test(generationId)) throw exactTerminalError(
      'Retained source package contains a forbidden non-real generation identity',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_NON_REAL_DATA_FORBIDDEN',
      { windowDays },
    );
    if (!Array.isArray(item.channels) || item.channels.length === 0) throw exactTerminalError(
      'Each Offline input must contain the full channel evidence registry',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_CHANNELS_INVALID',
      { windowDays },
    );
    return structuredClone(item);
  });
  if (customerKeys.size !== 1) throw exactTerminalError(
    'All Offline inputs must target the same customer identity',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_CUSTOMER_MISMATCH',
  );
  for (const expected of LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_WINDOWS) {
    if (!windows.has(expected)) throw exactTerminalError(
      'Retained source package is missing an exact supported window',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_WINDOW_MISSING',
      { windowDays: expected },
    );
  }

  normalizedInputs.sort((left, right) => Number(left.window.windowDays ?? left.window.window_days)
    - Number(right.window.windowDays ?? right.window.window_days));
  return deepFreeze({
    schemaVersion: source.schemaVersion,
    contractVersion: source.contractVersion,
    repositoryHead: exactHeadSha,
    packageSha256,
    provenance: structuredClone(provenance),
    schemaAuthority,
    remoteAuthority,
    offlineInputs: normalizedInputs,
  });
}

export async function buildLarkNativeAiControlledPreviewExactTerminalReadiness(input = {}) {
  const sourcePackage = requireObject(input.sourcePackage, 'sourcePackage');
  const repository = requireObject(input.repository, 'repository');
  const buildReadiness = input.buildReadiness;
  if (typeof buildReadiness !== 'function') throw new TypeError('buildReadiness is required');
  const approval = Object.freeze({
    confirmation: LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE,
    approvalId: `exact-terminal:${sourcePackage.packageSha256.slice(0, 32)}`,
    approvedAt: sourcePackage.remoteAuthority.capturedAt,
    approvedHeadSha: repository.exactHeadSha,
  });
  const readinessPlans = [];
  const windowResults = [];
  for (const offlineInput of sourcePackage.offlineInputs) {
    const windowDays = offlineInput.window?.windowDays ?? offlineInput.window?.window_days ?? null;
    const plan = await buildReadiness({
      offlineInput,
      repository,
      schemaAuthority: sourcePackage.schemaAuthority,
      remoteAuthority: sourcePackage.remoteAuthority,
      approval,
    });
    const blockers = Array.isArray(plan?.blockers) ? plan.blockers : [];
    const ready = plan?.status === 'ready_for_controlled_preview' && blockers.length === 0;
    windowResults.push(Object.freeze({
      windowDays,
      status: plan?.status ?? null,
      blockers,
      goldenDatasetAuthority: plan?.goldenDatasetAuthority ?? null,
      ready,
    }));
    if (ready) readinessPlans.push(plan);
  }
  const blockedWindows = windowResults.filter(({ ready }) => !ready);
  if (blockedWindows.length > 0) {
    throw exactTerminalError(
      'One or more retained Offline inputs did not produce ready Controlled Preview authority',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_READINESS_NOT_READY',
      {
        blockedWindowCount: blockedWindows.length,
        blockedWindows,
        windowResults,
      },
    );
  }
  return deepFreeze(readinessPlans);
}

export function buildLarkNativeAiControlledPreviewExactTerminalChildEnv(baseEnv = {}, input = {}) {
  const head = gitSha(input.head);
  if (!head) throw new TypeError('head must be an exact Git SHA');
  const inputPath = requireText(input.inputPath, 'inputPath');
  const evidencePath = requireText(input.evidencePath, 'evidencePath');
  return Object.freeze({
    ...baseEnv,
    CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW:
      LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_ENV.confirmation,
    MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_REVIEWED_HEAD: head,
    MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_INPUT: inputPath,
    MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EVIDENCE: evidencePath,
    LARK_MAX_ATTEMPTS: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_ENV.maxAttempts,
    LARK_MAX_PAGES: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_ENV.maxPages,
    LARK_MAX_FILTER_CONDITIONS:
      LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_ENV.maxFilterConditions,
    LARK_REQUEST_TIMEOUT_MS:
      LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_ENV.requestTimeoutMs,
    LARK_MIN_REQUEST_INTERVAL_MS:
      LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_ENV.minRequestIntervalMs,
  });
}

export function assertLarkNativeAiControlledPreviewExactTerminalFirstPass(result) {
  const value = requireObject(result, 'firstPass');
  const writes = normalizeWrites(value.writes, 'firstPass.writes');
  if (value.ok !== true
    || !['applied_and_verified', 'already_zero_drift'].includes(value.mode)
    || value.verification?.status !== 'zero_drift'
    || writes.total > LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.maximumFirstPassWrites
    || Number(value.remote?.blockedRequestCount ?? 0) !== 0
    || Number(value.remote?.totalRecordWrites ?? -1) !== writes.total
    || Number(value.aiCallCount ?? -1) !== 0
    || Number(value.notificationCount ?? -1) !== 0
    || value.scheduleEnabled !== false
    || value.production !== 'BLOCKED') {
    throw exactTerminalError(
      'Controlled Preview first pass did not satisfy exact verified write boundaries',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_FIRST_PASS_INVALID',
      sanitizeLarkNativeAiControlledPreviewExactTerminalValue(value),
    );
  }
  if (value.mode === 'already_zero_drift' && writes.total !== 0) throw exactTerminalError(
    'An already-zero-drift first pass cannot report writes',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_FIRST_PASS_INVALID',
  );
  if (value.mode === 'applied_and_verified' && writes.total < 1) throw exactTerminalError(
    'An applied first pass must report at least one bounded write',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_FIRST_PASS_INVALID',
  );
  return deepFreeze({ ...value, writes });
}

export function assertLarkNativeAiControlledPreviewExactTerminalReplay(result) {
  const value = requireObject(result, 'replay');
  const writes = normalizeWrites(value.writes, 'replay.writes');
  const counts = value.verification?.counts ?? {};
  if (value.ok !== true
    || value.mode !== 'already_zero_drift'
    || value.verification?.status !== 'zero_drift'
    || writes.total !== 0
    || Number(counts.write ?? -1) !== 0
    || Number(counts.noOp ?? -1) !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.expectedRows
    || Number(counts.delete ?? 0) !== 0
    || Number(value.remote?.blockedRequestCount ?? 0) !== 0
    || Number(value.remote?.totalRecordWrites ?? -1) !== 0
    || Number(value.aiCallCount ?? -1) !== 0
    || Number(value.notificationCount ?? -1) !== 0
    || value.scheduleEnabled !== false
    || value.production !== 'BLOCKED') {
    throw exactTerminalError(
      'Controlled Preview same-input replay must prove forty no-op rows and zero writes',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_REPLAY_INVALID',
      sanitizeLarkNativeAiControlledPreviewExactTerminalValue(value),
    );
  }
  return deepFreeze({ ...value, writes });
}

export function sanitizeLarkNativeAiControlledPreviewExactTerminalValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeLarkNativeAiControlledPreviewExactTerminalValue);
  if (!value || typeof value !== 'object') {
    if (typeof value !== 'string') return value;
    return value
      .replace(/Bearer\s+[^\s]+/giu, 'Bearer [REDACTED]')
      .replace(/https?:\/\/[^\s]+/giu, '[URL_REDACTED]')
      .replace(/\b(?:cli_|bascn|tbl|rec|fld|vew)[A-Za-z0-9_-]{6,}\b/gu, '[ID_REDACTED]')
      .slice(0, 500);
  }
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(token|secret|authorization|cookie|password|table.?id|record.?id|app.?id|raw.?url|prompt|reference.?output|offline.?input)/iu.test(key))
    .map(([key, nested]) => [key, sanitizeLarkNativeAiControlledPreviewExactTerminalValue(nested)]));
}

export function exactTerminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiControlledPreviewExactTerminalError';
  error.code = code;
  error.details = deepFreeze(sanitizeLarkNativeAiControlledPreviewExactTerminalValue(details));
  return error;
}

export async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(String(value)),
  );
  return [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}

function validateSchemaAuthority(value) {
  const authority = requireObject(value, 'sourcePackage.schemaAuthority');
  if ((authority.validationStatus ?? authority.validation_status) !== 'validated'
    || authority.frozen !== true
    || (authority.targetTable ?? authority.target_table) !== LARK_NATIVE_AI_CONTROLLED_PREVIEW_TARGET_TABLE
    || authority.status !== 'zero_drift'
    || Number(authority.requiredViewCount ?? authority.required_view_count) !== 6
    || Number(authority.exactViewFilterCount ?? authority.exact_view_filter_count) !== 6
    || Number(authority.remainingLogicalActionCount ?? authority.remaining_logical_action_count) !== 0
    || !SHA256.test(authority.evidenceSha256 ?? authority.evidence_sha256 ?? '')) {
    throw exactTerminalError(
      'Retained source package schema authority is not exact zero drift',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_SCHEMA_AUTHORITY_INVALID',
    );
  }
  return deepFreeze(structuredClone(authority));
}

function validateRemoteAuthority(value) {
  const authority = requireObject(value, 'sourcePackage.remoteAuthority');
  const capturedAt = nonNegativeInteger(authority.capturedAt ?? authority.captured_at,
    'sourcePackage.remoteAuthority.capturedAt');
  if ((authority.validationStatus ?? authority.validation_status) !== 'validated'
    || authority.frozen !== true
    || (authority.metaRemoteLockReleased ?? authority.meta_remote_lock_released) !== true
    || (authority.workerFlagsAllFalse ?? authority.worker_flags_all_false) !== true
    || (authority.previewUrlsDisabled ?? authority.preview_urls_disabled) !== true
    || (authority.productionBlocked ?? authority.production_blocked) !== true
    || (authority.scheduleEnabled ?? authority.schedule_enabled) !== false
    || !SHA256.test(authority.evidenceSha256 ?? authority.evidence_sha256 ?? '')) {
    throw exactTerminalError(
      'Retained source package Remote authority does not prove a released all-false safe state',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_REMOTE_AUTHORITY_INVALID',
    );
  }
  return deepFreeze({ ...structuredClone(authority), capturedAt });
}

function normalizeWrites(value, label) {
  const writes = requireObject(value, label);
  const created = nonNegativeInteger(writes.created, `${label}.created`);
  const updated = nonNegativeInteger(writes.updated, `${label}.updated`);
  const total = nonNegativeInteger(writes.total, `${label}.total`);
  if (created + updated !== total) throw exactTerminalError(
    `${label} does not reconcile`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_WRITE_COUNT_INVALID',
  );
  return Object.freeze({ created, updated, total });
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw exactTerminalError(
    `${label} must be an object`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_INPUT_INVALID',
    { label },
  );
  return value;
}
function requireArray(value, label) {
  if (!Array.isArray(value)) throw exactTerminalError(
    `${label} must be an array`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_INPUT_INVALID',
    { label },
  );
  return value;
}
function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw exactTerminalError(
    `${label} is required`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_INPUT_INVALID',
    { label },
  );
  return value.trim();
}
function identity(value, label) {
  const item = requireText(value, label);
  if (!/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,199}$/u.test(item)) throw exactTerminalError(
    `${label} is not a valid identity`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_INPUT_INVALID',
    { label },
  );
  return item;
}
function gitSha(value) {
  const item = typeof value === 'string' ? value.trim() : '';
  return GIT_SHA.test(item) ? item : null;
}
function sha256(value, label) {
  const item = typeof value === 'string' ? value.trim() : '';
  if (!SHA256.test(item)) throw exactTerminalError(
    `${label} must be a lowercase SHA-256`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_INPUT_INVALID',
    { label },
  );
  return item;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw exactTerminalError(
    `${label} must be a positive integer`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_INPUT_INVALID',
    { label },
  );
  return number;
}
function nonNegativeInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw exactTerminalError(
    `${label} must be a non-negative integer`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_INPUT_INVALID',
    { label },
  );
  return number;
}
function text(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}
