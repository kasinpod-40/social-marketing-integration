/**
 * ข้อผิดพลาดมาตรฐานของระบบที่ระบุได้ชัดว่าควร Retry หรือไม่
 */
const OPERATIONAL_REDACTION = '[REDACTED]';
const OPERATIONAL_SENSITIVE_KEY_PATTERN = /(?:secret|token|password|authorization|api[_-]?key|consumer[_-]?secret|lock[_-]?key|cursor[_-]?key|(?:channel|video|content)[_-]?ids?|(?:source|expected|actual|detected)[_-]?(?:channel|video|content)?[_-]?(?:ids?|handles?)|uploads[_-]?playlist[_-]?id|mismatched[_-]?videos?|stable[_-]?keys?)/iu;
const IDENTITY_ERROR_CODE_PATTERN = /(?:IDENTITY|SOURCE_HANDLE)_MISMATCH/u;
const IDENTITY_MESSAGE_PATTERN = /(?:identity|source handle)\s+mismatch/iu;

export class RuntimeError extends Error {
  constructor(message, options = {}) {
    super(requireMessage(message), { cause: options.cause });
    this.name = 'RuntimeError';
    this.code = normalizeCode(options.code ?? 'RUNTIME_ERROR');
    this.retryable = options.retryable === true;
    this.details = freezeDetails(options.details);
  }
}

/**
 * Error จาก Batch write ที่รู้จำนวนแถวซึ่งยืนยันว่าเขียนสำเร็จแล้ว หรือผลลัพธ์กำกวม
 * ใช้เป็นข้อมูลกลางระหว่าง Storage adapter, Sync engine และ Reliability layer
 */
export class WriteProgressError extends RuntimeError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'WRITE_PROGRESS_INCOMPLETE',
      retryable: options.retryable === true,
    });
    this.name = 'WriteProgressError';
    this.writeProgress = freezeWriteProgress(options.writeProgress);
  }
}

/**
 * ข้อผิดพลาดเมื่อมีการเขียนบางส่วนหรือผลการเขียนกำกวมจนต้อง Reconcile
 */
export class PartialSyncError extends RuntimeError {
  constructor(message, options = {}) {
    super(message, {
      ...options,
      code: options.code ?? 'SYNC_PARTIAL_WRITE',
      retryable: options.retryable !== false,
    });
    this.name = 'PartialSyncError';
    this.partialResult = freezeOptionalObject(options.partialResult);
  }
}

export function permanentError(message, options = {}) {
  return new RuntimeError(message, { ...options, retryable: false });
}

export function transientError(message, options = {}) {
  return new RuntimeError(message, { ...options, retryable: true });
}

export function writeProgressError(message, options = {}) {
  return new WriteProgressError(message, options);
}

export function partialSyncError(message, options = {}) {
  return new PartialSyncError(message, options);
}

export function isRetryableError(error) {
  return error?.retryable === true;
}

export function isWriteProgressError(error) {
  return error instanceof WriteProgressError || error?.writeProgress?.writeOutcome;
}

export function isPartialSyncError(error) {
  return error instanceof PartialSyncError || error?.code === 'SYNC_PARTIAL_WRITE';
}

export function markReliabilityHandled(error, syncRunId) {
  if (error && typeof error === 'object') {
    Object.defineProperty(error, 'reliabilityHandled', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: true,
    });
    Object.defineProperty(error, 'syncRunId', {
      configurable: true,
      enumerable: false,
      writable: true,
      value: syncRunId ?? null,
    });
  }
  return error;
}

/**
 * คืนข้อความที่ปลอดภัยสำหรับ Log/Sync Log/System Alert โดยคง Error code เป็นตัววินิจฉัยหลัก
 * และตัด External identity/Lock scope ที่อาจชี้กลับไปยังลูกค้าหรือบัญชีจริง
 */
export function sanitizeOperationalText(value, options = {}) {
  const text = value instanceof Error ? value.message : String(value ?? '');
  const code = typeof options.code === 'string' ? options.code.trim().toUpperCase() : '';
  if (IDENTITY_ERROR_CODE_PATTERN.test(code) || IDENTITY_MESSAGE_PATTERN.test(text)) {
    return 'Source identity validation failed';
  }
  if (code.startsWith('SYNC_LOCK_')) return 'Sync lock operation failed';

  return text
    .replace(/(\b(?:expected|actual|detected)\s*(?:=|:)\s*)[^\s,|]+/giu, `$1${OPERATIONAL_REDACTION}`)
    .replace(/(\b(?:expected|detected)\s+)@[A-Za-z0-9._-]+/giu, `$1${OPERATIONAL_REDACTION}`)
    .replace(/(\b(?:channel|video|content)[_-]?ids?\s*(?:=|:)\s*)[^\s,|]+/giu, `$1${OPERATIONAL_REDACTION}`);
}

/** ทำสำเนา JSON-safe พร้อม Redact key/value ที่ห้ามออก Operational logs */
export function sanitizeOperationalValue(value) {
  return sanitizeValue(value, new WeakSet());
}

/** สรุป Error สำหรับ Boundary ที่ Persist/Log โดยไม่แก้ Error เดิมซึ่งยังใช้ Retry classification */
export function sanitizeOperationalError(error) {
  const code = typeof error?.code === 'string' && error.code.trim()
    ? error.code.trim().toUpperCase()
    : null;
  return Object.freeze({
    code,
    message: sanitizeOperationalText(error instanceof Error ? error.message : String(error), { code }),
    details: sanitizeOperationalValue(error?.details ?? {}),
  });
}

function sanitizeValue(value, seen) {
  if (typeof value === 'string') return sanitizeOperationalText(value);
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'function' || typeof value === 'symbol' || value === undefined) return null;
  if (value === null || typeof value !== 'object') return value;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString();
  if (seen.has(value)) return '[CIRCULAR]';
  seen.add(value);

  if (value instanceof Error) {
    const sanitized = sanitizeOperationalError(value);
    return {
      name: value.name,
      code: sanitized.code,
      message: sanitized.message,
      details: sanitized.details,
    };
  }
  if (Array.isArray(value)) return value.map((nested) => sanitizeValue(nested, seen));

  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    key,
    OPERATIONAL_SENSITIVE_KEY_PATTERN.test(key)
      && typeof nested !== 'number'
      && typeof nested !== 'boolean'
      && nested !== null
      ? OPERATIONAL_REDACTION
      : sanitizeValue(nested, seen),
  ]));
}

function requireMessage(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError('RuntimeError requires a non-empty message');
  }
  return value.trim();
}

function normalizeCode(value) {
  const code = typeof value === 'string' ? value.trim().toUpperCase() : '';
  return code || 'RUNTIME_ERROR';
}

function freezeDetails(value) {
  if (value === null || value === undefined) return Object.freeze({});
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('RuntimeError details must be an object');
  }
  return Object.freeze({ ...value });
}

function freezeOptionalObject(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('PartialSyncError partialResult must be an object');
  }
  return Object.freeze({ ...value });
}

function freezeWriteProgress(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('WriteProgressError requires writeProgress');
  }

  const writeOutcome = value.writeOutcome;
  if (!new Set(['partial', 'unknown']).has(writeOutcome)) {
    throw new TypeError('writeProgress.writeOutcome must be partial or unknown');
  }

  return Object.freeze({
    operation: requireText(value.operation, 'writeProgress.operation'),
    tableId: requireText(value.tableId, 'writeProgress.tableId'),
    writeOutcome,
    confirmedRows: nonNegativeInteger(value.confirmedRows ?? 0, 'writeProgress.confirmedRows'),
    completedChunks: nonNegativeInteger(value.completedChunks ?? 0, 'writeProgress.completedChunks'),
    failedChunk: positiveInteger(value.failedChunk, 'writeProgress.failedChunk'),
    totalChunks: positiveInteger(value.totalChunks, 'writeProgress.totalChunks'),
    totalRows: nonNegativeInteger(value.totalRows ?? 0, 'writeProgress.totalRows'),
    remainingRows: nonNegativeInteger(value.remainingRows ?? 0, 'writeProgress.remainingRows'),
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a non-negative integer`);
  return number;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}
