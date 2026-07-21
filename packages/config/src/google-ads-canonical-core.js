// Canonical Ads v2 core required by the approved Google Ads Blueprint.
// Google Schema Apply only reads and validates these fields; it never creates, renames or type-mutates them.

export const GOOGLE_ADS_CANONICAL_CORE = deepFreeze({
  MKT_Ads_Accounts: [
    ['ads_account_key', 1],
    ['platform', 3],
    ['account_id', 1],
    ['account_name', 1],
    ['currency', 1],
    ['timezone', 1],
    ['status', 3],
    ['resource_owner', 3],
  ],
  MKT_Ads_Campaigns: [
    ['ads_campaign_key', 1],
    ['platform', 3],
    ['ad_channel', 3],
    ['account_id', 1],
    ['external_campaign_id', 1],
    ['campaign_name', 1],
    ['objective', 1],
    ['status', 3],
  ],
  MKT_Ads_AdGroups: [
    ['ads_ad_group_key', 1],
    ['platform', 3],
    ['account_id', 1],
    ['external_campaign_id', 1],
    ['external_ad_group_id', 1],
    ['ad_group_name', 1],
    ['status', 3],
  ],
  MKT_Ads_Ads: [
    ['ads_ad_key', 1],
    ['platform', 3],
    ['account_id', 1],
    ['external_campaign_id', 1],
    ['external_ad_group_id', 1],
    ['external_ad_id', 1],
    ['external_creative_id', 1],
    ['ad_name', 1],
    ['status', 3],
  ],
  MKT_Ads_Creatives: [
    ['ads_creative_key', 1],
    ['platform', 3],
    ['account_id', 1],
    ['external_creative_id', 1],
    ['creative_name', 1],
    ['creative_type', 3],
    ['status', 3],
  ],
  MKT_Ads_Daily: [
    ['ads_daily_key', 1],
    ['metric_date', 5],
    ['platform', 3],
    ['ad_channel', 3],
    ['account_id', 1],
    ['entity_type', 3],
    ['external_entity_id', 1],
    ['external_campaign_id', 1],
    ['external_ad_group_id', 1],
    ['external_ad_id', 1],
    ['external_creative_id', 1],
    ['currency', 1],
    ['spend_micros', 2],
    ['spend', 2],
    ['impressions', 2],
    ['reach', 2],
    ['clicks', 2],
    ['conversions', 2],
    ['conversion_value_micros', 2],
    ['conversion_value', 2],
    ['ctr', 2],
    ['cpc', 2],
    ['cpm', 2],
    ['actual_roas', 2],
  ],
});

export const GOOGLE_ADS_CANONICAL_CORE_FIELD_COUNT = Object.values(
  GOOGLE_ADS_CANONICAL_CORE,
).reduce((sum, fields) => sum + fields.length, 0);

function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const child of Object.values(value)) deepFreeze(child);
  }
  return value;
}
