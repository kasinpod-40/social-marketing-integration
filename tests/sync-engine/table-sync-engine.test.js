import test from 'node:test';
import assert from 'node:assert/strict';
import { TableSyncEngine, deduplicateRowsByKey, hasChangedFields } from '../../packages/sync-engine/src/table-sync-engine.js';

test('sync engine reads once, creates missing, updates changed, and skips unchanged', async () => {
  const calls = [];
  const repository = {
    async prepareRows(_tableId, rows) { return rows; },
    async listAll(tableId) {
      calls.push(['list', tableId]);
      return [
        { recordId: 'rec_same', fields: { content_key: 'same', views: 10, title: 'A' } },
        { recordId: 'rec_changed', fields: { content_key: 'changed', views: 10 } },
      ];
    },
    async createMany(tableId, rows) { calls.push(['create', tableId, rows]); return { created: rows.length }; },
    async updateMany(tableId, rows) { calls.push(['update', tableId, rows]); return { updated: rows.length }; },
  };
  const result = await new TableSyncEngine().syncByKey({
    repository, tableId: 'tbl_content', keyField: 'content_key',
    rows: [
      { content_key: 'same', views: 10 },
      { content_key: 'changed', views: 11 },
      { content_key: 'new', views: 1 },
      { content_key: 'new', views: 2 },
    ],
  });
  assert.deepEqual(result, { created: 1, updated: 1, skipped: 1, duplicateInputRows: 1 });
  assert.equal(calls.filter(([type]) => type === 'list').length, 1);
  assert.equal(calls.find(([type]) => type === 'create')[2][0].views, 2);
  assert.equal(calls.find(([type]) => type === 'update')[2][0].recordId, 'rec_changed');
});

test('sync engine fails fast when destination contains duplicate stable keys', async () => {
  const repository = {
    async prepareRows(_tableId, rows) { return rows; },
    async listAll() { return [{ recordId: 'one', fields: { key: 'duplicate' } }, { recordId: 'two', fields: { key: 'duplicate' } }]; },
    async createMany() { return { created: 0 }; },
    async updateMany() { return { updated: 0 }; },
  };
  await assert.rejects(
    () => new TableSyncEngine().syncByKey({ repository, tableId: 'tbl', keyField: 'key', rows: [{ key: 'duplicate' }] }),
    /duplicate key values/,
  );
});

test('sync engine does not read or write for an empty row set', async () => {
  const repository = {
    async prepareRows() { throw new Error('should not prepare'); },
    async listAll() { throw new Error('should not list'); },
    async createMany() { throw new Error('should not create'); },
    async updateMany() { throw new Error('should not update'); },
  };
  const result = await new TableSyncEngine().syncByKey({ repository, tableId: 'tbl', keyField: 'key', rows: [] });
  assert.deepEqual(result, { created: 0, updated: 0, skipped: 0, duplicateInputRows: 0 });
});

test('row dedupe uses last row and field comparison ignores destination-only fields', () => {
  const result = deduplicateRowsByKey([{ key: 'a', value: 1 }, { key: 'a', value: 2 }], 'key');
  assert.equal(result.duplicateCount, 1);
  assert.equal(result.rows[0].value, 2);
  assert.equal(hasChangedFields({ key: 'a', value: 2, destination_only: true }, { key: 'a', value: 2 }), false);
});


test('sync engine emits detailed progress stages', async () => {
  const events = [];
  const repository = {
    async prepareRows(_tableId, rows) { return rows; },
    async listAll() { return []; },
    async createMany(_tableId, rows) { return { created: rows.length }; },
    async updateMany() { return { updated: 0 }; },
  };
  await new TableSyncEngine().syncByKey({
    repository,
    tableId: 'tbl_content',
    keyField: 'content_key',
    rows: [{ content_key: 'one', views: 1 }],
    onProgress: (event) => events.push(event),
  });
  assert.deepEqual(events.map((event) => event.stage), [
    'sync_deduplicating',
    'sync_deduplicated',
    'sync_loading_schema',
    'sync_schema_loaded',
    'sync_loading_existing_records',
    'sync_existing_records_loaded',
    'sync_planning',
    'sync_plan_ready',
    'sync_creating',
    'sync_created',
    'sync_updating',
    'sync_updated',
  ]);
});
