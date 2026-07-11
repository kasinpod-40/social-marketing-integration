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

test('registry rejects runtime profiles that omit an active connector state', () => {
  assert.throws(
    () => assertConnectorRunnable({ connectors: {} }, 'tiktok'),
    (error) => error?.code === 'MKT_RUNTIME_CONFIG_INVALID',
  );
});
