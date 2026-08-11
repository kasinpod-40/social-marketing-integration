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
  assert.match(source, /sourceSettingsBaseline:\s*context\.settingsAuthority\.restorableBaseline/u);
  assert.match(source, /sourceSettingsBaselineSha256:\s*sha256\(JSON\.stringify\(context\.settingsAuthority\.restorableBaseline\)\)/u);
});

test('weekly Notification exact terminal resolves Settings from canonical source authority without historical Snapshots', () => {
  const start = source.indexOf("stage = 'resolve-runtime-settings-authority'");
  const end = source.indexOf("stage = 'resolve-local-runtime-topology'", start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /admission\.sourceReportSettingKeys/u);
  assert.match(block, /sourceAuthorities:\s*admission\.sourceAuthorities/u);
  assert.match(block, /resolveLarkWeekly7dNotificationSourceSettings/u);
  assert.doesNotMatch(block, /reportSnapshots|snapshotRows|report_id/u);
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

test('weekly Notification exact terminal activates only rows inactive in the observed per-setting baseline', () => {
  const ensureStage = source.indexOf("stage = 'ensure-exact-source-report-settings-active'");
  const queueAttemptStage = source.indexOf("stage = 'record-one-queue-attempt'");
  const restoreStage = source.indexOf("stage = 'restore-exact-source-report-settings'");
  assert.ok(ensureStage >= 0);
  assert.ok(queueAttemptStage > ensureStage);
  assert.ok(restoreStage > queueAttemptStage);
  assert.match(source, /settingsActivationAttempted\s*=\s*context\.settingsAuthority\.inactiveSettingCount\s*>\s*0/u);
  assert.match(source, /if \(settingsActivationAttempted\) \{\s*reportSettingWriteCount \+= await writeSettingsActive\(context\)/u);
  assert.match(source, /writeSettingsActive\(context\)[\s\S]*assertSettingsActive\(context\)/u);
  assert.match(source, /writeSettingsBaseline\([\s\S]*context\.settingsAuthority\.restorableBaseline/u);
  assert.match(source, /assertSettingsBaseline\(context\)/u);
  assert.match(source, /reportSettingsRemainMixed:\s*context\.settingsAuthority\.state === 'mixed'/u);
  assert.match(source, /reportSettingsRestoredBaseline:\s*true/u);
});

test('read-only Notification admission preview uses quiescent strict readback without mutating state', () => {
  const start = source.indexOf('async function previewAdmission()');
  const end = source.indexOf('async function executeAdmission()', start);
  assert.ok(start >= 0 && end > start);
  const preview = source.slice(start, end);
  const boundaryIndex = preview.indexOf("readD1StateAtQuiescence(context, 'preview')");
  const strictIndex = preview.indexOf('assertLarkWeekly7dNotificationAdmissionBaseline(previewBoundary.state)');
  assert.ok(boundaryIndex >= 0);
  assert.ok(strictIndex > boundaryIndex);
  assert.doesNotMatch(preview, /sendQueueOnce\s*\(/u);
  assert.doesNotMatch(preview, /deployAndVerifyRuntimeConfig\s*\(/u);
  assert.doesNotMatch(preview, /writeSettingsActive\s*\(/u);
  assert.doesNotMatch(preview, /writeSettingsBaseline\s*\(/u);
  assert.doesNotMatch(preview, /reconcileAdmissionRow\s*\(/u);
  assert.match(preview, /assertSettingsBaseline\(context\)/u);
  assert.match(preview, /sourceSettingsState:\s*context\.settingsAuthority\.state/u);
  assert.match(preview, /activeSourceSettingCount:\s*context\.settingsAuthority\.activeSettingCount/u);
  assert.match(preview, /inactiveSourceSettingCount:\s*context\.settingsAuthority\.inactiveSettingCount/u);
  assert.match(preview, /settingsMutationRequiredForExecute:\s*context\.settingsAuthority\.inactiveSettingCount > 0/u);
  assert.match(preview, /remoteQuiescenceVerified:\s*quiescence\.verified/u);
  assert.match(preview, /remoteQuiescenceRequiredZeroSamples:\s*quiescence\.requiredZeroSamples/u);
  assert.match(preview, /remoteQuiescentReadBoundaryAttempt:\s*previewBoundary\.boundaryAttempt/u);
  assert.match(preview, /mode:\s*'READ_ONLY'/u);
  assert.match(preview, /queueAdmissionCount:\s*0/u);
  assert.match(preview, /messageSendCount:\s*0/u);
  assert.match(preview, /workerDeploymentCount:\s*0/u);
  assert.match(preview, /reportSettingWriteCount:\s*0/u);
});

test('weekly Notification execution uses quiescent strict readback at every Remote D1 boundary', () => {
  const start = source.indexOf('async function executeAdmission()');
  const end = source.indexOf('async function recoverAdmission()', start);
  assert.ok(start >= 0 && end > start);
  const execute = source.slice(start, end);
  const preflight = execute.indexOf("readD1StateAtQuiescence(context, 'execute-preflight')");
  const settings = execute.indexOf("stage = 'ensure-exact-source-report-settings-active'");
  const preDeploy = execute.indexOf("readD1StateAtQuiescence(context, 'execute-pre-deploy')");
  const deploy = execute.indexOf("stage = 'deploy-bounded-notification-runtime-window'");
  const postDeploy = execute.indexOf("readD1StateAtQuiescence(context, 'execute-post-deploy')");
  const preAdmission = execute.indexOf("readD1StateAtQuiescence(context, 'execute-pre-admission')");
  const attempt = execute.indexOf("stage = 'record-one-queue-attempt'");
  const stability = execute.indexOf("readD1StateAtQuiescence(context, 'execute-stability')");
  assert.ok(preflight >= 0);
  assert.ok(settings > preflight);
  assert.ok(preDeploy > settings);
  assert.ok(deploy > preDeploy);
  assert.ok(postDeploy > deploy);
  assert.ok(preAdmission > postDeploy);
  assert.ok(attempt > preAdmission);
  assert.ok(stability > attempt);
  assert.match(execute, /verify-pre-deploy-strict-baseline/u);
  assert.match(execute, /verify-pre-admission-strict-baseline/u);
});

test('Remote quiescence is read-only, requires three consecutive zero-lock samples, and exposes no lock identity', () => {
  const start = source.indexOf('function readActiveLockCount(context)');
  const end = source.indexOf('function isActiveLockOnlyRemoteStateError(error)', start);
  assert.ok(start >= 0 && end > start);
  const quiescence = source.slice(start, end);
  assert.match(source, /const QUIESCENCE_REQUIRED_ZERO_SAMPLES = 3;/u);
  assert.match(quiescence, /SELECT COUNT\(\*\) AS active_locks FROM sync_locks WHERE expires_at > unixepoch\('now'\) \* 1000;/u);
  assert.match(quiescence, /consecutiveZeroSamples = activeLocks === 0 \? consecutiveZeroSamples \+ 1 : 0/u);
  assert.match(quiescence, /consecutiveZeroSamples >= QUIESCENCE_REQUIRED_ZERO_SAMPLES/u);
  assert.match(quiescence, /LARK_WEEKLY_7D_NOTIFICATION_REMOTE_QUIESCENCE_TIMEOUT/u);
  assert.doesNotMatch(quiescence, /INSERT|UPDATE|DELETE|method:\s*'POST'/u);
  assert.doesNotMatch(quiescence, /lock_key|owner_id|ownerId|work_key/u);
});

test('quiescent strict read retries only an activeLocks-only race and remains bounded', () => {
  const predicateStart = source.indexOf('function isActiveLockOnlyRemoteStateError(error)');
  const helperStart = source.indexOf('async function readD1StateAtQuiescence(context, label)');
  const helperEnd = source.indexOf('function readD1State(context)', helperStart);
  assert.ok(predicateStart >= 0 && helperStart > predicateStart && helperEnd > helperStart);
  const predicate = source.slice(predicateStart, helperStart);
  const helper = source.slice(helperStart, helperEnd);
  assert.match(source, /const QUIESCENT_READ_MAX_BOUNDARY_ATTEMPTS = 3;/u);
  assert.match(predicate, /LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_REMOTE_STATE_INVALID/u);
  assert.match(predicate, /error\.details\.invalid\.length === 1/u);
  assert.match(predicate, /error\.details\.invalid\[0\] === 'activeLocks'/u);
  assert.match(helper, /boundaryAttempt <= QUIESCENT_READ_MAX_BOUNDARY_ATTEMPTS/u);
  assert.match(helper, /awaitRemoteQuiescence\(context, `\$\{label\}-boundary-\$\{boundaryAttempt\}`\)/u);
  assert.match(helper, /state:\s*readD1State\(context\)/u);
  assert.match(helper, /if \(!isActiveLockOnlyRemoteStateError\(error\)\) throw error/u);
  assert.match(helper, /LARK_WEEKLY_7D_NOTIFICATION_QUIESCENT_READ_RACE_EXHAUSTED/u);
  assert.doesNotMatch(helper, /INSERT|UPDATE|DELETE|method:\s*'POST'/u);
  assert.doesNotMatch(helper, /lock_key|owner_id|ownerId|work_key/u);
});

test('strict admission readback remains unchanged behind the quiescent helper', () => {
  const start = source.indexOf('function readD1State(context)');
  const end = source.indexOf('async function pollDelivered(context, before)', start);
  assert.ok(start >= 0 && end > start);
  const strictReadback = source.slice(start, end);
  assert.match(strictReadback, /buildLarkWeekly7dNotificationAdmissionReadbackSql/u);
  assert.match(strictReadback, /normalizeLarkWeekly7dNotificationAdmissionReadback/u);
});

test('delivery polling never bypasses quiescent strict readback', () => {
  const start = source.indexOf('async function pollDelivered(context, before)');
  const end = source.indexOf('async function pollExistingDelivered(context)', start);
  assert.ok(start >= 0 && end > start);
  const poll = source.slice(start, end);
  assert.match(poll, /readD1StateAtQuiescence\(context, `delivery-poll-\$\{index\}`\)/u);
  assert.doesNotMatch(poll, /last = readD1State\(context\)/u);
});

test('recovery also uses quiescent strict reads and still never resends or deploys', () => {
  const start = source.indexOf('async function recoverAdmission()');
  const end = source.indexOf('async function prepare(mode)', start);
  assert.ok(start >= 0 && end > start);
  const recovery = source.slice(start, end);
  assert.doesNotMatch(recovery, /sendQueueOnce\s*\(/u);
  assert.doesNotMatch(recovery, /deployAndVerifyRuntimeConfig\s*\(/u);
  assert.doesNotMatch(recovery, /writeSettingsActive\s*\(/u);
  assert.match(recovery, /poll-existing-admission-without-resend/u);
  assert.match(recovery, /readD1StateAtQuiescence\(context, 'recovery-stability'\)/u);
  assert.match(recovery, /normalizeLarkWeekly7dNotificationRestorableBaseline\([\s\S]*attempt\.sourceSettingsBaseline/u);
  assert.match(recovery, /sourceSettingsBaselineSha256/u);
  assert.match(recovery, /assertRecoverySettingsRestoreBoundary\(context, retainedBaseline\)/u);
  assert.match(recovery, /Recovery will not reactivate Report Settings that became inactive after admission/u);
  assert.match(recovery, /stage = 'restore-retained-source-settings-baseline'/u);
  assert.match(recovery, /writeSettingsBaseline\(context, retainedBaseline\)/u);
  assert.match(recovery, /queueAdmissionCountByRecovery:\s*0/u);
  assert.match(recovery, /messageSendCountByRecovery:\s*0/u);
});

test('recovery initial delivery discovery uses quiescent strict readback', () => {
  const start = source.indexOf('async function pollExistingDelivered(context)');
  const end = source.indexOf('async function sendQueueOnce(context, job)', start);
  assert.ok(start >= 0 && end > start);
  const recoveryPoll = source.slice(start, end);
  assert.match(recoveryPoll, /readD1StateAtQuiescence\(context, 'recovery-initial-delivery'\)/u);
  assert.doesNotMatch(recoveryPoll, /const first = readD1State\(context\)/u);
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

test('Settings transition writes only AI/Notification flags and never persists destination identifiers', () => {
  const start = source.indexOf('async function writeSettingsActive(context)');
  const end = source.indexOf('async function reconcileAdmissionRow(context)', start);
  assert.ok(start >= 0 && end > start);
  const transition = source.slice(start, end);
  assert.match(transition, /report_setting_key/u);
  assert.match(transition, /ai_enabled/u);
  assert.match(transition, /notification_enabled/u);
  assert.doesNotMatch(transition, /group_id|groupId/u);
});

test('Base Notification Automation and automatic schedule producer remain blocked', () => {
  assert.match(source, /Exact Base Notification Automation must remain inactive/u);
  assert.match(source, /assert-no-automatic-notification-producer/u);
  assert.match(source, /scheduleActivationCount:\s*0/u);
  assert.match(source, /production:\s*'BLOCKED'/u);
});
