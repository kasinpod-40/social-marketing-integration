import assert from 'node:assert/strict';
import test from 'node:test';
import {
  LARK_NATIVE_AI_DISABLED_WORKFLOW_DEFINITIONS,
} from '../../packages/config/src/lark-native-ai-disabled-workflows-contract.js';
import {
  applyLarkNativeAiDisabledWorkflows,
  inspectLarkNativeAiInactivePlaceholderSteps,
  planLarkNativeAiDisabledWorkflows,
} from '../../scripts/lib/lark-native-ai-disabled-workflows.js';

class FakeClient {
  constructor(workflows = []) {
    this.workflows = structuredClone(workflows);
    this.createCalls = [];
    this.listCalls = 0;
    this.getCalls = 0;
  }

  async listWorkflows() {
    this.listCalls += 1;
    return this.workflows.map(({ workflowId, title, status }) => ({
      workflowId, title, status,
    }));
  }

  async getWorkflow({ workflowId }) {
    this.getCalls += 1;
    const workflow = this.workflows.find((item) => item.workflowId === workflowId);
    if (!workflow) throw new Error('workflow not found');
    return structuredClone(workflow);
  }

  async createWorkflow(input) {
    this.createCalls.push(structuredClone(input));
    this.workflows.push({
      workflowId: `wkf_${this.workflows.length + 1}`,
      title: input.title,
      status: 'disabled',
      steps: structuredClone(input.steps),
    });
    return { ok: true };
  }
}

const HEAD = '18bb72741821a4068da0ef0b985b13502a6fd793';

function workflowFromDefinition(index, overrides = {}) {
  const definition = LARK_NATIVE_AI_DISABLED_WORKFLOW_DEFINITIONS[index];
  return {
    workflowId: `wkf_${index + 1}`,
    title: definition.title,
    status: 'inactive',
    steps: structuredClone(definition.steps),
    ...overrides,
  };
}

test('creates exactly two inactive placeholders and verifies zero drift', async () => {
  const client = new FakeClient();
  const result = await applyLarkNativeAiDisabledWorkflows({
    client,
    repositoryHead: HEAD,
    sleep: async () => undefined,
  });

  assert.equal(result.mode, 'applied');
  assert.equal(result.status, 'zero_drift');
  assert.equal(result.createdWorkflowCount, 2);
  assert.equal(client.createCalls.length, 2);
  assert.deepEqual(client.createCalls.map(({ title }) => title), [
    'AI Materialization → MKT_AI_Report_Runs',
    'Eligible AI Run → Lark Group Notification',
  ]);
  assert.equal(client.createCalls.every(({ steps }) => steps.length === 2), true);
  assert.equal(client.createCalls.every(({ steps }, index) => (
    inspectLarkNativeAiInactivePlaceholderSteps({
      steps,
      definition: LARK_NATIVE_AI_DISABLED_WORKFLOW_DEFINITIONS[index],
    }).ok
  )), true);
  assert.equal(client.createCalls.every(({ clientToken }) => /^mkt-[a-f0-9]{48}$/u.test(clientToken)), true);
  assert.equal(new Set(client.createCalls.map(({ clientToken }) => clientToken)).size, 2);
  assert.equal(client.workflows.every(({ status }) => status === 'disabled'), true);
  assert.equal(result.workflowStatusChangeCount, 0);
  assert.equal(result.notificationCount, 0);
  assert.equal(result.scheduleEnabled, false);
});

test('same-input replay performs zero creates for UI-style placeholders', async () => {
  const client = new FakeClient([
    workflowFromDefinition(0),
    workflowFromDefinition(1),
  ]);

  const replay = await applyLarkNativeAiDisabledWorkflows({
    client,
    repositoryHead: HEAD,
    sleep: async () => undefined,
  });
  assert.equal(replay.mode, 'already_zero_drift');
  assert.equal(replay.createdWorkflowCount, 0);
  assert.equal(client.createCalls.length, 0);
  assert.equal(replay.items.every(({ placeholderExact }) => placeholderExact === true), true);
});

test('accepts UI-generated step IDs while preserving exact semantic shape', async () => {
  const workflows = [0, 1].map((index) => {
    const workflow = workflowFromDefinition(index);
    workflow.steps[0].id = `ui_trigger_${index}`;
    workflow.steps[0].next = `ui_delay_${index}`;
    workflow.steps[1].id = `ui_delay_${index}`;
    delete workflow.steps[0].data.watched_field_name;
    return workflow;
  });
  const plan = await planLarkNativeAiDisabledWorkflows({
    client: new FakeClient(workflows),
  });
  assert.equal(plan.status, 'zero_drift');
  assert.equal(plan.existingInactivePlaceholderCount, 2);
});

test('resumes a partial prior create by creating only the missing placeholder', async () => {
  const client = new FakeClient([workflowFromDefinition(0)]);
  const result = await applyLarkNativeAiDisabledWorkflows({
    client,
    repositoryHead: HEAD,
    sleep: async () => undefined,
  });
  assert.equal(result.createdWorkflowCount, 1);
  assert.deepEqual(client.createCalls.map(({ title }) => title), [
    'Eligible AI Run → Lark Group Notification',
  ]);
});

test('blocks enabled, duplicate or action-bearing Workflow drift before create', async () => {
  const unsafeMessageStep = {
    id: 'send',
    type: 'LarkMessageAction',
    next: null,
    data: { receiver: [], send_to_everyone: false, content: [], btn_list: [] },
  };
  const scenarios = [
    [workflowFromDefinition(0, { status: 'enabled' })],
    [workflowFromDefinition(0, { steps: [unsafeMessageStep] })],
    [
      workflowFromDefinition(0, { workflowId: 'wkf_a' }),
      workflowFromDefinition(0, { workflowId: 'wkf_b' }),
    ],
  ];

  for (const workflows of scenarios) {
    const client = new FakeClient(workflows);
    const plan = await planLarkNativeAiDisabledWorkflows({ client });
    assert.equal(plan.status, 'blocked');
    await assert.rejects(
      () => applyLarkNativeAiDisabledWorkflows({
        client,
        repositoryHead: HEAD,
        sleep: async () => undefined,
      }),
      (error) => error.code === 'LARK_NATIVE_AI_DISABLED_WORKFLOWS_BLOCKED',
    );
    assert.equal(client.createCalls.length, 0);
  }
});
