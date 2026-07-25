import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createGoogleAdsSigningSecretProvisioningHttpHandler,
} from '../../apps/api-worker/src/google-ads-signing-secret-provisioning-http.js';
import {
  createGoogleAdsSigningProvisioningIdentityFingerprint,
  createGoogleAdsSigningProvisioningTicket,
  signGoogleAdsSigningProvisioningConfirmation,
} from '../../packages/application/src/google-ads/manager-script-signing-secret-provisioning-security.js';
import {
  GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH,
  GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH,
  GOOGLE_ADS_SIGNING_PROVISIONING_SCHEMA_VERSION,
} from '../../packages/config/src/google-ads-signing-secret-provisioning-contract.js';
import {
  D1GoogleAdsSigningSecretProvisioningStore,
} from '../../packages/connectors/src/google-ads/d1-google-ads-signing-secret-provisioning-store.js';
import { stableSerialize } from '../../packages/shared/src/hash/stable-fingerprint.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL(
  '../../migrations/0014_google_ads_signing_secret_provisioning.sql',
  import.meta.url,
);
const NOW = 1_784_977_200_000;
const SECRET = 'fixture-signing-secret-that-is-longer-than-32-bytes';
const runtimeIdentity = Object.freeze({
  environment: 'development',
  profileKey: 'integration_workspace',
  managerCustomerId: '1111111111',
  customerId: '2222222222',
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  keyId: 'fixture-key-v1',
});

function body(overrides = {}) {
  return {
    schemaVersion: GOOGLE_ADS_SIGNING_PROVISIONING_SCHEMA_VERSION,
    managerCustomerId: runtimeIdentity.managerCustomerId,
    customerId: runtimeIdentity.customerId,
    customerKey: runtimeIdentity.customerKey,
    accountKey: runtimeIdentity.accountKey,
    keyId: runtimeIdentity.keyId,
    clientNonce: 'a'.repeat(22),
    ...overrides,
  };
}

test('disabled provisioning routes return 404 before loading D1 or Signing Secret', async () => {
  const handler = createGoogleAdsSigningSecretProvisioningHttpHandler({
    createStore() { throw new Error('D1 must not load'); },
    loadSigningSecret() { throw new Error('Secret must not load'); },
  });
  const request = new Request(`https://api.example.test${GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH}`, {
    method: 'POST', body: '{}', headers: { 'content-type': 'application/json' },
  });
  const response = await handler({
    request,
    env: { MKT_GOOGLE_ADS_SECRET_PROVISIONING_ENABLED: 'false' },
    url: new URL(request.url),
  });
  assert.equal(response.status, 404);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(await response.json(), { ok: false, error: 'Route not found' });
});

test('redeem returns the Signing Secret once, then confirmation returns only sanitized status', async () => {
  const fixture = await createFixture();
  const original = console.error;
  const logs = [];
  console.error = (value) => logs.push(value);
  try {
    const redeemResponse = await fixture.request(
      GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH,
      body(),
    );
    assert.equal(redeemResponse.status, 200);
    const redeemed = await redeemResponse.json();
    assert.deepEqual(Object.keys(redeemed).sort(), [
      'challenge', 'keyId', 'ok', 'signingSecret', 'status',
    ]);
    assert.equal(redeemed.signingSecret, SECRET);

    const replay = await fixture.request(
      GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH,
      body(),
    );
    assert.equal(replay.status, 409);
    const replayBody = await replay.json();
    assert.equal(replayBody.code, 'GOOGLE_ADS_PROVISIONING_TICKET_UNUSABLE');
    assert.equal(JSON.stringify(replayBody).includes(SECRET), false);

    const proof = await signGoogleAdsSigningProvisioningConfirmation({
      keyId: runtimeIdentity.keyId,
      clientNonce: 'a'.repeat(22),
      challenge: redeemed.challenge,
      signingSecret: SECRET,
    });
    const confirmed = await fixture.request(
      GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH,
      body({ challenge: redeemed.challenge }),
      proof,
    );
    assert.equal(confirmed.status, 200);
    assert.deepEqual(await confirmed.json(), { ok: true, status: 'confirmed' });
    const row = fixture.d1.database.prepare(`
      SELECT status, confirmed_at FROM google_ads_signing_provisioning_tickets
    `).get();
    assert.equal(row.status, 'confirmed');
    assert.ok(row.confirmed_at);
    assert.equal(logs.join('\n').includes(SECRET), false);
    assert.equal(logs.join('\n').includes(fixture.ticket.ticket), false);
  } finally {
    console.error = original;
    fixture.d1.close();
  }
});

test('tampered confirmation proof fails without changing redeemed state', async () => {
  const fixture = await createFixture();
  const original = console.error;
  console.error = () => {};
  try {
    const redeemed = await (await fixture.request(
      GOOGLE_ADS_SIGNING_PROVISIONING_REDEEM_PATH,
      body(),
    )).json();
    const response = await fixture.request(
      GOOGLE_ADS_SIGNING_PROVISIONING_CONFIRM_PATH,
      body({ challenge: redeemed.challenge }),
      `sha256=${'0'.repeat(64)}`,
    );
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'GOOGLE_ADS_PROVISIONING_PROOF_INVALID');
    assert.equal(
      fixture.d1.database.prepare(`
        SELECT status FROM google_ads_signing_provisioning_tickets
      `).get().status,
      'redeemed',
    );
  } finally {
    console.error = original;
    fixture.d1.close();
  }
});

async function createFixture() {
  const d1 = createSqliteD1();
  d1.exec(await readFile(MIGRATION_URL, 'utf8'));
  const store = new D1GoogleAdsSigningSecretProvisioningStore({ db: d1, now: () => NOW });
  const ticket = await createGoogleAdsSigningProvisioningTicket();
  await store.createTicket({
    ticketFingerprint: ticket.ticketFingerprint,
    identityFingerprint: await createGoogleAdsSigningProvisioningIdentityFingerprint(runtimeIdentity),
    keyId: runtimeIdentity.keyId,
    createdAt: NOW,
    expiresAt: NOW + 300_000,
  });
  const env = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_GOOGLE_ADS_SECRET_PROVISIONING_ENABLED: 'true',
    MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID: runtimeIdentity.managerCustomerId,
    MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID: runtimeIdentity.customerId,
    MKT_GOOGLE_ADS_SIGNING_KEY_ID: runtimeIdentity.keyId,
    MKT_GOOGLE_ADS_SIGNING_SECRET: SECRET,
    MKT_STATE_DB: d1,
  };
  const handler = createGoogleAdsSigningSecretProvisioningHttpHandler({
    now: () => NOW + 1,
    createStore: () => store,
  });
  return {
    d1, env, handler, ticket,
    async request(path, payload, proof = null) {
      const headers = {
        'content-type': 'application/json',
        authorization: `Bearer ${ticket.ticket}`,
        ...(proof ? { 'x-mkt-provisioning-proof': proof } : {}),
      };
      const request = new Request(`https://api.example.test${path}`, {
        method: 'POST', headers, body: stableSerialize(payload),
      });
      return handler({ request, env, url: new URL(request.url) });
    },
  };
}
