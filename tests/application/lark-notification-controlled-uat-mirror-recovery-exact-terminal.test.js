import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import test from 'node:test';

const SCRIPT = 'scripts/lark-notification-controlled-uat-mirror-recovery-exact-terminal.mjs';

test('mirror recovery exact terminal is plan-only by default', () => {
  const result = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const output = JSON.parse(result.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.executed, false);
  assert.equal(output.contractVersion, 'lark_notification_controlled_uat_mirror_recovery_v1');
  assert.equal(output.retainedNotificationMessageCount, 1);
  assert.equal(output.maximumAdditionalMessageSendCount, 0);
  assert.equal(output.automationActivationCount, 0);
  assert.equal(output.scheduleActivationCount, 0);
  assert.equal(output.production, 'BLOCKED');
});

test('mirror recovery rejects unknown arguments before Remote work', () => {
  const result = spawnSync(process.execPath, [SCRIPT, '--apply'], { encoding: 'utf8' });
  assert.notEqual(result.status, 0);
  const output = JSON.parse(result.stderr);
  assert.equal(output.code, 'LARK_NOTIFICATION_MIRROR_RECOVERY_ARGUMENT_INVALID');
  assert.equal(output.additionalMessageSendCount, 0);
});

test('mirror recovery uses retained sent authority and has no direct D1 mutation path', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  assert.match(source, /status = 'sent'/u);
  assert.match(source, /mirror_status = 'failed'/u);
  assert.match(source, /buildLarkNotificationControlledUatJob/u);
  assert.match(source, /originalMessageIdHashStable/u);
  assert.match(source, /additionalMessageSendCount:\s*0/u);
  assert.doesNotMatch(source, /\b(?:UPDATE|INSERT|DELETE)\s+lark_notification_deliveries\b/iu);
  assert.doesNotMatch(source, /sendTextToChat/u);
  assert.doesNotMatch(source, /automation.*activate/iu);
  assert.doesNotMatch(source, /schedule.*activate/iu);
});
