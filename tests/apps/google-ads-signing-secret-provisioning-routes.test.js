import test from 'node:test';
import assert from 'node:assert/strict';
import apiWorker from '../../apps/api-worker/src/index.js';
import {
  GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH,
  GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH,
} from '../../packages/config/src/google-ads-signing-secret-provisioning-contract.js';

test('provisioning routes expose only POST and stay hidden while disabled', async () => {
  for (const path of [
    GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH,
    GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH,
  ]) {
    const getResponse = await apiWorker.fetch(new Request(`https://example.test${path}`), {}, {});
    assert.equal(getResponse.status, 405);
    assert.equal(getResponse.headers.get('allow'), 'POST');

    const postResponse = await apiWorker.fetch(new Request(`https://example.test${path}`, {
      method: 'POST',
      body: '{}',
      headers: { 'content-type': 'application/json' },
    }), { MKT_GOOGLE_ADS_SECRET_PROVISIONING_ENABLED: 'false' }, {});
    assert.equal(postResponse.status, 404);
    assert.deepEqual(await postResponse.json(), { ok: false, error: 'Route not found' });
  }
});
