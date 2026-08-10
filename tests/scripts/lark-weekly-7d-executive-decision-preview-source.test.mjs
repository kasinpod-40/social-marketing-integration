import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../../scripts/lark-weekly-7d-executive-decision-preview.mjs', import.meta.url), 'utf8');

test('fresh weekly decision terminal reuses latest 7D collector and explicit freshness guard', () => {
  assert.match(source, /collectLarkNativeAiWeekly7dControlledUatSource/);
  assert.match(source, /assertFreshWeekly7dDecisionPeriod/);
  assert.match(source, /buildLarkNativeAiWeekly7dControlledUat/);
  assert.match(source, /buildLarkWeeklyExecutiveFactualReport/);
  assert.doesNotMatch(source, /isExactAcceptedWeekly7dSource/);
  assert.doesNotMatch(source, /load-exact-accepted-v9-source/);
});

test('execute requires exact confirmation and triggers only failure_code', () => {
  assert.match(source, /CONFIRM_LARK_WEEKLY_7D_EXECUTIVE_DECISION_PREVIEW/);
  assert.match(source, /GENERATE_FRESH_WEEKLY_EXECUTIVE_DECISION_PREVIEW/);
  assert.match(source, /fields:\s*\{\s*failure_code:\s*LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_MARKER\s*\}/u);
  assert.match(source, /triggerWrittenFields:\s*triggerWriteCount\s*\?\s*\['failure_code'\]/u);
});

test('recovery is poll-only and blind retrigger is forbidden', () => {
  assert.match(source, /blind retrigger is forbidden/iu);
  assert.match(source, /poll-existing-native-ai-without-retrigger/);
  assert.match(source, /POLL_ONLY_RECOVERY/);
});

test('persisted row remains preview-only while notification render is in memory', () => {
  assert.match(source, /persistedPreviewMode:\s*true/u);
  assert.match(source, /persistedNotificationEligible:\s*false/u);
  assert.match(source, /persistedSentToGroup:\s*false/u);
  assert.match(source, /renderOnlyNotificationEligibility:\s*input\.messagePreview\s*\?\s*true\s*:\s*false/u);
  assert.match(source, /buildLarkExecutiveNotificationMessage/);
  assert.match(source, /assertFullChannelMessage/);
});

test('result evidence uses the reviewed ad candidate contract', () => {
  assert.match(source, /adCandidateNames:\s*context\.authority\.synthesis\.evidence\.evidence\.adCandidateNames/u);
  assert.doesNotMatch(source, /paidCandidateNames/u);
});

test('terminal contains no Queue admission, group send, Worker deploy, settings write, or Schedule activation path', () => {
  assert.match(source, /queueAdmissionCount:\s*0/u);
  assert.match(source, /messageSendCount:\s*0/u);
  assert.match(source, /workerDeploymentCount:\s*0/u);
  assert.match(source, /reportSettingWriteCount:\s*0/u);
  assert.match(source, /automaticNotificationProducer:\s*false/u);
  assert.match(source, /scheduleActivationCount:\s*0/u);
  assert.match(source, /production:\s*'BLOCKED'/u);
  assert.doesNotMatch(source, /sendQueueOnce|sendTextToChat|wrangler[^\n]*deploy|deployWorker|executePlan\([^)]*reportSettings/iu);
});

test('automatic Notification producer and Base Notification Automation remain independently blocked', () => {
  assert.match(source, /assert-no-automatic-notification-producer/);
  assert.match(source, /LARK_NOTIFICATION_SEND/);
  assert.match(source, /Exact Base Notification Automation must remain inactive/);
  assert.match(source, /notificationAutomationActivationCount:\s*0/u);
});
