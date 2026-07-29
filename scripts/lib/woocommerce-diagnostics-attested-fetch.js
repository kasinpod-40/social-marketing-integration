import {
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER,
} from './woocommerce-worker-provider-diagnostics.js';

const DEFAULT_DELAYS_MS = Object.freeze([500, 1_000, 2_000, 3_000]);
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

/** Retry bounded GET probes until the generated deployment attestation is observed. */
export function createWooCommerceDiagnosticsAttestedFetch(fetchImpl, options = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }
  const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const delaysMs = Object.freeze([...(options.delaysMs ?? DEFAULT_DELAYS_MS)]);
  if (typeof sleep !== 'function' || delaysMs.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new TypeError('WooCommerce diagnostics attestation retry options are invalid');
  }

  return async function wooCommerceDiagnosticsAttestedFetch(
    input,
    init = undefined,
    expectedAttestationInput = undefined,
  ) {
    const expectedAttestation = requireSha256(expectedAttestationInput);
    const method = String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
    if (method !== 'GET') return fetchImpl(input, init);

    for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
      const response = await fetchImpl(input, init);
      if (!(response instanceof Response)) return response;
      const observed = response.headers.get(WOOCOMMERCE_PROVIDER_DIAGNOSTICS_ATTESTATION_HEADER);
      if (observed?.toLowerCase() === expectedAttestation) return response;
      if (attempt === delaysMs.length) return response;
      await response.body?.cancel().catch(() => {});
      await sleep(delaysMs[attempt]);
    }

    throw new Error('WooCommerce diagnostics attestation retry exhausted unexpectedly');
  };
}

function requireSha256(value) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA256_PATTERN.test(text)) {
    throw new TypeError('expectedAttestation must be a SHA-256 digest');
  }
  return text;
}
