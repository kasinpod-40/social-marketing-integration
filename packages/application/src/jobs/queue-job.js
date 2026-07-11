import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const SUPPORTED_SCHEMA_VERSIONS = Object.freeze([1]);

/**
 * Normalize Cloudflare Queue message เป็น Contract กลาง
 * รองรับ body แบบ Object หรือ JSON string และคง Backward compatibility กับ Job เดิมที่ไม่มี schemaVersion
 */
export function normalizeQueueJobMessage(message, now = new Date()) {
  const body = parseQueueBody(message?.body);
  const schemaVersion = readSchemaVersion(body.schemaVersion);
  const receivedAt = normalizeDate(now, 'receivedAt');
  const requestedAt = body.requestedAt === null || body.requestedAt === undefined
    ? null
    : normalizeDate(body.requestedAt, 'requestedAt');

  const normalizedBody = {
    ...body,
    schemaVersion,
    ...(requestedAt ? { requestedAt } : {}),
  };

  return Object.freeze({
    id: normalizeOptionalText(message?.id),
    schemaVersion,
    body: Object.freeze(normalizedBody),
    receivedAt,
    requestedAt,
  });
}

/** Parse Queue body และปฏิเสธ Shape ที่ไม่ใช่ Object แบบ Permanent */
function parseQueueBody(value) {
  let body = value ?? {};
  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch (cause) {
      throw permanentError('Sync queue message body is not valid JSON', {
        code: 'INVALID_SYNC_JOB',
        cause,
      });
    }
  }

  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw permanentError('Sync queue message body must be an object', {
      code: 'INVALID_SYNC_JOB',
    });
  }
  return body;
}

/** รองรับ Schema version 1 และใช้ version 1 เป็นค่าเริ่มต้นของ Job เก่า */
function readSchemaVersion(value) {
  let version = 1;
  if (value !== null && value !== undefined && value !== '') {
    if (typeof value === 'number') {
      version = value;
    } else if (typeof value === 'string' && /^\d+$/u.test(value.trim())) {
      version = Number(value.trim());
    } else {
      throw invalidSchemaVersion(value);
    }
  }

  if (!Number.isSafeInteger(version) || !SUPPORTED_SCHEMA_VERSIONS.includes(version)) {
    throw invalidSchemaVersion(value);
  }
  return version;
}

/** สร้าง Error ของ Queue schema version โดยไม่ตีความ Boolean/Object เป็นตัวเลข */
function invalidSchemaVersion(value) {
  return permanentError(`Unsupported sync job schemaVersion: ${String(value)}`, {
    code: 'INVALID_SYNC_JOB_SCHEMA_VERSION',
    details: { schemaVersion: value ?? null },
  });
}

/** Normalize วันที่เป็น ISO และปฏิเสธค่าที่ parse ไม่ได้ */
function normalizeDate(value, fieldName) {
  const date = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(date.getTime())) {
    throw permanentError(`Invalid sync job ${fieldName}`, {
      code: 'INVALID_SYNC_JOB',
      details: { fieldName },
    });
  }
  return date.toISOString();
}

/** Normalize ข้อความ Optional โดยคืน null เมื่อไม่มีค่า */
function normalizeOptionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
