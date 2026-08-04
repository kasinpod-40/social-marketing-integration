import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  META_K3_EXACT_RECOVERY_ATTESTATION_ENV,
  META_K3_EXACT_RECOVERY_ATTESTATION_HEADER,
  META_K3_EXACT_RECOVERY_IDENTITY,
  META_K3_EXACT_RECOVERY_PATH,
  META_K3_EXACT_RECOVERY_PHASE_ENV,
  META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV,
} from '../../packages/config/src/meta-k3-exact-recovery-contract.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';
import {
  META_K3_PREVIEW_WORKER_NAME,
} from './meta-k3-preview-recovery.js';
import {
  buildWooCommerceDiagnosticsPreviewOrigin,
} from './woocommerce-diagnostics-preview-upload.js';

export const META_K3_PREVIEW_ALIAS_READINESS = Object.freeze({
  envName: 'MKT_META_K3_PREVIEW_ALIAS_READINESS',
  value: 'WAIT_FOR_ATTESTED_ACTIVE_PREVIEW',
});

export const META_K3_SAFE_PREVIEW_PROBE_TOKEN =
  'meta-k3-safe-preview-probe-only';

const WORKER_VERSION_HEADER = 'x-mkt-worker-version-id';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_DELAYS = Object.freeze([0, 500, 1_000, 2_000, 4_000, 8_000, 12_000]);
const PHASE_FILES = Object.freeze({
  d1: Object.freeze({
    config: 'wrangler.meta-k3-d1.preview.jsonc',
    verify: 'verify-d1-continuation.json',
    verifyPhase: 'verify-d1-continuation',
  }),
  lark: Object.freeze({
    config: 'wrangler.meta-k3-lark.preview.jsonc',
    verify: 'verify-lark-continuation.json',
    verifyPhase: 'verify-lark-continuation',
  }),
});

export function shouldGuardMetaK3PreviewFetch(input, init = {}, env = {}) {
  if (env[META_K3_PREVIEW_ALIAS_READINESS.envName]
    !== META_K3_PREVIEW_ALIAS_READINESS.value) return false;

  let url;
  try {
    url = new URL(readRequestUrl(input));
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.pathname !== META_K3_EXACT_RECOVERY_PATH) {
    return false;
  }

  const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
  if (method !== 'POST') return false;
  const token = readBearerToken(input, init);
  if (token === META_K3_SAFE_PREVIEW_PROBE_TOKEN) return true;
  if (token === '') return false;

  const previewAlias = optionalText(env.MKT_META_K3_PREVIEW_ALIAS);
  const previewSubdomain = optionalText(env.MKT_META_K3_PREVIEW_SUBDOMAIN);
  if (!previewAlias || !previewSubdomain) return false;
  return url.toString() === buildMetaK3PreviewRecoveryUrl({
    previewAlias,
    accountWorkersDevSubdomain: previewSubdomain,
  });
}

export async function waitForMetaK3SafePreviewRoute(input = {}) {
  const fetchImpl = requireFetch(input.fetchImpl);
  const requestInput = input.requestInput;
  const requestInit = input.requestInit ?? {};
  const delays = normalizeDelays(input.delays);
  const sleep = input.sleep ?? defaultSleep;
  let last = null;

  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index] > 0) await sleep(delays[index]);
    try {
      const response = await fetchImpl(requestInput, requestInit);
      const body = await response.clone().json().catch(() => ({}));
      last = classifyMetaK3SafePreviewRoute({
        status: response.status,
        redirected: response.redirected,
        body,
      });
      if (last.accepted) {
        return Object.freeze({ response, result: Object.freeze({
          ...last,
          attemptCount: index + 1,
          directUseCaseInvocationCount: 0,
          queueMessageCount: 0,
          remoteMutationCount: 0,
        }) });
      }
    } catch (error) {
      last = Object.freeze({
        accepted: false,
        status: null,
        responseStage: null,
        responseCode: error instanceof Error ? error.name : typeof error,
      });
    }
  }

  throw readinessError(
    'K3 Safe Preview alias did not reach the dedicated all-false handler before the bounded deadline',
    'META_K3_PREVIEW_SAFE_ALIAS_READINESS_TIMEOUT',
    {
      attemptCount: delays.length,
      lastStatus: last?.status ?? null,
      lastResponseStage: last?.responseStage ?? null,
      lastResponseCode: last?.responseCode ?? null,
      directUseCaseInvocationCount: 0,
      queueMessageCount: 0,
      remoteMutationCount: 0,
    },
  );
}

export async function resolveMetaK3PreviewAliasExpectation(input = {}) {
  const token = readBearerToken(input.requestInput, input.requestInit ?? {});
  if (token === '' || token === META_K3_SAFE_PREVIEW_PROBE_TOKEN) {
    throw readinessError(
      'K3 Preview alias expectation requires the real ephemeral continuation token',
      'META_K3_PREVIEW_ALIAS_EXPECTATION_INVALID',
    );
  }
  const tokenSha256 = sha256(token);
  const repositoryRoot = resolve(input.repositoryRoot ?? process.cwd());
  const recoveryRoot = join(
    repositoryRoot,
    'outputs',
    'meta-d1-only-rollout',
    META_K3_EXACT_RECOVERY_IDENTITY.targetKey,
    META_K3_EXACT_RECOVERY_IDENTITY.operationId,
    'exact-partial-staging-recovery-v1',
  );

  for (const [phase, contract] of Object.entries(PHASE_FILES)) {
    let configText;
    try {
      configText = await readFile(join(recoveryRoot, contract.config), 'utf8');
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      throw error;
    }
    const config = parseJsoncObject(configText);
    const vars = config?.vars && typeof config.vars === 'object' ? config.vars : {};
    if (vars[META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV] !== tokenSha256) continue;
    if (vars[META_K3_EXACT_RECOVERY_PHASE_ENV] !== phase) {
      throw readinessError(
        'K3 Preview active config phase does not match its reviewed file identity',
        'META_K3_PREVIEW_ALIAS_EXPECTATION_INVALID',
        { phase },
      );
    }
    const expectedAttestation = requireFingerprint(
      vars[META_K3_EXACT_RECOVERY_ATTESTATION_ENV],
      META_K3_EXACT_RECOVERY_ATTESTATION_ENV,
    );
    const evidence = JSON.parse(await readFile(join(recoveryRoot, contract.verify), 'utf8'));
    const expectedVersionId = requireVersionId(
      evidence?.data?.activeVersion,
      'verify.data.activeVersion',
    );
    if (evidence?.phase !== contract.verifyPhase
      || evidence?.data?.routeAttestation !== expectedAttestation) {
      throw readinessError(
        'K3 Preview verification evidence does not match the active phase config',
        'META_K3_PREVIEW_ALIAS_EXPECTATION_INVALID',
        { phase },
      );
    }
    return Object.freeze({
      phase,
      token,
      expectedAttestation,
      expectedVersionId,
      expectedAttestationFingerprint: sha256(expectedAttestation),
      expectedVersionFingerprint: sha256(expectedVersionId),
    });
  }

  throw readinessError(
    'K3 Preview alias expectation could not match the real token to an active reviewed phase',
    'META_K3_PREVIEW_ALIAS_EXPECTATION_INVALID',
  );
}

export async function waitForAttestedMetaK3PreviewAlias(input = {}) {
  const fetchImpl = requireFetch(input.fetchImpl);
  const url = new URL(requireText(input.url, 'url'));
  if (url.protocol !== 'https:' || url.pathname !== META_K3_EXACT_RECOVERY_PATH) {
    throw readinessError(
      'K3 Preview alias readiness requires the exact HTTPS recovery URL',
      'META_K3_PREVIEW_ALIAS_READINESS_INPUT_INVALID',
    );
  }
  const token = requireText(input.token, 'token');
  const expectedAttestation = requireFingerprint(
    input.expectedAttestation,
    'expectedAttestation',
  );
  const expectedVersionId = requireVersionId(
    input.expectedVersionId,
    'expectedVersionId',
  );
  const delays = normalizeDelays(input.delays);
  const sleep = input.sleep ?? defaultSleep;
  let last = null;

  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index] > 0) await sleep(delays[index]);
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(url, {
        method: 'HEAD',
        headers: {
          authorization: `Bearer ${token}`,
          'cache-control': 'no-store',
        },
        redirect: 'manual',
        signal: controller.signal,
      });
      last = classifyMetaK3PreviewAliasReadiness({
        status: response.status,
        headers: response.headers,
        expectedAttestation,
        expectedVersionId,
      });
      if (last.accepted) {
        return Object.freeze({
          ...last,
          attemptCount: index + 1,
          directUseCaseInvocationCount: 0,
          queueMessageCount: 0,
          remoteMutationCount: 0,
        });
      }
    } catch (error) {
      last = Object.freeze({
        accepted: false,
        status: null,
        attestationMatches: false,
        workerVersionMatches: false,
        errorName: error instanceof Error ? error.name : typeof error,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  throw readinessError(
    'K3 Preview alias did not attest the exact active continuation version before the bounded deadline',
    'META_K3_PREVIEW_ALIAS_READINESS_TIMEOUT',
    {
      attemptCount: delays.length,
      lastStatus: last?.status ?? null,
      attestationMatches: last?.attestationMatches ?? false,
      workerVersionMatches: last?.workerVersionMatches ?? false,
      expectedAttestationFingerprint: sha256(expectedAttestation),
      expectedVersionFingerprint: sha256(expectedVersionId),
      directUseCaseInvocationCount: 0,
      queueMessageCount: 0,
      remoteMutationCount: 0,
    },
  );
}

export function classifyMetaK3SafePreviewRoute(input = {}) {
  const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body)
    ? input.body
    : {};
  const accepted = Number(input.status) === 400
    && input.redirected === false
    && body.ok === false
    && body.stage === 'meta-exact-operation-continuation'
    && body.code === 'META_K3_RECOVERY_CONFIG_INVALID'
    && Number(body.directUseCaseInvocationCount) === 0
    && Number(body.queueMessageCount) === 0
    && Number(body.queueOperationAttemptMutationCount) === 0
    && body.scheduleEnabled === false
    && body.production === false;
  return Object.freeze({
    accepted,
    status: Number(input.status ?? 0),
    responseStage: typeof body.stage === 'string' ? body.stage : null,
    responseCode: typeof body.code === 'string' ? body.code : null,
  });
}

export function classifyMetaK3PreviewAliasReadiness(input = {}) {
  const expectedAttestation = requireFingerprint(
    input.expectedAttestation,
    'expectedAttestation',
  );
  const expectedVersionId = requireVersionId(
    input.expectedVersionId,
    'expectedVersionId',
  );
  const attestation = readHeader(input.headers, META_K3_EXACT_RECOVERY_ATTESTATION_HEADER);
  const versionId = readHeader(input.headers, WORKER_VERSION_HEADER);
  const accepted = Number(input.status) === 204
    && attestation === expectedAttestation
    && versionId === expectedVersionId;
  return Object.freeze({
    accepted,
    status: Number(input.status ?? 0),
    attestationMatches: attestation === expectedAttestation,
    workerVersionMatches: versionId === expectedVersionId,
    attestationFingerprint: accepted ? sha256(attestation) : null,
    workerVersionFingerprint: accepted ? sha256(versionId) : null,
  });
}

export function buildMetaK3PreviewRecoveryUrl(input = {}) {
  const previewOrigin = buildWooCommerceDiagnosticsPreviewOrigin({
    previewAlias: requireText(input.previewAlias, 'previewAlias'),
    workerName: META_K3_PREVIEW_WORKER_NAME,
    accountWorkersDevSubdomain: requireText(
      input.accountWorkersDevSubdomain,
      'accountWorkersDevSubdomain',
    ),
  });
  return new URL(META_K3_EXACT_RECOVERY_PATH, `${previewOrigin}/`).toString();
}

function readRequestUrl(input) {
  if (typeof input === 'string' || input instanceof URL) return String(input);
  return input?.url ?? '';
}

function readBearerToken(input, init) {
  const authorization = mergedHeaders(input, init).get('authorization') ?? '';
  return /^Bearer[ \t]+(.+)$/iu.exec(authorization)?.[1]?.trim() ?? '';
}

function mergedHeaders(input, init) {
  const headers = new Headers(input?.headers ?? undefined);
  const overrides = new Headers(init?.headers ?? undefined);
  for (const [name, value] of overrides) headers.set(name, value);
  return headers;
}

function readHeader(headers, name) {
  if (headers && typeof headers.get === 'function') return headers.get(name);
  if (!headers || typeof headers !== 'object') return null;
  const expected = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected) return String(value);
  }
  return null;
}

function normalizeDelays(value) {
  return Array.isArray(value) && value.length > 0
    ? value.map((entry) => Math.max(0, Number(entry) || 0))
    : DEFAULT_DELAYS;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireFetch(value) {
  if (typeof value !== 'function') {
    throw readinessError(
      'K3 Preview alias readiness requires a fetch implementation',
      'META_K3_PREVIEW_ALIAS_READINESS_INPUT_INVALID',
    );
  }
  return value;
}

function requireFingerprint(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!SHA256_PATTERN.test(text)) {
    throw readinessError(
      `${fieldName} must be a SHA-256 fingerprint`,
      'META_K3_PREVIEW_ALIAS_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireVersionId(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!VERSION_ID_PATTERN.test(text)) {
    throw readinessError(
      `${fieldName} must be a Worker version UUID`,
      'META_K3_PREVIEW_ALIAS_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw readinessError(
      `${fieldName} is required`,
      'META_K3_PREVIEW_ALIAS_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function defaultSleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function readinessError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK3PreviewAliasReadinessError';
  error.code = code;
  error.details = details;
  return error;
}
