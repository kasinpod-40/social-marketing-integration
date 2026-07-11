import { requireDateOnly } from '../../../shared/src/date/date-only.js';

// เครื่องหมายคั่น Stable Key เป็นส่วนหนึ่งของ Public data contract
// ห้ามเปลี่ยนหลังเริ่มใช้งานจริง เพราะ Record เดิมจะไม่ Match กับ Key ใหม่
const IDENTITY_KEY_SEPARATOR = ':';

/**
 * สร้าง Canonical key ของคอนเทนต์รูปแบบ platform:accountId:externalContentId
 * ทุกส่วนต้องไม่ว่างและห้ามมีเครื่องหมาย : เพื่อไม่ให้ Key มีความหมายกำกวม
 */
export function createContentKey({ platform, accountId, externalContentId }) {
  return joinRequiredIdentityParts('Content key', [platform, accountId, externalContentId]);
}

/**
 * สร้าง Canonical key ของ Daily Snapshot รูปแบบ platform:accountId:entityId:YYYY-MM-DD
 * วันที่ผ่าน Validator กลางเพื่อปฏิเสธวันที่ที่รูปแบบถูกแต่ไม่มีจริง เช่น 2026-02-30
 */
export function createDailySnapshotKey({ platform, accountId, entityId, metricDate }) {
  const normalizedMetricDate = requireDateOnly(metricDate, { label: 'Snapshot metricDate' });
  return joinRequiredIdentityParts('Snapshot key', [platform, accountId, entityId, normalizedMetricDate]);
}

/** Normalize ทุกส่วนแล้วเชื่อมด้วย Separator มาตรฐานเพียงจุดเดียว */
function joinRequiredIdentityParts(label, parts) {
  return parts
    .map((part) => normalizeIdentityPart(label, part))
    .join(IDENTITY_KEY_SEPARATOR);
}

/**
 * ตรวจหนึ่งส่วนของ Stable Key
 * ไม่ Encode ค่าอัตโนมัติเพราะจะทำให้ Key เดิมเปลี่ยนเงียบ ๆ; ให้ผู้ตั้งค่าตัดสินใจ Account key ที่ปลอดภัยตั้งแต่ต้น
 */
function normalizeIdentityPart(label, part) {
  if (typeof part !== 'string' || part.trim() === '') {
    throw new Error(`${label} requires all identity fields`);
  }

  const normalized = part.trim();
  if (normalized.includes(IDENTITY_KEY_SEPARATOR)) {
    throw new Error(`${label} identity fields must not contain "${IDENTITY_KEY_SEPARATOR}"`);
  }
  return normalized;
}
