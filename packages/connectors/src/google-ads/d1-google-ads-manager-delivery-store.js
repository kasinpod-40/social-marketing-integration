import {
  GOOGLE_ADS_MANAGER_DELIVERY_SCHEMA_VERSION,
  GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS,
} from '../../../config/src/google-ads-manager-script-delivery-contract.js';
import {
  permanentError,
  transientError,
} from '../../../shared/src/errors/runtime-error.js';

const DAY_MS = 24 * 60 * 60 * 1_000;
const FAILED_PAYLOAD_RETENTION_MS = 7 * DAY_MS;
const TERMINAL_AUDIT_RETENTION_MS = 30 * DAY_MS;
const CLEANUP_RUN_LIMIT = 100;
const CLEANUP_NONCE_LIMIT = 1_000;

/** D1 authority สำหรับ nonce replay, Run manifest และ bounded raw Chunk staging เท่านั้น */
export class D1GoogleAdsManagerDeliveryStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
  }

  async cleanupExpired(input = {}) {
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      await this.db.batch([
        this.db.prepare(`
          UPDATE google_ads_delivery_chunks
          SET payload_json = NULL,
              redacted_at = COALESCE(redacted_at, ?)
          WHERE payload_json IS NOT NULL
            AND run_id IN (
              SELECT run_id
              FROM google_ads_delivery_runs
              WHERE (status = 'assembling' AND expires_at < ?)
                 OR (status <> 'assembling' AND payload_retention_until < ?)
              ORDER BY updated_at
              LIMIT ?
            )
        `).bind(now, now, now, CLEANUP_RUN_LIMIT),
        this.db.prepare(`
          UPDATE google_ads_delivery_runs
          SET status = 'expired',
              error_code = COALESCE(error_code, 'GOOGLE_ADS_DELIVERY_RUN_EXPIRED'),
              completed_at = COALESCE(completed_at, ?),
              payload_redacted_at = COALESCE(payload_redacted_at, ?),
              updated_at = ?
          WHERE run_id IN (
            SELECT run_id
            FROM google_ads_delivery_runs
            WHERE status = 'assembling' AND expires_at < ?
            ORDER BY updated_at
            LIMIT ?
          )
        `).bind(now, now, now, now, CLEANUP_RUN_LIMIT),
        this.db.prepare(`
          DELETE FROM google_ads_delivery_runs
          WHERE run_id IN (
            SELECT run_id
            FROM google_ads_delivery_runs
            WHERE audit_expires_at < ?
            ORDER BY audit_expires_at
            LIMIT ?
          )
        `).bind(now, CLEANUP_RUN_LIMIT),
        this.db.prepare(`
          DELETE FROM google_ads_delivery_nonces
          WHERE nonce_fingerprint IN (
            SELECT nonce_fingerprint
            FROM google_ads_delivery_nonces
            WHERE expires_at < ?
            ORDER BY expires_at
            LIMIT ?
          )
        `).bind(now, CLEANUP_NONCE_LIMIT),
      ]);
    } catch (cause) {
      throw transportUnavailable(
        'Google Ads delivery cleanup failed',
        'GOOGLE_ADS_DELIVERY_D1_CLEANUP_FAILED',
        cause,
      );
    }
  }

  async reserveNonce(input = {}) {
    const nonceFingerprint = fingerprint(input.nonceFingerprint, 43, 'nonceFingerprint');
    const requestTimestampSeconds = timestamp(
      input.requestTimestampSeconds,
      'requestTimestampSeconds',
    );
    const now = timestamp(input.now ?? this.now(), 'now');
    const expiresAt = now
      + (GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.nonceRetentionSeconds * 1_000);
    let result;
    try {
      result = await this.db.prepare(`
        INSERT INTO google_ads_delivery_nonces (
          nonce_fingerprint, request_timestamp_seconds, received_at, expires_at
        ) VALUES (?, ?, ?, ?)
        ON CONFLICT(nonce_fingerprint) DO NOTHING
      `).bind(
        nonceFingerprint,
        requestTimestampSeconds,
        now,
        expiresAt,
      ).run();
    } catch (cause) {
      throw transportUnavailable(
        'Google Ads delivery nonce reservation failed',
        'GOOGLE_ADS_DELIVERY_D1_NONCE_RESERVE_FAILED',
        cause,
      );
    }
    if (changes(result) !== 1) {
      throw permanentError('Signed delivery nonce was already used', {
        code: 'GOOGLE_ADS_DELIVERY_NONCE_REPLAYED',
      });
    }
    return Object.freeze({ nonceFingerprint, expiresAt });
  }

  async stageChunk(input = {}) {
    const row = normalizeChunk(input, this.now());
    const statements = [
      this.db.prepare(`
        INSERT INTO google_ads_delivery_runs (
          run_id, run_fingerprint, schema_version, mode, run_started_at,
          identity_fingerprint, source_timezone, manifest_json, manifest_digest,
          expected_chunk_count, expected_row_count, received_chunk_count,
          received_row_count, status, error_code, expires_at,
          payload_retention_until, audit_expires_at, completed_at,
          payload_redacted_at, created_at, updated_at
        ) VALUES (
          ?, ?, ?, ?, ?,
          ?, ?, ?, ?,
          ?, ?, 0,
          0, 'assembling', NULL, ?,
          ?, ?, NULL,
          NULL, ?, ?
        )
        ON CONFLICT(run_id) DO NOTHING
      `).bind(
        row.runId,
        row.runFingerprint,
        row.schemaVersion,
        row.mode,
        row.runStartedAt,
        row.identityFingerprint,
        row.sourceTimezone,
        row.manifestJson,
        row.manifestDigest,
        row.expectedChunkCount,
        row.expectedRowCount,
        row.expiresAt,
        row.payloadRetentionUntil,
        row.auditExpiresAt,
        row.now,
        row.now,
      ),
      this.db.prepare(`
        INSERT INTO google_ads_delivery_chunks (
          idempotency_key, run_id, dataset_key, chunk_index, chunk_count,
          total_rows, row_count, body_digest, payload_json, payload_bytes,
          reservation_id, received_at, redacted_at
        )
        SELECT ?, ?, ?, ?, ?,
               ?, ?, ?, ?, ?,
               ?, ?, NULL
        FROM google_ads_delivery_runs
        WHERE run_id = ?
          AND run_fingerprint = ?
          AND schema_version = ?
          AND mode = ?
          AND run_started_at = ?
          AND identity_fingerprint = ?
          AND source_timezone = ?
          AND manifest_digest = ?
          AND expected_chunk_count = ?
          AND expected_row_count = ?
          AND status IN ('assembling', 'preview_validated')
        ON CONFLICT DO NOTHING
      `).bind(
        row.idempotencyKey,
        row.runId,
        row.datasetKey,
        row.chunkIndex,
        row.chunkCount,
        row.totalRows,
        row.rowCount,
        row.bodyDigest,
        row.payloadJson,
        row.payloadBytes,
        row.reservationId,
        row.now,
        row.runId,
        row.runFingerprint,
        row.schemaVersion,
        row.mode,
        row.runStartedAt,
        row.identityFingerprint,
        row.sourceTimezone,
        row.manifestDigest,
        row.expectedChunkCount,
        row.expectedRowCount,
      ),
      this.db.prepare(`
        UPDATE google_ads_delivery_runs
        SET received_chunk_count = received_chunk_count + 1,
            received_row_count = received_row_count + ?,
            updated_at = ?
        WHERE run_id = ?
          AND status = 'assembling'
          AND EXISTS (
            SELECT 1
            FROM google_ads_delivery_chunks
            WHERE run_id = ?
              AND reservation_id = ?
          )
      `).bind(
        row.rowCount,
        row.now,
        row.runId,
        row.runId,
        row.reservationId,
      ),
    ];

    try {
      await this.db.batch(statements);
    } catch (cause) {
      throw transportUnavailable(
        'Google Ads delivery chunk reservation failed',
        'GOOGLE_ADS_DELIVERY_D1_CHUNK_RESERVE_FAILED',
        cause,
      );
    }

    const [run, chunk] = await Promise.all([
      this.getRun(row.runId),
      this.getChunk(row.idempotencyKey),
    ]);
    assertRunContract(run, row);
    if (!chunk) {
      throw permanentError('Signed delivery chunk conflicts with the stored run', {
        code: 'GOOGLE_ADS_DELIVERY_CHUNK_CONFLICT',
      });
    }
    if (
      chunk.runId !== row.runId
      || chunk.datasetKey !== row.datasetKey
      || chunk.chunkIndex !== row.chunkIndex
      || chunk.chunkCount !== row.chunkCount
      || chunk.totalRows !== row.totalRows
      || chunk.rowCount !== row.rowCount
      || chunk.bodyDigest !== row.bodyDigest
    ) {
      throw permanentError('Signed delivery idempotency identity conflicts with stored state', {
        code: 'GOOGLE_ADS_DELIVERY_IDEMPOTENCY_CONFLICT',
      });
    }
    return Object.freeze({
      disposition: chunk.reservationId === row.reservationId ? 'staged' : 'exact_retry',
      run,
      chunk,
    });
  }

  async getRun(runId) {
    let row;
    try {
      row = await this.db.prepare(`
        SELECT *
        FROM google_ads_delivery_runs
        WHERE run_id = ?
      `).bind(uuid(runId, 'runId')).first();
    } catch (cause) {
      throw transportUnavailable(
        'Google Ads delivery run read failed',
        'GOOGLE_ADS_DELIVERY_D1_RUN_READ_FAILED',
        cause,
      );
    }
    return row ? mapRun(row) : null;
  }

  async getChunk(idempotencyKey) {
    let row;
    try {
      row = await this.db.prepare(`
        SELECT *
        FROM google_ads_delivery_chunks
        WHERE idempotency_key = ?
      `).bind(text(idempotencyKey, 'idempotencyKey')).first();
    } catch (cause) {
      throw transportUnavailable(
        'Google Ads delivery chunk read failed',
        'GOOGLE_ADS_DELIVERY_D1_CHUNK_READ_FAILED',
        cause,
      );
    }
    return row ? mapChunk(row) : null;
  }

  async listRunChunks(runId) {
    let result;
    try {
      result = await this.db.prepare(`
        SELECT *
        FROM google_ads_delivery_chunks
        WHERE run_id = ?
        ORDER BY dataset_key, chunk_index
        LIMIT 64
      `).bind(uuid(runId, 'runId')).all();
    } catch (cause) {
      throw transportUnavailable(
        'Google Ads delivery chunks read failed',
        'GOOGLE_ADS_DELIVERY_D1_CHUNK_READ_FAILED',
        cause,
      );
    }
    return Object.freeze((result?.results ?? []).map(mapChunk));
  }

  async completePreview(input = {}) {
    const runId = uuid(input.runId, 'runId');
    const now = timestamp(input.now ?? this.now(), 'now');
    try {
      await this.db.batch([
        this.db.prepare(`
          UPDATE google_ads_delivery_chunks
          SET payload_json = NULL,
              redacted_at = COALESCE(redacted_at, ?)
          WHERE run_id = ?
            AND payload_json IS NOT NULL
            AND EXISTS (
              SELECT 1
              FROM google_ads_delivery_runs
              WHERE run_id = ?
                AND mode = 'PREVIEW'
                AND status IN ('assembling', 'preview_validated')
                AND received_chunk_count = expected_chunk_count
            )
        `).bind(now, runId, runId),
        this.db.prepare(`
          UPDATE google_ads_delivery_runs
          SET status = 'preview_validated',
              error_code = NULL,
              completed_at = COALESCE(completed_at, ?),
              payload_redacted_at = COALESCE(payload_redacted_at, ?),
              updated_at = ?
          WHERE run_id = ?
            AND mode = 'PREVIEW'
            AND status IN ('assembling', 'preview_validated')
            AND received_chunk_count = expected_chunk_count
        `).bind(now, now, now, runId),
      ]);
    } catch (cause) {
      throw transportUnavailable(
        'Google Ads delivery PREVIEW completion failed',
        'GOOGLE_ADS_DELIVERY_D1_PREVIEW_COMPLETE_FAILED',
        cause,
      );
    }
    const run = await this.getRun(runId);
    if (run?.status !== 'preview_validated') {
      throw permanentError('Signed delivery PREVIEW run cannot be completed', {
        code: 'GOOGLE_ADS_DELIVERY_RUN_INCOMPLETE',
      });
    }
    return run;
  }

  async markInvalid(input = {}) {
    const runId = uuid(input.runId, 'runId');
    const now = timestamp(input.now ?? this.now(), 'now');
    const errorCode = text(input.errorCode, 'errorCode');
    try {
      await this.db.prepare(`
        UPDATE google_ads_delivery_runs
        SET status = 'invalid',
            error_code = ?,
            completed_at = COALESCE(completed_at, ?),
            updated_at = ?
        WHERE run_id = ? AND status = 'assembling'
      `).bind(errorCode, now, now, runId).run();
    } catch (cause) {
      throw transportUnavailable(
        'Google Ads delivery invalid-state write failed',
        'GOOGLE_ADS_DELIVERY_D1_INVALID_STATE_FAILED',
        cause,
      );
    }
  }
}

function normalizeChunk(input, defaultNow) {
  const now = timestamp(input.now ?? defaultNow, 'now');
  const runStartedAt = timestamp(input.runStartedAt, 'runStartedAt');
  const manifestJson = text(input.manifestJson, 'manifestJson');
  const payloadJson = text(input.payloadJson, 'payloadJson');
  const expectedChunkCount = integer(input.expectedChunkCount, 'expectedChunkCount', 1, 64);
  const expectedRowCount = integer(input.expectedRowCount, 'expectedRowCount', 1);
  return Object.freeze({
    runId: uuid(input.runId, 'runId'),
    runFingerprint: fingerprint(input.runFingerprint, 43, 'runFingerprint'),
    schemaVersion: exact(
      input.schemaVersion,
      GOOGLE_ADS_MANAGER_DELIVERY_SCHEMA_VERSION,
      'schemaVersion',
    ),
    mode: choice(input.mode, ['PREVIEW', 'LIVE'], 'mode'),
    runStartedAt,
    identityFingerprint: fingerprint(input.identityFingerprint, 64, 'identityFingerprint'),
    sourceTimezone: text(input.sourceTimezone, 'sourceTimezone'),
    manifestJson,
    manifestDigest: fingerprint(input.manifestDigest, 64, 'manifestDigest'),
    expectedChunkCount,
    expectedRowCount,
    expiresAt: runStartedAt + GOOGLE_ADS_MANAGER_TRANSPORT_LIMITS.assemblyWindowMs,
    payloadRetentionUntil: now + FAILED_PAYLOAD_RETENTION_MS,
    auditExpiresAt: now + TERMINAL_AUDIT_RETENTION_MS,
    idempotencyKey: text(input.idempotencyKey, 'idempotencyKey'),
    datasetKey: choice(input.datasetKey, [
      'account',
      'campaigns',
      'adGroups',
      'ads',
      'youtubeAssets',
      'campaignDailyMetrics',
    ], 'datasetKey'),
    chunkIndex: integer(input.chunkIndex, 'chunkIndex', 0, 63),
    chunkCount: integer(input.chunkCount, 'chunkCount', 1, 64),
    totalRows: integer(input.totalRows, 'totalRows', 1),
    rowCount: integer(input.rowCount, 'rowCount', 1, 500),
    bodyDigest: fingerprint(input.bodyDigest, 64, 'bodyDigest'),
    payloadJson,
    payloadBytes: integer(new TextEncoder().encode(payloadJson).byteLength, 'payloadBytes', 1, 524_288),
    reservationId: text(input.reservationId, 'reservationId'),
    now,
  });
}

function assertRunContract(run, expected) {
  if (!run) {
    throw transientError('Signed delivery run was not readable after reservation', {
      code: 'GOOGLE_ADS_DELIVERY_D1_RUN_READ_AFTER_WRITE_FAILED',
    });
  }
  const matches = (
    run.runFingerprint === expected.runFingerprint
    && run.schemaVersion === expected.schemaVersion
    && run.mode === expected.mode
    && run.runStartedAt === expected.runStartedAt
    && run.identityFingerprint === expected.identityFingerprint
    && run.sourceTimezone === expected.sourceTimezone
    && run.manifestDigest === expected.manifestDigest
    && run.expectedChunkCount === expected.expectedChunkCount
    && run.expectedRowCount === expected.expectedRowCount
  );
  if (!matches) {
    throw permanentError('Signed delivery run contract conflicts with stored state', {
      code: 'GOOGLE_ADS_DELIVERY_RUN_CONFLICT',
    });
  }
  if (run.status === 'invalid' || run.status === 'expired') {
    throw permanentError('Signed delivery run is terminal', {
      code: run.errorCode ?? 'GOOGLE_ADS_DELIVERY_RUN_TERMINAL',
    });
  }
}

function mapRun(row) {
  return Object.freeze({
    runId: row.run_id,
    runFingerprint: row.run_fingerprint,
    schemaVersion: row.schema_version,
    mode: row.mode,
    runStartedAt: Number(row.run_started_at),
    identityFingerprint: row.identity_fingerprint,
    sourceTimezone: row.source_timezone,
    manifest: JSON.parse(row.manifest_json),
    manifestDigest: row.manifest_digest,
    expectedChunkCount: Number(row.expected_chunk_count),
    expectedRowCount: Number(row.expected_row_count),
    receivedChunkCount: Number(row.received_chunk_count),
    receivedRowCount: Number(row.received_row_count),
    status: row.status,
    errorCode: row.error_code ?? null,
    expiresAt: Number(row.expires_at),
    payloadRetentionUntil: Number(row.payload_retention_until),
    auditExpiresAt: Number(row.audit_expires_at),
    completedAt: nullableTimestamp(row.completed_at),
    payloadRedactedAt: nullableTimestamp(row.payload_redacted_at),
    createdAt: Number(row.created_at),
    updatedAt: Number(row.updated_at),
  });
}

function mapChunk(row) {
  return Object.freeze({
    idempotencyKey: row.idempotency_key,
    runId: row.run_id,
    datasetKey: row.dataset_key,
    chunkIndex: Number(row.chunk_index),
    chunkCount: Number(row.chunk_count),
    totalRows: Number(row.total_rows),
    rowCount: Number(row.row_count),
    bodyDigest: row.body_digest,
    payloadJson: row.payload_json ?? null,
    payloadBytes: Number(row.payload_bytes),
    reservationId: row.reservation_id,
    receivedAt: Number(row.received_at),
    redactedAt: nullableTimestamp(row.redacted_at),
  });
}

function transportUnavailable(message, code, cause) {
  return transientError(message, { code, cause });
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function' || typeof value?.batch !== 'function') {
    throw new TypeError('D1GoogleAdsManagerDeliveryStore requires D1 prepare() and batch()');
  }
  return value;
}

function changes(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}

function text(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Google Ads delivery store requires ${fieldName}`);
  }
  return value.trim();
}

function exact(value, expected, fieldName) {
  const normalized = text(value, fieldName);
  if (normalized !== expected) throw new TypeError(`${fieldName} must be ${expected}`);
  return normalized;
}

function choice(value, choices, fieldName) {
  const normalized = text(value, fieldName);
  if (!choices.includes(normalized)) throw new TypeError(`${fieldName} is invalid`);
  return normalized;
}

function fingerprint(value, length, fieldName) {
  const normalized = text(value, fieldName);
  const pattern = length === 43 ? /^[A-Za-z0-9_-]{43}$/u : /^[a-f0-9]{64}$/u;
  if (!pattern.test(normalized)) throw new TypeError(`${fieldName} is invalid`);
  return normalized;
}

function uuid(value, fieldName) {
  const normalized = text(value, fieldName).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(normalized)) {
    throw new TypeError(`${fieldName} must be a UUID v4`);
  }
  return normalized;
}

function integer(value, fieldName, minimum, maximum = Number.MAX_SAFE_INTEGER) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw new TypeError(`${fieldName} is outside its allowed range`);
  }
  return number;
}

function timestamp(value, fieldName) {
  return integer(value, fieldName, 0);
}

function nullableTimestamp(value) {
  return value === null || value === undefined ? null : timestamp(value, 'timestamp');
}
