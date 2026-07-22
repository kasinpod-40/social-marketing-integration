import { validateReportViewDefinition } from './lark-report-views.js';

export const GOOGLE_ADS_VIEW_FILTER_VERSION = 'google-ads-view-filters-v0.13.5';

const TABLE_NAMES = Object.freeze({
  mktAdsAccounts: 'MKT_Ads_Accounts',
  mktAdsCampaigns: 'MKT_Ads_Campaigns',
  mktAdsDaily: 'MKT_Ads_Daily',
  mktAdsCreatives: 'MKT_Ads_Creatives',
  mktAdsAssetGroups: 'MKT_Ads_AssetGroups',
  rawGoogleAdsAccountLinks: 'RAW_Google_Ads_Account_Links',
  rawGoogleAdsAccounts: 'RAW_Google_Ads_Accounts',
  rawGoogleAdsAdAssets: 'RAW_Google_Ads_Ad_Assets',
  rawGoogleAdsAdGroups: 'RAW_Google_Ads_Ad_Groups',
  rawGoogleAdsAds: 'RAW_Google_Ads_Ads',
  rawGoogleAdsAssetGroupAssets: 'RAW_Google_Ads_Asset_Group_Assets',
  rawGoogleAdsAssetGroups: 'RAW_Google_Ads_Asset_Groups',
  rawGoogleAdsAssets: 'RAW_Google_Ads_Assets',
  rawGoogleAdsCampaignBudgets: 'RAW_Google_Ads_Campaign_Budgets',
  rawGoogleAdsCampaigns: 'RAW_Google_Ads_Campaigns',
  rawGoogleAdsConversionActions: 'RAW_Google_Ads_Conversion_Actions',
  rawGoogleAdsConversionDaily: 'RAW_Google_Ads_Conversion_Daily',
  rawGoogleAdsDaily: 'RAW_Google_Ads_Daily',
});

/**
 * Contract เฉพาะ View filters ที่ Google Ads Schema v0.13.0 ส่งต่อให้ทำใน Lark UI.
 * ชื่อ RAW error Views ใช้ชื่อจริงจาก Live/export เพื่อไม่สร้าง View ซ้ำจากชื่อทั่วไป.
 * Sort/Hidden fields ไม่อยู่ใน Apply นี้; hiddenFields ว่างเพื่อยืนยันว่าไม่มี managed hidden field.
 */
export const GOOGLE_ADS_VIEW_FILTERS = deepFreeze([
  viewTable('mktAdsAccounts', 'LARK_TABLE_MKT_ADS_ACCOUNTS', [
    filteredView('googleAdsAccounts', '🏦 Google Ads Accounts', [condition('platform', 'is', 'google_ads')]),
  ]),
  viewTable('mktAdsCampaigns', 'LARK_TABLE_MKT_ADS_CAMPAIGNS', [
    filteredView('youtubeAdsCampaigns', '📺 YouTube Ads Campaigns', [
      condition('platform', 'is', 'google_ads'),
      condition('ad_channel', 'is', 'youtube_ads'),
    ]),
  ]),
  viewTable('mktAdsDaily', 'LARK_TABLE_MKT_ADS_DAILY', [
    {
      ...filteredView('googleAdsDaily30D', '📈 Google Ads Daily 30D', [condition('platform', 'is', 'google_ads')]),
      // Relative-date condition เป็น UI-owned contract; OpenAPI tool ตรวจ managed subset แต่ไม่ replay response metadata.
      allowAdditionalLiveFilterConditions: true,
    },
  ]),
  viewTable('mktAdsCreatives', 'LARK_TABLE_MKT_ADS_CREATIVES', [
    filteredView('youtubeVideoAssets', '🎬 YouTube Video Assets', [
      condition('platform', 'is', 'google_ads'),
      condition('creative_type', 'is', 'video'),
    ]),
  ]),
  viewTable('mktAdsAssetGroups', 'LARK_TABLE_MKT_ADS_ASSET_GROUPS', [
    filteredView('performanceMaxAssetGroups', '🗂️ Performance Max Asset Groups', [
      condition('platform', 'is', 'google_ads'),
    ]),
  ]),
  rawErrorTable('rawGoogleAdsAccountLinks', 'LARK_TABLE_RAW_GOOGLE_ADS_ACCOUNT_LINKS', 'Account_Links', 'raw_account_link_key'),
  rawErrorTable('rawGoogleAdsAccounts', 'LARK_TABLE_RAW_GOOGLE_ADS_ACCOUNTS', 'Accounts', 'raw_account_key'),
  rawErrorTable('rawGoogleAdsAdAssets', 'LARK_TABLE_RAW_GOOGLE_ADS_AD_ASSETS', 'Ad_Assets', 'raw_ad_asset_link_key'),
  rawErrorTable('rawGoogleAdsAdGroups', 'LARK_TABLE_RAW_GOOGLE_ADS_AD_GROUPS', 'Ad_Groups', 'raw_ad_group_key'),
  rawErrorTable('rawGoogleAdsAds', 'LARK_TABLE_RAW_GOOGLE_ADS_ADS', 'Ads', 'raw_ad_key'),
  rawErrorTable('rawGoogleAdsAssetGroupAssets', 'LARK_TABLE_RAW_GOOGLE_ADS_ASSET_GROUP_ASSETS', 'Asset_Group_Assets', 'raw_asset_group_asset_key'),
  rawErrorTable('rawGoogleAdsAssetGroups', 'LARK_TABLE_RAW_GOOGLE_ADS_ASSET_GROUPS', 'Asset_Groups', 'raw_asset_group_key'),
  rawErrorTable('rawGoogleAdsAssets', 'LARK_TABLE_RAW_GOOGLE_ADS_ASSETS', 'Assets', 'raw_asset_key'),
  rawErrorTable('rawGoogleAdsCampaignBudgets', 'LARK_TABLE_RAW_GOOGLE_ADS_CAMPAIGN_BUDGETS', 'Campaign_Budgets', 'raw_campaign_budget_key'),
  rawErrorTable('rawGoogleAdsCampaigns', 'LARK_TABLE_RAW_GOOGLE_ADS_CAMPAIGNS', 'Campaigns', 'raw_campaign_key'),
  viewTable('rawGoogleAdsConversionActions', 'LARK_TABLE_RAW_GOOGLE_ADS_CONVERSION_ACTIONS', [
    filteredView('conversionActionsUat', '🎯 Conversion Actions UAT', [
      condition('status', 'is', 'ENABLED'),
      condition('status', 'is', 'UNKNOWN'),
    ], 'or'),
    filteredView('googleRawErrorsConversionActions', '🚨 Google Ads RAW Errors - Conversion_Actions', [
      condition('raw_conversion_action_key', 'isEmpty'),
    ]),
  ]),
  rawErrorTable('rawGoogleAdsConversionDaily', 'LARK_TABLE_RAW_GOOGLE_ADS_CONVERSION_DAILY', 'Conversion_Daily', 'raw_conversion_daily_key'),
  rawErrorTable('rawGoogleAdsDaily', 'LARK_TABLE_RAW_GOOGLE_ADS_DAILY', 'Daily', 'raw_ads_daily_key'),
]);

export const GOOGLE_ADS_VIEW_FILTER_MANUAL_ACTIONS = deepFreeze([
  {
    code: 'GOOGLE_ADS_30D_RELATIVE_DATE_FILTER_REQUIRED',
    tableKey: 'mktAdsDaily',
    viewName: '📈 Google Ads Daily 30D',
    fieldName: 'metric_date',
    condition: 'rolling_last_30_days_inclusive',
    message: 'ตั้ง metric_date เป็น rolling Last 30 days ใน Lark UI และตรวจกลับจาก export; OpenAPI contract ปัจจุบันจัดการเฉพาะ platform=google_ads',
  },
]);

export function validateGoogleAdsViewFilters(contract = GOOGLE_ADS_VIEW_FILTERS) {
  validateReportViewDefinition(contract);
  const views = contract.flatMap((table) => table.views);
  if (views.length !== 19) throw new TypeError('Google Ads View filter contract must contain exactly 19 Views');
  if (new Set(views.map((view) => view.name.normalize('NFKC').trim().toLowerCase())).size !== 19) {
    throw new TypeError('Google Ads View filter names must be unique');
  }
  return true;
}

function rawErrorTable(tableKey, envName, suffix, primaryField) {
  return viewTable(tableKey, envName, [
    filteredView(`googleRawErrors${suffix.replaceAll('_', '')}`, `🚨 Google Ads RAW Errors - ${suffix}`, [
      condition(primaryField, 'isEmpty'),
    ]),
  ]);
}

function viewTable(tableKey, envName, views) {
  const tableName = TABLE_NAMES[tableKey];
  if (!tableName) throw new TypeError(`Missing Google Ads View table name for ${tableKey}`);
  return { tableKey, tableName, envName, views };
}

function filteredView(key, name, conditions, conjunction = 'and') {
  return {
    key,
    name,
    type: 'grid',
    hiddenFields: [],
    filterInfo: { conjunction, conditions },
  };
}

function condition(fieldName, operator, value = undefined) {
  return value === undefined ? { fieldName, operator } : { fieldName, operator, value };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}

validateGoogleAdsViewFilters();
