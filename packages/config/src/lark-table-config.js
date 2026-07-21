import { permanentError } from '../../shared/src/errors/runtime-error.js';

/**
 * Mapping ระหว่างชื่อ Table เชิงธุรกิจกับชื่อ Environment variable
 * เก็บเฉพาะชื่อ Mapping ใน Source code ส่วน Table ID จริงต้องอยู่ใน Environment ของเจ้าของ Base
 */
export const LARK_TABLE_ENV = Object.freeze({
  mktAccounts: 'LARK_TABLE_MKT_ACCOUNTS',
  mktAdsAccounts: 'LARK_TABLE_MKT_ADS_ACCOUNTS',
  mktContent: 'LARK_TABLE_MKT_CONTENT',
  mktContentDaily: 'LARK_TABLE_MKT_CONTENT_DAILY',
  mktAccountDaily: 'LARK_TABLE_MKT_ACCOUNT_DAILY',
  rawFacebookPages: 'LARK_TABLE_RAW_FACEBOOK_PAGES',
  rawFacebookPosts: 'LARK_TABLE_RAW_FACEBOOK_POSTS',
  rawFacebookPostInsights: 'LARK_TABLE_RAW_FACEBOOK_POST_INSIGHTS',
  rawFacebookPageInsights: 'LARK_TABLE_RAW_FACEBOOK_PAGE_INSIGHTS',
  rawInstagramAccounts: 'LARK_TABLE_RAW_INSTAGRAM_ACCOUNTS',
  rawInstagramMedia: 'LARK_TABLE_RAW_INSTAGRAM_MEDIA',
  rawInstagramMediaInsights: 'LARK_TABLE_RAW_INSTAGRAM_MEDIA_INSIGHTS',
  rawInstagramAccountInsights: 'LARK_TABLE_RAW_INSTAGRAM_ACCOUNT_INSIGHTS',
  rawMetaAdAccounts: 'LARK_TABLE_RAW_META_AD_ACCOUNTS',
  rawMetaCampaigns: 'LARK_TABLE_RAW_META_CAMPAIGNS',
  rawMetaAdSets: 'LARK_TABLE_RAW_META_AD_SETS',
  rawMetaAds: 'LARK_TABLE_RAW_META_ADS',
  rawMetaCreatives: 'LARK_TABLE_RAW_META_CREATIVES',
  rawMetaAdsInsights: 'LARK_TABLE_RAW_META_ADS_INSIGHTS',
  mktAdsCampaigns: 'LARK_TABLE_MKT_ADS_CAMPAIGNS',
  mktAdsAdGroups: 'LARK_TABLE_MKT_ADS_ADGROUPS',
  mktAdsAds: 'LARK_TABLE_MKT_ADS_ADS',
  mktAdsCreatives: 'LARK_TABLE_MKT_ADS_CREATIVES',
  mktAdsDaily: 'LARK_TABLE_MKT_ADS_DAILY',
  mktMetricDefinitions: 'LARK_TABLE_MKT_METRIC_DEFINITIONS',
  mktReportSnapshots: 'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  mktReportMetricValues: 'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
  mktReportTopContent: 'LARK_TABLE_MKT_REPORT_TOP_CONTENT',
  mktAiReportRuns: 'LARK_TABLE_MKT_AI_REPORT_RUNS',
  mktReportSettings: 'LARK_TABLE_MKT_REPORT_SETTINGS',
  mktSyncLog: 'LARK_TABLE_MKT_SYNC_LOG',
  mktSystemAlerts: 'LARK_TABLE_MKT_SYSTEM_ALERTS',
  mktClassificationDictionary: 'LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY',
  rawTikTokCreatorVideos: 'LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS',
  rawYouTubeChannels: 'LARK_TABLE_RAW_YOUTUBE_CHANNELS',
  rawYouTubeVideos: 'LARK_TABLE_RAW_YOUTUBE_VIDEOS',
  rawYouTubeAnalyticsDaily: 'LARK_TABLE_RAW_YOUTUBE_ANALYTICS_DAILY',
  rawTikTokBusinessCampaigns: 'LARK_TABLE_RAW_TIKTOK_BUSINESS_CAMPAIGNS',
  rawTikTokBusinessAdGroups: 'LARK_TABLE_RAW_TIKTOK_BUSINESS_ADGROUPS',
  rawTikTokBusinessAds: 'LARK_TABLE_RAW_TIKTOK_BUSINESS_ADS',
  rawGoogleCampaigns: 'LARK_TABLE_RAW_GOOGLE_CAMPAIGNS',
  rawGoogleCustomerLists: 'LARK_TABLE_RAW_GOOGLE_CUSTOMER_LISTS',
});

// รายชื่อ Logical table key ทั้งหมด ใช้เป็นค่าเริ่มต้นเมื่อผู้เรียกต้องการตรวจ Environment ครบทุกตาราง
export const LARK_TABLE_KEYS = Object.freeze(Object.keys(LARK_TABLE_ENV));

/**
 * อ่าน Table ID จาก Environment ตามรายการ Logical key ที่ Use case ต้องใช้จริง
 * การรับ requiredKeys ช่วยไม่บังคับ Job เล็ก ๆ ให้ตั้งค่าตารางที่ไม่เกี่ยวข้องทั้งหมด
 */
export function readLarkTableIdsFromEnv(env, requiredKeys = LARK_TABLE_KEYS) {
  if (!Array.isArray(requiredKeys)) {
    throw new TypeError('requiredKeys must be an array');
  }

  const result = {};
  const logicalKeys = new Set();
  const ownerByTableId = new Map();

  for (const tableKey of requiredKeys) {
    if (logicalKeys.has(tableKey)) {
      throw permanentError(`Duplicate Lark logical table key: ${tableKey}`, {
        code: 'LARK_TABLE_CONFIG_INVALID',
        details: { tableKey },
      });
    }
    logicalKeys.add(tableKey);

    const tableId = readTableId(env, tableKey);
    const existingOwner = ownerByTableId.get(tableId);
    if (existingOwner) {
      throw permanentError(
        `Lark table ID ${tableId} is assigned to both ${existingOwner} and ${tableKey}`,
        {
          code: 'LARK_TABLE_CONFIG_INVALID',
          details: { tableId, tableKeys: [existingOwner, tableKey] },
        },
      );
    }

    ownerByTableId.set(tableId, tableKey);
    result[tableKey] = tableId;
  }
  return Object.freeze(result);
}

/** อ่าน Table ID หนึ่งค่าและแจ้งชื่อ Environment ที่ขาดอย่างชัดเจน */
export function readTableId(env, tableKey) {
  const envName = LARK_TABLE_ENV[tableKey];
  if (!envName) {
    throw permanentError(`Unknown Lark table key: ${tableKey}`, {
      code: 'LARK_TABLE_CONFIG_INVALID',
      details: { tableKey },
    });
  }

  const value = env?.[envName];
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Missing required env ${envName} for Lark table ${tableKey}`, {
      code: 'LARK_TABLE_CONFIG_INVALID',
      details: { envName, tableKey },
    });
  }
  return value.trim();
}
