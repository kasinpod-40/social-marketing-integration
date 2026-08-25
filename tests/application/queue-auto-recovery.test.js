import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import {
  attemptQueueAutoRecovery,
  resolveQueueAutoRecoveryPolicy,
} from '../../apps/sync-worker/src/queue-auto-recovery.js';

const GENERATION = Date.parse('2026-08-25T00:40:22.000Z');

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
