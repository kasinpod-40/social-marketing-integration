import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const operator = readFileSync(
  new URL('../../scripts/report-runtime-config-dlq-evidence-head-bridge.mjs', import.meta.url),
  'utf8',
);
const wrapper = readFileSync(
  new URL('../../scripts/report-runtime-window-repair-recover.mjs', import.meta.url),
  'utf8',
);

test('evidence bridge verifies ancestry and payload fix before backup and atomic local rewrite', () => {
  const ancestry = operator.indexOf('await assertSourceHeadAncestor(repository.head)');
  const payloadFix = operator.indexOf("currentStage = 'verify-current-payload-readback-fix'");
  const backup = operator.indexOf("currentStage = 'backup-original-retry-attempt'");
  const atomicWrite = operator.indexOf("currentStage = 'write-atomic-bridged-retry-attempt'");
  const readback = operator.indexOf("currentStage = 'verify-bridged-attempt-readback'");
  assert.ok(ancestry >= 0 && payloadFix > ancestry && backup > payloadFix);
  assert.ok(atomicWrite > backup && readback > atomicWrite);
  assert.match(operator, /merge-base.*--is-ancestor/su);
  assert.match(operator, /SELECT payload_json FROM report_materializations/u);
  assert.match(operator, /writeFile\(path, bytes, \{ flag: 'wx', mode: 0o600 \}\)/u);
  assert.match(operator, /rename\(temporaryPath, path\)/u);
});

test('evidence bridge is local-only and contains no runtime or provider mutation path', () => {
  assert.doesNotMatch(operator, /wrangler/iu);
  assert.doesNotMatch(operator, /sendQueueMessage|\/queues\/|messages/u);
  assert.doesNotMatch(operator, /d1\s+execute|d1\s+export/iu);
  assert.doesNotMatch(operator, /createLark|batchUpdateRecords|updateRecords/iu);
  assert.doesNotMatch(operator, /fetch\s*\(/u);
  assert.match(operator, /remoteWorkerDeploymentAttempted:\s*false/u);
  assert.match(operator, /queueMessageSent:\s*false/u);
  assert.match(operator, /remoteD1Mutated:\s*false/u);
  assert.match(operator, /larkMutated:\s*false/u);
});

test('one-command wrapper bridges exact retry evidence before verification-only recovery and remaining windows', () => {
  const finalizer = wrapper.indexOf("runRequired('report-runtime-finalizer'");
  const bridge = wrapper.indexOf("'3d-config-dlq-evidence-head-bridge'");
  const recovery = wrapper.indexOf("runRequired('3d-exact-config-dlq-recovery'");
  const remaining = wrapper.indexOf("runRequired('remaining-window-sequence'");
  assert.ok(finalizer >= 0 && bridge > finalizer && recovery > bridge && remaining > recovery);
  assert.match(wrapper, /REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE_CONFIRMATION/u);
  assert.match(wrapper, /CONFIRM_REPORT_RUNTIME_CONFIG_DLQ_EVIDENCE_HEAD_BRIDGE/u);
  assert.match(wrapper, /report-runtime-config-dlq-evidence-head-bridge\.mjs/u);
});
