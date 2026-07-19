import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  PRIMARY_SCHEDULE_CRON,
  YOUTUBE_SCHEDULE_CRON,
} from '../../apps/sync-worker/src/index.js';

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

test('main queue retry exhaustion routes to the configured DLQ', async () => {
  const configText = await readSyncWranglerExample();
  assert.match(
    configText,
    /"queue"\s*:\s*"social-mkt-sync-jobs"[\s\S]*?"max_retries"\s*:\s*5\b[\s\S]*?"dead_letter_queue"\s*:\s*"social-mkt-sync-dlq"/u,
  );
});

test('deployment config defines producer, main queue, DLQ, and scheduled cron', async () => {
  const configText = await readSyncWranglerExample();
  assert.match(configText, /"binding"\s*:\s*"MKT_SYNC_QUEUE"/);
  assert.match(configText, /"MKT_MAIN_QUEUE_NAME"\s*:\s*"social-mkt-sync-jobs"/);
  assert.match(configText, /"MKT_DLQ_QUEUE_NAME"\s*:\s*"social-mkt-sync-dlq"/);
  assert.equal(
    configText.includes(`"crons": ["${PRIMARY_SCHEDULE_CRON}", "${YOUTUBE_SCHEDULE_CRON}"]`),
    true,
  );
});

test('YouTube schedule and Analytics policy stay fail-closed in release examples', async () => {
  const configText = await readSyncWranglerExample();
  assert.match(configText, /"MKT_SCHEDULE_YOUTUBE_ENABLED"\s*:\s*"false"/);
  assert.match(configText, /"MKT_YOUTUBE_ANALYTICS_ENABLED"\s*:\s*"false"/);
  assert.match(configText, /"MKT_YOUTUBE_ANALYTICS_TIME"\s*:\s*"07:50"/);
  assert.match(configText, /"MKT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS"\s*:\s*"7"/);
});

test('deployment examples keep every connector disabled until environment UAT', async () => {
  const syncConfigText = await readSyncWranglerExample();
  const apiConfigText = await readFile(new URL('../../wrangler.example.jsonc', import.meta.url), 'utf8');

  for (const configText of [syncConfigText, apiConfigText]) {
    for (const connector of ['TIKTOK', 'FACEBOOK', 'INSTAGRAM', 'YOUTUBE', 'WOOCOMMERCE', 'CHATWOOT']) {
      assert.match(configText, new RegExp(`"MKT_CONNECTOR_${connector}_ENABLED"\\s*:\\s*"false"`));
    }
    assert.doesNotMatch(configText, /dev_ft_pumkin|ft\.pumkin|chemistry_k/u);
  }
});


test('sync deployment declares TikTok incremental controls but keeps them disabled by default', async () => {
  const configText = await readSyncWranglerExample();
  assert.match(configText, /"MKT_TIKTOK_INCREMENTAL_ENABLED"\s*:\s*"false"/);
  assert.match(configText, /"MKT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS"\s*:\s*"86400000"/);
});


test('report schedules stay disabled until Lark report schema and seed UAT are complete', async () => {
  const configText = await readSyncWranglerExample();
  assert.match(configText, /"MKT_SCHEDULE_DAILY_REPORT_ENABLED"\s*:\s*"false"/);
  assert.match(configText, /"MKT_SCHEDULE_WEEKLY_REPORT_ENABLED"\s*:\s*"false"/);
  assert.match(configText, /"MKT_DAILY_REPORT_TIME"\s*:\s*"08:10"/);
  assert.match(configText, /"MKT_WEEKLY_REPORT_TIME"\s*:\s*"08:15"/);
  assert.match(configText, /"LARK_TABLE_MKT_REPORT_METRIC_VALUES"/);
  assert.match(configText, /"LARK_TABLE_MKT_REPORT_TOP_CONTENT"/);
});

test('sync deployment example enables persisted Workers logs and traces for DEV observability', async () => {
  const configText = await readSyncWranglerExample();
  assert.match(configText, /"observability"\s*:\s*\{/);
  assert.match(configText, /"logs"\s*:\s*\{/);
  assert.match(configText, /"traces"\s*:\s*\{/);
  assert.match(configText, /"persist"\s*:\s*true/);
  const samplingMatches = configText.match(/"head_sampling_rate"\s*:\s*1\b/g) ?? [];
  assert.equal(samplingMatches.length, 2);
});
