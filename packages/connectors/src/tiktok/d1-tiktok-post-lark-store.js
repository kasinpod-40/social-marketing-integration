import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const ADMISSION_STATUSES = new Set([
  'pending',
  'queued',
  'processing',
  'completed',
  'failed_retryable',
  'failed_permanent',
]);

/** Durable admission state for one stable TikTok RAW watermark. */
export class D1TikTokPostLarkStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async claimAdmission(input = {}) {
    const row = requireAdmission(input, this.now());
    let result;
    try {
      result = await this.db.prepare(`
        INSERT INTO tiktok_source_admissions (
          admission_key, customer_profile, customer_key, account_key, source_handle,
          source_watermark, metric_date, source_record_count, source_max_modified_at,
          generation, work_key, status, sync_run_id, report_request_id, error_code,
          requested_at, queued_at, started_at, completed_at, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', NULL, NULL, NULL, ?, NULL, NULL, NULL, ?, ?)
        ON CONFLICT(admission_key) DO NOTHING
      `).bind(
        row.admissionKey,
        row.customerProfile,
        row.customerKey,
        row.accountKey,
        row.sourceHandle,
        row.sourceWatermark,
        row.metricDate,
        row.sourceRecordCount,
        row.sourceMaxModifiedAt,
        row.generation,
        row.workKey,
        row.requestedAt,
        row.createdAt,
        row.updatedAt,
      ).run();
    } catch (cause) {
      throw d1Error('Failed to claim TikTok source admission', 'D1_TIKTOK_ADMISSION_WRITE_FAILED', cause);
    }

    const admission = await this.readAdmission(row.admissionKey);
    if (!admission) {
      throw transientError('TikTok source admission was not readable after claim', {
        code: 'D1_TIKTOK_ADMISSION_READ_FAILED',
      });
    }
    assertAdmissionIdentity(admission, row);
    return Object.freeze({
      created: readChanges(result) > 0,
      admission,
    });
  }

  async readAdmission(admissionKey) {
    const key = requireText(admissionKey, 'admissionKey');
    try {
      const row = await this.db.prepare(`
        SELECT * FROM tiktok_source_admissions WHERE admission_key = ?
      `).bind(key).first();
      return row ? freezeAdmission(row) : null;
    } catch (cause) {
      throw d1Error('Failed to read TikTok source admission', 'D1_TIKTOK_ADMISSION_READ_FAILED', cause);
    }
  }

  async readLatestCompletedAdmission(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    try {
      const row = await this.db.prepare(`
        SELECT *
        FROM tiktok_source_admissions
        WHERE customer_key = ? AND account_key = ? AND status = 'completed'
        ORDER BY completed_at DESC, admission_key ASC
        LIMIT 1
      `).bind(customerKey, accountKey).first();
      return row ? freezeAdmission(row) : null;
    } catch (cause) {
      throw d1Error('Failed to read latest TikTok admission', 'D1_TIKTOK_ADMISSION_READ_FAILED', cause);
    }
  }

  markQueued(input = {}) {
    return this.#transition({
      admissionKey: input.admissionKey,
      allowedFrom: ['pending', 'failed_retryable'],
      status: 'queued',
      assignments: {
        queued_at: safeTimestamp(input.queuedAt ?? this.now(), 'queuedAt'),
        error_code: null,
      },
    });
  }

  markProcessing(input = {}) {
    return this.#transition({
      admissionKey: input.admissionKey,
      allowedFrom: ['queued', 'processing'],
      status: 'processing',
      assignments: {
        sync_run_id: requireText(input.syncRunId, 'syncRunId'),
        started_at: safeTimestamp(input.startedAt ?? this.now(), 'startedAt'),
        error_code: null,
      },
    });
  }

  markCompleted(input = {}) {
    return this.#transition({
      admissionKey: input.admissionKey,
      allowedFrom: ['processing', 'completed'],
      status: 'completed',
      assignments: {
        sync_run_id: requireText(input.syncRunId, 'syncRunId'),
        report_request_id: optionalText(input.reportRequestId),
        completed_at: safeTimestamp(input.completedAt ?? this.now(), 'completedAt'),
        error_code: null,
      },
    });
  }

  markFailed(input = {}) {
    const retryable = input.retryable === true;
    return this.#transition({
      admissionKey: input.admissionKey,
      allowedFrom: ['pending', 'queued', 'processing', 'failed_retryable', 'failed_permanent'],
      status: retryable ? 'failed_retryable' : 'failed_permanent',
      assignments: {
        sync_run_id: optionalText(input.syncRunId),
        error_code: requireText(input.errorCode ?? 'TIKTOK_POST_LARK_FAILED', 'errorCode'),
      },
    });
  }

  async #transition(input) {
    const admissionKey = requireText(input.admissionKey, 'admissionKey');
    const status = requireStatus(input.status);
    const allowedFrom = input.allowedFrom.map(requireStatus);
    const assignments = Object.entries(input.assignments ?? {});
    const now = safeTimestamp(this.now(), 'now');
    const setSql = [
      'status = ?',
      ...assignments.map(([field]) => `${field} = ?`),
      'updated_at = ?',
    ].join(',\n            ');
    const bindings = [
      status,
      ...assignments.map(([, value]) => value ?? null),
      now,
      admissionKey,
      ...allowedFrom,
    ];
    let result;
    try {
      result = await this.db.prepare(`
        UPDATE tiktok_source_admissions
        SET ${setSql}
        WHERE admission_key = ?
          AND status IN (${placeholders(allowedFrom.length)})
      `).bind(...bindings).run();
    } catch (cause) {
      throw d1Error('Failed to update TikTok source admission', 'D1_TIKTOK_ADMISSION_WRITE_FAILED', cause);
    }
    const admission = await this.readAdmission(admissionKey);
    if (!admission) {
      throw permanentError('TikTok source admission does not exist', {
        code: 'TIKTOK_SOURCE_ADMISSION_NOT_FOUND',
        details: { admissionKey },
      });
    }
    if (readChanges(result) === 0 && admission.status !== status) {
      throw permanentError('TikTok source admission transition is not allowed', {
        code: 'TIKTOK_SOURCE_ADMISSION_STATE_CONFLICT',
        details: { admissionKey, currentStatus: admission.status, requestedStatus: status },
      });
    }
    return admission;
  }
}

function requireAdmission(value, now) {
  const requestedAt = safeTimestamp(value.requestedAt, 'requestedAt');
  const createdAt = safeTimestamp(value.createdAt ?? now, 'createdAt');
  return Object.freeze({
    admissionKey: requireText(value.admissionKey, 'admissionKey'),
    customerProfile: requireText(value.customerProfile, 'customerProfile'),
    customerKey: requireText(value.customerKey, 'customerKey'),
    accountKey: requireText(value.accountKey, 'accountKey'),
    sourceHandle: normalizeHandle(requireText(value.sourceHandle, 'sourceHandle')),
    sourceWatermark: requireText(value.sourceWatermark, 'sourceWatermark'),
    metricDate: requireDate(value.metricDate, 'metricDate'),
    sourceRecordCount: nonNegativeInteger(value.sourceRecordCount, 'sourceRecordCount'),
    sourceMaxModifiedAt: nullableTimestamp(value.sourceMaxModifiedAt, 'sourceMaxModifiedAt'),
    generation: safeTimestamp(value.generation ?? requestedAt, 'generation'),
    workKey: requireText(value.workKey, 'workKey'),
    requestedAt,
    createdAt,
    updatedAt: safeTimestamp(value.updatedAt ?? createdAt, 'updatedAt'),
  });
}

function assertAdmissionIdentity(existing, incoming) {
  const pairs = [
    ['customerProfile', incoming.customerProfile],
    ['customerKey', incoming.customerKey],
    ['accountKey', incoming.accountKey],
    ['sourceHandle', incoming.sourceHandle],
    ['sourceWatermark', incoming.sourceWatermark],
    ['metricDate', incoming.metricDate],
    ['sourceRecordCount', incoming.sourceRecordCount],
    ['sourceMaxModifiedAt', incoming.sourceMaxModifiedAt],
    ['generation', incoming.generation],
    ['workKey', incoming.workKey],
  ];
  const mismatch = pairs.find(([field, value]) => existing[field] !== value);
  if (mismatch) {
    throw permanentError('TikTok source admission Stable key was reused with different identity', {
      code: 'TIKTOK_SOURCE_ADMISSION_IDENTITY_CONFLICT',
      details: { admissionKey: incoming.admissionKey, fieldName: mismatch[0] },
    });
  }
}

function freezeAdmission(row) {
  return Object.freeze({
    admissionKey: row.admission_key,
    customerProfile: row.customer_profile,
    customerKey: row.customer_key,
    accountKey: row.account_key,
    sourceHandle: row.source_handle,
    sourceWatermark: row.source_watermark,
    metricDate: row.metric_date,
    sourceRecordCount: Number(row.source_record_count),
    sourceMaxModifiedAt: toNullableInteger(row.source_max_modified_at),
    generation: Number(row.generation),
    workKey: row.work_key,
    status: row.status,
    syncRunId: row.sync_run_id ?? null,
    reportRequestId: row.report_request_id ?? null,
    errorCode: row.error_code ?? null,
    requestedAt: Number(row.requested_at),
    queuedAt: toNullableInteger(row.queued_at),
    startedAt: toNullableInteger(row.started_at),
    completedAt: toNullableInteger(row.completed_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  });
}

function requireStatus(value) {
  if (!ADMISSION_STATUSES.has(value)) {
    throw new TypeError(`Unsupported TikTok source admission status: ${value}`);
  }
  return value;
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(value, 'text');
}

function normalizeHandle(value) {
  return value.replace(/^@/u, '').trim().toLowerCase();
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
  return number;
}

function safeTimestamp(value, fieldName) {
  return nonNegativeInteger(value, fieldName);
}

function nullableTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return safeTimestamp(value, fieldName);
}

function toNullableInteger(value) {
  return value === null || value === undefined ? null : Number(value);
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function readChanges(result) {
  const value = result?.meta?.changes ?? result?.changes ?? 0;
  return Number.isInteger(value) && value >= 0 ? value : 0;
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') {
    throw new TypeError('D1TikTokPostLarkStore requires a D1 binding');
  }
  return value;
}

function d1Error(message, code, cause) {
  return transientError(message, {
    code,
    cause,
    details: { causeMessage: cause instanceof Error ? cause.message : String(cause ?? '') },
  });
}
