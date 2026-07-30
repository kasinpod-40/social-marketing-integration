import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import {
  adaptWooCommerceQueueConsumerCliOutput,
  isWooCommerceQueueConsumerJsonCommand,
} from '../../scripts/lib/woocommerce-queue-consumer-cli-output.js';

const MAIN_QUEUE = 'social-mkt-sync-jobs';
const DLQ = 'social-mkt-sync-dlq';
const ORIGINAL_CORE_GIT_BLOB_SHA = 'e8532c777ee46ca8c5bda77c7f777269e83cd453';

test('adapts current Wrangler result shape to reviewed legacy aliases', () => {
  const adapted = JSON.parse(adaptWooCommerceQueueConsumerCliOutput(JSON.stringify({
    result: [{
      queue_name: MAIN_QUEUE,
      dead_letter_queue: DLQ,
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_wait_time_ms: 30_000,
        max_retries: 5,
      },
    }],
  })));

  assert.equal(adapted.result[0].dead_letter_queue, DLQ);
  assert.equal(adapted.result[0].settings.batch_size, 10);
  assert.equal(adapted.result[0].settings.max_wait_time_ms, 30_000);
  assert.equal(adapted.result[0].settings.max_batch_size, 10);
  assert.equal(adapted.result[0].settings.max_batch_timeout, 30);
});

test('normalizes Cloudflare empty dead-letter Queue identity to null for reviewed core', () => {
  const adapted = JSON.parse(adaptWooCommerceQueueConsumerCliOutput(JSON.stringify({
    result: [{
      queue_name: DLQ,
      dead_letter_queue: '',
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_wait_time_ms: 30_000,
        max_retries: 10,
      },
    }],
  })));

  assert.equal(adapted.result[0].dead_letter_queue, null);
  assert.equal(adapted.result[0].settings.max_batch_size, 10);
  assert.equal(adapted.result[0].settings.max_batch_timeout, 30);
});

test('supports direct arrays and consumers containers without changing identity', () => {
  const entry = {
    queue_name: DLQ,
    dead_letter_queue: '',
    settings: {
      max_concurrency: 1,
      batch_size: 10,
      max_wait_time_ms: 30_000,
      max_retries: 10,
    },
  };
  const direct = JSON.parse(adaptWooCommerceQueueConsumerCliOutput(
    JSON.stringify([entry]),
  ));
  const wrapped = JSON.parse(adaptWooCommerceQueueConsumerCliOutput(
    JSON.stringify({ consumers: [entry], metadata: { retained: true } }),
  ));

  assert.equal(direct[0].queue_name, DLQ);
  assert.equal(direct[0].dead_letter_queue, null);
  assert.equal(direct[0].settings.max_batch_timeout, 30);
  assert.equal(wrapped.metadata.retained, true);
  assert.equal(wrapped.consumers[0].dead_letter_queue, null);
  assert.equal(wrapped.consumers[0].settings.max_batch_size, 10);
});

test('adapts only the exact Wrangler Queue consumer JSON command', () => {
  assert.equal(isWooCommerceQueueConsumerJsonCommand([
    'wrangler',
    'queues',
    'consumer',
    'list',
    MAIN_QUEUE,
    '--json',
  ]), true);
  assert.equal(isWooCommerceQueueConsumerJsonCommand([
    'wrangler',
    'queues',
    'list',
    '--json',
  ]), false);
  assert.equal(isWooCommerceQueueConsumerJsonCommand([
    'wrangler',
    'queues',
    'consumer',
    'list',
    MAIN_QUEUE,
  ]), false);
});

test('fails closed for invalid or conflicting modern consumer output', () => {
  assert.throws(
    () => adaptWooCommerceQueueConsumerCliOutput('{invalid'),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_CONSUMER_JSON_INVALID',
  );
  assert.throws(
    () => adaptWooCommerceQueueConsumerCliOutput(JSON.stringify({ result: [{
      settings: {
        max_concurrency: 1,
        batch_size: 10,
        max_batch_size: 20,
        max_wait_time_ms: 30_000,
        max_retries: 5,
      },
    }] })),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID',
  );
});

test('entry wrapper preserves the reviewed Final core byte-for-byte', async () => {
  const core = await readFile(
    new URL('../../scripts/woocommerce-final-rollout-operator-core.mjs', import.meta.url),
  );
  const wrapper = await readFile(
    new URL('../../scripts/woocommerce-final-rollout-operator.mjs', import.meta.url),
    'utf8',
  );
  const proxy = await readFile(
    new URL('../../scripts/woocommerce-final-npx-proxy.mjs', import.meta.url),
    'utf8',
  );
  const gitBlobSha = createHash('sha1')
    .update(`blob ${core.length}\0`)
    .update(core)
    .digest('hex');

  assert.equal(gitBlobSha, ORIGINAL_CORE_GIT_BLOB_SHA);
  assert.match(wrapper, /woocommerce-final-rollout-operator-core\.mjs/u);
  assert.match(wrapper, /MKT_WOOCOMMERCE_FINAL_REAL_NPX/u);
  assert.match(wrapper, /PATH:/u);
  assert.match(proxy, /isWooCommerceQueueConsumerJsonCommand/u);
  assert.doesNotMatch(proxy, /queues\s+list\s+--json/u);
});
