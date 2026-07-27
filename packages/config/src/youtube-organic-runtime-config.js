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

export const YOUTUBE_END_TO_END_FEATURE_FLAG_ENV = Object.freeze({
  endToEndEnabled: 'MKT_YOUTUBE_END_TO_END_ENABLED',
  larkWriteEnabled: 'MKT_YOUTUBE_LARK_WRITE_ENABLED',
});

/** Dedicated YouTube rollout flags เป็น false ทุกตัวเมื่อไม่ระบุ และปฏิเสธค่าที่ไม่ใช่ Boolean */
export function readYouTubeEndToEndRuntimeConfig(env = {}) {
  return Object.freeze(Object.fromEntries(
    Object.entries(YOUTUBE_END_TO_END_FEATURE_FLAG_ENV).map(([key, envName]) => [
      key,
      readBooleanFlag(env?.[envName], envName),
    ]),
  ));
}

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

function readBooleanFlag(value, fieldName) {
  if (value === undefined || value === null || value === '') return false;
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw permanentError(`${fieldName} must be true or false`, {
    code: 'MKT_YOUTUBE_RUNTIME_CONFIG_INVALID',
    details: { fieldName },
  });
}
