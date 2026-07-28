import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WOOCOMMERCE_FINAL_SOURCE_CONTRACT,
  assertMaterializedSource,
  buildWooCommerceFinalSourceConfig,
} from '../../scripts/lib/woocommerce-final-source-contract.js';

function sourceConfig(overrides = {}) {
  return JSON.stringify({
    name: 'social-mkt-sync-worker',
    main: './apps/sync-worker/src/index.js',
    compatibility_date: '2026-07-01',
    vars: {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
      WOOCOMMERCE_BASE_URL: 'https://replace-with-customer-store.example',
      WOOCOMMERCE_API_VERSION: 'wc/v3',
      WOOCOMMERCE_API_TIMEOUT_MS: '30000',
      WOOCOMMERCE_DEFAULT_CURRENCY: 'THB',
      ...overrides,
    },
    d1_databases: [{
      binding: 'MKT_STATE_DB',
      database_name: 'social-mkt-state-dev',
      database_id: '11111111-2222-4333-8444-555555555555',
      migrations_dir: './migrations',
    }],
  }, null, 2);
}

test('materializes exact Chemistry K source and rebases runtime paths', () => {
  const result = buildWooCommerceFinalSourceConfig(sourceConfig(), {
    repositoryRoot: '/repo',
    sourceConfigPath: 'wrangler.sync.jsonc',
  });
  const config = JSON.parse(result.text);

  assert.equal(config.vars.WOOCOMMERCE_BASE_URL, WOOCOMMERCE_FINAL_SOURCE_CONTRACT.baseUrl);
  assert.equal(config.vars.WOOCOMMERCE_API_VERSION, 'wc/v3');
  assert.equal(config.vars.WOOCOMMERCE_API_TIMEOUT_MS, '45000');
  assert.equal(config.vars.WOOCOMMERCE_DEFAULT_CURRENCY, 'THB');
  assert.equal(config.main, '/repo/apps/sync-worker/src/index.js');
  assert.equal(config.d1_databases[0].migrations_dir, '/repo/migrations');
  assert.equal(result.hostname, 'chemistryk.online');
  assert.equal(result.secretValuesCopied, 0);
  assert.equal(assertMaterializedSource(config.vars), true);
});

test('blocks WooCommerce credentials stored in Wrangler vars', () => {
  assert.throws(
    () => buildWooCommerceFinalSourceConfig(sourceConfig({
      WOOCOMMERCE_CONSUMER_KEY: 'ck_leaked',
    }), {
      repositoryRoot: '/repo',
      sourceConfigPath: 'wrangler.sync.jsonc',
    }),
    (error) => error.code === 'WOOCOMMERCE_FINAL_SOURCE_SECRET_VALUE_BLOCKED',
  );
});

test('fails closed for wrong Integration Workspace identity', () => {
  assert.throws(
    () => buildWooCommerceFinalSourceConfig(sourceConfig({
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
    }), {
      repositoryRoot: '/repo',
      sourceConfigPath: 'wrangler.sync.jsonc',
    }),
    (error) => error.code === 'WOOCOMMERCE_FINAL_SOURCE_CONTRACT_INVALID',
  );
});

test('materialized source assertion rejects alternate host and path', () => {
  assert.throws(
    () => assertMaterializedSource({
      WOOCOMMERCE_BASE_URL: 'https://www.chemistryk.online/wp-json/wc/v3',
      WOOCOMMERCE_API_VERSION: 'wc/v3',
      WOOCOMMERCE_API_TIMEOUT_MS: '45000',
      WOOCOMMERCE_DEFAULT_CURRENCY: 'THB',
    }),
    (error) => error.code === 'WOOCOMMERCE_FINAL_SOURCE_CONTRACT_INVALID',
  );
});

test('JSONC comments and trailing commas remain accepted', () => {
  const text = `{
    // canonical local config
    "name": "social-mkt-sync-worker",
    "main": "./apps/sync-worker/src/index.js",
    "compatibility_date": "2026-07-01",
    "vars": {
      "MKT_ENV": "development",
      "MKT_CUSTOMER_PROFILE": "integration_workspace",
      "MKT_CONNECTION_CUSTOMER_KEY": "chemistry_k",
    },
    "d1_databases": [{
      "binding": "MKT_STATE_DB",
      "database_name": "social-mkt-state-dev",
      "database_id": "11111111-2222-4333-8444-555555555555",
      "migrations_dir": "./migrations",
    }],
  }`;
  const result = buildWooCommerceFinalSourceConfig(text, {
    repositoryRoot: '/repo',
    sourceConfigPath: 'wrangler.sync.jsonc',
  });
  assert.equal(JSON.parse(result.text).vars.WOOCOMMERCE_BASE_URL, 'https://chemistryk.online');
});
