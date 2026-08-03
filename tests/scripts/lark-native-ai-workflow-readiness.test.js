import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LARK_NATIVE_AI_REQUIRED_SETTINGS_FIELDS,
  LARK_NATIVE_AI_REQUIRED_WORKFLOW_FIELDS,
  LARK_NATIVE_AI_SETTINGS_TABLE,
  LARK_NATIVE_AI_TARGET_GROUP_NAME,
  LARK_NATIVE_AI_TARGET_TABLE,
  LARK_NOTIFICATION_LOG_TABLE_NAME,
} from '../../packages/config/src/lark-native-ai-workflow-readiness-contract.js';
import { inspectLarkNativeAiWorkflowReadiness } from '../../scripts/lib/lark-native-ai-workflow-readiness.js';

class FakeClient {
  constructor(options = {}) {
    this.groupId = options.groupId ?? 'oc_verified_group';
    this.settingGroupId = options.settingGroupId === undefined
      ? this.groupId
      : options.settingGroupId;
    this.workflows = structuredClone(options.workflows ?? []);
  }

  async listTables() {
    return [
      { tableId: 'tbl_ai', name: LARK_NATIVE_AI_TARGET_TABLE },
      { tableId: 'tbl_settings', name: LARK_NATIVE_AI_SETTINGS_TABLE },
      { tableId: 'tbl_log', name: LARK_NOTIFICATION_LOG_TABLE_NAME },
    ];
  }

  async listFields({ tableId }) {
    if (tableId === 'tbl_ai') return LARK_NATIVE_AI_REQUIRED_WORKFLOW_FIELDS.map((fieldName) => ({
      fieldName,
      type: fieldName === 'notification_eligible' || fieldName === 'preview_mode'
        || fieldName === 'sent_to_group' ? 7 : 1,
      uiType: 'Text',
    }));
    if (tableId === 'tbl_settings') return LARK_NATIVE_AI_REQUIRED_SETTINGS_FIELDS.map((fieldName) => ({
      fieldName,
      type: ['enabled', 'ai_enabled', 'notification_enabled'].includes(fieldName) ? 7 : 1,
      uiType: 'Text',
    }));
    return [];
  }

  async listRecords() {
    return [{
      recordId: 'rec_settings',
      fields: {
        customer_profile: 'integration_workspace',
        enabled: true,
        ai_enabled: false,
        notification_enabled: false,
        group_id: this.settingGroupId,
        language: 'th',
        timezone: 'Asia/Bangkok',
      },
    }];
  }

  async listChats() {
    return this.groupId ? [{ chatId: this.groupId, name: LARK_NATIVE_AI_TARGET_GROUP_NAME }] : [];
  }

  async listWorkflows() {
    return structuredClone(this.workflows);
  }

  async getWorkflow({ workflowId }) {
    return structuredClone(this.workflows.find((item) => item.workflowId === workflowId));
  }
}

const notificationPlanner = async () => ({
  status: 'zero_drift',
  fields: Array.from({ length: 15 }, (_, index) => ({ fieldName: `f${index}` })),
  views: Array.from({ length: 6 }, (_, index) => ({ viewName: `v${index}` })),
});

test('reports exact readiness to create both approved workflows disabled', async () => {
  const result = await inspectLarkNativeAiWorkflowReadiness({
    client: new FakeClient(),
    notificationPlanner,
  });

  assert.equal(result.ok, true);
  assert.equal(result.status, 'ready_to_create_disabled_workflows');
  assert.equal(result.blockerCount, 0);
  assert.equal(result.workflows.plannedCreateDisabledCount, 2);
  assert.equal(result.destination.resolved, true);
  assert.equal(result.destination.settingsMatch, true);
  assert.equal(result.destination.rawChatIdPersisted, false);
  assert.equal(result.safety.workflowCreateCount, 0);
  assert.equal(result.safety.notificationCount, 0);
});

test('blocks missing settings destination without exposing a raw chat id', async () => {
  const result = await inspectLarkNativeAiWorkflowReadiness({
    client: new FakeClient({ settingGroupId: '' }),
    notificationPlanner,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.blockers.some(({ code }) => code === 'SETTINGS_GROUP_ID_MISSING'), true);
  assert.equal(result.settings.destinationKeyHash, null);
  assert.match(result.destination.destinationKeyHash, /^[a-f0-9]{64}$/u);
  assert.equal(JSON.stringify(result).includes('oc_verified_group'), false);
});

test('blocks an already enabled target workflow', async () => {
  const result = await inspectLarkNativeAiWorkflowReadiness({
    client: new FakeClient({
      workflows: [{
        workflowId: 'wf_existing',
        title: 'Eligible AI Run → Lark Group Notification',
        status: 'enabled',
      }],
    }),
    notificationPlanner,
  });

  assert.equal(result.status, 'blocked');
  assert.equal(result.blockers.some(({ code }) => code === 'TARGET_WORKFLOW_ALREADY_ENABLED'), true);
  assert.equal(result.safety.workflowStatusChangeCount, 0);
});
