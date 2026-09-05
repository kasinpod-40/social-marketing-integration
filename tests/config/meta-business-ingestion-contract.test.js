import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getMetaBusinessConnectorContract,
  getMetaBusinessDatasetContract,
  META_BUSINESS_CONNECTOR_KEYS,
  META_BUSINESS_INGESTION_CONTRACT,
  META_BUSINESS_SHARED_RAW_TABLES,
  META_ADS_SOURCE_MODES,
} from '../../packages/config/src/meta-business-ingestion-contract.js';

const connectors = META_BUSINESS_INGESTION_CONTRACT.connectors;

test('Meta business source contract reuses only the five approved Shared Raw tables', () => {
  assert.deepEqual(
    [...new Set(Object.values(META_BUSINESS_SHARED_RAW_TABLES))].sort(),
    [
      'RAW_Ads_Daily',
      'RAW_Ads_Entities',
      'RAW_Meta_Organic_Accounts',
      'RAW_Meta_Organic_Content',
      'RAW_Meta_Organic_Metrics',
    ],
  );

  const actualTargets = Object.values(connectors)
    .flatMap((connector) => connector.datasets.map((dataset) => dataset.rawTarget));
  assert.ok(actualTargets.every(
    (target) => Object.values(META_BUSINESS_SHARED_RAW_TABLES).includes(target),
  ));
});

test('every Meta business dataset remains GET-only and blocked on a Live fixture', () => {
  const datasets = Object.values(connectors).flatMap((connector) => connector.datasets);

  assert.ok(datasets.length > 0);
  assert.ok(datasets.every((dataset) => dataset.method === 'GET'));
  assert.ok(datasets.every((dataset) => dataset.activation === 'live_fixture_required'));
  assert.equal(META_BUSINESS_INGESTION_CONTRACT.safeguards.liveCallsAuthorized, false);
  assert.equal(META_BUSINESS_INGESTION_CONTRACT.safeguards.businessWritesAuthorized, false);
  assert.equal(META_BUSINESS_INGESTION_CONTRACT.safeguards.advertisementMutationAllowed, false);
  assert.equal(META_BUSINESS_INGESTION_CONTRACT.safeguards.spendAllowed, false);
  assert.equal(META_BUSINESS_INGESTION_CONTRACT.safeguards.schedulesEnabled, false);
});

test('Facebook discovery and Page read credentials have separate lifecycle contracts', () => {
  const facebook = connectors[META_BUSINESS_CONNECTOR_KEYS.FACEBOOK_ORGANIC];
  const ads = connectors[META_BUSINESS_CONNECTOR_KEYS.META_ADS];

  assert.equal(facebook.discoveryCredentialEnv, 'META_ACCESS_TOKEN');
  assert.equal(facebook.readCredentialEnv, 'META_FACEBOOK_PAGE_ACCESS_TOKEN');
  assert.notEqual(facebook.discoveryCredentialEnv, facebook.readCredentialEnv);
  assert.equal(ads.readCredentialEnv, 'META_ACCESS_TOKEN');
});

test('Facebook content Insights uses only metrics accepted by the Live v25 capability probe', () => {
  const facebook = getMetaBusinessConnectorContract(
    META_BUSINESS_CONNECTOR_KEYS.FACEBOOK_ORGANIC,
  );
  const contentInventory = getMetaBusinessDatasetContract(
    META_BUSINESS_CONNECTOR_KEYS.FACEBOOK_ORGANIC,
    'facebook.content.inventory',
  );
  const contentInsights = getMetaBusinessDatasetContract(
    META_BUSINESS_CONNECTOR_KEYS.FACEBOOK_ORGANIC,
    'facebook.content.insights',
  );

  assert.deepEqual(contentInsights.metrics, [
    'post_media_view',
    'post_total_media_view_unique',
  ]);
  assert.ok(!contentInsights.metrics.includes('reactions_count'));
  assert.ok(!contentInsights.metrics.includes('comments_count'));
  assert.ok(!contentInsights.metrics.includes('shares_count'));
  assert.deepEqual(facebook.requiredPermissions, [
    'pages_show_list',
    'pages_read_engagement',
    'pages_read_user_content',
    'read_insights',
  ]);
  assert.ok(contentInventory.fields.includes('shares'));
  assert.ok(contentInventory.fields.includes('reactions.limit(0).summary(true)'));
  assert.ok(contentInventory.fields.includes('comments.limit(0).summary(true)'));
});

test('Instagram Login stays on graph.instagram.com with the insights permission', () => {
  const instagram = connectors[META_BUSINESS_CONNECTOR_KEYS.INSTAGRAM_ORGANIC];

  assert.equal(instagram.host, 'https://graph.instagram.com');
  assert.ok(instagram.requiredPermissions.includes('instagram_business_basic'));
  assert.ok(instagram.requiredPermissions.includes('instagram_business_manage_insights'));
  assert.ok(instagram.datasets
    .filter((dataset) => dataset.key.endsWith('.insights'))
    .every((dataset) => dataset.metricCapabilityProbeRequired));
});

test('Meta Ads daily contract preserves breakdown, action arrays and revision grain', () => {
  const ads = connectors[META_BUSINESS_CONNECTOR_KEYS.META_ADS];
  const daily = ads.datasets.find((dataset) => dataset.key === 'meta_ads.performance.daily');

  assert.deepEqual(daily.queryContract, {
    level: 'ad',
    timeIncrement: 1,
    breakdowns: ['publisher_platform'],
    actionBreakdowns: ['action_type'],
  });
  assert.ok(daily.fields.includes('actions'));
  assert.ok(daily.fields.includes('action_values'));
  assert.ok(daily.fields.includes('campaign_name'));
  assert.ok(daily.fields.includes('adset_name'));
  assert.ok(daily.fields.includes('ad_name'));
  assert.doesNotMatch(
    META_BUSINESS_INGESTION_CONTRACT.stableKeys.rawAdsDaily,
    /segment_key/u,
  );
  assert.match(META_BUSINESS_INGESTION_CONTRACT.stableKeys.adsDaily, /breakdown_key/u);
  assert.match(META_BUSINESS_INGESTION_CONTRACT.stableKeys.adsDaily, /segment_key/u);
  assert.equal(
    META_BUSINESS_INGESTION_CONTRACT.safeguards.conversionMappingStatus,
    'approval_required',
  );
});

test('Meta Ads scheduled source contract supports activity-scoped Creative reads', () => {
  const ads = connectors[META_BUSINESS_CONNECTOR_KEYS.META_ADS];
  const activityCreative = ads.datasets.find(
    (dataset) => dataset.key === 'meta_ads.creatives.activity_scoped',
  );

  assert.equal(META_ADS_SOURCE_MODES.DAILY_ACTIVITY_SCOPED_CREATIVES,
    'daily_activity_scoped_creatives_v1');
  assert.equal(activityCreative.pathTemplate, '{ad_id}');
  assert.equal(activityCreative.paginated, false);
  assert.ok(activityCreative.fields.includes('account_id'));
});

test('all Meta business transport limits are finite and bounded', () => {
  const transport = META_BUSINESS_INGESTION_CONTRACT.transport;

  for (const key of [
    'timeoutMs',
    'maxPages',
    'pageSize',
    'maxAttempts',
    'maxResponseBytes',
    'maxConcurrency',
  ]) {
    assert.ok(Number.isSafeInteger(transport[key]));
    assert.ok(transport[key] > 0);
  }
  assert.equal(transport.authentication, 'bearer_header_only');
});

test('Meta contract lookups stay connector-scoped and fail closed', () => {
  const facebook = getMetaBusinessConnectorContract(
    META_BUSINESS_CONNECTOR_KEYS.FACEBOOK_ORGANIC,
  );
  const account = getMetaBusinessDatasetContract(
    META_BUSINESS_CONNECTOR_KEYS.FACEBOOK_ORGANIC,
    'facebook.account.latest',
  );

  assert.equal(facebook.platform, 'facebook');
  assert.equal(account.pathTemplate, '{page_id}');
  assert.throws(
    () => getMetaBusinessConnectorContract('unknown'),
    /Unknown Meta business connector/u,
  );
  assert.throws(
    () => getMetaBusinessDatasetContract(
      META_BUSINESS_CONNECTOR_KEYS.INSTAGRAM_ORGANIC,
      'facebook.account.latest',
    ),
    /Unknown Meta business dataset/u,
  );
});
