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

test('Meta UAT-pending connector is never reported as runnable', () => {
  const runtimeConfig = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
  });

  assert.throws(
    () => assertConnectorRunnable(runtimeConfig, 'facebook'),
    (error) => error?.code === 'MKT_CONNECTOR_UAT_PENDING',
  );

  const readiness = listConnectorReadiness(runtimeConfig);
  const facebook = readiness.find((item) => item.key === 'facebook');
  assert.equal(facebook.enabled, false);
  assert.equal(facebook.runnable, false);
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

test('Production rejects active connectors until the large-account Live validation gate is verified', () => {
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
  assert.equal(youtube.productionRunnable, false);
  assert.equal(youtube.minimumFixtureItems, 1000);
  assert.deepEqual(youtube.missingLargeAccountGates, ['liveAccountUat']);
  assert.equal(instagram.minimumFixtureItems, 2000);
  assert.equal(instagram.productionRunnable, false);
});
