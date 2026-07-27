import assert from 'node:assert/strict';
import test from 'node:test';
import {
  DEFAULT_WOOCOMMERCE_INITIAL_DELIVERY_DELAY_SECONDS,
  prepareWooCommercePropagationSafeQueueRequest,
  readWooCommerceInitialDeliveryDelaySeconds,
} from '../../scripts/lib/woocommerce-queue-delivery-delay.js';

const queueUrl = 'https://api.cloudflare.com/client/v4/accounts/account-id/queues/queue-id/messages';

function envelope(overrides = {}) {
  return JSON.stringify({
    body: {
      schemaVersion: 1,
      type: 'woocommerce.commerce.sync',
      trigger: 'manual_uat',
      fullReconciliation: true,
      operationId: 'woo-final-full-12345678',
      ...overrides,
    },
    content_type: 'json',
  });
}

test('initial full WooCommerce UAT message receives bounded delivery delay once', () => {
  const delayedOperationIds = new Set();
  const first = prepareWooCommercePropagationSafeQueueRequest({
    url: queueUrl,
    method: 'POST',
    bodyText: envelope(),
    delaySeconds: 120,
    delayedOperationIds,
  });
  assert.equal(first.changed, true);
  assert.equal(first.delaySeconds, 120);
  assert.equal(JSON.parse(first.bodyText).delay_seconds, 120);

  delayedOperationIds.add(first.operationId);
  const second = prepareWooCommercePropagationSafeQueueRequest({
    url: queueUrl,
    method: 'POST',
    bodyText: envelope(),
    delaySeconds: 120,
    delayedOperationIds,
  });
  assert.equal(second.changed, false);
});

test('scheduled, incremental, continuation and non-WooCommerce messages are unchanged', () => {
  for (const bodyText of [
    envelope({ trigger: 'scheduled' }),
    envelope({ fullReconciliation: false }),
    envelope({ continuation: true }),
    envelope({ type: 'youtube.channel.organic.sync' }),
  ]) {
    const result = prepareWooCommercePropagationSafeQueueRequest({
      url: queueUrl,
      method: 'POST',
      bodyText,
      delaySeconds: 120,
    });
    assert.equal(result.changed, false);
    assert.equal(result.bodyText, bodyText);
  }
});

test('existing longer delivery delay is preserved', () => {
  const bodyText = JSON.stringify({
    ...JSON.parse(envelope()),
    delay_seconds: 180,
  });
  const result = prepareWooCommercePropagationSafeQueueRequest({
    url: queueUrl,
    method: 'POST',
    bodyText,
    delaySeconds: 120,
  });
  assert.equal(result.changed, true);
  assert.equal(JSON.parse(result.bodyText).delay_seconds, 180);
});

test('delay configuration is fail-closed and bounded', () => {
  assert.equal(
    readWooCommerceInitialDeliveryDelaySeconds(undefined),
    DEFAULT_WOOCOMMERCE_INITIAL_DELIVERY_DELAY_SECONDS,
  );
  assert.equal(readWooCommerceInitialDeliveryDelaySeconds('90'), 90);
  assert.throws(() => readWooCommerceInitialDeliveryDelaySeconds('29'));
  assert.throws(() => readWooCommerceInitialDeliveryDelaySeconds('301'));
  assert.throws(() => readWooCommerceInitialDeliveryDelaySeconds('invalid'));
});

test('unrelated methods, URLs and invalid JSON are untouched', () => {
  for (const input of [
    { url: queueUrl, method: 'GET', bodyText: envelope() },
    { url: 'https://api.cloudflare.com/client/v4/accounts/account-id/queues', method: 'POST', bodyText: envelope() },
    { url: queueUrl, method: 'POST', bodyText: '{invalid' },
  ]) {
    const result = prepareWooCommercePropagationSafeQueueRequest({ ...input, delaySeconds: 120 });
    assert.equal(result.changed, false);
  }
});
