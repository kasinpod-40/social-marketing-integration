import assert from 'node:assert/strict';
import test from 'node:test';
import {
  createWooCommerceWorkerFetch,
} from '../../apps/sync-worker/src/woocommerce-job-router.js';

test('WooCommerce Worker fetch preserves the Cloudflare runtime receiver', async () => {
  const target = {
    fetch(url, options) {
      assert.equal(this, target);
      assert.equal(url, 'https://shop.example.test/wp-json/wc/v3/system_status');
      assert.equal(options.method, 'GET');
      return Promise.resolve(new Response('{}', {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }));
    },
  };

  const fetchImpl = createWooCommerceWorkerFetch(target);
  const response = await fetchImpl(
    'https://shop.example.test/wp-json/wc/v3/system_status',
    { method: 'GET' },
  );

  assert.equal(response.status, 200);
});

test('WooCommerce Worker fetch fails closed when the runtime method is unavailable', () => {
  assert.throws(
    () => createWooCommerceWorkerFetch({}),
    (error) => error?.code === 'WOOCOMMERCE_FETCH_RUNTIME_UNAVAILABLE'
      && error.retryable === false,
  );
});
