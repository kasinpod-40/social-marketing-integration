import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE = await readFile(
  new URL('../../scripts/lark-weekly-7d-full-channel-notification-safe-terminal.mjs', import.meta.url),
  'utf8',
);

test('safe fresh send deploys and verifies current main before delegating Queue admission', () => {
  const deployIndex = SOURCE.indexOf("stage = 'deploy-current-main-notification-runtime'");
  const executeIndex = SOURCE.indexOf("stage = 'execute-existing-full-channel-one-shot'");
  assert.ok(deployIndex > 0);
  assert.ok(executeIndex > deployIndex);
  assert.match(SOURCE, /verifyDeployedVersion/u);
  assert.match(SOURCE, /trafficPercentage !== 100/u);
  assert.match(SOURCE, /scheduleActivationCount:\s*0/u);
});

test('incident repair binds retained dead letter and records replay evidence before exact replay', () => {
  const dlqIndex = SOURCE.indexOf("stage = 'load-exact-retained-terminal-failure'");
  const recordIndex = SOURCE.indexOf("stage = 'record-exact-repair-replay-attempt'");
  const replayIndex = SOURCE.indexOf("stage = 'replay-exact-retained-queue-payload-once'");
  assert.ok(dlqIndex > 0);
  assert.ok(recordIndex > dlqIndex);
  assert.ok(replayIndex > recordIndex);
  assert.match(SOURCE, /maximumRepairQueueReplayCount:\s*1/u);
  assert.match(SOURCE, /newNotificationIdentityCount:\s*0/u);
});

test('repair recovery is explicitly poll-only after replay attempt evidence', () => {
  assert.match(SOURCE, /--repair-recover/u);
  assert.match(SOURCE, /POLL_ONLY_REPAIR_RECOVERY/u);
  assert.match(SOURCE, /repairQueueReplayCount:\s*0/u);
  assert.match(SOURCE, /messageSendCountByRecovery:\s*0/u);
});
