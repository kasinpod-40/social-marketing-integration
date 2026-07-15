export const ADS_DATA_MODEL_VERSION = 'canonical-ads-v2';

/** Ads schema กลางก่อนเขียน Meta/TikTok/Google Ads adapters */
export const ADS_CANONICAL_CONTRACT = deepFreeze({
  platforms: ['meta_ads', 'tiktok_ads', 'google_ads'],
  channels: ['facebook_ads', 'instagram_ads', 'tiktok_ads', 'youtube_ads', 'google_search_ads', 'google_display_ads'],
  entityTypes: ['account', 'campaign', 'ad_group', 'ad', 'creative'],
  hierarchy: ['account', 'campaign', 'ad_group', 'ad'],
  assetEntities: ['creative'],
  creativeRelationship: 'Ad references a reusable Creative; Ad and Creative are not interchangeable.',
  stableKeys: {
    entity: '{platform}:{account_id}:{entity_type}:{external_entity_id}',
    daily: '{platform}:{account_id}:{entity_type}:{external_entity_id}:{metric_date}',
  },
  metricSemantics: {
    raw: ['spend_micros', 'impressions', 'reach', 'clicks', 'conversions', 'conversion_value_micros'],
    display: ['spend', 'conversion_value'],
    money: {
      sourceOfTruth: 'integer_micros',
      scale: 1_000_000,
      displayFieldsAreDerived: true,
    },
    derived: {
      ctr: 'clicks/impressions',
      cpc: 'spend_micros/clicks/1000000',
      cpm: 'spend_micros/impressions*1000/1000000',
      actual_roas: 'conversion_value_micros/spend_micros',
    },
    zeroDenominator: 'null',
    targetRoasIsActualRoas: false,
  },
  identityNotes: {
    googleAd: 'ad_id is scoped by ad_group; canonical key also includes account and entity type',
    platformAccount: 'external IDs are never assumed globally unique across platform accounts',
  },
});

export const ADS_LARK_BLUEPRINT = deepFreeze([
  table('mktAdsAccounts', 'MKT_Ads_Accounts', 'ads_account_key', [
    ['ads_account_key', 1], ['platform', 3], ['account_id', 1], ['account_name', 1],
    ['currency', 1], ['timezone', 1], ['status', 3], ['resource_owner', 3],
  ]),
  table('mktAdsCampaigns', 'MKT_Ads_Campaigns', 'ads_campaign_key', [
    ['ads_campaign_key', 1], ['platform', 3], ['ad_channel', 3], ['account_id', 1],
    ['external_campaign_id', 1], ['campaign_name', 1], ['objective', 1], ['status', 3],
  ]),
  table('mktAdsAdGroups', 'MKT_Ads_AdGroups', 'ads_ad_group_key', [
    ['ads_ad_group_key', 1], ['platform', 3], ['account_id', 1], ['external_campaign_id', 1],
    ['external_ad_group_id', 1], ['ad_group_name', 1], ['status', 3],
  ]),
  table('mktAdsAds', 'MKT_Ads_Ads', 'ads_ad_key', [
    ['ads_ad_key', 1], ['platform', 3], ['account_id', 1], ['external_campaign_id', 1],
    ['external_ad_group_id', 1], ['external_ad_id', 1], ['external_creative_id', 1],
    ['ad_name', 1], ['status', 3],
  ]),
  table('mktAdsCreatives', 'MKT_Ads_Creatives', 'ads_creative_key', [
    ['ads_creative_key', 1], ['platform', 3], ['account_id', 1], ['external_creative_id', 1],
    ['creative_name', 1], ['creative_type', 3], ['status', 3],
  ]),
  table('mktAdsDaily', 'MKT_Ads_Daily', 'ads_daily_key', [
    ['ads_daily_key', 1], ['metric_date', 5], ['platform', 3], ['ad_channel', 3],
    ['account_id', 1], ['entity_type', 3], ['external_entity_id', 1],
    ['external_campaign_id', 1], ['external_ad_group_id', 1], ['external_ad_id', 1],
    ['external_creative_id', 1], ['currency', 1], ['spend_micros', 2], ['spend', 2],
    ['impressions', 2], ['reach', 2], ['clicks', 2], ['conversions', 2],
    ['conversion_value_micros', 2], ['conversion_value', 2], ['ctr', 2], ['cpc', 2],
    ['cpm', 2], ['actual_roas', 2],
  ]),
]);

function table(key, tableName, primaryField, fields) {
  return {
    key,
    tableName,
    primaryField,
    fields: fields.map(([fieldName, type], index) => ({ fieldName, type, primary: index === 0 })),
  };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
