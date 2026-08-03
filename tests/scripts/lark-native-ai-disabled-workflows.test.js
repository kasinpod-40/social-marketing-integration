import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyLarkNativeAiDisabledWorkflows,
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

test('creates exactly two empty disabled Workflow shells and verifies zero drift', async () => {
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
  assert.equal(client.createCalls.every(({ steps }) => steps.length === 0), true);
  assert.equal(client.createCalls.every(({ clientToken }) => /^mkt-[a-f0-9]{48}$/u.test(clientToken)), true);
  assert.equal(new Set(client.createCalls.map(({ clientToken }) => clientToken)).size, 2);
  assert.equal(client.workflows.every(({ status }) => status === 'disabled'), true);
  assert.equal(result.workflowStatusChangeCount, 0);
  assert.equal(result.notificationCount, 0);
  assert.equal(result.scheduleEnabled, false);
});

test('same-input replay performs zero creates', async () => {
  const client = new FakeClient();
  await applyLarkNativeAiDisabledWorkflows({
    client,
    repositoryHead: HEAD,
    sleep: async () => undefined,
  });
  client.createCalls = [];

  const replay = await applyLarkNativeAiDisabledWorkflows({
    client,
    repositoryHead: HEAD,
    sleep: async () => undefined,
  });
  assert.equal(replay.mode, 'already_zero_drift');
  assert.equal(replay.createdWorkflowCount, 0);
  assert.equal(client.createCalls.length, 0);
});

test('resumes a partial prior create by creating only the missing shell', async () => {
  const client = new FakeClient([{
    workflowId: 'wkf_existing',
    title: 'AI Materialization → MKT_AI_Report_Runs',
    status: 'draft',
    steps: [],
  }]);
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

test('blocks enabled, duplicate or configured target Workflows before create', async () => {
  const scenarios = [
    [{
      workflowId: 'wkf_enabled',
      title: 'AI Materialization → MKT_AI_Report_Runs',
      status: 'enabled',
      steps: [],
    }],
    [{
      workflowId: 'wkf_configured',
      title: 'AI Materialization → MKT_AI_Report_Runs',
      status: 'disabled',
      steps: [{ id: 'unsafe' }],
    }],
    [
      {
        workflowId: 'wkf_a',
        title: 'AI Materialization → MKT_AI_Report_Runs',
        status: 'disabled',
        steps: [],
      },
      {
        workflowId: 'wkf_b',
        title: 'AI Materialization → MKT_AI_Report_Runs',
        status: 'disabled',
        steps: [],
      },
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
