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
  mktAdsCampaigns: 'LARK_TABLE_MKT_ADS_CAMPAIGNS',
  mktAdsAssetGroups: 'LARK_TABLE_MKT_ADS_ASSET_GROUPS',
  mktAdsAdGroups: 'LARK_TABLE_MKT_ADS_ADGROUPS',
  mktAdsAds: 'LARK_TABLE_MKT_ADS_ADS',
  mktAdsCreatives: 'LARK_TABLE_MKT_ADS_CREATIVES',
  mktAdsDaily: 'LARK_TABLE_MKT_ADS_DAILY',
  mktMetricDefinitions: 'LARK_TABLE_MKT_METRIC_DEFINITIONS',
  mktReportSnapshots: 'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  mktReportMetricValues: 'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
  mktReportTopContent: 'LARK_TABLE_MKT_REPORT_TOP_CONTENT',
  mktReportTopAds: 'LARK_TABLE_MKT_REPORT_TOP_ADS',
  mktAiReportRuns: 'LARK_TABLE_MKT_AI_REPORT_RUNS',
  mktReportSettings: 'LARK_TABLE_MKT_REPORT_SETTINGS',
  mktSyncLog: 'LARK_TABLE_MKT_SYNC_LOG',
  mktSystemAlerts: 'LARK_TABLE_MKT_SYSTEM_ALERTS',
  mktClassificationDictionary: 'LARK_TABLE_MKT_CLASSIFICATION_DICTIONARY',
  rawTikTokCreatorVideos: 'LARK_TABLE_RAW_TIKTOK_CREATOR_VIDEOS',
  rawYouTubeChannels: 'LARK_TABLE_RAW_YOUTUBE_CHANNELS',
  rawYouTubeVideos: 'LARK_TABLE_RAW_YOUTUBE_VIDEOS',
  rawYouTubeAnalyticsDaily: 'LARK_TABLE_RAW_YOUTUBE_ANALYTICS_DAILY',
  // ตาราง Planned เดิม 5 ตารางใน DEV Base จะถูก Rename/Reuse แบบ In-place เพื่อไม่เพิ่ม Table โดยไม่จำเป็น
  rawMetaOrganicAccounts: 'LARK_TABLE_RAW_META_ORGANIC_ACCOUNTS',
  rawMetaOrganicContent: 'LARK_TABLE_RAW_META_ORGANIC_CONTENT',
  rawMetaOrganicMetrics: 'LARK_TABLE_RAW_META_ORGANIC_METRICS',
  rawAdsEntities: 'LARK_TABLE_RAW_ADS_ENTITIES',
  rawAdsDaily: 'LARK_TABLE_RAW_ADS_DAILY',
  rawCommerceStores: 'LARK_TABLE_RAW_COMMERCE_STORES',
  rawCommerceOrders: 'LARK_TABLE_RAW_COMMERCE_ORDERS',
  rawCommerceOrderItems: 'LARK_TABLE_RAW_COMMERCE_ORDER_ITEMS',
  rawCommerceProducts: 'LARK_TABLE_RAW_COMMERCE_PRODUCTS',
  rawCommerceProductVariations: 'LARK_TABLE_RAW_COMMERCE_PRODUCT_VARIATIONS',
  rawCommerceCategories: 'LARK_TABLE_RAW_COMMERCE_CATEGORIES',
  rawCommerceCustomers: 'LARK_TABLE_RAW_COMMERCE_CUSTOMERS',
  rawCommerceCoupons: 'LARK_TABLE_RAW_COMMERCE_COUPONS',
  rawCommerceRefunds: 'LARK_TABLE_RAW_COMMERCE_REFUNDS',
  mktCommerceOrders: 'LARK_TABLE_MKT_COMMERCE_ORDERS',
  mktCommerceProducts: 'LARK_TABLE_MKT_COMMERCE_PRODUCTS',
  mktCommerceCustomers: 'LARK_TABLE_MKT_COMMERCE_CUSTOMERS',
  mktCommerceDaily: 'LARK_TABLE_MKT_COMMERCE_DAILY',
  mktCommerceProductDaily: 'LARK_TABLE_MKT_COMMERCE_PRODUCT_DAILY',
  rawChatwootAccounts: 'LARK_TABLE_RAW_CHATWOOT_ACCOUNTS',
  rawChatwootInboxes: 'LARK_TABLE_RAW_CHATWOOT_INBOXES',
  rawChatwootContacts: 'LARK_TABLE_RAW_CHATWOOT_CONTACTS',
  rawChatwootAgents: 'LARK_TABLE_RAW_CHATWOOT_AGENTS',
  rawChatwootTeams: 'LARK_TABLE_RAW_CHATWOOT_TEAMS',
  rawChatwootLabels: 'LARK_TABLE_RAW_CHATWOOT_LABELS',
  rawChatwootConversations: 'LARK_TABLE_RAW_CHATWOOT_CONVERSATIONS',
  rawChatwootConversationLabels: 'LARK_TABLE_RAW_CHATWOOT_CONVERSATION_LABELS',
  rawChatwootMessageAnalytics: 'LARK_TABLE_RAW_CHATWOOT_MESSAGE_ANALYTICS',
  rawChatwootReportingEvents: 'LARK_TABLE_RAW_CHATWOOT_REPORTING_EVENTS',
  mktConversations: 'LARK_TABLE_MKT_CONVERSATIONS',
  mktConversationDaily: 'LARK_TABLE_MKT_CONVERSATION_DAILY',
  mktAgentDaily: 'LARK_TABLE_MKT_AGENT_DAILY',
  mktInboxDaily: 'LARK_TABLE_MKT_INBOX_DAILY',
  mktConversationAccountDaily: 'LARK_TABLE_MKT_CONVERSATION_ACCOUNT_DAILY',
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
