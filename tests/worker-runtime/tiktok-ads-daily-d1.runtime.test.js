import { buildTikTokAdsMasterWriteSet } from '../../packages/application/src/tiktok-ads/tiktok-ads-master-write-set.js';
import { expect, it } from 'vitest';
import { runTikTokAdsMasterSync } from '../../packages/application/src/tiktok-ads/run-tiktok-ads-master-sync.js';
import { applyD1Migrations, env } from 'cloudflare:test';
import { D1MarketingHistoryStore } from '../../packages/connectors/src/d1-marketing-history-store.js';
import { D1ReliabilityStore } from '../../packages/reliability/src/d1-reliability-store.js';
import { runTikTokAdsDailyD1Sync } from '../../packages/application/src/tiktok-ads/run-tiktok-ads-daily-d1-sync.js';
import { reconcileTikTokAdsCampaignMetadata } from '../../packages/application/src/tiktok-ads/reconcile-tiktok-ads-campaign-metadata.js';

it('writes and replays one TikTok Ads Campaign day in real Workers D1 with reconciled Coverage', async () => {
  await applyD1Migrations(env.MKT_STATE_DB, env.TEST_D1_MIGRATIONS);
  const input = {
    customerKey: 'chemistry_k', accountKey: 'chemistry_k', advertiserId: '1234567890123456789',
    currency: 'THB', timezone: 'Asia/Bangkok', date: '2026-10-01',
    syncRunId: 'tiktok_ads:campaign_daily:chemistry_k:2026-10-01',
    accessToken: 'test-only', businessWriteEnabled: true, db: env.MKT_STATE_DB,
    historyStore: new D1MarketingHistoryStore({ db: env.MKT_STATE_DB }),
    lockStore: new D1ReliabilityStore({ db: env.MKT_STATE_DB }),
    client: { listCampaignDailyReport: async () => ({
      rows: [{ dimensions: { campaign_id: '456', stat_time_day: '2026-10-01 00:00:00' },
        metrics: { spend: '12.34', impressions: '100', clicks: '4' } }],
      totalCount: 1,
      pageCount: 1,
    }) },
  };
  expect((await runTikTokAdsDailyD1Sync(input)).written).toBe(1);
  expect((await runTikTokAdsDailyD1Sync(input)).written).toBe(0);
  const fact = await env.MKT_STATE_DB.prepare(`
    SELECT spend_micros, impressions, clicks, conversions, conversion_value_micros,
      source_payload_hash FROM ads_daily_facts WHERE platform = 'tiktok_ads'
  `).first();
  expect(fact).toMatchObject({
    spend_micros: 12340000, impressions: 100, clicks: 4,
    conversions: null, conversion_value_micros: null,
  });
  expect(typeof fact.source_payload_hash).toBe('string');
  const coverage = await env.MKT_STATE_DB.prepare(`
    SELECT expected_rows, observed_rows, status FROM data_coverage_runs WHERE platform = 'tiktok_ads'
  `).first();
  expect(coverage).toMatchObject({ expected_rows: 1, observed_rows: 1, status: 'revisable' });
  const run = await env.MKT_STATE_DB.prepare(`
    SELECT status, records_written FROM sync_runs WHERE platform = 'tiktok_ads'
  `).first();
  expect(run).toMatchObject({ status: 'success', records_written: 0 });
  const metadata = { ...input, execute: true, writeEnabled: true, client: {
    async listCampaignMetadata() { return { totalCount: 1, pageCount: 1,
      rows: [{ campaignId: '456', name: 'Verified campaign', status: 'DISABLE', objective: 'TRAFFIC' }] }; },
  } };
  expect((await reconcileTikTokAdsCampaignMetadata(metadata)).changed).toBe(1);
  expect((await reconcileTikTokAdsCampaignMetadata(metadata)).changed).toBe(0);
  expect((await runTikTokAdsDailyD1Sync(input)).written).toBe(0);
  const master = await env.MKT_STATE_DB.prepare(`SELECT entity_name, status, objective
    FROM ads_entity_state WHERE platform='tiktok_ads' AND external_entity_id='456'`).first();
  expect(master).toMatchObject({ entity_name: 'Verified campaign', status: 'paused', objective: 'TRAFFIC' });
  const finalFact = await env.MKT_STATE_DB.prepare(`SELECT source_payload_hash FROM ads_daily_facts
    WHERE platform='tiktok_ads'`).first();
  expect(finalFact.source_payload_hash).toBe(fact.source_payload_hash);
});


it('full TikTok master sync uses real D1 writes/lease, exact parent readback and zero-change replay', async () => {
  await applyD1Migrations(env.MKT_STATE_DB, env.TEST_D1_MIGRATIONS);
  const records = new Map();
  const row = (kind, id, extra = {}) => ({ kind, id, campaignId: '910', adGroupId: '920', name: 'Example',
    status: 'ENABLE', videoId: null, imageIds: [], ...extra });
  const datasets = { campaign: [row('campaign', '910', { automationType: 'UPGRADED_SMART_PLUS' })],
    ad_group: [row('ad_group', '920')], ad: [row('ad', '930')],
    smart_ad: [row('smart_ad', '940', { creativeItems: 1, creativeIds: ['930'] })] };
  const input = { execute: true, writeEnabled: true, customerKey: 'master_runtime', accountKey: 'master_runtime',
    advertiserId: '999', currency: 'THB', timezone: 'Asia/Bangkok', accessToken: 'test-only', db: env.MKT_STATE_DB,
    historyStore: new D1MarketingHistoryStore({ db: env.MKT_STATE_DB }),
    lockStore: new D1ReliabilityStore({ db: env.MKT_STATE_DB }), repository: {},
    reconcileLinks: async () => ({ adGroups: 0, ads: 0, creativeLinks: 0, updated: 0 }),
    larkClient: { async requestBitableJson() { return { data: { total: 0 } }; } },
    client: { async listEntityMetadata({kind}) { return { rows: datasets[kind], totalCount: datasets[kind].length }; },
      async getAdvertiser() { return { advertiserId: '999', advertiserName: 'Example', currency: 'THB', timezone: 'Asia/Bangkok' }; } },
    tables: { mktAdsAccounts: 'account', mktAdsCampaigns: 'campaign', mktAdsAdGroups: 'group', mktAdsAds: 'ad', mktAdsCreatives: 'creative' },
    syncEngine: { async planByKey(spec) { const done=records.has(spec.tableId);
      return { ...spec, inputRows: spec.rows.length, duplicateInputRows: 0, createRows: done ? [] : spec.rows,
        updateRows: [], skipped: done ? spec.rows.length : 0 }; },
    async executePlan(plan, {beforeWriteChunk}) { await beforeWriteChunk(); records.set(plan.tableId, plan.rows); } },
  };
  expect((await runTikTokAdsMasterSync(input)).d1Changed).toBe(5);
  expect((await runTikTokAdsMasterSync(input)).d1Changed).toBe(0);
  const creative = await env.MKT_STATE_DB.prepare("SELECT entity_type, parent_ad_id FROM ads_entity_state WHERE account_key='master_runtime' AND external_entity_id='930'").first();
  expect(creative).toMatchObject({ entity_type: 'creative', parent_ad_id: '940' });
  const facts = await env.MKT_STATE_DB.prepare("SELECT COUNT(*) AS n FROM ads_daily_facts WHERE account_key='master_runtime'").first();
  expect(facts.n).toBe(0);
});


it('Campaign and true Ad grains coexist with separate Coverage, full parent readback and independent zero-change replays', async () => {
  await applyD1Migrations(env.MKT_STATE_DB, env.TEST_D1_MIGRATIONS);
  const advertiserId = '123';
  const base = { customerKey: 'daily_grains', accountKey: 'daily_grains', advertiserId,
    currency: 'THB', timezone: 'Asia/Bangkok', date: '2026-10-01',
    accessToken: 'test-only', businessWriteEnabled: true, multiGrainWriteEnabled: true,
    allStatuses: true, db: env.MKT_STATE_DB,
    historyStore: new D1MarketingHistoryStore({ db: env.MKT_STATE_DB }),
    lockStore: new D1ReliabilityStore({ db: env.MKT_STATE_DB }),
    client: { async listAllStatusDailyReport({ grain }) { return { totalCount: 1, pageCount: 1,
      rows: [{ dimensions: { [grain === 'ad' ? 'ad_id_v2' : 'campaign_id']: grain === 'ad' ? '33' : '11',
        stat_time_day: '2026-10-01 00:00:00' }, metrics: { spend: '1.23', impressions: '10', clicks: '2' } }] }; } },
  };
  const row = (kind, id, extra = {}) => ({ kind, id, campaignId: '11', adGroupId: '22', name: 'Verified',
    status: 'ENABLE', videoId: null, imageIds: [], ...extra });
  const rows = { campaign: [row('campaign', '11', { automationType: 'MANUAL' })],
    ad_group: [row('ad_group', '22')], ad: [row('ad', '33')], smart_ad: [] };
  const master = await buildTikTokAdsMasterWriteSet({ ...base, accountName: 'Verified', now: Date.now(),
    syncRunId: 'masters', inventories: Object.fromEntries(Object.entries(rows).map(([kind, items]) =>
      [kind, { rows: items, totalCount: items.length }])) });
  await base.historyStore.writeMetaD1Operations(master.entities.map(row => ({ kind: 'ads_entity', row })));
  const campaign = { ...base, grain: 'campaign', syncRunId: 'campaign-grain' };
  const ad = { ...base, grain: 'ad', syncRunId: 'ad-grain' };
  expect((await runTikTokAdsDailyD1Sync(campaign)).written).toBe(1);
  expect((await runTikTokAdsDailyD1Sync(ad)).written).toBe(1);
  expect((await runTikTokAdsDailyD1Sync(campaign)).written).toBe(0);
  expect((await runTikTokAdsDailyD1Sync(ad)).written).toBe(0);
  const enriched = { ...ad, coreMetrics: true, coreMetricWriteEnabled: true, client: {
    async listAllStatusDailyReport({ metricFamily, grain }) {
      expect(metricFamily).toBe('core');
      return { totalCount: 1, pageCount: 1, rows: [{ dimensions: { [grain === 'ad' ? 'ad_id_v2' : 'campaign_id']: grain === 'ad' ? '33' : '11', stat_time_day: '2026-10-01' },
        metrics: { spend: '1.23', impressions: '10', clicks: '2', reach: '8', conversion: '1.50',
          video_play_actions: '9', video_watched_2s: '7', video_watched_6s: '2' } }] };
    },
  } };
  expect((await runTikTokAdsDailyD1Sync(enriched)).written).toBe(1);
  expect((await runTikTokAdsDailyD1Sync(enriched)).written).toBe(0);
  const coreFact = await env.MKT_STATE_DB.prepare("SELECT reach, conversions, video_views, actions_json FROM ads_daily_facts WHERE account_key='daily_grains' AND report_level='ad'").first();
  expect(coreFact).toMatchObject({ reach: 8, conversions: 1.5, video_views: 9 });
  expect(JSON.parse(coreFact.actions_json).video_watched_6s).toBe(2);
  await expect(runTikTokAdsDailyD1Sync(ad)).rejects.toMatchObject({ code: 'TIKTOK_ADS_METRIC_DOWNGRADE_REFUSED' });
  await expect(runTikTokAdsDailyD1Sync({ ...enriched, coreMetricWriteEnabled: false }))
    .rejects.toMatchObject({ code: 'TIKTOK_ADS_CORE_METRIC_WRITE_DISABLED' });
  await runTikTokAdsDailyD1Sync({ ...enriched, grain: 'campaign', syncRunId: 'campaign-core' });
  const { createD1ReportRegistry } = await import('../../apps/sync-worker/src/tiktok-d1-aware-report-job-router.js');
  const { generateDashboardReportMaterialization } = await import('../../packages/application/src/use-cases/generate-dashboard-report-materialization.js');
  const { D1ReportMaterializationReader } = await import('../../packages/connectors/src/d1-report-materialization-reader.js');
  const reportInput = { registry: createD1ReportRegistry(env.MKT_STATE_DB, { tikTokAdsReady: true }),
    materializationStore: base.historyStore, customerKey: base.customerKey, accountKey: base.accountKey,
    platformScope: 'tiktok_ads', reportSettingKey: 'test-tiktok-1d', periodKind: 'rolling_days', windowDays: 1,
    periodEnd: base.date, comparisonMode: 'none', generatedAt: Date.parse('2026-10-02T00:00:00Z'), timeZone: base.timezone };
  const report = await generateDashboardReportMaterialization(reportInput);
  expect(report.topAds).toHaveLength(1);
  expect(report.topAds[0]).toMatchObject({ external_ad_id: '33', spend_micros: 1230000,
    conversions: 1.5, video_views: 9, reach: null, external_creative_id: null });
  const read = await new D1ReportMaterializationReader({ db: env.MKT_STATE_DB }).readById(report.reportId);
  expect(read.payload.platformScope).toBe('tiktok_ads'); expect(read.payload.topAds).toHaveLength(1);
  expect((await generateDashboardReportMaterialization(reportInput)).reportId).toBe(report.reportId);
  const facts = (await env.MKT_STATE_DB.prepare("SELECT report_level, external_entity_id, external_campaign_id, external_ad_group_id, external_ad_id, external_creative_id FROM ads_daily_facts WHERE account_key='daily_grains' ORDER BY report_level").all()).results;
  expect(facts).toEqual([
    { report_level: 'ad', external_entity_id: '33', external_campaign_id: '11', external_ad_group_id: '22', external_ad_id: '33', external_creative_id: null },
    { report_level: 'campaign', external_entity_id: '11', external_campaign_id: '11', external_ad_group_id: null, external_ad_id: null, external_creative_id: null },
  ]);
  const coverage = (await env.MKT_STATE_DB.prepare("SELECT dataset_key, observed_rows FROM data_coverage_runs WHERE account_key='daily_grains' ORDER BY dataset_key").all()).results;
  expect(coverage).toEqual([{ dataset_key: 'ads_daily_facts', observed_rows: 1 }, { dataset_key: 'ads_daily_facts_ad', observed_rows: 1 }]);
  await expect(runTikTokAdsDailyD1Sync({ ...ad, client: { async listAllStatusDailyReport() {
    return { totalCount: 1, rows: [{ dimensions: { ad_id_v2: '999', stat_time_day: '2026-10-01' }, metrics: { spend: '1', impressions: '1', clicks: '1' } }] }; } } })).rejects.toMatchObject({ code: 'TIKTOK_ADS_DAILY_MASTER_MISSING' });
  expect((await env.MKT_STATE_DB.prepare("SELECT COUNT(*) AS n FROM ads_daily_facts WHERE account_key='daily_grains'").first()).n).toBe(2);
});

it('scoped TikTok monthly Summary reconciles real D1, excludes Ad/other platform and replays zero writes', async () => {
  const { projectTikTokAdsCampaignSummary } = await import('../../packages/application/src/tiktok-ads/project-tiktok-ads-campaign-summary.js');
  const { createAdsFactKey } = await import('../../packages/application/src/storage/marketing-history-contract.js');
  const { TableSyncEngine } = await import('../../packages/sync-engine/src/table-sync-engine.js');
  await applyD1Migrations(env.MKT_STATE_DB, env.TEST_D1_MIGRATIONS);
  const historyStore = new D1MarketingHistoryStore({ db: env.MKT_STATE_DB });
  const input = { customerKey: 'summary_runtime', accountKey: 'summary_runtime', advertiserId: '123',
    currency: 'THB', timezone: 'Asia/Bangkok', date: '2026-10-01',
    syncRunId: 'tiktok_ads:summary_runtime:2026-10-01',
    accessToken: 'test-only', businessWriteEnabled: true, db: env.MKT_STATE_DB, historyStore,
    lockStore: new D1ReliabilityStore({ db: env.MKT_STATE_DB }),
    client: { listCampaignDailyReport: async () => ({ rows: [{ dimensions: { campaign_id: '456',
      stat_time_day: '2026-10-01' }, metrics: { spend: '12.34', impressions: '100', clicks: '4' } }],
    totalCount: 1, pageCount: 1 }) },
  };
  await runTikTokAdsDailyD1Sync(input);
  const fact = await env.MKT_STATE_DB.prepare("SELECT * FROM ads_daily_facts WHERE customer_key='summary_runtime'").first();
  for (const overrides of [
    { report_level: 'ad', entity_type: 'ad', external_entity_id: '789', external_ad_id: '789', external_ad_group_id: '777' },
    { platform: 'google_ads' },
  ]) {
    const row = { ...fact, ...overrides, spend_micros: 999000000 };
    row.ads_fact_key = createAdsFactKey(row);
    await historyStore.writeMetaD1Operations([{ kind: 'ads_daily', row }]);
  }
  const records = []; let writes = 0;
  const fields = [
    { fieldName: 'platform', type: 3, property: { options: [{ name: 'tiktok_ads' }] } },
    { fieldName: 'period_month_th', type: 3, fieldId: 'month', property: { options: [] } },
  ];
  const repository = {
    getTableFields: async () => fields,
    prepareRows: async (_table, rows) => rows.map(row => Object.fromEntries(Object.entries(row).filter(([, value]) => value != null))),
    prepareExistingRecords: async (_table, rows) => rows,
    listByFieldValues: async () => records,
    createMany: async (_table, rows, options) => {
      await options.beforeChunk(); writes += rows.length;
      records.push(...rows.map((row, index) => ({ recordId: `row-${index}`, fields: row })));
      return { created: rows.length };
    }, updateMany: async () => { throw Error('Unexpected update'); },
  };
  Object.freeze(repository);
  const projectInput = { ...input, execute: false, writeEnabled: true, month: '2026-10',
    now: Date.parse('2026-10-02T06:00:00Z'), tables: { mktAdsCampaignSummary: 'summary' },
    repository, syncEngine: new TableSyncEngine(), client: {
      appToken: 'test', listFields: async () => structuredClone(fields),
      updateField: async ({ field }) => { fields[1].property = structuredClone(field.property); },
      requestBitableJson: async () => ({ data: { total: records.length } }),
    },
  };
  expect(await projectTikTokAdsCampaignSummary(projectInput)).toMatchObject({ campaigns: 1, created: 1, monthOptionNeeded: true });
  expect(fields[1].property.options).toHaveLength(0); expect(writes).toBe(0);
  expect((await projectTikTokAdsCampaignSummary({ ...projectInput, execute: true })).readback.reconciled).toBe(true);
  expect(records[0].fields).toMatchObject({ spend: 12.34, impressions: 100, clicks: 4, platform: 'tiktok_ads' });
  expect(fields[1].property.options).toHaveLength(1); expect(writes).toBe(1);
  expect(await projectTikTokAdsCampaignSummary({ ...projectInput, execute: true })).toMatchObject({ created: 0, updated: 0, skipped: 1 });
  expect(writes).toBe(1);
  await env.MKT_STATE_DB.prepare("UPDATE data_coverage_runs SET failed_rows=1 WHERE customer_key='summary_runtime'").run();
  await expect(projectTikTokAdsCampaignSummary({ ...projectInput, execute: true })).rejects.toMatchObject({ code: 'TIKTOK_ADS_SUMMARY_COVERAGE_INCOMPLETE' });
  expect(writes).toBe(1);
});

it('bounded Lark range queries real D1 with exact per-day Coverage and distinct canonical dates', async () => {
  const { projectTikTokAdsDailyLark } = await import('../../packages/application/src/tiktok-ads/project-tiktok-ads-daily-lark.js');
  await applyD1Migrations(env.MKT_STATE_DB, env.TEST_D1_MIGRATIONS);
  const base = { customerKey: 'range_runtime', accountKey: 'range_runtime', advertiserId: '123',
    currency: 'THB', timezone: 'Asia/Bangkok', accessToken: 'test-only', businessWriteEnabled: true,
    db: env.MKT_STATE_DB, historyStore: new D1MarketingHistoryStore({ db: env.MKT_STATE_DB }),
    lockStore: new D1ReliabilityStore({ db: env.MKT_STATE_DB }),
  };
  for (const date of ['2026-10-01', '2026-10-02']) {
    await runTikTokAdsDailyD1Sync({ ...base, date, syncRunId: `tiktok_ads:range_runtime:${date}`,
      client: { listCampaignDailyReport: async () => ({ rows: [{ dimensions: { campaign_id: '456', stat_time_day: date },
        metrics: { spend: '12.34', impressions: '100', clicks: '4' } }], totalCount: 1, pageCount: 1 }) },
    });
  }
  const plans = [];
  const input = { ...base, date: '2026-10-01', days: 2, now: Date.parse('2026-10-03T06:00:00Z'),
    execute: false, repository: {}, tables: { mktAdsCampaigns: 'campaigns', mktAdsDaily: 'daily' },
    client: { appToken: 'test', requestBitableJson: async () => ({ data: { total: 0 } }) },
    syncEngine: { planByKey: async spec => {
      plans.push(spec); return { inputRows: spec.rows.length, createRows: spec.rows, updateRows: [], skipped: 0, duplicateInputRows: 0 };
    } },
  };
  expect(await projectTikTokAdsDailyLark(input)).toMatchObject({ facts: 2, days: 2, periodEnd: '2026-10-02' });
  expect(plans[0].rows).toHaveLength(1);
  expect(plans[1].rows.map(row => row.ads_daily_key)).toEqual([
    'tiktok_ads:123:campaign:456:2026-10-01', 'tiktok_ads:123:campaign:456:2026-10-02',
  ]);
  await env.MKT_STATE_DB.prepare("DELETE FROM data_coverage_runs WHERE customer_key='range_runtime' AND period_start='2026-10-02'").run();
  plans.length = 0;
  await expect(projectTikTokAdsDailyLark(input)).rejects.toMatchObject({ code: 'TIKTOK_ADS_LARK_COVERAGE_INCOMPLETE' });
  expect(plans).toHaveLength(0);
});


it('durable daily units resume after Queue send failure and terminal replay in real Workers D1', async () => {
  const { D1ResumableWorkStore } = await import('../../packages/sync-engine/src/d1-resumable-work-store.js');
  const { buildTikTokAdsDailyPlan, runTikTokAdsDailyWork } = await import('../../packages/application/src/tiktok-ads/run-tiktok-ads-daily-work.js');
  await applyD1Migrations(env.MKT_STATE_DB, env.TEST_D1_MIGRATIONS);
  const now=Date.parse('2026-10-04T12:00:00Z');
  const plan=buildTikTokAdsDailyPlan({periodEnd:'2026-10-03',timezone:'Asia/Bangkok',now});
  const store=new D1ResumableWorkStore({db:env.MKT_STATE_DB,now:()=>now});
  const executed=[],sent=[];
  const input={plan,store,accountKey:'daily-test',periodEnd:'2026-10-03',jobType:'tiktok.ads.daily.sync',
    operation:{workKey:'tiktok_ads:daily-runtime',generation:now,originalRequestedAt:now},
    runUnit:async(unit,fence)=>{await fence();executed.push(unit.index);},
    enqueueContinuation:async()=>{throw Error('send failed after checkpoint');}};
  await expect(runTikTokAdsDailyWork(input)).rejects.toThrow('send failed');
  expect(executed).toEqual([0]);
  expect((await store.loadPhase({workKey:input.operation.workKey,phase:'daily_unit_0'})).complete).toBe(true);
  input.enqueueContinuation=async index=>{sent.push(index);};
  expect((await runTikTokAdsDailyWork(input)).replayedUnit).toBe(true);
  expect(executed).toEqual([0]);
  for(let index=1;index<plan.length;index++)await runTikTokAdsDailyWork({...input,unitIndex:index});
  expect(executed.length).toBe(plan.length);
  expect((await runTikTokAdsDailyWork(input)).replayed).toBe(true);
  expect(sent.length).toBe(plan.length-1);
  const state=await env.MKT_STATE_DB.prepare('SELECT lifecycle_status, completion_json FROM sync_work_runs WHERE work_key=?').bind(input.operation.workKey).first();
  expect(state.lifecycle_status).toBe('completed');
  expect(JSON.parse(state.completion_json)).toEqual({status:'success',units:plan.length});
  expect((await env.MKT_STATE_DB.prepare('SELECT COUNT(*) AS n FROM sync_work_phases WHERE work_key=?').bind(input.operation.workKey).first()).n).toBe(0);
});
