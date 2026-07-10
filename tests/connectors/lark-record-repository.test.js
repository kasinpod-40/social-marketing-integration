import test from 'node:test';
import assert from 'node:assert/strict';
import { LarkRecordRepository } from '../../packages/connectors/src/lark/lark-record-repository.js';

test('Lark repository is a thin list/create/update adapter', async () => {
  const calls = [];
  const client = {
    async listRecords(input) { calls.push(['list', input]); return [{ recordId: 'rec', fields: {} }]; },
    async batchCreateRecords(input) { calls.push(['create', input]); return { created: input.records.length }; },
    async batchUpdateRecords(input) { calls.push(['update', input]); return { updated: input.records.length }; },
  };
  const repository = new LarkRecordRepository({ client });

  assert.equal((await repository.listAll('tbl')).length, 1);
  assert.deepEqual(await repository.createMany('tbl', [{ key: 'one' }]), { created: 1 });
  assert.deepEqual(await repository.updateMany('tbl', [{ recordId: 'rec', fields: { key: 'one' } }]), { updated: 1 });
  assert.deepEqual(calls.map(([type]) => type), ['list', 'create', 'update']);
});
