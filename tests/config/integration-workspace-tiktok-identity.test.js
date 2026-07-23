import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';

test('Integration Workspace rejects a TikTok source-handle override that would drift Canonical ownership', () => {
  assert.throws(
    () => loadCustomerRuntimeConfig({
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
      TIKTOK_SOURCE_HANDLE: 'another_account',
    }),
    (error) => error.code === 'MKT_RUNTIME_IDENTITY_OVERRIDE_BLOCKED'
      && error.details.connectorKey === 'tiktok',
  );
});

test('Integration Workspace accepts only the canonical Chemistry K handle after normalization', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
    TIKTOK_SOURCE_HANDLE: '@Chemistry_K',
  });

  assert.equal(config.connectors.tiktok.accountKey, 'chemistry_k');
  assert.equal(config.connectors.tiktok.sourceHandle, '@Chemistry_K');
});
