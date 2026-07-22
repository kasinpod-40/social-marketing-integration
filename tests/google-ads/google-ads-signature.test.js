import test from 'node:test';
import assert from 'node:assert/strict';
import { GOOGLE_ADS_MAX_BODY_BYTES } from '../../packages/application/src/google-ads/signed-delivery-contract.js';
import {
  createGoogleAdsSigningInput,
  hmacSha256Hex,
  sha256Hex,
  verifyGoogleAdsSignedRequest,
} from '../../packages/connectors/src/google-ads/google-ads-signature.js';
import { createGoogleAdsDeliveryEnvelope } from '../helpers/google-ads-delivery-fixture.js';

const SECRET = '0123456789abcdef0123456789abcdef';
const KEY_ID = 'uat-key-2026-01';
const NOW = 1_753_185_600_000;

async function signedRequest(options = {}) {
  const body = options.body ?? JSON.stringify(createGoogleAdsDeliveryEnvelope());
  const timestamp = options.timestamp ?? String(Math.floor(NOW / 1000));
  const nonce = options.nonce ?? 'abcdefghijklmnopqrstuv';
  const idempotencyKey = options.idempotencyKey ?? 'google-ads:123e4567-e89b-42d3-a456-426614174000';
  const digest = await sha256Hex(body);
  const input = createGoogleAdsSigningInput({ timestamp, nonce, idempotencyKey, contentSha256: digest });
  const signature = `sha256=${await hmacSha256Hex(SECRET, input)}`;
  const headers = new Headers({
    'content-type': 'application/json',
    'x-mkt-key-id': KEY_ID,
    'x-mkt-timestamp': timestamp,
    'x-mkt-nonce': nonce,
    'x-mkt-idempotency-key': idempotencyKey,
    'x-mkt-content-sha256': options.digest ?? digest,
    'x-mkt-signature': options.signature ?? signature,
  });
  if (options.deleteHeader) headers.delete(options.deleteHeader);
  if (options.duplicateHeader) headers.append(options.duplicateHeader, headers.get(options.duplicateHeader));
  return new Request(options.url ?? 'https://example.test/v1/google-ads/deliveries', { method: 'POST', headers, body });
}

test('accepts a valid HMAC over the exact raw body', async () => {
  const result = await verifyGoogleAdsSignedRequest({
    request: await signedRequest(),
    env: { MKT_GOOGLE_ADS_SIGNING_KEY_ID: KEY_ID, MKT_GOOGLE_ADS_SIGNING_SECRET: SECRET },
    now: () => NOW,
  });
  assert.equal(result.headers.keyId, KEY_ID);
  assert.equal(result.body.customerId, '5662332033');
});


test('accepts the previous signing key during bounded rotation', async () => {
  const result = await verifyGoogleAdsSignedRequest({
    request: await signedRequest(),
    env: {
      MKT_GOOGLE_ADS_SIGNING_KEY_ID: 'new-key',
      MKT_GOOGLE_ADS_SIGNING_SECRET: 'new-secret-0123456789abcdef012345',
      MKT_GOOGLE_ADS_PREVIOUS_SIGNING_KEY_ID: KEY_ID,
      MKT_GOOGLE_ADS_PREVIOUS_SIGNING_SECRET: SECRET,
    },
    now: () => NOW,
  });
  assert.equal(result.headers.keyId, KEY_ID);
});

test('rejects timestamps outside the window in either direction', async () => {
  for (const offset of [-301, 301]) {
    await assert.rejects(
      verifyGoogleAdsSignedRequest({
        request: await signedRequest({ timestamp: String(Math.floor(NOW / 1000) + offset) }),
        env: { MKT_GOOGLE_ADS_SIGNING_KEY_ID: KEY_ID, MKT_GOOGLE_ADS_SIGNING_SECRET: SECRET },
        now: () => NOW,
      }),
      (error) => error.code === 'GOOGLE_ADS_DELIVERY_TIMESTAMP_EXPIRED',
    );
  }
});

test('rejects a body larger than the exact transport limit before JSON parsing', async () => {
  await assert.rejects(
    verifyGoogleAdsSignedRequest({
      request: await signedRequest({ body: 'x'.repeat(GOOGLE_ADS_MAX_BODY_BYTES + 1) }),
      env: { MKT_GOOGLE_ADS_SIGNING_KEY_ID: KEY_ID, MKT_GOOGLE_ADS_SIGNING_SECRET: SECRET },
      now: () => NOW,
    }),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_LIMIT_EXCEEDED',
  );
});

test('rejects invalid signature and a tampered body digest', async () => {
  await assert.rejects(
    verifyGoogleAdsSignedRequest({
      request: await signedRequest({ signature: `sha256=${'0'.repeat(64)}` }),
      env: { MKT_GOOGLE_ADS_SIGNING_KEY_ID: KEY_ID, MKT_GOOGLE_ADS_SIGNING_SECRET: SECRET }, now: () => NOW,
    }),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID',
  );
  await assert.rejects(
    verifyGoogleAdsSignedRequest({
      request: await signedRequest({ digest: 'f'.repeat(64) }),
      env: { MKT_GOOGLE_ADS_SIGNING_KEY_ID: KEY_ID, MKT_GOOGLE_ADS_SIGNING_SECRET: SECRET }, now: () => NOW,
    }),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_DIGEST_INVALID',
  );
});

test('rejects missing and duplicate required headers', async () => {
  await assert.rejects(
    verifyGoogleAdsSignedRequest({ request: await signedRequest({ deleteHeader: 'x-mkt-nonce' }), env: {}, now: () => NOW }),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_HEADER_MISSING',
  );
  await assert.rejects(
    verifyGoogleAdsSignedRequest({ request: await signedRequest({ duplicateHeader: 'x-mkt-nonce' }), env: {}, now: () => NOW }),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_HEADER_DUPLICATE',
  );
});

test('rejects expired timestamps before key use', async () => {
  await assert.rejects(
    verifyGoogleAdsSignedRequest({
      request: await signedRequest({ timestamp: String(Math.floor(NOW / 1000) - 301) }),
      env: { MKT_GOOGLE_ADS_SIGNING_KEY_ID: KEY_ID, MKT_GOOGLE_ADS_SIGNING_SECRET: SECRET }, now: () => NOW,
    }),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_TIMESTAMP_EXPIRED',
  );
});


test('rejects a query string because the signed route is exact', async () => {
  await assert.rejects(
    verifyGoogleAdsSignedRequest({
      request: await signedRequest({ url: 'https://example.test/v1/google-ads/deliveries?unexpected=1' }),
      env: { MKT_GOOGLE_ADS_SIGNING_KEY_ID: KEY_ID, MKT_GOOGLE_ADS_SIGNING_SECRET: SECRET },
      now: () => NOW,
    }),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID',
  );
});
