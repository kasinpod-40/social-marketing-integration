import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_ENV,
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_HEADER,
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_MODE,
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PATH,
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PHASE_ENV,
  META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256_ENV,
  createMetaD1OnlyPartialStagingRecoveryHttpHandler,
} from '../../apps/sync-worker/src/meta-d1-only-partial-staging-recovery-http.js';

const VERSION_ID = '22222222-2222-4222-8222-222222222222';
const EPHEMERAL_TOKEN = 'meta-k2-partial-staging-fixture-12345678901234567890';
const TOKEN_SHA256 = createHash('sha256').update(EPHEMERAL_TOKEN).digest('hex');
const DEPLOYMENT_ATTESTATION = 'e'.repeat(64);
const OPERATION_ID = 'meta-chemistry_k2-history-20260701-20260731-f741090d1d8a';
const WORK_KEY = `meta_ads:chemistry_k2:${OPERATION_ID}`;
const SYNC_RUN_ID = `meta:meta_ads:chemistry_k2:${OPERATION_ID}`;
const ORIGINAL_REQUESTED_AT = Date.parse('2026-08-02T09:00:00.000Z');
const BASE_ENV = Object.freeze({
  MKT_ENV: 'development',
  MKT_CUSTOMER_PROFILE: 'integration_workspace',
  MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
  MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: META_D1_ONLY_PARTIAL_STAGING_RECOVERY_MODE,
  [META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PHASE_ENV]: 'd1',
  MKT_META_D1_ONLY_TARGET: 'chemistry_k2',
  MKT_META_D1_ONLY_OPERATION_ID: OPERATION_ID,
  MKT_META_D1_ONLY_WORK_KEY: WORK_KEY,
  MKT_META_D1_ONLY_SYNC_RUN_ID: SYNC_RUN_ID,
  MKT_META_D1_ONLY_SOURCE_ACCOUNT_KEY: 'chemistry_k2',
  MKT_META_D1_ONLY_PERIOD_START: '2026-07-01',
  MKT_META_D1_ONLY_PERIOD_END: '2026-07-31',
  MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: String(ORIGINAL_REQUESTED_AT),
  MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS: '29',
  MKT_CONNECTOR_META_ADS_ENABLED: 'true',
  MKT_META_SOURCE_READ_ENABLED: 'true',
  MKT_META_D1_WRITE_ENABLED: 'true',
  MKT_META_LARK_WRITE_ENABLED: 'false',
  MKT_META_REPORT_READ_ENABLED: 'false',
  [META_D1_ONLY_PARTIAL_STAGING_RECOVERY_TOKEN_SHA256_ENV]: TOKEN_SHA256,
  [META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_ENV]: DEPLOYMENT_ATTESTATION,
});

function request({ method = 'POST', token = EPHEMERAL_TOKEN } = {}) {
  return new Request(`https://worker.example.test${META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PATH}`, {
    method,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
}

function handler(processJob) {
  return createMetaD1OnlyPartialStagingRecoveryHttpHandler({
    processJob,
    readRuntimeVersionId: () => VERSION_ID,
    loadRuntimeConfig: () => ({ fixture: 'runtime' }),
    createInfrastructure: () => ({ fixture: 'infrastructure' }),
  });
}

function assertAttested(response) {
  assert.equal(
    response.headers.get(META_D1_ONLY_PARTIAL_STAGING_RECOVERY_ATTESTATION_HEADER),
    DEPLOYMENT_ATTESTATION,
  );
  assert.equal(response.headers.get('x-mkt-worker-version-id'), VERSION_ID);
}

async function invoke(handle, env = BASE_ENV, requestOptions = {}) {
  const recoveryRequest = request(requestOptions);
  return handle({
    request: recoveryRequest,
    env,
    url: new URL(recoveryRequest.url),
  });
}

test('disabled Meta partial-staging route is attested 404 before use-case invocation', async () => {
  let processCalls = 0;
  const response = await invoke(handler(async () => {
    processCalls += 1;
    return { status: 'source_continuation' };
  }), {
    ...BASE_ENV,
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY: 'false',
  });
  assert.equal(response.status, 404);
  assertAttested(response);
  assert.equal(processCalls, 0);
});

test('Meta partial-staging route accepts POST only', async () => {
  let processCalls = 0;
  const response = await invoke(handler(async () => {
    processCalls += 1;
    return { status: 'source_continuation' };
  }), BASE_ENV, { method: 'GET' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'POST');
  assertAttested(response);
  assert.equal(processCalls, 0);
});

test('Meta partial-staging route rejects wrong bearer before use-case invocation', async () => {
  let processCalls = 0;
  const response = await invoke(handler(async () => {
    processCalls += 1;
    return { status: 'source_continuation' };
  }), BASE_ENV, { token: 'wrong-meta-token-fixture-12345678901234567890' });
  const body = await response.json();
  assert.equal(response.status, 401);
  assertAttested(response);
  assert.equal(body.code, 'META_PARTIAL_STAGING_RECOVERY_UNAUTHORIZED');
  assert.equal(body.queueMessageCount, 0);
  assert.equal(processCalls, 0);
});

test('exact Meta D1 continuation invokes existing use-case and suppresses Queue continuation', async () => {
  let processCalls = 0;
  let observedInput = null;
  const handle = handler(async (input) => {
    processCalls += 1;
    observedInput = input;
    assert.equal(input.mainQueueAttempts, 29);
    assert.equal(input.operation.operationId, OPERATION_ID);
    assert.equal(input.operation.workKey, WORK_KEY);
    assert.equal(input.operation.generation, ORIGINAL_REQUESTED_AT);
    assert.equal(input.job.body.operationId, OPERATION_ID);
    assert.equal(input.job.body.workKey, WORK_KEY);
    assert.equal(input.job.body.sourceAccountKey, 'chemistry_k2');
    assert.equal(input.job.body.d1Only, true);
    await input.env.MKT_SYNC_QUEUE.send({
      ...input.job.body,
      continuation: true,
      continuationStatus: 'source_continuation',
      continuationPhase: 'source',
    });
    return {
      status: 'source_continuation',
      continuationPhase: 'source',
    };
  });

  const response = await invoke(handle);
  const body = await response.json();
  const serialized = JSON.stringify(body);
  assert.equal(response.status, 200);
  assertAttested(response);
  assert.equal(processCalls, 1);
  assert.equal(observedInput.getRuntimeConfig().fixture, 'runtime');
  assert.equal(observedInput.getInfrastructure().fixture, 'infrastructure');
  assert.equal(body.phase, 'd1');
  assert.equal(body.operationId, OPERATION_ID);
  assert.equal(body.workKey, WORK_KEY);
  assert.equal(body.syncRunId, SYNC_RUN_ID);
  assert.equal(body.status, 'source_continuation');
  assert.equal(body.continuationSuppressed, true);
  assert.equal(body.directUseCaseInvocationCount, 1);
  assert.equal(body.queueMessageCount, 0);
  assert.equal(body.queueOperationAttemptMutationCount, 0);
  assert.equal(body.d1WriteEnabled, true);
  assert.equal(body.larkWriteEnabled, false);
  assert.equal(body.scheduleEnabled, false);
  assert.equal(body.production, false);
  assert.equal(serialized.includes(EPHEMERAL_TOKEN), false);
  assert.equal(serialized.includes(TOKEN_SHA256), false);
  assert.equal(serialized.includes(DEPLOYMENT_ATTESTATION), false);
});

test('exact Meta Lark continuation reuses the same operation and suppresses Queue continuation', async () => {
  let processCalls = 0;
  const larkEnv = {
    ...BASE_ENV,
    [META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PHASE_ENV]: 'lark',
    MKT_META_LARK_WRITE_ENABLED: 'true',
  };
  const response = await invoke(handler(async (input) => {
    processCalls += 1;
    assert.equal(input.mainQueueAttempts, 29);
    assert.equal(input.operation.operationId, OPERATION_ID);
    assert.equal(input.job.body.d1Only, false);
    await input.env.MKT_SYNC_QUEUE.send({
      ...input.job.body,
      continuation: true,
      continuationStatus: 'lark_continuation',
      continuationPhase: 'lark',
    });
    return {
      status: 'lark_continuation',
      continuationPhase: 'lark',
    };
  }), larkEnv);
  const body = await response.json();
  assert.equal(response.status, 200);
  assertAttested(response);
  assert.equal(processCalls, 1);
  assert.equal(body.phase, 'lark');
  assert.equal(body.operationId, OPERATION_ID);
  assert.equal(body.continuationSuppressed, true);
  assert.equal(body.queueMessageCount, 0);
  assert.equal(body.queueOperationAttemptMutationCount, 0);
  assert.equal(body.larkWriteEnabled, true);
});

test('terminal D1-only result requires no continuation suppression and still sends no Queue message', async () => {
  let processCalls = 0;
  const response = await invoke(handler(async () => {
    processCalls += 1;
    return { status: 'lark_gate_disabled' };
  }));
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(processCalls, 1);
  assert.equal(body.continuationSuppressed, false);
  assert.equal(body.queueMessageCount, 0);
  assert.equal(body.queueOperationAttemptMutationCount, 0);
});

test('terminal Lark result requires no continuation suppression and still sends no Queue message', async () => {
  const response = await invoke(handler(async (input) => {
    assert.equal(input.job.body.d1Only, false);
    return { status: 'completed' };
  }), {
    ...BASE_ENV,
    [META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PHASE_ENV]: 'lark',
    MKT_META_LARK_WRITE_ENABLED: 'true',
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(body.phase, 'lark');
  assert.equal(body.status, 'completed');
  assert.equal(body.continuationSuppressed, false);
  assert.equal(body.queueMessageCount, 0);
});

test('operation identity drift blocks before use-case invocation', async () => {
  let processCalls = 0;
  const response = await invoke(handler(async () => {
    processCalls += 1;
    return { status: 'source_continuation' };
  }), {
    ...BASE_ENV,
    MKT_META_D1_ONLY_OPERATION_ID: OPERATION_ID.replace('chemistry_k2', 'chemistry-k2'),
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assertAttested(response);
  assert.equal(body.code, 'META_PARTIAL_STAGING_RECOVERY_TARGET_INVALID');
  assert.equal(body.queueMessageCount, 0);
  assert.equal(processCalls, 0);
});

test('missing or invalid continuation phase blocks before use-case invocation', async () => {
  let processCalls = 0;
  for (const phase of [undefined, 'full']) {
    const env = { ...BASE_ENV };
    if (phase === undefined) delete env[META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PHASE_ENV];
    else env[META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PHASE_ENV] = phase;
    const response = await invoke(handler(async () => {
      processCalls += 1;
      return { status: 'source_continuation' };
    }), env);
    const body = await response.json();
    assert.equal(response.status, 400);
    assert.equal(body.code, 'META_PARTIAL_STAGING_RECOVERY_PHASE_INVALID');
  }
  assert.equal(processCalls, 0);
});

test('additional true execution flag blocks before use-case invocation', async () => {
  let processCalls = 0;
  const response = await invoke(handler(async () => {
    processCalls += 1;
    return { status: 'source_continuation' };
  }), {
    ...BASE_ENV,
    MKT_META_LARK_WRITE_ENABLED: 'true',
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assertAttested(response);
  assert.equal(body.code, 'META_PARTIAL_STAGING_RECOVERY_FLAGS_UNSAFE');
  assert.deepEqual(body.queueMessageCount, 0);
  assert.equal(processCalls, 0);
});

test('Lark phase without exact Lark flag blocks before use-case invocation', async () => {
  let processCalls = 0;
  const response = await invoke(handler(async () => {
    processCalls += 1;
    return { status: 'lark_continuation' };
  }), {
    ...BASE_ENV,
    [META_D1_ONLY_PARTIAL_STAGING_RECOVERY_PHASE_ENV]: 'lark',
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, 'META_PARTIAL_STAGING_RECOVERY_FLAGS_UNSAFE');
  assert.equal(processCalls, 0);
});

test('suppressed continuation identity drift fails closed without external Queue send', async () => {
  let processCalls = 0;
  const response = await invoke(handler(async (input) => {
    processCalls += 1;
    await input.env.MKT_SYNC_QUEUE.send({
      ...input.job.body,
      operationId: `${OPERATION_ID}-replacement`,
    });
    return { status: 'source_continuation' };
  }));
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(processCalls, 1);
  assert.equal(body.code, 'META_PARTIAL_STAGING_RECOVERY_TARGET_INVALID');
  assert.equal(body.queueMessageCount, 0);
  assert.equal(body.queueOperationAttemptMutationCount, 0);
});

test('false-like disabled execution flags remain false in the exact D1 window', async () => {
  let processCalls = 0;
  const response = await invoke(handler(async () => {
    processCalls += 1;
    return { status: 'lark_gate_disabled' };
  }), {
    ...BASE_ENV,
    MKT_META_LARK_WRITE_ENABLED: 'disabled',
    MKT_META_REPORT_READ_ENABLED: '0',
    MKT_META_AI_ENABLED: 'off',
  });
  const body = await response.json();
  assert.equal(response.status, 200);
  assert.equal(processCalls, 1);
  assert.equal(body.status, 'lark_gate_disabled');
  assert.equal(body.queueMessageCount, 0);
});

test('unsupported execution flag value reports the exact field without invoking the use-case', async () => {
  let processCalls = 0;
  const response = await invoke(handler(async () => {
    processCalls += 1;
    return { status: 'source_continuation' };
  }), {
    ...BASE_ENV,
    MKT_META_REPORT_READ_ENABLED: 'sometimes',
  });
  const body = await response.json();
  assert.equal(response.status, 400);
  assert.equal(body.code, 'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID');
  assert.equal(body.details.fieldName, 'MKT_META_REPORT_READ_ENABLED');
  assert.equal(processCalls, 0);
});
