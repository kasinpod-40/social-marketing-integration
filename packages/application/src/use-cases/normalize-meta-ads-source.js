import { currencyAmountToMicros } from '../../../domain/src/entities/ads.js';
import { createAdsFactKey } from '../storage/marketing-history-contract.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import {
  assertMetaIdentity,
  normalizeMetaAdAccountId,
  requireMetaExternalId,
} from '../../../connectors/src/meta/meta-business-source.helpers.js';
import {
  deepFreezeMeta,
  optionalMetaCount,
  optionalMetaText,
  optionalMetaTimestamp,
  optionalMetaUrl,
  requireMetaObject,
  requireMetaText,
  requireMetaTimestamp,
  safeMetaSourceJson,
} from '../../../connectors/src/meta/meta-business-normalization.helpers.js';

const ENTITY_TYPES = new Set(['account', 'campaign', 'ad_group', 'ad', 'creative']);

/** แปลง Marketing API entity เป็น Shared Raw entity + D1 candidate โดยไม่เขียน */
export function normalizeMetaAdsEntityFixture(input = {}) {
  const entityType = requireChoice(input.entityType, 'entityType', ENTITY_TYPES);
  const accountId = normalizeMetaAdAccountId(input.accountId);
  const resource = requireMetaObject(input.resource, 'Ads entity resource');
  const resourceId = entityType === 'account'
    ? normalizeMetaAdAccountId(resource.account_id ?? resource.id, 'resource.id')
    : requireMetaExternalId(resource.id, 'resource.id');
  if (entityType === 'account') {
    assertMetaIdentity(resourceId, accountId, 'META_AD_ACCOUNT_IDENTITY_MISMATCH');
  }
  const fetchedAt = requireMetaTimestamp(input.fetchedAt, 'fetchedAt');
  const syncRunId = requireMetaText(input.syncRunId, 'syncRunId');
  const parentCampaignId = optionalIdentity(resource.campaign_id, 'campaign_id');
  const parentAdGroupId = optionalIdentity(resource.adset_id, 'adset_id');
  const creativeId = optionalIdentity(resource?.creative?.id ?? resource.creative_id, 'creative_id');
  const sourceUpdatedAt = optionalMetaTimestamp(resource.updated_time, 'updated_time');

  const rawRow = {
    raw_ads_entity_key: `meta_ads:${accountId}:${entityType}:${resourceId}`,
    platform: 'meta_ads',
    ad_channel: null,
    account_id: accountId,
    entity_type: entityType,
    external_entity_id: resourceId,
    parent_campaign_id: parentCampaignId,
    parent_ad_group_id: parentAdGroupId,
    external_creative_id: creativeId,
    entity_name: optionalMetaText(resource.name, 'name'),
    status: optionalMetaText(
      resource.effective_status ?? resource.status ?? resource.account_status,
      'status',
    ),
    objective: optionalMetaText(resource.objective, 'objective'),
    currency: optionalCurrency(resource.currency),
    timezone: optionalMetaText(resource.timezone_name, 'timezone_name'),
    budget_micros: null,
    start_date: optionalDatePrefix(resource.start_time, 'start_time'),
    end_date: optionalDatePrefix(resource.stop_time ?? resource.end_time, 'end_time'),
    landing_page_url: optionalMetaUrl(resource.landing_page_url, 'landing_page_url'),
    source_updated_at: sourceUpdatedAt,
    fetched_at: fetchedAt,
    source_payload_json: safeMetaSourceJson(resource),
    sync_run_id: syncRunId,
  };

  return deepFreezeMeta({
    rawRow,
    entityCandidate: {
      platform: 'meta_ads',
      sourceAccountId: accountId,
      entityType,
      externalEntityId: resourceId,
      parentCampaignId,
      parentAdGroupId,
      externalCreativeId: creativeId,
      entityName: rawRow.entity_name,
      status: rawRow.status,
      objective: rawRow.objective,
      currency: rawRow.currency,
      timezone: rawRow.timezone,
      sourceUpdatedAt,
      sourceAvailabilityStatus: 'available',
      fetchedAt,
    },
  });
}

/** แปลง Meta Ads Insights daily row โดยคง action arrays และไม่เดา Conversion */
export function normalizeMetaAdsDailyFixture(input = {}) {
  const resource = requireMetaObject(input.resource, 'Ads Insights resource');
  const accountId = normalizeMetaAdAccountId(input.accountId);
  assertMetaIdentity(
    normalizeMetaAdAccountId(resource.account_id, 'resource.account_id'),
    accountId,
    'META_AD_ACCOUNT_IDENTITY_MISMATCH',
  );
  const accountKey = requireMetaExternalId(input.accountKey, 'accountKey');
  const accountTimezone = requireMetaText(input.accountTimezone, 'accountTimezone');
  const currency = requireCurrency(input.currency ?? resource.account_currency);
  const metricDate = requireDateOnly(resource.date_start, { label: 'Meta Ads date_start' });
  const dateStop = requireDateOnly(resource.date_stop, { label: 'Meta Ads date_stop' });
  if (metricDate !== dateStop) {
    throw new TypeError('Meta Ads daily fixture must contain one exact day');
  }
  const adId = requireMetaExternalId(resource.ad_id, 'resource.ad_id');
  const campaignId = optionalIdentity(resource.campaign_id, 'campaign_id');
  const adGroupId = optionalIdentity(resource.adset_id, 'adset_id');
  const publisherPlatform = requirePublisherPlatform(resource.publisher_platform);
  const adChannel = publisherPlatform === 'facebook'
    ? 'facebook_ads'
    : 'instagram_ads';
  const breakdownKey = `publisher_platform=${publisherPlatform}`;
  const segmentKey = 'none';
  const fetchedAt = requireMetaTimestamp(input.fetchedAt, 'fetchedAt');
  const syncRunId = requireMetaText(input.syncRunId, 'syncRunId');
  const spendMicros = resource.spend === null || resource.spend === undefined
    ? null
    : currencyAmountToMicros(requireMetaText(resource.spend, 'spend'), 'Meta Ads spend');
  const actionsJson = resource.actions === null || resource.actions === undefined
    ? null
    : safeMetaSourceJson(resource.actions);
  const actionValuesJson = resource.action_values === null
    || resource.action_values === undefined
    ? null
    : safeMetaSourceJson(resource.action_values);
  const rawDailyKey = [
    'meta_ads',
    accountId,
    'ad',
    adId,
    metricDate,
    breakdownKey,
  ].join(':');
  const factKey = createAdsFactKey({
    platform: 'meta_ads',
    account_key: accountKey,
    report_level: 'ad',
    external_entity_id: adId,
    metric_date: metricDate,
    breakdown_key: breakdownKey,
    segment_key: segmentKey,
  });

  const rawRow = {
    raw_ads_daily_key: rawDailyKey,
    platform: 'meta_ads',
    ad_channel: adChannel,
    account_id: accountId,
    entity_type: 'ad',
    external_entity_id: adId,
    external_campaign_id: campaignId,
    external_ad_group_id: adGroupId,
    external_ad_id: adId,
    external_creative_id: optionalIdentity(resource.creative_id, 'creative_id'),
    metric_date: metricDate,
    account_timezone: accountTimezone,
    currency,
    spend_micros: spendMicros,
    impressions: optionalMetaCount(resource.impressions, 'impressions'),
    reach: optionalMetaCount(resource.reach, 'reach'),
    clicks: optionalMetaCount(resource.clicks, 'clicks'),
    conversions: null,
    conversion_value_micros: null,
    actions_json: actionsJson,
    breakdown_key: breakdownKey,
    breakdown_json: safeMetaSourceJson({ publisher_platform: publisherPlatform }),
    fetched_at: fetchedAt,
    source_payload_json: safeMetaSourceJson(resource),
    sync_run_id: syncRunId,
  };

  return deepFreezeMeta({
    rawRow,
    factCandidate: {
      adsFactKey: factKey,
      platform: 'meta_ads',
      accountKey,
      sourceAccountId: accountId,
      reportLevel: 'ad',
      entityType: 'ad',
      externalEntityId: adId,
      externalCampaignId: campaignId,
      externalAdGroupId: adGroupId,
      externalAdId: adId,
      metricDate,
      accountTimezone,
      breakdownKey,
      segmentKey,
      adChannel,
      currency,
      spendMicros,
      impressions: rawRow.impressions,
      reach: rawRow.reach,
      clicks: rawRow.clicks,
      conversions: null,
      conversionValueMicros: null,
      actionsJson,
      actionValuesJson,
      dataStatus: 'revisable',
      fetchedAt,
    },
  });
}

function optionalIdentity(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requireMetaExternalId(value, fieldName);
}

function optionalCurrency(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireCurrency(value);
}

function requireCurrency(value) {
  const currency = requireMetaText(value, 'currency').toUpperCase();
  if (!/^[A-Z]{3}$/u.test(currency)) throw new TypeError('Meta Ads currency must be ISO-4217');
  return currency;
}

function optionalDatePrefix(value, fieldName) {
  const text = optionalMetaText(value, fieldName);
  if (!text) return null;
  return requireDateOnly(text.slice(0, 10), { label: `Meta Ads ${fieldName}` });
}

function requirePublisherPlatform(value) {
  const platform = requireMetaText(value, 'publisher_platform').toLowerCase();
  if (!['facebook', 'instagram'].includes(platform)) {
    throw new TypeError('Meta Ads publisher_platform is unsupported');
  }
  return platform;
}

function requireChoice(value, fieldName, choices) {
  const text = requireMetaText(value, fieldName);
  if (!choices.has(text)) throw new TypeError(`Meta Ads ${fieldName} is unsupported`);
  return text;
}
