import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(
  'scripts/lark-notification-runtime-activation-exact-terminal.mjs',
  'utf8',
);
const contractSource = readFileSync(
  'scripts/lib/lark-notification-runtime-activation.js',
  'utf8',
);

test('runtime activation terminal exposes one activation and one rollback path', () => {
  assert.match(source, /--execute/u);
  assert.match(source, /--rollback/u);
  assert.match(source, /LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIRMATION/u);
  assert.match(source, /LARK_NOTIFICATION_RUNTIME_ROLLBACK_CONFIRMATION/u);
  assert.match(contractSource, /ACTIVATE_REVIEWED_EXECUTIVE_NOTIFICATION_RUNTIME/u);
  assert.match(contractSource, /RESTORE_NOTIFICATION_RUNTIME_ALL_FALSE/u);
  assert.match(source, /activation-summary\.json/u);
  assert.match(source, /rollback-summary\.json/u);
});

test('runtime activation preserves no-admission boundary', () => {
  assert.match(source, /queueAdmissionCount: 0/u);
  assert.match(source, /notificationProducerEnabled: false/u);
  assert.match(source, /scheduleActivationCount: 0/u);
  assert.match(source, /automationActivationCount: 0/u);
  assert.match(source, /production: 'BLOCKED'/u);
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /\.sendTextToChat\(/u);
  assert.doesNotMatch(source, /MKT_SYNC_QUEUE\.send/u);
});

test('activation fails closed if a notification schedule producer exists', () => {
  assert.match(source, /assert-no-notification-schedule-producer/u);
  assert.match(source, /LARK_NOTIFICATION_SEND/u);
  assert.match(source, /LARK_NOTIFICATION_RUNTIME_ACTIVATION_SCHEDULE_PRESENT/u);
});

test('activation retains automatic safe restore after any partial mutation', () => {
  assert.match(source, /failure-restore-report-settings/u);
  assert.match(source, /failure-restore-safe-worker/u);
  assert.match(source, /safeWorkerRestored/u);
  assert.match(source, /reportSettingsRestored/u);
});
