import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLarkBaseResourceManualParityManifest } from '../../scripts/lib/lark-base-resource-manual-parity-manifest.js';

class FakeSourceClient {
  async listTables() {
    return [{ tableId: 'tbl_source', name: 'Orders' }];
  }

  async listFields() {
    return [{ fieldId: 'fld_status', fieldName: 'Status' }];
  }

  getExportResources() {
    return {
      dashboards: [{
        dashboardID: 12345,
        token: 'dashboard-secret-token',
        isAdvancedPermEnabled: true,
        snapshot: JSON.stringify({ table: 'tbl_source', field: 'fld_status', title: 'Orders KPI' }),
        charts: [{
          chartID: 999,
          token: 'chart-secret-token',
          subType: 7,
          snapshot: 'binary-dashboard-snapshot',
        }],
      }],
      workflows: [{
        id: 7788,
        base_id: 1,
        trigger_name: 'When Status changes',
        status: 1,
        webhook_token: 'super-secret-webhook',
        nodeSchema: {
          tableId: 'tbl_source',
          fieldId: 'fld_status',
          relations: {
            tbl_source: [{ id: 'internal-step-id', type: 'condition', label: 'Status is Ready' }],
          },
        },
        WorkflowExtra: {
          Draft: JSON.stringify({ TableID: 'tbl_source', FieldID: 'fld_status', text: 'notify team' }),
          FlowSchema: '{not-json-flow}',
        },
      }],
      roles: [],
      accessConfig: {},
      extraInfo: {},
    };
  }
}

test('resource manual parity manifest maps Source references and redacts identities/tokens', async () => {
  const result = await buildLarkBaseResourceManualParityManifest({ sourceClient: new FakeSourceClient() });

  assert.equal(result.ok, true);
  assert.equal(result.contractVersion, 'customer_base_resource_manual_parity_manifest_v1');
  assert.equal(result.summary.dashboardCount, 1);
  assert.equal(result.summary.dashboardChartCount, 1);
  assert.equal(result.summary.workflowCount, 1);
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);

  assert.deepEqual(result.dashboards[0].snapshot, {
    encoding: 'json',
    value: {
      table: { refType: 'table', tableName: 'Orders' },
      field: { refType: 'field', tableName: 'Orders', fieldName: 'Status' },
      title: 'Orders KPI',
    },
  });
  assert.equal(result.dashboards[0].charts[0].snapshot.encoding, 'opaque-redacted');
  assert.equal(result.workflows[0].nodeSchema.tableId.refType, 'table');
  assert.equal(result.workflows[0].nodeSchema.fieldId.refType, 'field');
  assert.equal(result.workflows[0].webhook_token.redacted, true);
  assert.equal(result.workflows[0].WorkflowExtra.Draft.encoding, 'json');
  assert.equal(result.workflows[0].WorkflowExtra.FlowSchema.encoding, 'opaque-redacted');

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'tbl_source',
    'fld_status',
    'dashboard-secret-token',
    'chart-secret-token',
    'super-secret-webhook',
    'internal-step-id',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must redact ${forbidden}`);
  }
});

test('resource manual parity manifest reports unresolved reference-like values without exposing them', async () => {
  const sourceClient = new FakeSourceClient();
  sourceClient.getExportResources = () => ({
    dashboards: [],
    workflows: [{ trigger_name: 'Broken', nodeSchema: { table: 'tbl_unknown_reference' } }],
    roles: [],
    accessConfig: {},
    extraInfo: {},
  });

  const result = await buildLarkBaseResourceManualParityManifest({ sourceClient });

  assert.equal(result.ok, true);
  assert.equal(result.summary.unresolvedReferenceLikeValues, 1);
  assert.equal(result.diagnostics.unresolvedReferenceLikeValues.length, 1);
  assert.equal(JSON.stringify(result).includes('tbl_unknown_reference'), false);
});
