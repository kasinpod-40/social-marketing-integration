import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositeReliabilityStore } from '../../packages/reliability/src/composite-reliability-store.js';

test('composite store succeeds when the primary store works and reports a mirror failure', async () => {
  const errors = [];
  const primary = { async saveSystemAlert() { return true; } };
  const mirrorFailure = new Error('Lark unavailable');
  const mirror = { async saveSystemAlert() { throw mirrorFailure; } };
  const store = new CompositeReliabilityStore({
    stores: [primary, mirror],
    onStoreError: (event) => errors.push(event),
  });

  const result = await store.saveSystemAlert({ alertId: 'a-1' });

  assert.deepEqual(result, { successCount: 1, failureCount: 1 });
  assert.equal(errors.length, 1);
  assert.equal(errors[0].method, 'saveSystemAlert');
  assert.equal(errors[0].error, mirrorFailure);
});

test('composite store fails when every implementation fails', async () => {
  const first = new Error('D1 unavailable');
  const second = new Error('Lark unavailable');
  const store = new CompositeReliabilityStore({
    stores: [
      { async saveSyncRun() { throw first; } },
      { async saveSyncRun() { throw second; } },
    ],
  });

  await assert.rejects(() => store.saveSyncRun({ syncId: 'run-1' }), first);
});

test('composite store rejects a method not implemented by any target', async () => {
  const store = new CompositeReliabilityStore({ stores: [{}] });
  await assert.rejects(
    () => store.saveDeadLetter({ dlqId: 'dlq-1' }),
    /No reliability store implements saveDeadLetter/,
  );
});
