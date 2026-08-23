import { createStableFingerprint } from '../../packages/shared/src/hash/stable-fingerprint.js';
import { InMemoryResumableWorkStore } from '../../packages/sync-engine/src/in-memory-resumable-work-store.js';
import {
  META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS,
  META_PAID_LARK_CLOSEOUT_PERIOD,
  META_PAID_LARK_CLOSEOUT_TABLE_KEYS,
  META_PAID_LARK_CLOSEOUT_TARGETS,
} from './meta-paid-lark-closeout.js';

export const META_PAID_DIRECT_LARK_CONTRACT_VERSION = 'meta_paid_direct_lark_materializer_v1';
export const META_PAID_DIRECT_LARK_SOURCE_PHASE = 'meta_end_to_end_source_staging_v1';
export const META_PAID_DIRECT_LARK_D1_PHASE = 'meta_end_to_end_d1_write_v1';
export const META_PAID_DIRECT_LARK_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_META_PAID_DIRECT_LARK',
  value: 'RUN_META_PAID_DIRECT_LARK',
});
export const META_PAID_DIRECT_LARK_TARGETS = META_PAID_LARK_CLOSEOUT_TARGETS;
export const META_PAID_DIRECT_LARK_TABLE_KEYS = META_PAID_LARK_CLOSEOUT_TABLE_KEYS;
export const META_PAID_DIRECT_LARK_EXCLUDED_TABLE_KEYS = META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS;
export const META_PAID_DIRECT_LARK_PERIOD = META_PAID_LARK_CLOSEOUT_PERIOD;

const OPERATION_SUFFIX = '[0-9a-f]{12}';
const MAX_CANDIDATES = 25;

export function buildMetaPaidDirectCandidateSql(target) {
  const safeTarget = requireTarget(target);
  const prefix = sqlLiteral(`meta_ads:${safeTarget}:meta-${safeTarget}-history-20260701-20260731-`);
  const sourcePhase = sqlLiteral(META_PAID_DIRECT_LARK_SOURCE_PHASE);
  const d1Phase = sqlLiteral(META_PAID_DIRECT_LARK_D1_PHASE);
  return `
SELECT
  r.work_key,
  r.cursor_key,
  r.work_type,
  r.generation,
  r.requested_at,
  r.lifecycle_status,
  r.created_at AS work_created_at,
  r.updated_at AS work_updated_at,
  s.state_json AS source_state_json,
  s.expected_items AS source_expected_items,
  s.processed_items AS source_processed_items,
  s.pages_processed AS source_pages_processed,
  s.chunks_processed AS source_chunks_processed,
  s.complete AS source_complete,
  s.created_at AS source_created_at,
  s.updated_at AS source_updated_at,
  d.state_json AS d1_state_json,
  d.expected_items AS d1_expected_items,
  d.processed_items AS d1_processed_items,
  d.pages_processed AS d1_pages_processed,
  d.chunks_processed AS d1_chunks_processed,
  d.complete AS d1_complete,
  d.created_at AS d1_created_at,
  d.updated_at AS d1_updated_at
FROM sync_work_runs r
JOIN sync_work_phases s
  ON s.work_key = r.work_key AND s.phase = ${sourcePhase}
JOIN sync_work_phases d
  ON d.work_key = r.work_key AND d.phase = ${d1Phase}
WHERE substr(r.work_key, 1, length(${prefix})) = ${prefix}
  AND s.complete = 1
  AND d.complete = 1
ORDER BY r.generation DESC, r.updated_at DESC, r.work_key ASC
LIMIT ${MAX_CANDIDATES};`.trim();
}

export function buildMetaPaidDirectUnitsSql(workKey) {
  const key = sqlLiteral(requireText(workKey, 'workKey'));
  const phase = sqlLiteral(META_PAID_DIRECT_LARK_SOURCE_PHASE);
  return `
SELECT unit_key, sequence, payload_json
FROM sync_work_units
WHERE work_key = ${key}
  AND phase = ${phase}
ORDER BY sequence ASC;`.trim();
}

export function parseWranglerD1Rows(value) {
  const parsed = parseJson(value, 'Wrangler D1 JSON');
  const envelopes = Array.isArray(parsed) ? parsed : [parsed];
  const rows = [];
  for (const envelope of envelopes) {
    if (Array.isArray(envelope?.results)) {
      rows.push(...envelope.results);
      continue;
    }
    if (Array.isArray(envelope?.result?.results)) {
      rows.push(...envelope.result.results);
      continue;
    }
    if (Array.isArray(envelope?.result)) {
      for (const nested of envelope.result) {
        if (Array.isArray(nested?.results)) rows.push(...nested.results);
      }
      continue;
    }
    if (envelope?.success === true && envelope?.results === undefined) continue;
    throw directError(
      'Wrangler D1 JSON does not contain a recognized result envelope',
      'META_PAID_DIRECT_LARK_D1_JSON_INVALID',
    );
  }
  return Object.freeze(rows.map((row) => Object.freeze({ ...requireObject(row, 'D1 row') })));
}

export function normalizeMetaPaidDirectCandidate(row, target) {
  const safeTarget = requireTarget(target);
  const value = requireObject(row, 'candidate');
  const workKey = requireText(value.work_key, 'candidate.work_key');
  const expectedPrefix = `meta_ads:${safeTarget}:`;
  if (!workKey.startsWith(expectedPrefix)) {
    throw sourceError('Paid Meta work key does not match the requested target', {
      target: safeTarget,
      workKey,
    });
  }
  const operationId = workKey.slice(expectedPrefix.length);
  const operationPattern = new RegExp(
    `^meta-${escapeRegExp(safeTarget)}-history-20260701-20260731-${OPERATION_SUFFIX}$`,
    'u',
  );
  if (!operationPattern.test(operationId)) {
    throw sourceError('Paid Meta work is not the exact July history operation shape', {
      target: safeTarget,
      workKey,
    });
  }
  const sourcePhase = normalizePhaseRow(value, 'source');
  const d1Phase = normalizePhaseRow(value, 'd1');
  if (!sourcePhase.complete || !d1Phase.complete) {
    throw sourceError('Paid Meta source/D1 phases must both be complete', {
      target: safeTarget,
      workKey,
    });
  }
  if (sourcePhase.state?.stage !== 'complete') {
    throw sourceError('Paid Meta source state must be complete', {
      target: safeTarget,
      workKey,
      sourceStage: sourcePhase.state?.stage ?? null,
    });
  }
  return deepFreeze({
    target: safeTarget,
    workKey,
    operationId,
    cursorKey: requireText(value.cursor_key, 'candidate.cursor_key'),
    workType: requireText(value.work_type, 'candidate.work_type'),
    generation: timestamp(value.generation, 'candidate.generation'),
    requestedAt: timestamp(value.requested_at, 'candidate.requested_at'),
    lifecycleStatus: optionalText(value.lifecycle_status),
    workUpdatedAt: optionalTimestamp(value.work_updated_at, 'candidate.work_updated_at'),
    sourcePhase,
    d1Phase,
  });
}

export function normalizeMetaPaidDirectUnits(rows) {
  if (!Array.isArray(rows)) throw new TypeError('rows must be an array');
  return deepFreeze(rows.map((row, index) => {
    const value = requireObject(row, `units[${index}]`);
    return {
      unitKey: requireText(value.unit_key, `units[${index}].unit_key`),
      sequence: nonNegativeInteger(value.sequence, `units[${index}].sequence`),
      payload: parseJsonObject(value.payload_json, `units[${index}].payload_json`),
    };
  }));
}

export function validateMetaPaidDirectSourceSnapshot(candidateInput, unitsInput) {
  const candidate = requireObject(candidateInput, 'candidate');
  const target = requireTarget(candidate.target);
  const units = Array.isArray(unitsInput) ? unitsInput : [];
  const expectedUnits = nonNegativeInteger(candidate.sourcePhase?.state?.unitCount, 'source.unitCount');
  if (expectedUnits <= 0 || units.length !== expectedUnits) {
    throw sourceError('Paid Meta durable source unit count is incomplete', {
      target,
      workKey: candidate.workKey,
      expectedUnits,
      observedUnits: units.length,
    });
  }

  const sequences = new Set();
  for (const unit of units) {
    const sequence = nonNegativeInteger(unit?.sequence, 'source unit sequence');
    if (sequence >= expectedUnits || sequences.has(sequence)) {
      throw sourceError('Paid Meta durable source sequence set is invalid', {
        target,
        workKey: candidate.workKey,
        sequence,
      });
    }
    sequences.add(sequence);
  }
  for (let sequence = 0; sequence < expectedUnits; sequence += 1) {
    if (!sequences.has(sequence)) {
      throw sourceError('Paid Meta durable source sequence set is incomplete', {
        target,
        workKey: candidate.workKey,
        missingSequence: sequence,
      });
    }
  }

  const accountUnits = units.filter((unit) => unit?.payload?.datasetKey === 'meta_ads.account.latest');
  const creativeUnits = units.filter((unit) => unit?.payload?.datasetKey === 'meta_ads.creatives.inventory');
  const dailyUnits = units.filter((unit) => unit?.payload?.datasetKey === 'meta_ads.performance.daily');
  if (creativeUnits.length === 0 || dailyUnits.length === 0) {
    throw sourceError('Paid Meta source is missing persisted Creative or Daily staging', {
      target,
      workKey: candidate.workKey,
      creativeUnitCount: creativeUnits.length,
      dailyUnitCount: dailyUnits.length,
    });
  }
  const accountRows = accountUnits.flatMap((unit) => requireRows(unit.payload, 'account'));
  if (accountRows.length !== 1) {
    throw sourceError('Paid Meta source must contain exactly one Ad Account row', {
      target,
      workKey: candidate.workKey,
      accountRows: accountRows.length,
    });
  }
  const creativeRows = creativeUnits.flatMap((unit) => requireRows(unit.payload, 'creative'));
  const dailyRows = dailyUnits.flatMap((unit) => requireRows(unit.payload, 'daily'));
  for (const row of dailyRows) {
    const dateStart = requireDate(row?.date_start, 'daily.date_start');
    const dateStop = requireDate(row?.date_stop ?? row?.date_start, 'daily.date_stop');
    if (dateStart < META_PAID_DIRECT_LARK_PERIOD.since
      || dateStart > META_PAID_DIRECT_LARK_PERIOD.until
      || dateStop < META_PAID_DIRECT_LARK_PERIOD.since
      || dateStop > META_PAID_DIRECT_LARK_PERIOD.until) {
      throw sourceError('Paid Meta Daily source contains a row outside the approved July range', {
        target,
        workKey: candidate.workKey,
        dateStart,
        dateStop,
      });
    }
  }

  const account = requireObject(accountRows[0], 'Meta Ads account row');
  const sourceAccountId = normalizeAdAccountId(account.account_id ?? account.id);
  return deepFreeze({
    ...candidate,
    sourceAccountId,
    units: units.map((unit) => structuredClone(unit)),
    sourceSummary: {
      sourceUnits: units.length,
      accountRows: accountRows.length,
      creativeUnits: creativeUnits.length,
      creativeRows: creativeRows.length,
      dailyUnits: dailyUnits.length,
      dailyRows: dailyRows.length,
    },
  });
}

export function selectNewestMetaPaidDirectSnapshot(snapshots, target) {
  const safeTarget = requireTarget(target);
  const eligible = (Array.isArray(snapshots) ? snapshots : [])
    .filter((snapshot) => snapshot?.target === safeTarget)
    .sort((left, right) => right.generation - left.generation
      || (right.workUpdatedAt ?? 0) - (left.workUpdatedAt ?? 0)
      || left.workKey.localeCompare(right.workKey));
  if (eligible.length === 0) {
    throw directError(
      'No eligible paid Meta July source snapshot was found',
      'META_PAID_DIRECT_LARK_SOURCE_NOT_FOUND',
      { target: safeTarget },
    );
  }
  const newestGeneration = eligible[0].generation;
  const sameGeneration = eligible.filter((snapshot) => snapshot.generation === newestGeneration);
  if (sameGeneration.length !== 1) {
    throw directError(
      'Paid Meta source selection is ambiguous at the newest generation',
      'META_PAID_DIRECT_LARK_SOURCE_AMBIGUOUS',
      { target: safeTarget, candidateCount: sameGeneration.length, generation: newestGeneration },
    );
  }
  return eligible[0];
}

export async function createSeededMetaPaidDirectWorkStore(snapshotInput, input = {}) {
  const snapshot = requireObject(snapshotInput, 'snapshot');
  const connectorKey = 'meta_ads';
  const accountKey = requireText(input.accountKey ?? 'chemistry_k', 'accountKey');
  const customerProfile = requireText(
    input.customerProfile ?? 'integration_workspace',
    'customerProfile',
  );
  const customerKey = requireText(input.customerKey ?? 'chemistry_k', 'customerKey');
  const dateRange = Object.freeze({
    since: META_PAID_DIRECT_LARK_PERIOD.since,
    until: META_PAID_DIRECT_LARK_PERIOD.until,
  });
  const operationFingerprint = await createStableFingerprint({
    schemaVersion: 'meta_ads_report_range_activity_operation_v1',
    connectorKey,
    sourceAccountId: requireText(snapshot.sourceAccountId, 'snapshot.sourceAccountId'),
    accountKey,
    customerProfile,
    customerKey,
    dateRange,
    generation: timestamp(snapshot.generation, 'snapshot.generation'),
  });
  const store = new InMemoryResumableWorkStore();
  await store.beginWork({
    workKey: requireText(snapshot.workKey, 'snapshot.workKey'),
    cursorKey: requireText(snapshot.cursorKey, 'snapshot.cursorKey'),
    workType: requireText(snapshot.workType, 'snapshot.workType'),
    operationFingerprint,
    generation: snapshot.generation,
    requestedAt: snapshot.requestedAt,
  });
  const source = snapshot.sourcePhase;
  for (const unit of snapshot.units) {
    await store.savePhase({
      workKey: snapshot.workKey,
      phase: META_PAID_DIRECT_LARK_SOURCE_PHASE,
      state: structuredClone(source.state),
      expectedItems: source.expectedItems,
      processedItems: source.processedItems,
      pagesProcessed: source.pagesProcessed,
      chunksProcessed: source.chunksProcessed,
      complete: true,
      unit: structuredClone(unit),
    });
  }
  const d1 = snapshot.d1Phase;
  await store.savePhase({
    workKey: snapshot.workKey,
    phase: META_PAID_DIRECT_LARK_D1_PHASE,
    state: structuredClone(d1.state),
    expectedItems: d1.expectedItems,
    processedItems: d1.processedItems,
    pagesProcessed: d1.pagesProcessed,
    chunksProcessed: d1.chunksProcessed,
    complete: true,
  });
  return store;
}

export function createForbiddenMetaPaidDirectAdapter() {
  const forbidden = () => {
    throw directError(
      'Meta provider access is forbidden in direct Lark materialization',
      'META_PAID_DIRECT_LARK_PROVIDER_READ_FORBIDDEN',
    );
  };
  return Object.freeze({
    fetchAccount: forbidden,
    fetchCampaignsPage: forbidden,
    fetchAdSetsPage: forbidden,
    fetchAdsPage: forbidden,
    fetchCreativesPage: forbidden,
    fetchDailyInsightsPage: forbidden,
  });
}

export function createForbiddenMetaPaidDirectHistoryStore() {
  const forbidden = () => {
    throw directError(
      'Remote D1 mutation is forbidden in direct Lark materialization',
      'META_PAID_DIRECT_LARK_D1_WRITE_FORBIDDEN',
    );
  };
  return Object.freeze({
    upsertOrganicAccountDailyFact: forbidden,
    upsertAdsEntityState: forbidden,
    upsertAdsDailyFact: forbidden,
    saveCoverageRun: forbidden,
    saveCoverageEntities: forbidden,
    writeMetaD1Operations: forbidden,
  });
}

export function validateMetaPaidDirectLarkResult(resultInput, options = {}) {
  const result = requireObject(resultInput, 'result');
  if (result.status !== 'completed' || result.connectorKey !== 'meta_ads') {
    throw directError(
      'Paid Meta direct Lark materialization did not complete',
      'META_PAID_DIRECT_LARK_RECONCILIATION_INVALID',
      { status: result.status ?? null },
    );
  }
  const lark = Array.isArray(result?.reconciliation?.lark) ? result.reconciliation.lark : [];
  const keys = lark.map((entry) => entry?.tableKey ?? null);
  if (JSON.stringify(keys) !== JSON.stringify(META_PAID_DIRECT_LARK_TABLE_KEYS)) {
    throw directError(
      'Paid Meta direct Lark result escaped the exact two-table scope',
      'META_PAID_DIRECT_LARK_SCOPE_INVALID',
      { observedTableKeys: keys },
    );
  }
  for (const entry of lark) {
    const expected = nonNegativeInteger(entry?.expected, 'lark.expected');
    const created = nonNegativeInteger(entry?.created, 'lark.created');
    const updated = nonNegativeInteger(entry?.updated, 'lark.updated');
    const skipped = nonNegativeInteger(entry?.skipped, 'lark.skipped');
    if (created + updated + skipped !== expected) {
      throw directError(
        'Paid Meta direct Lark table reconciliation is incomplete',
        'META_PAID_DIRECT_LARK_RECONCILIATION_INVALID',
        { tableKey: entry?.tableKey ?? null, expected, created, updated, skipped },
      );
    }
    if (options.idempotent === true && (created !== 0 || updated !== 0 || skipped !== expected)) {
      throw directError(
        'Paid Meta direct Lark replay was not idempotent',
        'META_PAID_DIRECT_LARK_IDEMPOTENCY_INVALID',
        { tableKey: entry?.tableKey ?? null, expected, created, updated, skipped },
      );
    }
  }
  return deepFreeze({
    accepted: true,
    idempotent: options.idempotent === true,
    operationId: requireText(result.operationId, 'result.operationId'),
    larkResults: lark.map((entry) => ({
      tableKey: entry.tableKey,
      expected: Number(entry.expected),
      created: Number(entry.created),
      updated: Number(entry.updated),
      skipped: Number(entry.skipped),
    })),
  });
}

export function summarizeMetaPaidDirectSnapshot(snapshotInput) {
  const snapshot = requireObject(snapshotInput, 'snapshot');
  return deepFreeze({
    target: requireTarget(snapshot.target),
    workKey: requireText(snapshot.workKey, 'snapshot.workKey'),
    operationId: requireText(snapshot.operationId, 'snapshot.operationId'),
    generation: timestamp(snapshot.generation, 'snapshot.generation'),
    requestedAt: timestamp(snapshot.requestedAt, 'snapshot.requestedAt'),
    sourceAccountId: requireText(snapshot.sourceAccountId, 'snapshot.sourceAccountId'),
    sourceSummary: structuredClone(snapshot.sourceSummary),
    sourcePhaseComplete: snapshot.sourcePhase?.complete === true,
    d1PhaseComplete: snapshot.d1Phase?.complete === true,
  });
}

function normalizePhaseRow(value, prefix) {
  return deepFreeze({
    state: parseJsonObject(value[`${prefix}_state_json`], `${prefix}_state_json`),
    expectedItems: nonNegativeInteger(value[`${prefix}_expected_items`], `${prefix}.expectedItems`),
    processedItems: nonNegativeInteger(value[`${prefix}_processed_items`], `${prefix}.processedItems`),
    pagesProcessed: nonNegativeInteger(value[`${prefix}_pages_processed`], `${prefix}.pagesProcessed`),
    chunksProcessed: nonNegativeInteger(value[`${prefix}_chunks_processed`], `${prefix}.chunksProcessed`),
    complete: Number(value[`${prefix}_complete`]) === 1 || value[`${prefix}_complete`] === true,
    createdAt: optionalTimestamp(value[`${prefix}_created_at`], `${prefix}.createdAt`),
    updatedAt: optionalTimestamp(value[`${prefix}_updated_at`], `${prefix}.updatedAt`),
  });
}

function requireRows(payload, label) {
  const rows = payload?.rows;
  if (!Array.isArray(rows)) {
    throw sourceError(`Paid Meta ${label} staged payload rows are invalid`);
  }
  return rows;
}

function normalizeAdAccountId(value) {
  const text = requireText(value, 'Meta Ads account id').replace(/^act_/iu, '');
  if (text === '') throw sourceError('Meta Ads source account id is invalid');
  return text;
}

function requireTarget(value) {
  const target = requireText(value, 'target');
  if (!META_PAID_DIRECT_LARK_TARGETS.includes(target)) {
    throw directError(
      'Paid Meta direct Lark target is invalid',
      'META_PAID_DIRECT_LARK_TARGET_INVALID',
      { target },
    );
  }
  return target;
}

function sourceError(message, details = {}) {
  return directError(message, 'META_PAID_DIRECT_LARK_SOURCE_INELIGIBLE', details);
}

function directError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidDirectLarkMaterializerError';
  error.code = code;
  error.details = details;
  return error;
}

function sqlLiteral(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}

function parseJson(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be JSON text`);
  }
  try {
    return JSON.parse(value);
  } catch {
    throw new TypeError(`${fieldName} must contain valid JSON`);
  }
}

function parseJsonObject(value, fieldName) {
  const parsed = parseJson(value, fieldName);
  return requireObject(parsed, fieldName);
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' && typeof value !== 'number') {
    throw new TypeError(`${fieldName} is required`);
  }
  const text = String(value).trim();
  if (text === '') throw new TypeError(`${fieldName} is required`);
  return text;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function timestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw new TypeError(`${fieldName} must be a valid timestamp`);
  }
  return number;
}

function optionalTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return timestamp(value, fieldName);
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }
  return number;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
