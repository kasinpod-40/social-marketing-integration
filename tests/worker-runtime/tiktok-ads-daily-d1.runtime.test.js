import { expect, it } from 'vitest';
import { applyD1Migrations, env } from 'cloudflare:test';
import { D1MarketingHistoryStore } from '../../packages/connectors/src/d1-marketing-history-store.js';
import { D1ReliabilityStore } from '../../packages/reliability/src/d1-reliability-store.js';
import { runTikTokAdsDailyD1Sync } from '../../packages/application/src/tiktok-ads/run-tiktok-ads-daily-d1-sync.js';

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
      rows: [{ dimensions: { campaign_id: '456', stat_time_day: '2026-10-01' },
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
});
