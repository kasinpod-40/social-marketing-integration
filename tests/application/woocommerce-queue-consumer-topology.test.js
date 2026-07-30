import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertWooCommerceQueueConsumerTopology,
  normalizeWooCommerceQueueConsumer,
} from '../../scripts/lib/woocommerce-queue-consumer-topology.js';

const MAIN_QUEUE = 'social-mkt-sync-jobs';
const DLQ = 'social-mkt-sync-dlq';
const EXPECTED_MAIN = Object.freeze({
  maxConcurrency: 1,
  maxBatchSize: 10,
  maxBatchTimeout: 30,
  maxRetries: 5,
  deadLetterQueue: DLQ,
});

test('normalizes current Wrangler Queue consumer settings contract', () => {
  const observed = normalizeWooCommerceQueueConsumer({
    queue_name: MAIN_QUEUE,
    settings: {
      max_concurrency: 1,
      batch_size: 10,
      max_wait_time_ms: 30_000,
      max_retries: 5,
      dead_letter_queue: DLQ,
    },
  });

  assert.deepEqual(observed, EXPECTED_MAIN);
});

test('preserves reviewed legacy aliases without requiring them', () => {
  const observed = normalizeWooCommerceQueueConsumer({
    queue_name: MAIN_QUEUE,
    settings: {
      max_concurrency: '1',
      max_batch_size: '10',
      max_batch_timeout: '30',
      max_retries: '5',
      dead_letter_queue: DLQ,
    },
  });

  assert.deepEqual(observed, EXPECTED_MAIN);
});

test('accepts matching modern and legacy aliases and rejects conflicts', () => {
  assert.deepEqual(normalizeWooCommerceQueueConsumer({
    settings: {
      max_concurrency: 1,
      batch_size: 10,
      max_batch_size: 10,
      max_wait_time_ms: 30_000,
      max_batch_timeout: 30,
      max_retries: 5,
      dead_letter_queue: DLQ,
    },
  }), EXPECTED_MAIN);

  assert.throws(
    () => normalizeWooCommerceQueueConsumer({
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_batch_size: 20,
        max_wait_time_ms: 30_000,
        max_retries: 5,
      },
    }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID',
  );

  assert.throws(
    () => normalizeWooCommerceQueueConsumer({
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_wait_time_ms: 30_000,
        max_batch_timeout: 31,
        max_retries: 5,
      },
    }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID',
  );
});

test('fails closed for sub-second wait values, missing settings and wrong topology', () => {
  assert.throws(
    () => normalizeWooCommerceQueueConsumer({
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_wait_time_ms: 30_500,
        max_retries: 5,
      },
    }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID',
  );

  assert.throws(
    () => normalizeWooCommerceQueueConsumer({ settings: {} }),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID',
  );

  assert.throws(
    () => assertWooCommerceQueueConsumerTopology([
      {
        queue_name: MAIN_QUEUE,
        settings: {
          max_concurrency: 2,
          batch_size: 10,
          max_wait_time_ms: 30_000,
          max_retries: 5,
          dead_letter_queue: DLQ,
        },
      },
    ], MAIN_QUEUE, EXPECTED_MAIN),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID'
      && error.details?.field === 'maxConcurrency',
  );
});

test('selects exactly one named consumer and supports null DLQ topology', () => {
  const observed = assertWooCommerceQueueConsumerTopology([
    {
      queue_name: MAIN_QUEUE,
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_wait_time_ms: 30_000,
        max_retries: 5,
        dead_letter_queue: DLQ,
      },
    },
    {
      queue_name: DLQ,
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_wait_time_ms: 30_000,
        max_retries: 10,
      },
    },
  ], DLQ, {
    maxConcurrency: 1,
    maxBatchSize: 10,
    maxBatchTimeout: 30,
    maxRetries: 10,
    deadLetterQueue: null,
  });

  assert.equal(observed.deadLetterQueue, null);

  assert.throws(
    () => assertWooCommerceQueueConsumerTopology([
      { queue_name: MAIN_QUEUE, settings: {} },
      { queue_name: MAIN_QUEUE, settings: {} },
    ], MAIN_QUEUE, EXPECTED_MAIN),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID'
      && error.details?.exactMatchCount === 2,
  );
});
