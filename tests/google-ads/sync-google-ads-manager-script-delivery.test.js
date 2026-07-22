import test from 'node:test';
import assert from 'node:assert/strict';
import { syncGoogleAdsManagerScriptDelivery } from '../../packages/application/src/use-cases/sync-google-ads-manager-script-delivery.js';
import { transientError } from '../../packages/shared/src/errors/runtime-error.js';
import { createGoogleAdsDeliveryEnvelope } from '../helpers/google-ads-delivery-fixture.js';

const TABLES = Object.freeze({
  rawGoogleAdsAccounts: 'raw-accounts', rawGoogleAdsCampaigns: 'raw-campaigns',
  rawGoogleAdsAdGroups: 'raw-ad-groups', rawGoogleAdsAds: 'raw-ads',
  rawGoogleAdsAssets: 'raw-assets', rawGoogleAdsDaily: 'raw-daily',
  mktAdsAccounts: 'mkt-accounts', mktAdsCampaigns: 'mkt-campaigns',
  mktAdsAdGroups: 'mkt-ad-groups', mktAdsAds: 'mkt-ads',
  mktAdsCreatives: 'mkt-creatives', mktAdsDaily: 'mkt-daily',
});

function deliveryStore(status = 'queued') {
  const calls = [];
  return {
    calls,
    async readDeliveryById() {
      return {
        deliveryId: '123e4567-e89b-42d3-a456-426614174000', status, mode: 'LIVE',
        payloadJson: JSON.stringify(createGoogleAdsDeliveryEnvelope()), reconciliationJson: null,
      };
    },
    async markProcessing(id) { calls.push(['processing', id]); },
    async markCompleted(value) { calls.push(['completed', value]); },
    async markFailed(value) { calls.push(['failed', value]); },
  };
}

test('plans all 12 destinations before the first write and reconciles every row', async () => {
  const events = [];
  const store = deliveryStore();
  const result = await syncGoogleAdsManagerScriptDelivery({
    deliveryId: '123e4567-e89b-42d3-a456-426614174000',
    deliveryStore: store,
    repository: {},
    tables: TABLES,
    assertLockActive: async () => events.push('lock'),
    syncEngine: {
      async planByKey(input) { events.push(`plan:${input.tableId}:${input.keyField}`); return { tableId: input.tableId, expected: input.rows.length }; },
      async executePlan(plan) { events.push(`execute:${plan.tableId}`); return { created: plan.expected, updated: 0, skipped: 0, duplicateInputRows: 0 }; },
    },
  });
  const firstExecute = events.findIndex((item) => item.startsWith('execute:'));
  assert.equal(events.slice(0, firstExecute).filter((item) => item.startsWith('plan:')).length, 12);
  assert.equal(events.includes('plan:mkt-campaigns:campaign_key'), true);
  assert.equal(events.includes('plan:mkt-ad-groups:ad_group_key'), true);
  assert.equal(events.includes('plan:mkt-creatives:creative_key'), true);
  assert.equal(events.some((item) => /ads_campaign_key|ads_ad_group_key|ads_creative_key/u.test(item)), false);
  assert.equal(result.status, 'completed');
  assert.equal(result.reconciliation.tables.rawGoogleAdsCampaigns.expected, 1);
  assert.equal(result.reconciliation.canonicalDailyRows, 1);
  assert.equal(store.calls.at(-1)[0], 'completed');
});

test('completed delivery replay returns idempotently without planning or writing', async () => {
  let calls = 0;
  const result = await syncGoogleAdsManagerScriptDelivery({
    deliveryId: '123e4567-e89b-42d3-a456-426614174000',
    deliveryStore: deliveryStore('completed'), repository: {}, tables: TABLES,
    syncEngine: { async planByKey() { calls += 1; }, async executePlan() { calls += 1; } },
  });
  assert.equal(result.status, 'completed_idempotent');
  assert.equal(calls, 0);
});

test('retryable write failure is persisted and rethrown for Queue backoff', async () => {
  const store = deliveryStore();
  let executes = 0;
  await assert.rejects(
    syncGoogleAdsManagerScriptDelivery({
      deliveryId: '123e4567-e89b-42d3-a456-426614174000',
      deliveryStore: store, repository: {}, tables: TABLES,
      syncEngine: {
        async planByKey(input) { return { tableId: input.tableId, expected: input.rows.length }; },
        async executePlan() {
          executes += 1;
          if (executes === 2) throw transientError('Lark timeout', { code: 'LARK_TIMEOUT' });
          return { created: 1, updated: 0, skipped: 0, duplicateInputRows: 0 };
        },
      },
    }),
    (error) => error.code === 'LARK_TIMEOUT' && error.retryable === true,
  );
  const failure = store.calls.find(([name]) => name === 'failed');
  assert.equal(failure[1].retryable, true);
});

test('PREVIEW payload is permanently blocked from business writes', async () => {
  const store = deliveryStore();
  store.readDeliveryById = async () => ({ mode: 'PREVIEW', status: 'queued', payloadJson: '{}' });
  await assert.rejects(
    syncGoogleAdsManagerScriptDelivery({
      deliveryId: '123e4567-e89b-42d3-a456-426614174000',
      deliveryStore: store, repository: {}, syncEngine: {}, tables: TABLES,
    }),
    (error) => error.code === 'GOOGLE_ADS_PREVIEW_QUEUE_FORBIDDEN',
  );
});
