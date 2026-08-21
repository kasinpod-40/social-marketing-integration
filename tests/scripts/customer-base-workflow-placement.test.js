import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectOrApplyCustomerBaseWorkflowPlacement } from '../../scripts/lib/customer-base-workflow-placement.js';

function client({ placed = false, hasWorkflow = true } = {}) {
  let isPlaced = placed;
  const calls = [];
  return {
    appToken: 'app',
    calls,
    async requestBitableJson(path, options = {}) {
      calls.push({ path, method: options.method ?? 'GET', body: options.body ?? null });
      if (path.endsWith('/blocks/list')) {
        return {
          data: {
            blocks: [
              { block_id: 'folder', name: 'Setup Phase | Social MKT Data Hub' },
              ...(hasWorkflow
                ? [{
                  block_id: 'wkf_1',
                  name: 'wf',
                  parent_id: isPlaced ? 'folder' : null,
                }]
                : []),
            ],
          },
        };
      }
      if (path.endsWith('/blocks/wkf_1/move')) {
        assert.deepEqual(options.body, { parent_id: 'folder' });
        isPlaced = true;
        return { data: { block_id: 'wkf_1', parent_id: 'folder' } };
      }
      throw new Error(`unexpected ${path}`);
    },
  };
}

test('preview with no workflow verifies folder and plans placement after create', async () => {
  const targetClient = client({ hasWorkflow: false });
  const result = await inspectOrApplyCustomerBaseWorkflowPlacement({
    targetClient,
    workflowId: null,
    mode: 'preview',
  });
  assert.equal(result.status, 'CUSTOMER_BASE_WORKFLOW_PLACEMENT_READY_AFTER_CREATE');
  assert.equal(result.workflowPlacementMutationCount, 0);
});

test('preview outside folder is read-only', async () => {
  const targetClient = client({ placed: false });
  const result = await inspectOrApplyCustomerBaseWorkflowPlacement({
    targetClient,
    workflowId: 'wkf_1',
    mode: 'preview',
  });
  assert.equal(result.status, 'CUSTOMER_BASE_WORKFLOW_PLACEMENT_MOVE_READY');
  assert.equal(targetClient.calls.some((call) => call.path.endsWith('/move')), false);
});

test('apply moves only when needed and verifies readback', async () => {
  const targetClient = client({ placed: false });
  const result = await inspectOrApplyCustomerBaseWorkflowPlacement({
    targetClient,
    workflowId: 'wkf_1',
    mode: 'apply',
  });
  assert.equal(result.status, 'CUSTOMER_BASE_WORKFLOW_PLACEMENT_PASS_MOVED');
  assert.equal(result.workflowPlacementMutationCount, 1);
  assert.equal(targetClient.calls.filter((call) => call.path.endsWith('/move')).length, 1);
});
