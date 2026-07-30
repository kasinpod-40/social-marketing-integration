import assert from 'node:assert/strict';
import test from 'node:test';
import {
  adaptWooCommerceCompletedStateQueueConsumerCliOutput,
  addCloseoutSettingsDlqAlias,
} from '../../scripts/lib/woocommerce-completed-state-queue-consumer-cli-output.js';

test('completed-state adapter exposes modern Queue fields through reviewed settings aliases', () => {
  const output = adaptWooCommerceCompletedStateQueueConsumerCliOutput(JSON.stringify([
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
  ]));
  const [consumer] = JSON.parse(output);
  assert.equal(consumer.settings.max_batch_size, 10);
  assert.equal(consumer.settings.max_batch_timeout, 30);
  assert.equal(consumer.settings.dead_letter_queue, 'social-mkt-sync-dlq');
});

test('completed-state adapter normalizes the DLQ empty string to null in settings', () => {
  const output = adaptWooCommerceCompletedStateQueueConsumerCliOutput(JSON.stringify({
    result: [
      {
        queue_name: 'social-mkt-sync-dlq',
        dead_letter_queue: '',
        settings: {
          max_concurrency: 1,
          batch_size: 10,
          max_wait_time_ms: 30_000,
          max_retries: 10,
        },
      },
    ],
  }));
  const consumer = JSON.parse(output).result[0];
  assert.equal(consumer.dead_letter_queue, null);
  assert.equal(consumer.settings.dead_letter_queue, null);
});

test('completed-state adapter supports direct, result and consumers containers', () => {
  const entry = {
    queue_name: 'queue',
    dead_letter_queue: 'dlq',
    settings: {
      max_concurrency: 1,
      max_batch_size: 10,
      max_batch_timeout: 30,
      max_retries: 5,
    },
  };
  assert.equal(addCloseoutSettingsDlqAlias([entry])[0].settings.dead_letter_queue, 'dlq');
  assert.equal(
    addCloseoutSettingsDlqAlias({ result: [entry] }).result[0].settings.dead_letter_queue,
    'dlq',
  );
  assert.equal(
    addCloseoutSettingsDlqAlias({ consumers: [entry] }).consumers[0].settings.dead_letter_queue,
    'dlq',
  );
});

test('shared Queue alias conflicts remain fail closed', () => {
  assert.throws(
    () => adaptWooCommerceCompletedStateQueueConsumerCliOutput(JSON.stringify([
      {
        queue_name: 'queue',
        settings: {
          max_concurrency: 1,
          batch_size: 10,
          max_batch_size: 9,
          max_wait_time_ms: 30_000,
          max_retries: 5,
        },
      },
    ])),
    (error) => error?.code === 'WOOCOMMERCE_FINAL_QUEUE_TOPOLOGY_INVALID',
  );
});
