import test from 'node:test';
import assert from 'node:assert/strict';
import { hydrateRuntimeEnvFromD1 } from '../../apps/sync-worker/src/runtime-config-hydration.js';

test('runtime config hydration overlays D1 non-secrets and preserves Worker bindings/secrets', async () => {
  const db = { prepare() {} };
  const queue = { send() {} };
  const env = {
    MKT_ENV: 'production',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_STATE_DB: db,
    MKT_SYNC_QUEUE: queue,
    LARK_APP_SECRET: 'secret-private',
    LARK_TABLE_MKT_ADS_DAILY: 'old-binding-value',
  };
  const hydrated = await hydrateRuntimeEnvFromD1(env, {
    store: { async list() { return [
      { configKey: 'LARK_TABLE_MKT_ADS_DAILY', configValue: 'tbl-from-d1' },
      { configKey: 'TIKTOK_ADS_APP_ID', configValue: '7670007933899390993' },
    ]; } },
  });
  assert.equal(hydrated.LARK_TABLE_MKT_ADS_DAILY, 'tbl-from-d1');
  assert.equal(hydrated.TIKTOK_ADS_APP_ID, '7670007933899390993');
  assert.equal(hydrated.LARK_APP_SECRET, 'secret-private');
  assert.equal(hydrated.MKT_STATE_DB, db);
  assert.equal(hydrated.MKT_SYNC_QUEUE, queue);
});

test('runtime config hydration is a no-op without D1 bootstrap identity', async () => {
  const env = { MKT_ENV: 'production' };
  assert.equal(await hydrateRuntimeEnvFromD1(env), env);
});
