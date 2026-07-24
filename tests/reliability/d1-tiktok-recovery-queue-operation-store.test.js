import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  D1QueueOperationStore,
  TIKTOK_BOOTSTRAP_INCIDENT,
} from '../../packages/reliability/src/d1-tiktok-recovery-queue-operation-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL('../../migrations/0010_tiktok_bootstrap_durable_recovery.sql', import.meta.url);
const NOW = Date.parse('2026-07-24T06:50:00.000Z');
const COVERAGE_RUN_ID = 'coverage:tiktok:d398495edc3b070b815f99559ecce1a2f24f4c9ac4e0335810e287636fc2f2e0';
const RECOVERY_REFERENCE = `recovery:${TIKTOK_BOOTSTRAP_INCIDENT.dlqId}:${TIKTOK_BOOTSTRAP_INCIDENT.workKey}`;

test('completed TikTok recovery closes the original DLQ after completeWork cleared phase rows', async () => {
  const raw = createSqliteD1();
  const db = withBatch(raw);
  createSchema(raw);
  raw.exec(await readFile(MIGRATION_URL, 'utf8'));
  seedCompletedIncident(raw, exactCompletion());
  const store = new D1QueueOperationStore({ db, now: () => NOW });

  try {
    const result = await store.markTikTokBootstrapIncidentRecovered({
      ...incidentIdentity(),
      auditReference: RECOVERY_REFERENCE,
      completedAt: NOW,
    });
    assert.equal(result.status, 'completed');
    assert.equal(result.proofSource, 'completion_json_after_phase_cleanup');
    assert.equal(result.coverageRunId, COVERAGE_RUN_ID);

    const dlq = raw.database.prepare(`
      SELECT status, redrive_reference, redriven_at
      FROM dead_letter_jobs
      WHERE dlq_id = ?
    `).get(TIKTOK_BOOTSTRAP_INCIDENT.dlqId);
    assert.deepEqual(dlq, {
      status: 'redriven',
      redrive_reference: RECOVERY_REFERENCE,
      redriven_at: NOW,
    });

    const metadata = raw.database.prepare(`
      SELECT recovery_status, recovery_reference, audit_reference, recovery_completed_at
      FROM dead_letter_operation_metadata
      WHERE dlq_id = ?
    `).get(TIKTOK_BOOTSTRAP_INCIDENT.dlqId);
    assert.deepEqual(metadata, {
      recovery_status: 'completed',
      recovery_reference: RECOVERY_REFERENCE,
      audit_reference: RECOVERY_REFERENCE,
      recovery_completed_at: NOW,
    });
    assert.equal(
      raw.database.prepare('SELECT COUNT(*) AS total FROM sync_work_phases').get().total,
      0,
    );
  } finally {
    raw.close();
  }
});

test('cleared-phase recovery rejects completion_json durable counter drift', async () => {
  const raw = createSqliteD1();
  const db = withBatch(raw);
  createSchema(raw);
  raw.exec(await readFile(MIGRATION_URL, 'utf8'));
  const completion = exactCompletion();
  completion.d1.contentRowsDurable -= 1;
  seedCompletedIncident(raw, completion);
  const store = new D1QueueOperationStore({ db, now: () => NOW });

  try {
    await assert.rejects(
      () => store.markTikTokBootstrapIncidentRecovered({
        ...incidentIdentity(),
        auditReference: RECOVERY_REFERENCE,
        completedAt: NOW,
      }),
      (error) => error.code === 'TIKTOK_BOOTSTRAP_RECOVERY_COMPLETION_INCOMPLETE',
    );
    assert.equal(
      raw.database.prepare('SELECT status FROM dead_letter_jobs WHERE dlq_id = ?')
        .get(TIKTOK_BOOTSTRAP_INCIDENT.dlqId).status,
      'open',
    );
  } finally {
    raw.close();
  }
});

function createSchema(d1) {
  d1.exec(`
    CREATE TABLE dead_letter_jobs (
      dlq_id TEXT PRIMARY KEY,
      message_id TEXT,
      queue_name TEXT,
      job_type TEXT,
      schema_version INTEGER,
      payload_json TEXT NOT NULL DEFAULT '{}',
      replay_payload_json TEXT,
      error_code TEXT,
      error_message TEXT,
      retry_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      redrive_requested_at INTEGER,
      redrive_reference TEXT,
      redriven_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE sync_work_runs (
      work_key TEXT PRIMARY KEY,
      cursor_key TEXT NOT NULL,
      generation INTEGER NOT NULL,
      requested_at INTEGER NOT NULL,
      lifecycle_status TEXT NOT NULL,
      completion_json TEXT,
      completed_at INTEGER
    );
    CREATE TABLE sync_work_phases (
      work_key TEXT NOT NULL,
      phase TEXT NOT NULL,
      state_json TEXT NOT NULL,
      complete INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (work_key, phase)
    );
    CREATE TABLE data_coverage_runs (
      coverage_run_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      expected_entities INTEGER,
      observed_entities INTEGER,
      expected_rows INTEGER,
      observed_rows INTEGER,
      failed_rows INTEGER NOT NULL DEFAULT 0,
      completed_at INTEGER
    );
  `);
}

function seedCompletedIncident(d1, completion) {
  d1.database.prepare(`
    INSERT INTO dead_letter_jobs (
      dlq_id, message_id, queue_name, job_type, schema_version,
      payload_json, error_code, retry_count, status, created_at, updated_at
    ) VALUES (?, ?, 'social-mkt-sync-dlq', 'tiktok.creator.native.history.bootstrap', 1,
      '{}', 'QUEUE_RETRY_EXHAUSTED', 1, 'open', ?, ?)
  `).run(
    TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
    TIKTOK_BOOTSTRAP_INCIDENT.messageId,
    NOW - 10_000,
    NOW - 10_000,
  );
  d1.database.prepare(`
    INSERT INTO sync_work_runs (
      work_key, cursor_key, generation, requested_at,
      lifecycle_status, completion_json, completed_at
    ) VALUES (?, 'integration_workspace:tiktok:chemistry_k:organic_history_bootstrap', ?, ?,
      'completed', ?, ?)
  `).run(
    TIKTOK_BOOTSTRAP_INCIDENT.workKey,
    TIKTOK_BOOTSTRAP_INCIDENT.generation,
    TIKTOK_BOOTSTRAP_INCIDENT.originalRequestedAt,
    JSON.stringify(completion),
    NOW - 1,
  );
  d1.database.prepare(`
    INSERT INTO dead_letter_operation_metadata (
      dlq_id, operation_id, original_work_key, generation, original_requested_at,
      main_queue_attempts, dlq_delivery_attempts, recovery_status,
      recovery_reference, recovery_started_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, 9, 0, 'in_progress', ?, ?, ?, ?)
  `).run(
    TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
    TIKTOK_BOOTSTRAP_INCIDENT.operationId,
    TIKTOK_BOOTSTRAP_INCIDENT.workKey,
    TIKTOK_BOOTSTRAP_INCIDENT.generation,
    TIKTOK_BOOTSTRAP_INCIDENT.originalRequestedAt,
    RECOVERY_REFERENCE,
    NOW - 5_000,
    NOW - 5_000,
    NOW - 5_000,
  );
  d1.database.prepare(`
    INSERT INTO data_coverage_runs (
      coverage_run_id, status, expected_entities, observed_entities,
      expected_rows, observed_rows, failed_rows, completed_at
    ) VALUES (?, 'complete', ?, ?, ?, ?, 0, ?)
  `).run(
    COVERAGE_RUN_ID,
    TIKTOK_BOOTSTRAP_INCIDENT.expectedRows,
    TIKTOK_BOOTSTRAP_INCIDENT.expectedRows,
    TIKTOK_BOOTSTRAP_INCIDENT.expectedRows,
    TIKTOK_BOOTSTRAP_INCIDENT.expectedRows,
    NOW - 2,
  );
}

function exactCompletion() {
  const expected = TIKTOK_BOOTSTRAP_INCIDENT.expectedRows;
  return {
    mode: 'd1_only',
    destinationMode: 'd1_only',
    dryRun: false,
    rawRecords: expected,
    continuationRequired: false,
    nextSequence: 5,
    sourcePagination: {
      durable: true,
      complete: true,
      records: expected,
    },
    d1: {
      coverageRunId: COVERAGE_RUN_ID,
      coverageStatus: 'complete',
      plannedStateRows: expected,
      plannedObservationRows: expected,
      contentRowsDurable: expected,
      observationRowsDurable: expected,
      coverageEntitiesWritten: expected,
    },
    lark: {
      contentWrites: 0,
      dailyWrites: 0,
      blocked: true,
    },
    reconciliation: {
      expectedEntities: expected,
      observedEntities: expected,
      expectedRows: expected,
      observedRows: expected,
      failedRows: 0,
      skippedRows: 0,
      duplicateRows: 0,
      status: 'complete',
    },
    resumableWork: {
      generation: TIKTOK_BOOTSTRAP_INCIDENT.generation,
      complete: true,
    },
  };
}

function incidentIdentity() {
  return Object.freeze({
    dlqId: TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
    operationId: TIKTOK_BOOTSTRAP_INCIDENT.operationId,
    workKey: TIKTOK_BOOTSTRAP_INCIDENT.workKey,
    generation: TIKTOK_BOOTSTRAP_INCIDENT.generation,
    originalRequestedAt: TIKTOK_BOOTSTRAP_INCIDENT.originalRequestedAt,
  });
}

function withBatch(d1) {
  return Object.freeze({
    ...d1,
    async batch(statements) {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      return results;
    },
  });
}
