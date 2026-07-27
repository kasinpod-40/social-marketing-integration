import { randomUUID } from 'node:crypto';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import { probeTikTokPostLarkRouteStability } from './tiktok-post-lark-rollout-operator.js';

export const TIKTOK_POST_LARK_VERSION_METADATA_BINDING = 'CF_VERSION_METADATA';
export const TIKTOK_POST_LARK_RUNTIME_VERSION_HEADER = 'x-mkt-worker-version-id';
export const CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER = 'Cloudflare-Workers-Version-Overrides';
export const TIKTOK_POST_LARK_AUDIT_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

const WORKER_VERSION_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const WORKER_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,62}$/u;
const AUDIT_TIMEOUT_MS = 30_000;

export function validateTikTokPostLarkVersionMetadataConfig(configText) {
  const text = requireText(configText, 'configText');
  const bindingPattern = new RegExp(
    `"version_metadata"\\s*:\\s*\\{[\\s\\S]*?"binding"\\s*:\\s*"${TIKTOK_POST_LARK_VERSION_METADATA_BINDING}"[\\s\\S]*?\\}`,
    'u',
  );
  if (!bindingPattern.test(text)) {
    throw operatorError(
      `TikTok post-Lark rollout config requires version_metadata binding ${TIKTOK_POST_LARK_VERSION_METADATA_BINDING}`,
      'TIKTOK_POST_LARK_ROLLOUT_CONFIG_UNSAFE',
      { binding: TIKTOK_POST_LARK_VERSION_METADATA_BINDING },
    );
  }
  return Object.freeze({
    versionMetadataBinding: TIKTOK_POST_LARK_VERSION_METADATA_BINDING,
  });
}

export function readTikTokPostLarkRuntimeVersionId(env = {}, options = {}) {
  const allowMissing = options.allowMissing === true;
  const value = env?.[TIKTOK_POST_LARK_VERSION_METADATA_BINDING]?.id;
  if ((value === undefined || value === null || value === '') && allowMissing) return null;
  return requireWorkerVersionId(value, 'runtimeVersionId');
}

export function addTikTokPostLarkRuntimeVersionHeader(response, runtimeVersionId) {
  if (!(response instanceof Response)) {
    throw operatorError(
      'TikTok post-Lark runtime version response is invalid',
      'TIKTOK_POST_LARK_AUDIT_VERSION_METADATA_INVALID',
    );
  }
  if (runtimeVersionId == null) return response;
  const versionId = requireWorkerVersionId(runtimeVersionId, 'runtimeVersionId');
  const headers = new Headers(response.headers);
  headers.set(TIKTOK_POST_LARK_RUNTIME_VERSION_HEADER, versionId);
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export function buildTikTokPostLarkVersionOverrideHeader(workerName, deploymentVersionId) {
  const name = requireWorkerName(workerName);
  const versionId = requireWorkerVersionId(deploymentVersionId, 'deploymentVersionId');
  return `${name}="${versionId}"`;
}

export function validateTikTokPostLarkResponseRuntimeVersion(response, expectedVersionId) {
  if (!(response instanceof Response)) {
    throw runtimeVersionMismatch(expectedVersionId, null);
  }
  const expected = requireWorkerVersionId(expectedVersionId, 'expectedVersionId');
  const observedRaw = response.headers.get(TIKTOK_POST_LARK_RUNTIME_VERSION_HEADER);
  const observed = WORKER_VERSION_ID_PATTERN.test(observedRaw ?? '') ? observedRaw : null;
  if (observed !== expected) throw runtimeVersionMismatch(expected, observed);
  return expected;
}

export function createTikTokPostLarkExactVersionFetch(options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
  if (typeof fetchImpl !== 'function') {
    throw operatorError(
      'TikTok post-Lark exact-version fetch implementation is invalid',
      'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_INVALID',
    );
  }
  const workerName = requireWorkerName(options.workerName);
  const deploymentVersionId = requireWorkerVersionId(
    options.deploymentVersionId,
    'deploymentVersionId',
  );
  const override = buildTikTokPostLarkVersionOverrideHeader(workerName, deploymentVersionId);

  return async function exactVersionFetch(input, init = {}) {
    const headers = new Headers(init.headers ?? {});
    headers.set(CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER, override);
    const response = await fetchImpl(input, { ...init, headers });
    validateTikTokPostLarkResponseRuntimeVersion(response, deploymentVersionId);
    return response;
  };
}

export async function probeTikTokPostLarkExactVersionRouteStability(options = {}) {
  const deploymentVersionId = requireWorkerVersionId(
    options.deploymentVersionId,
    'deploymentVersionId',
  );
  const exactFetch = createTikTokPostLarkExactVersionFetch({
    fetchImpl: options.fetchImpl,
    workerName: options.workerName,
    deploymentVersionId,
  });
  const route = await probeTikTokPostLarkRouteStability({
    ...options,
    fetchImpl: exactFetch,
  });
  return Object.freeze({
    ...route,
    runtimeVersionId: deploymentVersionId,
    versionOverridePinned: true,
  });
}

export async function fetchTikTokPostLarkExactVersionAudit(options = {}) {
  const origin = requireHttpsOrigin(options.origin);
  const pathname = requirePathname(options.pathname);
  const workerName = requireWorkerName(options.workerName);
  const deploymentVersionId = requireWorkerVersionId(
    options.deploymentVersionId,
    'deploymentVersionId',
  );
  const operatorToken = requireSecret(options.operatorToken, 'operatorToken');
  const createNonce = options.createNonce ?? randomUUID;
  if (typeof createNonce !== 'function') {
    throw operatorError(
      'TikTok post-Lark Audit nonce factory is invalid',
      'TIKTOK_POST_LARK_ROLLOUT_AUDIT_REQUEST_INVALID',
    );
  }
  const exactFetch = createTikTokPostLarkExactVersionFetch({
    fetchImpl: options.fetchImpl,
    workerName,
    deploymentVersionId,
  });
  const url = new URL(pathname, `${origin}/`);
  url.searchParams.set('mkt_audit', requireText(createNonce(), 'auditNonce'));
  return exactFetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers: {
      Authorization: `Bearer ${operatorToken}`,
      Accept: 'application/json',
      'Cache-Control': 'no-cache, no-store',
      Pragma: 'no-cache',
    },
    signal: AbortSignal.timeout(AUDIT_TIMEOUT_MS),
  });
}

export async function readTikTokPostLarkBoundedJsonResponse(
  response,
  maxBytes = TIKTOK_POST_LARK_AUDIT_RESPONSE_MAX_BYTES,
) {
  if (!(response instanceof Response)) {
    throw operatorError(
      'TikTok post-Lark Audit response is invalid',
      'TIKTOK_POST_LARK_ROLLOUT_AUDIT_RESPONSE_INVALID',
    );
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes <= 0) {
    throw operatorError(
      'TikTok post-Lark Audit response bound is invalid',
      'TIKTOK_POST_LARK_ROLLOUT_AUDIT_RESPONSE_INVALID',
    );
  }
  const reader = response.body?.getReader();
  if (!reader) return parseJson('', response.status);
  const chunks = [];
  let totalBytes = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        throw operatorError(
          'TikTok post-Lark Audit response exceeded the bounded size',
          'TIKTOK_POST_LARK_ROLLOUT_AUDIT_RESPONSE_TOO_LARGE',
          { maxBytes },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseJson(new TextDecoder().decode(bytes), response.status);
}

export function validateTikTokPostLarkExactVersionEnableEvidence(evidence = {}) {
  const deploymentVersionId = requireWorkerVersionIdOrNull(evidence.deploymentVersionId);
  const runtimeVersionId = requireWorkerVersionIdOrNull(evidence.runtimeVersionId);
  if (
    deploymentVersionId === null
    || runtimeVersionId !== deploymentVersionId
    || evidence.versionOverridePinned !== true
  ) {
    throw operatorError(
      'TikTok post-Lark enable-audit evidence lacks exact runtime-version proof',
      'TIKTOK_POST_LARK_ROLLOUT_ENABLE_EVIDENCE_STALE',
      { exactVersionRequired: true },
    );
  }
  return evidence;
}

function parseJson(text, status) {
  try {
    return JSON.parse(text);
  } catch {
    throw operatorError(
      'TikTok post-Lark Audit response was not valid JSON',
      'TIKTOK_POST_LARK_ROLLOUT_AUDIT_RESPONSE_INVALID',
      { status },
    );
  }
}

function runtimeVersionMismatch(expectedVersionId, observedVersionId) {
  return operatorError(
    'TikTok post-Lark response runtime version did not match the exact deployment',
    'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_MISMATCH',
    {
      expectedVersionId: requireWorkerVersionId(expectedVersionId, 'expectedVersionId'),
      observedVersionId,
      safeCloseRequired: true,
    },
  );
}

function requireWorkerVersionIdOrNull(value) {
  return WORKER_VERSION_ID_PATTERN.test(value ?? '') ? value : null;
}

function requireWorkerVersionId(value, fieldName) {
  if (!WORKER_VERSION_ID_PATTERN.test(value ?? '')) {
    throw operatorError(
      `${fieldName} must be a Worker version UUID`,
      'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireWorkerName(value) {
  const name = requireText(value, 'workerName');
  if (!WORKER_NAME_PATTERN.test(name)) {
    throw operatorError(
      'workerName is invalid',
      'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_INVALID',
      { fieldName: 'workerName' },
    );
  }
  return name;
}

function requireHttpsOrigin(value) {
  let url;
  try {
    url = new URL(requireText(value, 'origin'));
  } catch {
    throw operatorError(
      'origin must be an HTTPS origin',
      'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_INVALID',
      { fieldName: 'origin' },
    );
  }
  if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash) {
    throw operatorError(
      'origin must be an HTTPS origin',
      'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_INVALID',
      { fieldName: 'origin' },
    );
  }
  return url.origin;
}

function requirePathname(value) {
  const pathname = requireText(value, 'pathname');
  if (!pathname.startsWith('/') || pathname.includes('?') || pathname.includes('#')) {
    throw operatorError(
      'pathname is invalid',
      'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_INVALID',
      { fieldName: 'pathname' },
    );
  }
  return pathname;
}

function requireSecret(value, fieldName) {
  const secret = requireText(value, fieldName);
  if (secret.length < 16) {
    throw operatorError(
      `${fieldName} is invalid`,
      'TIKTOK_POST_LARK_ROLLOUT_AUDIT_REQUEST_INVALID',
      { fieldName },
    );
  }
  return secret;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw operatorError(
      `${fieldName} is required`,
      'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function operatorError(message, code, details = {}) {
  return permanentError(code, message, Object.freeze({ ...details }));
}
