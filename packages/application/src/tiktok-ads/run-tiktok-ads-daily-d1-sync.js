import { assertMktAdsMaintenanceIdle } from '../use-cases/mkt-ads-post-sync-maintenance.js';
import { loadTikTokAdsDailyMasters } from './prove-tiktok-ads-daily-grains.js';
import { buildTikTokAdsDailyWriteSet } from './tiktok-ads-daily-write-set.js';
import { validateStorageRow } from '../storage/marketing-history-contract.js';
import { permanentError, sanitizeOperationalError, transientError } from '../../../shared/src/errors/runtime-error.js';

const MAX_OPERATIONS_PER_BATCH = 100;
const LEASE_MS = 120_000;

/** D1-only วันเดียว: อ่าน Source ให้ครบก่อนเขียน และปิด Coverage หลัง readback เท่านั้น */
export async function runTikTokAdsDailyD1Sync(input = {}) {
  const grain = input.grain ?? 'campaign';
  if (!['campaign', 'ad'].includes(grain) || (grain === 'ad' && input.allStatuses !== true)) throw new TypeError('Unsupported TikTok daily grain');
  const maxRows = grain === 'ad' ? 10000 : 500;
  const client = requireMethod(input.client, input.allStatuses ? 'listAllStatusDailyReport' : 'listCampaignDailyReport');
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
  if (input.allStatuses && input.multiGrainWriteEnabled !== true) {
    throw permanentError('TikTok multi-grain gate is disabled', { code: 'TIKTOK_ADS_MULTI_GRAIN_WRITE_DISABLED' });
  }
  if (input.allStatuses) await assertMktAdsMaintenanceIdle({ db, now: Date.now() });
  const date = input.date;
  const accountKey = input.accountKey;
  const lockKey = `tiktok_ads:${grain}_daily:${accountKey}:${date}`;
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
    syncType: `${grain}_daily_d1_only`,
    startedAt,
  };
  try {
    await lockStore.saveSyncRun({ ...runEntry, status: 'running' });
    const source = await client[input.allStatuses ? 'listAllStatusDailyReport' : 'listCampaignDailyReport']({
      grain,
      accessToken: input.accessToken,
      advertiserId: input.advertiserId,
      date,
    });
    const parents = input.allStatuses ? await loadTikTokAdsDailyMasters(input) : undefined;
    const now = Date.now();
    const writeSet = await buildTikTokAdsDailyWriteSet({
      ...input, grain, parents,
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
      WHERE platform = 'tiktok_ads' AND account_key = ? AND metric_date = ? AND report_level = ?
      LIMIT ?
    `).bind(accountKey, date, grain, maxRows + 1).all();
    const currentRows = existing?.results ?? [];
    const sourceKeys = new Set(writeSet.dailyFacts.map((row) => row.ads_fact_key));
    if (currentRows.length > maxRows || currentRows.some((row) =>
      row.customer_key !== input.customerKey || row.source_account_id !== input.advertiserId
      || !sourceKeys.has(row.ads_fact_key))) {
      throw permanentError('TikTok Ads source is missing previously stored campaign-day facts', {
        code: 'TIKTOK_ADS_DAILY_RECONCILIATION_CONFLICT',
      });
    }

    const operations = [];
    for (let index = 0; index < writeSet.dailyFacts.length; index += 1) {
      if (writeSet.entities[index]) operations.push({ kind: 'ads_entity', row: writeSet.entities[index] });
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

    const readback = await readTikTokAdsDailyReadback({ ...input, grain }, writeSet);
    if (!readback.reconciled) {
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
      dataset_key: grain === 'ad' ? 'ads_daily_facts_ad' : 'ads_daily_facts',
      metric_semantics: 'period',
      scope_mode: 'report_range',
      period_start: date,
      period_end: date,
      source_timezone: input.timezone,
      status: readback.rows === 0 ? 'no_data_confirmed' : 'revisable',
      expected_entities: writeSet.dailyFacts.length,
      observed_entities: readback.rows,
      expected_rows: writeSet.dailyFacts.length,
      observed_rows: readback.rows,
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
    if (!(await lockStore.renew({ lockKey, ownerId, leaseMs: LEASE_MS })).renewed) {
      throw transientError('TikTok daily coverage lease expired', { code: 'TIKTOK_ADS_DAILY_SYNC_LEASE_LOST' });
    }
    await historyStore.writeMetaD1Operations([{ kind: 'coverage_run', row: coverage }]);
    await lockStore.saveSyncRun({
      ...runEntry,
      status: 'success',
      finishedAt: Date.now(),
      recordsPulled: source.totalCount,
      recordsWritten: written,
      recordsSkipped: source.totalCount - written,
    });
    return Object.freeze({ status: coverage.status, date, rows: readback.rows, written });
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


/** เปรียบเทียบทุก business field จาก Source write set กับ D1; คืนเฉพาะ counts/flags */
export async function readTikTokAdsDailyReadback(input, writeSet) {
  const grain = input.grain ?? 'campaign';
  const maxRows = grain === 'ad' ? 10000 : 500;
  const response = await input.db.prepare(`SELECT * FROM ads_daily_facts
    WHERE customer_key = ? AND platform = 'tiktok_ads' AND account_key = ?
      AND source_account_id = ? AND metric_date = ? AND report_level = ? LIMIT ?`)
    .bind(input.customerKey, input.accountKey, input.advertiserId, input.date, grain, maxRows + 1).all();
  const rows = response?.results ?? [];
  const byKey = new Map(rows.map(row => [row.ads_fact_key, row]));
  const fields = ['customer_key', 'source_account_id', 'report_level', 'entity_type', 'external_entity_id',
    'external_campaign_id', 'external_ad_group_id', 'external_ad_id', 'external_creative_id',
    'metric_date', 'account_timezone', 'breakdown_key', 'segment_key', 'currency',
    'spend_micros', 'impressions', 'clicks', 'reach', 'conversions', 'conversion_value_micros',
    'video_views', 'source_payload_hash'];
  return { rows: rows.length, reconciled: rows.length <= maxRows && byKey.size === rows.length
    && byKey.size === writeSet.dailyFacts.length && writeSet.dailyFacts.every(row =>
      fields.every(field => byKey.get(row.ads_fact_key)?.[field] === row[field])) };
}
