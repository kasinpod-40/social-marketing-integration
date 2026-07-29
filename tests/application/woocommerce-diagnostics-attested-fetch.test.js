import assert from 'node:assert/strict';
import test from 'node:test';
import {
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER,
} from '../../scripts/lib/woocommerce-worker-provider-diagnostics.js';
import {
  createWooCommerceDiagnosticsAttestedFetch,
} from '../../scripts/lib/woocommerce-diagnostics-attested-fetch.js';

const EXPECTED_ATTESTATION = 'a'.repeat(64);
const OTHER_ATTESTATION = 'b'.repeat(64);

function attestedResponse(attestation = null, status = 401) {
  const headers = attestation
    ? { [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER]: attestation }
    : {};
  return new Response(JSON.stringify({ ok: false }), { status, headers });
}

test('retries GET probes until the expected generated deployment attestation is observed', async () => {
  const responses = [
    attestedResponse(null),
    attestedResponse(OTHER_ATTESTATION),
    attestedResponse(EXPECTED_ATTESTATION),
  ];
  const delays = [];
  let calls = 0;
  const fetchImpl = async () => {
    calls += 1;
    return responses.shift();
  };
  const fetchWithRetry = createWooCommerceDiagnosticsAttestedFetch(fetchImpl, {
    delaysMs: [1, 2],
    sleep: async (delayMs) => delays.push(delayMs),
  });

  const response = await fetchWithRetry(
    'https://worker.example.test/operator',
    { method: 'GET' },
    EXPECTED_ATTESTATION,
  );

  assert.equal(calls, 3);
  assert.deepEqual(delays, [1, 2]);
  assert.equal(
    response.headers.get(WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER),
    EXPECTED_ATTESTATION,
  );
});

test('returns final unmatched response after bounded retries for fail-closed validator', async () => {
  let calls = 0;
  const fetchWithRetry = createWooCommerceDiagnosticsAttestedFetch(async () => {
    calls += 1;
    return attestedResponse(null, 404);
  }, {
    delaysMs: [0, 0],
    sleep: async () => {},
  });

  const response = await fetchWithRetry(
    'https://worker.example.test/operator',
    { method: 'GET' },
    EXPECTED_ATTESTATION,
  );

  assert.equal(calls, 3);
  assert.equal(response.status, 404);
  assert.equal(response.headers.get(WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER), null);
});

test('does not retry non-GET requests and rejects malformed expected attestations', async () => {
  let calls = 0;
  const fetchWithRetry = createWooCommerceDiagnosticsAttestedFetch(async () => {
    calls += 1;
    return attestedResponse(null, 200);
  }, {
    delaysMs: [0, 0, 0],
    sleep: async () => {
      throw new Error('sleep must not run');
    },
  });

  await fetchWithRetry(
    'https://worker.example.test/operator',
    { method: 'POST' },
    EXPECTED_ATTESTATION,
  );
  assert.equal(calls, 1);
  await assert.rejects(
    () => fetchWithRetry('https://worker.example.test/operator', { method: 'GET' }, 'bad'),
    /expectedAttestation/u,
  );
});
