import test from 'node:test';
import assert from 'node:assert/strict';
import { WooCommerceRestClient } from '../../packages/connectors/src/woocommerce/woocommerce-rest-client.js';

const KEY = 'ck_' + 'k'.repeat(40);
const SECRET = 'cs_' + 's'.repeat(40);

function createClient(fetchImpl) {
  return new WooCommerceRestClient({
    baseUrl: 'https://shop.example.test',
    consumerKey: KEY,
    consumerSecret: SECRET,
    fetchImpl,
  });
}

test('WooCommerce client uses header Basic Auth, bounded pagination and no URL credentials', async () => {
  let request = null;
  const client = createClient(async (url, options) => {
    request = { url, options };
    return new Response(JSON.stringify([{ id: 1, date_modified_gmt: '2026-07-25T04:05:06' }]), {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'x-wp-total': '201',
        'x-wp-totalpages': '3',
      },
    });
  });

  const result = await client.listPage('orders', {
    page: 2,
    perPage: 100,
    params: {
      modified_after: '2026-07-20T00:00:00.000Z',
      dates_are_gmt: true,
      orderby: 'modified',
      order: 'asc',
    },
  });

  assert.equal(result.page, 2);
  assert.equal(result.nextPage, 3);
  assert.equal(result.totalRows, 201);
  assert.equal(result.totalPages, 3);
  assert.equal(result.sourceWatermark, Date.parse('2026-07-25T04:05:06Z'));
  assert.match(request.url, /\/wp-json\/wc\/v3\/orders/u);
  assert.match(request.url, /page=2/u);
  assert.match(request.url, /per_page=100/u);
  assert.match(request.url, /modified_after=2026-07-20T00%3A00%3A00.000Z/u);
  assert.equal(request.url.includes(KEY), false);
  assert.equal(request.url.includes(SECRET), false);
  assert.match(request.options.headers.Authorization, /^Basic /u);
});

test('WooCommerce client rejects non-HTTPS and non-allowlisted resources', async () => {
  assert.throws(
    () => new WooCommerceRestClient({
      baseUrl: 'http://shop.example.test',
      consumerKey: KEY,
      consumerSecret: SECRET,
      fetchImpl: async () => new Response('{}'),
    }),
    (error) => error?.code === 'WOOCOMMERCE_HTTPS_REQUIRED',
  );

  const client = createClient(async () => new Response('[]', { status: 200 }));
  await assert.rejects(
    client.listPage('settings'),
    (error) => error?.code === 'WOOCOMMERCE_RESOURCE_NOT_ALLOWED',
  );
});

test('WooCommerce client classifies authorization and retryable upstream failures', async () => {
  const unauthorized = createClient(async () => new Response(JSON.stringify({
    code: 'woocommerce_rest_cannot_view',
    message: 'Forbidden',
  }), { status: 403, headers: { 'content-type': 'application/json' } }));
  await assert.rejects(
    unauthorized.listPage('orders'),
    (error) => error?.code === 'WOOCOMMERCE_AUTHORIZATION_FAILED' && error.retryable === false,
  );

  const limited = createClient(async () => new Response(JSON.stringify({ code: 'rate_limited' }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '7' },
  }));
  await assert.rejects(
    limited.listPage('products'),
    (error) => error?.code === 'WOOCOMMERCE_RATE_LIMITED'
      && error.retryable === true
      && error.details.retryAfterSeconds === 7,
  );
});

test('WooCommerce client persists bounded sanitized network cause diagnostics', async () => {
  const nested = Object.assign(new Error('connect ETIMEDOUT'), { code: 'ETIMEDOUT' });
  const cause = Object.assign(new TypeError('Network connection lost'), {
    code: 'WORKER_FETCH_FAILED',
    cause: nested,
  });
  const client = createClient(async () => {
    throw cause;
  });

  await assert.rejects(
    client.getStoreIdentity(),
    (error) => {
      assert.equal(error.code, 'WOOCOMMERCE_NETWORK_ERROR');
      assert.equal(error.retryable, true);
      assert.equal(error.details.resource, 'system_status');
      assert.equal(error.details.timeoutMs, 30_000);
      assert.equal(error.details.networkCause.name, 'TypeError');
      assert.equal(error.details.networkCause.message, 'Network connection lost');
      assert.equal(error.details.networkCause.code, 'WORKER_FETCH_FAILED');
      assert.equal(error.details.networkCause.nestedName, 'Error');
      assert.equal(error.details.networkCause.nestedMessage, 'connect ETIMEDOUT');
      assert.equal(error.details.networkCause.nestedCode, 'ETIMEDOUT');
      const serialized = JSON.stringify(error.details);
      assert.equal(serialized.includes(KEY), false);
      assert.equal(serialized.includes(SECRET), false);
      return true;
    },
  );
});

test('WooCommerce client paginates nested refunds and variations without leaking credentials', async () => {
  const urls = [];
  const client = createClient(async (url) => {
    urls.push(url);
    return new Response('[]', {
      status: 200,
      headers: { 'x-wp-total': '0', 'x-wp-totalpages': '1' },
    });
  });
  await client.listOrderRefunds(42);
  await client.listProductVariations(99);
  assert.match(urls[0], /orders\/42\/refunds/u);
  assert.match(urls[1], /products\/99\/variations/u);
  assert.equal(urls.some((url) => url.includes(KEY) || url.includes(SECRET)), false);
});
