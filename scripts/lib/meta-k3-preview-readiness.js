import { setTimeout as sleep } from 'node:timers/promises';

const VERSION_ID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256 = /^[0-9a-f]{64}$/u;
const RETRYABLE_STATUSES = new Set([404, 429, 502, 503, 504]);

export async function waitForMetaK3PreviewReadiness(input = {}) {
  const url = requireHttpsUrl(input.url, 'url');
  const token = requireText(input.token, 'token');
  const attestation = requirePattern(
    input.attestation,
    SHA256,
    'attestation',
  );
  const activeVersion = requirePattern(
    input.activeVersion,
    VERSION_ID,
    'activeVersion',
  ).toLowerCase();
  const fetchImpl = input.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw readinessError(
      'K3 Preview readiness requires fetch',
      'META_K3_PREVIEW_READINESS_FETCH_INVALID',
    );
  }
  const maxAttempts = positiveInteger(input.maxAttempts, 60, 'maxAttempts');
  const intervalMs = nonNegativeInteger(input.intervalMs, 1_000, 'intervalMs');
  const requestTimeoutMs = positiveInteger(
    input.requestTimeoutMs,
    10_000,
    'requestTimeoutMs',
  );

  let lastStatus = null;
  let lastAttestationMatched = false;
  let lastVersionMatched = false;
  let networkErrorCount = 0;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    let response = null;
    try {
      response = await fetchImpl(url, {
        method: 'HEAD',
        headers: {
          authorization: `Bearer ${token}`,
          'cache-control': 'no-store',
        },
        redirect: 'manual',
        signal: AbortSignal.timeout(requestTimeoutMs),
      });
    } catch {
      networkErrorCount += 1;
    }

    if (response) {
      lastStatus = response.status;
      lastAttestationMatched =
        response.headers.get('x-mkt-meta-partial-staging-attestation')
          === attestation;
      lastVersionMatched =
        response.headers.get('x-mkt-worker-version-id')?.toLowerCase()
          === activeVersion;

      if (
        response.status === 204
        && lastAttestationMatched
        && lastVersionMatched
      ) {
        return Object.freeze({
          accepted: true,
          attempts: attempt,
          status: response.status,
          attestationMatched: true,
          activeVersionMatched: true,
          networkErrorCount,
          businessInvocationCount: 0,
          queueMessageCount: 0,
        });
      }

      if (!RETRYABLE_STATUSES.has(response.status)
        && response.status !== 204) {
        throw readinessError(
          'K3 Preview readiness returned a non-retryable status',
          'META_K3_PREVIEW_READINESS_REJECTED',
          {
            attempt,
            status: response.status,
            attestationMatched: lastAttestationMatched,
            activeVersionMatched: lastVersionMatched,
          },
        );
      }
    }

    if (attempt < maxAttempts && intervalMs > 0) {
      await sleep(intervalMs);
    }
  }

  throw readinessError(
    'K3 Preview alias did not become ready within the bounded window',
    'META_K3_PREVIEW_READINESS_TIMEOUT',
    {
      maxAttempts,
      lastStatus,
      lastAttestationMatched,
      lastVersionMatched,
      networkErrorCount,
    },
  );
}

function requireHttpsUrl(value, fieldName) {
  const text = requireText(value, fieldName);
  let url = null;
  try {
    url = new URL(text);
  } catch {
    throw readinessError(
      `${fieldName} must be a valid URL`,
      'META_K3_PREVIEW_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  if (
    url.protocol !== 'https:'
    || url.username !== ''
    || url.password !== ''
    || url.search !== ''
    || url.hash !== ''
  ) {
    throw readinessError(
      `${fieldName} must be an exact HTTPS URL`,
      'META_K3_PREVIEW_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return url.toString();
}

function requirePattern(value, pattern, fieldName) {
  const text = requireText(value, fieldName);
  if (!pattern.test(text)) {
    throw readinessError(
      `${fieldName} is invalid`,
      'META_K3_PREVIEW_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw readinessError(
      `${fieldName} is required`,
      'META_K3_PREVIEW_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function positiveInteger(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw readinessError(
      `${fieldName} must be a positive integer`,
      'META_K3_PREVIEW_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return number;
}

function nonNegativeInteger(value, fallback, fieldName) {
  const number = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw readinessError(
      `${fieldName} must be a non-negative integer`,
      'META_K3_PREVIEW_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return number;
}

function readinessError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK3PreviewReadinessError';
  error.code = code;
  error.details = details;
  return error;
}
