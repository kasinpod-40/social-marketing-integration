import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const TERMINAL = new URL(
  '../../scripts/lark-notification-runtime-smoke-test-exact-terminal.mjs',
  import.meta.url,
);
const CONTRACT = new URL(
  '../../scripts/lib/lark-notification-runtime-smoke-test.js',
  import.meta.url,
);

test('Runtime smoke terminal is one-shot manual admission and never deploys Worker or writes Settings', async () => {
  const [terminal, contract] = await Promise.all([
    readFile(TERMINAL, 'utf8'),
    readFile(CONTRACT, 'utf8'),
  ]);

  assert.match(contract, /CONFIRM_LARK_NOTIFICATION_RUNTIME_SMOKE_TEST/u);
  assert.match(contract, /SEND_ONE_RUNTIME_EXECUTIVE_NOTIFICATION/u);
  assert.match(contract, /JOB_TRIGGERS\.LARK_NOTIFICATION_RUNTIME/u);
  assert.match(contract, /notification-runtime-smoke:/u);
  assert.doesNotMatch(contract, /JOB_TRIGGERS\.LARK_NOTIFICATION_CONTROLLED_UAT/u);

  assert.match(terminal, /maximumQueueAdmissionCount: 1/u);
  assert.match(terminal, /workerDeploymentCount: 0/u);
  assert.match(terminal, /reportSettingWriteCount: 0/u);
  assert.match(terminal, /notificationProducerEnabled: false/u);
  assert.match(terminal, /nextGate: 'notification_admission_requires_separate_approval'/u);
  assert.doesNotMatch(terminal, /'wrangler', 'deploy',/u);
  assert.doesNotMatch(terminal, /writeSettingsState/u);
  assert.doesNotMatch(terminal, /--rollback/u);
  assert.doesNotMatch(terminal, /lark-notification-controlled-uat-exact-terminal/u);
  assert.doesNotMatch(terminal, /lark-notification-runtime-activation-exact-terminal/u);

  const sends = terminal.match(/await sendQueueOnce\(context, job\);/gu) ?? [];
  assert.equal(sends.length, 1);
  assert.equal(
    terminal.indexOf('queueAttemptRecorded = true;')
      < terminal.indexOf('await sendQueueOnce(context, job);'),
    true,
  );
  assert.equal(
    terminal.indexOf("'02-queue-send.attempt.json'")
      < terminal.indexOf('await sendQueueOnce(context, job);'),
    true,
  );
});

test('Runtime smoke terminal verifies current Runtime and observes stability without replay admission', async () => {
  const terminal = await readFile(TERMINAL, 'utf8');

  assert.match(terminal, /parseLarkNotificationRuntimeSmokeTestDeploymentStatus/u);
  assert.match(terminal, /assertLarkNotificationRuntimeSettingsState/u);
  assert.match(terminal, /assertLarkNotificationRuntimeSmokeTestDelivered/u);
  assert.match(terminal, /assertLarkNotificationRuntimeSmokeTestStable/u);
  assert.match(terminal, /bounded-no-additional-admission-observation/u);
  assert.match(terminal, /duplicateDeliveryRows/u);
  assert.doesNotMatch(terminal, /send-exact-replay/u);
  assert.doesNotMatch(terminal, /replay-send\.attempt/u);
});
