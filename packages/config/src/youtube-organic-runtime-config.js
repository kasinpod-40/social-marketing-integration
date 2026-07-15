import { readLarkTableIdsFromEnv } from './lark-table-config.js';

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
 * Future Worker route ต้องเรียกฟังก์ชันนี้ก่อนสร้าง YouTube API client หรือยิง Network request
 */
export function readYouTubeLarkTableIdsFromEnv(env) {
  return readLarkTableIdsFromEnv(env, YOUTUBE_REQUIRED_LARK_TABLE_KEYS);
}
