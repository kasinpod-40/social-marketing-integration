import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import {
  assertConnectorRunnable,
  listConnectorReadiness,
} from '../../packages/application/src/connectors/connector-registry.js';

test('returns the active TikTok connector state from the runtime profile', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
  });

  const connector = assertConnectorRunnable(runtimeConfig, 'tiktok');
  assert.equal(connector.accountKey, 'ft_pumkin');
  assert.equal(connector.enabled, true);
});

test('rejects an active connector when the feature flag disables it', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false',
  });

  assert.throws(
    () => assertConnectorRunnable(runtimeConfig, 'tiktok'),
    (error) => error?.code === 'MKT_CONNECTOR_DISABLED',
  );
});

test('planned connector is never reported as runnable', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
  });

  assert.throws(
    () => assertConnectorRunnable(runtimeConfig, 'facebook'),
    (error) => error?.code === 'MKT_CONNECTOR_NOT_IMPLEMENTED',
  );

  const readiness = listConnectorReadiness(runtimeConfig);
  const facebook = readiness.find((item) => item.key === 'facebook');
  assert.equal(facebook.enabled, false);
  assert.equal(facebook.runnable, false);
});

test('YouTube connector is runnable after activation when the normal feature flag is enabled', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
  });
  assert.equal(assertConnectorRunnable(runtimeConfig, 'youtube').enabled, true);
});


test('Google Ads signed delivery is runnable only when the UAT feature flag is explicit', () => {
  const disabled = loadCustomerRuntimeConfig({
    MKT_ENV: 'uat', MKT_CUSTOMER_PROFILE: 'uat_chemistry_k',
  });
  assert.throws(
    () => assertConnectorRunnable(disabled, 'google_ads'),
    (error) => error?.code === 'MKT_CONNECTOR_DISABLED',
  );

  const enabled = loadCustomerRuntimeConfig({
    MKT_ENV: 'uat', MKT_CUSTOMER_PROFILE: 'uat_chemistry_k',
    MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'true',
  });
  assert.equal(assertConnectorRunnable(enabled, 'google_ads').accountKey, 'chemistry_k');
});

test('Google Ads Production remains blocked until reliability and Live UAT gates are verified', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'production', MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'true',
  });
  assert.throws(
    () => assertConnectorRunnable(runtimeConfig, 'google_ads'),
    (error) => error?.code === 'MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING'
      && error?.details?.minimumFixtureItems === 10000
      && error?.details?.missingGates?.includes('liveAccountUat'),
  );
});

test('registry rejects runtime profiles that omit an active connector state', () => {
  assert.throws(
    () => assertConnectorRunnable({ connectors: {} }, 'tiktok'),
    (error) => error?.code === 'MKT_RUNTIME_CONFIG_INVALID',
  );
});

test('Production rejects active connectors until the large-account Live UAT gate is verified', () => {
  const tiktokProduction = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
  });
  assert.throws(
    () => assertConnectorRunnable(tiktokProduction, 'tiktok'),
    (error) => error?.code === 'MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING'
      && error?.details?.minimumFixtureItems === 1000
      && error?.details?.missingGates?.includes('liveAccountUat')
      && !error?.details?.missingGates?.includes('durableResume'),
  );
  const productionReadiness = listConnectorReadiness(tiktokProduction)
    .find((item) => item.key === 'tiktok');
  assert.equal(productionReadiness.runnable, false);
  assert.equal(productionReadiness.productionRunnable, false);

  const youtubeProduction = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
  });
  assert.throws(
    () => assertConnectorRunnable(youtubeProduction, 'youtube'),
    (error) => error?.code === 'MKT_CONNECTOR_LARGE_ACCOUNT_UAT_PENDING'
      && error?.details?.missingGates?.includes('liveAccountUat'),
  );
});

test('readiness summary exposes volume targets and missing large-account gates without secrets', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
  });
  const readiness = listConnectorReadiness(runtimeConfig);
  const youtube = readiness.find((item) => item.key === 'youtube');
  const instagram = readiness.find((item) => item.key === 'instagram');

  assert.equal(youtube.runnable, true);
  assert.equal(youtube.productionRunnable, false);
  assert.equal(youtube.minimumFixtureItems, 1000);
  assert.deepEqual(youtube.missingLargeAccountGates, ['liveAccountUat']);
  assert.equal(instagram.minimumFixtureItems, 2000);
  assert.equal(instagram.productionRunnable, false);
});
