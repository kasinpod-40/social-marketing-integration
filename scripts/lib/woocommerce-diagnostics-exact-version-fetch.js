import {
  CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER,
  WORKER_RUNTIME_VERSION_HEADER,
  isWorkerVersionId,
} from '../../packages/shared/src/cloudflare/worker-version.js';

const DEFAULT_DELAYS_MS = Object.freeze([500, 1_000, 2_000, 3_000]);

/** Retry only exact-version GET probes while a just-deployed version propagates globally. */
export function createWooCommerceDiagnosticsExactVersionFetch(fetchImpl, options = {}) {
  if (typeof fetchImpl !== 'function') {
    throw new TypeError('fetchImpl must be a function');
  }
  const sleep = options.sleep ?? ((delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)));
  const delaysMs = Object.freeze([...(options.delaysMs ?? DEFAULT_DELAYS_MS)]);
  if (typeof sleep !== 'function' || delaysMs.some((value) => !Number.isInteger(value) || value < 0)) {
    throw new TypeError('WooCommerce diagnostics exact-version retry options are invalid');
  }

  return async function wooCommerceDiagnosticsExactVersionFetch(input, init = undefined) {
    const expectedVersionId = readExpectedVersionId(input, init);
    const method = readMethod(input, init);
    if (!expectedVersionId || method !== 'GET') return fetchImpl(input, init);

    for (let attempt = 0; attempt <= delaysMs.length; attempt += 1) {
      const response = await fetchImpl(input, init);
      if (!(response instanceof Response)) return response;
      if (response.headers.get(WORKER_RUNTIME_VERSION_HEADER) === expectedVersionId) {
        return response;
      }
      if (attempt === delaysMs.length) return response;
      await response.body?.cancel().catch(() => {});
      await sleep(delaysMs[attempt]);
    }

    throw new Error('WooCommerce diagnostics exact-version retry exhausted unexpectedly');
  };
}

function readExpectedVersionId(input, init) {
  const headers = new Headers(input instanceof Request ? input.headers : undefined);
  if (init?.headers !== undefined) {
    for (const [name, value] of new Headers(init.headers)) headers.set(name, value);
  }
  const value = headers.get(CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER) ?? '';
  const matches = [...value.matchAll(/="([0-9a-f-]{36})"/giu)]
    .map((match) => match[1]?.toLowerCase())
    .filter(isWorkerVersionId);
  return matches.length === 1 ? matches[0] : null;
}

function readMethod(input, init) {
  return String(init?.method ?? (input instanceof Request ? input.method : 'GET')).toUpperCase();
}
