import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(
  new URL('../../scripts/woocommerce-report-lark-incomplete-recovery.mjs', import.meta.url),
  'utf8',
);

test('WooCommerce Lark-incomplete recovery reuses the shared direct projection path', () => {
  assert.match(source, /writeDashboardMaterializationToLark/u);
  assert.match(source, /D1ReportMaterializationReader/u);
  assert.match(source, /LarkRecordRepository/u);
  assert.match(source, /TableSyncEngine/u);
  assert.match(source, /firstJobResent:\s*false/u);
  assert.match(source, /queueMessagesSent:\s*0/u);
});

test('WooCommerce Lark-incomplete recovery cannot deploy a Worker or send Queue work', () => {
  assert.doesNotMatch(source, /sendReviewedQueueMessage/u);
  assert.doesNotMatch(source, /sendQueueMessage/u);
  assert.doesNotMatch(source, /createReviewedRemoteRuntime/u);
  assert.doesNotMatch(source, /deployConfig/u);
  assert.doesNotMatch(source, /MKT_SYNC_QUEUE/u);
});
