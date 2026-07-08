import test from 'node:test';
import assert from 'node:assert/strict';
import { LarkRecordRepository } from '../../packages/connectors/src/lark/lark-record-repository.js';

test('upserts Lark records by stable key with create/update split and dedupe', async () => {
  const calls = [];
  const client = {
    async listRecords() {
      return [];
    },
    async searchRecordsByField(input) {
      calls.push({ type: 'search', input });
      if (input.fieldValue === 'existing_key') {
        return [{ recordId: 'rec_existing', fields: { content_key: 'existing_key' } }];
      }

      return [];
    },
    async batchCreateRecords(input) {
      calls.push({ type: 'create', input });
      return { created: input.records.length };
    },
    async batchUpdateRecords(input) {
      calls.push({ type: 'update', input });
      return { updated: input.records.length };
    },
  };
  const repository = new LarkRecordRepository({ client });

  const result = await repository.upsertByKey({
    tableId: 'tbl_content',
    keyField: 'content_key',
    rows: [
      { content_key: 'existing_key', latest_views: 10 },
      { content_key: 'new_key', latest_views: 20 },
      { content_key: 'new_key', latest_views: 30 },
    ],
  });

  assert.deepEqual(result, { created: 1, updated: 1, skipped: 0 });
  const createCall = calls.find((call) => call.type === 'create');
  const updateCall = calls.find((call) => call.type === 'update');
  assert.equal(createCall.input.records[0].latest_views, 30);
  assert.equal(updateCall.input.records[0].recordId, 'rec_existing');
  assert.equal(updateCall.input.records[0].fields.latest_views, 10);
});

test('returns zero result when upserting empty Lark row set', async () => {
  const client = {
    async listRecords() {
      return [];
    },
    async searchRecordsByField() {
      throw new Error('search should not be called');
    },
    async batchCreateRecords() {
      throw new Error('create should not be called');
    },
    async batchUpdateRecords() {
      throw new Error('update should not be called');
    },
  };
  const repository = new LarkRecordRepository({ client });

  const result = await repository.upsertByKey({
    tableId: 'tbl_content',
    keyField: 'content_key',
    rows: [],
  });

  assert.deepEqual(result, { created: 0, updated: 0, skipped: 0 });
});
