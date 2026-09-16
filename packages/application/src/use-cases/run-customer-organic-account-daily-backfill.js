import { D1MarketingHistoryStore } from '../../../connectors/src/d1-marketing-history-store.js';
import { D1OrganicHistoryGateway } from '../../../connectors/src/d1-organic-history-gateway.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import {
  buildTikTokPortfolioAccountDailyFact,
  projectOrganicAccountDailyFactToLark,
} from './organic-account-daily-projection.js';
import { validateStorageRow } from '../storage/marketing-history-contract.js';

const CUSTOMER_KEY = 'chemistry_k';
const YOUTUBE_CHANNEL_ID = 'UC1NVIjalyZhB2hqf3sl9GMA';
const TIMEZONE = 'Asia/Bangkok';

/** Exact Customer PROD D1 -> Lark Account Daily repair; never reads a provider or deletes data. */
export async function runCustomerOrganicAccountDailyBackfill(input = {}) {
  const db = requireMethods(input.db, ['prepare'], 'db');
  const repository = requireMethods(input.repository,
    ['listByFieldValues', 'prepareRows', 'prepareExistingRecords'], 'repository');
  const syncEngine = requireMethods(input.syncEngine, ['planByKey', 'executePlan'], 'syncEngine');
  const tableId = requireText(input.tableId, 'tableId');
  const execute = input.execute === true;
  const observedAt = requiredTimestamp(input.observedAt ?? Date.now(), 'observedAt');
  const store = input.store ?? new D1MarketingHistoryStore({ db });
  const gateway = input.gateway ?? new D1OrganicHistoryGateway({ db, store });

  const youtubeFacts = await readYouTubeFacts(db);
  if (youtubeFacts.length === 0) {
    throw invalid('Customer YouTube Account Daily facts are missing');
  }
  const aggregate = await gateway.readOrganicAccountSnapshotAggregate({
    customerKey: CUSTOMER_KEY,
    platform: 'tiktok',
    accountKey: CUSTOMER_KEY,
  });
  if (aggregate.row_count === 0) {
    throw invalid('Customer TikTok current-state partition is empty');
  }
  const latestObservedAt = requiredTimestamp(aggregate.max_observed_at, 'TikTok max_observed_at');
  if (latestObservedAt > observedAt) {
    throw invalid('TikTok current-state observation is newer than the repair run');
  }
  // The TikTok row is a current-state portfolio snapshot, not a YouTube reporting-day fact.
  const metricDate = dateOnlyInTimeZone(latestObservedAt, TIMEZONE);
  const sourceRevision = await createStableFingerprint({
    contract: 'customer-organic-account-daily-backfill-v1',
    metricDate,
    aggregate,
  });
  const tikTokCoverageRunId = `coverage:tiktok-account-backfill:${sourceRevision}`;
  const tikTokFact = buildTikTokPortfolioAccountDailyFact({
    aggregate,
    customerKey: CUSTOMER_KEY,
    accountKey: CUSTOMER_KEY,
    sourceAccountId: CUSTOMER_KEY,
    metricDate,
    sourceTimezone: TIMEZONE,
    coverageRunId: tikTokCoverageRunId,
    sourceRevision,
    fetchedAt: latestObservedAt,
    observedAt: latestObservedAt,
    syncRunId: `history:tiktok-account-backfill:${sourceRevision}`,
  });

  const rows = Object.freeze([
    ...youtubeFacts.map((fact) => projectOrganicAccountDailyFactToLark({
      fact,
      canonicalAccountKey: 'youtube:chemistry_k',
    })),
    projectOrganicAccountDailyFactToLark({
      fact: tikTokFact,
      canonicalAccountKey: 'tiktok:chemistry_k',
    }),
  ]);
  assertUnique(rows, 'account_daily_key');
  const plan = await syncEngine.planByKey({
    repository,
    tableId,
    keyField: 'account_daily_key',
    rows,
  });
  if (Number(plan?.duplicateInputRows ?? 0) !== 0) {
    throw invalid('Account Daily repair input contains duplicate stable keys');
  }
  if (!execute) {
    return Object.freeze({
      mode: 'preview',
      metricDate,
      source: Object.freeze({ youtubeFacts: youtubeFacts.length, tiktokPortfolioRows: aggregate.row_count }),
      plan: summarizePlan(plan),
      mutations: Object.freeze({ d1: 0, lark: 0 }),
    });
  }

  await assertSafeSourceBoundary(db, gateway, aggregate);
  const d1Write = await store.upsertOrganicAccountDailyFact(tikTokFact);
  const d1Readback = await db.prepare(`
    SELECT * FROM organic_account_daily_facts
    WHERE account_daily_key = ? AND customer_key = ? AND platform = 'tiktok'
  `).bind(tikTokFact.account_daily_key, CUSTOMER_KEY).first();
  if (!d1Readback || !sameFact(tikTokFact, validateStorageRow('organic_account_daily_facts', d1Readback))) {
    throw invalid('TikTok Account Daily D1 readback differs from the source projection');
  }
  await store.saveCoverageRun(validateStorageRow('data_coverage_runs', {
    coverage_run_id: tikTokCoverageRunId,
    sync_run_id: tikTokFact.sync_run_id,
    customer_key: CUSTOMER_KEY,
    platform: 'tiktok',
    account_key: CUSTOMER_KEY,
    dataset_key: 'organic_account_portfolio_snapshot',
    metric_semantics: 'snapshot',
    scope_mode: 'full_inventory',
    period_start: metricDate,
    period_end: metricDate,
    source_timezone: TIMEZONE,
    status: tikTokFact.data_status,
    expected_entities: aggregate.row_count,
    observed_entities: aggregate.row_count,
    expected_rows: 1,
    observed_rows: 1,
    written_rows: 1,
    failed_rows: 0,
    source_watermark: sourceRevision,
    revisable_until: null,
    started_at: observedAt,
    completed_at: observedAt,
    error_code: null,
    created_at: observedAt,
    updated_at: observedAt,
  }));
  await assertSafeSourceBoundary(db, gateway, aggregate);
  const write = await syncEngine.executePlan(plan);
  assertReconciled(write, rows.length, 'initial write');
  const readback = await readbackRows(repository, tableId, rows);

  const rerunPlan = await syncEngine.planByKey({
    repository,
    tableId,
    keyField: 'account_daily_key',
    rows,
  });
  if (rerunPlan.createRows.length !== 0 || rerunPlan.updateRows.length !== 0
    || Number(rerunPlan.skipped ?? 0) !== rows.length
    || Number(rerunPlan.duplicateInputRows ?? 0) !== 0) {
    throw invalid('Account Daily repair rerun is not idempotent');
  }

  return Object.freeze({
    mode: 'execute',
    metricDate,
    source: Object.freeze({ youtubeFacts: youtubeFacts.length, tiktokPortfolioRows: aggregate.row_count }),
    d1: Object.freeze({ tiktok: d1Write.status, readbackRows: 1 }),
    lark: Object.freeze({ ...normalizeWrite(write), readbackRows: readback, expectedRows: rows.length }),
    rerun: Object.freeze({ create: 0, update: 0, skipped: rows.length, duplicateInputRows: 0 }),
  });
}

async function assertSafeSourceBoundary(db, gateway, expectedAggregate) {
  const lock = await db.prepare(`
    SELECT COUNT(*) AS active_locks FROM sync_locks
    WHERE expires_at > unixepoch('now') * 1000
      AND (lock_key LIKE '%:youtube:%' OR lock_key LIKE '%:tiktok:%')
  `).first();
  if (Number(lock?.active_locks ?? 0) !== 0) {
    throw invalid('An Organic source sync holds an active production lock');
  }
  const current = await gateway.readOrganicAccountSnapshotAggregate({
    customerKey: CUSTOMER_KEY,
    platform: 'tiktok',
    accountKey: CUSTOMER_KEY,
  });
  if (JSON.stringify(current) !== JSON.stringify(expectedAggregate)) {
    throw invalid('TikTok current-state snapshot changed during Account Daily repair');
  }
}

async function readYouTubeFacts(db) {
  const result = await db.prepare(`
    SELECT * FROM organic_account_daily_facts
    WHERE customer_key = ?
      AND platform = 'youtube'
      AND account_key = ?
      AND source_account_id = ?
    ORDER BY metric_date ASC, account_daily_key ASC
  `).bind(CUSTOMER_KEY, CUSTOMER_KEY, YOUTUBE_CHANNEL_ID).all();
  const rows = Array.isArray(result) ? result : (result?.results ?? []);
  return Object.freeze(rows.map((row) => validateStorageRow('organic_account_daily_facts', row)));
}

async function readbackRows(repository, tableId, expectedRows) {
  const records = await repository.listByFieldValues(
    tableId,
    'account_daily_key',
    expectedRows.map((row) => row.account_daily_key),
  );
  const fieldNames = [...new Set(expectedRows.flatMap((row) => Object.keys(row)))];
  const normalized = await repository.prepareExistingRecords(tableId, records, {
    incomingFieldNames: fieldNames,
  });
  const expectedPrepared = await repository.prepareRows(tableId, expectedRows, {
    keyField: 'account_daily_key',
  });
  const byKey = new Map();
  for (const record of normalized) {
    const fields = record?.fields ?? {};
    const key = fields.account_daily_key;
    if (byKey.has(key)) throw invalid('Lark Account Daily readback contains duplicate stable keys');
    byKey.set(key, fields);
  }
  for (const expected of expectedPrepared) {
    const actual = byKey.get(expected.account_daily_key);
    if (!actual) throw invalid('Lark Account Daily readback is missing a stable key');
    for (const [field, value] of Object.entries(expected)) {
      if (actual[field] !== value) {
        throw invalid('Lark Account Daily readback differs from D1 projection', {
          stableKey: expected.account_daily_key,
          field,
        });
      }
    }
  }
  if (byKey.size !== expectedRows.length) {
    throw invalid('Lark Account Daily readback contains unexpected stable keys');
  }
  return byKey.size;
}

function summarizePlan(plan) {
  return Object.freeze({
    inputRows: Number(plan?.inputRows ?? 0),
    create: plan?.createRows?.length ?? 0,
    update: plan?.updateRows?.length ?? 0,
    skipped: Number(plan?.skipped ?? 0),
    duplicateInputRows: Number(plan?.duplicateInputRows ?? 0),
  });
}

function normalizeWrite(value) {
  return Object.freeze({
    created: nonNegative(value?.created),
    updated: nonNegative(value?.updated),
    skipped: nonNegative(value?.skipped),
    duplicateInputRows: nonNegative(value?.duplicateInputRows),
  });
}

function assertReconciled(value, expected, label) {
  const result = normalizeWrite(value);
  if (result.created + result.updated + result.skipped !== expected
    || result.duplicateInputRows !== 0) {
    throw invalid(`Account Daily ${label} did not reconcile`);
  }
}

function assertUnique(rows, field) {
  const values = new Set(rows.map((row) => row[field]));
  if (values.size !== rows.length) throw invalid(`Duplicate ${field} in repair projection`);
}

function sameFact(expected, actual) {
  return Object.entries(expected).every(([field, value]) => field === 'created_at' || actual[field] === value);
}

function dateOnlyInTimeZone(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(timestamp);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function nonNegative(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) throw invalid('Invalid write result');
  return number;
}

function requiredTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw invalid(`${fieldName} must be a supported timestamp`);
  }
  return number;
}

function requireMethods(value, methods, fieldName) {
  if (!value || typeof value !== 'object') throw invalid(`${fieldName} is required`);
  for (const method of methods) if (typeof value[method] !== 'function') throw invalid(`${fieldName}.${method} is required`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${fieldName} is required`);
  return value.trim();
}

function invalid(message, details = {}) {
  return permanentError(message, { code: 'CUSTOMER_ORGANIC_ACCOUNT_DAILY_BACKFILL_INVALID', details });
}
