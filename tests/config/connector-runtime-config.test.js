import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import { resolveConnectorRuntimeConfig } from '../../packages/config/src/connector-runtime-config.js';
import { listConnectorKeys } from '../../packages/config/src/connector-catalog.js';

test('runtime profile contains every registered connector with a deterministic feature flag', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
  });

  assert.deepEqual(Object.keys(config.connectors), listConnectorKeys());
  assert.equal(config.connectors.tiktok.featureFlagEnv, 'MKT_CONNECTOR_TIKTOK_ENABLED');
  assert.equal(config.connectors.facebook.featureFlagEnv, 'MKT_CONNECTOR_FACEBOOK_ENABLED');
});

test('environment feature flag can disable an active connector safely', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false',
  });

  assert.equal(config.connectors.tiktok.enabled, false);
  assert.equal(config.connectors.tiktok.enabledSource, 'environment');
});

test('one integration profile can replace a temporary source identity without switching profiles', () => {
  const current = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
  });

  assert.equal(current.connectors.tiktok.enabled, true);
  assert.equal(current.connectors.tiktok.accountKey, 'ft_pumkin');
  assert.equal(current.connectors.tiktok.sourceHandle, 'ft.pumkin');
  assert.equal(current.connectors.tiktok.sourceOwner, 'developer');
  assert.equal(current.connectors.tiktok.replacementRequired, true);

  const replacement = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
    TIKTOK_SOURCE_HANDLE: 'customer.actual.handle',
  });

  assert.equal(replacement.profileKey, 'integration_workspace');
  assert.equal(replacement.connectors.tiktok.enabled, true);
  assert.equal(replacement.connectors.tiktok.accountKey, 'ft_pumkin');
  assert.equal(replacement.connectors.tiktok.sourceHandle, 'customer.actual.handle');
  assert.equal(replacement.connectors.tiktok.sourceHandleSource, 'environment');
});

test('disabled connectors still require the canonical account key', () => {
  const connectors = Object.fromEntries(listConnectorKeys().map((key) => [key, {
    enabledByDefault: false,
    accountKey: 'chemistry_k',
  }]));
  connectors.tiktok = {
    enabledByDefault: false,
    accountKey: null,
    sourceHandle: null,
  };

  assert.throws(
    () => resolveConnectorRuntimeConfig(connectors),
    /Missing connector runtime field tiktok.accountKey/,
  );
});

test('YouTube connector can be enabled after activation review', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'true',
  });

  assert.equal(config.connectors.youtube.implementationStatus, 'active');
  assert.equal(config.connectors.youtube.enabled, true);
});

test('planned connectors cannot be enabled before a real implementation exists', () => {
  assert.throws(
    () => loadCustomerRuntimeConfig({
      MKT_ENV: 'production',
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
      MKT_CONNECTOR_FACEBOOK_ENABLED: 'true',
    }),
    (error) => error?.code === 'MKT_CONNECTOR_NOT_IMPLEMENTED',
  );
});

test('connector feature flags accept only explicit true or false values', () => {
  assert.throws(
    () => loadCustomerRuntimeConfig({
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'yes',
    }),
    /must be true or false/,
  );
});

test('production source handle can be supplied by environment without changing customer source code', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    TIKTOK_SOURCE_HANDLE: 'chemistry.k.official',
  });

  assert.equal(config.connectors.tiktok.accountKey, 'chemistry_k');
  assert.equal(config.connectors.tiktok.sourceHandle, 'chemistry.k.official');
  assert.equal(config.connectors.tiktok.sourceHandleSource, 'environment');
});

test('boolean feature flag values are supported for runtime adapters that provide typed vars', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_TIKTOK_ENABLED: false,
  });

  assert.equal(config.connectors.tiktok.enabled, false);
});

test('source-handle environment override rejects non-string values instead of silently ignoring them', () => {
  assert.throws(
    () => loadCustomerRuntimeConfig({
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      TIKTOK_SOURCE_HANDLE: 123,
    }),
    /must be a non-empty string/,
  );
});
