import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER,
  WORKER_RUNTIME_VERSION_HEADER,
} from '../../packages/shared/src/cloudflare/worker-version.js';
import {
  createWooCommerceDiagnosticsExactVersionFetch,
} from '../../scripts/lib/woocommerce-diagnostics-exact-version-fetch.js';

const EXPECTED_VERSION = '11111111-1111-4111-8111-111111111111';
const OTHER_VERSION = '22222222-2222-4222-8222-222222222222';
const OVERRIDE = `social-mkt-sync-worker="${EXPECTED_VERSION}"`;

function versionedResponse(versionId = null, status = 401) {
  const headers = versionId ? { [WORKER_RUNTIME_VERSION_HEADER]: versionId } : {};
  return new Response(JSON.stringify({ ok: false }), { status, headers });
}

test('retries exact-version GET probes until the expected runtime version is attested', async () => {
  const responses = [
    versionedResponse(null),
    versionedResponse(OTHER_VERSION),
    versionedResponse(EXPECTED_VERSION),
  ];
  const delays = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return responses.shift();
  };
  const fetchWithRetry = createWooCommerceDiagnosticsExactVersionFetch(fetchImpl, {
    delaysMs: [1, 2],
    sleep: async (delayMs) => delays.push(delayMs),
  });

  const response = await fetchWithRetry('https://worker.example.test/operator', {
    method: 'GET',
    headers: { [CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER]: OVERRIDE },
  });

  assert.equal(calls, 3);
  assert.deepEqual(delays, [1, 2]);
  assert.equal(response.headers.get(WORKER_RUNTIME_VERSION_HEADER), EXPECTED_VERSION);
});

test('returns the final unmatched response after bounded retries for the existing validator to reject', async () => {
  let calls = 0;
  const fetchWithRetry = createWooCommerceDiagnosticsExactVersionFetch(async () => {
    calls += 1;
    return versionedResponse(null, 404);
  }, {
    delaysMs: [0, 0],
    sleep: async () => {},
  });

  const response = await fetchWithRetry('https://worker.example.test/operator', {
    headers: { [CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER]: OVERRIDE },
  });

  assert.equal(calls, 3);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get(WORKER_RUNTIME_VERSION_HEADER), null);
});

test('does not retry requests without one exact override or requests using a non-GET method', async () => {
  let calls = 0;
  const fetchWithRetry = createWooCommerceDiagnosticsExactVersionFetch(async () => {
    calls += 1;
    return versionedResponse(null, 200);
  }, {
    delaysMs: [0, 0, 0],
    sleep: async () => {
      throw new Error('sleep must not run');
    },
  });

  await fetchWithRetry('https://worker.example.test/health');
  await fetchWithRetry('https://worker.example.test/operator', {
    method: 'POST',
    headers: { [CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER]: OVERRIDE },
  });
  await fetchWithRetry('https://worker.example.test/operator', {
    headers: {
      [CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER]:
        `${OVERRIDE}, other-worker="${OTHER_VERSION}"`,
    },
  });

  assert.equal(calls, 3);
});
