import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

test('plan-only terminal prints one read-only exact command', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/lark-native-ai-workflow-readiness-terminal.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.planOnly, true);
  assert.equal(output.mutationBoundary, 'read_only');
  assert.match(output.exactCommand, /social-marketing-integration-woo-diag/u);
  assert.match(output.exactCommand, /MKT_CONNECTOR_TIKTOK_ENABLED=false/u);
  assert.match(output.exactCommand, /MKT_YOUTUBE_ANALYTICS_ENABLED=false/u);
  assert.match(output.exactCommand, /lark-native-ai-workflow-readiness-terminal\.mjs --execute/u);
  assert.equal(output.workflowCreateCount, 0);
  assert.equal(output.workflowUpdateCount, 0);
  assert.equal(output.workflowStatusChangeCount, 0);
  assert.equal(output.notificationCount, 0);
  assert.equal(output.scheduleEnabled, false);
  assert.equal(output.production, 'BLOCKED');
});
