import test from 'node:test';
import assert from 'node:assert/strict';
import { previewLarkBaseConsolidation } from '../../packages/application/src/use-cases/consolidate-lark-base.js';

const record = (recordId, fields) => ({ recordId, fields, createdTime: null, lastModifiedTime: null, lastModifiedBy: null });

class ReadOnlyClient {
  constructor(table) {
    this.tableState = structuredClone(table);
    this.calls = [];
  }

  async listTables() {
    return [{ tableId: this.tableState.tableId, name: this.tableState.name, revision: 1 }];
  }

  async listFields() { return structuredClone(this.tableState.fields); }
  async listRecords() { return structuredClone(this.tableState.records); }
  async listViews() { return structuredClone(this.tableState.views); }
  async getView({ viewId }) {
    return structuredClone(this.tableState.views.find((view) => view.viewId === viewId));
  }
}

function table({ target = false } = {}) {
  const prefix = target ? 'target' : 'source';
  return {
    tableId: `${prefix}_table`,
    name: 'Accounts',
    fields: [
      {
        fieldId: `${prefix}_key`, fieldName: 'account_key', type: 1, uiType: 'Text', description: '', isPrimary: true, property: null,
      },
      {
        fieldId: `${prefix}_published`, fieldName: 'published_at', type: 5, uiType: 'DateTime', description: '', isPrimary: false,
        property: { date_formatter: target ? 'yyyy-MM-dd' : 'yyyy/MM/dd HH:mm' },
      },
    ],
    records: [record(`${prefix}_record`, { account_key: 'a1', published_at: 1_700_000_000_000 })],
    views: [{
      viewId: `${prefix}_view`,
      viewName: 'All Records',
      viewType: 'grid',
      publicLevel: target ? 1 : 0,
      property: { hiddenFields: [], filterInfo: null },
    }],
  };
}

test('reuse conflict exposes structural field/view difference paths without values', async () => {
  const sourceClient = new ReadOnlyClient(table());
  const targetClient = new ReadOnlyClient(table({ target: true }));

  const result = await previewLarkBaseConsolidation({
    sourceClient,
    targetClient,
    expectedTableNames: ['Accounts'],
  });

  assert.equal(result.ok, false);
  assert.equal(result.summary.reuseExactTables, 0);
  const conflict = result.conflicts.find((entry) => entry.code === 'TARGET_TABLE_CONFLICT');
  assert.deepEqual(conflict.details.reasons, [
    'field property mismatch published_at',
    'view configuration mismatch All Records',
  ]);
  assert.deepEqual(conflict.details.diagnostics, [
    { kind: 'field_property', fieldName: 'published_at', differencePaths: ['$.date_formatter'] },
    { kind: 'view_configuration', viewName: 'All Records', differencePaths: ['$.publicLevel'] },
  ]);
  assert.equal(JSON.stringify(conflict.details).includes('yyyy-MM-dd'), false);
  assert.equal(JSON.stringify(conflict.details).includes('yyyy/MM/dd HH:mm'), false);
  assert.deepEqual(targetClient.calls, []);
});
