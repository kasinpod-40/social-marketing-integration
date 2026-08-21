import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION,
  applyCustomerBaseNotificationWorkflowParity,
  buildCustomerBaseNotificationWorkflowPlan,
} from '../../scripts/lib/customer-base-notification-workflow-parity.js';

const SOURCE_TABLE_ID = 'tbl_source_ai';
const SOURCE_FIELD_ID = 'fld_source_key';
const TARGET_TABLE_ID = 'tbl_target_ai';
const ANCHORS = [
  '🎵 RAW_TikTok_Creator_Videos',
  '(VDO) Content Creator',
  '(Graphic) Content Creator',
  'คำถามจาก Sale & Support',
];

function sourceClient() {
  return {
    getExportResources() {
      return {
        workflows: [
          {
            Status: 1,
            Draft: JSON.stringify({
              title: 'AI Materialization → MKT_AI_Report_Runs',
              steps: [],
            }),
          },
          {
            Status: 0,
            Draft: JSON.stringify({
              title: 'Eligible AI Run → Lark Group Notification',
              steps: [
                {
                  type: 'AddRecordTrigger',
                  data: {
                    tableId: SOURCE_TABLE_ID,
                    watchedFieldId: SOURCE_FIELD_ID,
                    opaque_controls: [
                      'pasteUpdate',
                      'automationBatchUpdate',
                      'openAPIBatchUpdate',
                    ],
                  },
                },
                {
                  type: 'Delay',
                  data: { duration: 1, unit: 'minute' },
                },
              ],
            }),
          },
        ],
      };
    },
    async listTables() {
      return [{ tableId: SOURCE_TABLE_ID, name: '🧠 MKT_AI_Report_Runs' }];
    },
    async listFields() {
      return [{ fieldId: SOURCE_FIELD_ID, fieldName: 'ai_run_key' }];
    },
  };
}

function targetClient({ existing = false } = {}) {
  const calls = [];
  let hasWorkflow = existing;
  const definition = {
    workflow_id: 'wkf_target_1',
    title: 'Eligible AI Run → Lark Group Notification',
    status: 'disabled',
    steps: [
      {
        id: 'step_trigger',
        type: 'AddRecordTrigger',
        next: 'step_delay',
        data: {
          table_name: '🧠 MKT_AI_Report_Runs',
          watched_field_name: 'ai_run_key',
          trigger_control_list: [
            'pasteUpdate',
            'automationBatchUpdate',
            'openAPIBatchUpdate',
          ],
          condition_list: null,
        },
      },
      {
        id: 'step_delay',
        type: 'Delay',
        next: null,
        data: { duration: 1 },
      },
    ],
  };

  return {
    appToken: 'target_app_token',
    calls,
    async listTables() {
      return [
        ...ANCHORS.map((name, index) => ({ tableId: `tbl_anchor_${index}`, name })),
        { tableId: TARGET_TABLE_ID, name: '🧠 MKT_AI_Report_Runs' },
      ];
    },
    async listFields({ tableId }) {
      assert.equal(tableId, TARGET_TABLE_ID);
      return [{ fieldId: 'fld_target_key', fieldName: 'ai_run_key' }];
    },
    async requestBitableJson(path, options = {}) {
      calls.push({
        path,
        method: options.method ?? 'GET',
        body: options.body ?? null,
      });
      if (path.endsWith('/workflows/list')) {
        return {
          data: {
            items: hasWorkflow
              ? [{ workflow_id: 'wkf_target_1', title: definition.title, status: 'disabled' }]
              : [],
            has_more: false,
          },
        };
      }
      if (path.endsWith('/workflows/wkf_target_1') && (options.method ?? 'GET') === 'GET') {
        return { data: structuredClone(definition) };
      }
      if (path.endsWith('/workflows') && options.method === 'POST') {
        hasWorkflow = true;
        assert.equal(options.retryMode, 'rate_limit_only');
        assert.equal(options.body.title, definition.title);
        assert.equal(options.body.steps.length, 2);
        return { data: { workflow_id: 'wkf_target_1' } };
      }
      throw new Error(`unexpected ${options.method ?? 'GET'} ${path}`);
    },
  };
}

test('builds exact disabled notification workflow plan from Source semantic references', async () => {
  const plan = await buildCustomerBaseNotificationWorkflowPlan({
    sourceClient: sourceClient(),
  });
  assert.equal(plan.ok, true);
  assert.equal(plan.sourceStatus, 'disabled');
  assert.equal(plan.trigger.tableName, '🧠 MKT_AI_Report_Runs');
  assert.equal(plan.trigger.fieldName, 'ai_run_key');
  assert.equal(plan.delayMinutes, 1);
  assert.equal(plan.body.steps[0].type, 'AddRecordTrigger');
  assert.equal(plan.body.steps[1].type, 'Delay');
  assert.equal(JSON.stringify(plan).includes(SOURCE_TABLE_ID), false);
  assert.equal(JSON.stringify(plan).includes(SOURCE_FIELD_ID), false);
});

test('preview is read-only and reports disabled create readiness', async () => {
  const plan = await buildCustomerBaseNotificationWorkflowPlan({
    sourceClient: sourceClient(),
  });
  const target = targetClient();
  const result = await applyCustomerBaseNotificationWorkflowParity({
    plan,
    targetClient: target,
    mode: 'preview',
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.status,
    'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PREVIEW_CREATE_DISABLED_READY',
  );
  assert.equal(result.workflowCreateCount, 0);
  assert.equal(result.workflowStatusChangeCount, 0);
  assert.equal(
    target.calls.some((call) => call.method === 'POST' && call.path.endsWith('/workflows')),
    false,
  );
});

test('wrong confirmation performs zero workflow create', async () => {
  const plan = await buildCustomerBaseNotificationWorkflowPlan({
    sourceClient: sourceClient(),
  });
  const target = targetClient();
  await assert.rejects(
    () => applyCustomerBaseNotificationWorkflowParity({
      plan,
      targetClient: target,
      mode: 'apply',
      confirmation: 'WRONG',
    }),
    (error) => error.code === 'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION_REQUIRED',
  );
  assert.equal(target.calls.length, 0);
});

test('apply creates once disabled and readbacks exact two-step definition', async () => {
  const plan = await buildCustomerBaseNotificationWorkflowPlan({
    sourceClient: sourceClient(),
  });
  const target = targetClient();
  const result = await applyCustomerBaseNotificationWorkflowParity({
    plan,
    targetClient: target,
    mode: 'apply',
    confirmation: CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION,
  });
  assert.equal(result.ok, true);
  assert.equal(
    result.status,
    'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PASS_CREATED_DISABLED',
  );
  assert.equal(result.workflowCreateCount, 1);
  assert.equal(result.workflowUpdateCount, 0);
  assert.equal(result.workflowStatusChangeCount, 0);
  assert.equal(result.workflowEnableCount, 0);
  assert.equal(result.notificationSendCount, 0);
  assert.equal(
    target.calls.filter((call) => call.method === 'POST' && call.path.endsWith('/workflows')).length,
    1,
  );
  assert.equal(target.calls.some((call) => call.path.endsWith('/enable')), false);
});

test('existing exact disabled workflow is reused with zero writes', async () => {
  const plan = await buildCustomerBaseNotificationWorkflowPlan({
    sourceClient: sourceClient(),
  });
  const target = targetClient({ existing: true });
  const result = await applyCustomerBaseNotificationWorkflowParity({
    plan,
    targetClient: target,
    mode: 'apply',
    confirmation: CUSTOMER_BASE_NOTIFICATION_WORKFLOW_CONFIRMATION,
  });
  assert.equal(
    result.status,
    'CUSTOMER_BASE_NOTIFICATION_WORKFLOW_PASS_REUSED_DISABLED',
  );
  assert.equal(result.workflowCreateCount, 0);
  assert.equal(
    target.calls.some((call) => call.method === 'POST' && call.path.endsWith('/workflows')),
    false,
  );
});
