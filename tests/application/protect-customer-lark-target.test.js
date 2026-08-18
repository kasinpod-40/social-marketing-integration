import test from 'node:test';
import assert from 'node:assert/strict';
import {
  assertProtectedTargetTablePlan,
  protectCustomerLarkTarget,
} from '../../packages/application/src/use-cases/protect-customer-lark-target.js';

class FakeClient {
  constructor() {
    this.calls = [];
    this.tables = [
      { tableId: 'tblTikTok', name: '🎵 RAW_TikTok_Creator_Videos' },
      { tableId: 'tblOther', name: 'Other' },
    ];
  }

  async listTables() { return structuredClone(this.tables); }
  async createTable(input) { this.calls.push(['createTable', input]); return { tableId: 'new', name: input.name }; }
  async createField(input) { this.calls.push(['createField', input]); return {}; }
  async updateField(input) { this.calls.push(['updateField', input]); return {}; }
  async batchCreateRecords(input) { this.calls.push(['batchCreateRecords', input]); return { created: 1 }; }
  async batchUpdateRecords(input) { this.calls.push(['batchUpdateRecords', input]); return { updated: 1 }; }
  async createView(input) { this.calls.push(['createView', input]); return {}; }
  async updateView(input) { this.calls.push(['updateView', input]); return {}; }
}

test('protected TikTok table blocks create-by-name and every table-scoped mutation before remote call', async () => {
  const base = new FakeClient();
  const { client, policy } = await protectCustomerLarkTarget({ client: base });

  assert.equal(policy.protectedTablesPresent.length, 1);
  assert.equal(policy.protectedTablesPresent[0].tableId, 'tblTikTok');

  await assert.rejects(
    client.createTable({ name: '🎵 RAW_TikTok_Creator_Videos' }),
    { code: 'CUSTOMER_BASE_PROTECTED_TABLE_WRITE_BLOCKED' },
  );

  for (const [method, payload] of [
    ['createField', { tableId: 'tblTikTok', field: {} }],
    ['updateField', { tableId: 'tblTikTok', fieldId: 'fld1', field: {} }],
    ['batchCreateRecords', { tableId: 'tblTikTok', records: [{}] }],
    ['batchUpdateRecords', { tableId: 'tblTikTok', records: [{}] }],
    ['createView', { tableId: 'tblTikTok', viewName: 'X', viewType: 'grid' }],
    ['updateView', { tableId: 'tblTikTok', viewId: 'vew1', hiddenFields: [] }],
  ]) {
    await assert.rejects(
      client[method](payload),
      { code: 'CUSTOMER_BASE_PROTECTED_TABLE_WRITE_BLOCKED' },
    );
  }

  assert.equal(base.calls.length, 0);
});

test('write fence allows unrelated customer migration table writes', async () => {
  const base = new FakeClient();
  const { client } = await protectCustomerLarkTarget({ client: base });

  await client.createField({ tableId: 'tblOther', field: { fieldName: 'x', type: 1 } });
  assert.equal(base.calls.length, 1);
  assert.equal(base.calls[0][0], 'createField');
});

test('protected plan requires exact reuse and blocks create/conflict paths', () => {
  const ok = assertProtectedTargetTablePlan({
    preview: {
      tables: [{ name: '🎵 RAW_TikTok_Creator_Videos', action: 'reuse_exact' }],
    },
  });
  assert.equal(ok.ok, true);

  assert.throws(
    () => assertProtectedTargetTablePlan({
      preview: {
        tables: [{ name: '🎵 RAW_TikTok_Creator_Videos', action: 'create' }],
      },
    }),
    { code: 'CUSTOMER_BASE_PROTECTED_TABLE_PLAN_BLOCKED' },
  );
});
