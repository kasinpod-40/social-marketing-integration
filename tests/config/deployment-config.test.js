import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

async function readSyncWranglerExample() {
  return readFile(new URL('../../wrangler.sync.example.jsonc', import.meta.url), 'utf8');
}

test('sync worker config uses root-relative entrypoint and migrations paths', async () => {
  const configText = await readSyncWranglerExample();
  assert.match(configText, /"main"\s*:\s*"\.\/apps\/sync-worker\/src\/index\.js"/);
  assert.match(configText, /"migrations_dir"\s*:\s*"\.\/migrations"/);
});

test('sync queue consumers stay at max_concurrency 1 during DEV UAT', async () => {
  const configText = await readSyncWranglerExample();
  const matches = configText.match(/"max_concurrency"\s*:\s*1\b/g) ?? [];
  assert.equal(matches.length, 2);
});

test('deployment config defines producer, main queue, DLQ, and scheduled cron', async () => {
  const configText = await readSyncWranglerExample();
  assert.match(configText, /"binding"\s*:\s*"MKT_SYNC_QUEUE"/);
  assert.match(configText, /"MKT_MAIN_QUEUE_NAME"\s*:\s*"social-mkt-sync-jobs"/);
  assert.match(configText, /"MKT_DLQ_QUEUE_NAME"\s*:\s*"social-mkt-sync-dlq"/);
  assert.match(configText, /"crons"\s*:\s*\["0 \* \* \* \*"\]/);
});

test('deployment examples enable only the implemented TikTok connector', async () => {
  const syncConfigText = await readSyncWranglerExample();
  const apiConfigText = await readFile(new URL('../../wrangler.example.jsonc', import.meta.url), 'utf8');

  for (const configText of [syncConfigText, apiConfigText]) {
    assert.match(configText, /"MKT_CONNECTOR_TIKTOK_ENABLED"\s*:\s*"true"/);
    for (const connector of ['FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'WOOCOMMERCE', 'CHATWOOT']) {
      assert.match(configText, new RegExp(`"MKT_CONNECTOR_${connector}_ENABLED"\\s*:\\s*"false"`));
    }
  }
});


test('sync deployment enables TikTok incremental checkpoints with a daily full reconciliation', async () => {
  const configText = await readSyncWranglerExample();
  assert.match(configText, /"MKT_TIKTOK_INCREMENTAL_ENABLED"\s*:\s*"true"/);
  assert.match(configText, /"MKT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS"\s*:\s*"86400000"/);
});
