import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(
  'scripts/report-runtime-chatwoot-1d-d1-lark-recovery.mjs',
  'utf8',
);

test('Chatwoot D1/Lark recovery reuses shared writer without Queue or Worker deployment paths', () => {
  assert.match(source, /writeDashboardMaterializationToLark/u);
  assert.match(source, /D1ReportMaterializationReader/u);
  assert.match(source, /LarkRecordRepository/u);
  assert.match(source, /TableSyncEngine/u);
  assert.match(source, /queueMessagesSent:\s*0/u);
  assert.match(source, /workerDeploymentCount:\s*0/u);
  assert.doesNotMatch(source, /sendReviewedQueueMessage/u);
  assert.doesNotMatch(source, /resolveReviewedQueue/u);
  assert.doesNotMatch(source, /deployConfig\(/u);
  assert.doesNotMatch(source, /DELETE\s+FROM/iu);
});

test('Chatwoot D1/Lark recovery closes the exact retained incident only after integrity verification', () => {
  const integrityIndex = source.indexOf("currentStage = 'verify-d1-lark-integrity'");
  const closureIndex = source.indexOf("currentStage = 'close-exact-retained-chatwoot-dlq-and-alert'");
  assert.ok(integrityIndex >= 0);
  assert.ok(closureIndex > integrityIndex);
  assert.match(source, /assertChatwoot1dIncidentClosed/u);
  assert.match(source, /buildChatwoot1dClosureStatements/u);
});
