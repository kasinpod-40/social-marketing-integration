import test from 'node:test';
import assert from 'node:assert/strict';
import {
  verifyGoogleAdsManagerSignedDelivery,
} from '../../packages/application/src/google-ads/manager-script-signed-delivery-security.js';
import {
  GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
  GOOGLE_ADS_DELIVERY_FIXTURE_SECRET,
  createGoogleAdsDeliveryEnvelope,
  createSignedGoogleAdsDeliveryRequest,
} from '../helpers/google-ads-manager-delivery-fixture.js';

test('verifies a canonical current-key request and returns no raw nonce or secret', async () => {
  const request = await createSignedGoogleAdsDeliveryRequest();
  const verified = await verifyGoogleAdsManagerSignedDelivery(request);
  assert.equal(verified.envelope.dataset.key, 'account');
  assert.equal(verified.keySlot, 'current');
  assert.match(verified.nonceFingerprint, /^[A-Za-z0-9_-]{43}$/u);
  assert.equal(verified.idempotencyKey.endsWith(':account:0'), true);
  assert.equal(JSON.stringify(verified).includes('abcdefghijklmnopqrstuv'), false);
  assert.equal(JSON.stringify(verified).includes(GOOGLE_ADS_DELIVERY_FIXTURE_SECRET), false);
});

test('accepts the previous key during bounded rotation', async () => {
  const secret = 'previous-fixture-signing-secret-with-32-plus-bytes';
  const request = await createSignedGoogleAdsDeliveryRequest({
    keyId: 'fixture-key-v0',
    secret,
    keyring: {
      current: {
        keyId: 'fixture-key-v1',
        secret: GOOGLE_ADS_DELIVERY_FIXTURE_SECRET,
      },
      previous: {
        keyId: 'fixture-key-v0',
        secret,
      },
    },
  });
  const verified = await verifyGoogleAdsManagerSignedDelivery(request);
  assert.equal(verified.keySlot, 'previous');
});

test('rejects body and signature tampering before parsing business fields', async () => {
  const request = await createSignedGoogleAdsDeliveryRequest();
  await assert.rejects(
    () => verifyGoogleAdsManagerSignedDelivery({
      ...request,
      body: `${request.body} `,
    }),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_DIGEST_INVALID',
  );

  const signature = request.headers['x-mkt-signature'];
  const replacement = signature.endsWith('a') ? 'b' : 'a';
  await assert.rejects(
    () => verifyGoogleAdsManagerSignedDelivery({
      ...request,
      headers: {
        ...request.headers,
        'x-mkt-signature': `${signature.slice(0, -1)}${replacement}`,
      },
    }),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID',
  );
});

test('rejects unknown key IDs without exposing key resolution details', async () => {
  const request = await createSignedGoogleAdsDeliveryRequest();
  await assert.rejects(
    () => verifyGoogleAdsManagerSignedDelivery({
      ...request,
      keyring: {
        current: {
          keyId: 'another-key',
          secret: GOOGLE_ADS_DELIVERY_FIXTURE_SECRET,
        },
      },
    }),
    (error) => (
      error?.code === 'GOOGLE_ADS_DELIVERY_SIGNATURE_INVALID'
      && !JSON.stringify(error).includes('another-key')
    ),
  );
});

test('rejects stale/future timestamps and fetchedAt mismatch', async () => {
  for (const now of [
    GOOGLE_ADS_DELIVERY_FIXTURE_NOW + 301_000,
    GOOGLE_ADS_DELIVERY_FIXTURE_NOW - 301_000,
  ]) {
    const request = await createSignedGoogleAdsDeliveryRequest({ now });
    await assert.rejects(
      () => verifyGoogleAdsManagerSignedDelivery(request),
      (error) => error?.code === 'GOOGLE_ADS_DELIVERY_TIMESTAMP_INVALID',
    );
  }

  const envelope = createGoogleAdsDeliveryEnvelope({
    fetchedAt: '2026-07-25T03:50:00.000Z',
  });
  const request = await createSignedGoogleAdsDeliveryRequest({ envelope });
  await assert.rejects(
    () => verifyGoogleAdsManagerSignedDelivery(request),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_CONTRACT_INVALID',
  );
});

test('rejects duplicate/comma-joined headers, invalid target and noncanonical JSON', async () => {
  const request = await createSignedGoogleAdsDeliveryRequest();
  await assert.rejects(
    () => verifyGoogleAdsManagerSignedDelivery({
      ...request,
      headers: {
        ...request.headers,
        'x-mkt-key-id': ['fixture-key-v1', 'fixture-key-v1'],
      },
    }),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID',
  );
  await assert.rejects(
    () => verifyGoogleAdsManagerSignedDelivery({
      ...request,
      url: `${request.url}?unexpected=true`,
    }),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_REQUEST_INVALID',
  );

  const noncanonical = JSON.stringify(createGoogleAdsDeliveryEnvelope(), null, 2);
  const noncanonicalRequest = await createSignedGoogleAdsDeliveryRequest({
    body: noncanonical,
  });
  await assert.rejects(
    () => verifyGoogleAdsManagerSignedDelivery(noncanonicalRequest),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_BODY_INVALID',
  );
});

test('rejects idempotency/body mismatch after signature verification', async () => {
  const request = await createSignedGoogleAdsDeliveryRequest({
    idempotencyKey: 'google-ads:123e4567-e89b-42d3-a456-426614174000:campaigns:0',
  });
  await assert.rejects(
    () => verifyGoogleAdsManagerSignedDelivery(request),
    (error) => error?.code === 'GOOGLE_ADS_DELIVERY_IDEMPOTENCY_CONFLICT',
  );
});
