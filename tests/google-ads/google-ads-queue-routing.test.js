import test from 'node:test';
import assert from 'node:assert/strict';
import { createSyncWorker, processJob } from '../../apps/sync-worker/src/index.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';

const DELIVERY_ID = '123e4567-e89b-42d3-a456-426614174000';

function googleEnv() {
  const env = {
    MKT_ENV: 'uat',
    MKT_CUSTOMER_PROFILE: 'uat_chemistry_k',
    MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'true',
    MKT_SYNC_LOCK_LEASE_MS: '600000',
    MKT_SYNC_LOCK_RENEW_INTERVAL_MS: '120000',
  };
  const names = [
    'RAW_GOOGLE_ADS_ACCOUNTS', 'RAW_GOOGLE_ADS_CAMPAIGNS', 'RAW_GOOGLE_ADS_AD_GROUPS',
    'RAW_GOOGLE_ADS_ADS', 'RAW_GOOGLE_ADS_ASSETS', 'RAW_GOOGLE_ADS_DAILY',
    'MKT_ADS_ACCOUNTS', 'MKT_ADS_CAMPAIGNS', 'MKT_ADS_ADGROUPS',
    'MKT_ADS_ADS', 'MKT_ADS_CREATIVES', 'MKT_ADS_DAILY',
    'MKT_SYNC_LOG', 'MKT_SYSTEM_ALERTS',
  ];
  for (const [index, name] of names.entries()) env[`LARK_TABLE_${name}`] = `tbl_${index}`;
  return env;
}

test('active Google Ads job routes through the shared distributed lock and completes idempotently', async () => {
  const lockCalls = [];
  const syncRuns = [];
  const result = await processJob({
    job: { schemaVersion: 1, body: { type: 'google_ads.manager_script.delivery', deliveryId: DELIVERY_ID } },
    message: { id: 'queue-1', attempts: 1 },
    env: googleEnv(),
    getRuntimeConfig() {
      return {
        profileKey: 'uat_chemistry_k', environment: 'uat',
        connectors: { google_ads: { enabled: true, accountKey: 'chemistry_k' } },
      };
    },
    getInfrastructure() {
      return {
        repository: {}, syncEngine: {},
        getGoogleAdsDeliveryStore() {
          return {
            async readDeliveryById() {
              return { status: 'completed', mode: 'LIVE', reconciliationJson: '{"ok":true}' };
            },
          };
        },
        getReliability() {
          return {
            store: {
              async saveSyncRun(row) { syncRuns.push(row); },
              async saveSystemAlert() {},
            },
            lockManager: {
              async acquire(input) { lockCalls.push(['acquire', input]); return { acquired: true, expiresAt: Date.now() + 600000 }; },
              async renew() { return { renewed: true, expiresAt: Date.now() + 600000 }; },
              async release(input) { lockCalls.push(['release', input]); return true; },
            },
          };
        },
      };
    },
  });
  assert.equal(result.status, 'completed_idempotent');
  assert.equal(lockCalls[0][0], 'acquire');
  assert.equal(lockCalls.at(-1)[0], 'release');
  assert.equal(lockCalls[0][1].lockKey, 'uat_chemistry_k:google_ads:chemistry_k:signed_delivery');
  assert.deepEqual(syncRuns.map((row) => row.status), ['running', 'success']);
});

test('permanent Google Ads queue failure marks the delivery terminal before DLQ persistence', async () => {
  const d1Calls = [];
  const message = {
    id: 'google-fail', attempts: 1,
    body: { schemaVersion: 1, type: 'google_ads.manager_script.delivery', deliveryId: DELIVERY_ID },
    acked: false,
    ack() { this.acked = true; },
    retry() { throw new Error('must not retry permanent error'); },
  };
  const store = { async saveDeadLetter() {}, async saveSystemAlert() {} };
  const worker = createSyncWorker({
    processJob: async () => { throw permanentError('bad schema', { code: 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID' }); },
    createOperationalStore: () => store,
  });
  await worker.queue({ queue: 'main', messages: [message] }, {
    MKT_MAIN_QUEUE_NAME: 'main', MKT_DLQ_QUEUE_NAME: 'dlq',
    MKT_STATE_DB: {
      prepare(sql) {
        const call = { sql: String(sql), bindings: [] }; d1Calls.push(call);
        return { bind(...values) { call.bindings = values; return this; }, async run() { return { meta: { changes: 1 } }; } };
      },
    },
  });
  assert.equal(message.acked, true);
  const terminal = d1Calls.find((call) => /UPDATE google_ads_deliveries/u.test(call.sql));
  assert.ok(terminal);
  assert.equal(terminal.bindings[0], 'failed_permanent');
  assert.equal(terminal.bindings.at(-1), DELIVERY_ID);
});
