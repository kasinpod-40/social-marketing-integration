import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildMetaK2WorkersDevOrigin,
  resolveMetaK2WranglerOriginAuthority,
} from '../../scripts/lib/meta-k2-recovery-origin-authority.js';

test('resolves an exact top-level Wrangler route covering the recovery path', () => {
  const result = resolveMetaK2WranglerOriginAuthority(`{
    "name": "social-mkt-sync-worker",
    "workers_dev": false,
    "routes": [
      { "pattern": "mkt.example.test/operator/*", "zone_name": "example.test" },
      { "pattern": "mkt.example.test/health", "zone_name": "example.test" }
    ]
  }`);
  assert.equal(result.routeOrigin, 'https://mkt.example.test');
  assert.equal(result.routeEntryCount, 2);
  assert.equal(result.matchingRouteCount, 1);
  assert.equal(result.workersDevEnabled, false);
});

test('resolves an exact custom domain authority', () => {
  const result = resolveMetaK2WranglerOriginAuthority(`{
    "name": "social-mkt-sync-worker",
    "workers_dev": false,
    "route": {
      "pattern": "mkt.example.test",
      "custom_domain": true
    }
  }`);
  assert.equal(result.routeOrigin, 'https://mkt.example.test');
  assert.equal(result.matchingRouteCount, 1);
});

test('retains explicit workers.dev fallback only when enabled', () => {
  const enabled = resolveMetaK2WranglerOriginAuthority(`{
    "name": "social-mkt-sync-worker",
    "workers_dev": true
  }`);
  assert.equal(enabled.routeOrigin, null);
  assert.equal(enabled.workersDevEnabled, true);

  const disabled = resolveMetaK2WranglerOriginAuthority(`{
    "name": "social-mkt-sync-worker",
    "workers_dev": false
  }`);
  assert.equal(disabled.routeOrigin, null);
  assert.equal(disabled.workersDevEnabled, false);
});

test('rejects conflicting exact route origins', () => {
  assert.throws(
    () => resolveMetaK2WranglerOriginAuthority(`{
      "name": "social-mkt-sync-worker",
      "workers_dev": false,
      "routes": [
        "one.example.test/*",
        "two.example.test/operator/*"
      ]
    }`),
    (error) => error.code === 'META_K2_WRANGLER_RECOVERY_ROUTE_CONFLICT',
  );
});

test('rejects wildcard host authority covering the exact path', () => {
  assert.throws(
    () => resolveMetaK2WranglerOriginAuthority(`{
      "name": "social-mkt-sync-worker",
      "workers_dev": false,
      "routes": ["*.example.test/operator/*"]
    }`),
    (error) => error.code === 'META_K2_WRANGLER_RECOVERY_ROUTE_AMBIGUOUS',
  );
});

test('rejects wrong Worker identity and malformed workers_dev', () => {
  assert.throws(
    () => resolveMetaK2WranglerOriginAuthority(`{
      "name": "other-worker",
      "workers_dev": false
    }`),
    (error) => error.code === 'META_K2_WRANGLER_RECOVERY_WORKER_INVALID',
  );
  assert.throws(
    () => resolveMetaK2WranglerOriginAuthority(`{
      "name": "social-mkt-sync-worker",
      "workers_dev": "true"
    }`),
    (error) => error.code === 'META_K2_WRANGLER_RECOVERY_WORKERS_DEV_INVALID',
  );
});

test('builds a deterministic workers.dev origin from validated labels', () => {
  assert.equal(
    buildMetaK2WorkersDevOrigin('social-mkt-sync-worker', 'developer-account'),
    'https://social-mkt-sync-worker.developer-account.workers.dev',
  );
  assert.throws(
    () => buildMetaK2WorkersDevOrigin('social_mkt_sync_worker', 'developer-account'),
    (error) => error.code === 'META_K2_WRANGLER_RECOVERY_WORKERS_DEV_INVALID',
  );
});
