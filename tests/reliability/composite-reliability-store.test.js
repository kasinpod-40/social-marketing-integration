import test from 'node:test';
import assert from 'node:assert/strict';
import { CompositeReliabilityStore } from '../../packages/reliability/src/composite-reliability-store.js';

test('primary success is required and mirror failure is reported without masking it', async () => {
  const errors = [];
  const primary = { async saveSystemAlert() { return 'd1-ok'; } };
  const mirrorFailure = new Error('Lark unavailable');
  const mirror = { async saveSystemAlert() { throw mirrorFailure; } };
  const store = new CompositeReliabilityStore({
    primary,
    mirrors: [mirror],
    onStoreError: (event) => errors.push(event),
  });

  const result = await store.saveSystemAlert({ alertId: 'a-1' });

  assert.equal(result.primarySucceeded, true);
  assert.equal(result.primaryResult, 'd1-ok');
  assert.equal(result.mirrorSuccessCount, 0);
  assert.equal(result.mirrorFailureCount, 1);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].role, 'mirror');
  assert.equal(errors[0].error, mirrorFailure);
});

test('primary failure is fatal even when a mirror would succeed', async () => {
  const primaryFailure = new Error('D1 unavailable');
  let mirrorCalled = false;
  const store = new CompositeReliabilityStore({
    primary: { async saveSyncRun() { throw primaryFailure; } },
    mirrors: [{ async saveSyncRun() { mirrorCalled = true; } }],
  });

  await assert.rejects(() => store.saveSyncRun({ syncId: 'run-1' }), primaryFailure);
  assert.equal(mirrorCalled, false);
});

test('primary must implement the requested method', async () => {
  const store = new CompositeReliabilityStore({ primary: {}, mirrors: [] });
  await assert.rejects(
    () => store.saveDeadLetter({ dlqId: 'dlq-1' }),
    /Primary reliability store does not implement saveDeadLetter/,
  );
});
