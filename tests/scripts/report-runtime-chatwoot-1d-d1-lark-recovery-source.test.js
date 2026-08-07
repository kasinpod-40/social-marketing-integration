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

test('Chatwoot recovery applies retained metric-scope compatibility only in memory', () => {
  assert.match(source, /normalizeChatwoot1dRetainedMaterializationForProjection/u);
  assert.match(source, /period_end_snapshot_to_current_total_in_memory_only/u);
  assert.match(source, /projectionCompatibility/u);
  assert.match(source, /persistedMaterializationUnchanged:\s*true/u);
  assert.match(source, /assertChatwoot1dD1MaterializationUnchanged/u);
});

test('Chatwoot D1/Lark recovery proves D1 immutability and integrity before exact incident closure', () => {
  const d1UnchangedIndex = source.indexOf("currentStage = 'verify-retained-d1-unchanged'");
  const integrityIndex = source.indexOf("currentStage = 'verify-d1-lark-integrity'");
  const closureIndex = source.indexOf("currentStage = 'close-exact-retained-chatwoot-dlq-and-alert'");
  assert.ok(d1UnchangedIndex >= 0);
  assert.ok(integrityIndex > d1UnchangedIndex);
  assert.ok(closureIndex > integrityIndex);
  assert.match(source, /assertChatwoot1dIncidentClosed/u);
  assert.match(source, /buildChatwoot1dClosureStatements/u);
});
