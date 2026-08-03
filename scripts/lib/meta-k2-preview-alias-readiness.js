import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  META_K2_EXACT_RECOVERY_ATTESTATION_ENV,
  META_K2_EXACT_RECOVERY_ATTESTATION_HEADER,
  META_K2_EXACT_RECOVERY_IDENTITY,
  META_K2_EXACT_RECOVERY_PATH,
  META_K2_EXACT_RECOVERY_PHASE_ENV,
  META_K2_EXACT_RECOVERY_TOKEN_SHA256_ENV,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';
import {
  buildMetaK2PreviewRecoveryUrl,
} from './meta-k2-preview-recovery.js';

export const META_K2_PREVIEW_ALIAS_READINESS = Object.freeze({
  envName: 'MKT_META_K2_PREVIEW_ALIAS_READINESS',
  value: 'WAIT_FOR_ATTESTED_ACTIVE_PREVIEW',
});

const SAFE_PROBE_TOKEN = 'meta-k2-safe-preview-probe-only';
const READINESS_PROBE_PREFIX = 'meta-k2-alias-readiness-';
const WORKER_VERSION_HEADER = 'x-mkt-worker-version-id';
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const VERSION_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DEFAULT_DELAYS = Object.freeze([0, 500, 1_000, 2_000, 4_000, 8_000, 12_000]);
const PHASE_FILES = Object.freeze({
  d1: Object.freeze({
    config: 'wrangler.meta-k2-d1.preview.jsonc',
    verify: 'verify-d1-continuation.json',
    verifyPhase: 'verify-d1-continuation',
  }),
  lark: Object.freeze({
    config: 'wrangler.meta-k2-lark.preview.jsonc',
    verify: 'verify-lark-continuation.json',
    verifyPhase: 'verify-lark-continuation',
  }),
});

export function shouldGuardMetaK2ContinuationFetch(input, init = {}, env = {}) {
  if (env[META_K2_PREVIEW_ALIAS_READINESS.envName]
    !== META_K2_PREVIEW_ALIAS_READINESS.value) return false;
  const previewAlias = optionalText(env.MKT_META_K2_PREVIEW_ALIAS);
  const previewSubdomain = optionalText(env.MKT_META_K2_PREVIEW_SUBDOMAIN);
  if (!previewAlias || !previewSubdomain) return false;

  let url;
  try {
    url = new URL(readRequestUrl(input));
  } catch {
    return false;
  }
  const expected = buildMetaK2PreviewRecoveryUrl({
    previewAlias,
    accountWorkersDevSubdomain: previewSubdomain,
  });
  if (url.toString() !== expected || url.pathname !== META_K2_EXACT_RECOVERY_PATH) {
    return false;
  }

  const method = String(init?.method ?? input?.method ?? 'GET').toUpperCase();
  if (method !== 'POST') return false;
  const token = readBearerToken(input, init);
  return token !== ''
    && token !== SAFE_PROBE_TOKEN
    && !token.startsWith(READINESS_PROBE_PREFIX);
}

export async function resolveMetaK2PreviewAliasExpectation(input = {}) {
  const token = readBearerToken(input.requestInput, input.requestInit ?? {});
  if (token === '' || token === SAFE_PROBE_TOKEN || token.startsWith(READINESS_PROBE_PREFIX)) {
    throw readinessError(
      'Meta K2 Preview alias expectation requires the real ephemeral continuation token',
      'META_K2_PREVIEW_ALIAS_EXPECTATION_INVALID',
    );
  }
  const tokenSha256 = sha256(token);
  const repositoryRoot = resolve(input.repositoryRoot ?? process.cwd());
  const recoveryRoot = join(
    repositoryRoot,
    'outputs',
    'meta-d1-only-rollout',
    META_K2_EXACT_RECOVERY_IDENTITY.targetKey,
    META_K2_EXACT_RECOVERY_IDENTITY.operationId,
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
    if (vars[META_K2_EXACT_RECOVERY_TOKEN_SHA256_ENV] !== tokenSha256) continue;
    if (vars[META_K2_EXACT_RECOVERY_PHASE_ENV] !== phase) {
      throw readinessError(
        'Meta K2 Preview active config phase does not match its reviewed file identity',
        'META_K2_PREVIEW_ALIAS_EXPECTATION_INVALID',
        { phase },
      );
    }
    const expectedAttestation = requireFingerprint(
      vars[META_K2_EXACT_RECOVERY_ATTESTATION_ENV],
      META_K2_EXACT_RECOVERY_ATTESTATION_ENV,
    );
    const evidence = JSON.parse(await readFile(join(recoveryRoot, contract.verify), 'utf8'));
    const expectedVersionId = requireVersionId(
      evidence?.data?.activeVersion,
      'verify.data.activeVersion',
    );
    if (evidence?.phase !== contract.verifyPhase
      || evidence?.data?.routeAttestation !== expectedAttestation) {
      throw readinessError(
        'Meta K2 Preview verification evidence does not match the active phase config',
        'META_K2_PREVIEW_ALIAS_EXPECTATION_INVALID',
        { phase },
      );
    }
    return Object.freeze({
      phase,
      expectedAttestation,
      expectedVersionId,
      expectedAttestationFingerprint: sha256(expectedAttestation),
      expectedVersionFingerprint: sha256(expectedVersionId),
    });
  }

  throw readinessError(
    'Meta K2 Preview alias expectation could not match the real token to an active reviewed phase',
    'META_K2_PREVIEW_ALIAS_EXPECTATION_INVALID',
  );
}

export function classifyMetaK2PreviewAliasReadiness(input = {}) {
  const body = input.body && typeof input.body === 'object' && !Array.isArray(input.body)
    ? input.body
    : {};
  const expectedAttestation = requireFingerprint(
    input.expectedAttestation,
    'expectedAttestation',
  );
  const expectedVersionId = requireVersionId(
    input.expectedVersionId,
    'expectedVersionId',
  );
  const attestation = readHeader(input.headers, META_K2_EXACT_RECOVERY_ATTESTATION_HEADER);
  const versionId = readHeader(input.headers, WORKER_VERSION_HEADER);
  const accepted = Number(input.status) === 401
    && body.ok === false
    && body.stage === 'meta-exact-operation-continuation'
    && (body.phase ?? null) === null
    && body.code === 'META_PARTIAL_STAGING_RECOVERY_UNAUTHORIZED'
    && Number(body.directUseCaseInvocationCount) === 0
    && Number(body.queueMessageCount) === 0
    && Number(body.queueOperationAttemptMutationCount) === 0
    && body.larkWriteEnabled === false
    && body.scheduleEnabled === false
    && body.production === false
    && attestation === expectedAttestation
    && versionId === expectedVersionId;

  return Object.freeze({
    accepted,
    status: Number(input.status ?? 0),
    code: typeof body.code === 'string' ? body.code : null,
    phase: body.phase ?? null,
    directUseCaseInvocationCount: Number(body.directUseCaseInvocationCount ?? 0),
    queueMessageCount: Number(body.queueMessageCount ?? 0),
    queueOperationAttemptMutationCount:
      Number(body.queueOperationAttemptMutationCount ?? 0),
    attestationMatches: attestation === expectedAttestation,
    workerVersionMatches: versionId === expectedVersionId,
    attestationFingerprint: accepted ? sha256(attestation) : null,
    workerVersionFingerprint: accepted ? sha256(versionId) : null,
  });
}

export async function waitForAttestedMetaK2PreviewAlias(input = {}) {
  const fetchImpl = input.fetchImpl;
  if (typeof fetchImpl !== 'function') {
    throw readinessError(
      'Meta K2 Preview alias readiness requires a fetch implementation',
      'META_K2_PREVIEW_ALIAS_READINESS_INPUT_INVALID',
    );
  }
  const url = new URL(requireText(input.url, 'url'));
  if (url.protocol !== 'https:' || url.pathname !== META_K2_EXACT_RECOVERY_PATH) {
    throw readinessError(
      'Meta K2 Preview alias readiness requires the exact HTTPS recovery URL',
      'META_K2_PREVIEW_ALIAS_READINESS_INPUT_INVALID',
    );
  }
  const expectedAttestation = requireFingerprint(
    input.expectedAttestation,
    'expectedAttestation',
  );
  const expectedVersionId = requireVersionId(
    input.expectedVersionId,
    'expectedVersionId',
  );
  const delays = Array.isArray(input.delays) && input.delays.length > 0
    ? input.delays.map((value) => Math.max(0, Number(value) || 0))
    : DEFAULT_DELAYS;
  const sleep = input.sleep ?? ((milliseconds) => new Promise(
    (resolvePromise) => setTimeout(resolvePromise, milliseconds),
  ));
  let last = null;

  for (let index = 0; index < delays.length; index += 1) {
    if (delays[index] > 0) await sleep(delays[index]);
    const token = `${READINESS_PROBE_PREFIX}${randomBytes(32).toString('base64url')}`;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 10_000);
    try {
      const response = await fetchImpl(url, {
        method: 'POST',
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/json',
          'cache-control': 'no-store',
        },
        body: '{}',
        redirect: 'manual',
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      last = classifyMetaK2PreviewAliasReadiness({
        status: response.status,
        headers: response.headers,
        body,
        expectedAttestation,
        expectedVersionId,
      });
      if (last.accepted) {
        return Object.freeze({
          ...last,
          attemptCount: index + 1,
          directUseCaseInvocationCount: 0,
          remoteMutationCount: 0,
        });
      }
    } catch (error) {
      last = Object.freeze({
        accepted: false,
        status: null,
        code: error instanceof Error ? error.name : typeof error,
        phase: null,
        attestationMatches: false,
        workerVersionMatches: false,
      });
    } finally {
      clearTimeout(timer);
    }
  }

  throw readinessError(
    'Meta K2 Preview alias did not attest the exact active continuation version before the bounded deadline',
    'META_K2_PREVIEW_ALIAS_READINESS_TIMEOUT',
    {
      attemptCount: delays.length,
      lastStatus: last?.status ?? null,
      lastCode: last?.code ?? null,
      lastPhase: last?.phase ?? null,
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

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, fieldName) {
  const text = optionalText(value);
  if (!text) {
    throw readinessError(
      `${fieldName} is required`,
      'META_K2_PREVIEW_ALIAS_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireFingerprint(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!SHA256_PATTERN.test(text)) {
    throw readinessError(
      `${fieldName} must be a SHA-256 fingerprint`,
      'META_K2_PREVIEW_ALIAS_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireVersionId(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!VERSION_ID_PATTERN.test(text)) {
    throw readinessError(
      `${fieldName} must be a Worker version UUID`,
      'META_K2_PREVIEW_ALIAS_READINESS_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function readinessError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK2PreviewAliasReadinessError';
  error.code = code;
  error.details = details;
  return error;
}
