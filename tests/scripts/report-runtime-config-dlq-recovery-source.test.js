import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const operator = readFileSync(
  new URL('../../scripts/report-runtime-config-dlq-recovery.mjs', import.meta.url),
  'utf8',
);
const wrapper = readFileSync(
  new URL('../../scripts/report-runtime-window-repair-recover.mjs', import.meta.url),
  'utf8',
);

test('exact config-DLQ recovery is backup-first, stabilizes active deployment, records retry, sends once, restores safe, then closes metadata', () => {
  const backup = operator.indexOf("currentStage = 'backup-before-exact-retry'");
  const deploy = operator.indexOf("currentStage = 'deploy-and-stabilize-report-only-window'");
  const stability = operator.indexOf(
    'const stability = assertReportRuntimeConfigDlqStableDeployment',
    deploy,
  );
  const retryStage = operator.indexOf("currentStage = 'send-exact-replay-retry-once'", stability);
  const attempt = operator.indexOf('await writePrivateJson(sendAttemptPath', retryStage);
  const send = operator.indexOf('await sendQueueMessage', attempt);
  const verify = operator.indexOf("currentStage = 'verify-exact-retry-idempotency'", send);
  const restore = operator.indexOf("currentStage = 'restore-all-false'", verify);
  const close = operator.indexOf("currentStage = 'close-exact-retained-dlq-metadata'", restore);
  assert.ok(backup >= 0 && deploy > backup && stability > deploy && retryStage > stability);
  assert.ok(attempt > retryStage && send > attempt && verify > send && restore > verify && close > restore);
  assert.equal((operator.match(/await sendQueueMessage/gu) ?? []).length, 1);
  assert.match(operator, /if \(!retryAttempt\)/u);
  assert.match(operator, /verification-only-after-recorded-retry/u);
  assert.match(operator, /firstMaterializationRetried:\s*false/u);
});

test('exact config-DLQ recovery permits only retained DLQ metadata mutation after replay success and safe restore', () => {
  const closure = operator.slice(operator.indexOf("currentStage = 'close-exact-retained-dlq-metadata'"));
  assert.match(closure, /buildReportRuntimeConfigDlqClosureStatements/u);
  assert.doesNotMatch(operator, /DELETE\s+FROM/iu);
  assert.doesNotMatch(operator, /UPDATE\s+report_materializations/iu);
  assert.doesNotMatch(operator, /UPDATE\s+organic_content_/iu);
  assert.doesNotMatch(operator, /UPDATE\s+data_coverage_/iu);
});

test('one-command recovery finalizes current head, closes exact config DLQ, then resumes remaining windows', () => {
  const finalizer = wrapper.indexOf("runRequired('report-runtime-finalizer'");
  const exactRecovery = wrapper.indexOf("runRequired('3d-exact-config-dlq-recovery'");
  const remaining = wrapper.indexOf("runRequired('remaining-window-sequence'");
  assert.ok(finalizer >= 0 && exactRecovery > finalizer && remaining > exactRecovery);
  assert.match(wrapper, /REPORT_RUNTIME_CONFIG_DLQ_RECOVERY_CONFIRMATION/u);
  assert.match(wrapper, /CONFIRM_REPORT_RUNTIME_CONFIG_DLQ_RECOVERY/u);
  assert.doesNotMatch(wrapper, /report-runtime-lark-metric-null-repair\.mjs/u);
  assert.doesNotMatch(wrapper, /report-runtime-closeout-operator\.mjs/u);
});
