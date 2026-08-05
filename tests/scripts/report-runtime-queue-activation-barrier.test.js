import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  assertReviewedQueueConsumer,
} from '../../scripts/lib/report-runtime-closeout-reviewed-remote.js';

function consumer(overrides = {}) {
  return {
    consumer_id: '023e105f4ecef8ad9ca31a8372d0c353',
    type: 'worker',
    queue_name: 'social-mkt-sync-jobs',
    script_name: 'social-mkt-sync-worker',
    dead_letter_queue: 'social-mkt-sync-dlq',
    settings: {
      batch_size: 10,
      max_concurrency: 1,
      max_retries: 5,
      max_wait_time_ms: 30_000,
    },
    ...overrides,
  };
}

test('reviewed Queue requires exactly one matching Worker consumer and exact settings', () => {
  const value = assertReviewedQueueConsumer({ consumers: [consumer()] });
  assert.equal(value.scriptName, 'social-mkt-sync-worker');
  assert.equal(value.settings.batchSize, 10);
  assert.equal(value.settings.maxWaitTimeMs, 30_000);

  assert.throws(
    () => assertReviewedQueueConsumer({ consumers: [consumer(), consumer({ consumer_id: 'other' })] }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
  );
  assert.throws(
    () => assertReviewedQueueConsumer({ consumers: [consumer({ script_name: 'other-worker' })] }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
  );
  assert.throws(
    () => assertReviewedQueueConsumer({
      consumers: [consumer({ settings: { ...consumer().settings, max_wait_time_ms: 5_000 } })],
    }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
  );
});

test('Report execution uses three samples across a 120-second Queue activation barrier', () => {
  const source = readFileSync(
    new URL('../../scripts/lib/report-runtime-closeout-reviewed-remote.js', import.meta.url),
    'utf8',
  );
  assert.match(
    source,
    /QUEUE_ACTIVATION_STABILITY_DELAYS_MS = Object\.freeze\(\[0, 60_000, 60_000\]\)/u,
  );
  assert.match(
    source,
    /target\.activeTrueFlags\.includes\('MKT_REPORT_D1_READ_ENABLED'\)/u,
  );
  assert.match(source, /queueActivationBarrier: reportExecutionWindow/u);
  assert.match(source, /\/queues\/\$\{encodeURIComponent\(queueId\)\}\/consumers/u);
});
