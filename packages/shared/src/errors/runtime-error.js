/**
 * ข้อผิดพลาดมาตรฐานของระบบที่ระบุได้ชัดว่าควร Retry หรือไม่
 */
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
