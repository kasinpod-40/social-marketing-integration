import { buildTikTokAdsDailyWriteSet } from './tiktok-ads-daily-write-set.js';
import { validateStorageRow } from '../storage/marketing-history-contract.js';
import { permanentError, sanitizeOperationalError, transientError } from '../../../shared/src/errors/runtime-error.js';

const MAX_OPERATIONS_PER_BATCH = 100;
const LEASE_MS = 120_000;

/** D1-only วันเดียว: อ่าน Source ให้ครบก่อนเขียน และปิด Coverage หลัง readback เท่านั้น */
export async function runTikTokAdsDailyD1Sync(input = {}) {
  const client = requireMethod(input.client, 'listCampaignDailyReport');
  const historyStore = requireMethod(input.historyStore, 'writeMetaD1Operations');
  const lockStore = requireMethod(input.lockStore, 'acquire');
  requireMethod(input.lockStore, 'renew');
  requireMethod(input.lockStore, 'release');
  requireMethod(input.lockStore, 'saveSyncRun');
  const db = input.db;
  if (!db?.prepare) throw new TypeError('db is required');
  if (input.businessWriteEnabled !== true) {
    throw permanentError('TikTok Ads D1 write gate is disabled', { code: 'TIKTOK_ADS_D1_WRITE_DISABLED' });
  }
  const date = input.date;
  const accountKey = input.accountKey;
  const lockKey = `tiktok_ads:campaign_daily:${accountKey}:${date}`;
  const ownerId = crypto.randomUUID();
  const lease = await lockStore.acquire({ lockKey, ownerId, leaseMs: LEASE_MS });
  if (!lease.acquired) {
    throw transientError('TikTok Ads daily sync is already running', {
      code: 'TIKTOK_ADS_DAILY_SYNC_LOCKED',
    });
  }
  const startedAt = Date.now();
  const runEntry = {
    syncId: input.syncRunId,
    customerProfile: 'chemistry_k',
    platform: 'tiktok_ads',
    accountKey,
    source: 'tiktok_ads.report.integrated',
    syncType: 'daily_d1_only',
    startedAt,
  };
  try {
    await lockStore.saveSyncRun({ ...runEntry, status: 'running' });
    const source = await client.listCampaignDailyReport({
      accessToken: input.accessToken,
      advertiserId: input.advertiserId,
      date,
    });
    const now = Date.now();
    const writeSet = await buildTikTokAdsDailyWriteSet({
      ...input,
      rows: source.rows,
      now,
    });
    if (source.totalCount !== writeSet.dailyFacts.length) {
      throw transientError('TikTok Ads source count did not match normalized facts', {
        code: 'TIKTOK_ADS_DAILY_SOURCE_COUNT_MISMATCH',
      });
    }
    const entityConflict = await db.prepare(`
      SELECT entity_key FROM ads_entity_state
      WHERE platform = 'tiktok_ads' AND account_key = ?
        AND (customer_key <> ? OR source_account_id <> ?)
      LIMIT 1
    `).bind(accountKey, input.customerKey, input.advertiserId).first();
    if (entityConflict) {
      throw permanentError('TikTok Ads account has a different stored advertiser identity', {
        code: 'TIKTOK_ADS_DAILY_ACCOUNT_IDENTITY_CONFLICT',
      });
    }
    const existing = await db.prepare(`
      SELECT ads_fact_key, customer_key, source_account_id FROM ads_daily_facts
      WHERE platform = 'tiktok_ads' AND account_key = ? AND metric_date = ?
      LIMIT 501
    `).bind(accountKey, date).all();
    const currentRows = existing?.results ?? [];
    const sourceKeys = new Set(writeSet.dailyFacts.map((row) => row.ads_fact_key));
    if (currentRows.length > 500 || currentRows.some((row) =>
      row.customer_key !== input.customerKey || row.source_account_id !== input.advertiserId
      || !sourceKeys.has(row.ads_fact_key))) {
      throw permanentError('TikTok Ads source is missing previously stored campaign-day facts', {
        code: 'TIKTOK_ADS_DAILY_RECONCILIATION_CONFLICT',
      });
    }

    const operations = [];
    for (let index = 0; index < writeSet.dailyFacts.length; index += 1) {
      operations.push({ kind: 'ads_entity', row: writeSet.entities[index] });
      operations.push({ kind: 'ads_daily', row: writeSet.dailyFacts[index] });
    }
    let written = 0;
    for (let offset = 0; offset < operations.length; offset += MAX_OPERATIONS_PER_BATCH) {
      const renewed = await lockStore.renew({ lockKey, ownerId, leaseMs: LEASE_MS });
      if (!renewed.renewed) {
        throw transientError('TikTok Ads daily sync lease expired', {
          code: 'TIKTOK_ADS_DAILY_SYNC_LEASE_LOST',
        });
      }
      const results = await historyStore.writeMetaD1Operations(
        operations.slice(offset, offset + MAX_OPERATIONS_PER_BATCH),
      );
      written += results.filter((result) => result.table === 'ads_daily_facts'
        && result.status !== 'skipped').length;
    }

    const readback = await db.prepare(`
      SELECT ads_fact_key, source_payload_hash FROM ads_daily_facts
      WHERE customer_key = ? AND platform = 'tiktok_ads' AND account_key = ?
        AND source_account_id = ? AND metric_date = ?
      LIMIT 501
    `).bind(input.customerKey, accountKey, input.advertiserId, date).all();
    const byKey = new Map((readback?.results ?? []).map((row) => [row.ads_fact_key, row]));
    if (byKey.size !== writeSet.dailyFacts.length || writeSet.dailyFacts.some((row) =>
      byKey.get(row.ads_fact_key)?.source_payload_hash !== row.source_payload_hash)) {
      throw transientError('TikTok Ads daily D1 readback did not reconcile', {
        code: 'TIKTOK_ADS_DAILY_READBACK_MISMATCH',
      });
    }

    const coverage = validateStorageRow('data_coverage_runs', {
      coverage_run_id: writeSet.coverageRunId,
      sync_run_id: input.syncRunId,
      customer_key: input.customerKey,
      platform: 'tiktok_ads',
      account_key: accountKey,
      dataset_key: 'ads_daily_facts',
      metric_semantics: 'period',
      scope_mode: 'report_range',
      period_start: date,
      period_end: date,
      source_timezone: input.timezone,
      status: byKey.size === 0 ? 'no_data_confirmed' : 'revisable',
      expected_entities: writeSet.dailyFacts.length,
      observed_entities: byKey.size,
      expected_rows: writeSet.dailyFacts.length,
      observed_rows: byKey.size,
      written_rows: written,
      failed_rows: 0,
      source_watermark: writeSet.sourceWatermark,
      revisable_until: null,
      started_at: now,
      completed_at: Date.now(),
      error_code: null,
      created_at: now,
      updated_at: Date.now(),
    });
    await historyStore.writeMetaD1Operations([{ kind: 'coverage_run', row: coverage }]);
    await lockStore.saveSyncRun({
      ...runEntry,
      status: 'success',
      finishedAt: Date.now(),
      recordsPulled: source.totalCount,
      recordsWritten: written,
      recordsSkipped: source.totalCount - written,
    });
    return Object.freeze({ status: coverage.status, date, rows: byKey.size, written });
  } catch (error) {
    const operational = sanitizeOperationalError(error);
    await lockStore.saveSyncRun({
      ...runEntry,
      status: 'failed',
      finishedAt: Date.now(),
      errorCode: operational.code,
      errorMessage: operational.message,
    });
    throw error;
  } finally {
    await lockStore.release({ lockKey, ownerId });
  }
}

function requireMethod(value, method) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`${method} is required`);
  return value;
}
