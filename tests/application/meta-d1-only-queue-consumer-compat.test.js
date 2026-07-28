import assert from 'node:assert/strict';
import test from 'node:test';
import {
  isMetaD1QueueConsumerListInvocation,
  normalizeMetaD1QueueConsumerListOutput,
} from '../../scripts/lib/meta-d1-only-wrangler-compat.js';

test('Meta D1 compatibility identifies only JSON Queue consumer list commands', () => {
  assert.equal(isMetaD1QueueConsumerListInvocation([
    'wrangler', 'queues', 'consumer', 'list', 'social-mkt-sync-jobs', '--json',
  ]), true);
  assert.equal(isMetaD1QueueConsumerListInvocation([
    'wrangler', 'queues', 'consumer', 'list', 'social-mkt-sync-jobs',
  ]), false);
  assert.equal(isMetaD1QueueConsumerListInvocation([
    'wrangler', 'deploy', '--json',
  ]), false);
});

test('Meta D1 compatibility normalizes official Cloudflare Queue consumer fields', () => {
  const output = normalizeMetaD1QueueConsumerListOutput(JSON.stringify({
    success: true,
    result: [{
      queue_name: 'social-mkt-sync-jobs',
      dead_letter_queue: 'social-mkt-sync-dlq',
      settings: {
        batch_size: 10,
        max_concurrency: 1,
        max_retries: 5,
        max_wait_time_ms: 30_000,
      },
    }],
  }));
  const parsed = JSON.parse(output);
  const consumer = parsed.result[0];
  assert.equal(consumer.settings.max_batch_size, 10);
  assert.equal(consumer.settings.max_batch_timeout, 30);
  assert.equal(consumer.settings.max_concurrency, 1);
  assert.equal(consumer.settings.max_retries, 5);
  assert.equal(consumer.dead_letter_queue, 'social-mkt-sync-dlq');
});

test('Meta D1 compatibility preserves compatible legacy Queue fields', () => {
  const output = normalizeMetaD1QueueConsumerListOutput(JSON.stringify([{
    queue_name: 'social-mkt-sync-dlq',
    settings: {
      max_batch_size: 10,
      max_batch_timeout: 30,
      max_concurrency: 1,
      max_retries: 10,
    },
  }]));
  const parsed = JSON.parse(output);
  assert.equal(parsed[0].settings.max_batch_size, 10);
  assert.equal(parsed[0].settings.max_batch_timeout, 30);
});

test('Meta D1 compatibility remains fail-closed for conflicting or invalid Queue output', () => {
  assert.throws(
    () => normalizeMetaD1QueueConsumerListOutput(JSON.stringify([{
      settings: { batch_size: 10, max_batch_size: 9 },
    }])),
    (error) => error?.code === 'CLOUDFLARE_QUEUE_CONSUMER_FIELD_CONFLICT',
  );
  assert.throws(
    () => normalizeMetaD1QueueConsumerListOutput('{invalid'),
    (error) => error?.code === 'META_D1_WRANGLER_COMPAT_QUEUE_OUTPUT_INVALID',
  );
});
