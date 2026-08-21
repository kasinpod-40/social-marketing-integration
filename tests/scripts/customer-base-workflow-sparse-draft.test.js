import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerBaseAiMaterializationWorkflowReadiness } from '../../scripts/lib/customer-base-ai-materialization-workflow-readiness.js';
import { buildCustomerBaseNotificationWorkflowPlan } from '../../scripts/lib/customer-base-notification-workflow-parity.js';

const TABLE_ID = 'tbl_ai';
const FIELDS = Object.freeze({
  generationStatus: 'fld_generation_status',
  failureCode: 'fld_failure_code',
  generatedAt: 'fld_generated_at',
  scopeType: 'fld_scope_type',
  aiRunKey: 'fld_ai_run_key',
});
const GENERATED_OPTION = 'opt_generated';

function fields() {
  return [
    {
      fieldId: FIELDS.generationStatus,
      fieldName: 'generation_status',
      property: { options: [{ id: GENERATED_OPTION, name: 'generated' }] },
    },
    { fieldId: FIELDS.failureCode, fieldName: 'failure_code' },
    { fieldId: FIELDS.generatedAt, fieldName: 'generated_at' },
    { fieldId: FIELDS.scopeType, fieldName: 'scope_type' },
    { fieldId: FIELDS.aiRunKey, fieldName: 'ai_run_key' },
  ];
}

function baseSource(workflows) {
  return {
    getExportResources() { return { workflows }; },
    async listTables() { return [{ tableId: TABLE_ID, name: '🧠 MKT_AI_Report_Runs' }]; },
    async listFields() { return fields(); },
  };
}

function aiDraft() {
  return {
    title: 'AI Materialization → MKT_AI_Report_Runs',
    steps: [
      {
        type: 'SetRecordTrigger',
        data: { tableId: TABLE_ID, fieldId: FIELDS.generationStatus },
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        type: 'GenerateAiTextWithSkyLarkAction',
        data: {
          prompt: [
            { type: 'text', text: `prompt-${index}` },
            { type: 'ref', fields: [{ fieldId: FIELDS.scopeType }] },
          ],
        },
      })),
      {
        type: 'SetRecordAction',
        data: {
          fieldSettings: [
            {
              fieldId: FIELDS.generationStatus,
              valueType: 'value',
              value: GENERATED_OPTION,
            },
            {
              fieldId: FIELDS.failureCode,
              valueType: 'value',
              value: null,
            },
            {
              fieldId: FIELDS.generatedAt,
              valueType: 'ref',
              value: [{ stepAttr: 'startTime' }],
            },
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
          tableId: TABLE_ID,
          watchedFieldId: FIELDS.aiRunKey,
          triggerControlList: [
            'pasteUpdate',
            'automationBatchUpdate',
            'openAPIBatchUpdate',
          ],
        },
      },
      { type: 'Delay', data: { duration: 1, unit: 'minute' } },
    ],
  };
}

test('AI readiness ignores unrelated workflow entry with missing Draft', async () => {
  const sourceClient = baseSource([
    { Status: 1, Draft: JSON.stringify(aiDraft()) },
    { Status: 0 },
  ]);
  const result = await buildCustomerBaseAiMaterializationWorkflowReadiness({ sourceClient });
  assert.equal(result.ok, true);
  assert.equal(result.title, 'AI Materialization → MKT_AI_Report_Runs');
  assert.equal(result.blockerCount, 1);
  assert.equal(result.remoteMutationCount, 0);
});

test('notification planner ignores unrelated workflow entry with missing Draft', async () => {
  const sourceClient = baseSource([
    { Status: 1 },
    { Status: 0, Draft: JSON.stringify(notificationDraft()) },
  ]);
  const result = await buildCustomerBaseNotificationWorkflowPlan({ sourceClient });
  assert.equal(result.ok, true);
  assert.equal(result.title, 'Eligible AI Run → Lark Group Notification');
  assert.equal(result.sourceStatus, 'disabled');
});

test('both planners accept decoded json Draft wrapper shape', async () => {
  const ai = await buildCustomerBaseAiMaterializationWorkflowReadiness({
    sourceClient: baseSource([
      { Status: 1, Draft: { encoding: 'json', value: aiDraft() } },
      { Status: 0 },
    ]),
  });
  const notification = await buildCustomerBaseNotificationWorkflowPlan({
    sourceClient: baseSource([
      { Status: 1 },
      { Status: 0, Draft: { encoding: 'json', value: notificationDraft() } },
    ]),
  });
  assert.equal(ai.ok, true);
  assert.equal(notification.ok, true);
});

test('AI readiness resolves Draft nested inside workflow envelope and reads sibling status', async () => {
  const result = await buildCustomerBaseAiMaterializationWorkflowReadiness({
    sourceClient: baseSource([
      { envelope: { Status: 1, Draft: JSON.stringify(aiDraft()) } },
      { envelope: { Status: 0, Draft: JSON.stringify(notificationDraft()) } },
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceStatus, 'enabled');
  assert.equal(result.sourceResolutionMode, 'canonical-title-nested-draft');
  assert.match(result.sourceDraftPath, /\.envelope\.Draft$/u);
  assert.equal(result.blockerCount, 1);
  assert.equal(result.remoteMutationCount, 0);
});

test('AI readiness resolves Draft inside JSON-string workflow envelope', async () => {
  const result = await buildCustomerBaseAiMaterializationWorkflowReadiness({
    sourceClient: baseSource([
      { payload: JSON.stringify({ Status: 1, Draft: JSON.stringify(aiDraft()) }) },
      { payload: JSON.stringify({ Status: 0, Draft: JSON.stringify(notificationDraft()) }) },
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceStatus, 'enabled');
  assert.match(result.sourceDraftPath, /\.payload\.\$json\.Draft$/u);
  assert.equal(result.blockerCount, 1);
  assert.equal(result.remoteMutationCount, 0);
});

test('notification planner resolves Draft nested inside workflow envelope and reads sibling status', async () => {
  const result = await buildCustomerBaseNotificationWorkflowPlan({
    sourceClient: baseSource([
      { envelope: { Status: 1, Draft: JSON.stringify(aiDraft()) } },
      { envelope: { Status: 0, Draft: JSON.stringify(notificationDraft()) } },
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceStatus, 'disabled');
  assert.equal(result.sourceResolutionMode, 'canonical-title-nested-draft');
  assert.match(result.sourceDraftPath, /\.envelope\.Draft$/u);
});

test('notification planner resolves Draft inside JSON-string workflow envelope', async () => {
  const result = await buildCustomerBaseNotificationWorkflowPlan({
    sourceClient: baseSource([
      { payload: JSON.stringify({ Status: 1, Draft: JSON.stringify(aiDraft()) }) },
      { payload: JSON.stringify({ Status: 0, Draft: JSON.stringify(notificationDraft()) }) },
    ]),
  });
  assert.equal(result.ok, true);
  assert.equal(result.sourceStatus, 'disabled');
  assert.match(result.sourceDraftPath, /\.payload\.\$json\.Draft$/u);
});
