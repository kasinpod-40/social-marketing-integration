import { createAdsDailyRow, createAdsEntityKey } from '../../../domain/src/entities/ads.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';
import { createExplicitNullUpdateRepository } from '../../../sync-engine/src/explicit-null-update-repository.js';
import { assertMktAdsMaintenanceIdle, countLarkRecords } from '../use-cases/mkt-ads-post-sync-maintenance.js';

const MAX_ROWS = 500;
const NULL_FIELDS = ['external_ad_group_id', 'external_ad_id', 'external_creative_id',
  'reach', 'conversions', 'conversion_value_micros', 'conversion_value', 'cpa', 'actual_roas'];

/** ส่งเฉพาะวันปิดใน cache 90 วันจาก D1; ทุกตารางผ่าน Plan ก่อนเขียน และอ่านกลับทุกค่า */
export async function projectTikTokAdsDailyLark(input) {
  if (!input.execute) return project(input);
  if (input.writeEnabled !== true) fail('TIKTOK_ADS_LARK_WRITE_DISABLED');
  await assertMktAdsMaintenanceIdle({ db: input.db, now: input.now ?? Date.now() });
  const lockKey = `tiktok_ads:lark_projection:${input.accountKey}`;
  const ownerId = crypto.randomUUID();
  const lease = await input.lockStore.acquire({ lockKey, ownerId, leaseMs: 120_000 });
  if (!lease.acquired) throw transientError('TikTok Ads projection is locked', { code: 'TIKTOK_ADS_LARK_LOCKED' });
  try {
    return await project({ ...input, beforeWriteChunk: async () => {
      const renewed = await input.lockStore.renew({ lockKey, ownerId, leaseMs: 120_000 });
      if (!renewed.renewed) throw transientError('TikTok Ads projection lease expired', { code: 'TIKTOK_ADS_LARK_LEASE_LOST' });
    } });
  } finally {
    await input.lockStore.release({ lockKey, ownerId });
  }
}

async function project(input) {
  const date = requireDateOnly(input.date, { label: 'TikTok Ads projection date' });
  const now = input.now ?? Date.now();
  const timezone = input.timezone;
  const parts = new Intl.DateTimeFormat('en', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(new Date(now));
  const part = type => parts.find(value => value.type === type).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  const age = (Date.parse(today) - Date.parse(date)) / 86_400_000;
  if (age < 1 || age > 90) fail('TIKTOK_ADS_LARK_DATE_OUTSIDE_CACHE');
  const { db, customerKey, accountKey, advertiserId } = input;
  const result = await db.prepare(`SELECT f.*, e.entity_name AS campaign_name, e.status AS campaign_status,
      e.objective AS campaign_objective, e.source_account_id AS metadata_account_id
    FROM ads_daily_facts f LEFT JOIN ads_entity_state e ON e.customer_key = f.customer_key
      AND e.platform = f.platform AND e.account_key = f.account_key AND e.entity_type = 'campaign'
      AND e.external_entity_id = f.external_campaign_id
    WHERE f.customer_key = ? AND f.platform = 'tiktok_ads' AND f.account_key = ? AND f.metric_date = ? AND f.report_level = 'campaign' LIMIT 501`)
    .bind(customerKey, accountKey, date).all();
  const facts = result?.results ?? [];
  const coverageResult = await db.prepare(`SELECT * FROM data_coverage_runs
    WHERE customer_key = ? AND platform = 'tiktok_ads' AND account_key = ?
      AND dataset_key = 'ads_daily_facts' AND period_start = ? AND period_end = ? LIMIT 2`)
    .bind(customerKey, accountKey, date, date).all();
  const coverage = coverageResult?.results ?? [];
  if (facts.length > MAX_ROWS || new Set(facts.map(row => row.external_entity_id)).size !== facts.length
    || facts.some(row => row.source_account_id !== advertiserId
      || (row.metadata_account_id != null && row.metadata_account_id !== advertiserId) || row.report_level !== 'campaign'
      || row.entity_type !== 'campaign' || row.breakdown_key !== 'none' || row.segment_key !== 'none'
      || row.external_campaign_id !== row.external_entity_id || row.currency !== input.currency
      || row.account_timezone !== timezone || row.metric_date !== date
      || row.spend_micros === null || row.impressions === null || row.clicks === null
      || !/^\d+$/u.test(row.external_entity_id))) fail('TIKTOK_ADS_LARK_FACT_IDENTITY_CONFLICT');
  if (coverage.length !== 1 || !coverage[0].completed_at || coverage[0].failed_rows !== 0
    || !['complete', 'revisable', 'no_data_confirmed'].includes(coverage[0].status)
    || coverage[0].expected_rows !== facts.length || coverage[0].observed_rows !== facts.length
    || (coverage[0].status === 'no_data_confirmed' && facts.length !== 0)) fail('TIKTOK_ADS_LARK_COVERAGE_INCOMPLETE');
  const daily = facts.map(row => createAdsDailyRow({ platform: 'tiktok_ads', accountId: advertiserId,
    entityType: 'campaign', externalEntityId: row.external_entity_id, externalCampaignId: row.external_campaign_id,
    metricDate: date, sourceTimezone: timezone, adChannel: 'tiktok_ads', currency: row.currency,
    spendMicros: row.spend_micros, impressions: row.impressions, clicks: row.clicks,
    // Conversion/revenue/reach ยังไม่ผ่าน source contract จึงไม่อ่านค่าที่ปะปนมาจากภายนอก
  }));
  const campaigns = facts.map(row => ({ ads_campaign_key: createAdsEntityKey({ platform: 'tiktok_ads',
    accountId: advertiserId, entityType: 'campaign', externalEntityId: row.external_campaign_id }),
  platform: 'tiktok_ads', ad_channel: 'tiktok_ads', account_id: advertiserId,
  external_campaign_id: row.external_campaign_id,
  ...(row.campaign_name != null ? { campaign_name: row.campaign_name } : {}),
  ...(row.campaign_objective != null ? { objective: row.campaign_objective } : {}),
  ...(['active', 'paused', 'removed', 'unknown'].includes(row.campaign_status) ? { status: row.campaign_status } : {}),
  }));
  const dailyRepository = createExplicitNullUpdateRepository({ repository: input.repository, fieldNames: NULL_FIELDS });
  const specs = [
    { tableId: input.tables.mktAdsCampaigns, keyField: 'ads_campaign_key', rows: campaigns, repository: input.repository },
    { tableId: input.tables.mktAdsDaily, keyField: 'ads_daily_key', rows: daily, repository: dailyRepository },
  ];
  const plans = [];
  for (const spec of specs) {
    const plan = await input.syncEngine.planByKey(spec);
    if (plan.duplicateInputRows !== 0) fail('TIKTOK_ADS_LARK_DUPLICATE_KEY');
    plans.push(plan);
  }
  const recordsBefore = await countLarkRecords(input.client, input.tables.mktAdsDaily);
  if (recordsBefore + plans[1].createRows.length > 17_000) fail('TIKTOK_ADS_LARK_CACHE_CAPACITY');
  const counts = plans.map(plan => ({ rows: plan.inputRows, created: plan.createRows.length,
    updated: plan.updateRows.length, skipped: plan.skipped }));
  if (!input.execute) return { mode: 'preview', date, facts: facts.length, recordsBefore, tables: counts };
  for (const plan of plans) await input.syncEngine.executePlan(plan, { beforeWriteChunk: input.beforeWriteChunk });
  for (const spec of specs) {
    const readback = await input.syncEngine.planByKey(spec);
    if (readback.createRows.length || readback.updateRows.length || readback.duplicateInputRows
      || readback.skipped !== spec.rows.length) throw transientError('TikTok Ads Lark readback mismatch', {
      code: 'TIKTOK_ADS_LARK_READBACK_MISMATCH',
    });
  }
  return { mode: 'execute', date, facts: facts.length, recordsBefore, tables: counts, reconciled: true };
}

function fail(code) { throw permanentError('TikTok Ads Lark projection preflight failed', { code }); }
