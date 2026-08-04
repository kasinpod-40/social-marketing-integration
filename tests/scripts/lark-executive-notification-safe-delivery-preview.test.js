import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';

test('plan-only command emits blocker-free safe delivery preview', () => {
  const script = resolve('scripts/lark-executive-notification-safe-delivery-preview.mjs');
  const result = spawnSync(process.execPath, [script], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.contractVersion, 'lark_executive_notification_safe_delivery_v1');
  assert.equal(output.status, 'repository_safe_delivery_ready_remote_rollout_blocked');
  assert.equal(output.blockerCount, 0);
  assert.equal(output.generatedLocally, true);
  assert.equal(output.remoteActionCount, 0);
  assert.equal(output.safety.notificationSend, 0);
  assert.equal(output.safety.production, 'BLOCKED');
});

test('command has no execute mode', () => {
  const script = resolve('scripts/lark-executive-notification-safe-delivery-preview.mjs');
  const result = spawnSync(process.execPath, [script, '--execute'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stderr);
  assert.equal(output.code, 'LARK_EXECUTIVE_NOTIFICATION_SAFE_DELIVERY_ARGUMENT_UNSUPPORTED');
});

test('preview command contains no network, Queue, D1, Lark or deployment action', () => {
  const source = readFileSync(
    resolve('scripts/lark-executive-notification-safe-delivery-preview.mjs'),
    'utf8',
  );
  assert.doesNotMatch(source, /\bfetch\s*\(/u);
  assert.doesNotMatch(source, /\.prepare\s*\(/u);
  assert.doesNotMatch(source, /\.send\s*\(/u);
  assert.doesNotMatch(source, /wrangler/u);
  assert.doesNotMatch(source, /requestBitableJson/u);
});
