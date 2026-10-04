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
