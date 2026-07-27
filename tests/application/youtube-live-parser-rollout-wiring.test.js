import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const operatorPath = new URL(
  '../../scripts/youtube-dry-run-rollout-operator.mjs',
  import.meta.url,
);

test('YouTube rollout verification uses the reviewed live compatibility adapter', async () => {
  const source = await readFile(operatorPath, 'utf8');

  assert.match(
    source,
    /validateLiveRemoteYouTubeDeploymentContract[\s\S]*youtube-live-remote-contract-parser\.js/u,
  );
  assert.doesNotMatch(
    source,
    /validateRemoteYouTubeDeploymentContract[\s\S]*from '\.\/lib\/youtube-dry-run-rollout-operator\.js'/u,
  );

  const verifyStart = source.indexOf('async function verifyDeployment');
  const verifyEnd = source.indexOf('async function verifyDryRun');
  assert.ok(verifyStart >= 0 && verifyEnd > verifyStart);
  const verifySource = source.slice(verifyStart, verifyEnd);

  assert.match(verifySource, /validateLiveRemoteYouTubeDeploymentContract\(\{/u);
  assert.match(verifySource, /expectedQueueName: target\.mainQueueName/u);
  assert.match(verifySource, /response: mainConsumers/u);
  assert.match(verifySource, /expectedQueueName: target\.dlqName/u);
  assert.match(verifySource, /response: dlqConsumers/u);
  assert.match(verifySource, /expectedD1BindingName: 'MKT_STATE_DB'/u);
  assert.match(verifySource, /expectedDatabaseId: localContract\.databaseId/u);
  assert.match(verifySource, /expectedDatabaseName: target\.databaseName/u);
  assert.match(verifySource, /expectedRemoteFingerprint: localContract\.remoteContractFingerprint/u);

  for (const phase of [
    "case 'verify-safe-baseline':",
    "case 'verify-deployment':",
    "case 'verify-restore':",
  ]) {
    assert.ok(source.includes(phase), `${phase} must remain routed through verifyDeployment`);
  }
});

test('Queue reader preserves the raw scoped Wrangler response for exact command context', async () => {
  const source = await readFile(operatorPath, 'utf8');
  const start = source.indexOf('async function readQueueConsumers');
  const end = source.indexOf('async function readRemoteTriggerState');
  assert.ok(start >= 0 && end > start);
  const readerSource = source.slice(start, end);

  assert.match(readerSource, /'queues', 'consumer', 'list', queueName, '--json'/u);
  assert.match(readerSource, /return JSON\.parse\(output\);/u);
  assert.doesNotMatch(readerSource, /parsed\?\.result|parsed\?\.consumers|Array\.isArray\(parsed\)/u);
});
