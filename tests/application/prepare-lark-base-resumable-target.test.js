import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLarkBaseConsolidation } from '../../packages/application/src/use-cases/consolidate-lark-base.js';
import { prepareLarkBaseResumableTarget } from '../../packages/application/src/use-cases/prepare-lark-base-resumable-target.js';

const text = (fieldId, fieldName, primary = false) => ({
  fieldId,
  fieldName,
  type: 1,
  uiType: 'Text',
  description: '',
  isPrimary: primary,
  property: null,
});
const record = (recordId, fields) => ({ recordId, fields });
const grid = (viewId, viewName) => ({ viewId, viewName, viewType: 'grid', publicLevel: null, property: { hiddenFields: [], filterInfo: null } });

class FakeClient {
  constructor(tables) {
    this.tables = structuredClone(tables);
    this.calls = [];
    this.sequence = 0;
  }

  table(tableId) {
    const table = this.tables.find((item) => item.tableId === tableId);
    if (!table) throw new Error(`Unknown table ${tableId}`);
    return table;
  }

  async listTables() {
    return this.tables.map(({ tableId, name }) => ({ tableId, name }));
  }

  async listFields({ tableId }) {
    return structuredClone(this.table(tableId).fields);
  }

  async listRecords({ tableId }) {
    return structuredClone(this.table(tableId).records);
  }

  async listViews({ tableId }) {
    return structuredClone(this.table(tableId).views);
  }

  async getView({ tableId, viewId }) {
    return structuredClone(this.table(tableId).views.find((view) => view.viewId === viewId));
  }

  async createTable({ name, defaultViewName, fields }) {
    this.calls.push({ kind: 'createTable', name });
    const tableId = `new_${++this.sequence}`;
    this.tables.push({
      tableId,
      name,
      fields: [{ ...structuredClone(fields[0]), fieldId: `fld_${this.sequence}`, isPrimary: true }],
      records: [],
      views: [grid(`view_${this.sequence}`, defaultViewName ?? 'Grid')],
    });
    return { tableId, name };
  }

  async createField({ tableId, field }) {
    this.calls.push({ kind: 'createField', tableId, fieldName: field.fieldName });
    const created = { ...structuredClone(field), fieldId: `fld_${++this.sequence}`, isPrimary: false };
    this.table(tableId).fields.push(created);
    return structuredClone(created);
  }

  async batchCreateRecords({ tableId, records }) {
    this.calls.push({ kind: 'batchCreateRecords', tableId, rows: records.length });
    for (const fields of records) {
      this.table(tableId).records.push(record(`rec_${++this.sequence}`, structuredClone(fields)));
    }
    return { created: records.length };
  }

  async batchUpdateRecords({ tableId, records }) {
    this.calls.push({ kind: 'batchUpdateRecords', tableId, rows: records.length });
    for (const update of records) {
      const target = this.table(tableId).records.find((item) => item.recordId === update.recordId);
      Object.assign(target.fields, structuredClone(update.fields));
    }
    return { updated: records.length };
  }

  async createView({ tableId, viewName, viewType }) {
    this.calls.push({ kind: 'createView', tableId, viewName });
    const created = grid(`view_${++this.sequence}`, viewName);
    created.viewType = viewType;
    this.table(tableId).views.push(created);
    return structuredClone(created);
  }

  async updateView({ tableId, viewId, hiddenFields, filterInfo }) {
    this.calls.push({ kind: 'updateView', tableId, viewId });
    const view = this.table(tableId).views.find((item) => item.viewId === viewId);
    if (hiddenFields !== undefined) view.property.hiddenFields = structuredClone(hiddenFields);
    if (filterInfo !== undefined) view.property.filterInfo = structuredClone(filterInfo);
    return structuredClone(view);
  }
}

function sourceClient() {
  return new FakeClient([{
    tableId: 'src_accounts',
    name: 'Accounts',
    fields: [text('src_key', 'account_key', true), text('src_name', 'name')],
    records: [
      record('src_1', { account_key: 'a1', name: 'One' }),
      record('src_2', { account_key: 'a2', name: 'Two' }),
    ],
    views: [grid('src_view', 'All Records')],
  }]);
}

function partiallyAppliedTarget() {
  return new FakeClient([
    {
      tableId: 'protected_tiktok',
      name: 'TikTok',
      fields: [text('protected_key', 'key', true)],
      records: [],
      views: [grid('protected_view', 'All')],
    },
    {
      tableId: 'target_accounts',
      name: 'Accounts',
      fields: [text('target_key', 'account_key', true), text('target_name', 'name')],
      records: [record('target_1', { account_key: 'a1', name: 'One' })],
      views: [grid('target_view', 'All Records')],
    },
  ]);
}

test('resumable adapter lets the existing consolidator finish an exact partial table without duplicates', async () => {
  const source = sourceClient();
  const target = partiallyAppliedTarget();
  const prepared = await prepareLarkBaseResumableTarget({
    targetClient: target,
    expectedTableNames: ['Accounts'],
    protectedTables: [{ name: 'TikTok', tableId: 'protected_tiktok' }],
  });

  assert.deepEqual((await prepared.client.listTables()).map((table) => table.name), ['TikTok']);

  const result = await applyLarkBaseConsolidation({
    sourceClient: source,
    targetClient: prepared.client,
    expectedTableNames: ['Accounts'],
    expectedSourceTableCount: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.verification.ok, true);
  const accounts = target.table('target_accounts');
  assert.equal(accounts.fields.length, 2);
  assert.equal(accounts.records.length, 2);
  assert.deepEqual(accounts.records.map((item) => item.fields.account_key).sort(), ['a1', 'a2']);
  assert.equal(target.calls.some((call) => call.kind === 'createTable' && call.name === 'Accounts'), false);
  assert.equal(target.calls.some((call) => call.kind === 'createField' && call.fieldName === 'name'), false);
  assert.deepEqual(target.calls.filter((call) => call.kind === 'batchCreateRecords').map((call) => call.rows), [1]);
});

test('resumable adapter blocks drift inside a migration-owned partial field', async () => {
  const target = partiallyAppliedTarget();
  target.table('target_accounts').fields[1].type = 2;
  const prepared = await prepareLarkBaseResumableTarget({
    targetClient: target,
    expectedTableNames: ['Accounts'],
    protectedTables: [{ name: 'TikTok', tableId: 'protected_tiktok' }],
  });

  await prepared.client.createTable({
    name: 'Accounts',
    defaultViewName: 'All Records',
    fields: [{ fieldName: 'account_key', type: 1, description: '', property: null }],
  });

  await assert.rejects(
    () => prepared.client.createField({ tableId: 'target_accounts', field: { fieldName: 'name', type: 1, description: '', property: null } }),
    (error) => error?.code === 'CUSTOMER_BASE_RESUME_FIELD_CONFLICT',
  );
});

test('resumable adapter keeps protected baseline tables zero-write', async () => {
  const target = partiallyAppliedTarget();
  const prepared = await prepareLarkBaseResumableTarget({
    targetClient: target,
    expectedTableNames: ['Accounts'],
    protectedTables: [{ name: 'TikTok', tableId: 'protected_tiktok' }],
  });

  await assert.rejects(
    () => prepared.client.createField({ tableId: 'protected_tiktok', field: { fieldName: 'blocked', type: 1 } }),
    (error) => error?.code === 'CUSTOMER_BASE_RESUME_PROTECTED_TABLE_WRITE_BLOCKED',
  );
});
