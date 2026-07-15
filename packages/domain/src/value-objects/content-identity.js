import { requireDateOnly } from '../../../shared/src/date/date-only.js';

// เครื่องหมายคั่น Stable Key เป็นส่วนหนึ่งของ Public data contract
// ห้ามเปลี่ยนหลังเริ่มเขียนข้อมูลจริง เพราะ Record เดิมจะไม่ Match กับ Key ใหม่
const IDENTITY_KEY_SEPARATOR = ':';

/** สร้าง Canonical key ของคอนเทนต์รูปแบบ platform:accountId:externalContentId */
export function createContentKey({ platform, accountId, externalContentId }) {
  return joinRequiredIdentityParts('Content key', [platform, accountId, externalContentId]);
}

/** สร้าง Canonical key ของ Daily Snapshot รูปแบบ platform:accountId:entityId:YYYY-MM-DD */
export function createDailySnapshotKey({ platform, accountId, entityId, metricDate }) {
  const normalizedMetricDate = requireDateOnly(metricDate, { label: 'Snapshot metricDate' });
  return joinRequiredIdentityParts('Snapshot key', [platform, accountId, entityId, normalizedMetricDate]);
}

/** เชื่อมส่วน Identity โดยปฏิเสธค่าที่ว่างหรือมี Separator ซึ่งทำให้ Key กำกวม */
function joinRequiredIdentityParts(label, parts) {
  return parts.map((part) => normalizeIdentityPart(label, part)).join(IDENTITY_KEY_SEPARATOR);
}

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
