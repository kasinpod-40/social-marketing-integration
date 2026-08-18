import test from 'node:test';
import assert from 'node:assert/strict';
import { assessLarkBaseCloneParityCoverage } from '../../packages/application/src/use-cases/assess-lark-base-clone-parity.js';

class FakeSourceClient {
  constructor(views) {
    this.views = views;
  }

  async listTables() {
    return [{ tableId: 'tbl_1', name: 'Accounts' }];
  }

  async listViews() {
    return this.views;
  }
}

test('parity coverage reports represented rich View and exported resource gaps without mutation', async () => {
  const result = await assessLarkBaseCloneParityCoverage({
    sourceClient: new FakeSourceClient([
      {
        viewId: 'vew_1',
        viewName: 'All Records',
        viewType: 'grid',
        publicLevel: 'Public',
        property: {
          hiddenFields: ['fld_hidden'],
          filterInfo: { conjunction: 'and', conditions: [] },
          fieldOrder: ['fld_1', 'fld_2'],
          sortInfo: [{ fieldId: 'fld_1', desc: true }],
          group: [{ fieldId: 'fld_2' }],
          colInfos: { fld_1: { width: 180 } },
          rowHeightLevel: 2,
          frozenColCount: 1,
          cardViewSetting: { coverFieldId: 'fld_1' },
          hierarchyConfig: { fieldId: 'fld_2' },
          colorInfo: { type: 'conditional' },
        },
      },
    ]),
    exportCounts: {
      relationFields: 2,
      formulaFields: 1,
      dashboards: 6,
      workflows: 2,
      advancedPermissionRoles: 4,
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.contractVersion, 'customer_base_clone_parity_coverage_v3');
  assert.equal(result.source.tables, 1);
  assert.equal(result.source.views, 1);
  assert.equal(result.source.viewTypes.grid, 1);
  assert.equal(result.source.viewFeatureCounts.fieldOrder, 1);
  assert.equal(result.source.viewFeatureCounts.sortInfo, 1);
  assert.equal(result.source.viewFeatureCounts.group, 1);
  assert.equal(result.source.viewFeatureCounts.hierarchyConfig, 1);
  assert.equal(result.source.viewFeatureCounts.cardViewSetting, 1);
  assert.equal(result.source.exportResourceCounts.dashboards, 6);
  assert.equal(
    result.documentedViewParity.implementationStatus,
    'hierarchy_config_implemented_ci_verified_apply_wiring_pending',
  );
  assert.ok(result.blockers.some((item) => item.code === 'CLONE_PARITY_VIEW_FIELD_ORDER_DOCUMENTED_WRITE_CONTRACT_NOT_PROVEN'));
  assert.ok(result.blockers.some((item) => item.code === 'CLONE_PARITY_VIEW_HIERARCHY_CONFIG_WIRING_PENDING'));
  assert.ok(result.blockers.some((item) => item.code === 'CLONE_PARITY_DASHBOARD_UNIMPLEMENTED'));
  assert.ok(result.blockers.some((item) => item.code === 'CLONE_PARITY_WORKFLOW_UNIMPLEMENTED'));
  assert.ok(result.blockers.some((item) => item.code === 'CLONE_PARITY_ADVANCED_PERMISSION_UNIMPLEMENTED'));
  assert.ok(!result.blockers.some((item) => item.code === 'CLONE_PARITY_FORMS_QUESTIONS_UNIMPLEMENTED'));
});

test('parity coverage treats absent optional resources as not represented', async () => {
  const result = await assessLarkBaseCloneParityCoverage({
    sourceClient: new FakeSourceClient([
      {
        viewId: 'vew_1',
        viewName: 'All Records',
        viewType: 'grid',
        property: {},
      },
    ]),
    exportCounts: {},
  });

  const dashboards = result.dimensions.find((item) => item.dimension === 'dashboards');
  const workflows = result.dimensions.find((item) => item.dimension === 'workflows');
  const permissions = result.dimensions.find((item) => item.dimension === 'advanced_permissions');
  const forms = result.dimensions.find((item) => item.dimension === 'forms_questions');
  const hierarchy = result.dimensions.find((item) => item.dimension === 'view_hierarchyConfig');

  assert.equal(dashboards.status, 'not_represented');
  assert.equal(workflows.status, 'not_represented');
  assert.equal(permissions.status, 'not_represented');
  assert.equal(forms.status, 'not_represented');
  assert.equal(hierarchy.status, 'not_represented');
});

test('parity coverage blocks Form parity only when a Form view is represented', async () => {
  const result = await assessLarkBaseCloneParityCoverage({
    sourceClient: new FakeSourceClient([
      {
        viewId: 'vew_form',
        viewName: 'Submit',
        viewType: 'form',
        property: {},
      },
    ]),
    exportCounts: {},
  });

  assert.equal(result.source.viewTypes.form, 1);
  assert.ok(result.blockers.some((item) => item.code === 'CLONE_PARITY_FORMS_QUESTIONS_UNIMPLEMENTED'));
});
