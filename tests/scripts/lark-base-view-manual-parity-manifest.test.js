import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLarkBaseViewManualParityManifest } from '../../scripts/lib/lark-base-view-manual-parity-manifest.js';

test('builds ID-redacted exact manual View layout manifest', async () => {
  const sourceClient = {
    async listTables() {
      return [{ tableId: 'tbl_secret', name: 'Orders' }];
    },
    async listFields() {
      return [
        { fieldId: 'fld_name', fieldName: 'Name' },
        { fieldId: 'fld_status', fieldName: 'Status' },
      ];
    },
    async listViews() {
      return [{
        viewId: 'vew_secret',
        viewName: 'Active',
        viewType: 'grid',
        property: {
          fieldOrder: ['fld_status', 'fld_name'],
          sortInfo: [{ fieldId: 'fld_name', order: 'desc' }],
          group: [{ fieldId: 'fld_status', order: 'asc' }],
          colInfos: {
            fld_name: { hidden: false, width: 240 },
            fld_status: { hidden: true, width: 120 },
          },
          rowHeightLevel: 2,
          frozenColCount: 1,
        },
      }];
    },
  };

  const result = await buildLarkBaseViewManualParityManifest({ sourceClient });

  assert.equal(result.ok, true);
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);
  assert.deepEqual(result.summary.featureCounts, {
    fieldOrder: 1,
    sortInfo: 1,
    group: 1,
    colInfos: 1,
    rowHeightLevel: 1,
    frozenColCount: 1,
  });
  assert.deepEqual(result.tables, [{
    tableName: 'Orders',
    views: [{
      viewName: 'Active',
      viewType: 'grid',
      manual: {
        fieldOrder: ['Status', 'Name'],
        sortInfo: [{ fieldId: 'Name', order: 'desc' }],
        group: [{ fieldId: 'Status', order: 'asc' }],
        colInfos: {
          Name: { hidden: false, width: 240 },
          Status: { hidden: true, width: 120 },
        },
        rowHeightLevel: 2,
        frozenColCount: 1,
      },
    }],
  }]);

  const serialized = JSON.stringify(result);
  for (const forbidden of ['tbl_secret', 'fld_name', 'fld_status', 'vew_secret']) {
    assert.equal(serialized.includes(forbidden), false, `must redact ${forbidden}`);
  }
});

test('fails closed when View layout references an unknown Field ID', async () => {
  await assert.rejects(
    buildLarkBaseViewManualParityManifest({
      sourceClient: {
        async listTables() { return [{ tableId: 'tbl_a', name: 'A' }]; },
        async listFields() { return [{ fieldId: 'fld_known', fieldName: 'Known' }]; },
        async listViews() {
          return [{ viewName: 'Grid', property: { sortInfo: [{ fieldId: 'fld_missing', order: 'asc' }] } }];
        },
      },
    }),
    (error) => error?.code === 'CUSTOMER_BASE_VIEW_MANIFEST_FIELD_UNMAPPED',
  );
});
