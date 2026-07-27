import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import {
  loadMetaEndToEndRuntimeConfig,
} from '../../packages/config/src/meta-end-to-end-runtime-config.js';
import { createMetaEndToEndJobRouter } from '../../apps/sync-worker/src/meta-end-to-end-job-router.js';
import {
  loadMetaAdsD1ReportSource,
  loadMetaOrganicD1ReportSource,
} from '../../packages/application/src/use-cases/load-meta-d1-report-source.js';

test('Meta workstream flags default false and router uses existing catalog jobs', async () => {
  const disabled = loadMetaEndToEndRuntimeConfig({});
  assert.deepEqual(disabled.flags, {
    sourceRead: false,
    d1Write: false,
    larkWrite: false,
    reportRead: false,
  });
  const calls = [];
  const enabled = loadMetaEndToEndRuntimeConfig({
    MKT_META_SOURCE_READ_ENABLED: 'true',
    MKT_META_D1_WRITE_ENABLED: 'true',
    MKT_META_LARK_WRITE_ENABLED: 'true',
  });
  const router = createMetaEndToEndJobRouter({
    runtimeConfig: enabled,
    handlers: {
      facebook: async (input) => { calls.push(input.connector.key); return { ok: true }; },
      instagram: async () => ({ ok: true }),
      meta_ads: async (input) => { calls.push(input.connector.key); return { ok: true }; },
    },
  });
  assert.equal(router.canRoute({ type: JOB_TYPES.FACEBOOK_ORGANIC_SYNC }), true);
  await router.route({ type: JOB_TYPES.FACEBOOK_ORGANIC_SYNC });
  await router.routeConnector('meta_ads', { type: 'integration-owned-meta-ads' });
  assert.deepEqual(calls, ['facebook', 'meta_ads']);

  const d1OnlyRouter = createMetaEndToEndJobRouter({
    runtimeConfig: loadMetaEndToEndRuntimeConfig({
      MKT_META_SOURCE_READ_ENABLED: 'true',
      MKT_META_D1_WRITE_ENABLED: 'true',
      MKT_META_LARK_WRITE_ENABLED: 'false',
    }),
    handlers: { meta_ads: async () => ({ ok: true }) },
  });
  await d1OnlyRouter.routeConnector(
    'meta_ads',
    { type: 'integration-owned-meta-ads' },
    { d1Only: true },
  );
});

test('report loaders mark saturated bounded reads as partial instead of silently complete', async () => {
  const store = {
    async listOrganicContentObservations({ contentKey, limit }) {
      return Array.from({ length: limit }, (_, index) => ({
        observation_key: `${contentKey}:${index}`,
        content_key: contentKey,
        platform: 'facebook',
        observed_at: index,
      }));
    },
    async listAdsDailyFacts({ limit }) {
      return Array.from({ length: limit }, (_, index) => ({
        ads_fact_key: `meta_ads:fact:${index}`,
        platform: 'meta_ads',
      }));
    },
  };
  const organic = await loadMetaOrganicD1ReportSource({
    store,
    platform: 'facebook',
    contentKeys: ['facebook:page_1:post_1'],
    limitPerContent: 2,
  });
  assert.equal(organic.truncated, true);
  assert.equal(organic.dataStatus, 'partial');
  assert.deepEqual(organic.saturatedContentKeys, ['facebook:page_1:post_1']);

  const ads = await loadMetaAdsD1ReportSource({
    store,
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k_meta_ads',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-24',
    limit: 2,
  });
  assert.equal(ads.truncated, true);
  assert.equal(ads.dataStatus, 'partial');
});

test('report loaders read historical facts from D1 stores only', async () => {
  const store = {
    async listOrganicContentObservations({ contentKey }) {
      return [{
        observation_key: `${contentKey}:1`,
        content_key: contentKey,
        platform: contentKey.startsWith('facebook:') ? 'facebook' : 'instagram',
        observed_at: 1,
      }];
    },
    async listAdsDailyFacts() {
      return [{ ads_fact_key: 'meta_ads:fact:1', platform: 'meta_ads' }];
    },
  };
  const organic = await loadMetaOrganicD1ReportSource({
    store,
    platform: 'facebook',
    contentKeys: ['facebook:page_1:post_1', 'instagram:ig_1:media_1'],
  });
  assert.equal(organic.rowCount, 1);
  assert.equal(organic.observations[0].platform, 'facebook');

  const ads = await loadMetaAdsD1ReportSource({
    store,
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k_meta_ads',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-24',
  });
  assert.equal(ads.rowCount, 1);
  assert.equal(ads.dataStatus, 'revisable');
});
