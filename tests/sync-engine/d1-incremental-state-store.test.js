import test from 'node:test';
import assert from 'node:assert/strict';
import { D1IncrementalStateStore } from '../../packages/sync-engine/src/d1-incremental-state-store.js';

test('loads an incremental cursor and record fingerprints from D1', async () => {
  const db = createFakeD1({
    firstRows: [{
      cursor_key: 'profile:tiktok:account:native_import',
      customer_profile: 'profile', platform: 'tiktok', account_key: 'account',
      source: 'lark_native_tiktok_for_creator', sync_type: 'native_import',
      last_metric_date: '2026-07-12', dictionary_hash: 'dict',
      last_full_sync_at: 100, last_successful_sync_at: 200,
      incremental_run_count: 3, last_sync_run_id: 'run-3', created_at: 1, updated_at: 200,
    }],
    allRows: [[{
      source_record_id: 'rec-1', source_modified_at: 150, source_hash: 'hash-1',
      external_content_id: 'video-1', last_seen_sync_run_id: 'run-3',
      last_seen_at: 200, created_at: 1, updated_at: 200,
    }]],
  });
  const store = new D1IncrementalStateStore({ db });

  const checkpoint = await store.loadCheckpoint('profile:tiktok:account:native_import');

  assert.equal(checkpoint.cursor.lastMetricDate, '2026-07-12');
  assert.equal(checkpoint.cursor.incrementalRunCount, 3);
  assert.deepEqual(checkpoint.recordStates[0], {
    sourceRecordId: 'rec-1', sourceModifiedAt: 150, sourceHash: 'hash-1',
    externalContentId: 'video-1', lastSeenSyncRunId: 'run-3',
    lastSeenAt: 200, createdAt: 1, updatedAt: 200,
  });
});

test('saves record states before the final cursor batch and cleans stale states for full snapshots', async () => {
  const db = createFakeD1();
  const store = new D1IncrementalStateStore({ db, now: () => 999 });

  const result = await store.saveCheckpoint({
    cursor: {
      cursorKey: 'profile:tiktok:account:native_import',
      customerProfile: 'profile', platform: 'tiktok', accountKey: 'account',
      source: 'lark_native_tiktok_for_creator', syncType: 'native_import',
      lastMetricDate: '2026-07-12', dictionaryHash: 'dict-hash',
      lastFullSyncAt: 900, lastSuccessfulSyncAt: 950,
      incrementalRunCount: 0, lastSyncRunId: 'run-1',
    },
    records: [{
      sourceRecordId: 'rec-1', sourceModifiedAt: 900,
      sourceHash: 'hash-1', externalContentId: 'video-1',
    }],
    fullSnapshot: true,
  });

  assert.equal(result.recordsSaved, 1);
  assert.equal(result.batches, 2);
  assert.equal(db.batches.length, 2);
  assert.equal(db.batches[0].length, 1);
  assert.match(db.batches[0][0].sql, /INSERT INTO source_record_states/);
  assert.equal(db.batches[1].length, 2);
  assert.match(db.batches[1][0].sql, /INSERT INTO sync_cursors/);
  assert.match(db.batches[1][1].sql, /DELETE FROM source_record_states/);
  assert.deepEqual(db.batches[1][1].bindings, ['profile:tiktok:account:native_import', 'run-1']);
});


test('chunks large record-state writes and commits the cursor only in the final batch', async () => {
  const db = createFakeD1();
  const store = new D1IncrementalStateStore({ db, statementBatchSize: 2, now: () => 999 });
  const records = Array.from({ length: 5 }, (_, index) => ({
    sourceRecordId: `rec-${index + 1}`,
    sourceModifiedAt: 900 + index,
    sourceHash: `hash-${index + 1}`,
    externalContentId: `video-${index + 1}`,
  }));

  const result = await store.saveCheckpoint({
    cursor: {
      cursorKey: 'profile:tiktok:account:native_import',
      customerProfile: 'profile', platform: 'tiktok', accountKey: 'account',
      source: 'lark_native_tiktok_for_creator', syncType: 'native_import',
      lastMetricDate: '2026-07-12', dictionaryHash: 'dict-hash',
      lastFullSyncAt: 900, lastSuccessfulSyncAt: 950,
      incrementalRunCount: 0, lastSyncRunId: 'run-large',
    },
    records,
    fullSnapshot: false,
  });

  assert.equal(result.batches, 4);
  assert.deepEqual(db.batches.map((batch) => batch.length), [2, 2, 1, 1]);
  assert.ok(db.batches.slice(0, -1).flat().every((statement) => /source_record_states/.test(statement.sql)));
  assert.match(db.batches.at(-1)[0].sql, /INSERT INTO sync_cursors/);
});

test('checkpoint failures are retryable and do not masquerade as business success', async () => {
  const db = createFakeD1({ batchError: new Error('D1 offline') });
  const store = new D1IncrementalStateStore({ db });

  await assert.rejects(
    () => store.saveCheckpoint({
      cursor: {
        cursorKey: 'profile:tiktok:account:native_import', customerProfile: 'profile',
        platform: 'tiktok', accountKey: 'account', source: 'source', syncType: 'native_import',
        lastMetricDate: '2026-07-12', dictionaryHash: 'hash', lastFullSyncAt: 1,
        lastSuccessfulSyncAt: 2, incrementalRunCount: 0, lastSyncRunId: 'run-1',
      },
      records: [], fullSnapshot: false,
    }),
    (error) => error.code === 'D1_INCREMENTAL_CHECKPOINT_WRITE_FAILED'
      && error.retryable === true
      && error.details.causeMessage === 'D1 offline',
  );
});

test('guarded checkpoint uses the durable generation fence and rejects a superseded writer', async () => {
  const db = createFakeD1({
    firstRows: [{
      generation: 2_000,
      work_key: 'message-new',
      last_sync_run_id: 'run-new',
    }],
  });
  const store = new D1IncrementalStateStore({ db, now: () => 3_000 });

  await assert.rejects(
    store.saveCheckpoint({
      cursor: {
        cursorKey: 'cursor-1',
        customerProfile: 'profile',
        platform: 'youtube',
        accountKey: 'account',
        source: 'youtube_data_api',
        syncType: 'organic_sync',
        lastMetricDate: '2026-07-15',
        dictionaryHash: null,
        lastFullSyncAt: 1_000,
        lastSuccessfulSyncAt: 3_000,
        incrementalRunCount: 0,
        lastSyncRunId: 'run-old',
      },
      records: [{
        sourceRecordId: 'video-1',
        sourceModifiedAt: 1_000,
        sourceHash: 'old-hash',
        externalContentId: 'video-1',
      }],
      fullSnapshot: true,
      generationGuard: {
        generation: 1_000,
        workKey: 'message-old',
      },
    }),
    (error) => error?.code === 'SYNC_WORK_SUPERSEDED' && error.retryable === false,
  );

  assert.ok(db.prepared.some((statement) => (
    /sync_generation_fences/u.test(statement.sql)
    && /source_record_states/u.test(statement.sql)
  )));
  assert.ok(db.prepared.some((statement) => (
    /sync_cursors/u.test(statement.sql)
    && /generation/u.test(statement.sql)
  )));
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
        sql: String(sql), bindings: [],
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
