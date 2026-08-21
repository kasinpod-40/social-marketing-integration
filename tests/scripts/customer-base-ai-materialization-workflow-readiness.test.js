import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCustomerBaseAiMaterializationWorkflowReadiness } from '../../scripts/lib/customer-base-ai-materialization-workflow-readiness.js';

const TABLE_ID = 'tbl_ai_source';
const FIELD_IDS = Object.freeze({
  generationStatus: 'fld_generation_status',
  failureCode: 'fld_failure_code',
  generatedAt: 'fld_generated_at',
  scopeType: 'fld_scope_type',
});
const GENERATED_OPTION_ID = 'opt_generated';

function sourceClient({
  nullField = FIELD_IDS.failureCode,
  aiTitle = 'AI Materialization → MKT_AI_Report_Runs',
  draftMode = 'json-string',
} = {}) {
  const aiDraft = {
    title: aiTitle,
    steps: [
      {
        type: 'SetRecordTrigger',
        data: { tableId: TABLE_ID, fieldId: FIELD_IDS.generationStatus },
      },
      ...Array.from({ length: 4 }, (_, index) => ({
        type: 'GenerateAiTextWithSkyLarkAction',
        data: {
          prompt: [
            { type: 'text', text: `prompt-${index}` },
            { type: 'ref', fields: [{ fieldId: FIELD_IDS.scopeType }] },
          ],
        },
      })),
      {
        type: 'SetRecordAction',
        data: {
          fieldSettings: [
            {
              fieldId: FIELD_IDS.generationStatus,
              valueType: 'value',
              value: GENERATED_OPTION_ID,
            },
            {
              fieldId: nullField,
              valueType: 'value',
              value: null,
            },
            {
              fieldId: FIELD_IDS.generatedAt,
              valueType: 'ref',
              value: [{ stepAttr: 'startTime' }],
            },
          ],
        },
      },
    ],
  };
  const encodedAiDraft = draftMode === 'double-json-string'
    ? JSON.stringify(JSON.stringify(aiDraft))
    : (draftMode === 'json-wrapper-string'
      ? { encoding: 'json', value: JSON.stringify(aiDraft) }
      : JSON.stringify(aiDraft));

  return {
    getExportResources() {
      return {
        workflows: [
          {
            Status: 1,
            Draft: encodedAiDraft,
          },
          {
            Status: 0,
            Draft: JSON.stringify({
              title: 'Eligible AI Run → Lark Group Notification',
              steps: [],
            }),
          },
        ],
      };
    },
    async listTables() {
      return [{ tableId: TABLE_ID, name: '🧠 MKT_AI_Report_Runs' }];
    },
    async listFields() {
      return [
        {
          fieldId: FIELD_IDS.generationStatus,
          fieldName: 'generation_status',
          property: { options: [{ id: GENERATED_OPTION_ID, name: 'generated' }] },
        },
        { fieldId: FIELD_IDS.failureCode, fieldName: 'failure_code' },
        { fieldId: FIELD_IDS.generatedAt, fieldName: 'generated_at' },
        { fieldId: FIELD_IDS.scopeType, fieldName: 'scope_type' },
      ];
    },
  };
}

test('AI workflow readiness maps six reviewed step types and isolates null-clear blocker', async () => {
  const result = await buildCustomerBaseAiMaterializationWorkflowReadiness({
    sourceClient: sourceClient(),
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceResolutionMode, 'canonical-title-nested-draft');
  assert.equal(result.sourceStatus, 'enabled');
  assert.equal(result.stepCount, 6);
  assert.deepEqual(result.sourceStepTypes, [
    'SetRecordTrigger',
    'GenerateAiTextWithSkyLarkAction',
    'GenerateAiTextWithSkyLarkAction',
    'GenerateAiTextWithSkyLarkAction',
    'GenerateAiTextWithSkyLarkAction',
    'SetRecordAction',
  ]);
  assert.equal(result.blockerCount, 1);
  assert.equal(result.blockers[0].code, 'SET_RECORD_TEXT_NULL_CLEAR_UNDOCUMENTED');
  assert.equal(result.blockers[0].fieldName, 'failure_code');
  assert.equal(result.applyAllowed, false);
  assert.equal(result.remoteRequestCount, 0);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.workflowCreateCount, 0);
  assert.equal(result.aiCallCount, 0);
  assert.equal(result.finalAssignments.some((item) => (
    item.fieldName === 'generation_status' && item.optionName === 'generated'
  )), true);
  assert.equal(result.finalAssignments.some((item) => (
    item.fieldName === 'generated_at' && item.refAttribute === 'startTime'
  )), true);
});

test('AI workflow readiness resolves the unique reviewed six-step signature independently of display-title bytes', async () => {
  const result = await buildCustomerBaseAiMaterializationWorkflowReadiness({
    sourceClient: sourceClient({ aiTitle: 'AI Materialization display label drift' }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.sourceResolutionMode, 'unique-reviewed-step-signature-nested-draft');
  assert.deepEqual(result.sourceStepTypes, [
    'SetRecordTrigger',
    'GenerateAiTextWithSkyLarkAction',
    'GenerateAiTextWithSkyLarkAction',
    'GenerateAiTextWithSkyLarkAction',
    'GenerateAiTextWithSkyLarkAction',
    'SetRecordAction',
  ]);
  assert.equal(result.remoteMutationCount, 0);
});

test('AI workflow readiness unwraps nested exported JSON Draft encodings', async () => {
  for (const draftMode of ['double-json-string', 'json-wrapper-string']) {
    const result = await buildCustomerBaseAiMaterializationWorkflowReadiness({
      sourceClient: sourceClient({ draftMode }),
    });
    assert.equal(result.ok, true, draftMode);
    assert.equal(result.blockerCount, 1, draftMode);
    assert.equal(result.remoteMutationCount, 0, draftMode);
  }
});

test('AI workflow readiness fails closed if null clear moves away from failure_code', async () => {
  await assert.rejects(
    () => buildCustomerBaseAiMaterializationWorkflowReadiness({
      sourceClient: sourceClient({ nullField: FIELD_IDS.generatedAt }),
    }),
    (error) => error.code === 'CUSTOMER_BASE_AI_WORKFLOW_NULL_CLEAR_SHAPE_DRIFT',
  );
});
