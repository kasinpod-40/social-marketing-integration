import test from 'node:test';
import assert from 'node:assert/strict';
import { createTikTokAdsLarkSchemaHttpHandler } from '../../apps/sync-worker/src/tiktok-ads-lark-schema-http.js';

const env = { MKT_ENV: 'production', MKT_CUSTOMER_PROFILE: 'chemistry_k', MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k', MKT_CONNECTION_OPERATOR_TOKEN: 'test-operator-token' };
function request(query = 'table=daily', options = {}) {
  const req = new Request(`https://example.test/operator/tiktok-ads/lark-schema?${query}`, { headers: { authorization: 'Bearer test-operator-token' }, ...options });
  return { request: req, url: new URL(req.url), env };
}

test('schema probe rejects unauthorized, wrong method, scope and unapproved table before APIs', async () => {
  const handle = createTikTokAdsLarkSchemaHttpHandler({ hydrate() { throw new Error('Unexpected API call'); } });
  assert.equal((await handle(request('table=daily', { headers: {} }))).status, 401);
  assert.equal((await handle(request('table=daily', { method: 'POST' }))).status, 405);
  assert.equal((await handle(request('table=unknown'))).status, 400);
  assert.equal((await handle(request('table=daily&extra=1'))).status, 400);
  assert.equal((await handle({ ...request(), env: { ...env, MKT_CUSTOMER_PROFILE: 'other' } })).status, 409);
});

test('schema probe reads only the configured scoped table and strips identifiers and option data', async () => {
  const calls = [];
  const handle = createTikTokAdsLarkSchemaHttpHandler({
    hydrate: async () => ({ ...env, LARK_TABLE_MKT_ADS_DAILY: 'tblScopedDaily' }),
    createClient: () => ({ async listFields(input) {
      calls.push(input);
      return [{ fieldId: 'sensitive-field-id', fieldName: 'platform', type: 3,
        property: { options: [{ name: 'tiktok_ads', id: 'option-id' }, { name: 'customer-private-label' }] } }];
    } }),
  });
  const response = await handle(request());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.deepEqual(calls, [{ tableId: 'tblScopedDaily' }]);
  assert.equal(body.fields[0].tiktokOptionPresent, true);
  assert.equal(body.readOnly, true);
  assert.doesNotMatch(JSON.stringify(body), /tblScopedDaily|sensitive-field-id|option-id|customer-private-label|test-operator-token/u);
});

test('schema probe returns only sanitized API error code', async () => {
  const handle = createTikTokAdsLarkSchemaHttpHandler({
    hydrate: async () => ({ ...env, LARK_TABLE_MKT_ADS_DAILY: 'tblScopedDaily' }),
    createClient: () => ({ async listFields() { const error = new Error('secret API payload'); error.code = 'LARK_REJECTED'; throw error; } }),
  });
  const response = await handle(request());
  assert.equal(response.status, 502);
  assert.deepEqual(await response.json(), { ok: false, code: 'LARK_REJECTED' });
});
