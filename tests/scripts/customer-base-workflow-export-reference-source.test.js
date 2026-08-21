import test from 'node:test';
import assert from 'node:assert/strict';
import { createWorkflowExportReferenceAliasSourceClient } from '../../scripts/lib/customer-base-workflow-export-reference-source-client.js';
import { buildCustomerBaseAiMaterializationWorkflowReadiness } from '../../scripts/lib/customer-base-ai-materialization-workflow-readiness.js';
import { buildCustomerBaseNotificationWorkflowPlan } from '../../scripts/lib/customer-base-notification-workflow-parity.js';

const TABLE_ID = 'tbl_ai';
const TABLE_ALIAS = 'ref_tbl_ai';
const F = Object.freeze({
  generationStatus: 'fld_generation_status',
  failureCode: 'fld_failure_code',
  generatedAt: 'fld_generated_at',
  scopeType: 'fld_scope_type',
  aiRunKey: 'fld_ai_run_key',
});
const A = Object.freeze(Object.fromEntries(
  Object.entries(F).map(([key, value]) => [key, `${TABLE_ALIAS}_${value}_export_alias`]),
));
const GENERATED = 'opt_generated';

function fields() {
  return [
    { fieldId: F.generationStatus, fieldName: 'generation_status', property: { options: [{ id: GENERATED, name: 'generated' }] } },
    { fieldId: F.failureCode, fieldName: 'failure_code' },
    { fieldId: F.generatedAt, fieldName: 'generated_at' },
    { fieldId: F.scopeType, fieldName: 'scope_type' },
    { fieldId: F.aiRunKey, fieldName: 'ai_run_key' },
  ];
}

function exportExtra() {
  return {
    TableMap: {
      [TABLE_ALIAS]: {
        TableID: TABLE_ID,
        FieldMap: {
          [A.generationStatus]: F.generationStatus,
          [A.failureCode]: F.failureCode,
          [A.generatedAt]: F.generatedAt,
          [A.scopeType]: F.scopeType,
          [A.aiRunKey]: F.aiRunKey,
        },
        ViewMap: {},
      },
    },
  };
}

function aiDraft() {
  return {
    title: 'AI Materialization → MKT_AI_Report_Runs',
    steps: [
      { type: 'SetRecordTrigger', data: { tableId: TABLE_ALIAS, fieldId: A.generationStatus } },
      ...Array.from({ length: 4 }, (_, index) => ({
        type: 'GenerateAiTextWithSkyLarkAction',
        data: { prompt: [{ type: 'text', text: `prompt-${index}` }, { type: 'ref', fields: [{ fieldId: A.scopeType }] }] },
      })),
      {
        type: 'SetRecordAction',
        data: {
          values: [
            { fieldId: A.generationStatus, valueType: 'value', value: GENERATED },
            { fieldId: A.failureCode, valueType: 'value', value: null },
            { fieldId: A.generatedAt, valueType: 'ref', value: [{ stepAttr: 'startTime' }] },
          ],
        },
      },
    ],
  };
}

function notificationDraft() {
  return {
    title: 'Eligible AI Run → Lark Group Notification',
    steps: [
      {
        type: 'AddRecordTrigger',
        data: {
          tableId: TABLE_ALIAS,
          watchedFieldId: A.aiRunKey,
          triggerControlList: ['pasteUpdate', 'automationBatchUpdate', 'openAPIBatchUpdate'],
        },
      },
      { type: 'Delay', data: { duration: 1, unit: 'minute' } },
    ],
  };
}

function rawSource() {
  return {
    getExportResources() {
      return {
        workflows: [
          { envelope: { Status: 1, Draft: JSON.stringify(aiDraft()), Extra: exportExtra() } },
          { envelope: { Status: 0, Draft: JSON.stringify(notificationDraft()), Extra: exportExtra() } },
        ],
      };
    },
    async listTables() { return [{ tableId: TABLE_ID, name: '🧠 MKT_AI_Report_Runs' }]; },
    async listFields({ tableId }) {
      assert.equal(tableId, TABLE_ID);
      return fields();
    },
  };
}

test('workflow export alias source client resolves Extra.TableMap aliases for AI and Notification planners', async () => {
  const sourceClient = await createWorkflowExportReferenceAliasSourceClient(rawSource());
  const diagnostics = sourceClient.getWorkflowExportReferenceAliasDiagnostics();
  assert.equal(diagnostics.tableAliasCount, 1);
  assert.equal(diagnostics.fieldAliasCount, 5);
  assert.equal(diagnostics.unresolvedCanonicalTableIds, 0);
  assert.equal(diagnostics.unresolvedCanonicalFieldIds, 0);

  const ai = await buildCustomerBaseAiMaterializationWorkflowReadiness({ sourceClient });
  assert.equal(ai.ok, true);
  assert.equal(ai.unresolvedFieldReferenceCount, 0);
  assert.equal(ai.finalAssignments.some((item) => item.fieldName === 'failure_code' && item.valueKind === 'literal-null'), true);
  assert.equal(ai.finalAssignments.some((item) => item.fieldName === 'generated_at' && item.refAttribute === 'startTime'), true);

  const notification = await buildCustomerBaseNotificationWorkflowPlan({ sourceClient });
  assert.equal(notification.ok, true);
  assert.equal(notification.trigger.tableName, '🧠 MKT_AI_Report_Runs');
  assert.equal(notification.trigger.fieldName, 'ai_run_key');
});
