import test from 'node:test';
import assert from 'node:assert/strict';
import { D1ResumableWorkStore } from '../../packages/sync-engine/src/d1-resumable-work-store.js';

test('begins new work and resumes only when the operation fingerprint matches', async () => {
  const db = createFakeD1({
    firstRows: [null, { operation_fingerprint: 'fingerprint-A' }],
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
  assert.equal(db.batches.length, 2);
  assert.equal(db.batches[0].length, 1);
  assert.match(db.batches[0][0].sql, /INSERT INTO sync_work_runs/);
  assert.equal(db.batches[1].length, 1);
});

test('replaces stale units and phases when the same work key has a different fingerprint', async () => {
  const db = createFakeD1({
    firstRows: [{ operation_fingerprint: 'old-fingerprint' }],
  });
  const store = new D1ResumableWorkStore({ db, now: () => 100 });

  const result = await store.beginWork({
    workKey: 'message-1',
    cursorKey: 'cursor-1',
    workType: 'youtube_organic_sync',
    operationFingerprint: 'new-fingerprint',
  });

  assert.equal(result.resumed, false);
  assert.equal(db.batches[0].length, 3);
  assert.match(db.batches[0][0].sql, /DELETE FROM sync_work_units/);
  assert.match(db.batches[0][1].sql, /DELETE FROM sync_work_phases/);
  assert.match(db.batches[0][2].sql, /INSERT INTO sync_work_runs/);
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

  await store.savePhase({
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
    db: createFakeD1({ batchError: new Error('D1 unavailable') }),
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

function createFakeD1(options = {}) {
  const prepared = [];
  const firstRows = [...(options.firstRows ?? [])];
  const allRows = [...(options.allRows ?? [])];
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
