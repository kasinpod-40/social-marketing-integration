import test from 'node:test';
import assert from 'node:assert/strict';
import { assertGoogleAdsSchemaDevTarget } from '../../packages/config/src/google-ads-schema-runtime-config.js';

test('allows only developer-owned DEV for Google Ads schema operations', () => {
  const runtime = assertGoogleAdsSchemaDevTarget({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
  });
  assert.equal(runtime.environment, 'development');
  assert.equal(runtime.profileKey, 'dev_ft_pumkin');

  assert.throws(
    () => assertGoogleAdsSchemaDevTarget({
      MKT_ENV: 'production',
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
    }, { operation: 'apply', errorCode: 'GOOGLE_ADS_SCHEMA_APPLY_DEV_TARGET_REQUIRED' }),
    (error) => error.code === 'GOOGLE_ADS_SCHEMA_APPLY_DEV_TARGET_REQUIRED',
  );
  assert.throws(
    () => assertGoogleAdsSchemaDevTarget({
      MKT_ENV: 'uat',
      MKT_CUSTOMER_PROFILE: 'uat_chemistry_k',
    }),
    (error) => error.code === 'GOOGLE_ADS_SCHEMA_DEV_TARGET_REQUIRED',
  );
});
