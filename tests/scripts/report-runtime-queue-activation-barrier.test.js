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
  assert.equal(value.scriptNameAuthority, 'cloudflare_consumer_response');
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

test('optional List fields are hydrated from exact Consumer detail without weakening topology checks', () => {
  const consumerId = consumer().consumer_id;
  const value = assertReviewedQueueConsumer({
    consumers: [{ consumer_id: consumerId }],
    detail: {
      consumer_id: consumerId,
      script_name: 'social-mkt-sync-worker',
      dead_letter_queue: 'social-mkt-sync-dlq',
      settings: consumer().settings,
    },
  });
  assert.equal(value.consumerId, consumerId);
  assert.equal(value.scriptName, 'social-mkt-sync-worker');
  assert.equal(value.scriptNameAuthority, 'cloudflare_consumer_response');
  assert.equal(value.settings.maxRetries, 5);
});

test('optional script_name may be absent while the reviewed Worker contract remains exact', () => {
  const consumerId = consumer().consumer_id;
  const topology = {
    consumer_id: consumerId,
    type: 'worker',
    queue_name: 'social-mkt-sync-jobs',
    dead_letter_queue: 'social-mkt-sync-dlq',
    settings: consumer().settings,
  };
  const value = assertReviewedQueueConsumer({
    consumers: [topology],
    detail: { ...topology },
  });
  assert.equal(value.consumerId, consumerId);
  assert.equal(value.scriptName, 'social-mkt-sync-worker');
  assert.equal(value.scriptNameAuthority, 'reviewed_worker_contract');
  assert.equal(value.settings.maxConcurrency, 1);

  assert.throws(
    () => assertReviewedQueueConsumer({
      consumers: [topology],
      detail: { ...topology, script_name: 'other-worker' },
    }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
  );
});

test('Queue-scoped optional fields may be absent but explicit identity drift remains rejected', () => {
  const consumerId = consumer().consumer_id;
  assert.equal(assertReviewedQueueConsumer({
    consumers: [{ consumer_id: consumerId }],
    embeddedConsumers: [consumer({ type: undefined, queue_name: undefined })],
    detail: { consumer_id: consumerId },
  }).consumerId, consumerId);

  assert.throws(
    () => assertReviewedQueueConsumer({
      consumers: [{ consumer_id: consumerId }],
      detail: consumer({ type: 'http_pull' }),
    }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
  );
  assert.throws(
    () => assertReviewedQueueConsumer({
      consumers: [{ consumer_id: consumerId }],
      detail: consumer({ queue_name: 'other-queue' }),
    }),
    (error) => error.code === 'REPORT_RUNTIME_CLOSEOUT_QUEUE_CONSUMER_INVALID',
  );
  assert.throws(
    () => assertReviewedQueueConsumer({
      consumers: [{ consumer_id: consumerId }],
      detail: consumer({ consumer_id: 'different-consumer' }),
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
  assert.match(
    source,
    /\/consumers\/\$\{encodeURIComponent\(consumerId\)\}/u,
  );
  assert.match(source, /const listedConsumerId = readSingleConsumerId\(consumers, 'list'\)/u);
  assert.match(source, /scriptNameAuthority: explicitScriptNames\.length/u);
});
