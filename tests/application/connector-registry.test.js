import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import {
  assertConnectorRunnable,
  listConnectorReadiness,
} from '../../packages/application/src/connectors/connector-registry.js';

test('returns the manually enabled Chemistry K TikTok connector from Integration Workspace', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
  });

  const connector = assertConnectorRunnable(runtimeConfig, 'tiktok');
  assert.equal(connector.accountKey, 'chemistry_k');
  assert.equal(connector.sourceHandle, 'chemistry_k');
  assert.equal(connector.enabled, true);
});

test('rejects the active TikTok implementation when the feature flag remains disabled', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
  });

  assert.throws(
    () => assertConnectorRunnable(runtimeConfig, 'tiktok'),
    (error) => error?.code === 'MKT_CONNECTOR_DISABLED',
  );
});

test('reviewed Meta Organic connector is runnable only after explicit Integration Workspace enablement', () => {
  const disabled = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
  });
  assert.throws(
    () => assertConnectorRunnable(disabled, 'facebook'),
    (error) => error?.code === 'MKT_CONNECTOR_DISABLED',
  );
  assert.equal(
    listConnectorReadiness(disabled).find((item) => item.key === 'facebook').runnable,
    false,
  );

  const enabled = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_FACEBOOK_ENABLED: 'true',
  });
  assert.equal(assertConnectorRunnable(enabled, 'facebook').enabled, true);
  assert.equal(
    listConnectorReadiness(enabled).find((item) => item.key === 'facebook').runnable,
    true,
  );
});

test('Google Ads connector is runnable after retained LIVE UAT promotion', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'true',
  });
  assert.equal(assertConnectorRunnable(runtimeConfig, 'google_ads').enabled, true);
});

test('YouTube connector is runnable after manual activation in Integration Workspace', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
  });
  assert.equal(assertConnectorRunnable(runtimeConfig, 'youtube').enabled, true);
});

test('registry rejects runtime profiles that omit an active connector state', () => {
  assert.throws(
    () => assertConnectorRunnable({ connectors: {} }, 'tiktok'),
    (error) => error?.code === 'MKT_RUNTIME_CONFIG_INVALID',
  );
});

test('Production admits verified TikTok and YouTube after exact live UAT evidence', () => {
  const tiktokProduction = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
  });
  assert.equal(assertConnectorRunnable(tiktokProduction, 'tiktok').enabled, true);
  const productionReadiness = listConnectorReadiness(tiktokProduction)
    .find((item) => item.key === 'tiktok');
  assert.equal(productionReadiness.runnable, true);
  assert.equal(productionReadiness.productionRunnable, true);

  const youtubeProduction = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
  });
  assert.equal(assertConnectorRunnable(youtubeProduction, 'youtube').enabled, true);
  const youtubeReadiness = listConnectorReadiness(youtubeProduction)
    .find((item) => item.key === 'youtube');
  assert.equal(youtubeReadiness.runnable, true);
  assert.equal(youtubeReadiness.productionRunnable, true);
});

test('readiness summary exposes volume targets and missing gates without secrets', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
  });
  const readiness = listConnectorReadiness(runtimeConfig);
  const youtube = readiness.find((item) => item.key === 'youtube');
  const instagram = readiness.find((item) => item.key === 'instagram');

  assert.equal(youtube.runnable, true);
  assert.equal(youtube.productionRunnable, true);
  assert.equal(youtube.minimumFixtureItems, 1000);
  assert.equal(youtube.largeAccountStatus, 'verified');
  assert.deepEqual(youtube.missingLargeAccountGates, []);
  assert.equal(instagram.minimumFixtureItems, 2000);
  assert.equal(instagram.productionRunnable, false);
  assert.equal(instagram.largeAccountStatus, 'verified');
  assert.deepEqual(instagram.missingLargeAccountGates, []);
});
