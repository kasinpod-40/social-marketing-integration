import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import { toFiniteNumber } from '../../../shared/src/number/strict-number.js';

// สถานะที่ระบบ Sync รองรับอย่างเป็นทางการ
const ALLOWED_SYNC_STATUSES = new Set(['queued', 'running', 'success', 'partial_success', 'failed']);

/**
 * สร้าง Entity สำหรับ MKT_Sync_Log พร้อมตรวจ Contract ทางธุรกิจ
 * จำนวน Record และ Retry ต้องเป็นจำนวนเต็มไม่ติดลบ และ finishedAt ต้องไม่เกิดก่อน startedAt
 */
export function createSyncLogEntry(input = {}) {
  const status = input.status ?? 'queued';
  if (!ALLOWED_SYNC_STATUSES.has(status)) {
    throw new Error(`Invalid sync status: ${status}`);
  }

  const startedAt = optionalEpoch(input.startedAt, 'startedAt');
  const finishedAt = optionalEpoch(input.finishedAt, 'finishedAt');
  if (startedAt !== null && finishedAt !== null && finishedAt < startedAt) {
    throw new RangeError('Sync log finishedAt must not be before startedAt');
  }

  return Object.freeze({
    syncId: normalizeSyncId(input.syncId),
    platform: requireText(input.platform, 'platform').toLowerCase(),
    syncType: requireText(input.syncType, 'syncType'),
    status,
    startedAt,
    finishedAt,
    recordsPulled: nonNegativeInteger(input.recordsPulled ?? 0, 'recordsPulled'),
    recordsWritten: nonNegativeInteger(input.recordsWritten ?? 0, 'recordsWritten'),
    retryCount: nonNegativeInteger(input.retryCount ?? 0, 'retryCount'),
    errorMessage: optionalText(input.errorMessage),
  });
}

/** ใช้ Sync ID ที่ผู้เรียกส่งมา หรือสร้าง UUID ใหม่เมื่อไม่ได้กำหนด */
function normalizeSyncId(value) {
  if (value === null || value === undefined || value === '') return crypto.randomUUID();
  return requireText(value, 'syncId');
}

/** แปลงวันที่ Optional ให้เป็น Epoch Milliseconds Canonical */
function optionalEpoch(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return toEpochMilliseconds(value, { label: `Sync log ${fieldName}` });
}

/** บังคับข้อความที่ไม่ว่างและตัดช่องว่างหัวท้าย */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Sync log requires ${fieldName}`);
  }
  return value.trim();
}

/** อ่านข้อความ Optional และคืน null เมื่อเป็นค่าว่าง */
function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(value, 'errorMessage');
}

/** บังคับ Count ให้เป็นจำนวนเต็มศูนย์ขึ้นไป */
function nonNegativeInteger(value, fieldName) {
  const number = toFiniteNumber(value, { label: `Sync log ${fieldName}` });
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`Sync log ${fieldName} must be a non-negative integer`);
  }
  return number;
}
