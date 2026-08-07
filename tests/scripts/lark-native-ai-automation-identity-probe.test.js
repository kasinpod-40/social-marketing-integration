import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectLarkNativeAiAutomationIdentity,
  summarizeWorkflowTopology,
} from '../../scripts/lib/lark-native-ai-automation-identity-probe.js';

const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';

function workflow(id, title, status = 'Disable') {
  return { workflow_id: id, title, status };
}

function hydrated(id, title, steps) {
  return {
    workflow_id: id,
    title,
    steps,
  };
}

function client(overrides = {}) {
  const inventory = overrides.inventory ?? [
    workflow('wkfAI12345', AI_TITLE),
    workflow('wkfNOTIFY12345', NOTIFICATION_TITLE),
  ];
  const definitions = overrides.definitions ?? new Map([
    ['wkfAI12345', hydrated('wkfAI12345', AI_TITLE, [
      { type: 'AddRecordTrigger' },
      { type: 'Delay' },
    ])],
    ['wkfNOTIFY12345', hydrated('wkfNOTIFY12345', NOTIFICATION_TITLE, [
      { type: 'AddRecordTrigger' },
      { type: 'Delay' },
    ])],
  ]);
  return {
    async listAutomations() { return inventory; },
    async getWorkflow({ workflowId }) {
      const value = definitions.get(workflowId);
      if (!value) throw new Error(`missing fixture ${workflowId}`);
      return value;
    },
  };
}

test('resolves the two existing inactive Base UI Automations without creating replacements', async () => {
  const result = await inspectLarkNativeAiAutomationIdentity({ client: client() });
  assert.equal(result.ok, true);
  assert.equal(result.contractVersion, 'lark_native_ai_automation_identity_probe_v1');
  assert.equal(result.status, 'ready_for_inactive_configuration_review');
  assert.equal(result.inventoryCount, 2);
  assert.equal(result.resolvedTargetCount, 2);
  assert.equal(result.inactiveTargetCount, 2);
  assert.equal(result.blockerCount, 0);
  assert.deepEqual(result.items.map(({ title, state }) => [title, state]), [
    [AI_TITLE, 'existing_inactive'],
    [NOTIFICATION_TITLE, 'existing_inactive'],
  ]);
  assert.equal(result.safety.automationCreateCount, 0);
  assert.equal(result.safety.automationUpdateCount, 0);
  assert.equal(result.safety.automationStatusChangeCount, 0);
  assert.equal(result.safety.nativeAiCallCount, 0);
  assert.equal(result.safety.notificationCount, 0);
  assert.equal(result.safety.scheduleEnabled, false);
});

test('accepts official Bitable v1 decimal Automation workflow IDs without unsafe v3 hydration', async () => {
  let getCount = 0;
  const result = await inspectLarkNativeAiAutomationIdentity({
    client: {
      async listAutomations() {
        return [
          workflow('7293459700009998484', AI_TITLE),
          workflow('7293459700009998485', NOTIFICATION_TITLE),
        ];
      },
      async getWorkflow() {
        getCount += 1;
        throw new Error('decimal v1 Automation identity must not be forced through legacy v3 hydration');
      },
    },
  });
  assert.equal(result.status, 'ready_for_inactive_configuration_review');
  assert.equal(result.blockerCount, 0);
  assert.equal(result.resolvedTargetCount, 2);
  assert.equal(result.inactiveTargetCount, 2);
  assert.equal(getCount, 0);
  assert.deepEqual(result.items.map(({ workflowIdFormat, definitionSource, topology }) => ({
    workflowIdFormat,
    definitionSource,
    topology,
  })), [
    {
      workflowIdFormat: 'bitable_v1_decimal',
      definitionSource: 'bitable_v1_list_automations',
      topology: null,
    },
    {
      workflowIdFormat: 'bitable_v1_decimal',
      definitionSource: 'bitable_v1_list_automations',
      topology: null,
    },
  ]);
});

test('blocks a duplicate target title before any ambiguous definition is trusted', async () => {
  let getCount = 0;
  const result = await inspectLarkNativeAiAutomationIdentity({
    client: {
      async listAutomations() {
        return [
          workflow('wkfAI11111', AI_TITLE),
          workflow('wkfAI22222', AI_TITLE),
          workflow('wkfNOTIFY12345', NOTIFICATION_TITLE),
        ];
      },
      async getWorkflow({ workflowId }) {
        getCount += 1;
        return hydrated(workflowId, NOTIFICATION_TITLE, [{ type: 'Delay' }]);
      },
    },
  });
  assert.equal(result.status, 'blocked');
  assert.equal(result.blockers.some(({ code }) => code === 'TARGET_AUTOMATION_DUPLICATE'), true);
  assert.equal(getCount, 1);
});

test('blocks an active Automation but performs read-only hydration for evidence', async () => {
  const inventory = [
    workflow('wkfAI12345', AI_TITLE, 'Enable'),
    workflow('wkfNOTIFY12345', NOTIFICATION_TITLE, 'Disable'),
  ];
  const result = await inspectLarkNativeAiAutomationIdentity({ client: client({ inventory }) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.blockers.some(({ code }) => code === 'TARGET_AUTOMATION_ALREADY_ACTIVE'), true);
  assert.equal(result.items.find(({ title }) => title === AI_TITLE).state, 'existing_unsafe');
});

test('blocks a missing target instead of planning a replacement create', async () => {
  const inventory = [workflow('wkfAI12345', AI_TITLE)];
  const result = await inspectLarkNativeAiAutomationIdentity({ client: client({ inventory }) });
  assert.equal(result.status, 'blocked');
  assert.equal(result.blockers.some(({ code }) => code === 'TARGET_AUTOMATION_MISSING'), true);
  const missing = result.items.find(({ title }) => title === NOTIFICATION_TITLE);
  assert.equal(missing.state, 'missing');
  assert.equal(missing.count, 0);
  assert.equal(result.safety.automationCreateCount, 0);
});

test('rejects unsupported workflow identities before hydration', async () => {
  await assert.rejects(
    () => inspectLarkNativeAiAutomationIdentity({
      client: client({
        inventory: [
          workflow('not-a-workflow-id', AI_TITLE),
          workflow('wkfNOTIFY12345', NOTIFICATION_TITLE),
        ],
      }),
    }),
    (error) => error.code === 'LARK_NATIVE_AI_AUTOMATION_WORKFLOW_ID_INVALID',
  );
});

test('summarizes workflow topology without retaining step configuration', () => {
  const summary = summarizeWorkflowTopology({
    steps: [
      { type: 'AddRecordTrigger', data: { table_id: 'tbl_secret' } },
      { type: 'AI-generated text (GPT model)', data: { prompt: 'secret prompt' } },
      { type: 'Send Message', data: { chat_id: 'oc_secret' } },
    ],
  });
  assert.equal(summary.stepCount, 3);
  assert.equal(summary.hasTrigger, true);
  assert.equal(summary.hasAiGeneratedTextAction, true);
  assert.equal(summary.hasMessageAction, true);
  assert.equal(JSON.stringify(summary).includes('tbl_secret'), false);
  assert.equal(JSON.stringify(summary).includes('oc_secret'), false);
  assert.equal(JSON.stringify(summary).includes('secret prompt'), false);
});
