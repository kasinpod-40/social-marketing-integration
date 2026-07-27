import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseWranglerQueueConsumers,
} from '../../scripts/lib/youtube-dry-run-rollout-operator.js';
import {
  normalizeScopedWranglerQueueConsumers,
} from '../../scripts/lib/youtube-live-remote-contract-parser.js';

const MAIN_QUEUE = 'social-mkt-sync-jobs';
const DLQ = 'social-mkt-sync-dlq';

test('official Cloudflare max_wait_time_ms normalizes to reviewed whole seconds', () => {
  const normalized = normalizeScopedWranglerQueueConsumers({
    result: [{
      script_name: 'social-mkt-sync-worker',
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_wait_time_ms: 30000,
        max_retries: 5,
      },
      dead_letter_queue: DLQ,
    }],
  }, { expectedQueueName: MAIN_QUEUE });

  assert.equal(normalized.length, 1);
  assert.equal(normalized[0].queue_name, MAIN_QUEUE);
  assert.equal(normalized[0].settings.max_wait_time_ms, 30000);
  assert.equal(normalized[0].settings.max_batch_timeout, 30);

  const strict = parseWranglerQueueConsumers(normalized);
  assert.equal(strict.length, 1);
  assert.equal(strict[0].queue, MAIN_QUEUE);
  assert.equal(strict[0].maxBatchTimeout, 30);
  assert.equal(strict[0].deadLetterQueue, DLQ);
});

test('legacy explicit max_batch_timeout remains accepted', () => {
  const normalized = normalizeScopedWranglerQueueConsumers({
    consumers: [{
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_batch_timeout: 30,
        max_retries: 10,
      },
    }],
  }, { expectedQueueName: DLQ });

  assert.equal(normalized[0].settings.max_batch_timeout, 30);
  assert.equal(parseWranglerQueueConsumers(normalized)[0].maxBatchTimeout, 30);
});

test('timeout normalization rejects negative, fractional-second and conflicting values', () => {
  const fixtures = [
    {
      settings: { max_wait_time_ms: -1 },
      code: 'YOUTUBE_DRY_RUN_REMOTE_QUEUE_TIMEOUT_INVALID',
    },
    {
      settings: { max_wait_time_ms: 30001 },
      code: 'YOUTUBE_DRY_RUN_REMOTE_QUEUE_TIMEOUT_INVALID',
    },
    {
      settings: { max_wait_time_ms: 31000, max_batch_timeout: 30 },
      code: 'YOUTUBE_DRY_RUN_REMOTE_QUEUE_TIMEOUT_MISMATCH',
    },
    {
      max_wait_time_ms: 30000,
      settings: { max_wait_time_ms: 31000 },
      code: 'YOUTUBE_DRY_RUN_REMOTE_QUEUE_TIMEOUT_MISMATCH',
    },
  ];

  for (const fixture of fixtures) {
    assert.throws(
      () => normalizeScopedWranglerQueueConsumers({
        consumers: [fixture],
      }, { expectedQueueName: MAIN_QUEUE }),
      (error) => error.code === fixture.code,
    );
  }
});

test('missing timeout is not defaulted from local configuration', () => {
  const normalized = normalizeScopedWranglerQueueConsumers({
    consumers: [{
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_retries: 5,
      },
    }],
  }, { expectedQueueName: MAIN_QUEUE });

  assert.equal(normalized[0].settings.max_batch_timeout, undefined);
  assert.throws(
    () => parseWranglerQueueConsumers(normalized),
    (error) => error.code === 'YOUTUBE_DRY_RUN_COUNT_INVALID',
  );
});
