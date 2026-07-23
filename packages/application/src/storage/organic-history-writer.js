import {
  createContentKey,
  createCoverageEntityKey,
  createObservationKey,
  validateStorageRow,
} from './marketing-history-contract.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const CUMULATIVE_COUNTER_FIELDS = Object.freeze([
  'views',
  'likes',
  'comments',
  'shares',
  'unique_viewers',
  'total_watch_time_seconds',
]);

/**
 * สร้าง Writer หนึ่งชุดต่อ Durable source Work generation
 * เพื่อให้ observedAt/fetchedAt/Coverage identity คงที่ข้าม Queue retries.
 */
export function createOrganicHistoryWriter(input = {}) {
  const context = normalizeContext(input);

  return Object.freeze({
    context,
    preflightBatch: (batch) => planBatch(context, batch),
    writeBatch: (batch) => writeBatch(context, batch),
    beginCoverage: (value) => beginCoverage(context, value),
    completeCoverage: (value) => completeCoverage(context, value),
    failCoverage: (value) => failCoverage(context, value),
  });
}

async function planBatch(context, input = {}) {
  const contentRows = requireRows(input.contentRows, 'contentRows');
  const dailyRows = requireRows(input.dailySnapshotRows, 'dailySnapshotRows');
  const dailyByContentKey = indexDailyRows(context, dailyRows);
  const keys = [];
  const seen = new Set();

  for (const row of contentRows) {
    const identity = readContentIdentity(context, row);
    if (seen.has(identity.contentKey)) {
      throw historyInputError('Organic history batch contains duplicate Content keys', {
        contentKey: identity.contentKey,
      });
    }
    seen.add(identity.contentKey);
    keys.push(identity.contentKey);
  }

  if (dailyByContentKey.size !== keys.length) {
    throw historyInputError('Organic history Content/Daily rows do not reconcile', {
      contentRows: keys.length,
      dailyRows: dailyByContentKey.size,
    });
  }

  const existingRows = await context.gateway.listOrganicContentStatesByKeys(keys);
  const existingByKey = new Map(existingRows.map((row) => [row.content_key, row]));
  const planned = await Promise.all(contentRows.map(async (contentRow) => {
    const identity = readContentIdentity(context, contentRow);
    const dailyRow = dailyByContentKey.get(identity.contentKey);
    if (!dailyRow) {
      throw historyInputError('Organic history row is missing its cumulative Daily metrics', {
        contentKey: identity.contentKey,
      });
    }
    return buildRows(context, contentRow, dailyRow, existingByKey.get(identity.contentKey) ?? null);
  }));

  return Object.freeze({
    contentRows: contentRows.length,
    stateRows: Object.freeze(planned.map((item) => item.state)),
    observationRows: Object.freeze(planned.flatMap((item) => item.observation ? [item.observation] : [])),
    coverageEntities: Object.freeze(planned.map((item) => item.coverageEntity)),
    classifications: Object.freeze(planned.map((item) => Object.freeze({
      contentKey: item.state.content_key,
      observationKind: item.observation?.observation_kind ?? 'unchanged',
      metricsChanged: item.metricsChanged,
      metadataChanged: item.metadataChanged,
    }))),
  });
}

async function writeBatch(context, input = {}) {
  const plan = await planBatch(context, input);
  const result = {
    contentRows: plan.contentRows,
    stateWritten: 0,
    stateSkipped: 0,
    observationsCreated: 0,
    observationsSkipped: 0,
    observationsNotRequired: plan.contentRows - plan.observationRows.length,
    coverageEntitiesWritten: 0,
    coverageEntitiesSkipped: 0,
  };

  // Plan ทั้ง Unit ถูก Validate ครบก่อน Write แรกแล้ว
  for (const row of plan.stateRows) {
    const write = await context.gateway.upsertOrganicContentState(row);
    if (write.status === 'written') result.stateWritten += 1;
    else result.stateSkipped += 1;
  }
  for (const row of plan.observationRows) {
    const write = await context.gateway.saveOrganicContentObservation(row);
    if (write.status === 'created') result.observationsCreated += 1;
    else result.observationsSkipped += 1;
  }
  const coverageWrites = await context.gateway.saveCoverageEntities(plan.coverageEntities);
  for (const write of coverageWrites) {
    if (write.status === 'written') result.coverageEntitiesWritten += 1;
    else result.coverageEntitiesSkipped += 1;
  }

  return Object.freeze({ ...result, classifications: plan.classifications });
}

async function beginCoverage(context, input = {}) {
  const expectedEntities = nonNegativeInteger(input.expectedEntities, 'expectedEntities');
  const expectedRows = nonNegativeInteger(input.expectedRows ?? expectedEntities, 'expectedRows');
  const sourceWatermark = optionalText(input.sourceWatermark);
  const existing = await context.gateway.readCoverageRun(context.coverageRunId);

  if (existing?.status === 'complete') {
    const same = Number(existing.expected_entities) === expectedEntities
      && Number(existing.expected_rows) === expectedRows
      && normalizeSqlText(existing.source_watermark) === sourceWatermark;
    if (!same) {
      throw historyInputError('Completed Coverage identity was reused for a different source snapshot', {
        coverageRunId: context.coverageRunId,
      });
    }
    return Object.freeze({ status: 'complete_replay', replay: true, row: existing });
  }

  const row = coverageRow(context, {
    status: 'partial',
    expectedEntities,
    observedEntities: 0,
    expectedRows,
    observedRows: 0,
    writtenRows: 0,
    failedRows: 0,
    sourceWatermark,
    completedAt: null,
    errorCode: null,
    updatedAt: context.observedAt,
  });
  const write = await context.gateway.saveCoverageRun(row);
  return Object.freeze({ status: write.status, replay: false, row });
}

async function completeCoverage(context, input = {}) {
  const row = coverageRow(context, {
    status: 'complete',
    expectedEntities: nonNegativeInteger(input.expectedEntities, 'expectedEntities'),
    observedEntities: nonNegativeInteger(input.observedEntities, 'observedEntities'),
    expectedRows: nonNegativeInteger(input.expectedRows, 'expectedRows'),
    observedRows: nonNegativeInteger(input.observedRows, 'observedRows'),
    writtenRows: nonNegativeInteger(input.writtenRows, 'writtenRows'),
    failedRows: 0,
    sourceWatermark: optionalText(input.sourceWatermark),
    completedAt: requiredTimestamp(input.completedAt ?? context.observedAt, 'completedAt'),
    errorCode: null,
    updatedAt: requiredTimestamp(input.completedAt ?? context.observedAt, 'completedAt'),
  });
  const write = await context.gateway.saveCoverageRun(row);
  return Object.freeze({ status: write.status, row });
}

async function failCoverage(context, input = {}) {
  const completedAt = requiredTimestamp(input.completedAt ?? Date.now(), 'completedAt');
  const row = coverageRow(context, {
    status: 'partial',
    expectedEntities: nonNegativeInteger(input.expectedEntities ?? 0, 'expectedEntities'),
    observedEntities: nonNegativeInteger(input.observedEntities ?? 0, 'observedEntities'),
    expectedRows: nonNegativeInteger(input.expectedRows ?? 0, 'expectedRows'),
    observedRows: nonNegativeInteger(input.observedRows ?? 0, 'observedRows'),
    writtenRows: nonNegativeInteger(input.writtenRows ?? 0, 'writtenRows'),
    failedRows: nonNegativeInteger(input.failedRows ?? 1, 'failedRows'),
    sourceWatermark: optionalText(input.sourceWatermark),
    completedAt,
    errorCode: optionalText(input.errorCode) ?? 'ORGANIC_HISTORY_WRITE_FAILED',
    updatedAt: completedAt,
  });
  const write = await context.gateway.saveCoverageRun(row);
  return Object.freeze({ status: write.status, row });
}

async function buildRows(context, contentRow, dailyRow, existing) {
  const identity = readContentIdentity(context, contentRow);
  assertDailyIdentity(context, dailyRow, identity);
  const metrics = readMetrics(contentRow, dailyRow);
  const metadata = Object.freeze({
    source_account_id: context.sourceAccountId,
    content_type: optionalText(contentRow.content_type),
    published_at: optionalTimestamp(contentRow.published_at, 'published_at'),
    caption: optionalText(contentRow.caption),
    content_url: optionalText(contentRow.content_url),
    thumbnail_url: optionalText(contentRow.thumbnail_url),
    duration_seconds: optionalNonNegativeNumber(contentRow.duration_seconds, 'duration_seconds'),
  });
  const [metricsHash, metadataHash] = await Promise.all([
    createStableFingerprint({ contract: 'organic-cumulative-metrics-v1', ...metrics }),
    createStableFingerprint({ contract: 'organic-content-metadata-v1', ...metadata }),
  ]);
  const metricsChanged = !existing || existing.metrics_hash !== metricsHash;
  const metadataChanged = !existing || existing.metadata_hash !== metadataHash;
  const observationKind = classifyObservation(existing, metrics, metricsHash);
  const firstSeenAt = existing ? Number(existing.first_seen_at) : context.observedAt;
  const lastChangedAt = metricsChanged || metadataChanged
    ? context.observedAt
    : optionalTimestamp(existing?.last_changed_at, 'existing.last_changed_at');

  const state = validateStorageRow('organic_content_state', {
    content_key: identity.contentKey,
    customer_profile: context.customerProfile,
    customer_key: context.customerKey,
    platform: context.platform,
    account_key: context.accountKey,
    source_account_id: context.sourceAccountId,
    external_content_id: identity.externalContentId,
    content_type: metadata.content_type,
    published_at: metadata.published_at,
    first_seen_at: firstSeenAt,
    last_observed_at: context.observedAt,
    last_changed_at: lastChangedAt,
    source_availability_status: 'available',
    ...metrics,
    metrics_hash: metricsHash,
    metadata_hash: metadataHash,
    last_coverage_run_id: context.coverageRunId,
    last_sync_run_id: context.historySyncRunId,
    created_at: existing ? Number(existing.created_at) : context.observedAt,
    updated_at: context.observedAt,
  });

  const observation = observationKind === null ? null : validateStorageRow('organic_content_observations', {
    observation_key: createObservationKey({
      content_key: identity.contentKey,
      observed_at: context.observedAt,
      observation_kind: observationKind,
    }),
    content_key: identity.contentKey,
    customer_key: context.customerKey,
    platform: context.platform,
    account_key: context.accountKey,
    external_content_id: identity.externalContentId,
    observed_at: context.observedAt,
    metric_date: context.metricDate,
    source_timezone: context.sourceTimezone,
    observation_kind: observationKind,
    metric_semantics: 'cumulative',
    ...metrics,
    metrics_hash: metricsHash,
    source_revision: context.sourceRevision,
    coverage_run_id: context.coverageRunId,
    fetched_at: context.fetchedAt,
    sync_run_id: context.historySyncRunId,
    created_at: context.observedAt,
  });

  const coverageEntity = validateStorageRow('data_coverage_entities', {
    coverage_entity_key: createCoverageEntityKey({
      coverage_run_id: context.coverageRunId,
      entity_type: 'content',
      external_entity_id: identity.externalContentId,
    }),
    coverage_run_id: context.coverageRunId,
    entity_type: 'content',
    external_entity_id: identity.externalContentId,
    observation_status: 'observed',
    source_revision: context.sourceRevision,
    observed_at: context.observedAt,
    created_at: context.observedAt,
  });

  return Object.freeze({ state, observation, coverageEntity, metricsChanged, metadataChanged });
}

function normalizeContext(input) {
  const gateway = requireGateway(input.gateway);
  const observedAt = requiredTimestamp(input.observedAt, 'observedAt');
  const sourceTimezone = requireText(input.sourceTimezone, 'sourceTimezone');
  return Object.freeze({
    gateway,
    customerProfile: requireText(input.customerProfile, 'customerProfile'),
    customerKey: requireText(input.customerKey, 'customerKey'),
    platform: requireText(input.platform, 'platform'),
    accountKey: requireText(input.accountKey, 'accountKey'),
    sourceAccountId: optionalText(input.sourceAccountId),
    sourceTimezone,
    observedAt,
    fetchedAt: requiredTimestamp(input.fetchedAt ?? observedAt, 'fetchedAt'),
    metricDate: dateOnlyInTimeZone(observedAt, sourceTimezone),
    historySyncRunId: requireText(input.historySyncRunId, 'historySyncRunId'),
    coverageRunId: requireText(input.coverageRunId, 'coverageRunId'),
    sourceRevision: optionalText(input.sourceRevision),
    scopeMode: requireText(input.scopeMode ?? 'full_inventory', 'scopeMode'),
    datasetKey: requireText(input.datasetKey ?? 'organic_content_cumulative', 'datasetKey'),
  });
}

function coverageRow(context, input) {
  return validateStorageRow('data_coverage_runs', {
    coverage_run_id: context.coverageRunId,
    sync_run_id: context.historySyncRunId,
    customer_key: context.customerKey,
    platform: context.platform,
    account_key: context.accountKey,
    dataset_key: context.datasetKey,
    metric_semantics: 'cumulative',
    scope_mode: context.scopeMode,
    period_start: context.metricDate,
    period_end: context.metricDate,
    source_timezone: context.sourceTimezone,
    status: input.status,
    expected_entities: input.expectedEntities,
    observed_entities: input.observedEntities,
    expected_rows: input.expectedRows,
    observed_rows: input.observedRows,
    written_rows: input.writtenRows,
    failed_rows: input.failedRows,
    source_watermark: input.sourceWatermark,
    revisable_until: null,
    started_at: context.observedAt,
    completed_at: input.completedAt,
    error_code: input.errorCode,
    created_at: context.observedAt,
    updated_at: input.updatedAt,
  });
}

function readContentIdentity(context, row) {
  const platform = requireText(row?.platform, 'content.platform');
  const accountKey = requireText(row?.account_id, 'content.account_id');
  const externalContentId = requireText(row?.external_content_id, 'content.external_content_id');
  if (platform !== context.platform || accountKey !== context.accountKey) {
    throw historyInputError('Organic history row identity does not match Runtime context', {
      platform,
      accountKey,
    });
  }
  const contentKey = createContentKey({
    platform,
    account_key: accountKey,
    external_content_id: externalContentId,
  });
  if (requireText(row?.content_key, 'content.content_key') !== contentKey) {
    throw historyInputError('Organic history Content Stable key mismatch', { contentKey });
  }
  return Object.freeze({ platform, accountKey, externalContentId, contentKey });
}

function indexDailyRows(context, rows) {
  const map = new Map();
  for (const row of rows) {
    const contentKey = createContentKey({
      platform: requireText(row?.platform, 'daily.platform'),
      account_key: requireText(row?.account_id, 'daily.account_id'),
      external_content_id: requireText(row?.external_content_id, 'daily.external_content_id'),
    });
    if (row.platform !== context.platform || row.account_id !== context.accountKey) {
      throw historyInputError('Organic Daily identity does not match Runtime context', { contentKey });
    }
    if (map.has(contentKey)) {
      throw historyInputError('Organic history batch contains duplicate Daily keys', { contentKey });
    }
    map.set(contentKey, row);
  }
  return map;
}

function assertDailyIdentity(context, row, identity) {
  const contentKey = createContentKey({
    platform: requireText(row?.platform, 'daily.platform'),
    account_key: requireText(row?.account_id, 'daily.account_id'),
    external_content_id: requireText(row?.external_content_id, 'daily.external_content_id'),
  });
  if (contentKey !== identity.contentKey || row.platform !== context.platform || row.account_id !== context.accountKey) {
    throw historyInputError('Organic Content/Daily identity mismatch', {
      contentKey: identity.contentKey,
      dailyContentKey: contentKey,
    });
  }
}

function readMetrics(contentRow, dailyRow) {
  return Object.freeze({
    views: optionalCount(dailyRow.views ?? contentRow.latest_views, 'views'),
    likes: optionalCount(dailyRow.likes ?? contentRow.latest_likes, 'likes'),
    comments: optionalCount(dailyRow.comments ?? contentRow.latest_comments, 'comments'),
    shares: optionalCount(dailyRow.shares ?? contentRow.latest_shares, 'shares'),
    unique_viewers: optionalCount(
      dailyRow.unique_viewers ?? contentRow.latest_unique_viewers,
      'unique_viewers',
    ),
    avg_watch_time_seconds: optionalNonNegativeNumber(
      dailyRow.avg_watch_time_seconds ?? contentRow.avg_watch_time_seconds,
      'avg_watch_time_seconds',
    ),
    total_watch_time_seconds: optionalNonNegativeNumber(
      dailyRow.total_watch_time_seconds,
      'total_watch_time_seconds',
    ),
    completion_rate: optionalRatio(
      dailyRow.completion_rate ?? contentRow.completion_rate,
      'completion_rate',
    ),
  });
}

function classifyObservation(existing, metrics, metricsHash) {
  if (!existing) return 'initial';
  if (existing.metrics_hash === metricsHash) return null;
  const correction = CUMULATIVE_COUNTER_FIELDS.some((field) => {
    const before = toNullableNumber(existing[field]);
    const after = metrics[field];
    return before !== null && after !== null && after < before;
  });
  return correction ? 'correction' : 'changed';
}

function dateOnlyInTimeZone(epochMs, timeZone) {
  let parts;
  try {
    parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).formatToParts(new Date(epochMs));
  } catch (cause) {
    throw new TypeError('sourceTimezone must be a valid IANA timezone', { cause });
  }
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function requireGateway(value) {
  const methods = [
    'listOrganicContentStatesByKeys',
    'readCoverageRun',
    'upsertOrganicContentState',
    'saveOrganicContentObservation',
    'saveCoverageRun',
    'saveCoverageEntities',
  ];
  for (const method of methods) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`Organic history writer requires gateway.${method}`);
    }
  }
  return value;
}

function requireRows(value, fieldName) {
  if (!Array.isArray(value)) throw historyInputError(`${fieldName} must be an array`);
  return value;
}

function requiredTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw historyInputError(`${fieldName} must be a supported epoch millisecond timestamp`);
  }
  return number;
}

function optionalTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requiredTimestamp(value, fieldName);
}

function optionalCount(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw historyInputError(`${fieldName} must be a non-negative safe integer`);
  }
  return number;
}

function optionalNonNegativeNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw historyInputError(`${fieldName} must be a non-negative finite number`);
  }
  return number;
}

function optionalRatio(value, fieldName) {
  const number = optionalNonNegativeNumber(value, fieldName);
  if (number !== null && number > 1) throw historyInputError(`${fieldName} must be between 0 and 1`);
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw historyInputError(`${fieldName} must be a non-negative safe integer`);
  }
  return number;
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw historyInputError(`${fieldName} is required`, { fieldName });
  }
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw historyInputError('Optional text value must be a string');
  return value.trim() || null;
}

function normalizeSqlText(value) {
  return value === null || value === undefined || value === '' ? null : String(value);
}

function historyInputError(message, details = {}) {
  return permanentError(message, {
    code: 'MKT_ORGANIC_HISTORY_INPUT_INVALID',
    details,
  });
}
