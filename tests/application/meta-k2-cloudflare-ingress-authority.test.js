import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseMetaK2AccountZones,
  parseMetaK2WorkerDomains,
  parseMetaK2WorkerRoutes,
  selectMetaK2CloudflareIngressAuthority,
} from '../../scripts/lib/meta-k2-cloudflare-ingress-authority.js';

const WORKER = 'social-mkt-sync-worker';

test('selects one exact Cloudflare Worker custom domain', () => {
  const parsed = parseMetaK2WorkerDomains({
    success: true,
    result: [
      { hostname: 'sync.example.com', service: WORKER },
      { hostname: 'other.example.com', service: 'other-worker' },
    ],
  });
  assert.equal(parsed.matchingCount, 1);
  assert.deepEqual(parsed.origins, ['https://sync.example.com']);

  const selected = selectMetaK2CloudflareIngressAuthority({
    domainOrigins: parsed.origins,
    routeOrigins: [],
  });
  assert.equal(selected.source, 'cloudflare_worker_domain');
  assert.equal(selected.origin, 'https://sync.example.com');
});

test('derives an exact origin from a remote Worker route covering the recovery path', () => {
  const parsed = parseMetaK2WorkerRoutes({
    success: true,
    result: [
      {
        pattern: 'sync.example.com/operator/meta/*',
        script: WORKER,
      },
      {
        pattern: 'sync.example.com/unrelated/*',
        script: WORKER,
      },
      {
        pattern: 'other.example.com/*',
        script: 'other-worker',
      },
    ],
  });
  assert.equal(parsed.matchingScriptCount, 2);
  assert.equal(parsed.matchingPathCount, 1);
  assert.deepEqual(parsed.origins, ['https://sync.example.com']);
});

test('rejects wildcard hosts and conflicting remote origins', () => {
  assert.throws(
    () => parseMetaK2WorkerRoutes({
      success: true,
      result: [{ pattern: '*.example.com/*', script: WORKER }],
    }),
    (error) => error.code === 'META_K2_CLOUDFLARE_RECOVERY_ROUTE_AMBIGUOUS',
  );

  assert.throws(
    () => selectMetaK2CloudflareIngressAuthority({
      domainOrigins: ['https://one.example.com'],
      routeOrigins: ['https://two.example.com'],
    }),
    (error) => error.code === 'META_K2_CLOUDFLARE_RECOVERY_ORIGIN_CONFLICT',
  );
});

test('rejects missing ingress and invalid Cloudflare envelopes', () => {
  assert.throws(
    () => selectMetaK2CloudflareIngressAuthority({
      domainOrigins: [],
      routeOrigins: [],
    }),
    (error) => error.code === 'META_K2_CLOUDFLARE_RECOVERY_ORIGIN_UNAVAILABLE',
  );
  assert.throws(
    () => parseMetaK2WorkerDomains({ success: false, result: [] }),
    (error) => error.code === 'META_K2_CLOUDFLARE_RECOVERY_RESPONSE_INVALID',
  );
});

test('parses bounded Cloudflare zone identifiers without exposing names', () => {
  const parsed = parseMetaK2AccountZones({
    success: true,
    result: [
      { id: 'a'.repeat(32), name: 'secret-zone.example' },
      { id: 'b'.repeat(32), name: 'another-secret.example' },
    ],
  });
  assert.equal(parsed.inspectedCount, 2);
  assert.deepEqual(parsed.zones, [
    { id: 'a'.repeat(32) },
    { id: 'b'.repeat(32) },
  ]);
  assert.doesNotMatch(JSON.stringify(parsed), /secret-zone/u);
});
