import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import {
  attemptQueueAutoRecovery,
  checkDeferredMetaRetry,
  readDeferredMetaFailureDelaySeconds,
  resolveDeferredMetaRetryPolicy,
  resolveQueueAutoRecoveryPolicy,
} from '../../apps/sync-worker/src/queue-auto-recovery.js';

const GENERATION = Date.parse('2026-08-25T00:40:22.000Z');

test('scheduled Customer Meta retries wait for other channels without sending group notifications', async () => {
  const generation = Date.parse('2026-09-17T00:30:00+07:00');
  const input = baseInput({
    env: { ...customerEnv(), MKT_META_DEFERRED_RETRY_ENABLED: 'true' },
    operation: { ...operation(), generation, originalRequestedAt: generation },
  });
  const error = {
    code: 'META_TRANSIENT_API_ERROR',
    details: { operation: 'meta_ads.performance.daily', graphCode: 2, graphSubcode: 1504044 },
  };
  const policy = resolveDeferredMetaRetryPolicy({ ...input, error });
  assert.equal(policy.eligible, true);
  assert.equal(new Date(policy.notBefore).toISOString(), '2026-09-17T03:00:00.000Z');
  assert.equal(readDeferredMetaFailureDelaySeconds({ ...input, error, now: generation }), 34_200);
  assert.equal(readDeferredMetaFailureDelaySeconds({ ...input, error, now: policy.notBefore }), 3_600);

  const statements = [];
  const retry = {
    ...input,
    message: { attempts: 2 },
    env: {
      ...input.env,
      MKT_STATE_DB: {
        prepare(sql) {
          statements.push(sql);
          return {
            bind(...values) {
              statements.push(values);
              return { async first() { return { active_count: 1 }; } };
            },
          };
        },
      },
    },
  };
  assert.equal((await checkDeferredMetaRetry({ ...retry, now: generation })).reason, 'schedule_pending');
  assert.deepEqual(
    await checkDeferredMetaRetry({ ...retry, now: policy.notBefore }),
    { ...policy, reason: 'other_channel_active', activeCount: 1, delaySeconds: 1_800 },
  );
  assert.match(statements[0], /work_type <> \?/u);
  assert.equal(statements[1][2], JOB_TYPES.META_ADS_SYNC);
  assert.equal(Object.hasOwn(retry.env, 'LARK_NOTIFICATION_DESTINATION_CHAT_NAME'), false);
  const ready = await checkDeferredMetaRetry({
    ...retry,
    now: policy.notBefore,
    env: {
      ...retry.env,
      MKT_STATE_DB: {
        prepare() { return { bind() { return { async first() { return { active_count: 0 }; } }; } }; },
      },
    },
  });
  assert.equal(ready.reason, 'ready');
  assert.equal(ready.delaySeconds, 0);
  const unavailable = await checkDeferredMetaRetry({
    ...retry,
    now: policy.notBefore,
    env: {
      ...retry.env,
      MKT_STATE_DB: { prepare() { throw new Error('D1 unavailable'); } },
    },
  });
  assert.equal(unavailable.reason, 'state_unavailable');
  assert.equal(unavailable.delaySeconds, 1_800);
});

test('deferred Meta retry is exact and fails closed for other errors or runtimes', async () => {
  const input = baseInput({ env: { ...customerEnv(), MKT_META_DEFERRED_RETRY_ENABLED: 'true' } });
  assert.equal(resolveDeferredMetaRetryPolicy({ ...input, error: {
    code: 'META_TRANSIENT_API_ERROR',
    details: { operation: 'meta_ads.performance.daily', graphCode: 2, graphSubcode: 1504045 },
  } }).eligible, false);
  assert.equal(resolveDeferredMetaRetryPolicy({ ...input, job: {
    body: { ...input.job.body, trigger: 'manual_uat' },
  } }).eligible, false);
  assert.equal(resolveDeferredMetaRetryPolicy({ ...input, env: {
    ...input.env,
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
  } }).eligible, false);
  assert.equal((await checkDeferredMetaRetry({
    ...input,
    message: { attempts: 1 },
  })).delaySeconds, 0);
  assert.equal(readDeferredMetaFailureDelaySeconds({
    ...input,
    error: { code: 'META_TRANSIENT_API_ERROR', details: {
      operation: 'meta_ads.performance.daily', graphCode: 2, graphSubcode: 1504045,
    } },
  }), null);
});

test('Queue auto-recovery is fail-closed outside exact Customer Production', () => {
  assert.deepEqual(resolveQueueAutoRecoveryPolicy(baseInput({
    env: { ...customerEnv(), MKT_QUEUE_AUTO_RECOVERY_ENABLED: 'false' },
  })), { eligible: false, reason: 'disabled' });
  assert.deepEqual(resolveQueueAutoRecoveryPolicy(baseInput({
    env: {
      ...customerEnv(),
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
    },
  })), { eligible: false, reason: 'runtime_not_allowed' });
  assert.deepEqual(resolveQueueAutoRecoveryPolicy(baseInput({
    dlqId: 'terminal:eafd8e43f1ae5113d12905301496fd4e',
  })), { eligible: false, reason: 'protected_incident' });
  assert.deepEqual(resolveQueueAutoRecoveryPolicy(baseInput({
    operation: { ...operation(), stable: false },
  })), { eligible: false, reason: 'unstable_identity' });
  assert.deepEqual(resolveQueueAutoRecoveryPolicy(baseInput({
    job: { body: { type: JOB_TYPES.LARK_NOTIFICATION_SEND } },
  })), { eligible: false, reason: 'job_type_not_allowed' });
});

test('Queue auto-recovery requeues the exact stable body only after durable authorization', async () => {
  const sent = [];
  const calls = [];
  const input = baseInput({
    env: {
      ...customerEnv(),
      MKT_SYNC_QUEUE: {
        async send(payload, options) { sent.push({ payload, options }); },
      },
    },
    queueOperationStore: {
      async authorizeSafeAutoRecovery(input) {
        calls.push(['authorize', input]);
        return {
          disposition: 'authorized',
          sendRequired: true,
          delaySeconds: 180,
        };
      },
      async markSafeAutoRecoveryQueued(input) { calls.push(['mark', input]); },
    },
  });
  const result = await attemptQueueAutoRecovery(input);

  assert.equal(result.queued, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].payload, input.job.body);
  assert.deepEqual(sent[0].options, { delaySeconds: 180 });
  assert.equal(calls[0][0], 'authorize');
  assert.equal(calls[1][0], 'mark');
  assert.equal(calls[0][1].workKey, operation().workKey);
  assert.match(calls[0][1].recoveryReference, /^auto-recovery:dlq:/u);
});

test('Queue auto-recovery does not send after durable budget exhaustion', async () => {
  let sends = 0;
  const result = await attemptQueueAutoRecovery(baseInput({
    env: {
      ...customerEnv(),
      MKT_SYNC_QUEUE: { async send() { sends += 1; } },
    },
    queueOperationStore: {
      async authorizeSafeAutoRecovery() {
        return {
          disposition: 'recovery_budget_exhausted',
          sendRequired: false,
          delaySeconds: 0,
        };
      },
      async markSafeAutoRecoveryQueued() { throw new Error('must not mark'); },
    },
  }));
  assert.equal(result.disposition, 'recovery_budget_exhausted');
  assert.equal(sends, 0);
});

test('Queue auto-recovery rejects unsafe numeric configuration', () => {
  assert.throws(
    () => resolveQueueAutoRecoveryPolicy(baseInput({
      env: { ...customerEnv(), MKT_QUEUE_AUTO_RECOVERY_MAX_ATTEMPTS: '11' },
    })),
    (error) => error.code === 'MKT_QUEUE_AUTO_RECOVERY_CONFIG_INVALID',
  );
});

function baseInput(overrides = {}) {
  return {
    env: customerEnv(),
    dlqId: 'dlq:auto-recovery-test',
    job: {
      body: {
        schemaVersion: 1,
        type: JOB_TYPES.META_ADS_SYNC,
        trigger: 'scheduled',
        sourceAccountKey: 'chemistry_k2',
        operationId: 'meta-ads-chemistry_k2-scheduled-20260825',
        workKey: operation().workKey,
        generation: GENERATION,
        originalRequestedAt: GENERATION,
        requestedAt: new Date(GENERATION).toISOString(),
      },
    },
    operation: operation(),
    queueOperationStore: null,
    ...overrides,
  };
}

function operation() {
  return {
    stable: true,
    operationId: 'meta-ads-chemistry-k2-scheduled-20260825',
    workKey: 'meta_ads:chemistry_k2:meta-ads-chemistry-k2-scheduled-20260825',
    generation: GENERATION,
    originalRequestedAt: GENERATION,
  };
}

function customerEnv() {
  return {
    MKT_ENV: 'production',
    MKT_CUSTOMER_PROFILE: 'chemistry_k',
    MKT_QUEUE_AUTO_RECOVERY_ENABLED: 'true',
    MKT_QUEUE_AUTO_RECOVERY_MAX_ATTEMPTS: '5',
    MKT_QUEUE_AUTO_RECOVERY_COOLDOWN_SECONDS: '120',
  };
}
