import test from 'node:test';
import assert from 'node:assert/strict';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
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

test('controlled Production TikTok UAT keeps stable identity across continuation deliveries', () => {
  const body = {
    ...BODY,
    type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
    trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
  };
  const first = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'uat-first', body }),
    message: { id: 'uat-first' },
  });
  const continuation = resolveQueueOperation({
    job: normalizeQueueJobMessage({
      id: 'uat-continuation',
      body: { ...body, continuation: true, continuationSequence: 7 },
    }),
    message: { id: 'uat-continuation' },
  });
  assert.deepEqual(continuation, first);
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

test('operator YouTube dry-run keeps stable identity across different delivery IDs', () => {
  const body = {
    schemaVersion: 1,
    type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
    trigger: JOB_TRIGGERS.YOUTUBE_WORKER_DRY_RUN,
    dryRun: true,
    analyticsEnabled: false,
    operationId: 'youtube-dry-run-01',
    workKey: 'youtube:youtube-dry-run-01',
    generation: REQUESTED_AT,
    originalRequestedAt: REQUESTED_AT,
    requestedAt: new Date(REQUESTED_AT).toISOString(),
  };
  const resolve = (id) => resolveQueueOperation({
    job: normalizeQueueJobMessage({ id, body }),
    message: { id },
  });
  const first = resolve('youtube-delivery-a');
  const retry = resolve('youtube-delivery-b');
  assert.deepEqual(retry, first);
  assert.equal(first.stable, true);
  assert.equal(first.workKey, 'youtube:youtube-dry-run-01');
});

test('ordinary YouTube jobs retain the legacy delivery-scoped identity', () => {
  const job = normalizeQueueJobMessage({
    id: 'legacy-youtube-message',
    body: {
      schemaVersion: 1,
      type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
      trigger: 'schedule',
      dryRun: true,
      requestedAt: new Date(REQUESTED_AT).toISOString(),
    },
  });
  const operation = resolveQueueOperation({ job, message: { id: 'legacy-youtube-message' } });
  assert.equal(operation.stable, false);
  assert.equal(operation.workKey, 'youtube:legacy-youtube-message');
});

test('controlled Production YouTube UAT keeps stable identity across recovery deliveries', () => {
  const body = {
    schemaVersion: 1,
    type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
    trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
    dryRun: false,
    analyticsEnabled: true,
    operationId: OPERATION_ID,
    workKey: `youtube:${OPERATION_ID}`,
    generation: REQUESTED_AT,
    originalRequestedAt: REQUESTED_AT,
    requestedAt: new Date(REQUESTED_AT).toISOString(),
  };
  const resolve = (id) => resolveQueueOperation({
    job: normalizeQueueJobMessage({ id, body }),
    message: { id },
  });

  const first = resolve('youtube-production-uat-a');
  const recovery = resolve('youtube-production-uat-recovery-b');
  assert.deepEqual(recovery, first);
  assert.equal(first.stable, true);
  assert.equal(first.workKey, `youtube:${OPERATION_ID}`);
});


test('Meta Ads operation identity is scoped by configured account alias', () => {
  const create = (sourceAccountKey) => resolveQueueOperation({
    job: normalizeQueueJobMessage({
      id: `meta-${sourceAccountKey}`,
      body: {
        schemaVersion: 1,
        type: JOB_TYPES.META_ADS_SYNC,
        trigger: 'manual_uat',
        sourceAccountKey,
        operationId: OPERATION_ID,
        generation: REQUESTED_AT,
        originalRequestedAt: REQUESTED_AT,
      },
    }),
    message: { id: `meta-${sourceAccountKey}` },
  });

  const account2 = create('chemistry_k2');
  const account3 = create('chemistry_k3');
  assert.equal(account2.workKey, `meta_ads:chemistry_k2:${OPERATION_ID}`);
  assert.equal(account3.workKey, `meta_ads:chemistry_k3:${OPERATION_ID}`);
  assert.notEqual(account2.workKey, account3.workKey);
  const continuation = withQueueOperation({
    type: JOB_TYPES.META_ADS_SYNC,
    trigger: 'manual_uat',
    sourceAccountKey: 'chemistry_k2',
  }, account2);
  assert.equal(continuation.workKey, account2.workKey);
});

test('Customer Meta K2 Lark import keeps a stable batch operation identity', () => {
  const body = {
    schemaVersion: 1,
    type: JOB_TYPES.CUSTOMER_META_K2_LARK_SNAPSHOT_IMPORT,
    trigger: JOB_TRIGGERS.CUSTOMER_META_K2_SNAPSHOT_IMPORT,
    operationId: 'meta-k2-creatives-b00',
    workKey: 'lark_meta_k2:meta-k2-creatives-b00',
    generation: REQUESTED_AT,
    originalRequestedAt: REQUESTED_AT,
  };
  const operation = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'delivery-a', body }),
    message: { id: 'delivery-a' },
  });
  assert.equal(operation.stable, true);
  assert.equal(operation.workKey, 'lark_meta_k2:meta-k2-creatives-b00');
});

test('scheduled Shared Report uses stable identity while manual presets keep their existing shape', () => {
  const scheduledBody = {
    schemaVersion: 1,
    type: JOB_TYPES.REPORT_MATERIALIZATION_GENERATE,
    trigger: JOB_TRIGGERS.DASHBOARD_SCHEDULED,
    operationId: 'report-daily-facebook-1d-20260808',
    workKey: 'report:report-daily-facebook-1d-20260808',
    generation: REQUESTED_AT,
    originalRequestedAt: REQUESTED_AT,
    requestedAt: new Date(REQUESTED_AT).toISOString(),
  };
  const scheduled = resolveQueueOperation({
    job: normalizeQueueJobMessage({ id: 'report-delivery-a', body: scheduledBody }),
    message: { id: 'report-delivery-a' },
  });
  assert.equal(scheduled.stable, true);
  assert.equal(scheduled.workKey, 'report:report-daily-facebook-1d-20260808');

  const manual = resolveQueueOperation({
    job: normalizeQueueJobMessage({
      id: 'manual-report',
      body: {
        schemaVersion: 1,
        type: JOB_TYPES.REPORT_MATERIALIZATION_GENERATE,
        trigger: JOB_TRIGGERS.DASHBOARD_PRESET,
        requestedAt: new Date(REQUESTED_AT).toISOString(),
      },
    }),
    message: { id: 'manual-report' },
  });
  assert.equal(manual.stable, false);
  assert.equal(manual.workKey, 'tiktok:manual-report');
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

test('bootstrap, admitted sync and YouTube operator reject workKey or generation drift', () => {
  for (const body of [
    BODY,
    { ...BODY, type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC, trigger: 'post_lark_watermark' },
    {
      ...BODY,
      type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
      trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
    },
    {
      ...BODY,
      type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
      trigger: JOB_TRIGGERS.YOUTUBE_WORKER_DRY_RUN,
      dryRun: true,
      workKey: `youtube:${OPERATION_ID}`,
    },
    {
      ...BODY,
      type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
      trigger: JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT,
      dryRun: false,
      workKey: `youtube:${OPERATION_ID}`,
    },
  ]) {
    assert.throws(
      () => resolveQueueOperation({
        job: normalizeQueueJobMessage({
          id: 'message',
          body: { ...body, workKey: 'wrong:work-key' },
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
