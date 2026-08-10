import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const path = 'scripts/lark-weekly-7d-notification-admission-exact-terminal.mjs';
const source = await readFile(path, 'utf8');

test('weekly Notification exact terminal keeps one Queue POST behind immutable attempt evidence', () => {
  const attemptIndex = source.indexOf("'03-queue-send.attempt.json'");
  const sendStageIndex = source.indexOf("stage = 'send-one-weekly-runtime-queue-job'");
  const postMatches = source.match(/method:\s*'POST'/gu) ?? [];
  assert.ok(attemptIndex >= 0);
  assert.ok(sendStageIndex > attemptIndex);
  assert.equal(postMatches.length, 1);
  assert.match(source, /maximumQueueAdmissionCount:\s*1/u);
  assert.match(source, /blindRerunAllowedAfterThisFile:\s*false/u);
  assert.match(source, /sourceSettingsState:\s*context\.settingsAuthority\.state/u);
});

test('weekly Notification exact terminal uses a bounded runtime window and restores the current Worker baseline', () => {
  const activeStage = source.indexOf("stage = 'deploy-bounded-notification-runtime-window'");
  const queueAttemptStage = source.indexOf("stage = 'record-one-queue-attempt'");
  const restoreStage = source.indexOf("stage = 'restore-current-worker-runtime-baseline'");
  assert.ok(activeStage >= 0);
  assert.ok(queueAttemptStage > activeStage);
  assert.ok(restoreStage > queueAttemptStage);
  assert.match(source, /buildLarkWeekly7dNotificationRuntimeWindow/u);
  assert.match(source, /currentExecutionFlagsPreserved:\s*true/u);
  assert.match(source, /runtimeRestoredBlockedOff:\s*true/u);
  assert.match(source, /maximumWorkerDeploymentCount:\s*2/u);
  assert.doesNotMatch(source, /buildLarkNotificationRuntimeActivationWranglerConfig/u);
});

test('weekly Notification exact terminal preserves an already-active Settings baseline and only activates inactive Settings', () => {
  const ensureStage = source.indexOf("stage = 'ensure-exact-source-report-settings-active'");
  const queueAttemptStage = source.indexOf("stage = 'record-one-queue-attempt'");
  const restoreStage = source.indexOf("stage = 'restore-exact-source-report-settings'");
  assert.ok(ensureStage >= 0);
  assert.ok(queueAttemptStage > ensureStage);
  assert.ok(restoreStage > queueAttemptStage);
  assert.match(source, /settingsActivationAttempted\s*=\s*context\.settingsAuthority\.state\s*===\s*'inactive'/u);
  assert.match(source, /if \(settingsActivationAttempted\) \{\s*reportSettingWriteCount \+= await writeSettingsState\(context, true\)/u);
  assert.match(source, /if \(settingsActivationAttempted\) \{[\s\S]*writeSettingsState\(context, false\)/u);
  assert.match(source, /assertSettingsBaseline\(context\)/u);
  assert.match(source, /reportSettingsRemainActive:\s*context\.settingsAuthority\.state === 'active'/u);
  assert.match(source, /reportSettingsRestoredInactive:\s*context\.settingsAuthority\.state === 'inactive'/u);
  assert.match(source, /reportSettingsRestoredBaseline:\s*true/u);
});

test('weekly Notification exact terminal binds to the exact generated Fresh v4 source and never edits it', () => {
  assert.match(source, /loadFreshWeekly7dExecutiveDecisionNotificationSource/u);
  assert.match(source, /load-exact-fresh-executive-decision-source/u);
  assert.match(source, /assertSourceUnchanged/u);
  assert.match(source, /sourceDecisionMutationCount:\s*0/u);
  assert.match(source, /reconcile-dedicated-notification-ai-run/u);
  assert.doesNotMatch(source, /isExactAcceptedWeekly7dSource/u);
  assert.doesNotMatch(source, /load-exact-accepted-v9-source/u);
});

test('read-only Notification admission preview accepts only the exact observed Settings baseline and cannot mutate it', () => {
  const start = source.indexOf('async function previewAdmission()');
  const end = source.indexOf('async function executeAdmission()', start);
  assert.ok(start >= 0 && end > start);
  const preview = source.slice(start, end);
  assert.doesNotMatch(preview, /sendQueueOnce\s*\(/u);
  assert.doesNotMatch(preview, /deployAndVerifyRuntimeConfig\s*\(/u);
  assert.doesNotMatch(preview, /writeSettingsState\s*\(/u);
  assert.doesNotMatch(preview, /reconcileAdmissionRow\s*\(/u);
  assert.match(preview, /assertSettingsBaseline\(context\)/u);
  assert.match(preview, /sourceSettingsState:\s*context\.settingsAuthority\.state/u);
  assert.match(preview, /settingsMutationRequiredForExecute:\s*context\.settingsAuthority\.state === 'inactive'/u);
  assert.match(preview, /mode:\s*'READ_ONLY'/u);
  assert.match(preview, /queueAdmissionCount:\s*0/u);
  assert.match(preview, /messageSendCount:\s*0/u);
  assert.match(preview, /workerDeploymentCount:\s*0/u);
  assert.match(preview, /reportSettingWriteCount:\s*0/u);
});

test('exact reviewed full-channel message hash is required before Queue admission', () => {
  const previewIndex = source.indexOf("stage = 'validate-exact-delivery-request-and-message'");
  const parityIndex = source.indexOf('assertReviewedMessageParity(context, message)', previewIndex);
  const attemptIndex = source.indexOf("stage = 'record-one-queue-attempt'");
  assert.ok(previewIndex >= 0);
  assert.ok(parityIndex > previewIndex);
  assert.ok(attemptIndex > parityIndex);
  assert.match(source, /LARK_WEEKLY_7D_NOTIFICATION_MESSAGE_PARITY_FAILED/u);
  assert.match(source, /reviewedMessageSha256/u);
  assert.match(source, /Social MKT Weekly Executive Report — 7D/u);
});

test('recovery is no-resend and may only repair an inactive retained Settings baseline', () => {
  const start = source.indexOf('async function recoverAdmission()');
  const end = source.indexOf('async function prepare(mode)', start);
  assert.ok(start >= 0 && end > start);
  const recovery = source.slice(start, end);
  assert.doesNotMatch(recovery, /sendQueueOnce\s*\(/u);
  assert.doesNotMatch(recovery, /deployAndVerifyRuntimeConfig\s*\(/u);
  assert.match(recovery, /poll-existing-admission-without-resend/u);
  assert.match(recovery, /requireSettingsState\(attempt\.sourceSettingsState\)/u);
  assert.match(recovery, /Recovery will not reactivate Report Settings that became inactive after admission/u);
  assert.match(recovery, /stage = 'restore-retained-source-settings-baseline'/u);
  assert.match(recovery, /writeSettingsState\(context, false\)/u);
  assert.doesNotMatch(recovery, /writeSettingsState\(context, true\)/u);
  assert.match(recovery, /queueAdmissionCountByRecovery:\s*0/u);
  assert.match(recovery, /messageSendCountByRecovery:\s*0/u);
});

test('Base Notification Automation and automatic schedule producer remain blocked', () => {
  assert.match(source, /Exact Base Notification Automation must remain inactive/u);
  assert.match(source, /assert-no-automatic-notification-producer/u);
  assert.match(source, /scheduleActivationCount:\s*0/u);
  assert.match(source, /production:\s*'BLOCKED'/u);
});
