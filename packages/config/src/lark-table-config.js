export const LARK_TABLE_ENV = Object.freeze({
  mktAccounts: 'LARK_TABLE_MKT_ACCOUNTS',
  mktAdsAccounts: 'LARK_TABLE_MKT_ADS_ACCOUNTS',
  mktContent: 'LARK_TABLE_MKT_CONTENT',
  mktContentDaily: 'LARK_TABLE_MKT_CONTENT_DAILY',
  mktAdsCampaigns: 'LARK_TABLE_MKT_ADS_CAMPAIGNS',
  mktAdsAdGroups: 'LARK_TABLE_MKT_ADS_ADGROUPS',
  mktAdsCreatives: 'LARK_TABLE_MKT_ADS_CREATIVES',
  mktAdsDaily: 'LARK_TABLE_MKT_ADS_DAILY',
  mktMetricDefinitions: 'LARK_TABLE_MKT_METRIC_DEFINITIONS',
  mktReportSnapshots: 'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  mktAiReportRuns: 'LARK_TABLE_MKT_AI_REPORT_RUNS',
  mktReportSettings: 'LARK_TABLE_MKT_REPORT_SETTINGS',
  mktSyncLog: 'LARK_TABLE_MKT_SYNC_LOG',
  mktSystemAlerts: 'LARK_TABLE_MKT_SYSTEM_ALERTS',
  mktClassificationDictionary: 'LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY',
  rawTikTokCreatorVideos: 'LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS',
  rawTikTokBusinessCampaigns: 'LARK_TABLE_RAW_TIKTOK_BUSINESS_CAMPAIGNS',
  rawTikTokBusinessAdGroups: 'LARK_TABLE_RAW_TIKTOK_BUSINESS_ADGROUPS',
  rawTikTokBusinessAds: 'LARK_TABLE_RAW_TIKTOK_BUSINESS_ADS',
  rawGoogleCampaigns: 'LARK_TABLE_RAW_GOOGLE_CAMPAIGNS',
  rawGoogleCustomerLists: 'LARK_TABLE_RAW_GOOGLE_CUSTOMER_LISTS',
});

export const LARK_TABLE_KEYS = Object.freeze(Object.keys(LARK_TABLE_ENV));

/**
 * Resolves Lark table IDs from environment variables only.
 * Real table IDs must not be hardcoded in source code so the same codebase can
 * be deployed to each client's own Cloudflare Worker and Lark Base.
 *
 * @param {Record<string, unknown>} env
 * @param {string[]} [requiredKeys]
 * @returns {Readonly<Record<string, string>>}
 */
export function readLarkTableIdsFromEnv(env, requiredKeys = LARK_TABLE_KEYS) {
  const result = {};
  for (const tableKey of requiredKeys) {
    result[tableKey] = readTableId(env, tableKey);
  }

  return Object.freeze(result);
}

export function readTableId(env, tableKey) {
  const envName = LARK_TABLE_ENV[tableKey];
  if (!envName) {
    throw new Error(`Unknown Lark table key: ${tableKey}`);
  }

  const value = env?.[envName];
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Missing required env ${envName} for Lark table ${tableKey}`);
  }

  return value.trim();
}
