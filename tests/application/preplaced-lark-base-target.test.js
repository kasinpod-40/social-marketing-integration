import test from 'node:test';
import assert from 'node:assert/strict';
import { applyLarkBaseConsolidation } from '../../packages/application/src/use-cases/consolidate-lark-base.js';
import { preparePreplacedLarkBaseTarget } from '../../packages/application/src/use-cases/preplaced-lark-base-target.js';

const text = (fieldId, fieldName, primary = false) => ({
  fieldId,
  fieldName,
  type: 1,
  uiType: 'Text',
  description: '',
  isPrimary: primary,
  property: null,
});
const grid = (viewId, viewName) => ({
  viewId,
  viewName,
  viewType: 'grid',
  publicLevel: null,
  property: { hiddenFields: [], filterInfo: null },
});
const record = (recordId, fields) => ({
  recordId,
  fields,
  createdTime: null,
  lastModifiedTime: null,
  lastModifiedBy: null,
});

class FakeTargetClient {
  constructor(tables = []) {
    this.tables = structuredClone(tables);
    this.sequence = 0;
    this.calls = [];
  }

  table(tableId) {
    const table = this.tables.find((item) => item.tableId === tableId);
    if (!table) throw new Error(`Unknown target table ${tableId}`);
    return table;
  }

  async listTables() {
    return this.tables.map(({ tableId, name }) => ({ tableId, name, revision: 1 }));
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

  async createTable() {
    this.calls.push({ kind: 'createTable' });
    throw new Error('underlying createTable must never be called');
  }

  async updateField({ tableId, fieldId, field }) {
    this.calls.push({ kind: 'updateField', tableId, fieldId, fieldName: field.fieldName });
    const target = this.table(tableId).fields.find((item) => item.fieldId === fieldId);
    target.fieldName = field.fieldName;
    target.type = field.type;
    target.uiType = field.uiType ?? null;
    target.description = field.description ?? '';
    target.property = structuredClone(field.property ?? null);
    return structuredClone(target);
  }

  async createField({ tableId, field }) {
    this.calls.push({ kind: 'createField', tableId, fieldName: field.fieldName });
    const created = {
      fieldId: `target_fld_${++this.sequence}`,
      fieldName: field.fieldName,
      type: field.type,
      uiType: field.uiType ?? null,
      description: field.description ?? '',
      isPrimary: false,
      property: structuredClone(field.property ?? null),
    };
    this.table(tableId).fields.push(created);
    return structuredClone(created);
  }

  async batchCreateRecords({ tableId, records }) {
    this.calls.push({ kind: 'batchCreateRecords', tableId, rows: records.length });
    const table = this.table(tableId);
    for (const fields of records) {
      table.records.push(record(`target_rec_${++this.sequence}`, structuredClone(fields)));
    }
    return { created: records.length };
  }

  async batchUpdateRecords({ tableId, records }) {
    this.calls.push({ kind: 'batchUpdateRecords', tableId, rows: records.length });
    const table = this.table(tableId);
    for (const update of records) {
      const current = table.records.find((item) => item.recordId === update.recordId);
      Object.assign(current.fields, structuredClone(update.fields));
    }
    return { updated: records.length };
  }

  async createView({ tableId, viewName, viewType }) {
    this.calls.push({ kind: 'createView', tableId, viewName });
    const created = grid(`target_view_${++this.sequence}`, viewName);
    created.viewType = viewType;
    this.table(tableId).views.push(created);
    return structuredClone(created);
  }

  async updateView({ tableId, viewId, viewName, hiddenFields, filterInfo }) {
    this.calls.push({ kind: 'updateView', tableId, viewId, viewName: viewName ?? null });
    const view = this.table(tableId).views.find((item) => item.viewId === viewId);
    if (viewName !== undefined) view.viewName = viewName;
    if (hiddenFields !== undefined) view.property.hiddenFields = structuredClone(hiddenFields);
    if (filterInfo !== undefined) view.property.filterInfo = structuredClone(filterInfo);
    return structuredClone(view);
  }
}

class FakeSourceClient extends FakeTargetClient {
  async createTable() {
    throw new Error('source is read-only');
  }
}

function sourceAccounts() {
  return new FakeSourceClient([{
    tableId: 'src_accounts',
    name: 'Accounts',
    fields: [text('src_key', 'account_key', true), text('src_name', 'name')],
    records: [record('src_rec_1', { account_key: 'a1', name: 'One' })],
    views: [grid('src_view_1', 'All Records')],
  }]);
}

function targetShell() {
  return new FakeTargetClient([{
    tableId: 'target_accounts',
    name: 'Accounts',
    fields: [text('target_primary', 'Text', true)],
    records: [],
    views: [grid('target_view_1', 'Grid')],
  }]);
}

test('preflight blocks when an expected destination table has not been pre-created', async () => {
  const prepared = await preparePreplacedLarkBaseTarget({
    targetClient: new FakeTargetClient(),
    expectedTableNames: ['Accounts'],
    expectedTableCount: 1,
  });

  assert.equal(prepared.ok, false);
  assert.deepEqual(prepared.preflight.missingTargetTables, ['Accounts']);
  assert.equal(prepared.preflight.remoteTableCreateAllowed, false);
  assert.equal(prepared.preflight.conflicts[0].code, 'PREPLACED_TARGET_TABLE_MISSING');
});

test('apply claims an empty preplaced table without calling the underlying createTable', async () => {
  const sourceClient = sourceAccounts();
  const rawTargetClient = targetShell();
  const prepared = await preparePreplacedLarkBaseTarget({
    targetClient: rawTargetClient,
    expectedTableNames: ['Accounts'],
    expectedTableCount: 1,
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.preflight.emptyShellTables, 1);
  assert.deepEqual(await prepared.client.listTables(), []);

  const result = await applyLarkBaseConsolidation({
    sourceClient,
    targetClient: prepared.client,
    expectedTableNames: ['Accounts'],
    expectedSourceTableCount: 1,
  });

  assert.equal(result.ok, true);
  assert.equal(result.verification.ok, true);
  assert.equal(result.applied.createdTables, 1);
  assert.equal(rawTargetClient.calls.some((call) => call.kind === 'createTable'), false);
  assert.equal(rawTargetClient.calls.some((call) => call.kind === 'updateField'), true);
  assert.equal(rawTargetClient.calls.some((call) => call.kind === 'batchCreateRecords'), true);

  const target = rawTargetClient.tables[0];
  assert.equal(target.tableId, 'target_accounts');
  assert.deepEqual(target.fields.map((field) => field.fieldName), ['account_key', 'name']);
  assert.equal(target.records.length, 1);
  assert.equal(target.records[0].fields.account_key, 'a1');
  assert.equal(target.views[0].viewName, 'All Records');
});

test('non-empty existing target tables remain visible so the consolidation preflight can verify or reject them', async () => {
  const rawTargetClient = new FakeTargetClient([{
    tableId: 'target_accounts',
    name: 'Accounts',
    fields: [text('target_key', 'account_key', true), text('target_name', 'name')],
    records: [record('target_rec_1', { account_key: 'a1', name: 'One' })],
    views: [grid('target_view_1', 'All Records')],
  }]);
  const prepared = await preparePreplacedLarkBaseTarget({
    targetClient: rawTargetClient,
    expectedTableNames: ['Accounts'],
    expectedTableCount: 1,
  });

  assert.equal(prepared.ok, true);
  assert.equal(prepared.preflight.emptyShellTables, 0);
  assert.equal(prepared.preflight.existingTargetTables, 1);
  const visible = await prepared.client.listTables();
  assert.equal(visible.length, 1);
  assert.equal(visible[0].tableId, 'target_accounts');
});
