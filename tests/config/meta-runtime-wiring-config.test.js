import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCustomerRuntimeConfig } from '../../packages/config/src/customer-profiles.js';
import { loadMetaEndToEndRuntimeConfig } from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import { createMetaTokenConnectionRuntime } from '../../packages/connectors/src/meta/meta-token-connection-runtime.js';
import {
  assertMetaManualUatRuntime,
  resolveMetaSourceRuntime,
} from '../../apps/sync-worker/src/meta-active-job-router.js';

function baseEnv() {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false',
    MKT_CONNECTOR_FACEBOOK_ENABLED: 'true',
    MKT_CONNECTOR_INSTAGRAM_ENABLED: 'false',
    MKT_CONNECTOR_META_ADS_ENABLED: 'false',
    MKT_CONNECTOR_GOOGLE_ADS_ENABLED: 'false',
    MKT_CONNECTOR_YOUTUBE_ENABLED: 'false',
    MKT_CONNECTOR_WOOCOMMERCE_ENABLED: 'false',
    MKT_CONNECTOR_CHATWOOT_ENABLED: 'false',
    MKT_META_SOURCE_READ_ENABLED: 'true',
  };
}

test('allows only source-gated Meta uat_pending connectors in the Integration Workspace', () => {
  const env = baseEnv();
  const runtime = loadCustomerRuntimeConfig(env);
  assert.equal(runtime.connectors.facebook.enabled, true);
  assert.equal(runtime.connectors.facebook.protectedUatRuntime, true);
  assert.equal(assertMetaManualUatRuntime(runtime, 'facebook', env).accountKey, 'chemistry_k');

  assert.throws(
    () => loadCustomerRuntimeConfig({ ...env, MKT_META_SOURCE_READ_ENABLED: 'false' }),
    (error) => error.code === 'MKT_CONNECTOR_UAT_PENDING',
  );
});

test('Meta runtime gates and bounded staging limits default fail-closed', () => {
  const config = loadMetaEndToEndRuntimeConfig({});
  assert.deepEqual(config.flags, {
    sourceRead: false,
    d1Write: false,
    larkWrite: false,
    reportRead: false,
  });
  assert.equal(config.limits.sourceMaxUnits, 500);
  assert.equal(config.limits.sourceMaxRows, 50_000);
  assert.equal(config.limits.sourceMaxUnitBytes, 524_288);
});

test('builds GET-only source adapters with a separate Facebook Page credential', () => {
  const runtime = createMetaTokenConnectionRuntime({
    META_GRAPH_API_VERSION: 'v25.0',
    META_ACCESS_TOKEN: 'facebook-private-token',
    META_FACEBOOK_PAGE_ACCESS_TOKEN: 'facebook-page-private-token',
    META_INSTAGRAM_ACCESS_TOKEN: 'instagram-private-token',
    META_FACEBOOK_PAGE_ID: 'page-fixture',
    META_INSTAGRAM_ACCOUNT_ID: 'ig-fixture',
    META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=505898710119851,chemistry_k3=851206695716861',
  }, {
    fetchImpl: async () => Response.json({}),
  });

  assert.equal(typeof runtime.sources.facebook.fetchAccount, 'function');
  assert.equal(typeof runtime.sources.instagram.fetchContentPage, 'function');
  assert.equal(typeof runtime.sources.meta_ads.fetchDailyInsightsPage, 'function');
  assert.equal('createCampaign' in runtime.sources.meta_ads, false);
  assert.equal('publish' in runtime.sources.facebook, false);
});

test('keeps Facebook business reads fail-closed without a Page credential', () => {
  const runtime = createMetaTokenConnectionRuntime({
    META_GRAPH_API_VERSION: 'v25.0',
    META_ACCESS_TOKEN: 'facebook-private-token',
    META_FACEBOOK_PAGE_ID: 'page-fixture',
  }, {
    fetchImpl: async () => Response.json({}),
  });

  assert.equal(runtime.facebook !== null, true);
  assert.equal(runtime.sources.facebook, null);
});


test('selects one configured Chemistry K Meta Ads account per operation', () => {
  const runtime = createMetaTokenConnectionRuntime({
    META_GRAPH_API_VERSION: 'v25.0',
    META_ACCESS_TOKEN: 'facebook-private-token',
    META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=505898710119851,chemistry_k3=851206695716861',
  }, {
    fetchImpl: async () => Response.json({}),
  });

  const account2 = resolveMetaSourceRuntime(runtime, 'meta_ads', {
    sourceAccountKey: 'chemistry_k2',
  });
  const account3 = resolveMetaSourceRuntime(runtime, 'meta_ads', {
    sourceAccountKey: 'chemistry_k3',
  });
  assert.equal(account2.sourceAccountId, '505898710119851');
  assert.equal(account3.sourceAccountId, '851206695716861');
  assert.notEqual(account2.sourceAccountId, account3.sourceAccountId);
  assert.throws(
    () => resolveMetaSourceRuntime(runtime, 'meta_ads', { sourceAccountKey: 'chemistry_k1' }),
    (error) => error.code === 'META_AD_ACCOUNT_MAPPING_NOT_CONFIGURED',
  );
});
