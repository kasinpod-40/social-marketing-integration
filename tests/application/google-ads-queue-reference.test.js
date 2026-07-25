import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildGoogleAdsQueueReference,
  validateGoogleAdsQueueReference,
} from '../../packages/application/src/google-ads/google-ads-queue-reference.js';
import { resolveQueueOperation } from '../../packages/application/src/jobs/queue-operation.js';
import { normalizeQueueJobMessage } from '../../packages/application/src/jobs/queue-job.js';

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const RUN_STARTED_AT = 1785031200000;

function reference() {
  return buildGoogleAdsQueueReference({ runId: RUN_ID, runStartedAt: RUN_STARTED_AT });
}

test('Google Ads Queue reference is exact, reference-only and stable across delivery messages', () => {
  const body = reference();
  assert.deepEqual(body, {
    schemaVersion: 1,
    type: 'google.ads.manager.signed-delivery.process',
    operationId: RUN_ID,
    workKey: `google_ads:${RUN_ID}`,
    generation: RUN_STARTED_AT,
    originalRequestedAt: RUN_STARTED_AT,
    requestedAt: new Date(RUN_STARTED_AT).toISOString(),
  });
  assert.equal(JSON.stringify(body).includes('customerId'), false);
  assert.equal(JSON.stringify(body).includes('signature'), false);
  assert.equal(JSON.stringify(body).includes('nonce'), false);

  const first = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'delivery-a', body }),
    message: { id: 'delivery-a' },
  });
  const duplicate = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'delivery-b', body }),
    message: { id: 'delivery-b' },
  });
  assert.deepEqual(duplicate, first);
  assert.equal(first.stable, true);
});

test('Google Ads Queue reference rejects unknown fields and identity drift', () => {
  assert.throws(
    () => validateGoogleAdsQueueReference({ ...reference(), customerId: '5662332033' }),
    (error) => error.code === 'GOOGLE_ADS_QUEUE_REFERENCE_SCHEMA_INVALID',
  );
  assert.throws(
    () => validateGoogleAdsQueueReference({ ...reference(), workKey: 'google_ads:wrong' }),
    (error) => error.code === 'GOOGLE_ADS_QUEUE_REFERENCE_IDENTITY_MISMATCH',
  );
  assert.throws(
    () => validateGoogleAdsQueueReference({ ...reference(), generation: RUN_STARTED_AT + 1 }),
    (error) => error.code === 'GOOGLE_ADS_QUEUE_REFERENCE_GENERATION_MISMATCH',
  );
});

test('Google Ads Queue reference validator returns one frozen canonical value', () => {
  const validated = validateGoogleAdsQueueReference(reference());
  assert.equal(Object.isFrozen(validated), true);
  assert.deepEqual(validated, reference());
});
