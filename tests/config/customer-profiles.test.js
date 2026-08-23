import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isReviewedConnectorRuntime,
  loadCustomerRuntimeConfig,
  listCustomerProfileAliases,
  listCustomerProfiles,
} from '../../packages/config/src/customer-profiles.js';

test('loads the single Integration Workspace with Chemistry K TikTok identity and connectors disabled', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
  });

  assert.equal(config.environment, 'development');
  assert.equal(config.profileKey, 'integration_workspace');
  assert.equal(config.requestedProfileKey, 'integration_workspace');
  assert.equal(config.compatibilityAlias, null);
  assert.equal(config.customerKey, 'chemistry_k');
  assert.equal(config.resourceOwner, 'developer');
  assert.equal(config.infrastructureOwner, 'developer');
  assert.equal(config.sourceAssetOwner, 'mixed');
  assert.equal(config.dataOwner, 'mixed');
  assert.equal(config.dataMode, 'integration_workspace_mixed_sources');
  assert.equal(config.connectors.tiktok.enabled, false);
  assert.equal(config.connectors.tiktok.accountKey, 'chemistry_k');
  assert.equal(config.connectors.tiktok.sourceHandle, 'chemistry_k');
  assert.equal(config.connectors.youtube.accountKey, 'chemistry_k');
  assert.ok(Object.values(config.connectors).every((connector) => connector.enabled === false));
  assert.equal(config.tiktok, config.connectors.tiktok);
});

test('legacy profile labels resolve to Integration Workspace without restoring old stable-key identity', () => {
  for (const alias of ['dev_ft_pumkin', 'uat_chemistry_k']) {
    const config = loadCustomerRuntimeConfig({
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: alias,
    });
    assert.equal(config.profileKey, 'integration_workspace');
    assert.equal(config.requestedProfileKey, alias);
    assert.equal(config.compatibilityAlias, alias);
    assert.equal(config.customerKey, 'chemistry_k');
    assert.equal(config.connectors.tiktok.accountKey, 'chemistry_k');
    assert.equal(config.connectors.tiktok.sourceHandle, 'chemistry_k');
  }
});

test('allows explicit manual TikTok enablement without changing Chemistry K identity', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
  });
  assert.equal(config.connectors.tiktok.enabled, true);
  assert.equal(config.connectors.tiktok.enabledSource, 'environment');
  assert.equal(config.connectors.tiktok.accountKey, 'chemistry_k');
  assert.equal(config.connectors.tiktok.sourceHandle, 'chemistry_k');
});

test('loads customer-owned Production with every connector disabled until cutover approval', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
  });

  assert.equal(config.environment, 'production');
  assert.equal(config.profileKey, 'chemistry_k');
  assert.equal(config.customerName, 'Chemistry K');
  assert.equal(config.resourceOwner, 'customer');
  assert.equal(config.infrastructureOwner, 'customer');
  assert.equal(config.sourceAssetOwner, 'customer');
  assert.equal(config.dataOwner, 'customer');
  assert.equal(config.dataMode, 'customer_production');
  assert.equal(config.connectors.tiktok.accountKey, 'chemistry_k');
  assert.equal(config.connectors.tiktok.sourceHandle, 'chemistry_k');
  assert.ok(Object.values(config.connectors).every((connector) => connector.enabled === false));
  assert.equal(isReviewedConnectorRuntime(config), true);
});

test('reviewed connector runtime predicate rejects foreign profile, ownership and customer tuples', () => {
  const production = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
  });
  for (const candidate of [
    { ...production, profileKey: 'other' },
    { ...production, infrastructureOwner: 'developer' },
    { ...production, customerKey: 'other' },
  ]) {
    assert.equal(isReviewedConnectorRuntime(candidate), false);
  }
});

test('rejects obsolete UAT environment and development/production profile mismatches', () => {
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'uat', MKT_CUSTOMER_PROFILE: 'uat_chemistry_k' }),
    /MKT_ENV must be one of: development, production/,
  );
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'production', MKT_CUSTOMER_PROFILE: 'integration_workspace' }),
    /Invalid runtime pairing/,
  );
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'chemistry_k' }),
    /Invalid runtime pairing/,
  );
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'production', MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin' }),
    /Invalid runtime pairing/,
  );
});

test('lists only canonical profiles while exposing aliases separately for diagnostics', () => {
  assert.deepEqual(listCustomerProfiles(), ['integration_workspace', 'chemistry_k']);
  assert.deepEqual(listCustomerProfileAliases(), {
    dev_ft_pumkin: 'integration_workspace',
    uat_chemistry_k: 'integration_workspace',
  });
});

test('rejects missing or unknown runtime configuration', () => {
  assert.throws(() => loadCustomerRuntimeConfig({}), /Missing MKT_ENV/);
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'unknown' }),
    /Unknown MKT_CUSTOMER_PROFILE/,
  );
});
