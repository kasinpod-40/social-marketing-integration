import test from 'node:test';
import assert from 'node:assert/strict';
import {
  YOUTUBE_DESTINATION_MAPPING,
  YOUTUBE_LARK_BLUEPRINT,
  YOUTUBE_ORGANIC_BLUEPRINT_VERSION,
  YOUTUBE_ORGANIC_SOURCE_CONTRACT,
} from '../../packages/config/src/youtube-organic-blueprint.js';
import { META_ORGANIC_CONTRACT } from '../../packages/config/src/meta-organic-contract.js';
import {
  CHATWOOT_SOURCE_CONTRACT,
  WOOCOMMERCE_SOURCE_CONTRACT,
} from '../../packages/config/src/commerce-conversation-contracts.js';
import {
  ADS_CANONICAL_CONTRACT,
  ADS_LARK_BLUEPRINT,
} from '../../packages/config/src/ads-data-model.js';

test('YouTube blueprint preserves latest-state Data API rows and RAW-only Pacific-day Analytics', () => {
  assert.equal(YOUTUBE_ORGANIC_BLUEPRINT_VERSION, 'youtube-organic-v2');
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.dataApi.channelGrain, 'latest_state_one_row_per_channel');
  assert.equal(
    YOUTUBE_ORGANIC_SOURCE_CONTRACT.dataApi.uploadsPlaylist.activationPolicy,
    'block_playlist_traversal_when_missing',
  );
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.storageMode, 'raw_only_phase_1');
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.canonicalDestination, null);
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.sourceDateField, 'source_metric_date');
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.sourceTimezone, 'America/Los_Angeles');
  assert.deepEqual(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.query.dimensions, ['day', 'video']);
  assert.deepEqual(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.query.sort, ['day', 'video']);
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.query.maxVideoIdsPerQuery, 50);
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.query.officialMaxVideoFilterIds, 500);
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.query.maxRowsPerPage, 200);
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.query.maxPages, 1000);
  assert.equal(
    YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.query.emptyResult,
    'persist_no_rows_no_zero_no_cartesian_gap_warning',
  );
  assert.equal(
    YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.query.absentUnobservedVideoDay,
    'persist_no_row_no_zero_no_warning',
  );
  assert.equal(
    YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.query.previouslyObservedRowMissingOnRefetch,
    'retain_prior_row_emit_reconciliation_warning',
  );
  assert.equal(
    YOUTUBE_ORGANIC_SOURCE_CONTRACT.analyticsApi.metricUnits.averageViewDuration,
    'seconds_source_no_conversion',
  );
  assert.deepEqual(YOUTUBE_LARK_BLUEPRINT.map((table) => table.key), [
    'rawYouTubeChannels', 'rawYouTubeVideos', 'rawYouTubeAnalyticsDaily',
  ]);
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.dataApi.videosListWithIds.maxResultsSupported, false);
  assert.equal(
    YOUTUBE_ORGANIC_SOURCE_CONTRACT.dataApi.quotaPolicy.quotaExceeded,
    'terminal_alert_wait_for_reset_or_quota_increase',
  );
  assert.equal(Object.isFrozen(YOUTUBE_LARK_BLUEPRINT[0].fields), true);
});

test('YouTube field and destination contracts prevent destructive reconciliation and metric collisions', () => {
  const byTable = Object.fromEntries(YOUTUBE_LARK_BLUEPRINT.map((table) => [table.key, table]));
  const fieldType = (table, fieldName) => table.fields.find((entry) => entry.fieldName === fieldName)?.type;

  assert.equal(fieldType(byTable.rawYouTubeChannels, 'subscriber_count_hidden'), 7);
  assert.equal(fieldType(byTable.rawYouTubeVideos, 'last_seen_at'), 5);
  assert.equal(fieldType(byTable.rawYouTubeVideos, 'source_availability_status'), 3);
  assert.equal(fieldType(byTable.rawYouTubeVideos, 'missing_since'), 5);
  assert.equal(fieldType(byTable.rawYouTubeAnalyticsDaily, 'source_metric_date'), 1);
  assert.equal(fieldType(byTable.rawYouTubeAnalyticsDaily, 'metric_date'), undefined);
  assert.equal(
    YOUTUBE_ORGANIC_SOURCE_CONTRACT.reconciliation.missingVideo,
    'retain_prior_metrics_emit_warning_never_delete_or_zero_fill',
  );
  assert.equal(YOUTUBE_ORGANIC_SOURCE_CONTRACT.contentClassification.phase1ContentType, 'video');
  assert.equal(
    YOUTUBE_DESTINATION_MAPPING.RAW_YouTube_Analytics_Daily.canonicalDestination,
    null,
  );
  assert.equal(YOUTUBE_DESTINATION_MAPPING.MKT_Content.fieldMap.content_type, 'video');
  assert.equal(YOUTUBE_DESTINATION_MAPPING.MKT_Content.fieldMap.latest_views, 'view_count');
  assert.equal(YOUTUBE_DESTINATION_MAPPING.MKT_Content.fieldMap.latest_shares, null);
  assert.equal(YOUTUBE_DESTINATION_MAPPING.MKT_Content_Daily.fieldMap.metric_date, 'configured_reporting_metric_date');
  assert.equal(
    YOUTUBE_DESTINATION_MAPPING.MKT_Content_Daily.semantics,
    'cumulative_snapshot',
  );
});

test('Meta, WooCommerce and Chatwoot contracts keep auth/pagination rules platform-specific', () => {
  assert.equal(META_ORGANIC_CONTRACT.transport.pagination.includes('cursor'), true);
  assert.equal(WOOCOMMERCE_SOURCE_CONTRACT.pagination.includes('x_wp_total_pages'), true);
  assert.equal(CHATWOOT_SOURCE_CONTRACT.auth, 'api_access_token_header');
});

test('Ads model covers shared hierarchy and prevents target ROAS from becoming actual ROAS', () => {
  assert.deepEqual(ADS_CANONICAL_CONTRACT.hierarchy, ['account', 'campaign', 'ad_group', 'ad']);
  assert.deepEqual(ADS_CANONICAL_CONTRACT.assetEntities, ['creative']);
  assert.equal(ADS_CANONICAL_CONTRACT.metricSemantics.money.sourceOfTruth, 'integer_micros');
  assert.equal(ADS_CANONICAL_CONTRACT.metricSemantics.targetRoasIsActualRoas, false);
  assert.deepEqual(ADS_LARK_BLUEPRINT.map((table) => table.primaryField), [
    'ads_account_key', 'ads_campaign_key', 'ads_ad_group_key', 'ads_ad_key',
    'ads_creative_key', 'ads_daily_key',
  ]);
});
