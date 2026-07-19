import { transientError } from '../../shared/src/errors/runtime-error.js';

/**
 * Durable work staging กลางสำหรับ Connector ที่อ่าน Source แบบ page/chunk
 * แต่ยังต้อง Plan destination ทุกตารางก่อน Business write แรก
 */
export class D1ResumableWorkStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
    this.unitPageSize = boundedPositiveInteger(input.unitPageSize ?? 100, 'unitPageSize', 500);
  }

  async beginWork(input = {}) {
    const work = requireWork(input);
    const now = safeTimestamp(this.now(), 'now');
    try {
      const existing = await this.db.prepare(`
        SELECT operation_fingerprint
        FROM sync_work_runs
        WHERE work_key = ?
      `).bind(work.workKey).first();
      const resumed = existing?.operation_fingerprint === work.operationFingerprint;
      const statements = [];
      if (existing && !resumed) {
        statements.push(
          this.db.prepare('DELETE FROM sync_work_units WHERE work_key = ?').bind(work.workKey),
          this.db.prepare('DELETE FROM sync_work_phases WHERE work_key = ?').bind(work.workKey),
        );
      }
      statements.push(this.db.prepare(`
        INSERT INTO sync_work_runs (
          work_key, cursor_key, work_type, operation_fingerprint, status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(work_key) DO UPDATE SET
          cursor_key = excluded.cursor_key,
          work_type = excluded.work_type,
          operation_fingerprint = excluded.operation_fingerprint,
          status = 'active',
          updated_at = excluded.updated_at
      `).bind(
        work.workKey,
        work.cursorKey,
        work.workType,
        work.operationFingerprint,
        now,
        now,
      ));
      await this.db.batch(statements);
      return Object.freeze({ workKey: work.workKey, resumed });
    } catch (cause) {
      throw d1Error('Failed to begin resumable sync work', 'D1_SYNC_WORK_BEGIN_FAILED', cause);
    }
  }

  async loadPhase(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const phase = requireText(input.phase, 'phase');
    try {
      const row = await this.db.prepare(`
        SELECT
          state_json, expected_items, processed_items, pages_processed,
          chunks_processed, complete, created_at, updated_at
        FROM sync_work_phases
        WHERE work_key = ? AND phase = ?
      `).bind(workKey, phase).first();
      return row ? freezePhase(row) : null;
    } catch (cause) {
      throw d1Error('Failed to load resumable sync phase', 'D1_SYNC_WORK_READ_FAILED', cause);
    }
  }

  /**
   * Unit payload และ Phase progress อยู่ใน D1 batch เดียวกัน
   * หาก request ล้มก่อน Commit ทั้งคู่จะไม่เลื่อนไปคนละจุด
   */
  async savePhase(input = {}) {
    const phase = requirePhaseWrite(input);
    const now = safeTimestamp(this.now(), 'now');
    const statements = [];
    if (phase.unit) {
      statements.push(this.db.prepare(`
        INSERT INTO sync_work_units (
          work_key, phase, unit_key, sequence, payload_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(work_key, phase, unit_key) DO UPDATE SET
          sequence = excluded.sequence,
          payload_json = excluded.payload_json,
          updated_at = excluded.updated_at
      `).bind(
        phase.workKey,
        phase.phase,
        phase.unit.unitKey,
        phase.unit.sequence,
        JSON.stringify(phase.unit.payload),
        now,
        now,
      ));
    }
    statements.push(
      this.db.prepare(`
        INSERT INTO sync_work_phases (
          work_key, phase, state_json, expected_items, processed_items,
          pages_processed, chunks_processed, complete, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(work_key, phase) DO UPDATE SET
          state_json = excluded.state_json,
          expected_items = excluded.expected_items,
          processed_items = excluded.processed_items,
          pages_processed = excluded.pages_processed,
          chunks_processed = excluded.chunks_processed,
          complete = excluded.complete,
          updated_at = excluded.updated_at
      `).bind(
        phase.workKey,
        phase.phase,
        JSON.stringify(phase.state),
        phase.expectedItems,
        phase.processedItems,
        phase.pagesProcessed,
        phase.chunksProcessed,
        phase.complete ? 1 : 0,
        now,
        now,
      ),
      this.db.prepare(`
        UPDATE sync_work_runs
        SET updated_at = ?
        WHERE work_key = ?
      `).bind(now, phase.workKey),
    );
    try {
      await this.db.batch(statements);
      return Object.freeze({
        phase: phase.phase,
        complete: phase.complete,
        processedItems: phase.processedItems,
        pagesProcessed: phase.pagesProcessed,
        chunksProcessed: phase.chunksProcessed,
      });
    } catch (cause) {
      throw d1Error('Failed to save resumable sync phase', 'D1_SYNC_WORK_WRITE_FAILED', cause);
    }
  }

  async listPhaseUnits(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const phase = requireText(input.phase, 'phase');
    const afterSequence = nonNegativeInteger(input.afterSequence ?? 0, 'afterSequence');
    const limit = boundedPositiveInteger(input.limit ?? this.unitPageSize, 'limit', 500);
    try {
      const result = await this.db.prepare(`
        SELECT unit_key, sequence, payload_json
        FROM sync_work_units
        WHERE work_key = ? AND phase = ? AND sequence >= ?
        ORDER BY sequence ASC
        LIMIT ?
      `).bind(workKey, phase, afterSequence, limit).all();
      const units = readRows(result).map((row) => Object.freeze({
        unitKey: requireText(row.unit_key, 'unit_key'),
        sequence: nonNegativeInteger(row.sequence, 'sequence'),
        payload: parseJsonObject(row.payload_json, 'payload_json'),
      }));
      return Object.freeze({
        units: Object.freeze(units),
        nextSequence: units.length === limit ? units.at(-1).sequence + 1 : null,
      });
    } catch (cause) {
      if (cause?.code?.startsWith?.('D1_SYNC_WORK_')) throw cause;
      throw d1Error('Failed to list resumable sync units', 'D1_SYNC_WORK_READ_FAILED', cause);
    }
  }

  async resetPhase(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const phase = requireText(input.phase, 'phase');
    try {
      await this.db.batch([
        this.db.prepare('DELETE FROM sync_work_units WHERE work_key = ? AND phase = ?').bind(workKey, phase),
        this.db.prepare('DELETE FROM sync_work_phases WHERE work_key = ? AND phase = ?').bind(workKey, phase),
      ]);
      return true;
    } catch (cause) {
      throw d1Error('Failed to reset resumable sync phase', 'D1_SYNC_WORK_RESET_FAILED', cause);
    }
  }

  async completeWork(workKey) {
    const key = requireText(workKey, 'workKey');
    try {
      await this.db.batch([
        this.db.prepare('DELETE FROM sync_work_units WHERE work_key = ?').bind(key),
        this.db.prepare('DELETE FROM sync_work_phases WHERE work_key = ?').bind(key),
        this.db.prepare('DELETE FROM sync_work_runs WHERE work_key = ?').bind(key),
      ]);
      return true;
    } catch (cause) {
      throw d1Error('Failed to complete resumable sync work', 'D1_SYNC_WORK_COMPLETE_FAILED', cause);
    }
  }
}

function freezePhase(row) {
  return Object.freeze({
    state: parseJsonObject(row.state_json, 'state_json'),
    expectedItems: nonNegativeInteger(row.expected_items, 'expected_items'),
    processedItems: nonNegativeInteger(row.processed_items, 'processed_items'),
    pagesProcessed: nonNegativeInteger(row.pages_processed, 'pages_processed'),
    chunksProcessed: nonNegativeInteger(row.chunks_processed, 'chunks_processed'),
    complete: Number(row.complete) === 1,
    createdAt: safeTimestamp(row.created_at, 'created_at'),
    updatedAt: safeTimestamp(row.updated_at, 'updated_at'),
  });
}

function requireWork(input) {
  return Object.freeze({
    workKey: requireText(input.workKey, 'workKey'),
    cursorKey: requireText(input.cursorKey, 'cursorKey'),
    workType: requireText(input.workType, 'workType'),
    operationFingerprint: requireText(input.operationFingerprint, 'operationFingerprint'),
  });
}

function requirePhaseWrite(input) {
  const expectedItems = nonNegativeInteger(input.expectedItems ?? 0, 'expectedItems');
  const processedItems = nonNegativeInteger(input.processedItems ?? 0, 'processedItems');
  if (processedItems > expectedItems) throw new RangeError('processedItems cannot exceed expectedItems');
  return Object.freeze({
    workKey: requireText(input.workKey, 'workKey'),
    phase: requireText(input.phase, 'phase'),
    state: requireJsonObject(input.state ?? {}, 'state'),
    expectedItems,
    processedItems,
    pagesProcessed: nonNegativeInteger(input.pagesProcessed ?? 0, 'pagesProcessed'),
    chunksProcessed: nonNegativeInteger(input.chunksProcessed ?? 0, 'chunksProcessed'),
    complete: input.complete === true,
    unit: input.unit ? Object.freeze({
      unitKey: requireText(input.unit.unitKey, 'unit.unitKey'),
      sequence: nonNegativeInteger(input.unit.sequence, 'unit.sequence'),
      payload: requireJsonObject(input.unit.payload, 'unit.payload'),
    }) : null,
  });
}

function parseJsonObject(value, fieldName) {
  try {
    return Object.freeze(requireJsonObject(JSON.parse(String(value)), fieldName));
  } catch (cause) {
    throw d1Error(`Invalid resumable sync ${fieldName}`, 'D1_SYNC_WORK_INVALID_JSON', cause);
  }
}

function requireJsonObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  JSON.stringify(value);
  return { ...value };
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function' || typeof value?.batch !== 'function') {
    throw new TypeError('D1ResumableWorkStore requires D1 prepare() and batch()');
  }
  return value;
}

function readRows(result) {
  const rows = result?.results ?? result?.rows ?? [];
  if (!Array.isArray(rows)) throw new TypeError('D1 all() result must contain an array');
  return rows;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`D1ResumableWorkStore requires ${fieldName}`);
  }
  return value.trim();
}

function safeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`D1ResumableWorkStore ${fieldName} must be a non-negative safe integer`);
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  return safeTimestamp(value, fieldName);
}

function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new TypeError(`D1ResumableWorkStore ${fieldName} must be from 1 to ${maximum}`);
  }
  return number;
}

function d1Error(message, code, cause) {
  return transientError(message, {
    code,
    cause,
    details: { causeMessage: cause instanceof Error ? cause.message : String(cause) },
  });
}
