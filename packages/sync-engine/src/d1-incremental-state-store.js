import { permanentError, transientError } from '../../shared/src/errors/runtime-error.js';

/**
 * D1 checkpoint store สำหรับ Incremental Sync
 * Cursor และ Record fingerprints ถูก Commit หลัง Business write สำเร็จเท่านั้น
 */
export class D1IncrementalStateStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
    this.statementBatchSize = positiveInteger(input.statementBatchSize ?? 50, 'statementBatchSize');
  }

  /** โหลด Cursor และ Fingerprint ของ Source records ทั้งชุดสำหรับหนึ่ง Connector/account */
  async loadCheckpoint(cursorKey) {
    const key = requireText(cursorKey, 'cursorKey');
    try {
      const [cursorRow, recordResult] = await Promise.all([
        this.db.prepare(`
          SELECT
            cursor_key, customer_profile, platform, account_key, source, sync_type,
            last_metric_date, dictionary_hash, last_full_sync_at,
            last_successful_sync_at, incremental_run_count, last_sync_run_id,
            generation, generation_work_key, requested_at,
            created_at, updated_at
          FROM sync_cursors
          WHERE cursor_key = ?
        `).bind(key).first(),
        this.db.prepare(`
          SELECT
            source_record_id, source_modified_at, source_hash, external_content_id,
            last_seen_sync_run_id, last_seen_at, created_at, updated_at
          FROM source_record_states
          WHERE cursor_key = ?
        `).bind(key).all(),
      ]);

      return Object.freeze({
        cursor: cursorRow ? freezeCursor(cursorRow) : null,
        recordStates: Object.freeze(readRows(recordResult).map(freezeRecordState)),
      });
    } catch (cause) {
      throw d1Error('Failed to load incremental checkpoint', 'D1_INCREMENTAL_CHECKPOINT_READ_FAILED', cause);
    }
  }

  /**
   * Commit Fingerprint เป็น Chunk แล้ว Commit Cursor เป็นขั้นสุดท้าย
   * Cursor ที่ยังไม่เปลี่ยนทำให้รอบ Retry สามารถทำซ้ำได้อย่างปลอดภัย แม้ Batch ก่อนหน้าสำเร็จบางส่วน
   */
  async saveCheckpoint(input = {}) {
    const cursor = requireCursor(input.cursor);
    const records = requireRecordStates(input.records ?? []);
    const fullSnapshot = input.fullSnapshot === true;
    const now = this.now();
    const generationGuard = input.generationGuard
      ? requireGenerationGuard(input.generationGuard, cursor.cursorKey)
      : null;

    const recordStatements = records.map((record) => generationGuard
      ? this.db.prepare(`
      INSERT INTO source_record_states (
        cursor_key, source_record_id, source_modified_at, source_hash,
        external_content_id, last_seen_sync_run_id, last_seen_at,
        created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM sync_generation_fences
        WHERE cursor_key = ? AND generation = ? AND work_key = ?
      )
      ON CONFLICT(cursor_key, source_record_id) DO UPDATE SET
        source_modified_at = excluded.source_modified_at,
        source_hash = excluded.source_hash,
        external_content_id = excluded.external_content_id,
        last_seen_sync_run_id = excluded.last_seen_sync_run_id,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
      WHERE EXISTS (
        SELECT 1 FROM sync_generation_fences
        WHERE cursor_key = ? AND generation = ? AND work_key = ?
      )
    `).bind(
        cursor.cursorKey,
        record.sourceRecordId,
        nullableInteger(record.sourceModifiedAt),
        record.sourceHash,
        nullableText(record.externalContentId),
        cursor.lastSyncRunId,
        cursor.lastSuccessfulSyncAt,
        now,
        now,
        generationGuard.cursorKey,
        generationGuard.generation,
        generationGuard.workKey,
        generationGuard.cursorKey,
        generationGuard.generation,
        generationGuard.workKey,
      )
      : this.db.prepare(`
      INSERT INTO source_record_states (
        cursor_key, source_record_id, source_modified_at, source_hash,
        external_content_id, last_seen_sync_run_id, last_seen_at,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cursor_key, source_record_id) DO UPDATE SET
        source_modified_at = excluded.source_modified_at,
        source_hash = excluded.source_hash,
        external_content_id = excluded.external_content_id,
        last_seen_sync_run_id = excluded.last_seen_sync_run_id,
        last_seen_at = excluded.last_seen_at,
        updated_at = excluded.updated_at
    `).bind(
      cursor.cursorKey,
      record.sourceRecordId,
      nullableInteger(record.sourceModifiedAt),
      record.sourceHash,
      nullableText(record.externalContentId),
      cursor.lastSyncRunId,
      cursor.lastSuccessfulSyncAt,
      now,
      now,
      ));

    const cursorStatement = generationGuard
      ? this.db.prepare(`
      INSERT INTO sync_cursors (
        cursor_key, customer_profile, platform, account_key, source, sync_type,
        last_metric_date, dictionary_hash, last_full_sync_at,
        last_successful_sync_at, incremental_run_count, last_sync_run_id,
        generation, generation_work_key, requested_at, created_at, updated_at
      )
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE EXISTS (
        SELECT 1 FROM sync_generation_fences
        WHERE cursor_key = ? AND generation = ? AND work_key = ?
      )
      ON CONFLICT(cursor_key) DO UPDATE SET
        customer_profile = excluded.customer_profile,
        platform = excluded.platform,
        account_key = excluded.account_key,
        source = excluded.source,
        sync_type = excluded.sync_type,
        last_metric_date = excluded.last_metric_date,
        dictionary_hash = excluded.dictionary_hash,
        last_full_sync_at = excluded.last_full_sync_at,
        last_successful_sync_at = excluded.last_successful_sync_at,
        incremental_run_count = excluded.incremental_run_count,
        last_sync_run_id = excluded.last_sync_run_id,
        generation = excluded.generation,
        generation_work_key = excluded.generation_work_key,
        requested_at = excluded.requested_at,
        updated_at = excluded.updated_at
      WHERE excluded.generation >= sync_cursors.generation
        AND EXISTS (
          SELECT 1 FROM sync_generation_fences
          WHERE cursor_key = ? AND generation = ? AND work_key = ?
        )
    `).bind(
        cursor.cursorKey,
        cursor.customerProfile,
        cursor.platform,
        cursor.accountKey,
        cursor.source,
        cursor.syncType,
        nullableText(cursor.lastMetricDate),
        nullableText(cursor.dictionaryHash),
        nullableInteger(cursor.lastFullSyncAt),
        safeInteger(cursor.lastSuccessfulSyncAt, 'lastSuccessfulSyncAt'),
        nonNegativeInteger(cursor.incrementalRunCount, 'incrementalRunCount'),
        cursor.lastSyncRunId,
        generationGuard.generation,
        generationGuard.workKey,
        generationGuard.requestedAt,
        now,
        now,
        generationGuard.cursorKey,
        generationGuard.generation,
        generationGuard.workKey,
        generationGuard.cursorKey,
        generationGuard.generation,
        generationGuard.workKey,
      )
      : this.db.prepare(`
      INSERT INTO sync_cursors (
        cursor_key, customer_profile, platform, account_key, source, sync_type,
        last_metric_date, dictionary_hash, last_full_sync_at,
        last_successful_sync_at, incremental_run_count, last_sync_run_id,
        created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cursor_key) DO UPDATE SET
        customer_profile = excluded.customer_profile,
        platform = excluded.platform,
        account_key = excluded.account_key,
        source = excluded.source,
        sync_type = excluded.sync_type,
        last_metric_date = excluded.last_metric_date,
        dictionary_hash = excluded.dictionary_hash,
        last_full_sync_at = excluded.last_full_sync_at,
        last_successful_sync_at = excluded.last_successful_sync_at,
        incremental_run_count = excluded.incremental_run_count,
        last_sync_run_id = excluded.last_sync_run_id,
        updated_at = excluded.updated_at
    `).bind(
      cursor.cursorKey,
      cursor.customerProfile,
      cursor.platform,
      cursor.accountKey,
      cursor.source,
      cursor.syncType,
      nullableText(cursor.lastMetricDate),
      nullableText(cursor.dictionaryHash),
      nullableInteger(cursor.lastFullSyncAt),
      safeInteger(cursor.lastSuccessfulSyncAt, 'lastSuccessfulSyncAt'),
      nonNegativeInteger(cursor.incrementalRunCount, 'incrementalRunCount'),
      cursor.lastSyncRunId,
      now,
      now,
      );

    const finalStatements = [cursorStatement];
    if (fullSnapshot) {
      finalStatements.push(generationGuard
        ? this.db.prepare(`
        DELETE FROM source_record_states
        WHERE cursor_key = ? AND last_seen_sync_run_id <> ?
          AND EXISTS (
            SELECT 1 FROM sync_generation_fences
            WHERE cursor_key = ? AND generation = ? AND work_key = ?
          )
      `).bind(
          cursor.cursorKey,
          cursor.lastSyncRunId,
          generationGuard.cursorKey,
          generationGuard.generation,
          generationGuard.workKey,
        )
        : this.db.prepare(`
        DELETE FROM source_record_states
        WHERE cursor_key = ? AND last_seen_sync_run_id <> ?
      `).bind(cursor.cursorKey, cursor.lastSyncRunId));
    }

    const recordBatches = chunk(recordStatements, this.statementBatchSize);
    let statementCount = 0;
    try {
      for (const statements of recordBatches) {
        if (generationGuard) await this.#assertGeneration(generationGuard);
        await this.db.batch(statements);
        statementCount += statements.length;
      }
      if (generationGuard) await this.#assertGeneration(generationGuard);
      await this.db.batch(finalStatements);
      statementCount += finalStatements.length;
      if (generationGuard) await this.#assertGeneration(generationGuard);
      return Object.freeze({
        cursorKey: cursor.cursorKey,
        recordsSaved: records.length,
        fullSnapshot,
        batches: recordBatches.length + 1,
        statements: statementCount,
      });
    } catch (cause) {
      if (cause?.code === 'SYNC_WORK_SUPERSEDED') throw cause;
      throw d1Error('Failed to save incremental checkpoint', 'D1_INCREMENTAL_CHECKPOINT_WRITE_FAILED', cause);
    }
  }

  async #assertGeneration(guard) {
    const row = await this.db.prepare(`
      SELECT generation, work_key
      FROM sync_generation_fences
      WHERE cursor_key = ?
    `).bind(guard.cursorKey).first();
    if (Number(row?.generation) !== guard.generation || row?.work_key !== guard.workKey) {
      throw permanentError('Incremental checkpoint generation was superseded', {
        code: 'SYNC_WORK_SUPERSEDED',
        details: { generation: guard.generation },
      });
    }
  }
}

function freezeCursor(row) {
  return Object.freeze({
    cursorKey: row.cursor_key,
    customerProfile: row.customer_profile,
    platform: row.platform,
    accountKey: row.account_key,
    source: row.source,
    syncType: row.sync_type,
    lastMetricDate: row.last_metric_date ?? null,
    dictionaryHash: row.dictionary_hash ?? null,
    lastFullSyncAt: toNullableInteger(row.last_full_sync_at),
    lastSuccessfulSyncAt: toNullableInteger(row.last_successful_sync_at),
    incrementalRunCount: toNonNegativeInteger(row.incremental_run_count),
    lastSyncRunId: row.last_sync_run_id,
    generation: toNonNegativeInteger(row.generation),
    generationWorkKey: row.generation_work_key ?? null,
    requestedAt: toNonNegativeInteger(row.requested_at),
    createdAt: toNullableInteger(row.created_at),
    updatedAt: toNullableInteger(row.updated_at),
  });
}

function requireGenerationGuard(value, cursorKey) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('D1IncrementalStateStore requires generationGuard');
  }
  const guardCursorKey = requireText(
    value.cursorKey ?? cursorKey,
    'generationGuard.cursorKey',
  );
  if (guardCursorKey !== cursorKey) throw new TypeError('generationGuard.cursorKey must match cursor.cursorKey');
  return Object.freeze({
    cursorKey: guardCursorKey,
    generation: nonNegativeInteger(value.generation, 'generationGuard.generation'),
    workKey: requireText(value.workKey, 'generationGuard.workKey'),
    requestedAt: nonNegativeInteger(
      value.requestedAt ?? value.generation,
      'generationGuard.requestedAt',
    ),
  });
}

function freezeRecordState(row) {
  return Object.freeze({
    sourceRecordId: row.source_record_id,
    sourceModifiedAt: toNullableInteger(row.source_modified_at),
    sourceHash: row.source_hash,
    externalContentId: row.external_content_id ?? null,
    lastSeenSyncRunId: row.last_seen_sync_run_id,
    lastSeenAt: toNullableInteger(row.last_seen_at),
    createdAt: toNullableInteger(row.created_at),
    updatedAt: toNullableInteger(row.updated_at),
  });
}

function requireCursor(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('D1IncrementalStateStore requires cursor');
  }
  return Object.freeze({
    cursorKey: requireText(value.cursorKey, 'cursor.cursorKey'),
    customerProfile: requireText(value.customerProfile, 'cursor.customerProfile'),
    platform: requireText(value.platform, 'cursor.platform'),
    accountKey: requireText(value.accountKey, 'cursor.accountKey'),
    source: requireText(value.source, 'cursor.source'),
    syncType: requireText(value.syncType, 'cursor.syncType'),
    lastMetricDate: nullableText(value.lastMetricDate),
    dictionaryHash: nullableText(value.dictionaryHash),
    lastFullSyncAt: nullableInteger(value.lastFullSyncAt),
    lastSuccessfulSyncAt: safeInteger(value.lastSuccessfulSyncAt, 'cursor.lastSuccessfulSyncAt'),
    incrementalRunCount: nonNegativeInteger(value.incrementalRunCount, 'cursor.incrementalRunCount'),
    lastSyncRunId: requireText(value.lastSyncRunId, 'cursor.lastSyncRunId'),
  });
}

function requireRecordStates(value) {
  if (!Array.isArray(value)) throw new TypeError('D1IncrementalStateStore requires records array');
  const seen = new Set();
  return value.map((record) => {
    if (!record || typeof record !== 'object' || Array.isArray(record)) {
      throw new TypeError('D1IncrementalStateStore record must be an object');
    }
    const sourceRecordId = requireText(record.sourceRecordId, 'record.sourceRecordId');
    if (seen.has(sourceRecordId)) throw new Error(`Duplicate incremental sourceRecordId: ${sourceRecordId}`);
    seen.add(sourceRecordId);
    return Object.freeze({
      sourceRecordId,
      sourceModifiedAt: nullableInteger(record.sourceModifiedAt),
      sourceHash: requireText(record.sourceHash, 'record.sourceHash'),
      externalContentId: nullableText(record.externalContentId),
    });
  });
}

function readRows(result) {
  const rows = result?.results ?? result?.rows ?? [];
  if (!Array.isArray(rows)) throw new TypeError('D1 all() result must contain an array');
  return rows;
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function' || typeof value?.batch !== 'function') {
    throw new TypeError('D1IncrementalStateStore requires D1 prepare() and batch()');
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`D1IncrementalStateStore requires ${fieldName}`);
  }
  return value.trim();
}

function nullableText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireText(String(value), 'text');
}

function safeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number)) {
    throw new TypeError(`D1IncrementalStateStore ${fieldName} must be a safe integer`);
  }
  return number;
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  return safeInteger(value, 'integer');
}

function nonNegativeInteger(value, fieldName) {
  const number = safeInteger(value, fieldName);
  if (number < 0) throw new TypeError(`D1IncrementalStateStore ${fieldName} must be non-negative`);
  return number;
}

function toNullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function toNonNegativeInteger(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function positiveInteger(value, fieldName) {
  const number = safeInteger(value, fieldName);
  if (number <= 0) throw new TypeError(`D1IncrementalStateStore ${fieldName} must be positive`);
  return number;
}

function chunk(values, size) {
  const groups = [];
  for (let index = 0; index < values.length; index += size) {
    groups.push(values.slice(index, index + size));
  }
  return groups;
}

function d1Error(message, code, cause) {
  return transientError(message, {
    code,
    cause,
    details: { causeMessage: cause instanceof Error ? cause.message : String(cause) },
  });
}
