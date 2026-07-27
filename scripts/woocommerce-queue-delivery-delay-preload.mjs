import {
  prepareWooCommercePropagationSafeQueueRequest,
  readWooCommerceInitialDeliveryDelaySeconds,
} from './lib/woocommerce-queue-delivery-delay.js';

const originalFetch = globalThis.fetch?.bind(globalThis);
if (typeof originalFetch !== 'function') {
  throw new Error('Global fetch is unavailable for WooCommerce Queue propagation barrier');
}

const delaySeconds = readWooCommerceInitialDeliveryDelaySeconds(
  process.env.MKT_WOOCOMMERCE_FINAL_INITIAL_DELIVERY_DELAY_SECONDS,
);
const delayedOperationIds = new Set();

globalThis.fetch = async function propagationSafeFetch(input, init = {}) {
  const request = prepareWooCommercePropagationSafeQueueRequest({
    url: input,
    method: init?.method ?? input?.method,
    bodyText: typeof init?.body === 'string' ? init.body : null,
    delaySeconds,
    delayedOperationIds,
  });

  if (!request.changed) return originalFetch(input, init);

  delayedOperationIds.add(request.operationId);
  process.stderr.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-initial-queue-propagation-barrier',
    operationId: request.operationId,
    delaySeconds: request.delaySeconds,
  })}\n`);

  return originalFetch(input, {
    ...init,
    body: request.bodyText,
  });
};
