import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_READ_ONLY_VALIDATION_CONFIRMATIONS,
  assertMetaReadOnlyValidationConfirmation,
  expectedMetaReadOnlyIdentitySummary,
  loadMetaReadOnlyValidationTarget,
  parseMetaReadOnlyValidationArgs,
  requiredMetaReadOnlyEvidencePhases,
  resolveMetaReadOnlyValidationScope,
  summarizeMetaReadOnlyRequestEvents,
  validateMetaReadOnlyConnectionResult,
} from '../../scripts/lib/meta-read-only-validation-operator.js';

function baseEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    META_GRAPH_API_VERSION: 'v25.0',
    META_ACCESS_TOKEN: 'facebook-private-token',
    META_INSTAGRAM_ACCESS_TOKEN: 'instagram-private-token',
    META_FACEBOOK_PAGE_ID: '982406442148381',
    META_INSTAGRAM_ACCOUNT_ID: '17841413521012797',
    META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=505898710119851,chemistry_k3=851206695716861',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false',
    MKT_CONNECTOR_FACEBOOK_ENABLED: 'false',
    MKT_CONNECTOR_INSTAGRAM_ENABLED: 'false',
    MKT_CONNECTOR_META_ADS_ENABLED: 'false',
    MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'false',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'false',
    MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'false',
    MKT_CONNECTOR_CHATWOOT_ENABLED: 'false',
    MKT_META_SOURCE_READ_ENABLED: 'false',
    MKT_META_D1_WRITE_ENABLED: 'false',
    MKT_META_LARK_WRITE_ENABLED: 'false',
    MKT_META_REPORT_READ_ENABLED: 'false',
    MKT_TIME_SERIES_D1_WRITE_ENABLED: 'false',
    MKT_TIME_SERIES_D1_BACKFILL_ENABLED: 'false',
    MKT_REPORT_D1_SHADOW_READ_ENABLED: 'false',
    MKT_REPORT_D1_READ_ENABLED: 'false',
    MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'false',
    MKT_LARK_DAILY_RETENTION_ENABLED: 'false',
    MKT_DLQ_REDRIVE_ENABLED: 'false',
    MKT_SCHEDULE_TIKTOK_ENABLED: 'false',
    MKT_SCHEDULE_FACEBOOK_ENABLED: 'false',
    MKT_SCHEDULE_INSTAGRAM_ENABLED: 'false',
    MKT_SCHEDULE_YOUTUBE_ENABLED: 'false',
    MKT_SCHEDULE_GOOGLE_ADS_ENABLED: 'false',
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
    MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
  };
}

function validatedResult(connectorKey) {
  return {
    connectorKey,
    configured: true,
    status: 'identity_validated',
    candidateCount: 2,
    mappingConfigured: true,
    identityMatched: true,
    permissions: {
      validation: 'permissions_edge',
      required: ['ads_read'],
      missing: [],
    },
    metadata: {
      activeCandidateCount: 2,
      expectedAccountCount: 1,
      matchedAccountCount: 1,
      missingAccountCount: 0,
    },
    providerError: null,
  };
}

test('Meta read-only operator defaults to plan and rejects unknown arguments or phases', () => {
  assert.deepEqual(parseMetaReadOnlyValidationArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseMetaReadOnlyValidationArgs(['--phase=facebook', '--execute']),
    { phase: 'facebook', execute: true },
  );
  assert.throws(
    () => parseMetaReadOnlyValidationArgs(['--write']),
    (error) => error.code === 'META_READ_ONLY_VALIDATION_ARGUMENT_INVALID',
  );
  assert.throws(
    () => parseMetaReadOnlyValidationArgs(['--phase=all']),
    (error) => error.code === 'META_READ_ONLY_VALIDATION_PHASE_INVALID',
  );
});

test('every executable phase requires its exact confirmation', () => {
  for (const [phase, confirmation] of Object.entries(META_READ_ONLY_VALIDATION_CONFIRMATIONS)) {
    assert.throws(
      () => assertMetaReadOnlyValidationConfirmation(phase, {}),
      (error) => error.code === 'META_READ_ONLY_VALIDATION_CONFIRMATION_REQUIRED',
    );
    assert.equal(
      assertMetaReadOnlyValidationConfirmation(phase, {
        [confirmation.envName]: confirmation.value,
      }),
      true,
    );
  }
});

test('target locks exact Chemistry K mappings, treats absent flags as disabled and rejects true execution flags', () => {
  const target = loadMetaReadOnlyValidationTarget(baseEnv());
  assert.deepEqual(target.metaAdAccountKeys, ['chemistry_k2', 'chemistry_k3']);
  assert.equal(target.executionFlagsEnabled, false);
  assert.equal(target.schedulesEnabled, false);
  const serialized = JSON.stringify(target);
  assert.doesNotMatch(serialized, /505898710119851|851206695716861|982406442148381|17841413521012797/u);
  assert.doesNotMatch(serialized, /facebook-private-token|instagram-private-token/u);

  const absentScheduleFlags = baseEnv();
  delete absentScheduleFlags.MKT_SCHEDULE_FACEBOOK_ENABLED;
  delete absentScheduleFlags.MKT_SCHEDULE_INSTAGRAM_ENABLED;
  const absentAccepted = loadMetaReadOnlyValidationTarget(absentScheduleFlags);
  assert.equal(absentAccepted.executionFlagsEnabled, false);
  assert.equal(absentAccepted.schedulesEnabled, false);

  assert.throws(
    () => loadMetaReadOnlyValidationTarget({
      ...baseEnv(),
      META_FACEBOOK_PAGE_ID: 'wrong-page',
    }),
    (error) => error.code === 'META_READ_ONLY_VALIDATION_IDENTITY_MISMATCH',
  );
  assert.throws(
    () => loadMetaReadOnlyValidationTarget({
      ...baseEnv(),
      MKT_META_D1_WRITE_ENABLED: 'true',
    }),
    (error) => error.code === 'META_READ_ONLY_VALIDATION_UNSAFE_FLAGS',
  );
  assert.throws(
    () => loadMetaReadOnlyValidationTarget({
      ...baseEnv(),
      MKT_SCHEDULE_FACEBOOK_ENABLED: 'true',
    }),
    (error) => error.code === 'META_READ_ONLY_VALIDATION_UNSAFE_FLAGS',
  );
  assert.throws(
    () => loadMetaReadOnlyValidationTarget({
      ...baseEnv(),
      MKT_SCHEDULE_INSTAGRAM_ENABLED: 'true',
    }),
    (error) => error.code === 'META_READ_ONLY_VALIDATION_UNSAFE_FLAGS',
  );
  assert.throws(
    () => loadMetaReadOnlyValidationTarget({
      ...baseEnv(),
      META_INSTAGRAM_ACCESS_TOKEN: '',
    }),
    (error) => error.code === 'META_READ_ONLY_VALIDATION_CREDENTIALS_MISSING',
  );
});

test('provider phases are scoped to one connector/account and require ordered evidence', () => {
  assert.deepEqual(resolveMetaReadOnlyValidationScope('facebook'), {
    connectorKey: 'facebook',
    sourceAccountKey: null,
  });
  assert.deepEqual(resolveMetaReadOnlyValidationScope('meta-ads-chemistry-k2'), {
    connectorKey: 'meta_ads',
    sourceAccountKey: 'chemistry_k2',
  });
  assert.deepEqual(requiredMetaReadOnlyEvidencePhases('meta-ads-chemistry-k3'), [
    'preflight',
    'facebook',
    'instagram',
    'meta-ads-chemistry-k2',
  ]);
  assert.deepEqual(requiredMetaReadOnlyEvidencePhases('summary'), [
    'preflight',
    'facebook',
    'instagram',
    'meta-ads-chemistry-k2',
    'meta-ads-chemistry-k3',
  ]);
});

test('connection result validation accepts exact identity and rejects incomplete outcomes', () => {
  const accepted = validateMetaReadOnlyConnectionResult(validatedResult('meta_ads'), 'meta_ads');
  assert.equal(accepted.status, 'identity_validated');
  assert.equal(accepted.permissions.missing.length, 0);

  assert.throws(
    () => validateMetaReadOnlyConnectionResult({
      ...validatedResult('meta_ads'),
      identityMatched: false,
      status: 'identity_mismatch',
    }, 'meta_ads'),
    (error) => error.code === 'META_READ_ONLY_VALIDATION_FAILED'
      && JSON.stringify(error.details).includes('505898710119851') === false,
  );
});

test('request event summary exposes operations and counts without request URLs or credentials', () => {
  const summary = summarizeMetaReadOnlyRequestEvents([
    { stage: 'meta_request_start', operation: 'meta_ads.preflight.permissions', attempt: 1 },
    { stage: 'meta_request_success', operation: 'meta_ads.preflight.permissions', attempt: 1, status: 200 },
    { stage: 'meta_request_start', operation: 'meta_ads.preflight.accounts', attempt: 1 },
    { stage: 'meta_request_retry', operation: 'meta_ads.preflight.accounts', attempt: 1 },
    { stage: 'meta_request_start', operation: 'meta_ads.preflight.accounts', attempt: 2 },
    { stage: 'meta_request_success', operation: 'meta_ads.preflight.accounts', attempt: 2, status: 200 },
  ]);
  assert.deepEqual(summary, {
    requestAttempts: 3,
    successfulRequests: 2,
    retries: 1,
    failedRequests: 0,
    operations: ['meta_ads.preflight.accounts', 'meta_ads.preflight.permissions'],
    transportMethod: 'GET',
    tokenInQuery: false,
  });
  assert.doesNotMatch(JSON.stringify(summary), /access_token|Bearer|graph\.facebook\.com/u);
});

test('identity summary contains aliases and counts only', () => {
  assert.deepEqual(expectedMetaReadOnlyIdentitySummary(), {
    customerKey: 'chemistry_k',
    facebookPageCount: 1,
    instagramAccountCount: 1,
    metaAdAccountKeys: ['chemistry_k2', 'chemistry_k3'],
    metaAdAccountCount: 2,
  });
});
