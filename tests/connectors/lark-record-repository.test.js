import test from 'node:test';
import assert from 'node:assert/strict';
import { LarkRecordRepository } from '../../packages/connectors/src/lark/lark-record-repository.js';

test('Lark repository loads schema once and serializes typed rows before sync', async () => {
  const calls = [];
  const client = {
    async listFields(input) {
      calls.push(['fields', input]);
      return [
        { fieldName: 'content_key', type: 1 },
        { fieldName: 'content_url', type: 15 },
        { fieldName: 'views', type: 2 },
      ];
    },
    async listRecords(input) { calls.push(['list', input]); return [{ recordId: 'rec', fields: {} }]; },
    async listRecordsPage(input) {
      calls.push(['page', input]);
      return { records: [{ recordId: 'page-rec', fields: {} }], hasMore: false, nextPageToken: null };
    },
    async batchCreateRecords(input) { calls.push(['create', input]); return { created: input.records.length }; },
    async batchUpdateRecords(input) { calls.push(['update', input]); return { updated: input.records.length }; },
  };
  const repository = new LarkRecordRepository({ client });

  const prepared = await repository.prepareRows('tbl', [{
    content_key: 'one',
    content_url: 'https://example.com/video/1',
    views: 10,
  }], { keyField: 'content_key' });
  await repository.prepareRows('tbl', [{ content_key: 'two', views: 20 }], { keyField: 'content_key' });

  assert.deepEqual(prepared, [{
    content_key: 'one',
    content_url: { link: 'https://example.com/video/1', text: 'https://example.com/video/1' },
    views: 10,
  }]);
  assert.equal(calls.filter(([type]) => type === 'fields').length, 1);
  assert.equal((await repository.listAll('tbl')).length, 1);
  assert.deepEqual(await repository.listPage('tbl', { pageToken: 'next', pageSize: 100 }), {
    records: [{ recordId: 'page-rec', fields: {} }],
    hasMore: false,
    nextPageToken: null,
  });
  assert.deepEqual(calls.find(([type]) => type === 'page')[1], {
    tableId: 'tbl',
    pageToken: 'next',
    pageSize: 100,
    includeRecordMetadata: undefined,
  });
  assert.deepEqual(await repository.createMany('tbl', prepared), { created: 1 });
  assert.deepEqual(await repository.updateMany('tbl', [{ recordId: 'rec', fields: prepared[0] }]), { updated: 1 });
});
