import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig, listCustomerProfiles } from '../../packages/config/src/customer-profiles.js';

test('loads the developer-owned FT Pumkin profile', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin',
  });

  assert.equal(config.environment, 'development');
  assert.equal(config.resourceOwner, 'developer');
  assert.equal(config.tiktok.accountKey, 'ft_pumkin');
  assert.equal(config.tiktok.sourceHandle, 'ft.pumkin');
});

test('loads the customer-owned Chemistry K production profile', () => {
  const config = loadCustomerRuntimeConfig({
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
  });

  assert.equal(config.environment, 'production');
  assert.equal(config.customerName, 'Chemistry K');
  assert.equal(config.resourceOwner, 'customer');
  assert.equal(config.tiktok.accountKey, 'chemistry_k');
  assert.equal(config.tiktok.sourceHandle, 'chemistry_k');
  assert.equal(config.connectors.woocommerce, true);
  assert.equal(config.connectors.chatwoot, true);
});

test('rejects a development/production profile mismatch', () => {
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'production', MKT_CUSTOMER_PROFILE: 'dev_ft_pumkin' }),
    /Invalid runtime pairing/,
  );
});

test('rejects missing or unknown runtime configuration', () => {
  assert.throws(() => loadCustomerRuntimeConfig({}), /Missing MKT_ENV/);
  assert.throws(
    () => loadCustomerRuntimeConfig({ MKT_ENV: 'development', MKT_CUSTOMER_PROFILE: 'unknown' }),
    /Unknown MKT_CUSTOMER_PROFILE/,
  );
  assert.deepEqual(listCustomerProfiles(), ['dev_ft_pumkin', 'chemistry_k']);
});
