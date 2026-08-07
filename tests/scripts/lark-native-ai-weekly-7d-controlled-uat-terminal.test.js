import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

const SCRIPT = resolve('scripts/lark-native-ai-weekly-7d-controlled-uat-terminal.mjs');
const SOURCE_LIB = resolve('scripts/lib/lark-native-ai-weekly-7d-controlled-uat.js');

test('plan exposes one exact current-main command and keeps AI/notification activation disabled', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.planOnly, true);
  assert.equal(output.contractVersion, 'lark_native_ai_weekly_7d_controlled_uat_v1');
  assert.match(output.exactCommand, /lark-native-ai-weekly-7d-controlled-uat-terminal\.mjs --execute/u);
  assert.equal(output.maximumAiRunWrites, 1);
  assert.equal(output.aiCallCount, 0);
  assert.equal(output.automationActivationCount, 0);
  assert.equal(output.notificationCount, 0);
  assert.equal(output.scheduleEnabled, false);
  assert.equal(output.production, 'BLOCKED');
});

test('rejects alternate execution arguments', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--apply'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stderr);
  assert.equal(output.code, 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_ARGUMENT_UNSUPPORTED');
  assert.equal(output.aiCallCount, 0);
  assert.equal(output.notificationCount, 0);
});

test('network source keeps one-row Lark-only mutation and contains no Notification/Workflow mutation path', () => {
  const terminal = readFileSync(SCRIPT, 'utf8');
  const source = readFileSync(SOURCE_LIB, 'utf8');
  const combined = `${terminal}\n${source}`;
  assert.match(combined, /records\/batch_create/u);
  assert.match(combined, /records\/batch_update/u);
  assert.match(combined, /\/workflows/u);
  assert.doesNotMatch(combined, /\/open-apis\/im\/v1\/messages/u);
  assert.doesNotMatch(combined, /workflows\/[^`'"\s]+\/(?:enable|disable)/u);
  assert.doesNotMatch(combined, /method:\s*['"](?:PUT|PATCH|DELETE)['"]/u);
  assert.doesNotMatch(combined, /wrangler\s+deploy/u);
  assert.doesNotMatch(combined, /queues?\/.*messages/u);
});
