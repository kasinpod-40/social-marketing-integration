import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import { listConnectorCatalog } from '../../packages/config/src/connector-catalog.js';
import { buildAdministrativeLarkRuntimeConfigEnv } from '../../scripts/lib/lark-runtime.js';

test('administrative Lark runtime ignores connector flags and stale source identity overrides', () => {
  const source = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
    TIKTOK_SOURCE_HANDLE: 'ft.pumkin',
  };

  assert.throws(
    () => loadCustomerRuntimeConfig(source),
    (error) => error?.code === 'MKT_RUNTIME_IDENTITY_OVERRIDE_BLOCKED',
  );

  const administrative = buildAdministrativeLarkRuntimeConfigEnv(source);
  const config = loadCustomerRuntimeConfig(administrative);

  assert.equal(source.TIKTOK_SOURCE_HANDLE, 'ft.pumkin');
  assert.equal(administrative.TIKTOK_SOURCE_HANDLE, undefined);
  assert.equal(config.environment, 'development');
  assert.equal(config.profileKey, 'integration_workspace');
  assert.equal(config.connectors.tiktok.accountKey, 'chemistry_k');
  assert.equal(config.connectors.tiktok.sourceHandle, 'chemistry_k');
  assert.ok(Object.values(config.connectors).every((connector) => connector.enabled === false));

  for (const definition of listConnectorCatalog()) {
    assert.equal(administrative[definition.featureFlagEnv], 'false');
  }
});

test('administrative Lark runtime leaves unrelated environment values unchanged', () => {
  const source = {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    LARK_APP_TOKEN: 'app_token_value',
    LARK_TABLE_MKT_REPORT_SETTINGS: 'tbl_settings',
  };

  const administrative = buildAdministrativeLarkRuntimeConfigEnv(source);

  assert.equal(administrative.LARK_APP_TOKEN, 'app_token_value');
  assert.equal(administrative.LARK_TABLE_MKT_REPORT_SETTINGS, 'tbl_settings');
  assert.notEqual(administrative, source);
});
