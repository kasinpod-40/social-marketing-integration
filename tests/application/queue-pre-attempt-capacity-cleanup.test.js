import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanupQueueCapacityBeforeAttempts } from '../../apps/sync-worker/src/queue-batch-router.js';

test('queue capacity cleanup runs with the exact configured protected Work keys', async () => {
  const calls = [];
  const result = await cleanupQueueCapacityBeforeAttempts({
    env: {
      MKT_STATE_DB: createD1Stub(),
      MKT_RESUMABLE_WORK_CLEANUP_PROTECTED_KEYS: 'tiktok:protected-1, chatwoot:protected-2',
    },
    createWorkStore() {
      return {
        async cleanupSupersededWorkUnits(input) {
          calls.push(input);
          return Object.freeze({ candidates: 2, deletedUnits: 50 });
        },
      };
    },
  });

  assert.deepEqual(calls, [{
    limit: 25,
    protectedWorkKeys: ['tiktok:protected-1', 'chatwoot:protected-2'],
  }]);
  assert.deepEqual(result, { candidates: 2, deletedUnits: 50 });
});

test('queue capacity cleanup is a no-op without a D1 binding', async () => {
  const result = await cleanupQueueCapacityBeforeAttempts({ env: {} });
  assert.deepEqual(result, { candidates: 0, deletedUnits: 0, skipped: true });
});

function createD1Stub() {
  return {
    prepare() {},
    async batch() {},
  };
}
