import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createGoogleAdsManagerDeliveryHttpHandler,
} from '../../apps/api-worker/src/google-ads-manager-delivery-http.js';
import {
  D1GoogleAdsManagerDeliveryStore,
} from '../../packages/connectors/src/google-ads/d1-google-ads-manager-delivery-store.js';
import {
  GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
  GOOGLE_ADS_DELIVERY_FIXTURE_SECRET,
  createGoogleAdsDeliveryEnvelope,
  createGoogleAdsDeliveryManifest,
  createSignedGoogleAdsDeliveryRequest,
  googleAdsDatasetRows,
} from '../helpers/google-ads-manager-delivery-fixture.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const DATASET_KEYS = Object.freeze([
  'account', 'campaigns', 'adGroups', 'ads', 'youtubeAssets', 'campaignDailyMetrics',
]);

function liveManifest() {
  return createGoogleAdsDeliveryManifest(Object.fromEntries(
    DATASET_KEYS.filter((key) => key !== 'account')
      .map((key) => [key, { totalRows: 1, chunkCount: 1 }]),
  ));
}

function createAdmissionStore() {
  const state = { admission: null };
  return {
    state,
    async reserve(input) {
      if (!state.admission) {
        state.admission = {
          runId: input.runId,
          operationId: input.operationId,
          workKey: input.workKey,
          generation: input.generation,
          originalRequestedAt: input.originalRequestedAt,
          queueBodyDigest: input.queueBodyDigest,
          status: 'live_validated',
          lastErrorCode: null,
        };
        return { disposition: 'reserved', admission: { ...state.admission } };
      }
      assert.equal(input.queueBodyDigest, state.admission.queueBodyDigest);
      return { disposition: 'exact_retry', admission: { ...state.admission } };
    },
    async markSendPending() {
      state.admission.status = 'send_pending';
      return { ...state.admission };
    },
    async markQueued() {
      state.admission.status = 'queued';
      return { ...state.admission };
    },
    async markFailed(input) {
      state.admission.status = input.retryable ? 'failed_retryable' : 'failed_permanent';
      state.admission.lastErrorCode = input.errorCode;
      return { ...state.admission };
    },
  };
}

function deliveryEnvelope(options) {
  return createGoogleAdsDeliveryEnvelope({
    ...options,
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
  });
}

test('validated LIVE run queues one exact reference and exact retry does not send again', async () => {
  const migration = await readFile(
    new URL('../../migrations/0013_google_ads_signed_delivery_transport.sql', import.meta.url),
    'utf8',
  );
  const d1 = createSqliteD1();
  d1.exec(migration);
  const admissionStore = createAdmissionStore();
  const queued = [];
  let uuidSequence = 0;
  const handler = createGoogleAdsManagerDeliveryHttpHandler({
    now: () => GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
    createStore: () => new D1GoogleAdsManagerDeliveryStore({
      db: d1,
      now: () => GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
    }),
    createAdmissionStore: () => admissionStore,
    createConnectionStore: () => ({
      async findValidatedConnection() {
        return {
          connectionId: 'connection-validated',
          customerKey: 'chemistry_k',
          connectorKey: 'google_ads',
          advertiserCustomerId: '2222222222',
          connectionStatus: 'connected',
          accessStatus: 'validated',
          grantedScopes: ['https://www.googleapis.com/auth/adwords'],
          credentialReference: 'credential-reference',
          activeCredentialReference: 'credential-reference',
          credentialKeyVersion: 'v1',
          providerMetadata: {
            managerCustomerId: '1111111111',
            currencyCode: 'THB',
            timeZone: 'Asia/Bangkok',
          },
          lastValidatedAt: GOOGLE_ADS_DELIVERY_FIXTURE_NOW - 1_000,
        };
      },
    }),
    createQueue: () => ({
      async send(body) { queued.push(structuredClone(body)); },
    }),
    randomUuid() {
      uuidSequence += 1;
      return `00000000-0000-4000-8000-${String(uuidSequence).padStart(12, '0')}`;
    },
  });
  const env = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'true',
    MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED: 'true',
    MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED: 'true',
    MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED: 'true',
    MKT_GOOGLE_ADS_LARK_WRITE_ENABLED: 'true',
    MKT_SCHEDULE_GOOGLE_ADS_ENABLED: 'false',
    MKT_GOOGLE_ADS_MANAGER_CUSTOMER_ID: '1111111111',
    MKT_GOOGLE_ADS_ADVERTISER_CUSTOMER_ID: '2222222222',
    MKT_GOOGLE_ADS_SOURCE_TIMEZONE: 'Asia/Bangkok',
    MKT_GOOGLE_ADS_SIGNING_KEY_ID: 'fixture-key-v1',
    MKT_GOOGLE_ADS_SIGNING_SECRET: GOOGLE_ADS_DELIVERY_FIXTURE_SECRET,
    MKT_STATE_DB: d1,
  };
  const manifest = liveManifest();
  let finalResponse;
  try {
    for (let index = 0; index < DATASET_KEYS.length; index += 1) {
      const datasetKey = DATASET_KEYS[index];
      const envelope = deliveryEnvelope({
        runId: RUN_ID,
        mode: 'LIVE',
        datasetKey,
        rows: googleAdsDatasetRows(datasetKey),
        manifest,
      });
      const signed = await createSignedGoogleAdsDeliveryRequest({
        envelope,
        nonce: String.fromCharCode(97 + index).repeat(22),
      });
      finalResponse = await handler({
        request: new Request(signed.url, {
          method: signed.method,
          headers: signed.headers,
          body: signed.body,
        }),
        env,
        url: new URL(signed.url),
      });
      assert.equal(finalResponse.status, 202);
    }

    assert.equal((await finalResponse.json()).status, 'queued');
    assert.equal(queued.length, 1);
    assert.deepEqual(Object.keys(queued[0]).sort(), [
      'generation', 'operationId', 'originalRequestedAt', 'requestedAt',
      'schemaVersion', 'type', 'workKey',
    ].sort());
    assert.equal(queued[0].operationId, RUN_ID);
    assert.equal(queued[0].workKey, `google_ads:${RUN_ID}`);
    assert.equal(JSON.stringify(queued[0]).includes('2222222222'), false);
    assert.equal(JSON.stringify(queued[0]).includes('credential'), false);
    assert.equal(JSON.stringify(queued[0]).includes('signature'), false);

    const retryEnvelope = deliveryEnvelope({
      runId: RUN_ID,
      mode: 'LIVE',
      datasetKey: 'campaignDailyMetrics',
      rows: googleAdsDatasetRows('campaignDailyMetrics'),
      manifest,
    });
    const retrySigned = await createSignedGoogleAdsDeliveryRequest({
      envelope: retryEnvelope,
      nonce: 'zzzzzzzzzzzzzzzzzzzzzz',
    });
    const retryResponse = await handler({
      request: new Request(retrySigned.url, {
        method: retrySigned.method,
        headers: retrySigned.headers,
        body: retrySigned.body,
      }),
      env,
      url: new URL(retrySigned.url),
    });
    assert.equal(retryResponse.status, 202);
    assert.equal((await retryResponse.json()).disposition, 'exact_retry');
    assert.equal(queued.length, 1);
  } finally {
    d1.close();
  }
});

test('disabled signed ingress still fails before loading transport or Queue dependencies', async () => {
  const handler = createGoogleAdsManagerDeliveryHttpHandler({
    createStore() { throw new Error('transport store is not needed while ingress is disabled'); },
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
});
