import assert from 'node:assert/strict';
import test from 'node:test';
import { JOB_TRIGGERS, JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import {
  createStableQueueOperationBody,
  resolveQueueOperation,
} from '../../packages/application/src/jobs/queue-operation.js';
import { normalizeQueueJobMessage } from '../../packages/application/src/jobs/queue-job.js';

const requestedAt = Date.UTC(2026, 7, 4, 6, 30, 0);

test('notification operation identity is stable across Queue delivery IDs', () => {
  const body = createStableQueueOperationBody({
    schemaVersion: 1,
    type: JOB_TYPES.LARK_NOTIFICATION_SEND,
    trigger: JOB_TRIGGERS.LARK_NOTIFICATION_CONTROLLED_UAT,
    aiRunKey: 'integration_workspace:executive:7d:2026-08-03',
  }, {
    operationId: 'lark-notification-uat-01',
    originalRequestedAt: requestedAt,
  });
  const resolve = (id) => resolveQueueOperation({
    job: normalizeQueueJobMessage({ id, body }),
    message: { id },
  });
  const first = resolve('delivery-a');
  const replay = resolve('delivery-b');
  assert.deepEqual(replay, first);
  assert.equal(first.stable, true);
  assert.equal(first.workKey, 'lark_notification:lark-notification-uat-01');
  assert.equal(first.originalRequestedAt, requestedAt);
});

test('notification operation rejects unsafe identity and generation drift', () => {
  assert.throws(
    () => createStableQueueOperationBody({
      type: JOB_TYPES.LARK_NOTIFICATION_SEND,
      trigger: JOB_TRIGGERS.LARK_NOTIFICATION_CONTROLLED_UAT,
      aiRunKey: 'run:1',
    }, {
      operationId: 'unsafe:colon',
      originalRequestedAt: requestedAt,
    }),
    (error) => error.code === 'QUEUE_OPERATION_IDENTITY_INVALID',
  );

  const body = {
    schemaVersion: 1,
    type: JOB_TYPES.LARK_NOTIFICATION_SEND,
    trigger: JOB_TRIGGERS.LARK_NOTIFICATION_CONTROLLED_UAT,
    aiRunKey: 'run:1',
    operationId: 'lark-notification-uat-01',
    workKey: 'lark_notification:lark-notification-uat-01',
    originalRequestedAt: requestedAt,
    generation: requestedAt + 1,
  };
  assert.throws(
    () => resolveQueueOperation({
      job: normalizeQueueJobMessage({ id: 'delivery', body }),
      message: { id: 'delivery' },
    }),
    (error) => error.code === 'QUEUE_OPERATION_GENERATION_MISMATCH',
  );
});
