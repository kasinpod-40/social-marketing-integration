import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import { toFiniteNumber } from '../../../shared/src/number/strict-number.js';

// ใช้สถานะเดียวกับ Select options ในตาราง MKT_Sync_Log ปัจจุบัน
const ALLOWED_SYNC_STATUSES = new Set([
  'pending',
  'running',
  'success',
  'partial_success',
  'failed',
  'skipped',
]);

/**
 * สร้าง Entity สำหรับหนึ่งรอบการ Sync
 *
 * Entity ภายในเก็บรายละเอียดมากกว่าฟิลด์ที่มีใน Lark ปัจจุบัน เพื่อให้ D1 ใช้เป็น
 * operational source of truth ส่วน Lark adapter จะเลือกเฉพาะฟิลด์ที่ Base รองรับ
 */
export function createSyncLogEntry(input = {}) {
  const status = normalizeStatus(input.status ?? 'pending');
  const startedAt = optionalEpoch(input.startedAt, 'startedAt');
  const finishedAt = optionalEpoch(input.finishedAt, 'finishedAt');

  if (startedAt !== null && finishedAt !== null && finishedAt < startedAt) {
    throw new RangeError('Sync log finishedAt must not be before startedAt');
  }

  const recordsCreated = nonNegativeInteger(input.recordsCreated ?? 0, 'recordsCreated');
  const recordsUpdated = nonNegativeInteger(input.recordsUpdated ?? 0, 'recordsUpdated');
  const recordsSkipped = nonNegativeInteger(input.recordsSkipped ?? 0, 'recordsSkipped');
  const recordsWritten = input.recordsWritten === null || input.recordsWritten === undefined
    ? recordsCreated + recordsUpdated
    : nonNegativeInteger(input.recordsWritten, 'recordsWritten');

  return Object.freeze({
    syncId: normalizeSyncId(input.syncId),
    customerProfile: optionalText(input.customerProfile),
    accountKey: optionalText(input.accountKey),
    platform: requireText(input.platform, 'platform').toLowerCase(),
    source: optionalText(input.source),
    syncType: requireText(input.syncType, 'syncType'),
    status,
    startedAt,
    finishedAt,
    recordsPulled: nonNegativeInteger(input.recordsPulled ?? 0, 'recordsPulled'),
    recordsCreated,
    recordsUpdated,
    recordsSkipped,
    recordsWritten,
    retryCount: nonNegativeInteger(input.retryCount ?? 0, 'retryCount'),
    errorCode: optionalUpperText(input.errorCode),
    errorMessage: optionalText(input.errorMessage),
    details: freezeDetails(input.details),
  });
}

/** รองรับชื่อ queued เดิมชั่วคราวโดยแปลงเป็น pending ก่อน Validate */
function normalizeStatus(value) {
  const status = value === 'queued' ? 'pending' : value;
  if (!ALLOWED_SYNC_STATUSES.has(status)) {
    throw new Error(`Invalid sync status: ${status}`);
  }
  return status;
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
  return requireText(value, 'optionalText');
}

/** Normalize Error code ให้ค้นหาใน D1/Log ได้คงที่ */
function optionalUpperText(value) {
  const text = optionalText(value);
  return text ? text.toUpperCase() : null;
}

/** บังคับ Count ให้เป็นจำนวนเต็มศูนย์ขึ้นไป */
function nonNegativeInteger(value, fieldName) {
  const number = toFiniteNumber(value, { label: `Sync log ${fieldName}` });
  if (!Number.isInteger(number) || number < 0) {
    throw new TypeError(`Sync log ${fieldName} must be a non-negative integer`);
  }
  return number;
}

/** Freeze รายละเอียดเพิ่มเติมหนึ่งชั้นและปฏิเสธ Array เพื่อให้ Shape คงที่ */
function freezeDetails(value) {
  if (value === null || value === undefined) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Sync log details must be an object');
  }
  return Object.freeze({ ...value });
}
