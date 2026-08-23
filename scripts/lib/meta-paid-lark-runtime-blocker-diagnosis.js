export const META_PAID_LARK_RUNTIME_BLOCKER_DIAGNOSIS_CONTRACT_VERSION =
  'meta_paid_lark_runtime_blocker_diagnosis_v1';

export const META_PAID_LARK_RUNTIME_STABILITY_WINDOW_MS = 30_000;
export const META_PAID_LARK_RUNTIME_STALE_AGE_MS = 16 * 60 * 1000;

export const META_PAID_LARK_RETAINED_FORENSIC_WORK_KEY =
  'meta_ads:chemistry_k2:meta-chemistry_k2-history-20260501-20260731-a22a21bea8ba';

export function buildMetaPaidLarkRuntimeDiagnosisQueries() {
  const retained = sqlText(META_PAID_LARK_RETAINED_FORENSIC_WORK_KEY);
  return Object.freeze({
    work: `SELECT work_key, cursor_key, work_type, status, lifecycle_status, generation, requested_at, created_at, updated_at, expires_at, terminal_reason FROM sync_work_runs WHERE lifecycle_status = 'active' AND work_key <> ${retained} ORDER BY updated_at DESC, work_key ASC;`,
    queue: `SELECT DISTINCT q.operation_id, q.work_key FROM queue_operation_attempts q JOIN sync_work_runs w ON w.work_key = q.work_key WHERE w.lifecycle_status = 'active' AND w.work_key <> ${retained} ORDER BY q.work_key ASC, q.operation_id ASC;`,
    locks: `SELECT lock_key, owner_id, acquired_at, expires_at, updated_at FROM sync_locks WHERE expires_at > (unixepoch() * 1000) ORDER BY expires_at ASC, lock_key ASC;`,
    phases: `SELECT p.work_key, p.phase, p.complete, p.expected_items, p.processed_items, p.pages_processed, p.chunks_processed, p.updated_at FROM sync_work_phases p JOIN sync_work_runs w ON w.work_key = p.work_key WHERE w.lifecycle_status = 'active' AND w.work_key <> ${retained} ORDER BY p.work_key ASC, p.phase ASC;`,
  });
}

export function classifyMetaPaidLarkRuntimeDiagnosis(beforeInput = {}, afterInput = {}) {
  const before = normalizeSnapshot(beforeInput);
  const after = normalizeSnapshot(afterInput);
  const elapsedMs = after.observedAt - before.observedAt;
  const enoughStabilityWindow = elapsedMs >= META_PAID_LARK_RUNTIME_STABILITY_WINDOW_MS;
  const beforeWork = new Map(before.work.map((row) => [row.work_key, stableJson(row)]));
  const afterWork = new Map(after.work.map((row) => [row.work_key, stableJson(row)]));
  const queueByWork = groupBy(after.queue, 'work_key');
  const phasesByWork = groupBy(after.phases, 'work_key');
  const blockerStateStable = enoughStabilityWindow
    && stableJson(before.work) === stableJson(after.work)
    && stableJson(before.queue) === stableJson(after.queue)
    && stableJson(before.locks) === stableJson(after.locks)
    && stableJson(before.phases) === stableJson(after.phases);

  const work = after.work.map((row) => {
    const latestActivityAt = Math.max(
      integerOrZero(row.updated_at),
      integerOrZero(row.requested_at),
      integerOrZero(row.created_at),
    );
    const ageMs = latestActivityAt > 0 ? after.observedAt - latestActivityAt : null;
    const stableAcrossWindow = enoughStabilityWindow
      && beforeWork.get(row.work_key) === afterWork.get(row.work_key);
    const staleByExistingMetaRule = blockerStateStable
      && stableAcrossWindow
      && ageMs !== null
      && ageMs >= META_PAID_LARK_RUNTIME_STALE_AGE_MS;
    return Object.freeze({
      ...row,
      latestActivityAt: latestActivityAt || null,
      ageMs,
      stableAcrossWindow,
      staleByExistingMetaRule,
      metaAdsWork: String(row.work_key ?? '').startsWith('meta_ads:'),
      queueOperations: Object.freeze((queueByWork.get(row.work_key) ?? [])
        .map((entry) => entry.operation_id)),
      phases: Object.freeze(phasesByWork.get(row.work_key) ?? []),
    });
  });

  const disappearedWorkKeys = before.work
    .map((row) => row.work_key)
    .filter((key) => !afterWork.has(key));
  const appearedWorkKeys = after.work
    .map((row) => row.work_key)
    .filter((key) => !beforeWork.has(key));
  const idle = after.work.length === 0 && after.queue.length === 0 && after.locks.length === 0;
  const everyCurrentWorkStable = after.work.length > 0
    && work.every((item) => item.stableAcrossWindow);
  const everyCurrentWorkStale = blockerStateStable
    && everyCurrentWorkStable
    && work.every((item) => item.staleByExistingMetaRule);

  return deepFreeze({
    contractVersion: META_PAID_LARK_RUNTIME_BLOCKER_DIAGNOSIS_CONTRACT_VERSION,
    observedAt: after.observedAt,
    elapsedMs,
    enoughStabilityWindow,
    blockerStateStable,
    idle,
    counts: {
      activeWork: after.work.length,
      activeQueueOperations: after.queue.length,
      activeLocks: after.locks.length,
    },
    work,
    locks: after.locks,
    disappearedWorkKeys,
    appearedWorkKeys,
    everyCurrentWorkStable,
    everyCurrentWorkStale,
    nextGate: idle
      ? 'rerun_paid_meta_closeout'
      : everyCurrentWorkStale
        ? 'exact_recovery_review_required'
        : 'active_or_changing_work_must_not_be_mutated',
    remoteMutationPerformed: false,
  });
}

function normalizeSnapshot(value) {
  const source = value && typeof value === 'object' ? value : {};
  return deepFreeze({
    observedAt: requireTimestamp(source.observedAt),
    work: normalizeRows(source.work, WORK_KEYS),
    queue: normalizeRows(source.queue, QUEUE_KEYS),
    locks: normalizeRows(source.locks, LOCK_KEYS),
    phases: normalizeRows(source.phases, PHASE_KEYS),
  });
}

const WORK_KEYS = Object.freeze([
  'work_key', 'cursor_key', 'work_type', 'status', 'lifecycle_status', 'generation',
  'requested_at', 'created_at', 'updated_at', 'expires_at', 'terminal_reason',
]);
const QUEUE_KEYS = Object.freeze(['operation_id', 'work_key']);
const LOCK_KEYS = Object.freeze(['lock_key', 'owner_id', 'acquired_at', 'expires_at', 'updated_at']);
const PHASE_KEYS = Object.freeze([
  'work_key', 'phase', 'complete', 'expected_items', 'processed_items',
  'pages_processed', 'chunks_processed', 'updated_at',
]);

function normalizeRows(value, keys) {
  if (!Array.isArray(value)) return Object.freeze([]);
  return Object.freeze(value.map((row) => Object.freeze(Object.fromEntries(
    keys.map((key) => [key, scalar(row?.[key])]),
  ))));
}

function scalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }
  return null;
}

function requireTimestamp(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error('Runtime diagnosis snapshot observedAt must be a positive integer timestamp');
  }
  return number;
}

function integerOrZero(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function groupBy(rows, key) {
  const result = new Map();
  for (const row of rows) {
    const id = row?.[key];
    if (!result.has(id)) result.set(id, []);
    result.get(id).push(row);
  }
  return result;
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
