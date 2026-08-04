import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  META_K3_EXACT_RECOVERY_ATTESTATION_ENV,
  META_K3_EXACT_RECOVERY_ATTESTATION_HEADER,
  META_K3_EXACT_RECOVERY_IDENTITY,
  META_K3_EXACT_RECOVERY_MODE,
  META_K3_EXACT_RECOVERY_MODE_ENV,
  META_K3_EXACT_RECOVERY_PATH,
  META_K3_EXACT_RECOVERY_PHASE_ENV,
  META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV,
} from '../../packages/config/src/meta-k3-exact-recovery-contract.js';
import {
  createMetaK3ExactRecoveryHandler,
} from '../../apps/sync-worker/src/meta-k3-exact-recovery-preview-entry.js';

const EXACT = META_K3_EXACT_RECOVERY_IDENTITY;
const ORIGINAL_REQUESTED_AT = 1785815000000;
const TOKEN = 'k3-exact-recovery-token-000000000000000000000000';
const TOKEN_SHA256 = createHash('sha256').update(TOKEN).digest('hex');
const ATTESTATION = 'a'.repeat(64);
const VERSION_ID = '12345678-1234-4234-9234-123456789abc';

function exactEnv(overrides = {}) {
  return {
    MKT_ENV: EXACT.environment,
    MKT_CUSTOMER_PROFILE: EXACT.customerProfile,
    MKT_CONNECTION_CUSTOMER_KEY: EXACT.customerKey,
    MKT_META_D1_ONLY_TARGET: EXACT.targetKey,
    MKT_META_D1_ONLY_OPERATION_ID: EXACT.operationId,
    MKT_META_D1_ONLY_WORK_KEY: EXACT.workKey,
    MKT_META_D1_ONLY_SYNC_RUN_ID: EXACT.syncRunId,
    MKT_META_D1_ONLY_SOURCE_ACCOUNT_KEY: EXACT.sourceAccountKey,
    MKT_META_D1_ONLY_PERIOD_START: EXACT.periodStart,
    MKT_META_D1_ONLY_PERIOD_END: EXACT.periodEnd,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: String(ORIGINAL_REQUESTED_AT),
    MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS: String(EXACT.mainQueueAttempts),
    [META_K3_EXACT_RECOVERY_MODE_ENV]: META_K3_EXACT_RECOVERY_MODE,
    [META_K3_EXACT_RECOVERY_PHASE_ENV]: 'd1',
    [META_K3_EXACT_RECOVERY_TOKEN_SHA256_ENV]: TOKEN_SHA256,
    [META_K3_EXACT_RECOVERY_ATTESTATION_ENV]: ATTESTATION,
    MKT_CONNECTOR_META_ADS_ENABLED: 'true',
    MKT_META_D1_WRITE_ENABLED: 'true',
    MKT_META_SOURCE_READ_ENABLED: 'true',
    MKT_META_LARK_WRITE_ENABLED: 'false',
    ...overrides,
  };
}

function exactRequest(method = 'POST') {
  return new Request(`https://preview.example${META_K3_EXACT_RECOVERY_PATH}`, {
    method,
    headers: {
      authorization: `Bearer ${TOKEN}`,
    },
    body: method === 'POST' ? '{}' : undefined,
  });
}

test('exact K3 contract pins the retained partial-staging boundary', () => {
  assert.equal(EXACT.targetKey, 'chemistry_k3');
  assert.equal(
    EXACT.operationId,
    'meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9',
  );
  assert.equal(EXACT.sourceStage, 'daily');
  assert.equal(EXACT.sourceUnitCount, 13);
  assert.equal(EXACT.sourceRowCount, 1201);
  assert.equal(EXACT.sourcePageNumber, 13);
  assert.equal(EXACT.queueOperationAttempts, 1);
  assert.equal(EXACT.mainQueueAttempts, 14);
});

test('exact K3 Preview handler continues without Cloudflare Queue delivery', async () => {
  let processJobCalls = 0;
  const handler = createMetaK3ExactRecoveryHandler({
    readRuntimeVersionId: () => VERSION_ID,
    processJob: async ({ env, operation }) => {
      processJobCalls += 1;
      await env.MKT_SYNC_QUEUE.send({
        operationId: operation.operationId,
        workKey: operation.workKey,
        generation: operation.generation,
        originalRequestedAt: operation.originalRequestedAt,
        sourceAccountKey: EXACT.sourceAccountKey,
      });
      return {
        status: 'source_continuation',
        continuationPhase: 'meta_end_to_end_source_staging_v1',
      };
    },
  });

  const response = await handler(exactRequest(), exactEnv());
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(
    response.headers.get(META_K3_EXACT_RECOVERY_ATTESTATION_HEADER),
    ATTESTATION,
  );
  assert.equal(response.headers.get('x-mkt-worker-version-id'), VERSION_ID);
  assert.equal(body.ok, true);
  assert.equal(body.target, EXACT.targetKey);
  assert.equal(body.operationId, EXACT.operationId);
  assert.equal(body.workKey, EXACT.workKey);
  assert.equal(body.syncRunId, EXACT.syncRunId);
  assert.equal(body.continuationSuppressed, true);
  assert.equal(body.directUseCaseInvocationCount, 1);
  assert.equal(body.queueMessageCount, 0);
  assert.equal(body.queueOperationAttemptMutationCount, 0);
  assert.equal(processJobCalls, 1);
});

test('exact K3 handler exposes an attested HEAD route without invoking Business work', async () => {
  let processJobCalls = 0;
  const handler = createMetaK3ExactRecoveryHandler({
    readRuntimeVersionId: () => VERSION_ID,
    processJob: async () => {
      processJobCalls += 1;
      return { status: 'source_continuation' };
    },
  });
  const response = await handler(exactRequest('HEAD'), exactEnv());
  assert.equal(response.status, 204);
  assert.equal(
    response.headers.get(META_K3_EXACT_RECOVERY_ATTESTATION_HEADER),
    ATTESTATION,
  );
  assert.equal(response.headers.get('x-mkt-worker-version-id'), VERSION_ID);
  assert.equal(processJobCalls, 0);
});

test('exact K3 Preview handler fails closed on Queue-attempt drift', async () => {
  let processJobCalls = 0;
  const handler = createMetaK3ExactRecoveryHandler({
    readRuntimeVersionId: () => VERSION_ID,
    processJob: async () => {
      processJobCalls += 1;
      return { status: 'source_continuation' };
    },
  });
  const response = await handler(exactRequest(), exactEnv({
    MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS: '15',
  }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.ok, false);
  assert.equal(body.code, 'META_K3_RECOVERY_TARGET_INVALID');
  assert.equal(body.queueMessageCount, 0);
  assert.equal(processJobCalls, 0);
});
