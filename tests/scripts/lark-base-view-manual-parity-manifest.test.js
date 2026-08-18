import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildLarkBaseViewManualParityExecutionPlan,
  buildLarkBaseViewManualParityManifest,
  verifyLarkBaseViewManualParityManifests,
} from '../../scripts/lib/lark-base-view-manual-parity-manifest.js';

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

test('execution plan excludes hidden/default-width metadata from manual work', () => {
  const manifest = fixtureManifest({
    manual: {
      fieldOrder: ['Status', 'Name'],
      sortInfo: [{ fieldId: 'Name', desc: true }],
      group: [{ fieldId: 'Status', desc: false }],
      colInfos: {
        Name: { hidden: false, width: null },
        Status: { hidden: true, width: 240 },
      },
      rowHeightLevel: 1,
      frozenColCount: 1,
    },
  });

  const result = buildLarkBaseViewManualParityExecutionPlan(manifest);

  assert.equal(result.ok, true);
  assert.deepEqual(result.manualOwned, {
    fieldOrderViews: 1,
    sortViews: 1,
    groupViews: 1,
    columnWidthViews: 1,
    columnWidthAssignments: 1,
    rowHeightViews: 1,
    frozenColumnViews: 1,
  });
  assert.deepEqual(result.automaticExcluded, {
    hiddenFieldViews: 1,
    hiddenFieldAssignments: 1,
    reason: 'hidden fields are owned by the automatic View hidden-fields mutation and canonical verifier',
  });
  assert.deepEqual(result.commonValues, { rowHeightLevel: 1, frozenColCount: 1 });
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);
});

test('manual manifest verifier ignores unrelated tables and default hidden metadata', () => {
  const sourceManifest = fixtureManifest({
    manual: {
      fieldOrder: ['Status', 'Name'],
      sortInfo: [{ fieldId: 'Name', desc: true }],
      colInfos: {
        Name: { hidden: false, width: null },
        Status: { hidden: true, width: 240 },
      },
      rowHeightLevel: 1,
      frozenColCount: 1,
    },
  });
  const targetManifest = {
    ...fixtureManifest({
      manual: {
        fieldOrder: ['Status', 'Name'],
        sortInfo: [{ fieldId: 'Name', desc: true }],
        colInfos: {
          Status: { hidden: false, width: 240 },
        },
        rowHeightLevel: 1,
        frozenColCount: 1,
      },
    }),
    tables: [
      ...fixtureManifest({
        manual: {
          fieldOrder: ['Status', 'Name'],
          sortInfo: [{ fieldId: 'Name', desc: true }],
          colInfos: { Status: { hidden: false, width: 240 } },
          rowHeightLevel: 1,
          frozenColCount: 1,
        },
      }).tables,
      { tableName: 'Customer Existing', views: [{ viewName: 'Private', viewType: 'grid', manual: {} }] },
    ],
  };

  const result = verifyLarkBaseViewManualParityManifests({ sourceManifest, targetManifest });

  assert.equal(result.ok, true);
  assert.equal(result.summary.expectedTables, 1);
  assert.equal(result.summary.expectedViews, 1);
  assert.equal(result.summary.comparedViews, 1);
  assert.equal(result.summary.mismatches, 0);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);
});

test('manual manifest verifier fails closed on explicit width drift', () => {
  const sourceManifest = fixtureManifest({
    manual: {
      fieldOrder: ['Name'],
      colInfos: { Name: { hidden: false, width: 240 } },
      rowHeightLevel: 1,
      frozenColCount: 1,
    },
  });
  const targetManifest = fixtureManifest({
    manual: {
      fieldOrder: ['Name'],
      colInfos: { Name: { hidden: false, width: 180 } },
      rowHeightLevel: 1,
      frozenColCount: 1,
    },
  });

  const result = verifyLarkBaseViewManualParityManifests({ sourceManifest, targetManifest });

  assert.equal(result.ok, false);
  assert.equal(result.summary.mismatches, 1);
  assert.equal(result.mismatches[0].code, 'VIEW_MANUAL_PARITY_COLUMN_WIDTHS_MISMATCH');
  assert.deepEqual(result.mismatches[0].details.expected, { Name: 240 });
  assert.deepEqual(result.mismatches[0].details.actual, { Name: 180 });
});

function fixtureManifest({ manual }) {
  return {
    ok: true,
    contractVersion: 'customer_base_view_manual_parity_manifest_v1',
    mode: 'local-read-only-id-redacted',
    scope: 'clone-source-only',
    tables: [{
      tableName: 'Orders',
      views: [{ viewName: 'Active', viewType: 'grid', manual }],
    }],
    summary: {
      tableCount: 1,
      viewCount: 1,
      featureCounts: {},
    },
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  };
}
