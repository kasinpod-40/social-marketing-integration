import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const operator = readFileSync(
  new URL('../../scripts/report-runtime-fresh-config-dlq-recovery.mjs', import.meta.url),
  'utf8',
);
const barrier = readFileSync(
  new URL('../../scripts/report-runtime-stabilized-closeout.mjs', import.meta.url),
  'utf8',
);
const wrapper = readFileSync(
  new URL('../../scripts/report-runtime-window-repair-recover.mjs', import.meta.url),
  'utf8',
);

test('exact 1D recovery validates zero prestate, backs up, stabilizes Active, writes attempts before two exact sends, then restores safe', () => {
  const exactEvidence = operator.indexOf('assertReportRuntimeFreshConfigDlqEvidence');
  const initialState = operator.indexOf('assertReportRuntimeFreshConfigDlqInitialState');
  const emptyLark = operator.indexOf('assertEmptyLarkTarget');
  const backup = operator.indexOf("currentStage = 'backup-before-exact-1d-retry'");
  const deploy = operator.indexOf("currentStage = 'deploy-and-stabilize-report-only-window'");
  const stable = operator.indexOf('const stability = await verifyStableActiveDeployment', deploy);
  const firstStage = operator.indexOf("currentStage = 'send-exact-1d-first-materialization-retry-once'", stable);
  const firstAttempt = operator.indexOf('await writePrivateJson(firstRetryAttemptPath', firstStage);
  const firstSend = operator.indexOf('await sendQueueMessage', firstAttempt);
  const firstVerify = operator.indexOf("currentStage = 'verify-exact-1d-first-materialization'", firstSend);
  const replayStage = operator.indexOf("currentStage = 'send-exact-1d-replay-once'", firstVerify);
  const replayAttempt = operator.indexOf('await writePrivateJson(replayAttemptPath', replayStage);
  const replaySend = operator.indexOf('await sendQueueMessage', replayAttempt);
  const replayVerify = operator.indexOf("currentStage = 'verify-exact-1d-replay-idempotency'", replaySend);
  const restore = operator.indexOf("currentStage = 'restore-all-false'", replayVerify);
  const closure = operator.indexOf("currentStage = 'close-exact-retained-1d-dlq-metadata'", restore);

  assert.ok(exactEvidence >= 0 && initialState > exactEvidence && emptyLark > initialState);
  assert.ok(backup > emptyLark && deploy > backup && stable > deploy);
  assert.ok(firstStage > stable && firstAttempt > firstStage && firstSend > firstAttempt);
  assert.ok(firstVerify > firstSend && replayStage > firstVerify);
  assert.ok(replayAttempt > replayStage && replaySend > replayAttempt && replayVerify > replaySend);
  assert.ok(restore > replayVerify && closure > restore);
  assert.equal((operator.match(/await sendQueueMessage/gu) ?? []).length, 2);
  assert.match(operator, /finally\s*\{[\s\S]*restore-all-false/u);
  assert.match(operator, /verification-only-after-recorded-1d-retry-and-replay/u);
});

test('exact 1D recovery closes only retained DLQ metadata after replay success and verified all-false restore', () => {
  const closure = operator.slice(operator.indexOf("currentStage = 'close-exact-retained-1d-dlq-metadata'"));
  assert.match(closure, /buildReportRuntimeFreshConfigDlqClosureStatements/u);
  assert.match(closure, /assertReportRuntimeFreshConfigDlqClosed/u);
  assert.match(closure, /write-verified-1d-closeout-summary/u);
  assert.doesNotMatch(operator, /DELETE\s+FROM/iu);
  assert.doesNotMatch(operator, /UPDATE\s+report_materializations/iu);
  assert.doesNotMatch(operator, /UPDATE\s+organic_content_/iu);
  assert.doesNotMatch(operator, /UPDATE\s+data_coverage_/iu);
  assert.match(operator, /originalFirstMaterializationFailedBeforeAdmission:\s*true/u);
  assert.match(operator, /retainedDlqRecoveryStatus/u);
});

test('stability barrier preserves execFile Promise shape, waits for three samples and surfaces instability through core verification', () => {
  const patch = barrier.indexOf('function stabilizedExecFile');
  const stabilize = barrier.indexOf('stabilizeDeployment(commandArgs', patch);
  const pending = barrier.indexOf('pendingBarrierError = barrierError', stabilize);
  const promiseContract = barrier.indexOf('attachExecFilePromiseContract(stabilizedExecFile)');
  const sync = barrier.indexOf('syncBuiltinESMExports()', promiseContract);
  const coreImport = barrier.indexOf("await import('./report-runtime-closeout-operator.mjs')", sync);
  assert.ok(patch >= 0 && stabilize > patch && pending > stabilize);
  assert.ok(promiseContract > patch && sync > promiseContract && coreImport > sync);
  assert.match(barrier, /exec-file-promise-contract\.js/u);
  assert.match(barrier, /DEFAULT_DELAYS_MS = Object\.freeze\(\[0, 10_000, 20_000\]\)/u);
  assert.match(barrier, /assertReportRuntimeStableActiveDeployment/u);
  assert.match(barrier, /pendingBarrierError && isDeploymentStatusCommand/u);
  assert.doesNotMatch(barrier, /queues\/.+\/messages/iu);
  assert.doesNotMatch(barrier, /d1['"],\s*['"]execute/iu);
});

test('one command reuses verified 3D, recovers 1D, runs stabilized 30D, then aggregates all four windows', () => {
  const finalizer = wrapper.indexOf("runRequired('report-runtime-finalizer'");
  const threeDay = wrapper.indexOf("'3d-exact-config-dlq-recovery'");
  const oneDay = wrapper.indexOf("'1d-exact-config-dlq-recovery'");
  const thirtyDay = wrapper.indexOf("'30d-stabilized-fresh-closeout'");
  const aggregate = wrapper.indexOf("'aggregate-verified-window-sequence'");
  assert.ok(finalizer >= 0 && threeDay > finalizer && oneDay > threeDay);
  assert.ok(thirtyDay > oneDay && aggregate > thirtyDay);
  assert.match(wrapper, /report-runtime-fresh-config-dlq-recovery\.mjs/u);
  assert.match(wrapper, /report-runtime-stabilized-closeout\.mjs/u);
  assert.match(wrapper, /MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS:\s*'30'/u);
  assert.match(wrapper, /fileExists\(join\(oneDayEvidence, 'report-runtime-closeout-summary\.json'\)\)/u);
  assert.doesNotMatch(wrapper, /queues\/.+\/messages|wrangler.*deploy/iu);
});
