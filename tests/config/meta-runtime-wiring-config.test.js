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

test('allows only source-gated reviewed Meta Organic in the Integration Workspace', () => {
  const env = baseEnv();
  const runtime = loadCustomerRuntimeConfig(env);
  assert.equal(runtime.connectors.facebook.enabled, true);
  assert.equal(runtime.connectors.facebook.protectedUatRuntime, false);
  assert.equal(assertMetaManualUatRuntime(runtime, 'facebook', env).accountKey, 'chemistry_k');

  const sourceDisabledEnv = { ...env, MKT_META_SOURCE_READ_ENABLED: 'false' };
  const sourceDisabledRuntime = loadCustomerRuntimeConfig(sourceDisabledEnv);
  assert.throws(
    () => assertMetaManualUatRuntime(sourceDisabledRuntime, 'facebook', sourceDisabledEnv),
    (error) => error.code === 'META_END_TO_END_GATES_DISABLED',
  );
});

test('admits only the exact customer Production ownership tuple for verified Meta connectors', () => {
  const env = {
    ...baseEnv(),
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
  };
  const runtime = loadCustomerRuntimeConfig(env);
  assert.equal(assertMetaManualUatRuntime(runtime, 'facebook', env).accountKey, 'chemistry_k');

  for (const candidate of [
    { ...runtime, profileKey: 'other' },
    { ...runtime, infrastructureOwner: 'developer' },
    { ...runtime, customerKey: 'other' },
  ]) {
    assert.throws(
      () => assertMetaManualUatRuntime(candidate, 'facebook', env),
      (error) => error.code === 'META_MANUAL_UAT_TARGET_INVALID',
    );
  }
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

test('Meta runtime accepts a bounded large-inventory unit ceiling without changing the default', () => {
  const config = loadMetaEndToEndRuntimeConfig({ MKT_META_SOURCE_MAX_UNITS: '2500' });
  assert.equal(config.limits.sourceMaxUnits, 2_500);
  assert.throws(
    () => loadMetaEndToEndRuntimeConfig({ MKT_META_SOURCE_MAX_UNITS: '2501' }),
    (error) => error instanceof TypeError && /1 to 2500/u.test(error.message),
  );
});

test('Meta runtime keeps one-page invocations while allowing a bounded large-account page ceiling', () => {
  const config = loadMetaEndToEndRuntimeConfig({ MKT_META_SOURCE_MAX_PAGES: '500' });
  assert.equal(config.limits.sourceMaxPages, 500);
  assert.throws(
    () => loadMetaEndToEndRuntimeConfig({ MKT_META_SOURCE_MAX_PAGES: '2501' }),
    (error) => error instanceof TypeError && /1 to 2500/u.test(error.message),
  );
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
