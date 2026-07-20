import test from 'node:test';
import assert from 'node:assert/strict';
import { deliverReliabilityMirror } from '../../packages/application/src/use-cases/deliver-reliability-mirror.js';
import { permanentError, transientError } from '../../packages/shared/src/errors/runtime-error.js';

test('reliability mirror drain is bounded and marks successful items delivered', async () => {
  const outbox = createOutbox([
    item('1', 'saveSyncRun', { syncId: 'run-1' }),
    item('2', 'saveSystemAlert', { alertId: 'alert-1' }),
    item('3', 'saveSyncRun', { syncId: 'run-2' }),
  ]);
  const calls = [];
  const result = await deliverReliabilityMirror({
    outbox,
    mirror: {
      async saveSyncRun(payload) { calls.push(['sync', payload.syncId]); },
      async saveSystemAlert(payload) { calls.push(['alert', payload.alertId]); },
    },
    limit: 2,
  });

  assert.deepEqual(calls, [['sync', 'run-1'], ['alert', 'alert-1']]);
  assert.deepEqual(outbox.delivered, ['1', '2']);
  assert.equal(result.status, 'bounded_batch_complete');
  assert.equal(result.pendingRead, 2);
  assert.equal(result.remainingUnknown, true);
});

test('retryable Lark failure leaves the item pending and propagates retry', async () => {
  const outbox = createOutbox([item('1', 'saveSyncRun', { syncId: 'run-1' })]);
  const failure = transientError('Lark unavailable', { code: 'LARK_TRANSIENT_API_ERROR' });

  await assert.rejects(
    () => deliverReliabilityMirror({
      outbox,
      mirror: {
        async saveSyncRun() { throw failure; },
        async saveSystemAlert() {},
      },
    }),
    failure,
  );

  assert.deepEqual(outbox.delivered, []);
  assert.deepEqual(outbox.failed, [{ outboxId: '1', errorCode: 'LARK_TRANSIENT_API_ERROR' }]);
});

test('permanent mirror failure is classified as permanent after recording the attempt', async () => {
  const outbox = createOutbox([item('1', 'saveSystemAlert', { alertId: 'alert-1' })]);

  await assert.rejects(
    () => deliverReliabilityMirror({
      outbox,
      mirror: {
        async saveSyncRun() {},
        async saveSystemAlert() {
          throw permanentError('bad row', { code: 'LARK_FIELD_CONTRACT_INVALID' });
        },
      },
    }),
    (error) => error?.code === 'LARK_FIELD_CONTRACT_INVALID'
      && error.retryable === false,
  );
  assert.equal(outbox.failed.length, 0);
  assert.equal(outbox.permanentFailed.length, 1);
});


test('malformed durable item is quarantined and fails permanently before Lark is called', async () => {
  const outbox = createOutbox([{ outboxId: 'bad-1', revision: 1, invalid: true, validationCode: 'RELIABILITY_MIRROR_OUTBOX_INVALID' }]);
  let mirrorCalls = 0;

  await assert.rejects(
    () => deliverReliabilityMirror({
      outbox,
      mirror: {
        async saveSyncRun() { mirrorCalls += 1; },
        async saveSystemAlert() { mirrorCalls += 1; },
      },
    }),
    (error) => error?.code === 'RELIABILITY_MIRROR_OUTBOX_INVALID'
      && error.retryable === false,
  );

  assert.equal(mirrorCalls, 0);
  assert.deepEqual(outbox.permanentFailed, [{
    outboxId: 'bad-1',
    errorCode: 'RELIABILITY_MIRROR_OUTBOX_INVALID',
  }]);
});

test('duplicate drain replay is idempotent because delivered items are no longer returned', async () => {
  const outbox = createOutbox([item('1', 'saveSyncRun', { syncId: 'run-1' })]);
  let mirrorCalls = 0;
  const mirror = {
    async saveSyncRun() { mirrorCalls += 1; },
    async saveSystemAlert() {},
  };

  await deliverReliabilityMirror({ outbox, mirror });
  await deliverReliabilityMirror({ outbox, mirror });

  assert.equal(mirrorCalls, 1);
});

function item(outboxId, method, payload, revision = 1) {
  return { outboxId, revision, method, payload };
}

function createOutbox(items) {
  const pending = [...items];
  return {
    delivered: [],
    failed: [],
    permanentFailed: [],
    async listPending({ limit }) { return pending.slice(0, limit); },
    async markDelivered({ outboxId, revision }) {
      assert.equal(revision, 1);
      this.delivered.push(outboxId);
      const index = pending.findIndex((item) => item.outboxId === outboxId);
      if (index >= 0) pending.splice(index, 1);
      return { delivered: index >= 0 };
    },
    async markDeliveryFailed({ outboxId, revision, errorCode }) {
      assert.equal(revision, 1);
      this.failed.push({ outboxId, errorCode });
      return { pending: true };
    },
    async markPermanentFailed({ outboxId, revision, errorCode }) {
      assert.equal(revision, 1);
      this.permanentFailed.push({ outboxId, errorCode });
      const index = pending.findIndex((item) => item.outboxId === outboxId);
      if (index >= 0) pending.splice(index, 1);
      return { failedPermanent: index >= 0 };
    },
  };
}


test('stale delivery revision cannot mark a newer pending payload complete', async () => {
  const outbox = createOutbox([item('1', 'saveSyncRun', { syncId: 'run-1', status: 'running' }, 1)]);
  outbox.markDelivered = async ({ revision }) => ({ delivered: revision === 2 });

  const result = await deliverReliabilityMirror({
    outbox,
    mirror: {
      async saveSyncRun() {},
      async saveSystemAlert() {},
    },
  });

  assert.equal(result.delivered, 0);
  assert.equal(result.superseded, 1);
});
