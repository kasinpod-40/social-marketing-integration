import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLarkBaseResourceManualParityManifest } from '../../scripts/lib/lark-base-resource-manual-parity-manifest.js';

class FakeSourceClient {
  async listTables() {
    return [{ tableId: 'tbl_source_123456', name: 'Orders' }];
  }

  async listFields() {
    return [{
      fieldId: 'fld_status_123456',
      fieldName: 'Status',
      property: {
        options: [
          { id: 'opt_ready_123456', name: 'Ready' },
          { id: 'opt_generated_123456', name: 'Generated' },
        ],
      },
    }];
  }

  getExportResources() {
    return {
      dashboards: [{
        dashboardID: 12345,
        token: 'dashboard-secret-token',
        isAdvancedPermEnabled: true,
        snapshot: JSON.stringify({ table: 'tbl_source_123456', field: 'fld_status_123456', title: 'Orders KPI' }),
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
        authKey: '7669882895331577371',
        nodeSchema: {
          tableId: 'tbl_source_123456',
          fieldId: 'fld_status_123456',
          optionId: 'opt_ready_123456',
          relations: {
            actrInternal123456: [{ id: 'internal-step-id', type: 'condition', label: 'Status is Ready' }],
          },
          tags: [
            { name: 'tenant_7545338357636091413', parent: '' },
            { name: 'user_7650461650591485464', parent: 'tenant_7545338357636091413' },
            { name: 'base_7660204738692075031', parent: 'user_7650461650591485464' },
          ],
          expression: 'expr.equals($.trig_fd364d.After.value, "opt_ready_123456")',
        },
        WorkflowExtra: {
          Draft: JSON.stringify({
            TableID: 'tbl_source_123456',
            FieldID: 'fld_status_123456',
            option: 'opt_generated_123456',
            authKey: '7669882963039161879',
            states: {
              cond_fd364d: { next: 'act_4a18b9' },
            },
            text: 'notify team',
          }),
          FlowSchema: '{not-json-flow}',
        },
      }],
      roles: [],
      accessConfig: {},
      extraInfo: {},
    };
  }
}

test('resource manual parity manifest maps Source references and redacts identities/tokens/auth keys', async () => {
  const result = await buildLarkBaseResourceManualParityManifest({ sourceClient: new FakeSourceClient() });

  assert.equal(result.ok, true);
  assert.equal(result.contractVersion, 'customer_base_resource_manual_parity_manifest_v2');
  assert.equal(result.summary.dashboardCount, 1);
  assert.equal(result.summary.dashboardChartCount, 1);
  assert.equal(result.summary.workflowCount, 1);
  assert.ok(result.summary.mappedOptionReferences >= 2);
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
  assert.deepEqual(result.workflows[0].nodeSchema.optionId, {
    refType: 'select-option',
    tableName: 'Orders',
    fieldName: 'Status',
    optionName: 'Ready',
  });
  assert.equal(result.workflows[0].webhook_token.redacted, true);
  assert.equal(result.workflows[0].authKey.redacted, true);
  assert.equal(result.workflows[0].WorkflowExtra.Draft.encoding, 'json');
  assert.equal(result.workflows[0].WorkflowExtra.Draft.value.authKey.redacted, true);
  assert.equal(result.workflows[0].WorkflowExtra.FlowSchema.encoding, 'opaque-redacted');

  const serialized = JSON.stringify(result);
  for (const forbidden of [
    'tbl_source_123456',
    'fld_status_123456',
    'opt_ready_123456',
    'opt_generated_123456',
    'dashboard-secret-token',
    'chart-secret-token',
    'super-secret-webhook',
    'internal-step-id',
    '7669882895331577371',
    '7669882963039161879',
    'tenant_7545338357636091413',
    'user_7650461650591485464',
    'base_7660204738692075031',
    'actrInternal123456',
    'trig_fd364d',
    'cond_fd364d',
    'act_4a18b9',
  ]) {
    assert.equal(serialized.includes(forbidden), false, `must redact ${forbidden}`);
  }
  assert.match(serialized, /Orders/u);
  assert.match(serialized, /Status/u);
  assert.match(serialized, /Ready/u);
  assert.match(serialized, /Generated/u);
});

test('resource manual parity manifest reports unresolved reference-like values without exposing them', async () => {
  const sourceClient = new FakeSourceClient();
  sourceClient.getExportResources = () => ({
    dashboards: [],
    workflows: [{ trigger_name: 'Broken', nodeSchema: { table: 'tbl_unknown_reference_123456' } }],
    roles: [],
    accessConfig: {},
    extraInfo: {},
  });

  const result = await buildLarkBaseResourceManualParityManifest({ sourceClient });

  assert.equal(result.ok, true);
  assert.equal(result.summary.unresolvedReferenceLikeValues, 1);
  assert.equal(result.diagnostics.unresolvedReferenceLikeValues.length, 1);
  assert.equal(JSON.stringify(result).includes('tbl_unknown_reference_123456'), false);
});

test('ordinary words beginning with rec are not misclassified as Lark record IDs', async () => {
  const sourceClient = new FakeSourceClient();
  sourceClient.getExportResources = () => ({
    dashboards: [],
    workflows: [{ trigger_name: 'records', nodeSchema: { label: 'recommendations' } }],
    roles: [],
    accessConfig: {},
    extraInfo: {},
  });

  const result = await buildLarkBaseResourceManualParityManifest({ sourceClient });
  assert.equal(result.workflows[0].trigger_name, 'records');
  assert.equal(result.workflows[0].nodeSchema.label, 'recommendations');
});