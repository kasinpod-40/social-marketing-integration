import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeCloudflareQueueConsumerPayload,
} from '../../scripts/lib/cloudflare-queue-consumer-contract.js';

test('normalizes official Cloudflare Queue worker consumer settings', () => {
  const normalized = normalizeCloudflareQueueConsumerPayload({
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
  });
  assert.equal(normalized.result[0].settings.max_batch_size, 10);
  assert.equal(normalized.result[0].settings.max_batch_timeout, 30);
  assert.equal(normalized.result[0].settings.max_concurrency, 1);
  assert.equal(normalized.result[0].settings.max_retries, 5);
  assert.equal(normalized.result[0].settings.batch_size, 10);
  assert.equal(normalized.result[0].settings.max_wait_time_ms, 30_000);
});

test('preserves compatible legacy Queue consumer fields', () => {
  const normalized = normalizeCloudflareQueueConsumerPayload([{
    queue_name: 'social-mkt-sync-dlq',
    settings: {
      max_batch_size: 10,
      max_batch_timeout: 30,
      max_concurrency: 1,
      max_retries: 10,
    },
  }]);
  assert.equal(normalized[0].settings.max_batch_size, 10);
  assert.equal(normalized[0].settings.max_batch_timeout, 30);
});

test('rejects conflicting official and legacy Queue batch fields', () => {
  assert.throws(
    () => normalizeCloudflareQueueConsumerPayload([{
      settings: { batch_size: 10, max_batch_size: 9 },
    }]),
    (error) => error?.code === 'CLOUDFLARE_QUEUE_CONSUMER_FIELD_CONFLICT',
  );
});

test('rejects Queue wait time that cannot convert to whole seconds', () => {
  assert.throws(
    () => normalizeCloudflareQueueConsumerPayload([{
      settings: { max_wait_time_ms: 30_500 },
    }]),
    (error) => error?.code === 'CLOUDFLARE_QUEUE_CONSUMER_TIMEOUT_INVALID',
  );
});

test('rejects conflicting timeout seconds and milliseconds', () => {
  assert.throws(
    () => normalizeCloudflareQueueConsumerPayload([{
      settings: { max_batch_timeout: 30, max_wait_time_ms: 5_000 },
    }]),
    (error) => error?.code === 'CLOUDFLARE_QUEUE_CONSUMER_FIELD_CONFLICT',
  );
});
