import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { assertWooCommerceQueueConsumerTopology } from '../../scripts/lib/woocommerce-queue-consumer-topology.js';

const expected = Object.freeze({
  maxConcurrency: 1,
  maxBatchSize: 10,
  maxBatchTimeout: 30,
  maxRetries: 5,
  deadLetterQueue: 'social-mkt-sync-dlq',
});

test('shared Queue topology validator accepts current Wrangler consumer aliases', () => {
  const observed = assertWooCommerceQueueConsumerTopology([
    {
      queue_name: 'social-mkt-sync-jobs',
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_wait_time_ms: 30_000,
        max_retries: 5,
        dead_letter_queue: 'social-mkt-sync-dlq',
      },
    },
  ], 'social-mkt-sync-jobs', expected);
  assert.deepEqual(observed, expected);
});

test('shared Queue topology validator retains legacy Wrangler aliases', () => {
  const observed = assertWooCommerceQueueConsumerTopology([
    {
      queue_name: 'social-mkt-sync-jobs',
      max_concurrency: 1,
      max_batch_size: 10,
      max_batch_timeout: 30,
      max_retries: 5,
      dead_letter_queue: 'social-mkt-sync-dlq',
    },
  ], 'social-mkt-sync-jobs', expected);
  assert.deepEqual(observed, expected);
});

test('Chatwoot Final operator reuses the shared Queue topology authority', async () => {
  const source = await readFile(
    new URL('../../scripts/chatwoot-final-30d-daily-uat.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /assertWooCommerceQueueConsumerTopology/u);
  assert.match(source, /return assertWooCommerceQueueConsumerTopology\(items, queueName, expected\)/u);
  assert.doesNotMatch(source, /Number\(settings\.max_batch_size\)/u);
  assert.doesNotMatch(source, /Number\(settings\.max_batch_timeout\)/u);
});
