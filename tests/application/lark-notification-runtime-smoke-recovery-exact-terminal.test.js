import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';

const TERMINAL = new URL(
  '../../scripts/lark-notification-runtime-smoke-recovery-exact-terminal.mjs',
  import.meta.url,
);

const source = await readFile(TERMINAL, 'utf8');

test('runtime smoke recovery terminal has no Queue admission or Worker deployment path', () => {
  assert.doesNotMatch(source, /\/queues\/.*\/messages/u);
  assert.doesNotMatch(source, /method:\s*['"]POST['"]/u);
  assert.doesNotMatch(source, /wrangler['"],\s*\['deploy'/u);
  assert.doesNotMatch(source, /TableSyncEngine/u);
  assert.doesNotMatch(source, /batchCreateRecords|batchUpdateRecords/u);
  assert.match(source, /queueAdmissionCount:\s*0/u);
  assert.match(source, /additionalMessageSendCount:\s*0/u);
  assert.match(source, /blindRerunAllowed:\s*false/u);
});

test('runtime smoke recovery is pinned to retained evidence and exact identity hash', () => {
  assert.match(source, /02-queue-send\.attempt\.json/u);
  assert.match(source, /01-read-only-preflight\.json/u);
  assert.match(source, /selectLarkNotificationRuntimeSmokeRecoveryAiRow/u);
  assert.match(source, /poll-existing-delivery-without-resend/u);
  assert.match(source, /smoke-test-recovery-summary\.json/u);
  assert.match(source, /--recover/u);
});
