import { normalizeTikTokCreatorVideo } from './normalize-tiktok-creator-video.js';
import { normalizeOrganicContentBatch } from './normalize-organic-content-batch.js';
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
  const normalized = normalizeOrganicContentBatch({
    rawRows,
    normalizeRow: (rawRow) => normalizeTikTokCreatorVideo({
      accountId,
      metricDate,
      rawRow,
      dictionaryRules,
    }),
    readSourceIdentity: (result) => result.sourceHandle,
  });

  return Object.freeze({
    contentRows: normalized.contentRows,
    dailySnapshotRows: normalized.dailySnapshotRows,
    skippedRows: normalized.skippedRows,
    sourceHandles: normalized.sourceIdentities,
    duplicateContentRows: normalized.duplicateContentRows,
    duplicateDailyRows: normalized.duplicateDailyRows,
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
