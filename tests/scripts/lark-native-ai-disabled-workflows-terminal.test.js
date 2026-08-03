import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('plan-only terminal prints one exact disabled Workflow command', () => {
  const script = resolve('scripts/lark-native-ai-disabled-workflows-terminal.mjs');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.planOnly, true);
  assert.equal(output.mutationBoundary, 'workflow_create_only');
  assert.equal(output.maximumWorkflowCreates, 2);
  assert.equal(output.workflows.length, 2);
  assert.equal(output.workflows.every(({ stepCount }) => stepCount === 0), true);
  assert.equal(output.workflows.every(({ expectedStatus }) => expectedStatus === 'disabled'), true);
  assert.match(output.exactCommand, /social-marketing-integration-woo-diag/u);
  assert.match(output.exactCommand, /MKT_CONNECTOR_TIKTOK_ENABLED=false/u);
  assert.match(output.exactCommand, /MKT_YOUTUBE_ANALYTICS_ENABLED=false/u);
  assert.match(output.exactCommand, /CREATE_LARK_NATIVE_AI_DISABLED_WORKFLOWS_V1/u);
  assert.match(output.exactCommand, /lark-native-ai-disabled-workflows-terminal\.mjs --execute/u);
  assert.equal(output.recordWriteCount, 0);
  assert.equal(output.workflowUpdateCount, 0);
  assert.equal(output.workflowStatusChangeCount, 0);
  assert.equal(output.automationEnabled, false);
  assert.equal(output.notificationCount, 0);
  assert.equal(output.scheduleEnabled, false);
  assert.equal(output.production, 'BLOCKED');
});

test('terminal source has no status-change, Record-write or message-send allowlist', () => {
  const source = readFileSync(
    resolve('scripts/lark-native-ai-disabled-workflows-terminal.mjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /workflows\/(?:enable|disable)/u);
  assert.doesNotMatch(source, /records\/batch_(?:create|update|delete)/u);
  assert.doesNotMatch(source, /\/open-apis\/im\/v1\/messages/u);
  assert.match(source, /workflowCollectionPath/u);
  assert.match(source, /steps:\s*\[\]/u);
  assert.match(source, /retryMode:\s*'none'/u);
});
