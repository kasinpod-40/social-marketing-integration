import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH,
  createWooCommerceProviderDiagnosticsHttpHandler,
} from '../../apps/sync-worker/src/woocommerce-provider-diagnostics-http.js';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';
const OPERATOR_TOKEN = 'operator-token-fixture-1234567890';
const BASE_ENV = Object.freeze({
  MKT_ENV: 'development',
  MKT_CUSTOMER_PROFILE: 'integration_workspace',
  MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
  MKT_CONNECTION_OPERATOR_TOKEN: OPERATOR_TOKEN,
  [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG]: 'true',
  WOOCOMMERCE_BASE_URL: 'https://chemistryk.online',
  WOOCOMMERCE_CONSUMER_KEY: 'ck_fixture123',
  WOOCOMMERCE_CONSUMER_SECRET: 'cs_fixture123',
  WOOCOMMERCE_API_VERSION: 'wc/v3',
  WOOCOMMERCE_API_TIMEOUT_MS: '45000',
  WOOCOMMERCE_DEFAULT_CURRENCY: 'THB',
});

function request(token = OPERATOR_TOKEN) {
  return new Request(`https://worker.example.test${WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH}`, {
    method: 'GET',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function handler(createClient) {
  return createWooCommerceProviderDiagnosticsHttpHandler({
    createClient,
    readRuntimeVersionId: () => VERSION_ID,
  });
}

test('disabled Worker diagnostics route is 404 and does not create a Provider client', async () => {
  let clientCalls = 0;
  const handle = handler(() => {
    clientCalls += 1;
    return { getStoreIdentity: async () => ({}) };
  });
  const response = await handle({
    request: request(),
    env: { ...BASE_ENV, [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG]: 'false' },
    url: new URL(request().url),
  });
  assert.equal(response.status, 404);
  assert.equal(clientCalls, 0);
});

test('enabled Worker diagnostics route rejects unauthenticated access before Provider', async () => {
  let clientCalls = 0;
  const handle = handler(() => {
    clientCalls += 1;
    return { getStoreIdentity: async () => ({}) };
  });
  const unauthenticated = request(null);
  const response = await handle({ request: unauthenticated, env: BASE_ENV, url: new URL(unauthenticated.url) });
  assert.equal(response.status, 401);
  assert.equal(clientCalls, 0);
  assert.equal(response.headers.get('x-mkt-worker-version'), VERSION_ID);
});

test('diagnostic-only Worker window performs exactly one read and returns bounded store identity', async () => {
  let providerCalls = 0;
  const handle = handler(() => ({
    async getStoreIdentity() {
      providerCalls += 1;
      return {
        wcVersion: '10.1.0',
        wpVersion: '6.9',
        timezone: 'Asia/Bangkok',
        currency: 'THB',
        numberOfDecimals: 2,
      };
    },
  }));
  const authenticated = request();
  const response = await handle({ request: authenticated, env: BASE_ENV, url: new URL(authenticated.url) });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(providerCalls, 1);
  assert.equal(body.providerRequestCount, 1);
  assert.equal(body.queueMessageCount, 0);
  assert.equal(body.businessMutationCount, 0);
  assert.deepEqual(body.store, {
    wcVersion: '10.1.0',
    wpVersion: '6.9',
    timezone: 'Asia/Bangkok',
    currency: 'THB',
    numberOfDecimals: 2,
  });
});

test('invalid JSON response exposes only allowlisted structural evidence', async () => {
  const responseBody = '<html>private provider message</html>';
  const credential = 'ck_should_never_escape';
  const handle = handler(() => ({
    async getStoreIdentity() {
      const error = new Error('WooCommerce returned invalid JSON');
      error.code = 'WOOCOMMERCE_INVALID_JSON';
      error.details = {
        resource: 'system_status',
        responseStatus: 200,
        contentType: 'text/html; charset=UTF-8',
        contentEncoding: 'br',
        contentLengthHeader: 37,
        bodyByteLength: 37,
        bodySha256: 'a'.repeat(64),
        bodyShape: 'html_or_xml',
        bomRemoved: false,
        responseBody,
        authorization: credential,
        headers: { cookie: credential },
      };
      throw error;
    },
  }));
  const authenticated = request();
  const response = await handle({ request: authenticated, env: BASE_ENV, url: new URL(authenticated.url) });
  const body = await response.json();
  const serialized = JSON.stringify(body);
  assert.equal(response.status, 422);
  assert.equal(body.code, 'WOOCOMMERCE_INVALID_JSON');
  assert.equal(body.providerRequestCount, 1);
  assert.equal(body.failureDiagnostics.responseDiagnostics.bodyShape, 'html_or_xml');
  assert.equal(serialized.includes(responseBody), false);
  assert.equal(serialized.includes(credential), false);
  assert.equal(serialized.includes('responseBody'), false);
  assert.equal(serialized.includes('authorization'), false);
  assert.equal(serialized.includes('cookie'), false);
});

test('any additional true MKT execution flag blocks before Provider', async () => {
  let clientCalls = 0;
  const handle = handler(() => {
    clientCalls += 1;
    return { getStoreIdentity: async () => ({}) };
  });
  const authenticated = request();
  const response = await handle({
    request: authenticated,
    env: { ...BASE_ENV, MKT_WOOCOMMERCE_D1_WRITE_ENABLED: 'true' },
    url: new URL(authenticated.url),
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_FLAGS_UNSAFE');
  assert.equal(body.providerRequestCount, 0);
  assert.equal(clientCalls, 0);
});
