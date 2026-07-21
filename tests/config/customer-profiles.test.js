import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig, listCustomerProfiles } from '../../packages/config/src/customer-profiles.js';

test('loads the developer-owned FT Pumkin profile with TikTok enabled only', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
  });

  assert.equal(config.environment, 'development');
  assert.equal(config.resourceOwner, 'developer');
  assert.equal(config.infrastructureOwner, 'developer');
  assert.equal(config.sourceAssetOwner, 'developer');
  assert.equal(config.dataOwner, 'developer');
  assert.equal(config.dataMode, 'developer_test');
  assert.equal(config.connectors.tiktok.enabled, true);
  assert.equal(config.connectors.tiktok.accountKey, 'ft_pumkin');
  assert.equal(config.connectors.tiktok.sourceHandle, 'ft.pumkin');
  assert.equal(config.connectors.facebook.enabled, false);
  assert.equal(config.connectors.woocommerce.enabled, false);

  // Alias เดิมยังอยู่เพื่อไม่ให้ TikTok use case เดิมพังระหว่าง Migration
  assert.equal(config.tiktok, config.connectors.tiktok);
});

test('loads customer-real Chemistry K UAT with developer infrastructure and every connector disabled', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'uat',
    MKT_CUSTOMER_PROFILE: 'uat_chemistry_k',
  });

  assert.equal(config.environment, 'uat');
  assert.equal(config.profileKey, 'uat_chemistry_k');
  assert.equal(config.customerKey, 'chemistry_k');
  assert.equal(config.resourceOwner, 'developer');
  assert.equal(config.infrastructureOwner, 'developer');
  assert.equal(config.sourceAssetOwner, 'customer');
  assert.equal(config.dataOwner, 'customer');
  assert.equal(config.dataMode, 'customer_real_uat');
  assert.equal(config.connectors.tiktok.enabled, false);
  assert.equal(config.connectors.tiktok.accountKey, 'chemistry_k');
  assert.equal(config.connectors.tiktok.sourceHandle, null);
  assert.equal(config.connectors.tiktok.sourceHandleSource, null);
  assert.ok(Object.values(config.connectors).every((connector) => connector.enabled === false));
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
  assert.equal(config.connectors.tiktok.enabled, true);
  assert.equal(config.connectors.tiktok.accountKey, 'chemistry_k');
  assert.equal(config.connectors.tiktok.sourceHandle, 'chemistry_k');
  assert.equal(config.connectors.woocommerce.enabled, false);
  assert.equal(config.connectors.chatwoot.enabled, false);
  assert.equal(config.connectors.facebook.displayLabel, 'Facebook - Chemistry K');
});

test('rejects development/UAT/production profile mismatches', () => {
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'production', MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin' }),
    /Invalid runtime pairing/,
  );
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'production', MKT_CUSTOMER_PROFILE: 'uat_chemistry_k' }),
    /Invalid runtime pairing/,
  );
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'uat', MKT_CUSTOMER_PROFILE: 'chemistry_k' }),
    /Invalid runtime pairing/,
  );
});

test('rejects missing or unknown runtime configuration', () => {
  assert.throws(() => loadCustomerRuntimeConfig({}), /Missing MKT_ENV/);
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'unknown' }),
    /Unknown MKT_CUSTOMER_PROFILE/,
  );
  assert.deepEqual(listCustomerProfiles(), ['dev_ft_pumkin', 'uat_chemistry_k', 'chemistry_k']);
});
