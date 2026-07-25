import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertGoogleAdsManualUatRuntime,
} from '../../apps/sync-worker/src/google-ads-job-router.js';
import {
  processJobWithGoogleAdsUat,
} from '../../apps/sync-worker/src/google-ads-active-job-router.js';

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

test('manual UAT runtime accepts only developer Integration Workspace with every gate enabled', () => {
  const connector = assertGoogleAdsManualUatRuntime(runtime(), enabledEnv());
  assert.equal(connector.accountKey, 'chemistry_k');

  assert.throws(
    () => assertGoogleAdsManualUatRuntime(runtime({ environment: 'production' }), enabledEnv()),
    (error) => error.code === 'GOOGLE_ADS_MANUAL_UAT_TARGET_INVALID',
  );
  assert.throws(
    () => assertGoogleAdsManualUatRuntime(runtime(), enabledEnv({ MKT_GOOGLE_ADS_LARK_WRITE_ENABLED: 'false' })),
    (error) => error.code === 'GOOGLE_ADS_MANUAL_UAT_GATES_DISABLED',
  );
  assert.throws(
    () => assertGoogleAdsManualUatRuntime(runtime(), enabledEnv({ MKT_SCHEDULE_GOOGLE_ADS_ENABLED: 'true' })),
    (error) => error.code === 'GOOGLE_ADS_MANUAL_UAT_SCHEDULE_ENABLED',
  );
});

test('Google Ads wrapper intercepts only the signed delivery job', async () => {
  const result = await processJobWithGoogleAdsUat({
    job: { body: { type: 'unsupported.fixture' } },
    // Generic router rejects this before loading runtime dependencies.
  }).catch((error) => error);
  assert.equal(result.code, 'SYNC_JOB_NOT_IMPLEMENTED');
});
