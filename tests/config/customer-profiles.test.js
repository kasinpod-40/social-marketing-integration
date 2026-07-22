import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig, listCustomerProfiles } from '../../packages/config/src/customer-profiles.js';

test('loads one mixed-source integration workspace without DEV/UAT profile switching', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
  });

  assert.equal(config.environment, 'development');
  assert.equal(config.profileKey, 'integration_workspace');
  assert.equal(config.profileAliasUsed, false);
  assert.equal(config.customerKey, 'chemistry_k');
  assert.equal(config.infrastructureOwner, 'developer');
  assert.equal(config.sourceAssetOwner, 'mixed');
  assert.equal(config.dataOwner, 'mixed');
  assert.equal(config.dataMode, 'mixed_source_integration');
  assert.equal(config.workspacePurpose, 'assemble_full_system_before_customer_owned_production');

  assert.equal(config.connectors.tiktok.enabled, true);
  assert.equal(config.connectors.tiktok.accountKey, 'ft_pumkin');
  assert.equal(config.connectors.tiktok.sourceHandle, 'ft.pumkin');
  assert.equal(config.connectors.tiktok.sourceOwner, 'developer');
  assert.equal(config.connectors.tiktok.sourceRole, 'temporary_substitute');
  assert.equal(config.connectors.tiktok.replacementRequired, true);

  assert.equal(config.connectors.google_ads.enabled, false);
  assert.equal(config.connectors.google_ads.accountKey, 'chemistry_k');
  assert.equal(config.connectors.google_ads.sourceOwner, 'customer');
  assert.equal(config.connectors.google_ads.sourceRole, 'customer_real');
  assert.equal(config.connectors.google_ads.replacementRequired, false);

  // Alias เดิมยังอยู่เพื่อไม่ให้ TikTok use case เดิมพังระหว่าง Migration
  assert.equal(config.tiktok, config.connectors.tiktok);
});

test('legacy DEV/UAT profile names resolve to the same integration workspace instead of separate modes', () => {
  for (const alias of ['dev_ft_pumkin', 'uat_chemistry_k']) {
    const config = loadCustomerRuntimeConfig({
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: alias,
    });
    assert.equal(config.profileKey, 'integration_workspace');
    assert.equal(config.profileAliasUsed, true);
    assert.equal(config.customerKey, 'chemistry_k');
    assert.equal(config.dataMode, 'mixed_source_integration');
  }
});

test('loads the customer-owned Chemistry K production profile without enabling unfinished connectors', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
  });

  assert.equal(config.environment, 'production');
  assert.equal(config.customerName, 'Chemistry K');
  assert.equal(config.resourceOwner, 'customer');
  assert.equal(config.infrastructureOwner, 'customer');
  assert.equal(config.sourceAssetOwner, 'customer');
  assert.equal(config.dataOwner, 'customer');
  assert.equal(config.dataMode, 'customer_production');
  assert.equal(config.workspacePurpose, 'customer_owned_production');
  assert.equal(config.connectors.tiktok.enabled, true);
  assert.equal(config.connectors.tiktok.accountKey, 'chemistry_k');
  assert.equal(config.connectors.tiktok.sourceHandle, 'chemistry_k');
  assert.equal(config.connectors.tiktok.sourceOwner, 'customer');
  assert.equal(config.connectors.tiktok.replacementRequired, false);
  assert.equal(config.connectors.woocommerce.enabled, false);
  assert.equal(config.connectors.chatwoot.enabled, false);
  assert.equal(config.connectors.facebook.displayLabel, 'Facebook - Chemistry K');
});

test('rejects integration/production profile mismatches', () => {
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'production', MKT_CUSTOMER_PROFILE: 'integration_workspace' }),
    /Invalid runtime pairing/,
  );
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'chemistry_k' }),
    /Invalid runtime pairing/,
  );
});

test('rejects the removed standalone UAT environment', () => {
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'uat', MKT_CUSTOMER_PROFILE: 'integration_workspace' }),
    /MKT_ENV must be one of: development, production/,
  );
});

test('rejects missing or unknown runtime configuration', () => {
  assert.throws(() => loadCustomerRuntimeConfig({}), /Missing MKT_ENV/);
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'unknown' }),
    /Unknown MKT_CUSTOMER_PROFILE/,
  );
  assert.deepEqual(listCustomerProfiles(), ['integration_workspace', 'chemistry_k']);
});
