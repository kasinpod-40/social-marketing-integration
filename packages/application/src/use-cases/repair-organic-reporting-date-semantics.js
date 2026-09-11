import { createDailySnapshotKey } from '../../../domain/src/value-objects/content-identity.js';
import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';

export const ORGANIC_REPORTING_DATE_REPAIR_VERSION = 'organic-reporting-date-repair-v1';

const CUSTOMER_KEY = 'chemistry_k';
const ACCOUNT_KEY = 'chemistry_k';
const YOUTUBE_RUN_ID =
  'history:youtube:f04ed8d2d644bd5de24b0a8f0298687be97f2be6a395fef2f9e87d774db6da66';
const YOUTUBE_WRONG_DATE = '2026-09-11';
const YOUTUBE_TARGET_DATE = '2026-09-10';
const YOUTUBE_EXPECTED_ROWS = 50;
const SOURCE_TIMEZONE = 'Asia/Bangkok';

/**
 * One-time Customer PROD repair for the reporting-date contract deployed on 2026-09-11.
 * It preserves every D1 observation, merges Lark rows by stable key, and touches one TikTok
 * account freshness field only. The exact historical sync identity makes reruns idempotent.
 */
export async function repairOrganicReportingDateSemantics(input = {}) {
  const execute = input.execute === true;
  const db = requireDb(input.db);
  const client = requireClient(input.client);
  const repository = requireRepository(input.repository);
  const syncEngine = requireSyncEngine(input.syncEngine);
  const tables = requireTables(input.tables);

  await assertNoActiveLocks(db);
  const authority = await readD1Authority(db);
  const youtubePlan = await planYouTubeLarkRepair({
    client,
    tableId: tables.mktContentDaily,
    observations: authority.observations,
  });
  const tiktokPlan = await planTikTokAccountRepair({
    client,
    tableId: tables.mktAccounts,
    lastSyncAt: authority.tiktokLastSyncAt,
  });

  if (!execute) return freezeResult({ mode: 'preview', authority, youtubePlan, tiktokPlan });

  await assertNoActiveLocks(db);
  const youtubeSyncPlan = await syncEngine.planByKey({
    repository,
    tableId: tables.mktContentDaily,
    keyField: 'content_daily_key',
    rows: youtubePlan.desiredRows,
  });
  const youtubeWrite = await syncEngine.executePlan(youtubeSyncPlan);
  await assertYouTubeLarkReadback({ client, tableId: tables.mktContentDaily, authority });

  const staleRecordIds = await readExactStaleYouTubeRecordIds({
    client,
    tableId: tables.mktContentDaily,
    observations: authority.observations,
  });
  const youtubeDelete = staleRecordIds.length === 0
    ? { deleted: 0 }
    : await client.batchDeleteRecords({ tableId: tables.mktContentDaily, recordIds: staleRecordIds });
  await assertYouTubeLarkReadback({
    client,
    tableId: tables.mktContentDaily,
    authority,
    requireStaleAbsent: true,
  });

  await assertNoActiveLocks(db);
  const d1Write = await applyD1Repair(db);
  await assertD1Readback(db);

  const tiktokSyncPlan = await syncEngine.planByKey({
    repository,
    tableId: tables.mktAccounts,
    keyField: 'account_key',
    rows: [tiktokPlan.desiredRow],
  });
  const tiktokWrite = await syncEngine.executePlan(tiktokSyncPlan);
  await assertTikTokAccountReadback({
    client,
    tableId: tables.mktAccounts,
    lastSyncAt: authority.tiktokLastSyncAt,
  });

  return freezeResult({
    mode: 'execute',
    authority,
    youtubePlan,
    tiktokPlan,
    youtubeWrite,
    youtubeDelete,
    d1Write,
    tiktokWrite,
  });
}

async function readD1Authority(db) {
  const observations = await all(db, `
    SELECT observation_key, content_key, external_content_id, metric_date, observed_at,
           views, likes, comments, shares, unique_viewers, avg_watch_time_seconds,
           total_watch_time_seconds, completion_rate, sync_run_id
    FROM organic_content_observations
    WHERE customer_key = ? AND platform = 'youtube' AND account_key = ? AND sync_run_id = ?
    ORDER BY external_content_id ASC
  `, [CUSTOMER_KEY, ACCOUNT_KEY, YOUTUBE_RUN_ID]);
  if (observations.length !== YOUTUBE_EXPECTED_ROWS
    || observations.some((row) => ![YOUTUBE_WRONG_DATE, YOUTUBE_TARGET_DATE].includes(row.metric_date))) {
    throw repairError('Exact YouTube D1 observation authority is not the reviewed 50-row set',
      'ORGANIC_DATE_REPAIR_D1_AUTHORITY_INVALID', { rows: observations.length });
  }
  const identityCount = new Set(observations.map((row) => row.external_content_id)).size;
  if (identityCount !== YOUTUBE_EXPECTED_ROWS) {
    throw repairError('Exact YouTube D1 observation identities are not unique',
      'ORGANIC_DATE_REPAIR_D1_IDENTITY_INVALID', { rows: identityCount });
  }

  const coverage = await all(db, `
    SELECT coverage_run_id, dataset_key, period_start, period_end, status
    FROM data_coverage_runs
    WHERE customer_key = ? AND platform = 'youtube' AND account_key = ? AND sync_run_id = ?
    ORDER BY dataset_key ASC
  `, [CUSTOMER_KEY, ACCOUNT_KEY, YOUTUBE_RUN_ID]);
  const expectedDatasets = ['organic_account_snapshot', 'organic_content_cumulative'];
  if (coverage.length !== 2
    || coverage.some((row, index) => row.dataset_key !== expectedDatasets[index]
      || row.status !== 'complete'
      || ![YOUTUBE_WRONG_DATE, YOUTUBE_TARGET_DATE].includes(row.period_start)
      || ![YOUTUBE_WRONG_DATE, YOUTUBE_TARGET_DATE].includes(row.period_end))) {
    throw repairError('Exact YouTube coverage authority is invalid',
      'ORGANIC_DATE_REPAIR_COVERAGE_AUTHORITY_INVALID', { rows: coverage.length });
  }

  const accountFacts = await all(db, `
    SELECT account_daily_key, metric_date, sync_run_id
    FROM organic_account_daily_facts
    WHERE customer_key = ? AND platform = 'youtube' AND account_key = ? AND sync_run_id = ?
  `, [CUSTOMER_KEY, ACCOUNT_KEY, YOUTUBE_RUN_ID]);
  if (accountFacts.length !== 1
    || ![YOUTUBE_WRONG_DATE, YOUTUBE_TARGET_DATE].includes(accountFacts[0].metric_date)) {
    throw repairError('Exact YouTube account daily authority is invalid',
      'ORGANIC_DATE_REPAIR_ACCOUNT_DAILY_AUTHORITY_INVALID', { rows: accountFacts.length });
  }

  const tiktokRows = await all(db, `
    SELECT sync_run_id, finished_at
    FROM sync_runs
    WHERE platform = 'tiktok' AND status = 'success'
      AND sync_run_id LIKE 'tiktok-post-lark:%'
    ORDER BY finished_at DESC
    LIMIT 1
  `);
  const tiktokLastSyncAt = integer(tiktokRows[0]?.finished_at, 'tiktok finished_at');
  const targetStart = dateOnlyInTimeZoneToEpochMilliseconds(
    YOUTUBE_WRONG_DATE,
    SOURCE_TIMEZONE,
    { label: 'TikTok freshness date' },
  );
  if (tiktokLastSyncAt < targetStart) {
    throw repairError('TikTok post-Lark success is not fresh enough',
      'ORGANIC_DATE_REPAIR_TIKTOK_AUTHORITY_INVALID');
  }
  return Object.freeze({ observations, coverage, accountFacts, tiktokLastSyncAt });
}

async function planYouTubeLarkRepair({ client, tableId, observations }) {
  const sourceKeys = observations.map((row) => dailyKey(row.external_content_id, YOUTUBE_WRONG_DATE));
  const targetKeys = observations.map((row) => dailyKey(row.external_content_id, YOUTUBE_TARGET_DATE));
  const records = await client.searchRecordsByFieldValues({
    tableId,
    fieldName: 'content_daily_key',
    values: [...sourceKeys, ...targetKeys],
  });
  const byKey = uniqueRecordIndex(records, 'content_daily_key');
  const metricDate = dateOnlyInTimeZoneToEpochMilliseconds(
    YOUTUBE_TARGET_DATE,
    SOURCE_TIMEZONE,
    { label: 'YouTube target metric date' },
  );
  const desiredRows = observations.map((row) => {
    const source = byKey.get(dailyKey(row.external_content_id, YOUTUBE_WRONG_DATE));
    const target = byKey.get(dailyKey(row.external_content_id, YOUTUBE_TARGET_DATE));
    const template = source ?? target;
    if (!template || !matchesD1Identity(template.fields, row)) {
      throw repairError('YouTube Lark row is missing or does not match exact D1 identity',
        'ORGANIC_DATE_REPAIR_LARK_AUTHORITY_INVALID');
    }
    return Object.freeze({
      ...template.fields,
      content_daily_key: dailyKey(row.external_content_id, YOUTUBE_TARGET_DATE),
      metric_date: metricDate,
      platform: 'youtube',
      account_id: ACCOUNT_KEY,
      external_content_id: row.external_content_id,
      views: row.views,
      likes: row.likes,
      comments: row.comments,
      shares: row.shares,
      unique_viewers: row.unique_viewers,
      avg_watch_time_seconds: row.avg_watch_time_seconds,
      total_watch_time_seconds: row.total_watch_time_seconds,
      completion_rate: row.completion_rate,
    });
  });
  const staleRows = sourceKeys.filter((key) => byKey.has(key)).length;
  const existingTargets = targetKeys.filter((key) => byKey.has(key)).length;
  return Object.freeze({ desiredRows, rows: desiredRows.length, staleRows, existingTargets });
}

async function planTikTokAccountRepair({ client, tableId, lastSyncAt }) {
  const records = await client.searchRecordsByFieldValues({
    tableId,
    fieldName: 'account_key',
    values: ['tiktok:chemistry_k'],
  });
  if (records.length !== 1 || text(records[0].fields?.platform) !== 'tiktok') {
    throw repairError('Exact TikTok Lark account row is missing or ambiguous',
      'ORGANIC_DATE_REPAIR_TIKTOK_LARK_AUTHORITY_INVALID', { rows: records.length });
  }
  return Object.freeze({
    currentLastSyncAt: Number(records[0].fields?.last_sync_at ?? 0),
    targetLastSyncAt: lastSyncAt,
    desiredRow: Object.freeze({ ...records[0].fields, last_sync_at: lastSyncAt }),
  });
}

async function assertYouTubeLarkReadback({
  client,
  tableId,
  authority,
  requireStaleAbsent = false,
}) {
  const targetKeys = authority.observations.map((row) => dailyKey(row.external_content_id, YOUTUBE_TARGET_DATE));
  const sourceKeys = authority.observations.map((row) => dailyKey(row.external_content_id, YOUTUBE_WRONG_DATE));
  const records = await client.searchRecordsByFieldValues({
    tableId,
    fieldName: 'content_daily_key',
    values: requireStaleAbsent ? [...targetKeys, ...sourceKeys] : targetKeys,
  });
  const byKey = uniqueRecordIndex(records, 'content_daily_key');
  for (const row of authority.observations) {
    const record = byKey.get(dailyKey(row.external_content_id, YOUTUBE_TARGET_DATE));
    if (!record || !matchesD1Metrics(record.fields, row)) {
      throw repairError('YouTube Lark readback does not match the exact D1 observation',
        'ORGANIC_DATE_REPAIR_LARK_READBACK_FAILED');
    }
  }
  if (requireStaleAbsent && sourceKeys.some((key) => byKey.has(key))) {
    throw repairError('A stale YouTube reporting-date key remains in Lark',
      'ORGANIC_DATE_REPAIR_STALE_LARK_ROW_REMAINS');
  }
}

async function readExactStaleYouTubeRecordIds({ client, tableId, observations }) {
  const records = await client.searchRecordsByFieldValues({
    tableId,
    fieldName: 'content_daily_key',
    values: observations.map((row) => dailyKey(row.external_content_id, YOUTUBE_WRONG_DATE)),
  });
  if (records.some((record) => text(record.fields?.platform) !== 'youtube'
    || text(record.fields?.account_id) !== ACCOUNT_KEY)) {
    throw repairError('Stale YouTube delete scope contains a foreign identity',
      'ORGANIC_DATE_REPAIR_DELETE_SCOPE_INVALID');
  }
  return records.map((record) => requiredText(record.recordId, 'recordId'));
}

async function applyD1Repair(db) {
  const sourceAccountKey = `youtube:${ACCOUNT_KEY}:${YOUTUBE_WRONG_DATE}`;
  const targetAccountKey = `youtube:${ACCOUNT_KEY}:${YOUTUBE_TARGET_DATE}`;
  const statements = [
    db.prepare(`
      UPDATE organic_content_observations SET metric_date = ?
      WHERE customer_key = ? AND platform = 'youtube' AND account_key = ?
        AND sync_run_id = ? AND metric_date = ?
    `).bind(YOUTUBE_TARGET_DATE, CUSTOMER_KEY, ACCOUNT_KEY, YOUTUBE_RUN_ID, YOUTUBE_WRONG_DATE),
    db.prepare(`
      UPDATE organic_account_daily_facts AS target SET
        source_account_id = (SELECT source_account_id FROM organic_account_daily_facts WHERE account_daily_key = ?),
        followers = (SELECT followers FROM organic_account_daily_facts WHERE account_daily_key = ?),
        views = (SELECT views FROM organic_account_daily_facts WHERE account_daily_key = ?),
        data_status = (SELECT data_status FROM organic_account_daily_facts WHERE account_daily_key = ?),
        coverage_run_id = (SELECT coverage_run_id FROM organic_account_daily_facts WHERE account_daily_key = ?),
        source_revision = (SELECT source_revision FROM organic_account_daily_facts WHERE account_daily_key = ?),
        fetched_at = (SELECT fetched_at FROM organic_account_daily_facts WHERE account_daily_key = ?),
        sync_run_id = (SELECT sync_run_id FROM organic_account_daily_facts WHERE account_daily_key = ?),
        updated_at = (SELECT updated_at FROM organic_account_daily_facts WHERE account_daily_key = ?)
      WHERE target.account_daily_key = ?
        AND EXISTS (SELECT 1 FROM organic_account_daily_facts WHERE account_daily_key = ?)
    `).bind(
      sourceAccountKey, sourceAccountKey, sourceAccountKey, sourceAccountKey, sourceAccountKey,
      sourceAccountKey, sourceAccountKey, sourceAccountKey, sourceAccountKey,
      targetAccountKey, sourceAccountKey,
    ),
    db.prepare(`DELETE FROM organic_account_daily_facts WHERE account_daily_key = ?`).bind(sourceAccountKey),
    db.prepare(`
      UPDATE data_coverage_runs SET period_start = ?, period_end = ?, updated_at = MAX(updated_at, completed_at)
      WHERE customer_key = ? AND platform = 'youtube' AND account_key = ?
        AND sync_run_id = ? AND period_start = ? AND period_end = ?
    `).bind(
      YOUTUBE_TARGET_DATE,
      YOUTUBE_TARGET_DATE,
      CUSTOMER_KEY,
      ACCOUNT_KEY,
      YOUTUBE_RUN_ID,
      YOUTUBE_WRONG_DATE,
      YOUTUBE_WRONG_DATE,
    ),
  ];
  const results = await db.batch(statements);
  return Object.freeze({ changes: results.map(readChanges) });
}

async function assertD1Readback(db) {
  const observations = await all(db, `
    SELECT metric_date, COUNT(*) AS rows
    FROM organic_content_observations
    WHERE customer_key = ? AND platform = 'youtube' AND account_key = ? AND sync_run_id = ?
    GROUP BY metric_date
  `, [CUSTOMER_KEY, ACCOUNT_KEY, YOUTUBE_RUN_ID]);
  const account = await all(db, `
    SELECT account_daily_key, metric_date
    FROM organic_account_daily_facts
    WHERE customer_key = ? AND platform = 'youtube' AND account_key = ? AND sync_run_id = ?
  `, [CUSTOMER_KEY, ACCOUNT_KEY, YOUTUBE_RUN_ID]);
  const coverage = await all(db, `
    SELECT period_start, period_end
    FROM data_coverage_runs
    WHERE customer_key = ? AND platform = 'youtube' AND account_key = ? AND sync_run_id = ?
  `, [CUSTOMER_KEY, ACCOUNT_KEY, YOUTUBE_RUN_ID]);
  if (observations.length !== 1 || observations[0].metric_date !== YOUTUBE_TARGET_DATE
    || Number(observations[0].rows) !== YOUTUBE_EXPECTED_ROWS
    || account.length !== 1 || account[0].metric_date !== YOUTUBE_TARGET_DATE
    || coverage.length !== 2
    || coverage.some((row) => row.period_start !== YOUTUBE_TARGET_DATE
      || row.period_end !== YOUTUBE_TARGET_DATE)) {
    throw repairError('D1 reporting-date repair readback failed',
      'ORGANIC_DATE_REPAIR_D1_READBACK_FAILED');
  }
}

async function assertTikTokAccountReadback({ client, tableId, lastSyncAt }) {
  const records = await client.searchRecordsByFieldValues({
    tableId,
    fieldName: 'account_key',
    values: ['tiktok:chemistry_k'],
  });
  if (records.length !== 1 || Number(records[0].fields?.last_sync_at) !== lastSyncAt) {
    throw repairError('TikTok account freshness readback failed',
      'ORGANIC_DATE_REPAIR_TIKTOK_READBACK_FAILED');
  }
}

async function assertNoActiveLocks(db) {
  const rows = await all(db, 'SELECT COUNT(*) AS count FROM sync_locks WHERE expires_at > unixepoch()*1000');
  if (Number(rows[0]?.count ?? -1) !== 0) {
    throw repairError('An active Production sync lock blocks the exact repair',
      'ORGANIC_DATE_REPAIR_ACTIVE_LOCK');
  }
}

function dailyKey(externalContentId, metricDate) {
  return createDailySnapshotKey({
    platform: 'youtube',
    accountId: ACCOUNT_KEY,
    entityId: requiredText(externalContentId, 'externalContentId'),
    metricDate,
  });
}

function uniqueRecordIndex(records, fieldName) {
  const index = new Map();
  for (const record of records) {
    const key = text(record.fields?.[fieldName]);
    if (!key || index.has(key)) {
      throw repairError('Lark stable key readback is missing or duplicated',
        'ORGANIC_DATE_REPAIR_LARK_DUPLICATE_KEY');
    }
    index.set(key, record);
  }
  return index;
}

function matchesD1Identity(fields, row) {
  return text(fields?.platform) === 'youtube'
    && text(fields?.account_id) === ACCOUNT_KEY
    && text(fields?.external_content_id) === row.external_content_id;
}

function matchesD1Metrics(fields, row) {
  if (!matchesD1Identity(fields, row)) return false;
  const targetMetricDate = dateOnlyInTimeZoneToEpochMilliseconds(
    YOUTUBE_TARGET_DATE,
    SOURCE_TIMEZONE,
    { label: 'YouTube readback metric date' },
  );
  if (Number(fields?.metric_date) !== targetMetricDate) return false;
  for (const name of [
    'views', 'likes', 'comments', 'shares', 'unique_viewers',
    'avg_watch_time_seconds', 'total_watch_time_seconds', 'completion_rate',
  ]) {
    if (!sameNullableNumber(fields?.[name], row?.[name])) return false;
  }
  return true;
}

function sameNullableNumber(left, right) {
  if ((left === null || left === undefined || left === '')
    && (right === null || right === undefined || right === '')) return true;
  return Number(left) === Number(right);
}

async function all(db, sql, values = []) {
  const result = await db.prepare(sql).bind(...values).all();
  if (result?.success === false || !Array.isArray(result?.results)) {
    throw repairError('D1 read failed', 'ORGANIC_DATE_REPAIR_D1_READ_FAILED');
  }
  return result.results;
}

function readChanges(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function freezeResult(input) {
  return Object.freeze({
    status: 'completed',
    contractVersion: ORGANIC_REPORTING_DATE_REPAIR_VERSION,
    mode: input.mode,
    youtube: Object.freeze({
      exactRows: input.authority.observations.length,
      sourceDate: YOUTUBE_WRONG_DATE,
      targetDate: YOUTUBE_TARGET_DATE,
      staleRowsBefore: input.youtubePlan.staleRows,
      existingTargetsBefore: input.youtubePlan.existingTargets,
      larkWrite: input.youtubeWrite ?? null,
      larkDelete: input.youtubeDelete ?? null,
      d1Write: input.d1Write ?? null,
    }),
    tiktok: Object.freeze({
      currentLastSyncAt: input.tiktokPlan.currentLastSyncAt,
      targetLastSyncAt: input.tiktokPlan.targetLastSyncAt,
      larkWrite: input.tiktokWrite ?? null,
    }),
    safety: Object.freeze({
      d1ObservationDeletes: 0,
      providerReads: 0,
      queueMessages: 0,
      unrelatedTables: 0,
    }),
  });
}

function requireDb(value) {
  if (!value || typeof value.prepare !== 'function' || typeof value.batch !== 'function') {
    throw new TypeError('Organic date repair requires D1 prepare/batch');
  }
  return value;
}
function requireClient(value) {
  if (!value || typeof value.searchRecordsByFieldValues !== 'function'
    || typeof value.batchDeleteRecords !== 'function') {
    throw new TypeError('Organic date repair requires exact Lark search/delete');
  }
  return value;
}
function requireRepository(value) {
  if (!value || typeof value.prepareRows !== 'function') throw new TypeError('Organic date repair requires repository');
  return value;
}
function requireSyncEngine(value) {
  if (!value || typeof value.planByKey !== 'function' || typeof value.executePlan !== 'function') {
    throw new TypeError('Organic date repair requires syncEngine');
  }
  return value;
}
function requireTables(value) {
  return Object.freeze({
    mktAccounts: requiredText(value?.mktAccounts, 'tables.mktAccounts'),
    mktContentDaily: requiredText(value?.mktContentDaily, 'tables.mktContentDaily'),
  });
}
function requiredText(value, label) {
  const normalized = text(value);
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}
function text(value) {
  if (typeof value === 'string') return value.trim();
  if (value && typeof value === 'object') return text(value.text ?? value.name ?? value.value);
  return value === null || value === undefined ? '' : String(value).trim();
}
function integer(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${label} must be a positive integer`);
  return number;
}
function repairError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
