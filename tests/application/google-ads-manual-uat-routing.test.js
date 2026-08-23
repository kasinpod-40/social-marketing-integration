import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGoogleAdsManualUatRuntime,
  confirmGoogleAdsQueueReceipt,
} from '../../apps/sync-worker/src/google-ads-job-router.js';
import {
  processJobWithGoogleAdsUat,
} from '../../apps/sync-worker/src/google-ads-active-job-router.js';

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const GENERATION = Date.parse('2026-07-25T04:00:00.000Z');
const REFERENCE = Object.freeze({
  schemaVersion: 1,
  type: 'google.ads.manager.signed-delivery.process',
  operationId: RUN_ID,
  workKey: `google_ads:${RUN_ID}`,
  generation: GENERATION,
  originalRequestedAt: GENERATION,
  requestedAt: new Date(GENERATION).toISOString(),
});

function runtime(overrides = {}) {
  return {
    environment: 'development',
    profileKey: 'integration_workspace',
    infrastructureOwner: 'developer',
    customerKey: 'chemistry_k',
    connectors: {
      google_ads: {
        enabled: true,
        accountKey: 'chemistry_k',
      },
    },
    ...overrides,
  };
}

function enabledEnv(overrides = {}) {
  return {
    MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'true',
    MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED: 'true',
    MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED: 'true',
    MKT_GOOGLE_ADS_LARK_WRITE_ENABLED: 'true',
    MKT_SCHEDULE_GOOGLE_ADS_ENABLED: 'false',
    ...overrides,
  };
}

test('signed-delivery runtime accepts manual or external scheduled LIVE with every processing gate enabled', () => {
  const connector = assertGoogleAdsManualUatRuntime(runtime(), enabledEnv());
  assert.equal(connector.accountKey, 'chemistry_k');

  const production = runtime({
    environment: 'production',
    profileKey: 'chemistry_k',
    infrastructureOwner: 'customer',
  });
  assert.equal(assertGoogleAdsManualUatRuntime(production, enabledEnv()).accountKey, 'chemistry_k');
  assert.throws(
    () => assertGoogleAdsManualUatRuntime({ ...production, infrastructureOwner: 'developer' }, enabledEnv()),
    (error) => error.code === 'GOOGLE_ADS_MANUAL_UAT_TARGET_INVALID',
  );
  assert.throws(
    () => assertGoogleAdsManualUatRuntime(runtime(), enabledEnv({ MKT_GOOGLE_ADS_LARK_WRITE_ENABLED: 'false' })),
    (error) => error.code === 'GOOGLE_ADS_MANUAL_UAT_GATES_DISABLED',
  );
  assert.equal(assertGoogleAdsManualUatRuntime(runtime(), enabledEnv({
    MKT_SCHEDULE_GOOGLE_ADS_ENABLED: 'true',
  })).accountKey, 'chemistry_k');
});

test('Queue receipt promotes only send_pending admission after identity verification', async () => {
  let status = 'send_pending';
  let queuedCalls = 0;
  const admissionStore = {
    async getByOperationId() {
      return {
        operationId: RUN_ID,
        workKey: `google_ads:${RUN_ID}`,
        generation: GENERATION,
        originalRequestedAt: GENERATION,
        status,
      };
    },
    async markQueued(input) {
      queuedCalls += 1;
      assert.equal(input.runId, RUN_ID);
      status = 'queued';
      return { status };
    },
  };

  const promoted = await confirmGoogleAdsQueueReceipt({ admissionStore, reference: REFERENCE });
  assert.equal(promoted.status, 'queued');
  assert.equal(queuedCalls, 1);
  const retry = await confirmGoogleAdsQueueReceipt({ admissionStore, reference: REFERENCE });
  assert.equal(retry.status, 'queued');
  assert.equal(queuedCalls, 1);
});

test('Queue receipt rejects admission identity drift before mutation', async () => {
  let queued = false;
  await assert.rejects(
    () => confirmGoogleAdsQueueReceipt({
      reference: REFERENCE,
      admissionStore: {
        async getByOperationId() {
          return {
            operationId: RUN_ID,
            workKey: `google_ads:${RUN_ID}`,
            generation: GENERATION + 1,
            originalRequestedAt: GENERATION,
            status: 'send_pending',
          };
        },
        async markQueued() { queued = true; },
      },
    }),
    (error) => error.code === 'GOOGLE_ADS_LIVE_ADMISSION_IDENTITY_MISMATCH',
  );
  assert.equal(queued, false);
});

test('Google Ads wrapper intercepts only the signed delivery job', async () => {
  const result = await processJobWithGoogleAdsUat({
    job: { body: { type: 'unsupported.fixture' } },
  }).catch((error) => error);
  assert.equal(result.code, 'UNSUPPORTED_SYNC_JOB');
});
