import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../../packages/application/src/jobs/queue-operation.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import {
  META_K3_EXACT_RECOVERY_ATTESTATION_ENV,
  META_K3_EXACT_RECOVERY_ATTESTATION_HEADER,
  META_K3_EXACT_RECOVERY_IDENTITY,
  META_K3_EXACT_RECOVERY_MODE,
  META_K3_EXACT_RECOVERY_MODE_ENV,
  META_K3_EXACT_RECOVERY_PATH,
  META_K3_EXACT_RECOVERY_PHASE_ENV,
  META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV,
  META_K3_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE,
} from '../../../packages/config/src/meta-k3-exact-recovery-contract.js';
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

const EXACT = META_K3_EXACT_RECOVERY_IDENTITY;
const EXECUTION_FLAG_PATTERN = /^MKT_[A-Z0-9_]+_ENABLED$/u;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;
const CONTINUATION_STATUSES = new Set([
  'source_continuation',
  'd1_continuation',
  'lark_continuation',
]);

export function createMetaK3ExactRecoveryHandler(dependencies = {}) {
  const runtimeVersionReader = dependencies.readRuntimeVersionId
    ?? readWorkerRuntimeVersionId;
  const processJob = dependencies.processJob ?? processJobWithMetaEndToEnd;
  const runtimeLoader = dependencies.loadRuntimeConfig
    ?? loadCustomerRuntimeConfig;
  const infrastructureFactory = dependencies.createInfrastructure
    ?? createInfrastructure;

  return async function handleMetaK3ExactRecovery(request, env) {
    const url = new URL(request.url);
    if (request.method !== 'POST' || url.pathname !== META_K3_EXACT_RECOVERY_PATH) {
      return json({
        ok: false,
        code: 'META_K3_PREVIEW_ROUTE_NOT_FOUND',
        queueMessageCount: 0,
        scheduleEnabled: false,
        production: false,
      }, { status: 404, headers: noStoreHeaders() });
    }

    let runtimeVersionId = null;
    let deploymentAttestation = null;
    let continuationPhase = null;
    try {
      deploymentAttestation = requireSha256(
        env?.[META_K3_EXACT_RECOVERY_ATTESTATION_ENV],
        META_K3_EXACT_RECOVERY_ATTESTATION_ENV,
      );
      runtimeVersionId = runtimeVersionReader(env, { allowMissing: true });

      if (env?.[META_K3_EXACT_RECOVERY_MODE_ENV]
        !== META_K3_EXACT_RECOVERY_MODE) {
        return attested(json({ ok: false, error: 'Route not found' }, {
          status: 404,
          headers: noStoreHeaders(),
        }), deploymentAttestation, runtimeVersionId);
      }

      await requireEphemeralAuthorization(
        request,
        env?.[META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV],
      );
      continuationPhase = requireContinuationPhase(
        env?.[META_K3_EXACT_RECOVERY_PHASE_ENV],
      );
      const target = assertExactTarget(env);
      assertExactExecutionFlags(env, continuationPhase);

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
        d1Only: continuationPhase === 'd1',
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
        message: Object.freeze({
          id: `direct-meta-k3-${continuationPhase}-continuation`,
          attempts: 1,
        }),
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
          'Meta K3 exact continuation Queue suppression did not match the use-case result',
          'META_K3_CONTINUATION_SUPPRESSION_INVALID',
          {
            continuationExpected,
            continuationSuppressedCount,
            phase: continuationPhase,
            status: result?.status ?? null,
          },
        );
      }

      return attested(json({
        ok: true,
        stage: 'meta-exact-operation-continuation',
        phase: continuationPhase,
        target: EXACT.targetKey,
        operationId: EXACT.operationId,
        workKey: EXACT.workKey,
        syncRunId: EXACT.syncRunId,
        status: result?.status ?? null,
        continuationPhase: result?.continuationPhase ?? null,
        continuationSuppressed: continuationSuppressedCount === 1,
        directUseCaseInvocationCount: 1,
        queueMessageCount: 0,
        queueOperationAttemptMutationCount: 0,
        d1WriteEnabled: true,
        larkWriteEnabled: continuationPhase === 'lark',
        scheduleEnabled: false,
        production: false,
      }, {
        status: 200,
        headers: noStoreHeaders(),
      }), deploymentAttestation, runtimeVersionId);
    } catch (error) {
      const operational = sanitizeOperationalError(error);
      const status = operational.code === 'META_K3_RECOVERY_UNAUTHORIZED'
        ? 401
        : operational.code?.includes('ACTIVE_LOCK')
          ? 409
          : 400;
      console.error(JSON.stringify(sanitizeOperationalValue({
        timestamp: new Date().toISOString(),
        scope: 'meta_k3_exact_operation_continuation_http',
        phase: continuationPhase,
        code: operational.code,
        error: operational.message,
        details: operational.details ?? {},
      })));
      return attested(json({
        ok: false,
        stage: 'meta-exact-operation-continuation',
        phase: continuationPhase,
        error: status === 401 ? 'Unauthorized' : 'Meta K3 exact continuation failed',
        code: operational.code ?? 'META_K3_CONTINUATION_FAILED',
        details: sanitizeOperationalValue(operational.details ?? {}),
        directUseCaseInvocationCount: 0,
        queueMessageCount: 0,
        queueOperationAttemptMutationCount: 0,
        larkWriteEnabled: continuationPhase === 'lark',
        scheduleEnabled: false,
        production: false,
      }, {
        status,
        headers: noStoreHeaders(),
      }), deploymentAttestation, runtimeVersionId);
    }
  };
}

const defaultHandler = createMetaK3ExactRecoveryHandler();

export default {
  fetch(request, env) {
    return defaultHandler(request, env);
  },

  async queue(batch) {
    batch.retryAll();
  },

  async scheduled() {
    // Preview-only entrypoint. Scheduled execution is intentionally disabled.
  },
};

function assertExactTarget(env) {
  requireExact(env?.MKT_ENV, EXACT.environment, 'MKT_ENV');
  requireExact(
    env?.MKT_CUSTOMER_PROFILE,
    EXACT.customerProfile,
    'MKT_CUSTOMER_PROFILE',
  );
  requireExact(
    env?.MKT_CONNECTION_CUSTOMER_KEY,
    EXACT.customerKey,
    'MKT_CONNECTION_CUSTOMER_KEY',
  );
  requireExact(env?.MKT_META_D1_ONLY_TARGET, EXACT.targetKey, 'MKT_META_D1_ONLY_TARGET');
  requireExact(
    env?.MKT_META_D1_ONLY_OPERATION_ID,
    EXACT.operationId,
    'MKT_META_D1_ONLY_OPERATION_ID',
  );
  requireExact(
    env?.MKT_META_D1_ONLY_WORK_KEY,
    EXACT.workKey,
    'MKT_META_D1_ONLY_WORK_KEY',
  );
  requireExact(
    env?.MKT_META_D1_ONLY_SYNC_RUN_ID,
    EXACT.syncRunId,
    'MKT_META_D1_ONLY_SYNC_RUN_ID',
  );
  requireExact(
    env?.MKT_META_D1_ONLY_SOURCE_ACCOUNT_KEY,
    EXACT.sourceAccountKey,
    'MKT_META_D1_ONLY_SOURCE_ACCOUNT_KEY',
  );
  requireExact(
    env?.MKT_META_D1_ONLY_PERIOD_START,
    EXACT.periodStart,
    'MKT_META_D1_ONLY_PERIOD_START',
  );
  requireExact(
    env?.MKT_META_D1_ONLY_PERIOD_END,
    EXACT.periodEnd,
    'MKT_META_D1_ONLY_PERIOD_END',
  );
  requireExactInteger(
    env?.MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS,
    EXACT.mainQueueAttempts,
    'MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS',
  );
  return Object.freeze({
    ...EXACT,
    originalRequestedAt: requireTimestamp(
      env?.MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT,
      'MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT',
    ),
  });
}

function assertExactExecutionFlags(env, phase) {
  const expected = META_K3_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE[phase];
  const trueFlags = Object.entries(env ?? {})
    .filter(([name, value]) => (
      EXECUTION_FLAG_PATTERN.test(name) && readBoolean(value, false, name)
    ))
    .map(([name]) => name)
    .sort();
  if (JSON.stringify(trueFlags) !== JSON.stringify(expected)) {
    throw recoveryError(
      'Meta K3 exact continuation requires the approved execution flag window',
      'META_K3_RECOVERY_FLAGS_UNSAFE',
      { phase, trueFlags, expectedTrueFlags: expected },
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
    META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV,
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
      'Meta K3 exact continuation authorization was rejected',
      'META_K3_RECOVERY_UNAUTHORIZED',
    );
  }
}

async function sha256Text(value) {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle || typeof subtle.digest !== 'function') {
    throw recoveryError(
      'SHA-256 runtime is unavailable for Meta K3 exact continuation authorization',
      'META_K3_RECOVERY_CONFIG_INVALID',
      { fieldName: 'globalThis.crypto.subtle' },
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
    headers.set(META_K3_EXACT_RECOVERY_ATTESTATION_HEADER, deploymentAttestation);
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

function requireContinuationPhase(value) {
  const phase = typeof value === 'string' ? value.trim().toLowerCase() : '';
  if (!Object.hasOwn(META_K3_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE, phase)) {
    throw recoveryError(
      `${META_K3_EXACT_RECOVERY_PHASE_ENV} must be d1 or lark`,
      'META_K3_RECOVERY_PHASE_INVALID',
    );
  }
  return phase;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw recoveryError(
      `${fieldName} must equal the reviewed exact K3 identity`,
      'META_K3_RECOVERY_TARGET_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireExactInteger(value, expected, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number !== expected) {
    throw recoveryError(
      `${fieldName} must equal the retained K3 Queue attempt boundary`,
      'META_K3_RECOVERY_TARGET_INVALID',
      { fieldName, expected },
    );
  }
  return number;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw recoveryError(
      `${fieldName} must be a positive integer timestamp`,
      'META_K3_RECOVERY_TARGET_INVALID',
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
      'META_K3_RECOVERY_CONFIG_INVALID',
      { fieldName },
    );
  }
  return text;
}

function readBoolean(value, fallback, fieldName) {
  if (value === undefined || value === null || value === '') return fallback;
  if (value === true || value === false) return value;
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off'].includes(normalized)) return false;
  throw recoveryError(
    `${fieldName} must be boolean-like`,
    'META_K3_RECOVERY_CONFIG_INVALID',
    { fieldName },
  );
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
