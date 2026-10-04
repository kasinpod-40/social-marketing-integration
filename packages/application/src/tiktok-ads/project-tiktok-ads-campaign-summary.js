import { assertMktAdsMaintenanceIdle, countLarkRecords, ensureCampaignSummaryMonthOption,
  materializeCampaignSummaryPeriods, campaignSummaryThaiMonthLabel } from '../use-cases/mkt-ads-post-sync-maintenance.js';
import { todayInTimeZone, requireDateOnly } from '../../../shared/src/date/date-only.js';
import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

/** เดือนละหนึ่ง bounded plan; ใช้ Campaign grain ที่ Coverage ครบ ไม่รวม Ad ซ้ำ */
export async function projectTikTokAdsCampaignSummary(input) {
  const now = input.now ?? Date.now();
  const today = todayInTimeZone(input.timezone, new Date(now));
  if (!/^\d{4}-(0[1-9]|1[0-2])$/u.test(input.month ?? '') || input.month < '2025-09'
    || input.month > today.slice(0, 7)) fail('MONTH_INVALID');
  const periodStart = requireDateOnly(`${input.month}-01`);
  const [year, month] = input.month.split('-').map(Number);
  const monthEnd = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  const yesterday = new Date(Date.parse(today) - 86_400_000).toISOString().slice(0, 10);
  const periodEnd = monthEnd < yesterday ? monthEnd : yesterday;
  if (periodEnd < periodStart) fail('MONTH_NOT_CLOSED');
  const expectedDays = (Date.parse(periodEnd) - Date.parse(periodStart)) / 86_400_000 + 1;
  const coverage = (await input.db.prepare(`SELECT c.period_start, c.period_end, c.status,
      c.expected_rows, c.observed_rows, c.failed_rows, c.completed_at,
      (SELECT COUNT(*) FROM ads_daily_facts f WHERE f.customer_key = c.customer_key
        AND f.platform = c.platform AND f.account_key = c.account_key AND f.report_level = 'campaign'
        AND f.metric_date = c.period_start) AS actual_rows
    FROM data_coverage_runs c WHERE c.customer_key = ? AND c.platform = 'tiktok_ads'
      AND c.account_key = ? AND c.dataset_key = 'ads_daily_facts'
      AND c.period_start >= ? AND c.period_start <= ? LIMIT 32`)
    .bind(input.customerKey, input.accountKey, periodStart, periodEnd).all())?.results ?? [];
  const expectedDates = Array.from({ length: expectedDays }, (_, index) =>
    new Date(Date.parse(periodStart) + index * 86_400_000).toISOString().slice(0, 10));
  const dates = new Set(coverage.map(row => row.period_start));
  if (coverage.length !== expectedDays || dates.size !== expectedDays || expectedDates.some(date => !dates.has(date)) || coverage.some(row =>
    row.period_start !== row.period_end || !row.completed_at || row.failed_rows !== 0
    || !['complete', 'revisable', 'no_data_confirmed'].includes(row.status)
    || row.expected_rows !== row.actual_rows || row.observed_rows !== row.actual_rows
    || (row.status === 'no_data_confirmed' && row.actual_rows !== 0))) fail('COVERAGE_INCOMPLETE');
  const identity = await input.db.prepare(`SELECT COUNT(*) AS invalid_rows FROM ads_daily_facts f
    LEFT JOIN ads_entity_state e ON e.customer_key = f.customer_key AND e.platform = f.platform
      AND e.account_key = f.account_key AND e.entity_type = 'campaign'
      AND e.external_entity_id = f.external_campaign_id
    WHERE f.customer_key = ? AND f.platform = 'tiktok_ads' AND f.account_key = ?
      AND f.report_level = 'campaign' AND f.metric_date >= ? AND f.metric_date <= ?
      AND (f.source_account_id != ? OR f.currency != ? OR f.account_timezone != ?
        OR f.currency IS NULL OR f.account_timezone IS NULL
        OR f.entity_type != 'campaign' OR f.external_entity_id != f.external_campaign_id
        OR f.breakdown_key != 'none' OR f.segment_key != 'none'
        OR f.spend_micros IS NULL OR f.impressions IS NULL OR f.clicks IS NULL
        OR e.source_account_id IS NULL OR e.source_account_id != f.source_account_id)`)
    .bind(input.customerKey, input.accountKey, periodStart, periodEnd, input.advertiserId,
      input.currency, input.timezone).first();
  if (!identity || identity.invalid_rows !== 0) fail('IDENTITY_CONFLICT');
  const tableId = input.tables.mktAdsCampaignSummary;
  const project = async beforeWriteChunk => {
    const fields = await input.client.listFields({ tableId });
    if (fields.filter(field => field.fieldName === 'platform' && Number(field.type) === 3
      && field.property?.options?.some(option => option.name === 'tiktok_ads')).length !== 1) fail('SCHEMA_INVALID');
    const label = campaignSummaryThaiMonthLabel(periodStart);
    const monthFields = fields.filter(field => field.fieldName === 'period_month_th');
    if (monthFields.length !== 1 || ![1, 3].includes(Number(monthFields[0].type))) fail('SCHEMA_INVALID');
    const monthOptionNeeded = Number(monthFields[0].type) === 3
      && !monthFields[0].property?.options?.some(option => option.name === label);
    // Preview แสดงแผนพร้อม enum ที่ต้องเพิ่ม แต่ไม่มี schema mutation จนทุกแถว/capacity ผ่าน
    const repository = Object.create(input.repository);
    if (monthOptionNeeded && typeof input.repository.getTableFields === 'function') {
      Object.defineProperty(repository, 'getTableFields', { value: async () => fields.map(field => field.fieldName === 'period_month_th'
        ? { ...field, property: { ...field.property, options: [...(field.property?.options ?? []), { name: label }] } }
        : field) });
    }
    const result = await materializeCampaignSummaryPeriods({ ...input, repository, tableId, now,
      periods: [{ periodStart, periodEnd }], beforeWriteChunk,
      scope: { platform: 'tiktok_ads', accountKey: input.accountKey, advertiserId: input.advertiserId },
      syncEngine: { planByKey: async spec => {
        await beforeWriteChunk?.();
        const plan = await input.syncEngine.planByKey(spec);
        if (await countLarkRecords(input.client, tableId) + plan.createRows.length > 17000) fail('CAPACITY');
        return plan;
      }, executePlan: async (...args) => {
        await beforeWriteChunk();
        await ensureCampaignSummaryMonthOption({ client: input.client, tableId, timezone: input.timezone,
          now: Date.parse(`${periodEnd}T12:00:00Z`) });
        return input.syncEngine.executePlan(...args);
      } },
    });
    return { month: input.month, periodStart, periodEnd, coverageDays: expectedDays, monthOptionNeeded, ...result };
  };
  if (!input.execute) return project();
  if (input.writeEnabled !== true) fail('WRITE_DISABLED');
  await assertMktAdsMaintenanceIdle({ db: input.db, now });
  const lockKey = `tiktok_ads:campaign_summary:${input.accountKey}`;
  const ownerId = crypto.randomUUID();
  if (!(await input.lockStore.acquire({ lockKey, ownerId, leaseMs: 120000 })).acquired) retry('LOCKED');
  const renew = async () => {
    if (!(await input.lockStore.renew({ lockKey, ownerId, leaseMs: 120000 })).renewed) retry('LEASE_LOST');
  };
  try { return await project(renew); }
  finally { await input.lockStore.release({ lockKey, ownerId }); }
}
function fail(code) { throw permanentError('TikTok Ads Summary preflight failed', { code: `TIKTOK_ADS_SUMMARY_${code}` }); }
function retry(code) { throw transientError('TikTok Ads Summary reconciliation failed', { code: `TIKTOK_ADS_SUMMARY_${code}` }); }
