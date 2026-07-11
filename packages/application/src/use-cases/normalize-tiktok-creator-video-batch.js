import { normalizeTikTokCreatorVideo } from './normalize-tiktok-creator-video.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';

/**
 * แปลง RAW TikTok Creator หลายแถวเป็น MKT_Content และ MKT_Content_Daily แบบ O(n)
 *
 * ฟังก์ชันนี้เป็น Pure function ไม่มีการอ่านหรือเขียน Lark
 * - ตัดแถวซ้ำด้วย Stable Key
 * - เก็บ Error ของแต่ละแถวพร้อม rowIndex
 * - คืน Handle ที่ตรวจพบเพื่อใช้ยืนยัน Source identity ก่อนเขียน
 */
export function normalizeTikTokCreatorVideoBatch(input) {
  const rawRows = requireArray(input?.rawRows, 'rawRows');
  const accountId = requireText(input?.accountId, 'accountId');
  const metricDate = requireDateOnly(input?.metricDate, { label: 'metricDate' });
  const dictionaryRules = Array.isArray(input?.dictionaryRules) ? input.dictionaryRules : [];
  const seenContentKeys = new Set();
  const seenDailyKeys = new Set();
  const contentRows = [];
  const dailySnapshotRows = [];
  const skippedRows = [];
  const sourceHandles = new Set();
  let duplicateContentRows = 0;
  let duplicateDailyRows = 0;

  for (let index = 0; index < rawRows.length; index += 1) {
    try {
      const normalized = normalizeTikTokCreatorVideo({
        accountId,
        metricDate,
        rawRow: rawRows[index],
        dictionaryRules,
      });

      if (normalized.sourceHandle) sourceHandles.add(normalized.sourceHandle);

      if (seenContentKeys.has(normalized.content.content_key)) {
        duplicateContentRows += 1;
      } else {
        seenContentKeys.add(normalized.content.content_key);
        contentRows.push(normalized.content);
      }

      if (seenDailyKeys.has(normalized.dailySnapshot.content_daily_key)) {
        duplicateDailyRows += 1;
      } else {
        seenDailyKeys.add(normalized.dailySnapshot.content_daily_key);
        dailySnapshotRows.push(normalized.dailySnapshot);
      }
    } catch (error) {
      skippedRows.push(Object.freeze({
        rowIndex: index,
        reason: error instanceof Error ? error.message : String(error),
      }));
    }
  }

  return Object.freeze({
    contentRows: Object.freeze(contentRows),
    dailySnapshotRows: Object.freeze(dailySnapshotRows),
    skippedRows: Object.freeze(skippedRows),
    sourceHandles: Object.freeze([...sourceHandles].sort()),
    duplicateContentRows,
    duplicateDailyRows,
  });
}

/** บังคับ Input เป็น Array */
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an array`);
  }
  return value;
}

/** บังคับ Account ID เป็นข้อความที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`TikTok Creator batch normalization requires ${fieldName}`);
  }
  return value.trim();
}
