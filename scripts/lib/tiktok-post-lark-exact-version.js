import { randomUUID } from 'node:crypto';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import {
  CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER,
  WORKER_RUNTIME_VERSION_HEADER,
  WORKER_VERSION_METADATA_BINDING,
  buildWorkerVersionOverrideHeader,
  isWorkerVersionId,
  requireWorkerName,
  requireWorkerVersionId,
  validateWorkerResponseRuntimeVersion,
} from '../../packages/shared/src/cloudflare/worker-version.js';
import { probeTikTokPostLarkRouteStability } from './tiktok-post-lark-rollout-operator.js';

export const TIKTOK_POST_LARK_VERSION_METADATA_BINDING = WORKER_VERSION_METADATA_BINDING;
export const TIKTOK_POST_LARK_RUNTIME_VERSION_HEADER = WORKER_RUNTIME_VERSION_HEADER;
export { CLOUDFLARE_WORKERS_VERSION_OVERRIDES_HEADER };
export const TIKTOK_POST_LARK_AUDIT_RESPONSE_MAX_BYTES = 2 * 1024 * 1024;

const AUDIT_TIMEOUT_MS = 30_000;

export function validateTikTokPostLarkVersionMetadataConfig(configText) {
  const text = requireText(configText, 'configText');
  const bindingPattern = new RegExp(
    `"version_metadata"\\s*:\\s*\\{[\\s\\S]*?"binding"\\s*:\\s*"${WORKER_VERSION_METADATA_BINDING}"[\\s\\S]*?\\}`,
    'u',
  );
  if (!bindingPattern.test(text)) {
    throw operatorError(
      `TikTok post-Lark rollout config requires version_metadata binding ${WORKER_VERSION_METADATA_BINDING}`,
      'TIKTOK_POST_LARK_ROLLOUT_CONFIG_UNSAFE',
      { binding: WORKER_VERSION_METADATA_BINDING },
    );
  }
  return Object.freeze({
    versionMetadataBinding: WORKER_VERSION_METADATA_BINDING,
  });
}

export function buildTikTokPostLarkVersionOverrideHeader(workerName, deploymentVersionId) {
  return buildWorkerVersionOverrideHeader(workerName, deploymentVersionId);
}

export function validateTikTokPostLarkResponseRuntimeVersion(response, expectedVersionId) {
  try {
    return validateWorkerResponseRuntimeVersion(response, expectedVersionId, {
      errorCode: 'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_MISMATCH',
      safeCloseRequired: true,
    });
  } catch (error) {
    if (error?.code === 'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_MISMATCH') throw error;
    throw operatorError(
      'TikTok post-Lark runtime-version validation failed',
      'TIKTOK_POST_LARK_ROLLOUT_RUNTIME_VERSION_INVALID',
    );
  }
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
  const override = buildWorkerVersionOverrideHeader(workerName, deploymentVersionId);

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
  const deploymentVersionId = isWorkerVersionId(evidence.deploymentVersionId)
    ? evidence.deploymentVersionId
    : null;
  const runtimeVersionId = isWorkerVersionId(evidence.runtimeVersionId)
    ? evidence.runtimeVersionId
    : null;
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
  return permanentError(message, {
    code,
    details: Object.freeze({ ...details }),
  });
}
