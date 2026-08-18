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
      { tableId: 'tblVdo', name: '(VDO) Content Creator' },
      { tableId: 'tblGraphic', name: '(Graphic) Content Creator' },
      { tableId: 'tblQuestions', name: 'คำถามจาก Sale & Support' },
    ];
  }

  async listTables() { return structuredClone(this.tables); }
  async createTable(input) { this.calls.push(['createTable', input]); return { tableId: 'new', name: input.name }; }
  async renameTable(input) { this.calls.push(['renameTable', input]); return {}; }
  async createField(input) { this.calls.push(['createField', input]); return {}; }
  async updateField(input) { this.calls.push(['updateField', input]); return {}; }
  async batchCreateRecords(input) { this.calls.push(['batchCreateRecords', input]); return { created: 1 }; }
  async batchUpdateRecords(input) { this.calls.push(['batchUpdateRecords', input]); return { updated: 1 }; }
  async createView(input) { this.calls.push(['createView', input]); return {}; }
  async updateView(input) { this.calls.push(['updateView', input]); return {}; }
}

test('every pre-existing Target table is immutable before any remote write call', async () => {
  const base = new FakeClient();
  const { client, policy } = await protectCustomerLarkTarget({ client: base });

  assert.equal(policy.contractVersion, 'customer_lark_target_protection_v2');
  assert.equal(policy.existingTablesProtected.length, 4);
  assert.equal(policy.rule, 'all-preexisting-target-tables-read-only');

  for (const table of base.tables) {
    await assert.rejects(
      client.createTable({ name: table.name }),
      { code: 'CUSTOMER_BASE_PROTECTED_TABLE_WRITE_BLOCKED' },
    );
    for (const [method, payload] of [
      ['renameTable', { tableId: table.tableId, name: `${table.name} changed` }],
      ['createField', { tableId: table.tableId, field: {} }],
      ['updateField', { tableId: table.tableId, fieldId: 'fld1', field: {} }],
      ['batchCreateRecords', { tableId: table.tableId, records: [{}] }],
      ['batchUpdateRecords', { tableId: table.tableId, records: [{}] }],
      ['createView', { tableId: table.tableId, viewName: 'X', viewType: 'grid' }],
      ['updateView', { tableId: table.tableId, viewId: 'vew1', hiddenFields: [] }],
    ]) {
      await assert.rejects(
        client[method](payload),
        { code: 'CUSTOMER_BASE_PROTECTED_TABLE_WRITE_BLOCKED' },
      );
    }
  }

  assert.equal(base.calls.length, 0);
});

test('write fence allows writes only to tables created after the pre-migration snapshot', async () => {
  const base = new FakeClient();
  const { client } = await protectCustomerLarkTarget({ client: base });

  const created = await client.createTable({ name: '🪪 MKT_Accounts' });
  assert.equal(created.tableId, 'new');
  await client.createField({ tableId: 'new', field: { fieldName: 'account_key', type: 1 } });

  assert.deepEqual(base.calls.map(([kind]) => kind), ['createTable', 'createField']);
});

test('protected plan accepts unrelated existing tables and requires source-overlap reuse_exact', async () => {
  const base = new FakeClient();
  const { policy } = await protectCustomerLarkTarget({ client: base });

  const ok = assertProtectedTargetTablePlan({
    preview: {
      tables: [
        { name: '🎵 RAW_TikTok_Creator_Videos', action: 'reuse_exact' },
        { name: '🪪 MKT_Accounts', action: 'create' },
      ],
    },
    existingTablesProtected: policy.existingTablesProtected,
  });
  assert.equal(ok.ok, true);
  assert.deepEqual(ok.sourceOverlaps, [
    { name: '🎵 RAW_TikTok_Creator_Videos', action: 'reuse_exact' },
  ]);

  assert.throws(
    () => assertProtectedTargetTablePlan({
      preview: {
        tables: [{ name: '🎵 RAW_TikTok_Creator_Videos', action: 'create' }],
      },
      existingTablesProtected: policy.existingTablesProtected,
    }),
    { code: 'CUSTOMER_BASE_PROTECTED_TABLE_PLAN_BLOCKED' },
  );
});

test('missing required TikTok protected table fails closed before migration', async () => {
  const base = new FakeClient();
  base.tables = base.tables.filter((table) => table.name !== '🎵 RAW_TikTok_Creator_Videos');

  await assert.rejects(
    protectCustomerLarkTarget({ client: base }),
    { code: 'CUSTOMER_BASE_REQUIRED_PROTECTED_TABLE_MISSING' },
  );
  assert.equal(base.calls.length, 0);
});
