import test from 'node:test';
import assert from 'node:assert/strict';
import apiWorker from '../../apps/api-worker/src/index.js';
import { handleGoogleAdsSignedDelivery } from '../../apps/api-worker/src/google-ads-delivery-handler.js';
import {
  createGoogleAdsSigningInput,
  hmacSha256Hex,
  sha256Hex,
} from '../../packages/connectors/src/google-ads/google-ads-signature.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import { createGoogleAdsDeliveryEnvelope } from '../helpers/google-ads-delivery-fixture.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const KEY_ID = 'uat-key-2026-01';
const NOW = Date.now();

async function createRequest(envelope = createGoogleAdsDeliveryEnvelope(), overrides = {}) {
  const body = JSON.stringify(envelope);
  const timestamp = String(Math.floor(NOW / 1000));
  const nonce = overrides.nonce ?? 'abcdefghijklmnopqrstuv';
  const idempotencyKey = `google-ads:${envelope.deliveryId}`;
  const contentSha256 = await sha256Hex(body);
  const signature = `sha256=${await hmacSha256Hex(SECRET, createGoogleAdsSigningInput({
    timestamp, nonce, idempotencyKey, contentSha256,
  }))}`;
  return new Request('https://example.test/v1/google-ads/deliveries', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-mkt-key-id': KEY_ID,
      'x-mkt-timestamp': timestamp,
      'x-mkt-nonce': nonce,
      'x-mkt-idempotency-key': idempotencyKey,
      'x-mkt-content-sha256': contentSha256,
      'x-mkt-signature': signature,
    },
    body,
  });
}

function env() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'uat_chemistry_k',
    MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'true',
    MKT_GOOGLE_ADS_SIGNING_KEY_ID: KEY_ID,
    MKT_GOOGLE_ADS_SIGNING_SECRET: SECRET,
  };
}

function store(status = 'reserved') {
  const calls = [];
  return {
    calls,
    async cleanupRetention(value) { calls.push(['cleanupRetention', value]); },
    async reserveNonce(value) { calls.push(['reserveNonce', value]); },
    async reserveDelivery(value) { calls.push(['reserveDelivery', value]); return { status }; },
    async markPreviewValidated(value) { calls.push(['markPreviewValidated', value]); },
    async markQueued(value) { calls.push(['markQueued', value]); },
    async markQueueFailed(value) { calls.push(['markQueueFailed', value]); },
  };
}

test('LIVE ingress persists only the body and queues a reference-only job', async () => {
  const fakeStore = store();
  const sent = [];
  const response = await handleGoogleAdsSignedDelivery({
    request: await createRequest(), env: env(), now: () => NOW, store: fakeStore,
    queue: { async send(job) { sent.push(job); } },
  });
  assert.equal(response.status, 202);
  assert.equal((await response.json()).status, 'queued');
  assert.deepEqual(Object.keys(sent[0]).sort(), ['deliveryId', 'requestedAt', 'schemaVersion', 'type']);
  assert.equal(JSON.stringify(sent[0]).includes(SECRET), false);
  assert.equal(fakeStore.calls.some(([name]) => name === 'markQueued'), true);
});

test('PREVIEW validates signature/schema/replay but never queues business work', async () => {
  const envelope = createGoogleAdsDeliveryEnvelope({ mode: 'PREVIEW' });
  const fakeStore = store();
  let queueCalls = 0;
  const response = await handleGoogleAdsSignedDelivery({
    request: await createRequest(envelope), env: env(), now: () => NOW, store: fakeStore,
    queue: { async send() { queueCalls += 1; } },
  });
  assert.equal(response.status, 200);
  assert.equal((await response.json()).status, 'preview_validated');
  assert.equal(queueCalls, 0);
  assert.equal(fakeStore.calls.some(([name]) => name === 'markPreviewValidated'), true);
});

test('idempotent queued/retrying/completed deliveries do not enqueue again', async () => {
  for (const status of ['queued', 'processing', 'failed_retryable', 'completed']) {
    let queueCalls = 0;
    const response = await handleGoogleAdsSignedDelivery({
      request: await createRequest(), env: env(), now: () => NOW, store: store(status),
      queue: { async send() { queueCalls += 1; } },
    });
    assert.equal(queueCalls, 0);
    assert.equal((await response.json()).status, 'accepted_idempotent');
  }
});


test('permanent delivery failure cannot be requeued by resending the signed request', async () => {
  let queueCalls = 0;
  const response = await handleGoogleAdsSignedDelivery({
    request: await createRequest(), env: env(), now: () => NOW, store: store('failed_permanent'),
    queue: { async send() { queueCalls += 1; } },
  });
  assert.equal(response.status, 409);
  assert.equal((await response.json()).status, 'terminal_failure');
  assert.equal(queueCalls, 0);
});

test('public Worker maps replay rejection to 409 without leaking the signing secret', async () => {
  const request = await createRequest();
  const response = await apiWorker.fetch(request, {
    ...env(),
    MKT_STATE_DB: {
      prepare(sql) {
        return {
          bind() { return this; },
          async run() {
            return { meta: { changes: /INSERT OR IGNORE INTO google_ads_delivery_nonces/u.test(String(sql)) ? 0 : 1 } };
          },
        };
      },
    },
  }, {});
  const body = await response.json();
  assert.equal(response.status, 409);
  assert.equal(body.code, 'GOOGLE_ADS_DELIVERY_REPLAY_REJECTED');
  assert.equal(JSON.stringify(body).includes(SECRET), false);
});

test('replay rejection from the store is fail-closed before Queue send', async () => {
  let queueCalls = 0;
  const fakeStore = store();
  fakeStore.reserveNonce = async () => { throw permanentError('replayed', { code: 'GOOGLE_ADS_DELIVERY_REPLAY_REJECTED' }); };
  await assert.rejects(
    handleGoogleAdsSignedDelivery({
      request: await createRequest(), env: env(), now: () => NOW, store: fakeStore,
      queue: { async send() { queueCalls += 1; } },
    }),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_REPLAY_REJECTED',
  );
  assert.equal(queueCalls, 0);
});
