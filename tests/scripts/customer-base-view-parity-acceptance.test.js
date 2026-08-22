import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyCustomerBaseViewParityAcceptance } from '../../scripts/lib/customer-base-view-parity-acceptance.js';

test('blocks field-order mismatch while keeping width out of scope', () => {
  const sourceManifest = fixtureManifest({
    fieldOrder: ['Name', 'Status'],
    colInfos: { Name: { width: 240 } },
  });
  const targetManifest = fixtureManifest({
    fieldOrder: ['Status', 'Name'],
    colInfos: { Name: { width: 180 } },
  });

  const result = verifyCustomerBaseViewParityAcceptance({ sourceManifest, targetManifest });

  assert.equal(result.ok, false);
  assert.equal(result.summary.fieldOrderMismatchCount, 1);
  assert.equal(result.summary.blockingMismatchCount, 1);
  assert.equal(result.summary.excludedColumnWidthMismatchCount, 1);
  assert.equal(result.acceptanceScope.columnWidth, 'excluded-by-user');
  assert.equal(result.mismatches[0].code, 'VIEW_MANUAL_PARITY_FIELD_ORDER_MISMATCH');
});

test('passes when the only drift is column width', () => {
  const sourceManifest = fixtureManifest({
    fieldOrder: ['Name', 'Status'],
    colInfos: { Name: { width: 240 } },
  });
  const targetManifest = fixtureManifest({
    fieldOrder: ['Name', 'Status'],
    colInfos: { Name: { width: 180 } },
  });

  const result = verifyCustomerBaseViewParityAcceptance({ sourceManifest, targetManifest });

  assert.equal(result.ok, true);
  assert.equal(result.summary.fieldOrderMismatchCount, 0);
  assert.equal(result.summary.blockingMismatchCount, 0);
  assert.equal(result.summary.excludedColumnWidthMismatchCount, 1);
  assert.deepEqual(result.mismatches, []);
  assert.equal(result.excludedMismatches[0].code, 'VIEW_MANUAL_PARITY_COLUMN_WIDTHS_MISMATCH');
  assert.deepEqual(result.executionPlan.userExcluded, {
    columnWidthViews: 1,
    columnWidthAssignments: 1,
    reason: 'column width is out of customer Base parity scope by explicit user decision',
  });
});

test('keeps non-width presentation mismatches blocking', () => {
  const sourceManifest = fixtureManifest({
    fieldOrder: ['Name'],
    sortInfo: [{ fieldId: 'Name', desc: true }],
  });
  const targetManifest = fixtureManifest({
    fieldOrder: ['Name'],
    sortInfo: [],
  });

  const result = verifyCustomerBaseViewParityAcceptance({ sourceManifest, targetManifest });

  assert.equal(result.ok, false);
  assert.equal(result.summary.fieldOrderMismatchCount, 0);
  assert.equal(result.summary.blockingMismatchCount, 1);
  assert.equal(result.mismatches[0].code, 'VIEW_MANUAL_PARITY_SORT_INFO_MISMATCH');
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
        viewName: 'All',
        viewType: 'grid',
        manual: {
          fieldOrder: manual.fieldOrder ?? [],
          sortInfo: manual.sortInfo ?? [],
          group: manual.group ?? [],
          colInfos: manual.colInfos ?? {},
          rowHeightLevel: manual.rowHeightLevel ?? 1,
          frozenColCount: manual.frozenColCount ?? 1,
        },
      }],
    }],
    summary: { tableCount: 1, viewCount: 1, featureCounts: {} },
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  };
}
