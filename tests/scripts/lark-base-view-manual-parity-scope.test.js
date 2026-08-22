import test from 'node:test';
import assert from 'node:assert/strict';
import { verifyLarkBaseViewManualParityManifests } from '../../scripts/lib/lark-base-view-manual-parity-manifest.js';

test('customer scope ignores width drift but still blocks field-order drift', () => {
  const sourceManifest = fixtureManifest({
    fieldOrder: ['Name', 'Status'],
    colInfos: { Name: { width: 240 } },
  });
  const widthOnlyTarget = fixtureManifest({
    fieldOrder: ['Name', 'Status'],
    colInfos: { Name: { width: 180 } },
  });

  const widthOnly = verifyLarkBaseViewManualParityManifests({
    sourceManifest,
    targetManifest: widthOnlyTarget,
    includeColumnWidths: false,
  });

  assert.equal(widthOnly.ok, true);
  assert.equal(widthOnly.acceptanceScope.fieldOrder, 'blocking');
  assert.equal(widthOnly.acceptanceScope.columnWidth, 'excluded');
  assert.equal(widthOnly.summary.fieldOrderMismatches, 0);
  assert.equal(widthOnly.executionPlan.scopeExcluded.columnWidthViews, 1);
  assert.equal(widthOnly.executionPlan.scopeExcluded.columnWidthAssignments, 1);

  const orderTarget = fixtureManifest({
    fieldOrder: ['Status', 'Name'],
    colInfos: { Name: { width: 180 } },
  });
  const orderMismatch = verifyLarkBaseViewManualParityManifests({
    sourceManifest,
    targetManifest: orderTarget,
    includeColumnWidths: false,
  });

  assert.equal(orderMismatch.ok, false);
  assert.equal(orderMismatch.summary.fieldOrderMismatches, 1);
  assert.equal(orderMismatch.mismatches.length, 1);
  assert.equal(orderMismatch.mismatches[0].code, 'VIEW_MANUAL_PARITY_FIELD_ORDER_MISMATCH');
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
          rowHeightLevel: 1,
          frozenColCount: 1,
        },
      }],
    }],
    summary: { tableCount: 1, viewCount: 1, featureCounts: {} },
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  };
}
