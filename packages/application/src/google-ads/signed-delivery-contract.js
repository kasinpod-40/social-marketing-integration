import {
  ADS_MONEY_SCALE,
  calculateAdsDerivedMetrics,
  createAdsEntityKey,
} from '../../../domain/src/entities/ads.js';
import { requireDateOnly as requireValidDateOnly } from '../../../shared/src/date/date-only.js';
import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const GOOGLE_ADS_SIGNED_DELIVERY_SCHEMA = 'google_ads_signed_delivery_v1';
export const GOOGLE_ADS_DELIVERY_PATH = '/v1/google-ads/deliveries';
export const GOOGLE_ADS_MANAGER_CUSTOMER_ID = '9463570541';
export const GOOGLE_ADS_CUSTOMER_ID = '5662332033';
export const GOOGLE_ADS_CUSTOMER_KEY = 'chemistry_k';
export const GOOGLE_ADS_ACCOUNT_KEY = 'chemistry_k';
export const GOOGLE_ADS_SOURCE_TIMEZONE = 'Asia/Bangkok';
export const GOOGLE_ADS_REPLAY_WINDOW_SECONDS = 300;
export const GOOGLE_ADS_NONCE_RETENTION_SECONDS = 600;
export const GOOGLE_ADS_DELIVERY_PAYLOAD_RETENTION_SECONDS = 7 * 24 * 60 * 60;
export const GOOGLE_ADS_DELIVERY_AUDIT_RETENTION_SECONDS = 30 * 24 * 60 * 60;
export const GOOGLE_ADS_MAX_BODY_BYTES = 8 * 1024 * 1024;

export const GOOGLE_ADS_SIGNATURE_HEADERS = Object.freeze({
  keyId: 'x-mkt-key-id',
  timestamp: 'x-mkt-timestamp',
  nonce: 'x-mkt-nonce',
  idempotencyKey: 'x-mkt-idempotency-key',
  contentSha256: 'x-mkt-content-sha256',
  signature: 'x-mkt-signature',
});

export const GOOGLE_ADS_DATASET_LIMITS = Object.freeze({
  campaigns: 500,
  adGroups: 2_000,
  ads: 5_000,
  youtubeAssets: 5_000,
  campaignDailyMetrics: 10_000,
});

const MODE = new Set(['PREVIEW', 'LIVE']);
const REPORT_LEVELS = new Set(['campaign']);

/** Validate and freeze the exact signed-delivery envelope. Unknown fields fail closed. */
export function validateGoogleAdsDeliveryEnvelope(value) {
  const envelope = requireObject(value, 'envelope');
  assertExactKeys(envelope, [
    'schemaVersion', 'deliveryId', 'mode', 'managerCustomerId', 'customerId',
    'customerKey', 'accountKey', 'fetchedAt', 'sourceTimezone', 'datasetCounts', 'datasets',
  ], 'envelope');

  const schemaVersion = requireExact(envelope.schemaVersion, GOOGLE_ADS_SIGNED_DELIVERY_SCHEMA, 'schemaVersion');
  const deliveryId = requireUuid(envelope.deliveryId, 'deliveryId');
  const mode = requireChoice(envelope.mode, MODE, 'mode');
  const managerCustomerId = requireExact(
    normalizeCustomerId(envelope.managerCustomerId),
    GOOGLE_ADS_MANAGER_CUSTOMER_ID,
    'managerCustomerId',
  );
  const customerId = requireExact(
    normalizeCustomerId(envelope.customerId),
    GOOGLE_ADS_CUSTOMER_ID,
    'customerId',
  );
  const customerKey = requireExact(envelope.customerKey, GOOGLE_ADS_CUSTOMER_KEY, 'customerKey');
  const accountKey = requireExact(envelope.accountKey, GOOGLE_ADS_ACCOUNT_KEY, 'accountKey');
  const fetchedAt = requireIsoInstant(envelope.fetchedAt, 'fetchedAt');
  const sourceTimezone = requireExact(
    envelope.sourceTimezone,
    GOOGLE_ADS_SOURCE_TIMEZONE,
    'sourceTimezone',
  );
  const datasets = validateDatasets(envelope.datasets, { customerId, sourceTimezone });
  const datasetCounts = validateCounts(envelope.datasetCounts, datasets);

  return deepFreeze({
    schemaVersion,
    deliveryId,
    mode,
    managerCustomerId,
    customerId,
    customerKey,
    accountKey,
    fetchedAt,
    sourceTimezone,
    datasetCounts,
    datasets,
  });
}

export function expectedGoogleAdsIdempotencyKey(deliveryId) {
  return `google-ads:${requireUuid(deliveryId, 'deliveryId')}`;
}

/** Convert strict transport rows into exact already-applied RAW and Canonical Lark fields. */
export function buildGoogleAdsDestinationRows(envelope) {
  const input = validateGoogleAdsDeliveryEnvelope(envelope);
  const fetchedAtMs = Date.parse(input.fetchedAt);
  const customerId = input.customerId;
  const account = input.datasets.account;
  const campaignById = new Map(input.datasets.campaigns.map((row) => [row.campaignId, row]));

  const rawAccounts = [compact({
    raw_account_key: `google_ads:${customerId}:account`,
    ads_account_key: createAdsEntityKey({
      platform: 'google_ads', accountId: customerId, entityType: 'account', externalEntityId: customerId,
    }),
    customer_id: customerId,
    descriptive_name: account.descriptiveName,
    currency_code: account.currencyCode,
    time_zone: account.timeZone,
    account_status: account.status,
    is_manager: account.isManager,
    is_test_account: account.isTestAccount,
    manager_customer_id: input.managerCustomerId,
    resource_name: account.resourceName,
    fetched_at: fetchedAtMs,
    last_seen_at: fetchedAtMs,
    source_payload_json: safeSourceJson(account),
  })];

  const rawCampaigns = input.datasets.campaigns.map((row) => compact({
    raw_campaign_key: `google_ads:${customerId}:campaign:${row.campaignId}`,
    ads_campaign_key: createAdsEntityKey({
      platform: 'google_ads', accountId: customerId, entityType: 'campaign', externalEntityId: row.campaignId,
    }),
    customer_id: customerId,
    campaign_id: row.campaignId,
    campaign_name: row.campaignName,
    status: row.status,
    primary_status: row.primaryStatus,
    serving_status: row.servingStatus,
    advertising_channel_type: row.advertisingChannelType,
    advertising_channel_sub_type: row.advertisingChannelSubType,
    start_date: nullableDateOnlyEpoch(row.startDate, input.sourceTimezone),
    end_date: nullableDateOnlyEpoch(row.endDate, input.sourceTimezone),
    bidding_strategy_type: row.biddingStrategyType,
    campaign_budget_id: row.campaignBudgetId,
    campaign_budget_resource_name: row.campaignBudgetResourceName,
    resource_name: row.resourceName,
    fetched_at: fetchedAtMs,
    last_seen_at: fetchedAtMs,
    source_payload_json: safeSourceJson(row),
  }));

  const rawAdGroups = input.datasets.adGroups.map((row) => compact({
    raw_ad_group_key: `google_ads:${customerId}:ad_group:${row.adGroupId}`,
    ads_ad_group_key: createAdsEntityKey({
      platform: 'google_ads', accountId: customerId, entityType: 'ad_group', externalEntityId: row.adGroupId,
    }),
    customer_id: customerId,
    campaign_id: row.campaignId,
    ad_group_id: row.adGroupId,
    ad_group_name: row.adGroupName,
    status: row.status,
    primary_status: row.primaryStatus,
    ad_group_type: row.type,
    resource_name: row.resourceName,
    fetched_at: fetchedAtMs,
    last_seen_at: fetchedAtMs,
    source_payload_json: safeSourceJson(row),
  }));

  const rawAds = input.datasets.ads.map((row) => compact({
    raw_ad_key: `google_ads:${customerId}:ad:${row.adId}`,
    ads_ad_key: createAdsEntityKey({
      platform: 'google_ads', accountId: customerId, entityType: 'ad', externalEntityId: row.adId,
    }),
    customer_id: customerId,
    campaign_id: row.campaignId,
    ad_group_id: row.adGroupId,
    ad_id: row.adId,
    ad_name: row.adName,
    status: row.status,
    primary_status: row.primaryStatus,
    ad_type: row.type,
    final_urls_json: row.finalUrls === null ? null : JSON.stringify(row.finalUrls),
    display_url: row.displayUrl,
    resource_name: row.resourceName,
    fetched_at: fetchedAtMs,
    last_seen_at: fetchedAtMs,
    source_payload_json: safeSourceJson(row),
  }));

  const rawAssets = input.datasets.youtubeAssets.map((row) => compact({
    raw_asset_key: `google_ads:${customerId}:asset:${row.assetId}`,
    ads_creative_key: createAdsEntityKey({
      platform: 'google_ads', accountId: customerId, entityType: 'creative', externalEntityId: row.assetId,
    }),
    customer_id: customerId,
    asset_id: row.assetId,
    asset_name: row.assetName,
    asset_type: row.assetType,
    source_content_id: row.youtubeVideoId,
    source_content_title: row.youtubeVideoTitle,
    source_content_url: youtubeWatchUrl(row.youtubeVideoId),
    thumbnail_url: youtubeThumbnailUrl(row.youtubeVideoId),
    resource_name: row.resourceName,
    fetched_at: fetchedAtMs,
    last_seen_at: fetchedAtMs,
    source_payload_json: safeSourceJson(row),
  }));

  const rawDaily = input.datasets.campaignDailyMetrics.map((row) => compact({
    raw_ads_daily_key: `google_ads:${customerId}:${row.reportLevel}:${row.externalEntityId}:${row.metricDate}:${row.segmentKey}`,
    metric_date: dateOnlyInTimeZoneToEpochMilliseconds(row.metricDate, input.sourceTimezone, {
      label: 'Google Ads metricDate',
    }),
    customer_id: customerId,
    report_level: row.reportLevel,
    external_entity_id: row.externalEntityId,
    campaign_id: row.campaignId,
    ad_group_id: row.adGroupId,
    ad_id: row.adId,
    advertising_channel_type: row.advertisingChannelType,
    advertising_channel_sub_type: row.advertisingChannelSubType,
    ad_channel: row.adChannel,
    segment_key: row.segmentKey,
    currency: row.currency,
    cost_micros: row.spendMicros,
    impressions: row.impressions,
    clicks: row.clicks,
    conversions: row.conversions,
    conversion_value_micros: row.conversionValueMicros,
    video_views: row.videoViews,
    video_view_rate: row.videoViewRate,
    average_cpv_micros: row.averageCpvMicros,
    fetched_at: fetchedAtMs,
    source_payload_json: safeSourceJson(row),
  }));

  const canonical = buildCanonicalRows(input, campaignById, fetchedAtMs);
  return deepFreeze({
    raw: {
      accounts: rawAccounts,
      campaigns: rawCampaigns,
      adGroups: rawAdGroups,
      ads: rawAds,
      assets: rawAssets,
      daily: rawDaily,
    },
    canonical,
  });
}

function buildCanonicalRows(input, campaignById, fetchedAtMs) {
  const customerId = input.customerId;
  const account = input.datasets.account;
  const accounts = [compact({
    ads_account_key: createAdsEntityKey({
      platform: 'google_ads', accountId: customerId, entityType: 'account', externalEntityId: customerId,
    }),
    platform: 'google_ads',
    ads_account_id: customerId,
    ads_account_name: account.descriptiveName,
    currency: account.currencyCode,
    timezone: account.timeZone,
    connection_status: 'connected',
  })];

  const campaigns = input.datasets.campaigns.map((row) => compact({
    campaign_key: createAdsEntityKey({
      platform: 'google_ads', accountId: customerId, entityType: 'campaign', externalEntityId: row.campaignId,
    }),
    platform: 'google_ads',
    ad_channel: mapAdChannel(row.advertisingChannelType),
    ads_account_id: customerId,
    campaign_id: row.campaignId,
    campaign_name: row.campaignName,
    objective: row.advertisingChannelSubType,
    campaign_status: normalizeStatus(row.status),
    start_date: nullableDateOnlyEpoch(row.startDate, input.sourceTimezone),
    end_date: nullableDateOnlyEpoch(row.endDate, input.sourceTimezone),
  }));

  const adGroups = input.datasets.adGroups.map((row) => compact({
    ad_group_key: createAdsEntityKey({
      platform: 'google_ads', accountId: customerId, entityType: 'ad_group', externalEntityId: row.adGroupId,
    }),
    platform: 'google_ads',
    ad_channel: mapAdChannel(campaignById.get(row.campaignId)?.advertisingChannelType),
    ads_account_id: customerId,
    campaign_id: row.campaignId,
    ad_group_id: row.adGroupId,
    ad_group_name: row.adGroupName,
    ad_group_status: normalizeStatus(row.status),
  }));

  const ads = input.datasets.ads.map((row) => compact({
    ads_ad_key: createAdsEntityKey({
      platform: 'google_ads', accountId: customerId, entityType: 'ad', externalEntityId: row.adId,
    }),
    platform: 'google_ads',
    ad_channel: mapAdChannel(campaignById.get(row.campaignId)?.advertisingChannelType),
    account_id: customerId,
    external_campaign_id: row.campaignId,
    external_ad_group_id: row.adGroupId,
    external_ad_id: row.adId,
    external_creative_id: null,
    ad_name: row.adName,
    status: normalizeStatus(row.status),
    last_sync_at: fetchedAtMs,
  }));

  const creatives = input.datasets.youtubeAssets.map((row) => compact({
    creative_key: createAdsEntityKey({
      platform: 'google_ads', accountId: customerId, entityType: 'creative', externalEntityId: row.assetId,
    }),
    platform: 'google_ads',
    ad_channel: 'youtube_ads',
    ads_account_id: customerId,
    ad_name: row.assetName,
    ad_status: normalizeStatus(row.status),
    video_id: row.youtubeVideoId,
    creative_type: 'video',
  }));

  const daily = input.datasets.campaignDailyMetrics.map((row) => {
    const derived = calculateAdsDerivedMetrics({
      spend_micros: row.spendMicros,
      impressions: row.impressions,
      clicks: row.clicks,
      conversion_value_micros: row.conversionValueMicros,
    });
    const spend = microsToCurrency(row.spendMicros);
    const conversionValue = microsToCurrency(row.conversionValueMicros);
    return compact({
      ads_daily_key: `${createAdsEntityKey({
        platform: 'google_ads',
        accountId: customerId,
        entityType: 'campaign',
        externalEntityId: row.externalEntityId,
      })}:${row.metricDate}`,
      metric_date: dateOnlyInTimeZoneToEpochMilliseconds(row.metricDate, input.sourceTimezone, {
        label: 'Ads metricDate',
      }),
      platform: 'google_ads',
      ad_channel: row.adChannel,
      ads_account_id: customerId,
      campaign_id: row.campaignId,
      ad_group_id: null,
      ad_id: null,
      currency: row.currency,
      spend_micros: row.spendMicros,
      spend,
      impressions: row.impressions,
      reach: null,
      clicks: row.clicks,
      conversions: row.conversions,
      conversion_value_micros: row.conversionValueMicros,
      conversion_value: conversionValue,
      ctr: derived.ctr,
      cpc: derived.cpc,
      cpm: derived.cpm,
      cpa: safeDivide(spend, row.conversions),
      actual_roas: derived.actual_roas,
    });
  });
  return { accounts, campaigns, adGroups, ads, creatives, daily };
}

function validateDatasets(value, context) {
  const datasets = requireObject(value, 'datasets');
  assertExactKeys(
    datasets,
    ['account', 'campaigns', 'adGroups', 'ads', 'youtubeAssets', 'campaignDailyMetrics'],
    'datasets',
  );
  const validated = {
    account: validateAccount(datasets.account, context),
    campaigns: validateRows(
      datasets.campaigns,
      'campaigns',
      GOOGLE_ADS_DATASET_LIMITS.campaigns,
      validateCampaign,
    ),
    adGroups: validateRows(
      datasets.adGroups,
      'adGroups',
      GOOGLE_ADS_DATASET_LIMITS.adGroups,
      validateAdGroup,
    ),
    ads: validateRows(datasets.ads, 'ads', GOOGLE_ADS_DATASET_LIMITS.ads, validateAd),
    youtubeAssets: validateRows(
      datasets.youtubeAssets,
      'youtubeAssets',
      GOOGLE_ADS_DATASET_LIMITS.youtubeAssets,
      validateAsset,
    ),
    campaignDailyMetrics: validateRows(
      datasets.campaignDailyMetrics,
      'campaignDailyMetrics',
      GOOGLE_ADS_DATASET_LIMITS.campaignDailyMetrics,
      validateDaily,
    ),
  };
  validateDatasetRelations(validated);
  for (const row of validated.campaignDailyMetrics) {
    requireExact(row.currency, validated.account.currencyCode, 'campaignDailyMetric.currency');
  }
  return validated;
}

function validateDatasetRelations(datasets) {
  const campaignIds = new Set(datasets.campaigns.map((row) => row.campaignId));
  const adGroups = new Map(datasets.adGroups.map((row) => [row.adGroupId, row]));
  for (const row of datasets.adGroups) {
    if (!campaignIds.has(row.campaignId)) fail('Ad group references an unknown campaign', 'GOOGLE_ADS_DELIVERY_RELATION_INVALID');
  }
  for (const row of datasets.ads) {
    const adGroup = adGroups.get(row.adGroupId);
    if (!adGroup || adGroup.campaignId !== row.campaignId) {
      fail('Ad references an unknown or mismatched ad group', 'GOOGLE_ADS_DELIVERY_RELATION_INVALID');
    }
  }
  for (const row of datasets.campaignDailyMetrics) {
    if (!campaignIds.has(row.campaignId)) fail('Daily metric references an unknown campaign', 'GOOGLE_ADS_DELIVERY_RELATION_INVALID');
  }
}

function validateAccount(row, context) {
  const value = strictRow(
    row,
    ['customerId', 'descriptiveName', 'currencyCode', 'timeZone', 'status', 'isManager', 'isTestAccount', 'resourceName'],
    'datasets.account',
  );
  requireExact(normalizeCustomerId(value.customerId), context.customerId, 'datasets.account.customerId');
  if (value.isManager !== false) fail('Target advertiser must not be a manager account', 'GOOGLE_ADS_DELIVERY_IDENTITY_REJECTED');
  return {
    customerId: context.customerId,
    descriptiveName: nullableText(value.descriptiveName, 'descriptiveName', 200),
    currencyCode: requireCurrency(value.currencyCode),
    timeZone: requireExact(value.timeZone, context.sourceTimezone, 'datasets.account.timeZone'),
    status: nullableText(value.status, 'status', 80),
    isManager: requireBoolean(value.isManager, 'isManager'),
    isTestAccount: requireBoolean(value.isTestAccount, 'isTestAccount'),
    resourceName: nullableText(value.resourceName, 'resourceName', 300),
  };
}

function validateCampaign(row) {
  const value = strictRow(row, [
    'campaignId', 'campaignName', 'status', 'primaryStatus', 'servingStatus',
    'advertisingChannelType', 'advertisingChannelSubType', 'startDate', 'endDate',
    'biddingStrategyType', 'campaignBudgetId', 'campaignBudgetResourceName', 'resourceName',
  ], 'campaign');
  return {
    campaignId: requireDigits(value.campaignId, 'campaignId'),
    campaignName: nullableText(value.campaignName, 'campaignName', 300),
    status: nullableText(value.status, 'status', 80),
    primaryStatus: nullableText(value.primaryStatus, 'primaryStatus', 80),
    servingStatus: nullableText(value.servingStatus, 'servingStatus', 80),
    advertisingChannelType: requireText(value.advertisingChannelType, 'advertisingChannelType', 80),
    advertisingChannelSubType: nullableText(value.advertisingChannelSubType, 'advertisingChannelSubType', 100),
    startDate: nullableDateOnly(value.startDate, 'startDate'),
    endDate: nullableDateOnly(value.endDate, 'endDate'),
    biddingStrategyType: nullableText(value.biddingStrategyType, 'biddingStrategyType', 100),
    campaignBudgetId: nullableDigits(value.campaignBudgetId, 'campaignBudgetId'),
    campaignBudgetResourceName: nullableText(value.campaignBudgetResourceName, 'campaignBudgetResourceName', 300),
    resourceName: nullableText(value.resourceName, 'resourceName', 300),
  };
}

function validateAdGroup(row) {
  const value = strictRow(
    row,
    ['adGroupId', 'campaignId', 'adGroupName', 'status', 'primaryStatus', 'type', 'resourceName'],
    'adGroup',
  );
  return {
    adGroupId: requireDigits(value.adGroupId, 'adGroupId'),
    campaignId: requireDigits(value.campaignId, 'campaignId'),
    adGroupName: nullableText(value.adGroupName, 'adGroupName', 300),
    status: nullableText(value.status, 'status', 80),
    primaryStatus: nullableText(value.primaryStatus, 'primaryStatus', 80),
    type: nullableText(value.type, 'type', 100),
    resourceName: nullableText(value.resourceName, 'resourceName', 300),
  };
}

function validateAd(row) {
  const value = strictRow(row, [
    'adId', 'adGroupId', 'campaignId', 'adName', 'status', 'primaryStatus',
    'type', 'finalUrls', 'displayUrl', 'resourceName',
  ], 'ad');
  return {
    adId: requireDigits(value.adId, 'adId'),
    adGroupId: requireDigits(value.adGroupId, 'adGroupId'),
    campaignId: requireDigits(value.campaignId, 'campaignId'),
    adName: nullableText(value.adName, 'adName', 300),
    status: nullableText(value.status, 'status', 80),
    primaryStatus: nullableText(value.primaryStatus, 'primaryStatus', 80),
    type: nullableText(value.type, 'type', 100),
    finalUrls: nullableStringArray(value.finalUrls, 'finalUrls', 20, 2_000),
    displayUrl: nullableText(value.displayUrl, 'displayUrl', 2_000),
    resourceName: nullableText(value.resourceName, 'resourceName', 300),
  };
}

function validateAsset(row) {
  const value = strictRow(
    row,
    ['assetId', 'assetName', 'status', 'assetType', 'youtubeVideoId', 'youtubeVideoTitle', 'resourceName'],
    'youtubeAsset',
  );
  return {
    assetId: requireDigits(value.assetId, 'assetId'),
    assetName: nullableText(value.assetName, 'assetName', 300),
    status: nullableText(value.status, 'status', 80),
    assetType: requireExact(value.assetType, 'YOUTUBE_VIDEO', 'assetType'),
    youtubeVideoId: requireText(value.youtubeVideoId, 'youtubeVideoId', 32),
    youtubeVideoTitle: nullableText(value.youtubeVideoTitle, 'youtubeVideoTitle', 500),
    resourceName: nullableText(value.resourceName, 'resourceName', 300),
  };
}

function validateDaily(row) {
  const value = strictRow(row, [
    'metricDate', 'reportLevel', 'externalEntityId', 'campaignId', 'adGroupId', 'adId',
    'advertisingChannelType', 'advertisingChannelSubType', 'adChannel', 'segmentKey',
    'currency', 'spendMicros', 'impressions', 'clicks', 'conversions',
    'conversionValueMicros', 'videoViews', 'videoViewRate', 'averageCpvMicros',
  ], 'campaignDailyMetric');
  const campaignId = requireDigits(value.campaignId, 'campaignId');
  requireExact(requireDigits(value.externalEntityId, 'externalEntityId'), campaignId, 'externalEntityId');
  requireExact(value.adGroupId, null, 'adGroupId');
  requireExact(value.adId, null, 'adId');
  const advertisingChannelType = requireText(value.advertisingChannelType, 'advertisingChannelType', 80);
  return {
    metricDate: requireDateOnly(value.metricDate, 'metricDate'),
    reportLevel: requireChoice(value.reportLevel, REPORT_LEVELS, 'reportLevel'),
    externalEntityId: campaignId,
    campaignId,
    adGroupId: null,
    adId: null,
    advertisingChannelType,
    advertisingChannelSubType: nullableText(value.advertisingChannelSubType, 'advertisingChannelSubType', 100),
    adChannel: requireExact(value.adChannel, mapAdChannel(advertisingChannelType), 'adChannel'),
    segmentKey: requireExact(value.segmentKey, 'all', 'segmentKey'),
    currency: requireCurrency(value.currency),
    spendMicros: nullableSafeInteger(value.spendMicros, 'spendMicros'),
    impressions: nullableSafeInteger(value.impressions, 'impressions'),
    clicks: nullableSafeInteger(value.clicks, 'clicks'),
    conversions: nullableFinite(value.conversions, 'conversions'),
    conversionValueMicros: nullableSafeInteger(value.conversionValueMicros, 'conversionValueMicros'),
    videoViews: nullableSafeInteger(value.videoViews, 'videoViews'),
    videoViewRate: nullableFinite(value.videoViewRate, 'videoViewRate'),
    averageCpvMicros: nullableSafeInteger(value.averageCpvMicros, 'averageCpvMicros'),
  };
}

function validateRows(value, label, limit, validator) {
  if (!Array.isArray(value)) fail(`${label} must be an array`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  if (value.length > limit) fail(`${label} exceeds ${limit} rows`, 'GOOGLE_ADS_DELIVERY_LIMIT_EXCEEDED');
  const rows = value.map((row) => validator(row));
  assertUnique(rows, uniqueKeyFor(label), label);
  assertStableOrder(rows, compareFor(label), label);
  return rows;
}

function uniqueKeyFor(label) {
  if (label === 'campaigns') return (row) => row.campaignId;
  if (label === 'adGroups') return (row) => row.adGroupId;
  if (label === 'ads') return (row) => row.adId;
  if (label === 'youtubeAssets') return (row) => row.assetId;
  return (row) => `${row.metricDate}:${row.externalEntityId}:${row.segmentKey}`;
}

function compareFor(label) {
  if (label === 'campaignDailyMetrics') {
    return (left, right) => left.metricDate.localeCompare(right.metricDate)
      || compareDigitText(left.externalEntityId, right.externalEntityId);
  }
  const field = ({ campaigns: 'campaignId', adGroups: 'adGroupId', ads: 'adId', youtubeAssets: 'assetId' })[label];
  return (left, right) => compareDigitText(left[field], right[field]);
}

function validateCounts(value, datasets) {
  const counts = requireObject(value, 'datasetCounts');
  assertExactKeys(
    counts,
    ['account', 'campaigns', 'adGroups', 'ads', 'youtubeAssets', 'campaignDailyMetrics'],
    'datasetCounts',
  );
  const expected = {
    account: 1,
    campaigns: datasets.campaigns.length,
    adGroups: datasets.adGroups.length,
    ads: datasets.ads.length,
    youtubeAssets: datasets.youtubeAssets.length,
    campaignDailyMetrics: datasets.campaignDailyMetrics.length,
  };
  for (const [key, count] of Object.entries(expected)) {
    if (counts[key] !== count) fail(`datasetCounts.${key} does not match datasets`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  }
  return expected;
}

function strictRow(value, keys, label) {
  const row = requireObject(value, label);
  assertExactKeys(row, keys, label);
  return row;
}

function assertExactKeys(value, expected, label) {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    fail(`${label} fields do not match the signed-delivery schema`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  }
}

function assertUnique(rows, keyFn, label) {
  const seen = new Set();
  for (const row of rows) {
    const key = keyFn(row);
    if (seen.has(key)) fail(`${label} contains a duplicate stable identity`, 'GOOGLE_ADS_DELIVERY_DUPLICATE_ROW');
    seen.add(key);
  }
}

function assertStableOrder(rows, compare, label) {
  for (let index = 1; index < rows.length; index += 1) {
    if (compare(rows[index - 1], rows[index]) > 0) {
      fail(`${label} is not in canonical stable order`, 'GOOGLE_ADS_DELIVERY_ORDER_INVALID');
    }
  }
}

function compareDigitText(left, right) {
  const a = BigInt(left);
  const b = BigInt(right);
  return a < b ? -1 : a > b ? 1 : 0;
}

function normalizeCustomerId(value) {
  const text = requireText(value, 'customerId', 32);
  if (!/^(?:\d{10}|\d{3}-\d{3}-\d{4})$/u.test(text)) {
    fail('customerId must be 10 digits or ###-###-####', 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  }
  return text.replace(/-/gu, '');
}
function requireExact(value, expected, label) {
  if (value !== expected) fail(`${label} is not allowed`, 'GOOGLE_ADS_DELIVERY_IDENTITY_REJECTED');
  return value;
}
function requireChoice(value, choices, label) {
  const text = requireText(value, label, 100);
  if (!choices.has(text)) fail(`${label} is unsupported`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  return text;
}
function requireUuid(value, label) {
  const text = requireText(value, label, 64);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(text)) {
    fail(`${label} must be UUID v4`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  }
  return text.toLowerCase();
}
function requireDigits(value, label) {
  const text = requireText(value, label, 32);
  if (!/^\d+$/u.test(text)) fail(`${label} must contain digits`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  return text;
}
function nullableDigits(value, label) { return value === null ? null : requireDigits(value, label); }
function requireText(value, label, maxLength) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${label} is required`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  const text = value.trim();
  if (maxLength && text.length > maxLength) fail(`${label} is too long`, 'GOOGLE_ADS_DELIVERY_LIMIT_EXCEEDED');
  return text;
}
function nullableText(value, label, maxLength) { return value === null ? null : requireText(value, label, maxLength); }
function nullableStringArray(value, label, maxItems, maxLength) {
  if (value === null) return null;
  if (!Array.isArray(value) || value.length > maxItems) fail(`${label} is invalid`, 'GOOGLE_ADS_DELIVERY_LIMIT_EXCEEDED');
  return value.map((item, index) => requireText(item, `${label}[${index}]`, maxLength));
}
function requireBoolean(value, label) {
  if (typeof value !== 'boolean') fail(`${label} must be boolean`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  return value;
}
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    fail(`${label} must be an object`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  }
  return value;
}
function requireCurrency(value) {
  const text = requireText(value, 'currency', 3).toUpperCase();
  if (!/^[A-Z]{3}$/u.test(text)) fail('currency is invalid', 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  return text;
}
function requireIsoInstant(value, label) {
  const text = requireText(value, label, 40);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/u.test(text)) {
    fail(`${label} must be UTC RFC3339`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  }

  const milliseconds = Date.parse(text);
  const normalizedInput = text.includes('.')
    ? text.replace(/\.(\d{1,3})Z$/u, (_, fraction) => `.${fraction.padEnd(3, '0')}Z`)
    : text.replace(/Z$/u, '.000Z');
  if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== normalizedInput) {
    fail(`${label} must be a real UTC RFC3339 instant`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  }
  return normalizedInput;
}
function requireDateOnly(value, label) {
  try {
    return requireValidDateOnly(value, { label, minYear: 2000, maxYear: 2100 });
  } catch {
    fail(`${label} must be a real YYYY-MM-DD date`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  }
}
function nullableDateOnly(value, label) { return value === null ? null : requireDateOnly(value, label); }
function nullableDateOnlyEpoch(value, timezone) {
  return value === null ? null : dateOnlyInTimeZoneToEpochMilliseconds(value, timezone, { label: 'Google Ads date' });
}
function nullableSafeInteger(value, label) {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(`${label} must be a non-negative safe integer`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  }
  return value;
}
function nullableFinite(value, label) {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0) {
    fail(`${label} must be a non-negative finite number`, 'GOOGLE_ADS_DELIVERY_SCHEMA_INVALID');
  }
  return value;
}
function normalizeStatus(value) {
  const text = String(value ?? 'UNKNOWN').toUpperCase();
  return ({ ENABLED: 'active', PAUSED: 'paused', REMOVED: 'removed', DELETED: 'deleted' })[text] ?? 'unknown';
}
function mapAdChannel(value) {
  const text = String(value ?? '').toUpperCase();
  if (text === 'VIDEO') return 'youtube_ads';
  if (text === 'SEARCH') return 'google_search_ads';
  return 'google_display_ads';
}
function microsToCurrency(value) { return value === null ? null : value / ADS_MONEY_SCALE; }
function safeDivide(numerator, denominator) {
  return numerator === null || denominator === null || denominator === 0 ? null : numerator / denominator;
}
function youtubeWatchUrl(videoId) { return `https://www.youtube.com/watch?v=${encodeURIComponent(videoId)}`; }
function youtubeThumbnailUrl(videoId) { return `https://i.ytimg.com/vi/${encodeURIComponent(videoId)}/hqdefault.jpg`; }
function compact(value) { return Object.fromEntries(Object.entries(value).filter(([, nested]) => nested !== undefined)); }
function safeSourceJson(value) { return JSON.stringify(value); }
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
function fail(message, code) { throw permanentError(message, { code }); }
