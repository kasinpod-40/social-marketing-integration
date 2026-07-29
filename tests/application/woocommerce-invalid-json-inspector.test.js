import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { extractWooCommerceFinalNetworkDiagnostics } from '../../scripts/lib/woocommerce-final-operation-inspector.js';

const HASH = 'a'.repeat(64);

test('inspector exposes only allowlisted invalid-JSON response diagnostics', () => {
  const secret = '<html>secret response body</html>';
  const result = extractWooCommerceFinalNetworkDiagnostics(JSON.stringify({
    errorDetails: {
      resource: 'system_status',
      responseStatus: 200,
      contentType: 'text/html; charset=UTF-8',
      contentEncoding: 'br',
      contentLengthHeader: 123,
      bodyByteLength: 120,
      bodySha256: HASH,
      bodyShape: 'html_or_xml',
      bomRemoved: false,
      responseBody: secret,
      authorization: secret,
      headers: { cookie: secret },
    },
  }));

  assert.deepEqual(result, {
    resource: 'system_status',
    timeoutMs: null,
    elapsedMs: null,
    networkCause: null,
    responseDiagnostics: {
      responseStatus: 200,
      contentType: 'text/html; charset=UTF-8',
      contentEncoding: 'br',
      contentLengthHeader: 123,
      bodyByteLength: 120,
      bodySha256: HASH,
      bodyShape: 'html_or_xml',
      bomRemoved: false,
    },
  });
  assert.equal(JSON.stringify(result).includes(secret), false);
});

test('inspector drops malformed diagnostic values rather than widening evidence', () => {
  const result = extractWooCommerceFinalNetworkDiagnostics({
    errorDetails: {
      resource: 'system_status',
      bodySha256: 'not-a-hash',
      bodyShape: 'body_prefix',
      bomRemoved: 'false',
    },
  });
  assert.equal(result.responseDiagnostics, undefined);
  assert.equal(result.resource, 'system_status');
});

test('unsupported local Provider diagnostic fails closed and points only to Worker-side operator', async () => {
  const source = await readFile(
    new URL('../../scripts/woocommerce-provider-response-diagnostics.mjs', import.meta.url),
    'utf8',
  );
  assert.match(source, /WOOCOMMERCE_LOCAL_PROVIDER_DIAGNOSTICS_UNSUPPORTED/u);
  assert.match(source, /woocommerce-worker-provider-diagnostics\.mjs/u);
  assert.match(source, /providerRequestCount:\s*0/u);
  assert.match(source, /workerDeploymentCount:\s*0/u);
  assert.doesNotMatch(source, /getStoreIdentity\(|WooCommerceRestClient|readWooCommerceRuntimeConfig/u);
  assert.doesNotMatch(source, /queues\/.+\/messages|wrangler['"],\s*['"]deploy|d1['"],\s*['"]execute/u);
  assert.doesNotMatch(source, /createLark|LarkBitable|TableSyncEngine/u);
});
