import { createHash } from 'node:crypto';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

export const FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONTRACT_VERSION =
  'facebook_organic_live_rematerialization_rollout_v1';
export const FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONFIRMATION =
  'EXECUTE_FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION';
export const FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECOVERY_CONFIRMATION =
  'RECOVER_FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION';
export const FACEBOOK_ORGANIC_AGGREGATION_REPAIR_SHA =
  '0d8cac334405d755a108f2adea65e9cc6f4cd646';
export const FACEBOOK_ORGANIC_LIVE_WINDOWS = Object.freeze([1, 3, 7, 30]);
export const FACEBOOK_REPORT_EXECUTION_FLAGS = Object.freeze([
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
]);

const ENABLED_FLAG = /^MKT_[A-Z0-9_]+_ENABLED$/u;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

export function parseFacebookOrganicLiveRolloutArgs(argv = []) {
  const execute = argv.includes('--execute');
  const recover = argv.includes('--recover');
  const unknown = argv.filter((value) => value !== '--execute' && value !== '--recover');
  if (unknown.length > 0 || (execute && recover)) throw rolloutError(
    'Facebook Organic live rollout accepts exactly one of --execute or --recover',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_ARGUMENT_INVALID',
    { arguments: unknown, execute, recover },
  );
  return Object.freeze({ execute, recover, planOnly: !execute && !recover });
}

export function assertFacebookOrganicLiveRolloutConfirmation(env = {}, mode = 'execute') {
  const expected = mode === 'recover'
    ? FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECOVERY_CONFIRMATION
    : FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONFIRMATION;
  const field = mode === 'recover'
    ? 'CONFIRM_FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION_RECOVERY'
    : 'CONFIRM_FACEBOOK_ORGANIC_LIVE_REMATERIALIZATION';
  if (String(env[field] ?? '') !== expected) throw rolloutError(
    `Execution requires ${field}=${expected}`,
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_CONFIRMATION_REQUIRED',
    { mode },
  );
  return true;
}

export function extractActiveWorkerVersion(status) {
  const candidates = [];
  visit(status);
  const unique = [...new Set(candidates)];
  if (unique.length !== 1) throw rolloutError(
    'Expected exactly one active Worker version at 100 percent traffic',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_ACTIVE_VERSION_INVALID',
    { activeVersionCount: unique.length },
  );
  return unique[0];

  function visit(value) {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== 'object') return;
    const percentage = Number(value.percentage ?? value.traffic ?? value.percent ?? Number.NaN);
    const versionId = String(value.version_id ?? value.versionId ?? '').trim();
    if (percentage === 100 && UUID.test(versionId)) candidates.push(versionId);
    Object.values(value).forEach(visit);
  }
}

export function collectWorkerBindings(value) {
  const candidates = [];
  visit(value);
  const bindingSet = candidates.find((items) => items.some((item) => readBindingName(item)));
  if (!bindingSet) throw rolloutError(
    'Active Worker version does not expose a readable binding set',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_BINDINGS_MISSING',
  );
  return Object.freeze(bindingSet.map((item) => Object.freeze({ ...item })));

  function visit(nested) {
    if (Array.isArray(nested)) {
      nested.forEach(visit);
      return;
    }
    if (!nested || typeof nested !== 'object') return;
    if (Array.isArray(nested.bindings)) candidates.push(nested.bindings);
    Object.values(nested).forEach(visit);
  }
}

export function extractRemoteExecutionFlagMap(bindings = []) {
  if (!Array.isArray(bindings)) throw rolloutError(
    'Worker bindings must be an array',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_BINDINGS_INVALID',
  );
  const map = {};
  for (const binding of bindings) {
    const name = readBindingName(binding);
    if (!name || !ENABLED_FLAG.test(name)) continue;
    const value = readRemoteExecutionFlag(binding, name);
    if (Object.hasOwn(map, name) && map[name] !== value) throw rolloutError(
      `Execution flag ${name} is duplicated with conflicting values`,
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_FLAG_DUPLICATE',
      { flagName: name },
    );
    map[name] = value;
  }
  if (Object.keys(map).length === 0) throw rolloutError(
    'Active Worker contains no MKT_*_ENABLED execution flags',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_FLAG_VECTOR_EMPTY',
  );
  return Object.freeze(sortObject(map));
}

export function buildExactRuntimePreservingConfigs(sourceText, remoteFlagMap = {}) {
  const source = parseJsoncObject(sourceText);
  if (!source.vars || typeof source.vars !== 'object' || Array.isArray(source.vars)) throw rolloutError(
    'Wrangler source vars are required',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_LOCAL_FLAGS_INVALID',
  );
  const localFlagNames = Object.keys(source.vars).filter((name) => ENABLED_FLAG.test(name)).sort();
  const remoteFlagNames = Object.keys(remoteFlagMap).sort();
  if (localFlagNames.length === 0 || remoteFlagNames.length === 0) throw rolloutError(
    'Local and remote execution-flag vectors must both be non-empty',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_FLAG_VECTOR_EMPTY',
  );
  const missingLocal = remoteFlagNames.filter((name) => !localFlagNames.includes(name));
  if (missingLocal.length > 0) throw rolloutError(
    'Active Worker contains execution flags missing from current main config',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_REMOTE_FLAG_MISSING_LOCAL',
    { missingLocal },
  );
  const localOnly = localFlagNames.filter((name) => !remoteFlagNames.includes(name));
  const unsafeLocalOnly = localOnly.filter((name) => readBoolean(source.vars[name]) !== false);
  if (unsafeLocalOnly.length > 0) throw rolloutError(
    'New local-only execution flags must default to false before rollout',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_LOCAL_ONLY_FLAG_UNSAFE',
    { unsafeLocalOnly },
  );
  for (const flagName of FACEBOOK_REPORT_EXECUTION_FLAGS) {
    if (!localFlagNames.includes(flagName)) throw rolloutError(
      `Current main config lacks required Report execution flag ${flagName}`,
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_REPORT_FLAG_MISSING',
      { flagName },
    );
  }

  const baseline = structuredClone(source);
  baseline.workers_dev = false;
  baseline.vars = { ...baseline.vars };
  for (const name of remoteFlagNames) {
    baseline.vars[name] = encodeBooleanLikeLocal(source.vars[name], remoteFlagMap[name], name);
  }
  for (const name of localOnly) {
    baseline.vars[name] = encodeBooleanLikeLocal(source.vars[name], false, name);
  }
  const baselineFlagMap = readLocalExecutionFlagMap(baseline.vars);

  const overlay = structuredClone(baseline);
  overlay.vars = { ...overlay.vars };
  for (const name of FACEBOOK_REPORT_EXECUTION_FLAGS) {
    overlay.vars[name] = encodeBooleanLikeLocal(baseline.vars[name], true, name);
  }
  const overlayFlagMap = readLocalExecutionFlagMap(overlay.vars);
  assertReportOnlyOverlay(baselineFlagMap, overlayFlagMap);

  const baselineText = `${JSON.stringify(baseline, null, 2)}\n`;
  const overlayText = `${JSON.stringify(overlay, null, 2)}\n`;
  return Object.freeze({
    baselineText,
    overlayText,
    baselineSha256: sha256(baselineText),
    overlaySha256: sha256(overlayText),
    baselineFlagMap,
    overlayFlagMap,
    baselineTrueFlags: Object.freeze(trueFlagNames(baselineFlagMap)),
    overlayTrueFlags: Object.freeze(trueFlagNames(overlayFlagMap)),
    localOnlyFlags: Object.freeze(localOnly),
    remoteFlagCount: remoteFlagNames.length,
    localFlagCount: localFlagNames.length,
    overlayRequired: FACEBOOK_REPORT_EXECUTION_FLAGS.some((name) => baselineFlagMap[name] !== true),
    flagVectorFingerprint: fingerprintFlagMap(baselineFlagMap),
  });
}

export function assertReportOnlyOverlay(baselineFlagMap, overlayFlagMap) {
  const diff = diffExecutionFlagMaps(baselineFlagMap, overlayFlagMap);
  const allowed = new Set(FACEBOOK_REPORT_EXECUTION_FLAGS);
  const disallowed = diff.filter((row) => !allowed.has(row.name));
  const invalidReportValues = diff.filter((row) => allowed.has(row.name) && row.after !== true);
  if (disallowed.length > 0 || invalidReportValues.length > 0) throw rolloutError(
    'Temporary Report overlay changes an unapproved execution flag',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_OVERLAY_INVALID',
    { changedFlags: diff.map((row) => row.name) },
  );
  for (const name of FACEBOOK_REPORT_EXECUTION_FLAGS) {
    if (overlayFlagMap[name] !== true) throw rolloutError(
      `Temporary Report overlay must enable ${name}`,
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_OVERLAY_INVALID',
      { flagName: name },
    );
  }
  return true;
}

export function diffExecutionFlagMaps(before = {}, after = {}) {
  const names = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return Object.freeze(names
    .filter((name) => before[name] !== after[name])
    .map((name) => Object.freeze({ name, before: before[name] ?? null, after: after[name] ?? null })));
}

export function assertExactRuntimeFlagRestoration(expected = {}, observed = {}) {
  const diff = diffExecutionFlagMaps(expected, observed);
  if (diff.length !== 0) throw rolloutError(
    'Final Worker execution flags differ from the captured pre-rollout baseline',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RUNTIME_RESTORE_DRIFT',
    { changedFlags: diff.map((row) => row.name) },
  );
  return true;
}

export function buildFacebookRefreshPlan(candidates = [], existingReportIds = []) {
  if (!Array.isArray(candidates) || !Array.isArray(existingReportIds)) throw rolloutError(
    'Facebook refresh plan requires candidate and existing-id arrays',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_PLAN_INVALID',
  );
  const byWindow = new Map();
  for (const candidate of candidates) {
    const windowDays = Number(candidate?.windowDays);
    if (!FACEBOOK_ORGANIC_LIVE_WINDOWS.includes(windowDays)) continue;
    if (byWindow.has(windowDays)) throw rolloutError(
      `Duplicate Facebook Report candidate for ${windowDays}D`,
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_PLAN_INVALID',
      { windowDays },
    );
    byWindow.set(windowDays, candidate);
  }
  const existing = new Set(existingReportIds.map(String));
  const plan = FACEBOOK_ORGANIC_LIVE_WINDOWS.map((windowDays) => {
    const candidate = byWindow.get(windowDays);
    if (!candidate) throw rolloutError(
      `Facebook Report candidate is missing for ${windowDays}D`,
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_PLAN_INVALID',
      { windowDays },
    );
    if (!existing.has(String(candidate.reportId))) throw rolloutError(
      `Facebook ${windowDays}D stable Report identity does not exist; rollout is refresh-only`,
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_STABLE_REPORT_MISSING',
      { windowDays },
    );
    return Object.freeze({ ...candidate, operation: 'refresh' });
  });
  return Object.freeze(plan);
}

export function assertNoRecordedMutationForExecute(evidenceState = {}) {
  const recorded = [
    evidenceState.deployBaseline,
    evidenceState.deployOverlay,
    ...(Array.isArray(evidenceState.sendWindows) ? evidenceState.sendWindows : []),
    evidenceState.restoreBaseline,
  ].filter(Boolean);
  if (recorded.length > 0) throw rolloutError(
    'Recorded live rollout mutation evidence exists; blind execute repetition is forbidden',
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECORDED_ATTEMPT',
    { recordedAttemptCount: recorded.length },
  );
  return true;
}

export function assertRecoveryIsReadOnlyForReports(input = {}) {
  if (Number(input.queueSendCount ?? 0) !== 0 || Number(input.providerRequestCount ?? 0) !== 0) {
    throw rolloutError(
      'Recovery mode cannot send Report Queue jobs or call Providers',
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECOVERY_MUTATION_INVALID',
    );
  }
  return true;
}

export function fingerprintFlagMap(map = {}) {
  return sha256(JSON.stringify(sortObject(map)));
}

function readRemoteExecutionFlag(binding, name) {
  const bindingType = normalizeBindingType(binding?.type);
  if (bindingType === 'plain_text') {
    const value = readBoolean(binding?.text ?? binding?.value);
    if (value === null) throw rolloutError(
      `Execution flag ${name} does not contain a boolean value`,
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_FLAG_VALUE_INVALID',
      { flagName: name, bindingType },
    );
    return value;
  }
  if (bindingType === 'json') {
    const value = binding?.json ?? binding?.value;
    if (value !== true && value !== false) throw rolloutError(
      `Execution flag ${name} JSON binding is not a boolean`,
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_FLAG_VALUE_INVALID',
      { flagName: name, bindingType, valueType: typeof value },
    );
    return value;
  }
  throw rolloutError(
    `Execution flag ${name} is not a supported boolean Worker binding`,
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_FLAG_BINDING_TYPE_INVALID',
    { flagName: name, bindingType: bindingType || null },
  );
}

function readLocalExecutionFlagMap(vars) {
  const output = {};
  for (const name of Object.keys(vars).filter((key) => ENABLED_FLAG.test(key)).sort()) {
    const value = readBoolean(vars[name]);
    if (value === null) throw rolloutError(
      `Local execution flag ${name} is not boolean`,
      'FACEBOOK_ORGANIC_LIVE_ROLLOUT_LOCAL_FLAG_VALUE_INVALID',
      { flagName: name },
    );
    output[name] = value;
  }
  return Object.freeze(output);
}

function encodeBooleanLikeLocal(sourceValue, value, flagName) {
  if (sourceValue === true || sourceValue === false) return value;
  if (typeof sourceValue === 'string' && readBoolean(sourceValue) !== null) {
    return value ? 'true' : 'false';
  }
  throw rolloutError(
    `Local execution flag ${flagName} is not boolean`,
    'FACEBOOK_ORGANIC_LIVE_ROLLOUT_LOCAL_FLAG_VALUE_INVALID',
    { flagName, valueType: typeof sourceValue },
  );
}

function trueFlagNames(map) {
  return Object.keys(map).filter((name) => map[name] === true).sort();
}
function sortObject(value) {
  return Object.fromEntries(Object.entries(value).sort(([left], [right]) => left.localeCompare(right)));
}
function readBindingName(binding) {
  return String(binding?.name ?? binding?.binding ?? '').trim() || null;
}
function normalizeBindingType(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('-', '_');
}
function readBoolean(value) {
  if (value === true || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || String(value).trim().toLowerCase() === 'false') return false;
  return null;
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function rolloutError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'FacebookOrganicLiveRematerializationRolloutError';
  error.code = code;
  error.details = details;
  return error;
}
