import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  D1QueueOperationStore,
  TIKTOK_BOOTSTRAP_INCIDENT,
} from '../../packages/reliability/src/d1-queue-operation-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL('../../migrations/0010_tiktok_bootstrap_durable_recovery.sql', import.meta.url);
const NOW = Date.parse('2026-07-24T02:00:00.000Z');
const CURSOR_KEY = 'tiktok:chemistry_k:lark_native_tiktok_for_creator:organic_history_bootstrap';

test('exact incident recovery requires expired lock and checkpoint nextSequence=2', async () => {
  const raw = createSqliteD1();
  const db = withBatch(raw);
  createOperationalSchema(raw);
  raw.exec(await readFile(MIGRATION_URL, 'utf8'));
  seedIncident(raw, { lockExpiresAt: NOW - 1, nextSequence: 2 });
  const store = new D1QueueOperationStore({ db, now: () => NOW });

  try {
    const authorization = await store.authorizeTikTokBootstrapIncidentRecovery({
      ...incidentIdentity(),
      recoveryReference: 'recovery:exact-incident',
    });
    assert.equal(authorization.status, 'authorized');
    assert.equal(authorization.nextSequence, 2);
    assert.equal(authorization.firstAuthorization, true);

    raw.database.prepare(`
      UPDATE sync_work_runs
      SET lifecycle_status = 'completed', completed_at = ?
      WHERE work_key = ?
    `).run(NOW + 1, TIKTOK_BOOTSTRAP_INCIDENT.workKey);
    const completed = await store.markTikTokBootstrapIncidentRecovered({
      ...incidentIdentity(),
      auditReference: 'recovery:exact-incident',
      completedAt: NOW + 1,
    });
    assert.equal(completed.status, 'completed');

    const dlq = raw.database.prepare(`
      SELECT status, redrive_reference, redriven_at
      FROM dead_letter_jobs WHERE dlq_id = ?
    `).get(TIKTOK_BOOTSTRAP_INCIDENT.dlqId);
    assert.equal(dlq.status, 'redriven');
    assert.equal(dlq.redrive_reference, 'recovery:exact-incident');
    assert.equal(dlq.redriven_at, NOW + 1);

    const metadata = raw.database.prepare(`
      SELECT recovery_status, original_work_key, operation_id, audit_reference
      FROM dead_letter_operation_metadata WHERE dlq_id = ?
    `).get(TIKTOK_BOOTSTRAP_INCIDENT.dlqId);
    assert.equal(metadata.recovery_status, 'completed');
    assert.equal(metadata.original_work_key, TIKTOK_BOOTSTRAP_INCIDENT.workKey);
    assert.equal(metadata.operation_id, TIKTOK_BOOTSTRAP_INCIDENT.operationId);
    assert.equal(metadata.audit_reference, 'recovery:exact-incident');
    assert.equal(
      raw.database.prepare('SELECT count(*) AS total FROM dead_letter_jobs').get().total,
      1,
    );
  } finally {
    raw.close();
  }
});

test('incident recovery rejects an active lock, checkpoint drift and identity drift', async () => {
  for (const scenario of [
    { lockExpiresAt: NOW + 600_000, nextSequence: 2, code: 'SYNC_LOCK_BUSY' },
    { lockExpiresAt: NOW - 1, nextSequence: 3, code: 'TIKTOK_BOOTSTRAP_RECOVERY_CHECKPOINT_MISMATCH' },
  ]) {
    const raw = createSqliteD1();
    const db = withBatch(raw);
    createOperationalSchema(raw);
    raw.exec(await readFile(MIGRATION_URL, 'utf8'));
    seedIncident(raw, scenario);
    const store = new D1QueueOperationStore({ db, now: () => NOW });
    try {
      await assert.rejects(
        () => store.authorizeTikTokBootstrapIncidentRecovery({
          ...incidentIdentity(),
          recoveryReference: 'recovery:exact-incident',
        }),
        (error) => error.code === scenario.code,
      );
    } finally {
      raw.close();
    }
  }

  const raw = createSqliteD1();
  const db = withBatch(raw);
  createOperationalSchema(raw);
  raw.exec(await readFile(MIGRATION_URL, 'utf8'));
  seedIncident(raw, { lockExpiresAt: NOW - 1, nextSequence: 2 });
  const store = new D1QueueOperationStore({ db, now: () => NOW });
  try {
    await assert.rejects(
      () => store.authorizeTikTokBootstrapIncidentRecovery({
        ...incidentIdentity(),
        operationId: 'wrong-operation',
      }),
      (error) => error.code === 'TIKTOK_BOOTSTRAP_RECOVERY_IDENTITY_MISMATCH',
    );
  } finally {
    raw.close();
  }
});

function createOperationalSchema(d1) {
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
      completed_at INTEGER
    );
    CREATE TABLE sync_work_phases (
      work_key TEXT NOT NULL,
      phase TEXT NOT NULL,
      state_json TEXT NOT NULL,
      complete INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (work_key, phase)
    );
    CREATE TABLE sync_locks (
      lock_key TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);
}

function seedIncident(d1, input) {
  d1.database.prepare(`
    INSERT INTO dead_letter_jobs (
      dlq_id, message_id, queue_name, job_type, schema_version,
      payload_json, error_code, retry_count, status, created_at, updated_at
    ) VALUES (?, ?, 'social-mkt-sync-dlq', 'tiktok.creator.native.history.bootstrap', 1,
      '{}', 'QUEUE_RETRY_EXHAUSTED', 5, 'open', ?, ?)
  `).run(
    TIKTOK_BOOTSTRAP_INCIDENT.dlqId,
    TIKTOK_BOOTSTRAP_INCIDENT.messageId,
    NOW - 10_000,
    NOW - 10_000,
  );
  d1.database.prepare(`
    INSERT INTO sync_work_runs (
      work_key, cursor_key, generation, requested_at, lifecycle_status
    ) VALUES (?, ?, ?, ?, 'active')
  `).run(
    TIKTOK_BOOTSTRAP_INCIDENT.workKey,
    CURSOR_KEY,
    TIKTOK_BOOTSTRAP_INCIDENT.generation,
    TIKTOK_BOOTSTRAP_INCIDENT.originalRequestedAt,
  );
  d1.database.prepare(`
    INSERT INTO sync_work_phases (work_key, phase, state_json, complete)
    VALUES (?, ?, ?, 0)
  `).run(
    TIKTOK_BOOTSTRAP_INCIDENT.workKey,
    TIKTOK_BOOTSTRAP_INCIDENT.phase,
    JSON.stringify({
      nextSequence: input.nextSequence,
      unitsCompleted: 2,
      rawRecordsCompleted: 1000,
      contentRowsDurable: 1000,
      observationRowsDurable: 1000,
      coverageEntitiesWritten: 1000,
    }),
  );
  d1.database.prepare(`
    INSERT INTO sync_locks (lock_key, owner_id, acquired_at, expires_at, updated_at)
    VALUES (?, 'old-owner', ?, ?, ?)
  `).run(CURSOR_KEY, NOW - 700_000, input.lockExpiresAt, NOW - 700_000);
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
