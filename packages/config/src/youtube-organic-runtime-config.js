import { readLarkTableIdsFromEnv } from './lark-table-config.js';
import { permanentError } from '../../shared/src/errors/runtime-error.js';
import { isPlaceholderConfigValue, requireConfiguredText } from '../../shared/src/config/placeholder-value.js';

/**
 * ตารางที่ YouTube Activation ต้องมีครบก่อนเริ่ม Source request แรก
 * การประกาศชุดเดียวป้องกัน Runtime route ในอนาคตลืม MKT_Accounts หรือ RAW destination
 */
export const YOUTUBE_REQUIRED_LARK_TABLE_KEYS = Object.freeze([
  'mktAccounts',
  'rawYouTubeChannels',
  'rawYouTubeVideos',
  'rawYouTubeAnalyticsDaily',
  'mktContent',
  'mktContentDaily',
]);

/**
 * อ่านและตรวจ YouTube Table configuration แบบ fail-closed
 * ปฏิเสธ Placeholder ก่อนสร้าง API client เพื่อไม่เสีย Quota เมื่อ Schema ยังไม่พร้อม
 */
export function readYouTubeLarkTableIdsFromEnv(env) {
  const tableIds = readLarkTableIdsFromEnv(env, YOUTUBE_REQUIRED_LARK_TABLE_KEYS);
  for (const [tableKey, tableId] of Object.entries(tableIds)) {
    if (isPlaceholderConfigValue(tableId)) {
      throw permanentError(`YouTube activation cannot use placeholder table ID for ${tableKey}`, {
        code: 'YOUTUBE_TABLE_CONFIG_NOT_APPLIED',
        details: { tableKey },
      });
    }
  }
  return tableIds;
}

/** อ่าน Channel allowlist ID แบบ fail-closed ก่อน Source request แรก */
export function readYouTubeChannelIdFromEnv(env) {
  try {
    return requireConfiguredText(env?.YOUTUBE_CHANNEL_ID, 'YOUTUBE_CHANNEL_ID');
  } catch (cause) {
    throw permanentError('YouTube DEV access requires a real allowlisted YOUTUBE_CHANNEL_ID', {
      code: 'YOUTUBE_CHANNEL_CONFIG_INVALID',
      cause,
      details: { fieldName: 'YOUTUBE_CHANNEL_ID' },
    });
  }
}
