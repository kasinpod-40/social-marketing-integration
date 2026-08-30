import test from 'node:test';
import assert from 'node:assert/strict';
import { D1ResumableWorkStore } from '../../packages/sync-engine/src/d1-resumable-work-store.js';

test('begins new work and resumes only when the operation fingerprint matches', async () => {
  const db = createFakeD1({
    firstRows: [
      null,
      { operation_fingerprint: 'fingerprint-A', generation: 100, lifecycle_status: 'active' },
    ],
  });
  const store = new D1ResumableWorkStore({ db, now: () => 100 });
  const input = {
    workKey: 'message-1',
    cursorKey: 'profile:youtube:account:organic_sync',
    workType: 'youtube_organic_sync',
    operationFingerprint: 'fingerprint-A',
  };

  const first = await store.beginWork(input);
  const resumed = await store.beginWork(input);

  assert.equal(first.resumed, false);
  assert.equal(resumed.resumed, true);
  assert.equal(db.batches.length, 0);
  assert.equal(db.prepared.filter((statement) => /INSERT INTO sync_work_runs/u.test(statement.sql)).length, 2);
});

test('fails closed when the same generation changes its operation fingerprint', async () => {
  const db = createFakeD1({
    firstRows: [{ operation_fingerprint: 'old-fingerprint' }],
  });
  const store = new D1ResumableWorkStore({ db, now: () => 100 });

  await assert.rejects(
    store.beginWork({
      workKey: 'message-1',
      cursorKey: 'cursor-1',
      workType: 'youtube_organic_sync',
      operationFingerprint: 'new-fingerprint',
    }),
    (error) => error?.code === 'SYNC_WORK_OPERATION_MISMATCH'
      && error.retryable === false,
  );
  assert.equal(db.batches.length, 0);
});

test('saves a unit and phase progress atomically and reads typed progress', async () => {
  const db = createFakeD1({
    firstRows: [{
      state_json: '{"chunkIndex":1}',
      expected_items: 837,
      processed_items: 50,
      pages_processed: 1,
      chunks_processed: 1,
      complete: 0,
      created_at: 100,
      updated_at: 110,
    }],
  });
  const store = new D1ResumableWorkStore({ db, now: () => 110 });

  const saved = await store.savePhase({
    workKey: 'message-1',
    phase: 'youtube_owner_analytics',
    state: { chunkIndex: 1 },
    expectedItems: 837,
    processedItems: 50,
    pagesProcessed: 1,
    chunksProcessed: 1,
    complete: false,
    unit: {
      unitKey: 'chunk:0:start:1',
      sequence: 0,
      payload: { rows: [], queriedVideoIds: ['video-1'] },
    },
  });
  const progress = await store.loadPhase({
    workKey: 'message-1',
    phase: 'youtube_owner_analytics',
  });

  assert.equal(db.batches[0].length, 3);
  assert.match(db.batches[0][0].sql, /INSERT INTO sync_work_units/);
  assert.match(db.batches[0][1].sql, /INSERT INTO sync_work_phases/);
  assert.match(db.batches[0][2].sql, /UPDATE sync_work_runs/);
  assert.deepEqual(saved, {
    state: { chunkIndex: 1 },
    expectedItems: 837,
    processedItems: 50,
    pagesProcessed: 1,
    chunksProcessed: 1,
    complete: false,
    createdAt: 110,
    updatedAt: 110,
  });
  assert.deepEqual(progress, {
    state: { chunkIndex: 1 },
    expectedItems: 837,
    processedItems: 50,
    pagesProcessed: 1,
    chunksProcessed: 1,
    complete: false,
    createdAt: 100,
    updatedAt: 110,
  });
});

test('pages staged units by sequence and clears phase/work in bounded batches', async () => {
  const db = createFakeD1({
    allRows: [[
      { unit_key: 'page:1', sequence: 0, payload_json: '{"videoIds":["v1"]}' },
      { unit_key: 'page:2', sequence: 1, payload_json: '{"videoIds":["v2"]}' },
    ]],
  });
  const store = new D1ResumableWorkStore({ db });

  const page = await store.listPhaseUnits({
    workKey: 'message-1',
    phase: 'youtube_content_inventory',
    afterSequence: 0,
    limit: 2,
  });
  await store.resetPhase({ workKey: 'message-1', phase: 'youtube_content_inventory' });
  await store.completeWork('message-1');

  assert.deepEqual(page.units.map((unit) => unit.payload.videoIds[0]), ['v1', 'v2']);
  assert.equal(page.nextSequence, 2);
  assert.equal(db.batches[0].length, 2);
  assert.equal(db.batches[1].length, 3);
});

test('D1 resumable work failures stay retryable', async () => {
  const store = new D1ResumableWorkStore({
    db: createFakeD1({ runError: new Error('D1 unavailable') }),
  });

  await assert.rejects(
    store.beginWork({
      workKey: 'message-1',
      cursorKey: 'cursor-1',
      workType: 'youtube_organic_sync',
      operationFingerprint: 'fingerprint',
    }),
    (error) => error?.code === 'D1_SYNC_WORK_BEGIN_FAILED'
      && error.retryable === true
      && error.details.causeMessage === 'D1 unavailable',
  );
});

test('generation fence supersedes older work and keeps completed generation durable', async () => {
  const db = createFakeD1({
    runChanges: [1, 1, 0, 1],
    firstRows: [null, null],
  });
  const store = new D1ResumableWorkStore({ db, now: () => 3_000 });

  const newer = await store.beginWork({
    workKey: 'message-new',
    cursorKey: 'cursor-1',
    workType: 'youtube_organic_sync',
    operationFingerprint: 'fingerprint-new',
    generation: 2_000,
    requestedAt: 2_000,
  });
  await store.completeWork({
    workKey: 'message-new',
    completion: { mode: 'write', warnings: [] },
  });
  const stale = await store.beginWork({
    workKey: 'message-old',
    cursorKey: 'cursor-1',
    workType: 'youtube_organic_sync',
    operationFingerprint: 'fingerprint-old',
    generation: 1_000,
    requestedAt: 1_000,
  });

  assert.equal(newer.superseded, false);
  assert.equal(stale.superseded, true);
  assert.ok(db.prepared.some((statement) => /sync_generation_fences/u.test(statement.sql)));
  assert.ok(db.prepared.some((statement) => /lifecycle_status = 'completed'/u.test(statement.sql)));
});

test('completed work replays before generation claim even after a newer fence exists', async () => {
  const completion = { mode: 'write', warnings: [{ code: 'WARN' }] };
  const db = createFakeD1({
    firstRows: [{
      operation_fingerprint: 'fingerprint-old',
      generation: 1_000,
      lifecycle_status: 'completed',
      completion_json: JSON.stringify(completion),
    }],
  });
  const store = new D1ResumableWorkStore({ db, now: () => 3_000 });

  const replay = await store.beginWork({
    workKey: 'message-old',
    cursorKey: 'cursor-1',
    workType: 'youtube_organic_sync',
    operationFingerprint: 'fingerprint-old',
    generation: 1_000,
    requestedAt: 1_000,
  });

  assert.equal(replay.completed, true);
  assert.deepEqual(replay.completion, completion);
  assert.equal(db.prepared.some((statement) => /INSERT INTO sync_generation_fences/u.test(statement.sql)), false);
});

test('global warning listing is bounded and delivery failures are recorded durably', async () => {
  const db = createFakeD1({
    allRows: [[{
      outbox_id: 'warning-1',
      work_key: 'work-1',
      sync_run_id: 'run-1',
      warning_type: 'sync_completed_with_warnings',
      source_key: 'cursor-1',
      payload_json: '{"warnings":[]}',
      status: 'pending',
      delivery_attempts: 0,
      delivered_at: null,
    }]],
  });
  const store = new D1ResumableWorkStore({ db, now: () => 5_000 });

  const warnings = await store.listPendingWarnings({ limit: 25 });
  await store.markWarningDeliveryFailed({
    outboxId: 'warning-1',
    errorCode: 'D1_SYSTEM_ALERT_WRITE_FAILED',
  });

  assert.equal(warnings.length, 1);
  const listStatement = db.prepared.find((statement) => /FROM sync_warning_outbox/u.test(statement.sql));
  assert.doesNotMatch(listStatement.sql, /work_key = \?/u);
  assert.deepEqual(listStatement.bindings, [25]);
  const failureStatement = db.prepared.find((statement) => /last_error_code = \?/u.test(statement.sql));
  assert.deepEqual(failureStatement.bindings, ['D1_SYSTEM_ALERT_WRITE_FAILED', 5_000, 'warning-1']);
});

test('terminal lifecycle is idempotent and TTL cleanup excludes active or locked work', async () => {
  const db = createFakeD1({
    runChanges: [1, 1, 0, 0],
    allRows: [[
      { work_key: 'terminal-expired' },
    ], []],
  });
  const store = new D1ResumableWorkStore({ db, now: () => 10_000 });

  const first = await store.abandonWork({
    workKey: 'terminal-expired',
    reason: 'QUEUE_RETRY_EXHAUSTED',
    auditReference: 'dlq:message-1',
  });
  const repeated = await store.abandonWork({
    workKey: 'terminal-expired',
    reason: 'QUEUE_RETRY_EXHAUSTED',
    auditReference: 'dlq:message-1',
  });
  const cleaned = await store.cleanupExpiredWork({ limit: 25 });
  const cleanedAgain = await store.cleanupExpiredWork({ limit: 25 });

  assert.equal(first.terminal, true);
  assert.equal(repeated.terminal, true);
  assert.equal(cleaned.deleted, 1);
  assert.equal(cleanedAgain.deleted, 0);
  const terminalUpdate = db.prepared.find((statement) => /lifecycle_status = 'terminal'/u.test(statement.sql));
  assert.match(terminalUpdate.sql, /'completed'/u);
  const cleanupSelection = db.prepared.find((statement) => (
    /SELECT work_key/u.test(statement.sql) && /lifecycle_status IN/u.test(statement.sql)
  ));
  assert.match(cleanupSelection.sql, /NOT EXISTS[\s\S]*sync_locks/u);
  assert.doesNotMatch(cleanupSelection.sql, /lifecycle_status = 'active'/u);
});

test('pre-attempt capacity cleanup deletes only superseded staging units and preserves audit state', async () => {
  const db = createFakeD1({
    allRows: [[
      { work_key: 'old-terminal' },
      { work_key: 'old-superseded' },
    ]],
    runChanges: [3, 2],
  });
  const store = new D1ResumableWorkStore({ db, now: () => 10_000 });

  const result = await store.cleanupSupersededWorkUnits({
    limit: 25,
    protectedWorkKeys: ['tiktok:protected-forensic-work'],
  });

  assert.deepEqual(result, { candidates: 2, deletedUnits: 5 });
  const selection = db.prepared[0];
  assert.match(selection.sql, /sync_generation_fences/u);
  assert.match(selection.sql, /fence\.generation > work\.generation/u);
  assert.match(selection.sql, /lifecycle_status IN \('terminal', 'superseded'\)/u);
  assert.match(selection.sql, /sync_locks/u);
  assert.match(selection.sql, /sync_warning_outbox/u);
  assert.match(selection.sql, /work_key NOT IN \(\?\)/u);
  assert.deepEqual(selection.bindings, ['tiktok:protected-forensic-work', 10_000, 25]);
  const deletions = db.prepared.slice(1);
  assert.equal(deletions.length, 2);
  assert.equal(deletions.every((statement) => /DELETE FROM sync_work_units/u.test(statement.sql)), true);
  assert.equal(db.prepared.some((statement) => /DELETE FROM sync_work_runs/u.test(statement.sql)), false);
  assert.equal(db.prepared.some((statement) => /DELETE FROM sync_work_phases/u.test(statement.sql)), false);
});

test('DLQ redrive starts a new generation and never resumes terminal staging implicitly', async () => {
  const store = new D1ResumableWorkStore({
    db: createFakeD1({
      runChanges: [1, 1, 1],
      firstRows: [null, null],
    }),
    now: () => 20_000,
  });

  await store.beginWork({
    workKey: 'message-old',
    cursorKey: 'cursor-1',
    workType: 'youtube_organic_sync',
    operationFingerprint: 'fingerprint-old',
    generation: 1_000,
    requestedAt: 1_000,
  });
  await store.abandonWork({
    workKey: 'message-old',
    reason: 'QUEUE_RETRY_EXHAUSTED',
    auditReference: 'dlq:message-old',
  });
  const redrive = await store.beginWork({
    workKey: 'message-redrive',
    cursorKey: 'cursor-1',
    workType: 'youtube_organic_sync',
    operationFingerprint: 'fingerprint-redrive',
    generation: 2_000,
    requestedAt: 2_000,
  });

  assert.equal(redrive.resumed, false);
  assert.equal(redrive.superseded, false);
});

function createFakeD1(options = {}) {
  const prepared = [];
  const firstRows = [...(options.firstRows ?? [])];
  const allRows = [...(options.allRows ?? [])];
  const runChanges = [...(options.runChanges ?? [])];
  const batches = [];
  return {
    prepared,
    batches,
    prepare(sql) {
      const statement = {
        sql: String(sql),
        bindings: [],
        bind(...values) { this.bindings = values; return this; },
        async first() { return firstRows.shift() ?? null; },
        async all() { return { results: allRows.shift() ?? [] }; },
        async run() {
          if (options.runError) throw options.runError;
          return { meta: { changes: runChanges.shift() ?? 1 } };
        },
      };
      prepared.push(statement);
      return statement;
    },
    async batch(statements) {
      if (options.batchError) throw options.batchError;
      batches.push(statements.map((statement) => ({
        sql: statement.sql,
        bindings: statement.bindings,
      })));
      return statements.map(() => ({ meta: { changes: 1 } }));
    },
  };
}
