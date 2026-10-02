import test from 'node:test';
import assert from 'node:assert/strict';
import { runTikTokAdsDailyD1Sync } from '../../packages/application/src/tiktok-ads/run-tiktok-ads-daily-d1-sync.js';

const base = Object.freeze({
  customerKey: 'chemistry_k', accountKey: 'chemistry_k', advertiserId: '1234567890123456789',
  currency: 'THB', timezone: 'Asia/Bangkok', date: '2026-10-01',
  syncRunId: 'run-1', accessToken: 'private', businessWriteEnabled: true,
});
const row = () => ({
  dimensions: { campaign_id: '456', stat_time_day: '2026-10-01' },
  metrics: { spend: '12.34', impressions: '100', clicks: '4' },
});

test('TikTok Ads D1-only runner writes one exact fact and seals Coverage after readback', async () => {
  const facts = new Map();
  const coverage = [];
  const calls = [];
  const db = { prepare: () => ({ bind: () => ({ first: async () => null, all: async () => ({
    results: [...facts.values()].map((fact) => ({
      ads_fact_key: fact.ads_fact_key, customer_key: fact.customer_key,
      source_account_id: fact.source_account_id,
      source_payload_hash: fact.source_payload_hash,
    })),
  }) }) }) };
  const lockStore = {
    acquire: async () => ({ acquired: true }),
    renew: async () => ({ renewed: true }),
    release: async () => { calls.push('release'); },
    saveSyncRun: async (entry) => { calls.push(entry.status); },
  };
  const historyStore = { writeMetaD1Operations: async (operations) => {
    for (const operation of operations) {
      if (operation.kind === 'ads_daily') facts.set(operation.row.ads_fact_key, operation.row);
      if (operation.kind === 'coverage_run') coverage.push(operation.row);
    }
    return operations.map((operation) => ({
      table: operation.kind === 'ads_daily' ? 'ads_daily_facts' : operation.kind,
      status: 'written',
    }));
  } };
  const result = await runTikTokAdsDailyD1Sync({
    ...base, db, lockStore, historyStore,
    client: { listCampaignDailyReport: async () => ({ rows: [row()], totalCount: 1 }) },
  });
  assert.deepEqual(result, { status: 'revisable', date: '2026-10-01', rows: 1, written: 1 });
  assert.equal(facts.size, 1);
  assert.equal(coverage.length, 1);
  assert.equal(coverage[0].observed_rows, 1);
  assert.deepEqual(calls, ['running', 'success', 'release']);
});

test('TikTok Ads D1-only runner does not write when a source page is incomplete', async () => {
  let writes = 0;
  const lockStore = {
    acquire: async () => ({ acquired: true }), renew: async () => ({ renewed: true }),
    release: async () => undefined,
    saveSyncRun: async () => undefined,
  };
  await assert.rejects(runTikTokAdsDailyD1Sync({
    ...base, db: { prepare: () => { throw new Error('read should not occur'); } }, lockStore,
    historyStore: { writeMetaD1Operations: async () => { writes += 1; } },
    client: { listCampaignDailyReport: async () => { throw new Error('incomplete page'); } },
  }), /incomplete page/u);
  assert.equal(writes, 0);
});
