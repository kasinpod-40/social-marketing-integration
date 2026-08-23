import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { resolveQueueOperation } from '../../packages/application/src/jobs/queue-operation.js';
import { normalizeQueueJobMessage } from '../../packages/application/src/jobs/queue-job.js';
import {
  enqueueTikTokSyncContinuation,
  resolveTikTokSyncInvocation,
} from '../../apps/sync-worker/src/tiktok-sync-continuation.js';

const REQUESTED_AT = 1784829780000;
const OPERATION_ID = 'tiktok-prod-free-20260823';
const BODY = Object.freeze({
  schemaVersion: 1,
  type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
  trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
  operationId: OPERATION_ID,
  workKey: `tiktok:${OPERATION_ID}`,
  generation: REQUESTED_AT,
  originalRequestedAt: REQUESTED_AT,
  requestedAt: new Date(REQUESTED_AT).toISOString(),
  metricDate: '2026-08-23',
});

test('TikTok Production UAT invocation uses exact stable identity and configured unit budgets', () => {
  const job = normalizeQueueJobMessage({ id: 'delivery-a', body: BODY });
  const operation = resolveQueueOperation({ job, message: { id: 'delivery-a' } });
  const invocation = resolveTikTokSyncInvocation({
    job,
    message: { id: 'delivery-a' },
    operation,
    env: {
      MKT_TIKTOK_SOURCE_PAGES_PER_INVOCATION: '1',
      MKT_TIKTOK_BUSINESS_UNITS_PER_INVOCATION: '2',
    },
  });

  assert.equal(invocation.operation, operation);
  assert.equal(invocation.workKey, BODY.workKey);
  assert.equal(invocation.generation, REQUESTED_AT);
  assert.equal(invocation.requestedAt, REQUESTED_AT);
  assert.equal(invocation.maxSourcePagesPerInvocation, 1);
  assert.equal(invocation.maxBusinessUnitsPerInvocation, 2);
});

test('TikTok continuation Queue message preserves operation, trigger, date and durable sequence', async () => {
  const sent = [];
  const job = normalizeQueueJobMessage({ id: 'delivery-a', body: BODY });
  const operation = resolveQueueOperation({ job, message: { id: 'delivery-a' } });
  await enqueueTikTokSyncContinuation({
    env: { MKT_SYNC_QUEUE: { async send(body) { sent.push(body); } } },
    originalBody: BODY,
    operation,
    result: {
      continuationRequired: true,
      continuationSequence: 4,
      continuationPhase: 'business_preflight',
      continuationNextSequence: 3,
    },
  });

  assert.equal(sent.length, 1);
  assert.equal(sent[0].operationId, OPERATION_ID);
  assert.equal(sent[0].workKey, BODY.workKey);
  assert.equal(sent[0].generation, REQUESTED_AT);
  assert.equal(sent[0].originalRequestedAt, REQUESTED_AT);
  assert.equal(sent[0].trigger, JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT);
  assert.equal(sent[0].metricDate, BODY.metricDate);
  assert.equal(sent[0].continuationSequence, 4);
  assert.equal(sent[0].continuationPhase, 'business_preflight');
  assert.equal(sent[0].continuationNextSequence, 3);
});

test('TikTok continuation Queue send failure remains retryable and keeps pending durable state recoverable', async () => {
  const job = normalizeQueueJobMessage({ id: 'delivery-a', body: BODY });
  const operation = resolveQueueOperation({ job, message: { id: 'delivery-a' } });
  await assert.rejects(
    () => enqueueTikTokSyncContinuation({
      env: { MKT_SYNC_QUEUE: { async send() { throw new Error('temporary queue outage'); } } },
      originalBody: BODY,
      operation,
      result: {
        continuationRequired: true,
        continuationSequence: 1,
        continuationPhase: 'source_staging',
        continuationNextSequence: 1,
      },
    }),
    (error) => error?.code === 'TIKTOK_CONTINUATION_QUEUE_SEND_FAILED'
      && error.retryable === true,
  );
});
