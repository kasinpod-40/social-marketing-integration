import {
  permanentError,
  sanitizeOperationalValue,
  transientError,
} from '../../shared/src/errors/runtime-error.js';

const DEFAULT_RETENTION_MS = 7 * 86_400_000;

/**
 * Durable work staging กลางสำหรับ page/chunk connector:
 * generation fence ป้องกัน stale retry, completion/outbox ใช้ replay และ terminal TTL ใช้ cleanup แบบ guarded
 */
export class D1ResumableWorkStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.now = typeof input.now === 'function' ? input.now : () => Date.now();
    this.unitPageSize = boundedPositiveInteger(input.unitPageSize ?? 100, 'unitPageSize', 500);
    this.retentionMs = boundedPositiveInteger(
      input.retentionMs ?? DEFAULT_RETENTION_MS,
      'retentionMs',
      365 * 86_400_000,
    );
  }

  async beginWork(input = {}) {
    const now = safeTimestamp(this.now(), 'now');
    const work = requireWork(input, now);
    try {
      // ตรวจ Work key เดิมก่อน Claim fence เพื่อให้ Completed warning replay ทำงานได้
      // แม้มี Generation ใหม่ Claim cursor ไปแล้ว โดยไม่ย้อนเรียก Source หรือ Business write.
      const existing = await this.db.prepare(`
        SELECT operation_fingerprint, generation, lifecycle_status, completion_json
        FROM sync_work_runs
        WHERE work_key = ?
      `).bind(work.workKey).first();
      const existingGeneration = existing && existing.generation === undefined
        ? work.generation
        : Number(existing?.generation);
      const lifecycleStatus = existing && existing.lifecycle_status === undefined
        ? 'active'
        : existing?.lifecycle_status;

      if (existing && existingGeneration !== work.generation) {
        throw permanentError('Resumable work key was reused with a different generation', {
          code: 'SYNC_WORK_GENERATION_MISMATCH',
          details: { generation: work.generation },
        });
      }
      if (existing && lifecycleStatus === 'completed') {
        return Object.freeze({
          workKey: work.workKey,
          resumed: true,
          superseded: false,
          completed: true,
          completion: parseNullableJsonObject(existing.completion_json, 'completion_json'),
        });
      }
      if (existing && ['terminal', 'superseded'].includes(lifecycleStatus)) {
        return Object.freeze({
          workKey: work.workKey,
          resumed: false,
          superseded: true,
          completed: false,
        });
      }
      if (existing && existing.operation_fingerprint !== work.operationFingerprint) {
        throw permanentError('Resumable sync operation changed within the same active generation', {
          code: 'SYNC_WORK_OPERATION_MISMATCH',
          details: { generation: work.generation },
        });
      }
      const claimed = await this.db.prepare(`
        INSERT INTO sync_generation_fences (
          cursor_key, generation, requested_at, work_key, updated_at
        ) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(cursor_key) DO UPDATE SET
          generation = excluded.generation,
          requested_at = excluded.requested_at,
          work_key = excluded.work_key,
          updated_at = excluded.updated_at
        WHERE excluded.generation > sync_generation_fences.generation
           OR (
             excluded.generation = sync_generation_fences.generation
             AND excluded.work_key = sync_generation_fences.work_key
           )
      `).bind(
        work.cursorKey,
        work.generation,
        work.requestedAt,
        work.workKey,
        now,
      ).run();
      if (readChanges(claimed) === 0) {
        await this.#recordSupersededWork(work, now);
        return Object.freeze({
          workKey: work.workKey,
          resumed: false,
          superseded: true,
          completed: false,
        });
      }

      const resumed = Boolean(existing)
        && lifecycleStatus === 'active'
        && existing.operation_fingerprint === work.operationFingerprint;
      await this.db.prepare(`
        INSERT INTO sync_work_runs (
          work_key, cursor_key, work_type, operation_fingerprint, status,
          generation, requested_at, lifecycle_status,
          terminal_reason, abandoned_at, completed_at, expires_at,
          audit_reference, completion_json, created_at, updated_at
        ) VALUES (?, ?, ?, ?, 'active', ?, ?, 'active', NULL, NULL, NULL, NULL, NULL, NULL, ?, ?)
        ON CONFLICT(work_key) DO UPDATE SET
          cursor_key = excluded.cursor_key,
          work_type = excluded.work_type,
          operation_fingerprint = excluded.operation_fingerprint,
          requested_at = excluded.requested_at,
          updated_at = excluded.updated_at
        WHERE sync_work_runs.generation = excluded.generation
          AND sync_work_runs.lifecycle_status = 'active'
      `).bind(
        work.workKey,
        work.cursorKey,
        work.workType,
        work.operationFingerprint,
        work.generation,
        work.requestedAt,
        now,
        now,
      ).run();
      return Object.freeze({
        workKey: work.workKey,
        resumed,
        superseded: false,
        completed: false,
      });
    } catch (cause) {
      if (['SYNC_WORK_OPERATION_MISMATCH', 'SYNC_WORK_GENERATION_MISMATCH'].includes(cause?.code)) {
        throw cause;
      }
      throw d1Error('Failed to begin resumable sync work', 'D1_SYNC_WORK_BEGIN_FAILED', cause);
    }
  }

  async assertCurrentGeneration(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const cursorKey = requireText(input.cursorKey, 'cursorKey');
    const generation = safeTimestamp(input.generation, 'generation');
    try {
      const row = await this.db.prepare(`
        SELECT generation, work_key
        FROM sync_generation_fences
        WHERE cursor_key = ?
      `).bind(cursorKey).first();
      if (Number(row?.generation) !== generation || row?.work_key !== workKey) {
        throw permanentError('Sync work generation was superseded by a newer job', {
          code: 'SYNC_WORK_SUPERSEDED',
          details: { generation },
        });
      }
      return true;
    } catch (cause) {
      if (cause?.code === 'SYNC_WORK_SUPERSEDED') throw cause;
      throw d1Error('Failed to validate sync work generation', 'D1_SYNC_WORK_FENCE_READ_FAILED', cause);
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
        WHERE work_key = ? AND lifecycle_status = 'active'
      `).bind(now, phase.workKey),
    );
    try {
      await this.db.batch(statements);
      // คืน Contract เดียวกับ loadPhase/InMemory store เพื่อให้ caller เดินต่อด้วย
      // cursor state ที่เพิ่ง commit ลง D1 ได้ทันที โดยไม่ย้อนกลับไปหน้าแรกในรอบเดียวกัน.
      return Object.freeze({
        state: structuredClone(phase.state),
        expectedItems: phase.expectedItems,
        processedItems: phase.processedItems,
        pagesProcessed: phase.pagesProcessed,
        chunksProcessed: phase.chunksProcessed,
        complete: phase.complete,
        createdAt: now,
        updatedAt: now,
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

  async saveWarningOutbox(input = {}) {
    const event = requireWarning(input);
    const now = safeTimestamp(this.now(), 'now');
    const payload = sanitizeOperationalValue(event.payload);
    try {
      const result = event.generationGuard
        ? await this.db.prepare(`
        INSERT INTO sync_warning_outbox (
          outbox_id, work_key, sync_run_id, warning_type, source_key,
          payload_json, status, delivery_attempts, created_at, updated_at
        )
        SELECT ?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?
        WHERE EXISTS (
          SELECT 1 FROM sync_generation_fences
          WHERE cursor_key = ? AND generation = ? AND work_key = ?
        )
        ON CONFLICT(outbox_id) DO UPDATE SET
          payload_json = CASE
            WHEN sync_warning_outbox.status = 'pending' THEN excluded.payload_json
            ELSE sync_warning_outbox.payload_json
          END,
          updated_at = excluded.updated_at
        WHERE EXISTS (
          SELECT 1 FROM sync_generation_fences
          WHERE cursor_key = ? AND generation = ? AND work_key = ?
        )
      `).bind(
          event.outboxId,
          event.workKey,
          event.syncRunId,
          event.warningType,
          event.sourceKey,
          JSON.stringify(payload),
          now,
          now,
          event.generationGuard.cursorKey,
          event.generationGuard.generation,
          event.generationGuard.workKey,
          event.generationGuard.cursorKey,
          event.generationGuard.generation,
          event.generationGuard.workKey,
        ).run()
        : await this.db.prepare(`
        INSERT INTO sync_warning_outbox (
          outbox_id, work_key, sync_run_id, warning_type, source_key,
          payload_json, status, delivery_attempts, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, 'pending', 0, ?, ?)
        ON CONFLICT(outbox_id) DO UPDATE SET
          payload_json = CASE
            WHEN sync_warning_outbox.status = 'pending' THEN excluded.payload_json
            ELSE sync_warning_outbox.payload_json
          END,
          updated_at = excluded.updated_at
        `).bind(
          event.outboxId,
          event.workKey,
          event.syncRunId,
          event.warningType,
          event.sourceKey,
          JSON.stringify(payload),
          now,
          now,
        ).run();
      if (event.generationGuard && readChanges(result) === 0) {
        throw permanentError('Sync warning generation was superseded', {
          code: 'SYNC_WORK_SUPERSEDED',
          details: { generation: event.generationGuard.generation },
        });
      }
      return Object.freeze({ outboxId: event.outboxId, status: 'pending' });
    } catch (cause) {
      if (cause?.code === 'SYNC_WORK_SUPERSEDED') throw cause;
      throw d1Error('Failed to persist sync warning outbox', 'D1_SYNC_WARNING_OUTBOX_WRITE_FAILED', cause);
    }
  }

  async listPendingWarnings(input = {}) {
    const workKey = optionalText(input.workKey);
    const limit = boundedPositiveInteger(input.limit ?? 100, 'limit', 500);
    try {
      const statement = workKey
        ? this.db.prepare(`
          SELECT
            outbox_id, work_key, sync_run_id, warning_type, source_key,
            payload_json, status, delivery_attempts, delivered_at
          FROM sync_warning_outbox
          WHERE work_key = ? AND status = 'pending'
          ORDER BY created_at ASC, outbox_id ASC
          LIMIT ?
        `).bind(workKey, limit)
        : this.db.prepare(`
          SELECT
            outbox_id, work_key, sync_run_id, warning_type, source_key,
            payload_json, status, delivery_attempts, delivered_at
          FROM sync_warning_outbox
          WHERE status = 'pending'
          ORDER BY created_at ASC, outbox_id ASC
          LIMIT ?
        `).bind(limit);
      const result = await statement.all();
      return Object.freeze(readRows(result).map((row) => Object.freeze({
        outboxId: requireText(row.outbox_id, 'outbox_id'),
        workKey: requireText(row.work_key, 'work_key'),
        syncRunId: requireText(row.sync_run_id, 'sync_run_id'),
        warningType: requireText(row.warning_type, 'warning_type'),
        sourceKey: requireText(row.source_key, 'source_key'),
        payload: parseJsonObject(row.payload_json, 'payload_json'),
        status: row.status,
        deliveryAttempts: nonNegativeInteger(row.delivery_attempts, 'delivery_attempts'),
        deliveredAt: row.delivered_at === null ? null : safeTimestamp(row.delivered_at, 'delivered_at'),
      })));
    } catch (cause) {
      if (cause?.code?.startsWith?.('D1_SYNC_WORK_')) throw cause;
      throw d1Error('Failed to read sync warning outbox', 'D1_SYNC_WARNING_OUTBOX_READ_FAILED', cause);
    }
  }

  async markWarningDeliveryFailed(input = {}) {
    const outboxId = requireText(input.outboxId, 'outboxId');
    const errorCode = optionalText(input.errorCode) ?? 'SYNC_WARNING_ALERT_WRITE_FAILED';
    const updatedAt = safeTimestamp(input.updatedAt ?? this.now(), 'updatedAt');
    try {
      await this.db.prepare(`
        UPDATE sync_warning_outbox
        SET delivery_attempts = delivery_attempts + 1,
            last_error_code = ?,
            updated_at = ?
        WHERE outbox_id = ? AND status = 'pending'
      `).bind(errorCode, updatedAt, outboxId).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to record sync warning delivery failure', 'D1_SYNC_WARNING_OUTBOX_DELIVERY_FAILED', cause);
    }
  }

  async markWarningDelivered(input = {}) {
    const outboxId = requireText(input.outboxId, 'outboxId');
    const deliveredAt = safeTimestamp(input.deliveredAt ?? this.now(), 'deliveredAt');
    try {
      await this.db.prepare(`
        UPDATE sync_warning_outbox
        SET status = 'delivered',
            delivery_attempts = delivery_attempts + 1,
            last_error_code = NULL,
            delivered_at = COALESCE(delivered_at, ?),
            updated_at = ?
        WHERE outbox_id = ? AND status = 'pending'
      `).bind(deliveredAt, deliveredAt, outboxId).run();
      return true;
    } catch (cause) {
      throw d1Error('Failed to complete sync warning delivery', 'D1_SYNC_WARNING_OUTBOX_DELIVERY_FAILED', cause);
    }
  }

  async completeWork(input) {
    const value = typeof input === 'string' ? { workKey: input, completion: null } : input;
    const key = requireText(value?.workKey, 'workKey');
    const now = safeTimestamp(this.now(), 'now');
    const completionJson = value?.completion
      ? JSON.stringify(sanitizeOperationalValue(value.completion))
      : null;
    try {
      await this.db.batch([
        this.db.prepare('DELETE FROM sync_work_units WHERE work_key = ?').bind(key),
        this.db.prepare('DELETE FROM sync_work_phases WHERE work_key = ?').bind(key),
        this.db.prepare(`
          UPDATE sync_work_runs
          SET lifecycle_status = 'completed',
              completed_at = ?,
              expires_at = ?,
              completion_json = ?,
              updated_at = ?
          WHERE work_key = ? AND lifecycle_status = 'active'
        `).bind(now, now + this.retentionMs, completionJson, now, key),
      ]);
      return true;
    } catch (cause) {
      throw d1Error('Failed to complete resumable sync work', 'D1_SYNC_WORK_COMPLETE_FAILED', cause);
    }
  }

  async abandonWork(input = {}) {
    const workKey = requireText(input.workKey, 'workKey');
    const reason = requireText(input.reason, 'reason');
    const lifecycleStatus = input.lifecycleStatus === 'superseded' ? 'superseded' : 'terminal';
    const auditReference = optionalText(input.auditReference);
    const now = safeTimestamp(this.now(), 'now');
    try {
      const result = await this.db.prepare(`
        UPDATE sync_work_runs
        SET lifecycle_status = '${lifecycleStatus}',
            terminal_reason = COALESCE(terminal_reason, ?),
            abandoned_at = COALESCE(abandoned_at, ?),
            expires_at = COALESCE(expires_at, ?),
            audit_reference = COALESCE(audit_reference, ?),
            updated_at = ?
        WHERE work_key = ?
          AND (
            lifecycle_status IN ('active', 'terminal', 'superseded')
            OR (
              lifecycle_status = 'completed'
              AND NOT EXISTS (
                SELECT 1 FROM sync_warning_outbox
                WHERE work_key = sync_work_runs.work_key AND status = 'pending'
              )
            )
          )
      `).bind(
        reason,
        now,
        now + this.retentionMs,
        auditReference,
        now,
        workKey,
      ).run();
      return Object.freeze({
        terminal: readChanges(result) > 0,
        found: readChanges(result) > 0,
        status: lifecycleStatus,
      });
    } catch (cause) {
      throw d1Error('Failed to mark resumable sync work terminal', 'D1_SYNC_WORK_TERMINAL_FAILED', cause);
    }
  }

  async cleanupExpiredWork(input = {}) {
    const now = safeTimestamp(input.now ?? this.now(), 'now');
    const limit = boundedPositiveInteger(input.limit ?? 100, 'limit', 500);
    try {
      const result = await this.db.prepare(`
        SELECT work_key
        FROM sync_work_runs AS work
        WHERE lifecycle_status IN ('completed', 'terminal', 'superseded')
          AND expires_at IS NOT NULL
          AND expires_at <= ?
          AND NOT EXISTS (
            SELECT 1 FROM sync_locks AS lock
            WHERE lock.lock_key = work.cursor_key AND lock.expires_at > ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM sync_warning_outbox AS warning
            WHERE warning.work_key = work.work_key AND warning.status = 'pending'
          )
        ORDER BY expires_at ASC
        LIMIT ?
      `).bind(now, now, limit).all();
      const candidates = readRows(result).map((row) => requireText(row.work_key, 'work_key'));
      for (const workKey of candidates) {
        await this.db.batch([
          this.db.prepare(`
            DELETE FROM sync_work_units
            WHERE work_key = ? AND EXISTS (
              SELECT 1 FROM sync_work_runs
              WHERE work_key = ? AND lifecycle_status IN ('completed', 'terminal', 'superseded')
                AND expires_at <= ?
                AND NOT EXISTS (
                  SELECT 1 FROM sync_locks
                  WHERE lock_key = sync_work_runs.cursor_key AND expires_at > ?
                )
                AND NOT EXISTS (
                  SELECT 1 FROM sync_warning_outbox
                  WHERE work_key = sync_work_runs.work_key AND status = 'pending'
                )
            )
          `).bind(workKey, workKey, now, now),
          this.db.prepare(`
            DELETE FROM sync_work_phases
            WHERE work_key = ? AND EXISTS (
              SELECT 1 FROM sync_work_runs
              WHERE work_key = ? AND lifecycle_status IN ('completed', 'terminal', 'superseded')
                AND expires_at <= ?
                AND NOT EXISTS (
                  SELECT 1 FROM sync_locks
                  WHERE lock_key = sync_work_runs.cursor_key AND expires_at > ?
                )
                AND NOT EXISTS (
                  SELECT 1 FROM sync_warning_outbox
                  WHERE work_key = sync_work_runs.work_key AND status = 'pending'
                )
            )
          `).bind(workKey, workKey, now, now),
          this.db.prepare(`
            DELETE FROM sync_warning_outbox
            WHERE work_key = ? AND status = 'delivered'
          `).bind(workKey),
          this.db.prepare(`
            DELETE FROM sync_work_runs
            WHERE work_key = ?
              AND lifecycle_status IN ('completed', 'terminal', 'superseded')
              AND expires_at <= ?
              AND NOT EXISTS (
                SELECT 1 FROM sync_locks
                WHERE lock_key = sync_work_runs.cursor_key AND expires_at > ?
              )
              AND NOT EXISTS (
                SELECT 1 FROM sync_warning_outbox
                WHERE work_key = sync_work_runs.work_key AND status = 'pending'
              )
          `).bind(workKey, now, now),
        ]);
      }
      return Object.freeze({ deleted: candidates.length });
    } catch (cause) {
      throw d1Error('Failed to clean expired resumable sync work', 'D1_SYNC_WORK_CLEANUP_FAILED', cause);
    }
  }

  /**
   * คืนพื้นที่ staging ก่อนรับ Queue attempt ใหม่ โดยลบเฉพาะ payload ของ Work เก่าที่มี
   * generation ใหม่กว่าครอง cursor แล้วเท่านั้น Work/phase/audit และ Business data ยังอยู่ครบ
   * เพื่อให้ตรวจย้อนหลังได้ และ protected/current/locked/pending-warning Work จะไม่ถูกแตะ
   */
  async cleanupSupersededWorkUnits(input = {}) {
    const now = safeTimestamp(input.now ?? this.now(), 'now');
    const limit = boundedPositiveInteger(input.limit ?? 25, 'limit', 100);
    const protectedWorkKeys = requireUniqueTextList(
      input.protectedWorkKeys ?? [],
      'protectedWorkKeys',
      25,
    );
    const protectedPlaceholders = protectedWorkKeys.map(() => '?').join(', ');
    const protectedFilter = protectedWorkKeys.length > 0
      ? `AND work.work_key NOT IN (${protectedPlaceholders})`
      : '';
    try {
      const result = await this.db.prepare(`
        SELECT work.work_key
        FROM sync_work_runs AS work
        INNER JOIN sync_generation_fences AS fence
          ON fence.cursor_key = work.cursor_key
         AND fence.generation > work.generation
        WHERE work.lifecycle_status IN ('terminal', 'superseded')
          ${protectedFilter}
          AND NOT EXISTS (
            SELECT 1 FROM sync_locks AS lock
            WHERE lock.lock_key = work.cursor_key AND lock.expires_at > ?
          )
          AND NOT EXISTS (
            SELECT 1 FROM sync_warning_outbox AS warning
            WHERE warning.work_key = work.work_key AND warning.status = 'pending'
          )
        ORDER BY work.updated_at ASC
        LIMIT ?
      `).bind(...protectedWorkKeys, now, limit).all();
      const candidates = readRows(result).map((row) => requireText(row.work_key, 'work_key'));
      let deletedUnits = 0;
      for (const workKey of candidates) {
        const deleteResult = await this.db.prepare(`
          DELETE FROM sync_work_units
          WHERE work_key = ?
            AND EXISTS (
              SELECT 1
              FROM sync_work_runs AS work
              INNER JOIN sync_generation_fences AS fence
                ON fence.cursor_key = work.cursor_key
               AND fence.generation > work.generation
              WHERE work.work_key = sync_work_units.work_key
                AND work.lifecycle_status IN ('terminal', 'superseded')
                ${protectedFilter}
                AND NOT EXISTS (
                  SELECT 1 FROM sync_locks AS lock
                  WHERE lock.lock_key = work.cursor_key AND lock.expires_at > ?
                )
                AND NOT EXISTS (
                  SELECT 1 FROM sync_warning_outbox AS warning
                  WHERE warning.work_key = work.work_key AND warning.status = 'pending'
                )
            )
        `).bind(workKey, ...protectedWorkKeys, now).run();
        deletedUnits += readChanges(deleteResult);
      }
      return Object.freeze({ candidates: candidates.length, deletedUnits });
    } catch (cause) {
      throw d1Error(
        'Failed to clean superseded resumable sync work units',
        'D1_SYNC_WORK_SUPERSEDED_UNIT_CLEANUP_FAILED',
        cause,
      );
    }
  }

  async #recordSupersededWork(work, now) {
    await this.db.prepare(`
      INSERT INTO sync_work_runs (
        work_key, cursor_key, work_type, operation_fingerprint, status,
        generation, requested_at, lifecycle_status, terminal_reason,
        abandoned_at, expires_at, audit_reference, created_at, updated_at
      ) VALUES (?, ?, ?, ?, 'active', ?, ?, 'superseded', 'SYNC_WORK_SUPERSEDED', ?, ?, ?, ?, ?)
      ON CONFLICT(work_key) DO UPDATE SET
        lifecycle_status = 'superseded',
        terminal_reason = COALESCE(sync_work_runs.terminal_reason, 'SYNC_WORK_SUPERSEDED'),
        abandoned_at = COALESCE(sync_work_runs.abandoned_at, excluded.abandoned_at),
        expires_at = COALESCE(sync_work_runs.expires_at, excluded.expires_at),
        audit_reference = COALESCE(sync_work_runs.audit_reference, excluded.audit_reference),
        updated_at = excluded.updated_at
    `).bind(
      work.workKey,
      work.cursorKey,
      work.workType,
      work.operationFingerprint,
      work.generation,
      work.requestedAt,
      now,
      now + this.retentionMs,
      `generation:${work.generation}`,
      now,
      now,
    ).run();
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

function requireWork(input, fallbackTimestamp) {
  const requestedAt = safeTimestamp(
    input.requestedAt ?? input.generation ?? fallbackTimestamp,
    'requestedAt',
  );
  return Object.freeze({
    workKey: requireText(input.workKey, 'workKey'),
    cursorKey: requireText(input.cursorKey, 'cursorKey'),
    workType: requireText(input.workType, 'workType'),
    operationFingerprint: requireText(input.operationFingerprint, 'operationFingerprint'),
    generation: safeTimestamp(input.generation ?? requestedAt, 'generation'),
    requestedAt,
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

function requireWarning(input) {
  const generationGuard = input.generationGuard
    ? Object.freeze({
      cursorKey: requireText(input.generationGuard.cursorKey, 'generationGuard.cursorKey'),
      generation: safeTimestamp(input.generationGuard.generation, 'generationGuard.generation'),
      workKey: requireText(input.generationGuard.workKey, 'generationGuard.workKey'),
    })
    : null;
  return Object.freeze({
    outboxId: requireText(input.outboxId, 'outboxId'),
    workKey: requireText(input.workKey, 'workKey'),
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    warningType: requireText(input.warningType, 'warningType'),
    sourceKey: requireText(input.sourceKey, 'sourceKey'),
    payload: requireJsonObject(input.payload ?? {}, 'payload'),
    generationGuard,
  });
}

function parseNullableJsonObject(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return parseJsonObject(value, fieldName);
}
function parseJsonObject(value, fieldName) {
  try {
    return Object.freeze(requireJsonObject(JSON.parse(String(value)), fieldName));
  } catch (cause) {
    if (cause?.code === 'D1_SYNC_WORK_INVALID_JSON') throw cause;
    throw permanentError(`Invalid resumable sync ${fieldName}`, {
      code: 'D1_SYNC_WORK_INVALID_JSON',
      cause,
      details: { fieldName },
    });
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
function readChanges(result) {
  return Number(result?.meta?.changes ?? result?.changes ?? 0);
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`D1ResumableWorkStore requires ${fieldName}`);
  }
  return value.trim();
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
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
function requireUniqueTextList(value, fieldName, maximum) {
  if (!Array.isArray(value) || value.length > maximum) {
    throw new TypeError(`D1ResumableWorkStore ${fieldName} must contain at most ${maximum} entries`);
  }
  const items = value.map((item) => requireText(item, fieldName));
  if (new Set(items).size !== items.length) {
    throw new TypeError(`D1ResumableWorkStore ${fieldName} must not contain duplicates`);
  }
  return items;
}
function d1Error(message, code, cause) {
  return transientError(message, {
    code,
    cause,
    details: {
      causeCode: cause?.code ?? null,
      causeMessage: cause instanceof Error ? cause.message : String(cause),
    },
  });
}
