import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('offline command emits complete blocked-for-live preview with zero remote action', () => {
  const script = resolve('scripts/lark-native-ai-disabled-configuration-preview.mjs');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.status, 'repository_preview_ready_live_configuration_blocked');
  assert.equal(output.mode, 'repository_only');
  assert.equal(output.generatedLocally, true);
  assert.equal(output.remoteActionCount, 0);
  assert.equal(output.workflows.length, 2);
  assert.equal(output.blockerCount, 3);
  assert.deepEqual(output.blockers.map(({ code }) => code), [
    'UI_AUTOMATION_API_IDENTITY_NOT_EXPOSED',
    'LARK_NATIVE_AI_OUTPUT_BINDING_UNPROVEN',
    'LARK_NATIVE_PAYLOAD_SHA256_UNPROVEN',
  ]);
  assert.equal(output.safety.remoteLarkRead, 0);
  assert.equal(output.safety.remoteLarkWrite, 0);
  assert.equal(output.safety.workflowCreate, 0);
  assert.equal(output.safety.workflowUpdate, 0);
  assert.equal(output.safety.workflowStatusChange, 0);
  assert.equal(output.safety.notificationSend, 0);
  assert.equal(output.safety.scheduleEnabled, false);
  assert.equal(output.safety.production, 'BLOCKED');
});

test('offline command rejects arguments instead of introducing an execute mode', () => {
  const script = resolve('scripts/lark-native-ai-disabled-configuration-preview.mjs');
  const result = spawnSync(process.execPath, [script, '--execute'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stderr);
  assert.equal(output.code, 'LARK_NATIVE_AI_DISABLED_CONFIGURATION_PREVIEW_ARGUMENT_UNSUPPORTED');
});

test('offline command contains no network, Workflow mutation or message transport', () => {
  const source = readFileSync(
    resolve('scripts/lark-native-ai-disabled-configuration-preview.mjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /requestBitableJson/u);
  assert.doesNotMatch(source, /workflows\/(?:enable|disable)/u);
  assert.doesNotMatch(source, /\/open-apis\/im\/v1\/messages/u);
  assert.doesNotMatch(source, /records\/batch_(?:create|update|delete)/u);
  assert.doesNotMatch(source, /wrangler/u);
});
