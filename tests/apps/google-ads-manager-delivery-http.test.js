import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createGoogleAdsManagerDeliveryHttpHandler,
} from '../../apps/api-worker/src/google-ads-manager-delivery-http.js';
import { D1GoogleAdsManagerDeliveryStore } from '../../packages/connectors/src/google-ads/d1-google-ads-manager-delivery-store.js';
import {
  GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS,
} from '../../packages/config/src/google-ads-manager-script-delivery-contract.js';
import {
  GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
  GOOGLE_ADS_DELIVERY_FIXTURE_SECRET,
  createGoogleAdsDeliveryEnvelope,
  createGoogleAdsDeliveryManifest,
  createSignedGoogleAdsDeliveryRequest,
  googleAdsDatasetRows,
} from '../helpers/google-ads-manager-delivery-fixture.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL(
  '../../migrations/0013_google_ads_signed_delivery_transport.sql',
  import.meta.url,
);

test('disabled signed ingress is fail-closed without loading D1 or Secrets', async () => {
  const handler = createGoogleAdsManagerDeliveryHttpHandler({
    createStore() {
      throw new Error('store must not load while ingress is disabled');
    },
  });
  const request = new Request(
    'https://ingress.example.test/v1/google-ads/manager-script/deliveries',
    { method: 'POST', body: '{}' },
  );
  const response = await handler({
    request,
    env: { MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED: 'false' },
    url: new URL(request.url),
  });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { ok: false, error: 'Route not found' });
});

test('signed PREVIEW reserves nonce, validates the run and redacts staged payload', async () => {
  const fixture = await createHandlerFixture();
  const original = console.error;
  console.error = () => {};
  try {
    const signed = await createApiSignedRequest();
    const first = await fixture.handle(signed);
    assert.equal(first.status, 200);
    assert.deepEqual(await first.json(), {
      ok: true,
      status: 'preview_validated',
      disposition: 'staged',
      runFingerprint: await runFingerprint(),
      receivedChunks: 1,
      expectedChunks: 1,
      receivedRows: 1,
      expectedRows: 1,
      datasets: {
        account: { chunks: 1, rows: 1 },
        campaigns: { chunks: 0, rows: 0 },
        assetGroups: { chunks: 0, rows: 0 },
        adGroups: { chunks: 0, rows: 0 },
        ads: { chunks: 0, rows: 0 },
        youtubeAssets: { chunks: 0, rows: 0 },
        campaignDailyMetrics: { chunks: 0, rows: 0 },
      },
    });
    const row = fixture.d1.database.prepare(`
      SELECT status, payload_redacted_at
      FROM google_ads_delivery_runs
    `).get();
    assert.equal(row.status, 'preview_validated');
    assert.ok(row.payload_redacted_at);
    assert.equal(
      fixture.d1.database.prepare(`
        SELECT payload_json FROM google_ads_delivery_chunks
      `).get().payload_json,
      null,
    );

    const retry = await createApiSignedRequest({
      nonce: 'bbbbbbbbbbbbbbbbbbbbbb',
    });
    const replay = await fixture.handle(retry);
    assert.equal(replay.status, 200);
    assert.equal((await replay.json()).disposition, 'exact_retry');
    assert.equal(
      fixture.d1.database.prepare(`
        SELECT received_chunk_count FROM google_ads_delivery_runs
      `).get().received_chunk_count,
      1,
    );

    const nonceReplay = await fixture.handle(signed);
    assert.equal(nonceReplay.status, 409);
    assert.equal((await nonceReplay.json()).code, 'GOOGLE_ADS_DELIVERY_NONCE_REPLAYED');
  } finally {
    console.error = original;
    fixture.d1.close();
  }
});

test('signed ingress rejects oversized bodies before digest parsing', async () => {
  const fixture = await createHandlerFixture();
  const original = console.error;
  console.error = () => {};
  try {
    const signed = await createApiSignedRequest();
    const request = new Request(signed.url, {
      method: signed.method,
      headers: signed.headers,
      body: 'x'.repeat(GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.bodyBytes + 1),
    });
    const response = await fixture.handler({
      request,
      env: fixture.env,
      url: new URL(request.url),
    });
    assert.equal(response.status, 413);
    assert.equal((await response.json()).code, 'GOOGLE_ADS_DELIVERY_BODY_TOO_LARGE');
    assert.equal(
      fixture.d1.database.prepare(
        'SELECT COUNT(*) AS total FROM google_ads_delivery_nonces',
      ).get().total,
      0,
    );
  } finally {
    console.error = original;
    fixture.d1.close();
  }
});

test('PREVIEW accepts out-of-order chunks and completes only after global validation', async () => {
  const fixture = await createHandlerFixture();
  try {
    const campaigns = [
      googleAdsDatasetRows('campaigns')[0],
      {
        ...googleAdsDatasetRows('campaigns')[0],
        campaignId: '11',
        campaignName: 'Campaign 11',
        resourceName: 'customers/2222222222/campaigns/11',
      },
    ];
    const manifest = createGoogleAdsDeliveryManifest({
      campaigns: { totalRows: 2, chunkCount: 2 },
    });
    const envelopes = [
      createGoogleAdsDeliveryEnvelope({
        datasetKey: 'campaigns',
        rows: [campaigns[1]],
        manifest,
        chunkIndex: 1,
        chunkCount: 2,
        totalRows: 2,
        customerKey: 'chemistry_k',
        accountKey: 'chemistry_k',
      }),
      createGoogleAdsDeliveryEnvelope({
        manifest,
        customerKey: 'chemistry_k',
        accountKey: 'chemistry_k',
      }),
      createGoogleAdsDeliveryEnvelope({
        datasetKey: 'campaigns',
        rows: [campaigns[0]],
        manifest,
        chunkIndex: 0,
        chunkCount: 2,
        totalRows: 2,
        customerKey: 'chemistry_k',
        accountKey: 'chemistry_k',
      }),
    ];
    const statuses = [];
    for (let index = 0; index < envelopes.length; index += 1) {
      const signed = await createApiSignedRequest({
        envelope: envelopes[index],
        nonce: `${String.fromCharCode(99 + index).repeat(22)}`,
      });
      const response = await fixture.handle(signed);
      statuses.push(response.status);
    }
    assert.deepEqual(statuses, [202, 202, 200]);
    const run = fixture.d1.database.prepare(`
      SELECT status, received_chunk_count, received_row_count
      FROM google_ads_delivery_runs
    `).get();
    assert.deepEqual(run, {
      status: 'preview_validated',
      received_chunk_count: 3,
      received_row_count: 3,
    });
  } finally {
    fixture.d1.close();
  }
});

async function createHandlerFixture() {
  const migration = await readFile(MIGRATION_URL, 'utf8');
  const d1 = createSqliteD1();
  d1.exec(migration);
  let sequence = 0;
  const handler = createGoogleAdsManagerDeliveryHttpHandler({
    now: () => GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
    createStore: () => new D1GoogleAdsManagerDeliveryStore({
      db: d1,
      now: () => GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
    }),
    randomUuid() {
      sequence += 1;
      return `00000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`;
    },
  });
  const env = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED: 'true',
    MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED: 'false',
    MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID: '1111111111',
    MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID: '2222222222',
    MKT_GOOGLE_ADS_SOURCE_TIMEZONE: 'Asia/Bangkok',
    MKT_GOOGLE_ADS_SIGNING_KEY_ID: 'fixture-key-v1',
    MKT_GOOGLE_ADS_SIGNING_SECRET: GOOGLE_ADS_DELIVERY_FIXTURE_SECRET,
    MKT_STATE_DB: d1,
  };
  return {
    d1,
    env,
    handler,
    async handle(signed) {
      const request = new Request(signed.url, {
        method: signed.method,
        headers: signed.headers,
        body: signed.body,
      });
      return handler({ request, env, url: new URL(request.url) });
    },
  };
}

function createApiSignedRequest(options = {}) {
  const { envelope, ...signingOptions } = options;
  return createSignedGoogleAdsDeliveryRequest({
    ...signingOptions,
    envelope: envelope ?? createGoogleAdsDeliveryEnvelope({
      customerKey: 'chemistry_k',
      accountKey: 'chemistry_k',
    }),
  });
}

async function runFingerprint() {
  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode('123e4567-e89b-42d3-a456-426614174000'),
  );
  return Buffer.from(digest).toString('base64url');
}
