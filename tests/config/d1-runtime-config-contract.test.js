import test from 'node:test';
import assert from 'node:assert/strict';
import { isD1RuntimeConfigKeyAllowed, requireD1RuntimeConfigKey } from '../../packages/config/src/d1-runtime-config-contract.js';

test('D1 runtime config allows only reviewed non-secret keys', () => {
  assert.equal(isD1RuntimeConfigKeyAllowed('LARK_TABLE_MKT_ADS_DAILY'), true);
  assert.equal(isD1RuntimeConfigKeyAllowed('TIKTOK_ADS_APP_ID'), true);
  for (const key of [
    'TIKTOK_ADS_APP_SECRET',
    'META_ACCESS_TOKEN',
    'GOOGLE_OAUTH_CLIENT_SECRET',
    'MKT_CONNECTION_ENCRYPTION_KEY_V1',
    'MKT_SYNC_QUEUE',
  ]) assert.equal(isD1RuntimeConfigKeyAllowed(key), false);
  assert.throws(
    () => requireD1RuntimeConfigKey('TIKTOK_ADS_APP_SECRET'),
    (error) => error.code === 'RUNTIME_CONFIG_KEY_NOT_ALLOWED',
  );
});
