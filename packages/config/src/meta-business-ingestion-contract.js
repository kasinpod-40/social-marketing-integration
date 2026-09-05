export const META_BUSINESS_INGESTION_CONTRACT_VERSION = 'meta-business-ingestion-v1';

export const META_BUSINESS_CONNECTOR_KEYS = Object.freeze({
  FACEBOOK_ORGANIC: 'facebook',
  INSTAGRAM_ORGANIC: 'instagram',
  META_ADS: 'meta_ads',
});

export const META_ADS_SOURCE_MODES = Object.freeze({
  LEGACY_FULL_CREATIVE_INVENTORY: 'legacy_full_creative_inventory_v1',
  DAILY_ACTIVITY_SCOPED_CREATIVES: 'daily_activity_scoped_creatives_v1',
});

export const META_BUSINESS_SHARED_RAW_TABLES = deepFreeze({
  ORGANIC_ACCOUNTS: 'RAW_Meta_Organic_Accounts',
  ORGANIC_CONTENT: 'RAW_Meta_Organic_Content',
  ORGANIC_METRICS: 'RAW_Meta_Organic_Metrics',
  ADS_ENTITIES: 'RAW_Ads_Entities',
  ADS_DAILY: 'RAW_Ads_Daily',
});

const ORGANIC_D1_TARGETS = Object.freeze([
  'organic_content_state',
  'organic_content_observations',
  'organic_account_daily_facts',
  'data_coverage_runs',
  'data_coverage_entities',
]);

const ADS_D1_TARGETS = Object.freeze([
  'ads_entity_state',
  'ads_daily_facts',
  'ads_conversion_daily_facts',
  'data_coverage_runs',
  'data_coverage_entities',
]);

/**
 * Machine-readable Source contract สำหรับงาน Meta ที่ยังรอ Customer Live UAT.
 *
 * Contract นี้ใช้ตรวจ Source-call/Grain/Write boundary เท่านั้น ไม่มี Request
 * executor, Queue producer, D1/Lark writer หรือ Schedule activation.
 */
export const META_BUSINESS_INGESTION_CONTRACT = deepFreeze({
  version: META_BUSINESS_INGESTION_CONTRACT_VERSION,
  status: 'design_complete_live_uat_pending',
  route: 'provider_to_shared_raw_to_d1_to_canonical',
  transport: {
    method: 'GET',
    authentication: 'bearer_header_only',
    apiVersion: 'pinned_runtime_config',
    cursorPagination: true,
    timeoutMs: 30_000,
    maxPages: 100,
    pageSize: 100,
    maxAttempts: 5,
    maxResponseBytes: 8 * 1024 * 1024,
    maxConcurrency: 2,
  },
  history: {
    dashboardLookbackDays: 90,
    adsDateChunkDays: 31,
    adsRevisionLookbackDays: 35,
    reportingEndDate: 'yesterday_in_source_timezone',
  },
  stableKeys: {
    rawOrganicAccount: '{platform}:{source_account_id}',
    rawOrganicContent: '{platform}:{source_account_id}:{source_content_id}',
    rawOrganicMetric:
      '{platform}:{entity_type}:{source_entity_id}:{metric_name}:{period}:{source_time_key}',
    organicContent: '{platform}:{account_key}:{external_content_id}',
    organicObservation:
      '{content_key}:{observed_at}:{observation_kind}:v1',
    organicAccountDaily: '{platform}:{account_key}:{metric_date}',
    rawAdsEntity: '{platform}:{account_id}:{entity_type}:{external_entity_id}',
    rawAdsDaily:
      '{platform}:{account_id}:{entity_type}:{external_entity_id}:{metric_date}:{breakdown_key}',
    adsEntity: '{platform}:{account_key}:{entity_type}:{external_entity_id}',
    adsDaily:
      '{platform}:{account_key}:{report_level}:{external_entity_id}:{metric_date}:{breakdown_key}:{segment_key}',
    adsConversion:
      '{platform}:{account_key}:{report_level}:{external_entity_id}:{metric_date}:{conversion_action_key}:{conversion_category}:{segment_key}',
  },
  safeguards: {
    featureFlagsDefaultFalse: true,
    schedulesEnabled: false,
    liveCallsAuthorized: false,
    businessWritesAuthorized: false,
    advertisementMutationAllowed: false,
    spendAllowed: false,
    sourcePayloadMustBeRedacted: true,
    historicalOrganicSnapshotsFabricated: false,
    missingMetric: null,
    observedZero: 0,
    partialResponseDeletesFacts: false,
    conversionMappingStatus: 'approval_required',
  },
  connectors: {
    [META_BUSINESS_CONNECTOR_KEYS.FACEBOOK_ORGANIC]: {
      platform: 'facebook',
      host: 'https://graph.facebook.com',
      discoveryCredentialEnv: 'META_ACCESS_TOKEN',
      readCredentialEnv: 'META_FACEBOOK_PAGE_ACCESS_TOKEN',
      identityEnv: 'META_FACEBOOK_PAGE_ID',
      requiredPermissions: [
        'pages_show_list',
        'pages_read_engagement',
        'pages_read_user_content',
        'read_insights',
      ],
      sourceTimezone: 'UTC',
      reportingTimezone: 'Asia/Bangkok',
      d1Targets: ORGANIC_D1_TARGETS,
      datasets: [
        dataset({
          key: 'facebook.account.latest',
          pathTemplate: '{page_id}',
          fields: [
            'id',
            'name',
            'username',
            'category',
            'fan_count',
            'followers_count',
            'link',
          ],
          rawTarget: META_BUSINESS_SHARED_RAW_TABLES.ORGANIC_ACCOUNTS,
          metricSemantics: 'snapshot',
        }),
        dataset({
          key: 'facebook.content.inventory',
          pathTemplate: '{page_id}/posts',
          fields: [
            'id',
            'message',
            'created_time',
            'updated_time',
            'permalink_url',
            'is_published',
            'shares',
            // ดึงเฉพาะ Summary count; limit(0) ป้องกันการนำข้อมูลผู้ใช้/ข้อความ Comment
            // เข้าสู่ Source payload โดยไม่จำเป็น.
            'reactions.limit(0).summary(true)',
            'comments.limit(0).summary(true)',
          ],
          rawTarget: META_BUSINESS_SHARED_RAW_TABLES.ORGANIC_CONTENT,
          metricSemantics: 'snapshot',
          paginated: true,
        }),
        metricDataset({
          key: 'facebook.content.insights',
          pathTemplate: '{content_id}/insights',
          metrics: [
            'post_media_view',
            'post_total_media_view_unique',
          ],
          entityType: 'content',
        }),
        metricDataset({
          key: 'facebook.account.insights',
          pathTemplate: '{page_id}/insights',
          metrics: [
            'page_media_view',
            'page_total_media_view_unique',
            'page_daily_follows_unique',
            'page_daily_unfollows_unique',
          ],
          entityType: 'account',
        }),
      ],
    },
    [META_BUSINESS_CONNECTOR_KEYS.INSTAGRAM_ORGANIC]: {
      platform: 'instagram',
      host: 'https://graph.instagram.com',
      discoveryCredentialEnv: 'META_INSTAGRAM_ACCESS_TOKEN',
      readCredentialEnv: 'META_INSTAGRAM_ACCESS_TOKEN',
      identityEnv: 'META_INSTAGRAM_ACCOUNT_ID',
      requiredPermissions: [
        'instagram_business_basic',
        'instagram_business_manage_insights',
      ],
      sourceTimezone: 'UTC',
      reportingTimezone: 'Asia/Bangkok',
      d1Targets: ORGANIC_D1_TARGETS,
      datasets: [
        dataset({
          key: 'instagram.account.latest',
          pathTemplate: 'me',
          fields: [
            'user_id',
            'id',
            'username',
            'name',
            'account_type',
            'profile_picture_url',
            'followers_count',
            'follows_count',
            'media_count',
          ],
          rawTarget: META_BUSINESS_SHARED_RAW_TABLES.ORGANIC_ACCOUNTS,
          metricSemantics: 'snapshot',
        }),
        dataset({
          key: 'instagram.content.inventory',
          pathTemplate: 'me/media',
          fields: [
            'id',
            'caption',
            'media_type',
            'media_product_type',
            'permalink',
            'media_url',
            'thumbnail_url',
            'timestamp',
          ],
          rawTarget: META_BUSINESS_SHARED_RAW_TABLES.ORGANIC_CONTENT,
          metricSemantics: 'snapshot',
          paginated: true,
        }),
        metricDataset({
          key: 'instagram.content.insights',
          pathTemplate: '{media_id}/insights',
          metrics: [
            'reach',
            'likes',
            'comments',
            'saved',
            'shares',
            'total_interactions',
            'views',
          ],
          entityType: 'content',
        }),
        metricDataset({
          key: 'instagram.account.insights',
          pathTemplate: 'me/insights',
          metrics: [
            'views',
            'reach',
            'accounts_engaged',
            'total_interactions',
            'follows_and_unfollows',
          ],
          entityType: 'account',
          supportsTimePagination: true,
          queryContract: {
            period: 'day',
            metricType: 'total_value',
          },
        }),
      ],
    },
    [META_BUSINESS_CONNECTOR_KEYS.META_ADS]: {
      platform: 'meta_ads',
      host: 'https://graph.facebook.com',
      discoveryCredentialEnv: 'META_ACCESS_TOKEN',
      readCredentialEnv: 'META_ACCESS_TOKEN',
      identityEnv: 'META_AD_ACCOUNT_ID',
      requiredPermissions: ['ads_read', 'business_management'],
      sourceTimezone: 'ad_account_timezone',
      reportingTimezone: 'ad_account_timezone',
      d1Targets: ADS_D1_TARGETS,
      datasets: [
        adsEntityDataset({
          key: 'meta_ads.account.latest',
          pathTemplate: 'act_{ad_account_id}',
          entityType: 'account',
          fields: [
            'id',
            'name',
            'account_status',
            'currency',
            'timezone_name',
            'timezone_offset_hours_utc',
          ],
        }),
        adsEntityDataset({
          key: 'meta_ads.campaigns.inventory',
          pathTemplate: 'act_{ad_account_id}/campaigns',
          entityType: 'campaign',
          fields: [
            'id',
            'name',
            'objective',
            'status',
            'effective_status',
            'start_time',
            'stop_time',
            'updated_time',
          ],
          paginated: true,
        }),
        adsEntityDataset({
          key: 'meta_ads.ad_sets.inventory',
          pathTemplate: 'act_{ad_account_id}/adsets',
          entityType: 'ad_group',
          fields: [
            'id',
            'campaign_id',
            'name',
            'status',
            'effective_status',
            'start_time',
            'end_time',
            'updated_time',
          ],
          paginated: true,
        }),
        adsEntityDataset({
          key: 'meta_ads.ads.inventory',
          pathTemplate: 'act_{ad_account_id}/ads',
          entityType: 'ad',
          fields: [
            'id',
            'campaign_id',
            'adset_id',
            'name',
            'status',
            'effective_status',
            'creative{id}',
            'updated_time',
          ],
          paginated: true,
        }),
        adsEntityDataset({
          key: 'meta_ads.creatives.inventory',
          pathTemplate: 'act_{ad_account_id}/adcreatives',
          entityType: 'creative',
          fields: [
            'id',
            'name',
            'object_story_id',
            'object_type',
            'thumbnail_url',
            'url_tags',
          ],
          paginated: true,
        }),
        adsEntityDataset({
          key: 'meta_ads.creatives.activity_scoped',
          pathTemplate: '{ad_id}',
          entityType: 'creative',
          fields: [
            'id',
            'account_id',
            'creative{id,name,object_story_id,object_type,thumbnail_url,url_tags}',
          ],
        }),
        dataset({
          key: 'meta_ads.performance.daily',
          pathTemplate: 'act_{ad_account_id}/insights',
          fields: [
            'account_id',
            'account_currency',
            'campaign_id',
            'campaign_name',
            'objective',
            'adset_id',
            'adset_name',
            'ad_id',
            'ad_name',
            'date_start',
            'date_stop',
            'spend',
            'impressions',
            'reach',
            'clicks',
            'actions',
            'action_values',
          ],
          rawTarget: META_BUSINESS_SHARED_RAW_TABLES.ADS_DAILY,
          metricSemantics: 'period',
          paginated: true,
          queryContract: {
            level: 'ad',
            timeIncrement: 1,
            breakdowns: ['publisher_platform'],
            actionBreakdowns: ['action_type'],
          },
        }),
      ],
    },
  },
});

/** คืน Connector contract แบบ Fail-closed เพื่อไม่ให้ Adapter กระจาย Dataset literal */
export function getMetaBusinessConnectorContract(connectorKey) {
  const key = requireContractKey(connectorKey, 'connectorKey');
  const connector = META_BUSINESS_INGESTION_CONTRACT.connectors[key];
  if (!connector) throw new TypeError(`Unknown Meta business connector: ${key}`);
  return connector;
}

/** คืน Dataset contract ที่เป็นสมาชิกของ Connector ที่ระบุเท่านั้น */
export function getMetaBusinessDatasetContract(connectorKey, datasetKey) {
  const connector = getMetaBusinessConnectorContract(connectorKey);
  const key = requireContractKey(datasetKey, 'datasetKey');
  const dataset = connector.datasets.find((candidate) => candidate.key === key);
  if (!dataset) throw new TypeError(`Unknown Meta business dataset: ${key}`);
  return dataset;
}

function metricDataset(input) {
  return dataset({
    ...input,
    fields: ['name', 'period', 'values', 'total_value'],
    rawTarget: META_BUSINESS_SHARED_RAW_TABLES.ORGANIC_METRICS,
    metricSemantics: 'provider_declared',
    paginated: input.supportsTimePagination === true,
    metricCapabilityProbeRequired: true,
  });
}

function adsEntityDataset(input) {
  return dataset({
    ...input,
    rawTarget: META_BUSINESS_SHARED_RAW_TABLES.ADS_ENTITIES,
    metricSemantics: 'snapshot',
  });
}

function dataset(input) {
  return {
    key: input.key,
    method: 'GET',
    pathTemplate: input.pathTemplate,
    fields: input.fields,
    metrics: input.metrics ?? [],
    entityType: input.entityType ?? null,
    metricSemantics: input.metricSemantics,
    rawTarget: input.rawTarget,
    paginated: input.paginated === true,
    supportsTimePagination: input.supportsTimePagination === true,
    metricCapabilityProbeRequired: input.metricCapabilityProbeRequired === true,
    activation: 'live_fixture_required',
    queryContract: input.queryContract ?? null,
  };
}

function requireContractKey(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Meta business contract requires ${fieldName}`);
  }
  return value.trim();
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}
