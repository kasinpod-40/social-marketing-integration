import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const SOURCE = await readFile(
  new URL('../../scripts/lark-weekly-7d-full-channel-notification.mjs', import.meta.url),
  'utf8',
);

test('full-channel terminal has explicit preview execute and poll-only recovery modes', () => {
  assert.match(SOURCE, /--preview/u);
  assert.match(SOURCE, /--execute/u);
  assert.match(SOURCE, /--recover/u);
  assert.match(SOURCE, /POLL_ONLY_RECOVERY/u);
  assert.match(SOURCE, /blindRerunAllowedAfterThisFile:\s*false/u);
});

test('preview is read-only and execute records immutable Queue evidence before POST', () => {
  const recordIndex = SOURCE.indexOf("stage = 'record-one-queue-attempt'");
  const sendIndex = SOURCE.indexOf("stage = 'send-one-existing-runtime-queue-job'");
  assert.ok(recordIndex > 0);
  assert.ok(sendIndex > recordIndex);
  assert.match(SOURCE, /recordWriteCount:\s*0/u);
  assert.match(SOURCE, /queueAdmissionCount:\s*0/u);
});

test('terminal reuses existing runtime without Worker deploy or Report Settings mutation', () => {
  assert.doesNotMatch(SOURCE, /wrangler['"],\s*['"]deploy/u);
  assert.doesNotMatch(SOURCE, /writeSettingsState/u);
  assert.doesNotMatch(SOURCE, /updateMany\(/u);
  assert.match(SOURCE, /workerDeploymentCount:\s*0/u);
  assert.match(SOURCE, /reportSettingWriteCount:\s*0/u);
});

test('terminal locks accepted V9 to the exact collected source IDs and period', () => {
  assert.match(SOURCE, /collectLarkNativeAiWeekly7dControlledUatSource/u);
  assert.match(SOURCE, /assertLarkWeekly7dFullChannelSourceAlignment/u);
  assert.match(SOURCE, /sourceV9MutationCount:\s*0/u);
});

test('terminal refuses automatic producer or Base Notification Automation activation', () => {
  assert.match(SOURCE, /scheduled-jobs\.js/u);
  assert.match(SOURCE, /LARK_NOTIFICATION_SEND/u);
  assert.match(SOURCE, /Base Notification Automation must remain inactive/u);
  assert.match(SOURCE, /notificationProducerEnabled:\s*false/u);
  assert.match(SOURCE, /scheduleActivationCount:\s*0/u);
  assert.doesNotMatch(SOURCE, /workflows[^\n]+(?:POST|PATCH|PUT|DELETE)/u);
});
