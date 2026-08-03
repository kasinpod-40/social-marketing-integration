import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import test from 'node:test';

test('plan-only terminal prints one exact bounded destination-binding command', () => {
  const result = spawnSync(
    process.execPath,
    [resolve('scripts/lark-native-ai-destination-binding-terminal.mjs')],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.planOnly, true);
  assert.equal(output.targetGroupName, 'Social MKT Executive Reports');
  assert.equal(output.mutationBoundary, 'settings_group_id_only');
  assert.equal(output.maximumRecordWrites, 100);
  assert.match(output.exactCommand, /social-marketing-integration-woo-diag/u);
  assert.match(output.exactCommand, /MKT_CONNECTOR_TIKTOK_ENABLED=false/u);
  assert.match(output.exactCommand, /MKT_YOUTUBE_ANALYTICS_ENABLED=false/u);
  assert.match(output.exactCommand, /BIND_LARK_NATIVE_AI_DESTINATION_V1/u);
  assert.match(output.exactCommand, /lark-native-ai-destination-binding-terminal\.mjs --execute/u);
  assert.equal(output.workflowCreateCount, 0);
  assert.equal(output.notificationCount, 0);
  assert.equal(output.scheduleEnabled, false);
  assert.equal(output.production, 'BLOCKED');
});
