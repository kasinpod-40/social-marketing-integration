import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import {
  resolveQueueOperation,
  withQueueOperation,
} from '../../packages/application/src/jobs/queue-operation.js';
import { normalizeQueueJobMessage } from '../../packages/application/src/jobs/queue-job.js';
import { readRetryDelaySeconds } from '../../apps/sync-worker/src/worker-runtime-support.js';

const REQUESTED_AT = 1784829780000;
const OPERATION_ID = 'f59b852f00634005c7ff4da51afee964';
const BODY = Object.freeze({
  schemaVersion: 1,
  type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP,
  trigger: 'manual',
  operationId: OPERATION_ID,
  workKey: `tiktok:${OPERATION_ID}`,
  generation: REQUESTED_AT,
  originalRequestedAt: REQUESTED_AT,
  requestedAt: new Date(REQUESTED_AT).toISOString(),
});

test('bootstrap operation identity is independent from Queue delivery message.id', () => {
  const first = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'main-message', body: BODY }),
    message: { id: 'main-message' },
  });
  const dlq = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'different-dlq-message', body: BODY }),
    message: { id: 'different-dlq-message' },
  });
  assert.deepEqual(dlq, first);
  assert.equal(first.workKey, `tiktok:${OPERATION_ID}`);
  assert.equal(first.generation, REQUESTED_AT);
  assert.equal(first.originalRequestedAt, REQUESTED_AT);
});

test('post-Lark sync operation identity is independent from Queue delivery message.id', () => {
  const body = {
    ...BODY,
    type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
    trigger: 'post_lark_watermark',
  };
  const first = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'probe-admission-message', body }),
    message: { id: 'probe-admission-message' },
  });
  const retry = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'queue-retry-message', body }),
    message: { id: 'queue-retry-message' },
  });
  assert.deepEqual(retry, first);
  assert.equal(first.stable, true);
  assert.equal(first.workKey, `tiktok:${OPERATION_ID}`);
});

test('ordinary TikTok sync keeps the existing message-scoped operation', () => {
  const job = normalizeQueueJobMessage({
    id: 'legacy-tiktok-message',
    body: {
      schemaVersion: 1,
      type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
      trigger: 'manual',
      requestedAt: new Date(REQUESTED_AT).toISOString(),
    },
  });
  const operation = resolveQueueOperation({ job, message: { id: 'legacy-tiktok-message' } });
  assert.equal(operation.stable, false);
  assert.equal(operation.workKey, 'tiktok:legacy-tiktok-message');
});

test('continuation serialization preserves exact operation generation', () => {
  const operation = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'main-message', body: BODY }),
    message: { id: 'main-message' },
  });
  const continuation = withQueueOperation({
    type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP,
    trigger: 'manual',
    continuation: true,
  }, operation);
  assert.equal(continuation.operationId, OPERATION_ID);
  assert.equal(continuation.workKey, `tiktok:${OPERATION_ID}`);
  assert.equal(continuation.generation, REQUESTED_AT);
  assert.equal(continuation.originalRequestedAt, REQUESTED_AT);
  assert.equal(continuation.requestedAt, new Date(REQUESTED_AT).toISOString());
});

test('bootstrap and admitted sync reject workKey or generation drift', () => {
  for (const body of [
    BODY,
    { ...BODY, type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC, trigger: 'post_lark_watermark' },
  ]) {
    assert.throws(
      () => resolveQueueOperation({
        job: normalizeQueueJobMessage({
          id: 'message',
          body: { ...body, workKey: 'tiktok:wrong' },
        }),
        message: { id: 'message' },
      }),
      (error) => error.code === 'QUEUE_OPERATION_IDENTITY_MISMATCH',
    );
    assert.throws(
      () => resolveQueueOperation({
        job: normalizeQueueJobMessage({
          id: 'message',
          body: { ...body, generation: REQUESTED_AT + 1 },
        }),
        message: { id: 'message' },
      }),
      (error) => error.code === 'QUEUE_OPERATION_GENERATION_MISMATCH',
    );
  }
});

test('retry delay waits beyond the remaining stale lock lease', () => {
  const now = 1_000_000;
  const delay = readRetryDelaySeconds(
    { MKT_QUEUE_RETRY_DELAY_SECONDS: '30' },
    { attempts: 1 },
    { code: 'SYNC_LOCK_BUSY', details: { expiresAt: now + 600_000 } },
    now,
  );
  assert.equal(delay, 605);
  assert.equal(readRetryDelaySeconds({}, { attempts: 5 }, null, now), 150);
});
