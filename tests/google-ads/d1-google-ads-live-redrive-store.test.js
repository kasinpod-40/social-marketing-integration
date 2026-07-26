import test from 'node:test';
import assert from 'node:assert/strict';
import { D1GoogleAdsLiveRedriveStore } from '../../packages/connectors/src/google-ads/d1-google-ads-live-redrive-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const GENERATION = Date.parse('2026-07-25T04:00:00.000Z');
const NOW = Date.parse('2026-07-26T04:00:00.000Z');

function createFixture(options = {}) {
  const d1 = createSqliteD1();
  d1.exec(`
    CREATE TABLE sync_work_runs (
      work_key TEXT PRIMARY KEY,
      cursor_key TEXT NOT NULL,
      work_type TEXT NOT NULL,
      generation INTEGER NOT NULL,
      lifecycle_status TEXT NOT NULL,
      terminal_reason TEXT,
      abandoned_at INTEGER,
      completed_at INTEGER,
      expires_at INTEGER,
      audit_reference TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE sync_locks (
      lock_key TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      acquired_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE google_ads_live_admissions (
      run_id TEXT PRIMARY KEY,
      operation_id TEXT NOT NULL,
      work_key TEXT NOT NULL,
      generation INTEGER NOT NULL,
      original_requested_at INTEGER NOT NULL,
      status TEXT NOT NULL,
      send_attempts INTEGER NOT NULL,
      last_error_code TEXT,
      queued_at INTEGER,
      completed_at INTEGER,
      updated_at INTEGER NOT NULL
    );
  `);
  d1.database.prepare(`
    INSERT INTO sync_work_runs (
      work_key, cursor_key, work_type, generation, lifecycle_status,
      terminal_reason, abandoned_at, completed_at, expires_at, audit_reference, updated_at
    ) VALUES (?, 'google_ads:chemistry_k:paid_ads_delivery',
      'google.ads.manager.signed-delivery.process', ?, ?, 'QUEUE_RETRY_EXHAUSTED',
      ?, ?, ?, 'dlq:old', ?)
  `).run(
    `google_ads:${RUN_ID}`,
    GENERATION,
    options.workLifecycleStatus ?? 'terminal',
    NOW - 1_000,
    options.workCompletedAt ?? null,
    NOW + 86_400_000,
    NOW - 1_000,
  );
  d1.database.prepare(`
    INSERT INTO google_ads_live_admissions (
      run_id, operation_id, work_key, generation, original_requested_at,
      status, send_attempts, last_error_code, queued_at, completed_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, 'SYNTHETIC_FAILURE', NULL, ?, ?)
  `).run(
    RUN_ID,
    RUN_ID,
    `google_ads:${RUN_ID}`,
    GENERATION,
    GENERATION,
    options.admissionStatus ?? 'failed_retryable',
    options.admissionCompletedAt ?? null,
    NOW - 1_000,
  );
  if (options.activeLock) {
    d1.database.prepare(`
      INSERT INTO sync_locks (lock_key, owner_id, acquired_at, expires_at, updated_at)
      VALUES ('google_ads:chemistry_k:paid_ads_delivery', 'owner-active', ?, ?, ?)
    `).run(NOW - 100, NOW + 60_000, NOW - 100);
  }
  return {
    d1,
    store: new D1GoogleAdsLiveRedriveStore({ db: d1, now: () => NOW }),
  };
}

function prepareInput() {
  return {
    operationId: RUN_ID,
    workKey: `google_ads:${RUN_ID}`,
    generation: GENERATION,
    originalRequestedAt: GENERATION,
    auditReference: 'redrive:dlq:google-ads:1',
    now: NOW,
  };
}

test('prepare revives terminal same-generation Work and reserves one exact send', async () => {
  const fixture = createFixture();
  try {
    const result = await fixture.store.prepare(prepareInput());
    assert.equal(result.disposition, 'send_pending');
    assert.equal(result.admissionStatus, 'send_pending');
    assert.equal(result.workLifecycleStatus, 'active');
    assert.equal(result.sendAttempts, 2);

    const retry = await fixture.store.prepare(prepareInput());
    assert.equal(retry.disposition, 'send_pending');
    assert.equal(retry.sendAttempts, 2);

    const work = fixture.d1.database.prepare(`
      SELECT lifecycle_status, terminal_reason, abandoned_at, expires_at, audit_reference
      FROM sync_work_runs WHERE work_key = ?
    `).get(`google_ads:${RUN_ID}`);
    assert.deepEqual(work, {
      lifecycle_status: 'active',
      terminal_reason: null,
      abandoned_at: null,
      expires_at: null,
      audit_reference: 'redrive:dlq:google-ads:1',
    });
  } finally {
    fixture.d1.close();
  }
});

test('markQueued is idempotent and prevents another Queue send preparation', async () => {
  const fixture = createFixture();
  try {
    await fixture.store.prepare(prepareInput());
    const queued = await fixture.store.markQueued({ operationId: RUN_ID, now: NOW + 1 });
    assert.equal(queued.disposition, 'queued');
    assert.equal(queued.admissionStatus, 'queued');

    const retry = await fixture.store.prepare({ ...prepareInput(), now: NOW + 2 });
    assert.equal(retry.disposition, 'already_queued');
    assert.equal(retry.sendAttempts, 2);
  } finally {
    fixture.d1.close();
  }
});

test('active lock, superseded Work and completed evidence fail closed', async () => {
  const locked = createFixture({ activeLock: true });
  try {
    await assert.rejects(
      () => locked.store.prepare(prepareInput()),
      (error) => error.code === 'GOOGLE_ADS_REDRIVE_STATE_INVALID',
    );
  } finally {
    locked.d1.close();
  }

  const superseded = createFixture({ workLifecycleStatus: 'superseded' });
  try {
    await assert.rejects(
      () => superseded.store.prepare(prepareInput()),
      (error) => error.code === 'GOOGLE_ADS_REDRIVE_WORK_SUPERSEDED',
    );
  } finally {
    superseded.d1.close();
  }

  const completed = createFixture({
    workLifecycleStatus: 'completed',
    workCompletedAt: NOW - 2_000,
    admissionStatus: 'completed',
    admissionCompletedAt: NOW - 2_000,
  });
  try {
    const result = await completed.store.prepare(prepareInput());
    assert.equal(result.disposition, 'completed');
    assert.equal(result.sendAttempts, 1);
  } finally {
    completed.d1.close();
  }
});

test('generation or work-key drift is rejected before D1 mutation', async () => {
  const fixture = createFixture();
  try {
    await assert.rejects(
      () => fixture.store.prepare({ ...prepareInput(), generation: GENERATION + 1 }),
      (error) => error.code === 'GOOGLE_ADS_REDRIVE_IDENTITY_MISMATCH',
    );
    assert.equal(
      fixture.d1.database.prepare(
        'SELECT lifecycle_status FROM sync_work_runs WHERE work_key = ?',
      ).get(`google_ads:${RUN_ID}`).lifecycle_status,
      'terminal',
    );
  } finally {
    fixture.d1.close();
  }
});
