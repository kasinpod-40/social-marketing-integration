import { loadTikTokAdsDailyMasters } from './prove-tiktok-ads-daily-grains.js';
import { createAdsDailyRow, createAdsEntityKey } from '../../../domain/src/entities/ads.js';
import { requireDateOnly, todayInTimeZone } from '../../../shared/src/date/date-only.js';
import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';
import { createExplicitNullUpdateRepository } from '../../../sync-engine/src/explicit-null-update-repository.js';
import { assertMktAdsMaintenanceIdle, countLarkRecords } from '../use-cases/mkt-ads-post-sync-maintenance.js';

const MAX_ROWS = 500;
const NULL_FIELDS = ['external_ad_group_id', 'external_ad_id', 'external_creative_id',
  'video_views', 'video_view_rate', 'reach', 'conversions', 'conversion_value_micros', 'conversion_value', 'cpa', 'actual_roas'];

/** ส่งเฉพาะวันปิดใน cache 90 วันจาก D1; ทุกตารางผ่าน Plan ก่อนเขียน และอ่านกลับทุกค่า */
export async function projectTikTokAdsDailyLark(input) {
  const grain = input.grain ?? 'campaign';
  if (!['campaign', 'ad'].includes(grain)) fail('TIKTOK_ADS_LARK_GRAIN_INVALID');
  if (!input.execute) return project({ ...input, grain });
  if (grain === 'ad' && input.adWriteEnabled !== true) fail('TIKTOK_ADS_AD_LARK_WRITE_DISABLED');
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
  const days = input.days ?? 1;
  if (!Number.isInteger(days) || days < 1 || days > 7) fail('TIKTOK_ADS_LARK_RANGE_INVALID');
  const periodEnd = new Date(Date.parse(date) + (days - 1) * 86_400_000).toISOString().slice(0, 10);
  const now = input.now ?? Date.now();
  const timezone = input.timezone;
  const today = todayInTimeZone(timezone, new Date(now));
  const age = (Date.parse(today) - Date.parse(date)) / 86_400_000;
  if (age < days || age > 90) fail('TIKTOK_ADS_LARK_DATE_OUTSIDE_CACHE');
  const expectedDates = Array.from({ length: days }, (_, index) =>
    new Date(Date.parse(date) + index * 86_400_000).toISOString().slice(0, 10));
  const { db, customerKey, accountKey, advertiserId } = input;
  const grain = input.grain ?? 'campaign';
  const maxRows = grain === 'ad' ? 10000 : MAX_ROWS;
  const result = await db.prepare(`SELECT f.*, e.entity_name AS campaign_name, e.status AS campaign_status,
      e.objective AS campaign_objective, e.source_account_id AS metadata_account_id
    FROM ads_daily_facts f LEFT JOIN ads_entity_state e ON e.customer_key = f.customer_key
      AND e.platform = f.platform AND e.account_key = f.account_key AND e.entity_type = 'campaign'
      AND e.external_entity_id = f.external_campaign_id
    WHERE f.customer_key = ? AND f.platform = 'tiktok_ads' AND f.account_key = ? AND f.metric_date >= ? AND f.metric_date <= ? AND f.report_level = ? LIMIT ?`)
    .bind(customerKey, accountKey, date, periodEnd, grain, maxRows + 1).all();
  const facts = result?.results ?? [];
  const coverageResult = await db.prepare(`SELECT * FROM data_coverage_runs
    WHERE customer_key = ? AND platform = 'tiktok_ads' AND account_key = ?
      AND dataset_key = ? AND period_start >= ? AND period_start <= ? LIMIT 8`)
    .bind(customerKey, accountKey, grain === 'ad' ? 'ads_daily_facts_ad' : 'ads_daily_facts', date, periodEnd).all();
  const coverage = coverageResult?.results ?? [];
  if (facts.length > maxRows || new Set(facts.map(row => `${row.external_entity_id}:${row.metric_date}`)).size !== facts.length
    || facts.some(row => row.source_account_id !== advertiserId
      || (row.metadata_account_id != null && row.metadata_account_id !== advertiserId) || row.report_level !== grain
      || row.entity_type !== grain || row.breakdown_key !== 'none' || row.segment_key !== 'none'
      || (grain === 'campaign' && row.external_campaign_id !== row.external_entity_id)
      || (grain === 'ad' && (row.external_ad_id !== row.external_entity_id
        || !/^\d+$/u.test(row.external_campaign_id ?? '') || !/^\d+$/u.test(row.external_ad_group_id ?? ''))) || row.currency !== input.currency
      || row.account_timezone !== timezone || !expectedDates.includes(row.metric_date)
      || row.spend_micros === null || row.impressions === null || row.clicks === null
      || !/^\d+$/u.test(row.external_entity_id))) fail('TIKTOK_ADS_LARK_FACT_IDENTITY_CONFLICT');
  if (coverage.length !== days || new Set(coverage.map(row => row.period_start)).size !== days
    || expectedDates.some(day => !coverage.some(row => row.period_start === day))
    || coverage.some(row => {
      const count = facts.filter(fact => fact.metric_date === row.period_start).length;
      return row.period_start !== row.period_end || !row.completed_at || row.failed_rows !== 0
        || !['complete', 'revisable', 'no_data_confirmed'].includes(row.status)
        || row.expected_rows !== count || row.observed_rows !== count
        || (row.status === 'no_data_confirmed' && count !== 0);
    })) fail('TIKTOK_ADS_LARK_COVERAGE_INCOMPLETE');
  if (grain === 'ad') {
    const masters = await loadTikTokAdsDailyMasters(input);
    if (facts.some(row => {
      const ad = masters.get(`ad:${row.external_ad_id}`);
      const group = masters.get(`ad_group:${row.external_ad_group_id}`);
      return !ad || !group || !masters.has(`campaign:${row.external_campaign_id}`)
        || ad.parent_campaign_id !== row.external_campaign_id
        || ad.parent_ad_group_id !== row.external_ad_group_id
        || group.parent_campaign_id !== row.external_campaign_id;
    })) fail('TIKTOK_ADS_LARK_AD_PARENT_CONFLICT');
  }
  const daily = facts.map(row => {
    const core = row.actions_json != null;
    if (core) {
      let evidence;
      try { evidence = JSON.parse(row.actions_json); } catch { fail('TIKTOK_ADS_CORE_EVIDENCE_INVALID'); }
      if (evidence?.metric_semantics !== 'provider_selected_optimization_event'
        || evidence.attribution !== 'provider_report_default'
        || Number(evidence.conversion) !== row.conversions
        || !Number.isSafeInteger(row.video_views) || row.video_views < 0) fail('TIKTOK_ADS_CORE_EVIDENCE_INVALID');
    }
    return { ...createAdsDailyRow({ platform: 'tiktok_ads', accountId: advertiserId,
      entityType: grain, externalEntityId: row.external_entity_id, externalCampaignId: row.external_campaign_id,
      externalAdGroupId: grain === 'ad' ? row.external_ad_group_id : null,
      externalAdId: grain === 'ad' ? row.external_ad_id : null,
      metricDate: row.metric_date, sourceTimezone: timezone, adChannel: 'tiktok_ads', currency: row.currency,
      spendMicros: row.spend_micros, impressions: row.impressions, clicks: row.clicks,
      reach: core ? row.reach : null, conversions: core ? row.conversions : null,
    }), ...(core ? { video_views: row.video_views,
      video_view_rate: row.impressions > 0 ? row.video_views / row.impressions : null } : {}) };
  });
  const campaigns = [...new Map(facts.map(row => [row.external_campaign_id, row])).values()].map(row => ({ ads_campaign_key: createAdsEntityKey({ platform: 'tiktok_ads',
    accountId: advertiserId, entityType: 'campaign', externalEntityId: row.external_campaign_id }),
  platform: 'tiktok_ads', ad_channel: 'tiktok_ads', account_id: advertiserId,
  external_campaign_id: row.external_campaign_id,
  ...(row.campaign_name != null ? { campaign_name: row.campaign_name } : {}),
  ...(row.campaign_objective != null ? { objective: row.campaign_objective } : {}),
  ...(['active', 'paused', 'removed', 'unknown'].includes(row.campaign_status) ? { status: row.campaign_status } : {}),
  }));
  const dailyRepository = createExplicitNullUpdateRepository({ repository: input.repository, fieldNames: NULL_FIELDS });
  const specs = [
    ...(grain === 'campaign' ? [{ tableId: input.tables.mktAdsCampaigns, keyField: 'ads_campaign_key', rows: campaigns, repository: input.repository }] : []),
    { tableId: input.tables.mktAdsDaily, keyField: 'ads_daily_key', rows: daily, repository: dailyRepository },
  ];
  const plans = [];
  for (const spec of specs) {
    await input.beforeWriteChunk?.();
    const plan = await input.syncEngine.planByKey(spec);
    if (plan.duplicateInputRows !== 0) fail('TIKTOK_ADS_LARK_DUPLICATE_KEY');
    plans.push(plan);
  }
  const recordsBefore = await countLarkRecords(input.client, input.tables.mktAdsDaily);
  if (recordsBefore + plans.at(-1).createRows.length > 17_000) fail('TIKTOK_ADS_LARK_CACHE_CAPACITY');
  const counts = plans.map(plan => ({ rows: plan.inputRows, created: plan.createRows.length,
    updated: plan.updateRows.length, skipped: plan.skipped }));
  if (!input.execute) return { mode: 'preview', date, periodEnd, days, facts: facts.length, recordsBefore, tables: counts };
  for (const plan of plans) await input.syncEngine.executePlan(plan, { beforeWriteChunk: input.beforeWriteChunk });
  for (const spec of specs) {
    await input.beforeWriteChunk?.();
    const readback = await input.syncEngine.planByKey(spec);
    if (readback.createRows.length || readback.updateRows.length || readback.duplicateInputRows
      || readback.skipped !== spec.rows.length) throw transientError('TikTok Ads Lark readback mismatch', {
      code: 'TIKTOK_ADS_LARK_READBACK_MISMATCH',
    });
  }
  return { mode: 'execute', date, periodEnd, days, facts: facts.length, recordsBefore, tables: counts, reconciled: true };
}

function fail(code) { throw permanentError('TikTok Ads Lark projection preflight failed', { code }); }
