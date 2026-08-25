import test from 'node:test';
import assert from 'node:assert/strict';
import { D1QueueOperationStore } from '../../packages/reliability/src/d1-queue-operation-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const NOW = Date.parse('2026-08-25T10:00:00.000Z');
const GENERATION = Date.parse('2026-08-25T00:40:22.000Z');
const DLQ_ID = 'dlq:auto-recovery-store';
const OPERATION_ID = 'meta-ads-chemistry-k3-scheduled-20260825';
const WORK_KEY = `meta_ads:chemistry_k3:${OPERATION_ID}`;
const RECOVERY_REFERENCE = `auto-recovery:${DLQ_ID}`;

test('D1 Queue auto-recovery revives exact checkpoint and closes evidence only on completion', async () => {
  const d1 = createSqliteD1();
  createSchema(d1);
  seedIncident(d1);
  const store = new D1QueueOperationStore({ db: d1, now: () => NOW });
  try {
    const authorized = await store.authorizeSafeAutoRecovery(identity());
    assert.equal(authorized.disposition, 'authorized');
    assert.equal(authorized.sendRequired, true);
    assert.equal(authorized.delaySeconds, 120);
    assert.equal(
      d1.database.prepare('SELECT lifecycle_status FROM sync_work_runs WHERE work_key=?')
        .get(WORK_KEY).lifecycle_status,
      'active',
    );
    assert.equal(
      d1.database.prepare('SELECT recovery_status FROM dead_letter_operation_metadata WHERE dlq_id=?')
        .get(DLQ_ID).recovery_status,
      'in_progress',
    );

    await store.markSafeAutoRecoveryQueued(identity());
    assert.equal(
      d1.database.prepare('SELECT status FROM dead_letter_jobs WHERE dlq_id=?')
        .get(DLQ_ID).status,
      'redrive_pending',
    );

    d1.database.prepare(`
      UPDATE sync_work_runs SET lifecycle_status='completed', completed_at=? WHERE work_key=?
    `).run(NOW + 1, WORK_KEY);
    const completed = await store.completeSafeAutoRecoveriesForWork({
      workKey: WORK_KEY,
      generation: GENERATION,
      now: NOW + 2,
    });
    assert.deepEqual(completed, { completed: true, incidents: 1 });
    assert.equal(
      d1.database.prepare('SELECT recovery_status FROM dead_letter_operation_metadata WHERE dlq_id=?')
        .get(DLQ_ID).recovery_status,
      'completed',
    );
    assert.equal(
      d1.database.prepare('SELECT status FROM dead_letter_jobs WHERE dlq_id=?')
        .get(DLQ_ID).status,
      'redriven',
    );
    assert.equal(
      d1.database.prepare('SELECT status FROM system_alerts WHERE alert_id=?')
        .get(`alert:${DLQ_ID}`).status,
      'resolved',
    );
  } finally {
    d1.close();
  }
});

test('D1 Queue auto-recovery is idempotent across a send/mark retry and respects active lock', async () => {
  const d1 = createSqliteD1();
  createSchema(d1);
  seedIncident(d1, { lockExpiresAt: NOW + 300_000 });
  const store = new D1QueueOperationStore({ db: d1, now: () => NOW });
  try {
    const first = await store.authorizeSafeAutoRecovery(identity());
    const repeated = await store.authorizeSafeAutoRecovery(identity());
    assert.equal(first.sendRequired, true);
    assert.equal(first.delaySeconds, 305);
    assert.equal(repeated.sendRequired, true);
    assert.equal(repeated.delaySeconds, 305);
  } finally {
    d1.close();
  }
});

test('D1 Queue auto-recovery never revives permanent work or exceeds per-work budget', async () => {
  for (const scenario of ['permanent', 'budget']) {
    const d1 = createSqliteD1();
    createSchema(d1);
    seedIncident(d1, { terminalReason: scenario === 'permanent'
      ? 'QUEUE_PERMANENT_FAILURE'
      : 'QUEUE_RETRY_EXHAUSTED' });
    if (scenario === 'budget') seedPriorRecoveries(d1, 5);
    const store = new D1QueueOperationStore({ db: d1, now: () => NOW });
    try {
      if (scenario === 'permanent') {
        await assert.rejects(
          () => store.authorizeSafeAutoRecovery(identity()),
          (error) => error.code === 'QUEUE_AUTO_RECOVERY_WORK_STATE_INVALID',
        );
      } else {
        const result = await store.authorizeSafeAutoRecovery(identity());
        assert.equal(result.disposition, 'recovery_budget_exhausted');
        assert.equal(result.sendRequired, false);
      }
      assert.equal(
        d1.database.prepare('SELECT lifecycle_status FROM sync_work_runs WHERE work_key=?')
          .get(WORK_KEY).lifecycle_status,
        'terminal',
      );
    } finally {
      d1.close();
    }
  }
});

function identity() {
  return {
    dlqId: DLQ_ID,
    operationId: OPERATION_ID,
    workKey: WORK_KEY,
    generation: GENERATION,
    originalRequestedAt: GENERATION,
    jobType: 'meta.ads.sync',
    recoveryReference: RECOVERY_REFERENCE,
    maxRecoveries: 5,
    cooldownSeconds: 120,
  };
}

function createSchema(d1) {
  d1.exec(`
    CREATE TABLE dead_letter_jobs (
      dlq_id TEXT PRIMARY KEY, message_id TEXT, queue_name TEXT, job_type TEXT,
      schema_version INTEGER, payload_json TEXT NOT NULL DEFAULT '{}', replay_payload_json TEXT,
      error_code TEXT, error_message TEXT, retry_count INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
      redrive_requested_at INTEGER, redrive_reference TEXT, redriven_at INTEGER
    );
    CREATE TABLE dead_letter_operation_metadata (
      dlq_id TEXT PRIMARY KEY, operation_id TEXT, original_work_key TEXT, generation INTEGER,
      original_requested_at INTEGER, main_queue_attempts INTEGER NOT NULL DEFAULT 0,
      dlq_delivery_attempts INTEGER NOT NULL DEFAULT 0, recovery_status TEXT,
      recovery_reference TEXT, recovery_started_at INTEGER, recovery_completed_at INTEGER,
      audit_reference TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE sync_work_runs (
      work_key TEXT PRIMARY KEY, cursor_key TEXT NOT NULL, generation INTEGER NOT NULL,
      requested_at INTEGER NOT NULL, lifecycle_status TEXT NOT NULL, terminal_reason TEXT,
      abandoned_at INTEGER, completed_at INTEGER, expires_at INTEGER, audit_reference TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE sync_locks (
      lock_key TEXT PRIMARY KEY, owner_id TEXT NOT NULL, acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE system_alerts (
      alert_id TEXT PRIMARY KEY, status TEXT NOT NULL, updated_at INTEGER NOT NULL
    );
  `);
}

function seedIncident(d1, input = {}) {
  const terminalReason = input.terminalReason ?? 'QUEUE_RETRY_EXHAUSTED';
  d1.database.prepare(`
    INSERT INTO dead_letter_jobs (
      dlq_id,message_id,queue_name,job_type,schema_version,error_code,status,created_at,updated_at
    ) VALUES (?, 'message', 'social-mkt-sync-dlq', 'meta.ads.sync', 1,
      'QUEUE_RETRY_EXHAUSTED', 'open', ?, ?)
  `).run(DLQ_ID, NOW - 1_000, NOW - 1_000);
  d1.database.prepare(`
    INSERT INTO dead_letter_operation_metadata (
      dlq_id,operation_id,original_work_key,generation,original_requested_at,
      recovery_status,created_at,updated_at
    ) VALUES (?,?,?,?,?,'not_started',?,?)
  `).run(DLQ_ID, OPERATION_ID, WORK_KEY, GENERATION, GENERATION, NOW - 1_000, NOW - 1_000);
  d1.database.prepare(`
    INSERT INTO sync_work_runs (
      work_key,cursor_key,generation,requested_at,lifecycle_status,terminal_reason,
      abandoned_at,expires_at,audit_reference,updated_at
    ) VALUES (?, 'meta:cursor', ?, ?, 'terminal', ?, ?, ?, ?, ?)
  `).run(WORK_KEY, GENERATION, GENERATION, terminalReason, NOW - 1_000, NOW + 86_400_000, DLQ_ID, NOW - 1_000);
  d1.database.prepare('INSERT INTO system_alerts (alert_id,status,updated_at) VALUES (?,\'open\',?)')
    .run(`alert:${DLQ_ID}`, NOW - 1_000);
  if (input.lockExpiresAt) {
    d1.database.prepare(`
      INSERT INTO sync_locks (lock_key,owner_id,acquired_at,expires_at,updated_at)
      VALUES ('meta:cursor','owner',?,?,?)
    `).run(NOW - 100, input.lockExpiresAt, NOW - 100);
  }
}

function seedPriorRecoveries(d1, count) {
  for (let index = 0; index < count; index += 1) {
    const dlqId = `dlq:prior-${index}`;
    d1.database.prepare(`
      INSERT INTO dead_letter_operation_metadata (
        dlq_id,operation_id,original_work_key,generation,original_requested_at,
        recovery_status,recovery_reference,recovery_started_at,created_at,updated_at
      ) VALUES (?,?,?,?,?,'completed',?,?,?,?)
    `).run(
      dlqId,
      OPERATION_ID,
      WORK_KEY,
      GENERATION,
      GENERATION,
      `auto-recovery:${dlqId}`,
      NOW - ((index + 1) * 1_000),
      NOW - ((index + 1) * 1_000),
      NOW - ((index + 1) * 1_000),
    );
  }
}
