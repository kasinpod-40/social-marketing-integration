import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const operatorUrl = new URL(
  '../../scripts/woocommerce-final-completed-state-closeout.mjs',
  import.meta.url,
);

test('completed-state operator uses stage-aware exact-head checkpoints', async () => {
  const source = await readFile(operatorUrl, 'utf8');
  assert.match(source, /const REPLAY_CHECKPOINT = '05-idempotent-replay'/u);
  assert.match(source, /const INCREMENTAL_CHECKPOINT = '06-incremental-uat'/u);
  assert.match(source, /readEvidenceData\(REPLAY_CHECKPOINT\)/u);
  assert.match(source, /readEvidenceData\(INCREMENTAL_CHECKPOINT\)/u);
  assert.match(source, /assertCheckpointHead\(checkpoint\)/u);
  assert.match(source, /assertEvidenceHeadBinding\(target\.repositoryHead\)/u);
  assert.match(source, /checkpoint\.repositoryHead/u);
});

test('accepted Queue evidence without verified stage checkpoint blocks resend', async () => {
  const source = await readFile(operatorUrl, 'utf8');
  assert.match(source, /WOOCOMMERCE_COMPLETED_STATE_QUEUE_ACCEPTED_REVIEW_REQUIRED/u);
  assert.match(source, /WOOCOMMERCE_COMPLETED_STATE_QUEUE_ATTEMPT_UNCERTAIN/u);
  assert.match(source, /WOOCOMMERCE_COMPLETED_STATE_QUEUE_EVIDENCE_DRIFT/u);
  assert.match(source, /if \(send\.reusedEvidence\)/u);
  assert.match(source, /existing\.jobSha256 === jobSha256/u);
  assert.match(source, /existing\.operationId === operationId/u);
  assert.match(source, /existing\.minimumQueueAttempts/u);
});

test('incremental operation persists its original watermark and identity', async () => {
  const source = await readFile(operatorUrl, 'utf8');
  assert.match(source, /readOrCreateIncrementalOperation\(currentWatermark\)/u);
  assert.match(source, /modifiedAfter:\s*requireTimestamp\(currentWatermark/u);
  assert.match(source, /modifiedAfter:\s*operation\.modifiedAfter/u);
  assert.match(source, /repositoryHead:\s*target\.repositoryHead/u);
  assert.match(source, /completed-state-incremental:\$\{requestedAt\}/u);
});

test('operator reuses shared Queue topology and has no compatibility proxy dependency', async () => {
  const source = await readFile(operatorUrl, 'utf8');
  assert.match(source, /assertWooCommerceQueueConsumerTopology/u);
  assert.match(source, /woocommerce-queue-consumer-topology\.js/u);
  assert.doesNotMatch(source, /woocommerce-completed-state-queue-consumer-cli-output/u);
  assert.doesNotMatch(source, /woocommerce-final-completed-state-npx-proxy/u);
  assert.doesNotMatch(source, /MKT_WOOCOMMERCE_FINAL_NPX_PROXY/u);
});

test('operator requires the public launcher marker before Remote readiness', async () => {
  const source = await readFile(operatorUrl, 'utf8');
  const markerGate = source.indexOf('MKT_WOOCOMMERCE_COMPLETED_STATE_PUBLIC_LAUNCHER');
  const readiness = source.indexOf("currentStage = 'local-and-remote-readiness'");
  assert.ok(markerGate >= 0);
  assert.ok(readiness > markerGate);
});

test('D1 reads and completion polling remain bounded', async () => {
  const source = await readFile(operatorUrl, 'utf8');
  assert.match(source, /Object\.freeze\(\[0, 1_000, 2_000, 5_000, 10_000\]\)/u);
  assert.match(source, /const VERIFY_INTERVAL_MS = 5_000/u);
  assert.match(source, /const VERIFY_MAX_POLLS = 2_160/u);
  assert.match(source, /timeout:\s*120_000/u);
  assert.match(source, /WOOCOMMERCE_COMPLETED_STATE_D1_READ_FAILED/u);
  assert.match(source, /WOOCOMMERCE_COMPLETED_STATE_VERIFY_TIMEOUT/u);
});

test('mutable Worker ownership always retains automatic all-false restore', async () => {
  const source = await readFile(operatorUrl, 'utf8');
  const safeOwned = source.indexOf('latestSafeConfig = windows.safe');
  const uatDeploy = source.indexOf("currentStage = 'manual-uat-window'");
  const safeReleased = source.lastIndexOf('latestSafeConfig = null');
  assert.match(source, /automatic-safe-restore/u);
  assert.ok(safeOwned >= 0);
  assert.ok(uatDeploy > safeOwned);
  assert.ok(safeReleased > uatDeploy);
});