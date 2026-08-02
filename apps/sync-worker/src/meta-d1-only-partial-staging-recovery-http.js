import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../../packages/application/src/jobs/queue-operation.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import {
  sanitizeOperationalError,
  sanitizeOperationalValue,
} from '../../../packages/shared/src/errors/runtime-error.js';
import { json } from '../../../packages/shared/src/http/response.js';
import { timingSafeEqualText } from '../../../packages/shared/src/security/secure-token.js';
import {
  addWorkerRuntimeVersionHeader,
  readWorkerRuntimeVersionId,
} from '../../../packages/shared/src/cloudflare/worker-version.js';
import { processJobWithMetaEndToEnd } from './meta-active-job-router.js';
import { createInfrastructure } from './runtime-infrastructure.js';

export const META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PATH =
  '/operator/meta/d1-only-partial-staging-continuation';
export const META_D1_ONLY_PARTIAL_STAGING_RECOVERY_MODE =
  'RECOVER_EXACT_PARTIAL_META_ADS_STAGING';
export const META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256_ENV =
  'MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256';
export const META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_ENV =
  'MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION';
export const META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_HEADER =
  'x-mkt-meta-partial-staging-attestation';

const EXACT_TARGET = Object.freeze({
  environment: 'development',
  customerProfile: 'integration_workspace',
  customerKey: 'chemistry_k',
  targetKey: 'chemistry_k2',
  sourceAccountKey: 'chemistry_k2',
  operationId: 'meta-chemistry_k2-history-20260701-20260731-f741090d1d8a',
  workKey:
    'meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-f741090d1d8a',
  syncRunId:
    'meta:meta_ads:chemistry_k2:meta-chemistry_k2-history-20260701-20260731-f741090d1d8a',
  periodStart: '2026-07-01',
  periodEnd: '2026-07-31',
});
const APPROVED_TRUE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_META_ADS_ENABLED',
  'MKT_META_D1_WRITE_ENABLED',
  'MKT_META_SOURCE_READ_ENABLED',
]);
const EXECUTION_FLAG_PATTERN = /^MKT_[A-Z0-9_]+_ENABLED$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CONTINUATION_STATUSES = new Set([
  'source_continuation',
  'd1_continuation',
  'lark_continuation',
]);

/**
 * Exact, ephemeral continuation surface for the accepted Chemistry K2 partial Meta Ads staging.
 * It invokes the existing Meta Queue use-case with a local continuation Queue stub, so no Cloudflare
 * Queue message or queue_operation_attempt is created by this route.
 */
export function createMetaD1OnlyPartialStagingRecoveryHttpHandler(dependencies = {}) {
  const runtimeVersionReader = dependencies.readRuntimeVersionId ?? readWorkerRuntimeVersionId;
  const processJob = dependencies.processJob ?? processJobWithMetaEndToEnd;
  const runtimeLoader = dependencies.loadRuntimeConfig ?? loadCustomerRuntimeConfig;
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;

  return async function handleMetaPartialStagingRecovery(context) {
    const { request, env, url } = context;
    if (url.pathname !== META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PATH) return null;

    let runtimeVersionId = null;
    let deploymentAttestation = null;
    try {
      deploymentAttestation = requireSha256(
        env?.[META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_ENV],
        META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_ENV,
      );
      runtimeVersionId = runtimeVersionReader(env, { allowMissing: true });
      if (request.method !== 'POST') {
        return attested(json({ ok: false, error: 'Method not allowed' }, {
          status: 405,
          headers: { allow: 'POST', ...noStoreHeaders() },
        }), deploymentAttestation, runtimeVersionId);
      }
      if (env?.MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY
        !== META_D1_ONLY_PARTIAL_STAGING_RECOVERY_MODE) {
        return attested(json({ ok: false, error: 'Route not found' }, {
          status: 404,
          headers: noStoreHeaders(),
        }), deploymentAttestation, runtimeVersionId);
      }

      await requireEphemeralAuthorization(
        request,
        env?.[META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256_ENV],
      );
      const target = assertExactTarget(env);
      assertExactExecutionFlags(env);

      let continuationSuppressedCount = 0;
      const continuationQueue = Object.freeze({
        async send(body) {
          assertContinuationIdentity(body, target);
          continuationSuppressedCount += 1;
        },
      });
      const directEnv = Object.freeze({
        ...env,
        MKT_SYNC_QUEUE: continuationQueue,
      });
      let runtimeConfig = null;
      let infrastructure = null;
      const body = createStableQueueOperationBody({
        schemaVersion: 1,
        type: JOB_TYPES.META_ADS_SYNC,
        trigger: 'manual_uat',
        dryRun: false,
        d1Only: true,
        periodStart: target.periodStart,
        periodEnd: target.periodEnd,
        sourceAccountKey: target.sourceAccountKey,
      }, {
        operationId: target.operationId,
        originalRequestedAt: target.originalRequestedAt,
      });
      const operation = Object.freeze({
        stable: true,
        operationId: target.operationId,
        workKey: target.workKey,
        generation: target.originalRequestedAt,
        originalRequestedAt: target.originalRequestedAt,
      });
      const result = await processJob({
        job: Object.freeze({ schemaVersion: 1, body }),
        message: Object.freeze({ id: 'direct-meta-partial-staging-recovery', attempts: 1 }),
        operation,
        mainQueueAttempts: target.mainQueueAttempts,
        env: directEnv,
        getRuntimeConfig: () => {
          runtimeConfig ??= runtimeLoader(directEnv);
          return runtimeConfig;
        },
        getInfrastructure: () => {
          infrastructure ??= infrastructureFactory(directEnv);
          return infrastructure;
        },
      });
      const continuationExpected = CONTINUATION_STATUSES.has(result?.status);
      if ((continuationExpected && continuationSuppressedCount !== 1)
        || (!continuationExpected && continuationSuppressedCount !== 0)) {
        throw recoveryError(
          'Meta partial-staging continuation Queue suppression did not match the use-case result',
          'META_PARTIAL_STAGING_CONTINUATION_SUPPRESSION_INVALID',
          {
            continuationExpected,
            continuationSuppressedCount,
            status: result?.status ?? null,
          },
        );
      }

      return attested(json({
        ok: true,
        stage: 'meta-d1-only-partial-staging-continuation',
        target: EXACT_TARGET.targetKey,
        operationId: EXACT_TARGET.operationId,
        workKey: EXACT_TARGET.workKey,
        syncRunId: EXACT_TARGET.syncRunId,
        status: result?.status ?? null,
        continuationPhase: result?.continuationPhase ?? null,
        continuationSuppressed: continuationSuppressedCount === 1,
        directUseCaseInvocationCount: 1,
        queueMessageCount: 0,
        queueOperationAttemptMutationCount: 0,
        larkWriteEnabled: false,
        scheduleEnabled: false,
        production: false,
      }, {
        status: 200,
        headers: noStoreHeaders(),
      }), deploymentAttestation, runtimeVersionId);
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const status = operational.code === 'META_PARTIAL_STAGING_RECOVERY_UNAUTHORIZED'
        ? 401
        : operational.code?.includes('ACTIVE_LOCK')
          ? 409
          : 400;
      console.error(JSON.stringify(sanitizeOperationalValue({
        timestamp: new Date().toISOString(),
        scope: 'meta_partial_staging_recovery_http',
        code: operational.code,
        error: operational.message,
      })));
      return attested(json({
        ok: false,
        stage: 'meta-d1-only-partial-staging-continuation',
        error: status === 401 ? 'Unauthorized' : 'Meta partial-staging continuation failed',
        code: operational.code ?? 'META_PARTIAL_STAGING_CONTINUATION_FAILED',
        directUseCaseInvocationCount: 0,
        queueMessageCount: 0,
        queueOperationAttemptMutationCount: 0,
        larkWriteEnabled: false,
        scheduleEnabled: false,
        production: false,
      }, {
        status,
        headers: noStoreHeaders(),
      }), deploymentAttestation, runtimeVersionId);
    }
  };
}

function assertExactTarget(env) {
  requireExact(env?.MKT_ENV, EXACT_TARGET.environment, 'MKT_ENV');
  requireExact(
    env?.MKT_CUSTOMER_PROFILE,
    EXACT_TARGET.customerProfile,
    'MKT_CUSTOMER_PROFILE',
  );
  requireExact(
    env?.MKT_CONNECTION_CUSTOMER_KEY,
    EXACT_TARGET.customerKey,
    'MKT_CONNECTION_CUSTOMER_KEY',
  );
  requireExact(env?.MKT_META_D1_ONLY_TARGET, EXACT_TARGET.targetKey, 'MKT_META_D1_ONLY_TARGET');
  requireExact(
    env?.MKT_META_D1_ONLY_OPERATION_ID,
    EXACT_TARGET.operationId,
    'MKT_META_D1_ONLY_OPERATION_ID',
  );
  requireExact(
    env?.MKT_META_D1_ONLY_WORK_KEY,
    EXACT_TARGET.workKey,
    'MKT_META_D1_ONLY_WORK_KEY',
  );
  requireExact(
    env?.MKT_META_D1_ONLY_SYNC_RUN_ID,
    EXACT_TARGET.syncRunId,
    'MKT_META_D1_ONLY_SYNC_RUN_ID',
  );
  requireExact(
    env?.MKT_META_D1_ONLY_SOURCE_ACCOUNT_KEY,
    EXACT_TARGET.sourceAccountKey,
    'MKT_META_D1_ONLY_SOURCE_ACCOUNT_KEY',
  );
  requireExact(
    env?.MKT_META_D1_ONLY_PERIOD_START,
    EXACT_TARGET.periodStart,
    'MKT_META_D1_ONLY_PERIOD_START',
  );
  requireExact(
    env?.MKT_META_D1_ONLY_PERIOD_END,
    EXACT_TARGET.periodEnd,
    'MKT_META_D1_ONLY_PERIOD_END',
  );
  return Object.freeze({
    ...EXACT_TARGET,
    originalRequestedAt: requireTimestamp(
      env?.MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT,
      'MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT',
    ),
    mainQueueAttempts: requirePositiveInteger(
      env?.MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS,
      'MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS',
    ),
  });
}

function assertExactExecutionFlags(env) {
  const trueFlags = Object.entries(env ?? {})
    .filter(([name, value]) => EXECUTION_FLAG_PATTERN.test(name) && readBoolean(value, false))
    .map(([name]) => name)
    .sort();
  if (JSON.stringify(trueFlags) !== JSON.stringify(APPROVED_TRUE_FLAGS)) {
    throw recoveryError(
      'Meta partial-staging continuation requires the exact D1-only execution flag window',
      'META_PARTIAL_STAGING_RECOVERY_FLAGS_UNSAFE',
      { trueFlags },
    );
  }
}

function assertContinuationIdentity(body, target) {
  requireExact(body?.operationId, target.operationId, 'continuation.operationId');
  requireExact(body?.workKey, target.workKey, 'continuation.workKey');
  requireExact(body?.generation, target.originalRequestedAt, 'continuation.generation');
  requireExact(
    body?.originalRequestedAt,
    target.originalRequestedAt,
    'continuation.originalRequestedAt',
  );
  requireExact(
    body?.sourceAccountKey,
    target.sourceAccountKey,
    'continuation.sourceAccountKey',
  );
}

async function requireEphemeralAuthorization(request, expectedDigestInput) {
  const expectedDigest = requireSha256(
    expectedDigestInput,
    META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256_ENV,
  );
  const authorization = request.headers.get('authorization') ?? '';
  const match = /^Bearer[ \t]+(.+)$/iu.exec(authorization);
  const supplied = match?.[1]?.trim() ?? '';
  const suppliedDigest = supplied.length >= 32 && supplied.length <= 256
    ? await sha256Text(supplied)
    : null;
  const valid = suppliedDigest !== null
    && await timingSafeEqualText(suppliedDigest, expectedDigest);
  if (!match || !valid) {
    throw recoveryError(
      'Meta partial-staging continuation authorization was rejected',
      'META_PARTIAL_STAGING_RECOVERY_UNAUTHORIZED',
    );
  }
}

async function sha256Text(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw recoveryError(
      'SHA-256 runtime is unavailable for Meta partial-staging authorization',
      'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID',
    );
  }
  const digest = await subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, '0'),
  ).join('');
}

function attested(response, deploymentAttestation, runtimeVersionId) {
  const versioned = addWorkerRuntimeVersionHeader(response, runtimeVersionId);
  const headers = new Headers(versioned.headers);
  if (deploymentAttestation) {
    headers.set(
      META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_HEADER,
      deploymentAttestation,
    );
  }
  return new Response(versioned.body, {
    status: versioned.status,
    statusText: versioned.statusText,
    headers,
  });
}

function noStoreHeaders() {
  return Object.freeze({
    'cache-control': 'no-store',
    'referrer-policy': 'no-referrer',
  });
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw recoveryError(
      `${fieldName} must equal the reviewed exact partial-staging identity`,
      'META_PARTIAL_STAGING_RECOVERY_TARGET_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireTimestamp(value, fieldName) {
  const number = typeof value === 'number' ? value : Date.parse(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw recoveryError(
      `${fieldName} must be a valid timestamp`,
      'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requirePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw recoveryError(
      `${fieldName} must be a positive integer`,
      'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requireSha256(value, fieldName) {
  const text = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!SHA256_PATTERN.test(text)) {
    throw recoveryError(
      `${fieldName} must be a SHA-256 digest`,
      'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID',
      { fieldName },
    );
  }
  return text;
}

function readBoolean(value, fallback) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (normalized === 'true') return true;
  if (normalized === 'false') return false;
  throw recoveryError(
    'Meta execution flag must be true or false',
    'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID',
  );
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPartialStagingRecoveryHttpError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
