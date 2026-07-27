import assert from 'node:assert/strict';
import test from 'node:test';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { buildScheduledJobs, PRIMARY_SCHEDULE_CRON } from '../../apps/sync-worker/src/scheduled-jobs.js';
import { createWooCommerceActiveJobRouter } from '../../apps/sync-worker/src/woocommerce-active-job-router.js';
import { readWooCommerceIncrementalWatermark } from '../../packages/connectors/src/woocommerce/d1-woocommerce-incremental-watermark.js';

test('WooCommerce schedule creates one stable incremental job at Bangkok configured time', () => {
  const jobs = buildScheduledJobs({
    event: { cron: PRIMARY_SCHEDULE_CRON },
    scheduledAt: '2026-07-27T18:30:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_WOOCOMMERCE_ENABLED: 'true',
      MKT_WOOCOMMERCE_SYNC_TIME: '01:30',
    },
  });
  assert.equal(jobs[0].type, JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC);
  assert.equal(jobs[0].trigger, 'scheduled');
  assert.equal(jobs[0].operationId, 'scheduled-20260728-0130');
  assert.equal(jobs[0].workKey, 'woocommerce:scheduled-20260728-0130');
  assert.equal(jobs[0].fullReconciliation, false);
  assert.equal(jobs.at(-1).type, JOB_TYPES.RELIABILITY_MIRROR_DELIVER);
});

test('WooCommerce schedule emits no Business job outside configured time', () => {
  const jobs = buildScheduledJobs({
    event: { cron: PRIMARY_SCHEDULE_CRON },
    scheduledAt: '2026-07-27T18:35:00.000Z',
    env: { DEFAULT_TIMEZONE: 'Asia/Bangkok', MKT_SCHEDULE_WOOCOMMERCE_ENABLED: 'true', MKT_WOOCOMMERCE_SYNC_TIME: '01:30' },
  });
  assert.deepEqual(jobs.map((item) => item.type), [JOB_TYPES.RELIABILITY_MIRROR_DELIVER]);
});

test('active router injects D1 watermark only for scheduled WooCommerce operation', async () => {
  let observed;
  const router = createWooCommerceActiveJobRouter({
    readWatermark: async () => 1784000000000,
    processWooCommerce: async (input) => { observed = input.job.body; return 'ok'; },
    processFallback: async () => 'fallback',
  });
  const result = await router({
    job: { body: { type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC, trigger: 'scheduled' } },
    env: { MKT_STATE_DB: {} },
    getRuntimeConfig: () => ({ connectors: { woocommerce: { accountKey: 'chemistry_k' } } }),
  });
  assert.equal(result, 'ok');
  assert.equal(observed.modifiedAfter, 1784000000000);
});

test('D1 watermark chooses older dataset watermark and returns null until both exist', async () => {
  const db = (row) => ({ prepare: () => ({ bind: () => ({ first: async () => row }) }) });
  assert.equal(await readWooCommerceIncrementalWatermark({ db: db({ order_watermark: 200, product_watermark: 100 }), accountKey: 'chemistry_k' }), 100);
  assert.equal(await readWooCommerceIncrementalWatermark({ db: db({ order_watermark: 200, product_watermark: null }), accountKey: 'chemistry_k' }), null);
});
