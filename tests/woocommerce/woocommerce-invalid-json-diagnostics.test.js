import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { WooCommerceRestClient } from '../../packages/connectors/src/woocommerce/woocommerce-rest-client.js';

function client(fetchImpl) {
  return new WooCommerceRestClient({
    baseUrl: 'https://shop.example.test',
    consumerKey: 'ck_fixture',
    consumerSecret: 'cs_fixture',
    fetchImpl,
  });
}

test('invalid successful WooCommerce JSON records bounded structural diagnostics without body data', async () => {
  const secretBody = '<!doctype html><html><body>private-origin-message</body></html>';
  const fetchImpl = async () => new Response(secretBody, {
    status: 200,
    headers: {
      'content-type': 'text/html; charset=UTF-8',
      'content-encoding': 'br',
      'content-length': String(Buffer.byteLength(secretBody)),
    },
  });

  await assert.rejects(
    () => client(fetchImpl).getStoreIdentity(),
    (error) => {
      assert.equal(error.code, 'WOOCOMMERCE_INVALID_JSON');
      assert.equal(error.retryable, false);
      assert.deepEqual(error.details, {
        resource: 'system_status',
        responseStatus: 200,
        responseRedirected: false,
        responseUrlPresent: false,
        responseOriginMatchesSource: null,
        responsePathMatchesResource: null,
        contentType: 'text/html; charset=UTF-8',
        contentEncoding: 'br',
        contentLengthHeader: Buffer.byteLength(secretBody),
        bodyByteLength: Buffer.byteLength(secretBody),
        bodySha256: createHash('sha256').update(secretBody).digest('hex'),
        bodyShape: 'html_or_xml',
        bomRemoved: false,
      });
      assert.equal(JSON.stringify(error.details).includes(secretBody), false);
      assert.equal(JSON.stringify(error.details).includes('private-origin-message'), false);
      return true;
    },
  );
});

test('invalid JSON classifies a followed redirect without exposing its final URL', async () => {
  const secretRedirectUrl = 'https://shop.example.test/wp-login.php?private=customer';
  const fetchImpl = async () => {
    const response = new Response('<html>login</html>', {
      status: 200,
      headers: { 'content-type': 'text/html' },
    });
    Object.defineProperties(response, {
      redirected: { value: true },
      url: { value: secretRedirectUrl },
    });
    return response;
  };

  await assert.rejects(
    () => client(fetchImpl).getStoreIdentity(),
    (error) => {
      assert.equal(error.code, 'WOOCOMMERCE_INVALID_JSON');
      assert.equal(error.details.responseRedirected, true);
      assert.equal(error.details.responseUrlPresent, true);
      assert.equal(error.details.responseOriginMatchesSource, true);
      assert.equal(error.details.responsePathMatchesResource, false);
      assert.equal(JSON.stringify(error.details).includes(secretRedirectUrl), false);
      assert.equal(JSON.stringify(error.details).includes('wp-login'), false);
      return true;
    },
  );
});

test('WooCommerce JSON parser accepts one leading UTF-8 BOM', async () => {
  const payload = '\ufeff{"environment":{"version":"10.1.0"},"settings":{"currency":"THB"}}';
  const fetchImpl = async () => new Response(payload, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  const store = await client(fetchImpl).getStoreIdentity();
  assert.equal(store.wcVersion, '10.1.0');
  assert.equal(store.currency, 'THB');
});

test('malformed JSON-like body is classified without persisting a prefix', async () => {
  const body = '{"environment":';
  const fetchImpl = async () => new Response(body, {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });

  await assert.rejects(
    () => client(fetchImpl).getStoreIdentity(),
    (error) => {
      assert.equal(error.code, 'WOOCOMMERCE_INVALID_JSON');
      assert.equal(error.details.bodyShape, 'json_object_like');
      assert.equal(Object.hasOwn(error.details, 'body'), false);
      assert.equal(Object.hasOwn(error.details, 'bodyPrefix'), false);
      return true;
    },
  );
});
