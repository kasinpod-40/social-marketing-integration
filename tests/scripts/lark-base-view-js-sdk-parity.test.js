import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLarkBaseViewJsSdkParityPlan } from '../../scripts/lib/lark-base-view-js-sdk-parity.js';

test('projects retained View manifest into documented Base JS SDK mutations', () => {
  const plan = buildLarkBaseViewJsSdkParityPlan(fixtureManifest({
    fieldOrder: ['Status', 'Name'],
    sortInfo: [{ fieldId: 'Name', order: 'desc' }],
    group: [{ fieldId: 'Status', desc: false }],
    colInfos: {
      Name: { hidden: false, width: null },
      Status: { hidden: true, width: 240 },
    },
    rowHeightLevel: 1,
    frozenColCount: 1,
  }));

  assert.equal(plan.ok, true);
  assert.equal(plan.contractVersion, 'customer_base_view_js_sdk_parity_plan_v1');
  assert.deepEqual(plan.ownership, {
    automaticServerOpenApiVerifyOnly: ['hiddenFields', 'filters', 'hierarchy'],
    baseJsSdkMutations: ['sort', 'group', 'columnWidth', 'rowHeight'],
    remainingManual: ['fieldOrder', 'frozenColumns'],
  });
  assert.deepEqual(plan.summary, {
    tableCount: 1,
    viewCount: 1,
    fieldOrderAuditViews: 1,
    hiddenVerificationViews: 1,
    hiddenVerificationAssignments: 1,
    sortViews: 1,
    groupViews: 1,
    columnWidthViews: 1,
    columnWidthAssignments: 1,
    rowHeightViews: 1,
    frozenColumnManualViews: 1,
  });
  assert.deepEqual(plan.tables, [{
    tableName: 'Orders',
    views: [{
      viewName: 'Active',
      viewType: 'grid',
      verifyOnly: {
        fieldOrder: ['Status', 'Name'],
        hiddenFieldNames: ['Status'],
      },
      mutate: {
        sort: [{ fieldName: 'Name', desc: true }],
        group: [{ fieldName: 'Status', desc: false }],
        columnWidths: { Status: 240 },
        rowHeightLevel: 1,
      },
      remainingManual: {
        frozenColCount: 1,
      },
    }],
  }]);
});

test('accepts desc boolean and normalizes ascending order', () => {
  const plan = buildLarkBaseViewJsSdkParityPlan(fixtureManifest({
    fieldOrder: ['Name'],
    sortInfo: [{ fieldId: 'Name', desc: false }],
    group: [{ fieldId: 'Name', order: 'DESC' }],
    rowHeightLevel: 2,
    frozenColCount: 0,
  }));

  const view = plan.tables[0].views[0];
  assert.deepEqual(view.mutate.sort, [{ fieldName: 'Name', desc: false }]);
  assert.deepEqual(view.mutate.group, [{ fieldName: 'Name', desc: true }]);
  assert.equal(view.mutate.rowHeightLevel, 2);
  assert.equal(view.remainingManual.frozenColCount, 0);
});

test('fails closed on unknown directional representation', () => {
  assert.throws(
    () => buildLarkBaseViewJsSdkParityPlan(fixtureManifest({
      sortInfo: [{ fieldId: 'Name', order: 'sideways' }],
    })),
    /must contain desc:boolean or order asc\/desc/u,
  );
});

test('omits null widths and rejects unsafe row height', () => {
  const plan = buildLarkBaseViewJsSdkParityPlan(fixtureManifest({
    colInfos: {
      Name: { width: null },
      Status: { width: 180 },
    },
  }));
  assert.deepEqual(plan.tables[0].views[0].mutate.columnWidths, { Status: 180 });

  assert.throws(
    () => buildLarkBaseViewJsSdkParityPlan(fixtureManifest({ rowHeightLevel: 5 })),
    /must be an integer from 1 to 4/u,
  );
});

function fixtureManifest(manual) {
  return {
    ok: true,
    contractVersion: 'customer_base_view_manual_parity_manifest_v1',
    mode: 'local-read-only-id-redacted',
    scope: 'clone-source-only',
    tables: [{
      tableName: 'Orders',
      views: [{
        viewName: 'Active',
        viewType: 'grid',
        manual,
      }],
    }],
    summary: {
      tableCount: 1,
      viewCount: 1,
      featureCounts: {},
    },
  };
}
