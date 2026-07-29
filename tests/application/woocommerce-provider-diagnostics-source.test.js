import assert from 'node:assert/strict';
import test from 'node:test';
import {
  listWooCommerceProviderDiagnosticSourceFields,
  materializeWooCommerceProviderDiagnosticSource,
} from '../../scripts/lib/woocommerce-provider-diagnostics-source.js';

const BASE_ENV = Object.freeze({
  MKT_ENV: 'development',
  MKT_CUSTOMER_PROFILE: 'integration_workspace',
  MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
  WOOCOMMERCE_CONSUMER_KEY: 'ck_fixture',
  WOOCOMMERCE_CONSUMER_SECRET: 'cs_fixture',
});

test('materializes every approved non-secret WooCommerce source field when local vars omit them', () => {
  const result = materializeWooCommerceProviderDiagnosticSource(BASE_ENV);

  assert.equal(result.WOOCOMMERCE_BASE_URL, 'https://chemistryk.online');
  assert.equal(result.WOOCOMMERCE_API_VERSION, 'wc/v3');
  assert.equal(result.WOOCOMMERCE_API_TIMEOUT_MS, '45000');
  assert.equal(result.WOOCOMMERCE_DEFAULT_CURRENCY, 'THB');
  assert.equal(result.WOOCOMMERCE_CONSUMER_KEY, 'ck_fixture');
  assert.equal(result.WOOCOMMERCE_CONSUMER_SECRET, 'cs_fixture');
  assert.equal(Object.isFrozen(result), true);
  assert.deepEqual(listWooCommerceProviderDiagnosticSourceFields(), [
    'WOOCOMMERCE_BASE_URL',
    'WOOCOMMERCE_API_VERSION',
    'WOOCOMMERCE_API_TIMEOUT_MS',
    'WOOCOMMERCE_DEFAULT_CURRENCY',
  ]);
});

test('accepts semantically equivalent explicit source values before canonical materialization', () => {
  const result = materializeWooCommerceProviderDiagnosticSource({
    ...BASE_ENV,
    WOOCOMMERCE_BASE_URL: 'https://chemistryk.online/',
    WOOCOMMERCE_API_VERSION: 'wc/v3',
    WOOCOMMERCE_API_TIMEOUT_MS: 45_000,
    WOOCOMMERCE_DEFAULT_CURRENCY: 'thb',
  });

  assert.equal(result.WOOCOMMERCE_BASE_URL, 'https://chemistryk.online');
  assert.equal(result.WOOCOMMERCE_API_TIMEOUT_MS, '45000');
  assert.equal(result.WOOCOMMERCE_DEFAULT_CURRENCY, 'THB');
});

for (const [fieldName, value] of [
  ['WOOCOMMERCE_BASE_URL', 'https://other.example.test'],
  ['WOOCOMMERCE_BASE_URL', 'https://chemistryk.online:444'],
  ['WOOCOMMERCE_API_VERSION', 'wc/v2'],
  ['WOOCOMMERCE_API_TIMEOUT_MS', '30000'],
  ['WOOCOMMERCE_DEFAULT_CURRENCY', 'USD'],
]) {
  test(`rejects conflicting explicit ${fieldName}=${value} before any Provider request`, () => {
    assert.throws(
      () => materializeWooCommerceProviderDiagnosticSource({
        ...BASE_ENV,
        [fieldName]: value,
      }),
      (error) => error?.code === 'WOOCOMMERCE_PROVIDER_DIAGNOSTICS_SOURCE_CONFLICT'
        && error?.details?.fieldName === fieldName,
    );
  });
}

test('does not mutate the caller environment while materializing the source contract', () => {
  const input = { ...BASE_ENV };
  materializeWooCommerceProviderDiagnosticSource(input);
  assert.equal(Object.hasOwn(input, 'WOOCOMMERCE_BASE_URL'), false);
});
