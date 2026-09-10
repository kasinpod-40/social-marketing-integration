const DEFAULT_DELAYS = Object.freeze([0, 500, 1_000, 2_000, 4_000, 8_000, 12_000]);

/**
 * Wait for a newly uploaded Preview alias to resolve to the dedicated operator route.
 * The probe is GET-only, so it cannot provision schema, write rows, or run retention.
 */
export async function waitForMktAdsPreviewRoute(input = {}) {
  const fetchImpl = input.fetchImpl;
  if (typeof fetchImpl !== 'function') {
    throw readinessError('Preview readiness requires fetch', 'MKT_ADS_PREVIEW_READINESS_INPUT_INVALID');
  }
  const url = new URL(requireText(input.url, 'url'));
  if (url.protocol !== 'https:') {
    throw readinessError('Preview readiness requires HTTPS', 'MKT_ADS_PREVIEW_READINESS_INPUT_INVALID');
  }
  const delays = normalizeDelays(input.delays);
  const sleep = input.sleep ?? defaultSleep;
  let last = null;

  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index] > 0) await sleep(delays[index]);
    const probeUrl = new URL(url);
    probeUrl.searchParams.set('__readiness', String(index + 1));
    try {
      const response = await fetchImpl(probeUrl, {
        method: 'GET',
        headers: { 'cache-control': 'no-store' },
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
      });
      const body = await response.json().catch(() => null);
      last = Object.freeze({
        status: response.status,
        code: typeof body?.code === 'string' ? body.code : null,
      });
      if (response.status === 405 && body?.ok === false && body?.code === 'METHOD_NOT_ALLOWED') {
        return Object.freeze({
          ready: true,
          attemptCount: index + 1,
          status: response.status,
          code: body.code,
          remoteMutationCount: 0,
        });
      }
    } catch (error) {
      last = Object.freeze({
        status: null,
        code: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  throw readinessError(
    'Preview alias did not reach the dedicated read-only readiness boundary',
    'MKT_ADS_PREVIEW_READINESS_TIMEOUT',
    { attemptCount: delays.length, lastStatus: last?.status ?? null, lastCode: last?.code ?? null },
  );
}

function normalizeDelays(delays) {
  if (!Array.isArray(delays) || delays.length === 0) return DEFAULT_DELAYS;
  return delays.map((value) => Math.max(0, Number(value) || 0));
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw readinessError(`${label} is required`, 'MKT_ADS_PREVIEW_READINESS_INPUT_INVALID');
  }
  return value.trim();
}

function defaultSleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function readinessError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
