import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const operator = readFileSync(
  new URL('../../scripts/report-runtime-closeout-operator.mjs', import.meta.url),
  'utf8',
);
const wrapper = readFileSync(
  new URL('../../scripts/report-runtime-window-repair-recover.mjs', import.meta.url),
  'utf8',
);

test('normal Report closeout polls exact Lark integrity instead of row existence', () => {
  assert.match(operator, /pollReportRuntimeLarkIntegrity/u);
  assert.match(operator, /assertIntegrity:\s*\(state\) => assertD1LarkIntegrity\(d1, state\)/u);
  assert.doesNotMatch(operator, /function pollLarkCompletion/u);
  assert.match(operator, /firstLarkIntegrityPollAttempts/u);
  assert.match(operator, /replayLarkIntegrityPollAttempts/u);
});

test('3D recovery validates prior evidence before the missing replay send', () => {
  const validation = operator.indexOf('assertReportRuntimeCloseoutRecoveryEvidence');
  const readOnlyParity = operator.indexOf("currentStage = 'verify-current-d1-lark-integrity-read-only'");
  const recoveryBackup = operator.indexOf("currentStage = 'backup-before-missing-replay'");
  const replayAttempt = operator.indexOf("await writeAttempt('send-replay'", recoveryBackup);
  const replaySend = operator.indexOf(
    'await sendQueueMessage(context.auth, context.queue.queueId, selected.job)',
    replayAttempt,
  );
  assert.ok(validation >= 0 && readOnlyParity > validation && recoveryBackup > readOnlyParity);
  assert.ok(replayAttempt > recoveryBackup && replaySend > replayAttempt);
  assert.match(operator, /firstMaterializationRetried:\s*false/u);
  assert.match(operator, /replayAttemptedBeforeRecovery/u);
});

test('recorded replay recovery is verification-only and cannot send again', () => {
  const branch = operator.match(/if \(recoveryEvidence\.replayAttempted\) \{([\s\S]*?)\n  \} else \{/u)?.[1] ?? '';
  assert.match(branch, /pollD1Completion/u);
  assert.match(branch, /pollLarkIntegrity/u);
  assert.doesNotMatch(branch, /sendQueueMessage/u);
  assert.doesNotMatch(branch, /deployConfig/u);
});

test('recovery wrapper finalizes, recovers 3D, then resumes remaining windows', () => {
  const finalizer = wrapper.indexOf("runRequired('report-runtime-finalizer'");
  const recovery = wrapper.indexOf("runRequired('3d-exact-recovery'");
  const remaining = wrapper.indexOf("runRequired('remaining-window-sequence'");
  assert.ok(finalizer >= 0 && recovery > finalizer && remaining > recovery);
  assert.match(wrapper, /MKT_REPORT_RUNTIME_CLOSEOUT_RECOVERY_MODE/u);
  assert.match(wrapper, /RECOVER_REPORT_RUNTIME_3D_AND_CONTINUE/u);
  assert.doesNotMatch(wrapper, /queues.*send|wrangler.*deploy/iu);
});
