import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_PATH,
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV,
  createWooCommerceProviderDiagnosticsHttpHandler,
} from '../../apps/sync-worker/src/woocommerce-provider-diagnostics-http.js';

const VERSION_ID = '11111111-1111-4111-8111-111111111111';
const EPHEMERAL_TOKEN = 'ephemeral-token-fixture-12345678901234567890';
const TOKEN_SHA256 = createHash('sha256').update(EPHEMERAL_TOKEN).digest('hex');
const DEPLOYMENT_ATTESTATION = 'd'.repeat(64);
const BASE_ENV = Object.freeze({
  MKT_ENV: 'development',
  MKT_CUSTOMER_PROFILE: 'integration_workspace',
  MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
  [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_TOKEN_SHA256_ENV]: TOKEN_SHA256,
  [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV]: DEPLOYMENT_ATTESTATION,
  [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG]: 'true',
  WOOCOMMERCE_BASE_URL: 'https://chemistryk.online',
  WOOCOMMERCE_CONSUMER_KEY: 'ck_fixture123',
  WOOCOMMERCE_CONSUMER_SECRET: 'cs_fixture123',
  WOOCOMMERCE_API_VERSION: 'wc/v3',
  WOOCOMMERCE_API_TIMEOUT_MS: '45000',
  WOOCOMMERCE_DEFAULT_CURRENCY: 'THB',
});

function request(token = EPHEMERAL_TOKEN) {
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

function assertAttested(response) {
  assert.equal(
    response.headers.get(WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER),
    DEPLOYMENT_ATTESTATION,
  );
}

test('disabled Worker diagnostics route is attested 404 and does not create a Provider client', async () => {
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
  assertAttested(response);
  assert.equal(clientCalls, 0);
});

test('enabled Worker diagnostics route rejects missing or wrong token with deployment attestation before Provider', async () => {
  let clientCalls = 0;
  const handle = handler(() => {
    clientCalls += 1;
    return { getStoreIdentity: async () => ({}) };
  });
  for (const token of [null, 'wrong-token-fixture-12345678901234567890']) {
    const unauthorized = request(token);
    const response = await handle({
      request: unauthorized,
      env: BASE_ENV,
      url: new URL(unauthorized.url),
    });
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('x-mkt-worker-version-id'), VERSION_ID);
    assertAttested(response);
  }
  assert.equal(clientCalls, 0);
});

test('missing deployment attestation fails before Provider without fabricating an attestation header', async () => {
  let clientCalls = 0;
  const handle = handler(() => {
    clientCalls += 1;
    return { getStoreIdentity: async () => ({}) };
  });
  const authenticated = request();
  const env = { ...BASE_ENV };
  delete env[WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_ENV];
  const response = await handle({ request: authenticated, env, url: new URL(authenticated.url) });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIG_INVALID');
  assert.equal(response.headers.get(WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER), null);
  assert.equal(clientCalls, 0);
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
  const serialized = JSON.stringify(body);
  assert.equal(response.status, 200);
  assertAttested(response);
  assert.equal(providerCalls, 1);
  assert.equal(body.providerRequestCount, 1);
  assert.equal(body.queueMessageCount, 0);
  assert.equal(body.businessMutationCount, 0);
  assert.equal(body.workerDeploymentCount, 0);
  assert.equal(serialized.includes(EPHEMERAL_TOKEN), false);
  assert.equal(serialized.includes(TOKEN_SHA256), false);
  assert.equal(serialized.includes(DEPLOYMENT_ATTESTATION), false);
  assert.deepEqual(body.store, {
    wcVersion: '10.1.0',
    wpVersion: '6.9',
    timezone: 'Asia/Bangkok',
    currency: 'THB',
    numberOfDecimals: 2,
  });
});

test('invalid JSON response exposes only allowlisted structural evidence with attestation', async () => {
  const responseBody = '<html>private provider message</html>';
  const credential = 'ck_should_never_escape';
  const handle = handler(() => ({
    async getStoreIdentity() {
      const error = new Error('WooCommerce returned invalid JSON');
      error.code = 'WOOCOMMERCE_INVALID_JSON';
      error.details = {
        resource: 'system_status',
        responseStatus: 200,
        responseRedirected: true,
        responseUrlPresent: true,
        responseOriginMatchesSource: true,
        responsePathMatchesResource: false,
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
  assertAttested(response);
  assert.equal(body.code, 'WOOCOMMERCE_INVALID_JSON');
  assert.equal(body.providerRequestCount, 1);
  assert.equal(body.workerDeploymentCount, 0);
  assert.equal(body.failureDiagnostics.responseDiagnostics.bodyShape, 'html_or_xml');
  assert.equal(body.failureDiagnostics.responseDiagnostics.responseRedirected, true);
  assert.equal(body.failureDiagnostics.responseDiagnostics.responseUrlPresent, true);
  assert.equal(body.failureDiagnostics.responseDiagnostics.responseOriginMatchesSource, true);
  assert.equal(body.failureDiagnostics.responseDiagnostics.responsePathMatchesResource, false);
  assert.equal(serialized.includes(responseBody), false);
  assert.equal(serialized.includes(credential), false);
  assert.equal(serialized.includes(EPHEMERAL_TOKEN), false);
  assert.equal(serialized.includes(TOKEN_SHA256), false);
  assert.equal(serialized.includes(DEPLOYMENT_ATTESTATION), false);
  assert.equal(serialized.includes('responseBody'), false);
  assert.equal(serialized.includes('authorization'), false);
  assert.equal(serialized.includes('cookie'), false);
});

test('any additional true MKT execution flag blocks before Provider and remains attested', async () => {
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
  assertAttested(response);
  assert.equal(body.code, 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_FLAGS_UNSAFE');
  assert.equal(body.providerRequestCount, 0);
  assert.equal(body.workerDeploymentCount, 0);
  assert.equal(clientCalls, 0);
});
