import test from 'node:test';
import assert from 'node:assert/strict';
import { D1ResumableWorkStore } from '../../packages/sync-engine/src/queue-terminal-safe-d1-resumable-work-store.js';

test('Queue terminalization cannot reverse a completed durable Work', async () => {
  let nonReadStatementUsed = false;
  const db = {
    prepare(sql) {
      if (!String(sql).includes('SELECT lifecycle_status')) {
        nonReadStatementUsed = true;
        throw new Error('completed Work must stop before abandon UPDATE');
      }
      return {
        bind(workKey) {
          assert.equal(workKey, 'tiktok:completed-work');
          return {
            async first() {
              return { lifecycle_status: 'completed' };
            },
          };
        },
      };
    },
    async batch() {
      throw new Error('completed Work must not use batch');
    },
  };
  const store = new D1ResumableWorkStore({ db });

  const result = await store.abandonWork({
    workKey: 'tiktok:completed-work',
    reason: 'QUEUE_PERMANENT_FAILURE',
    auditReference: 'terminal:message',
  });

  assert.deepEqual(result, {
    terminal: false,
    found: true,
    status: 'completed',
    protectedCompletedWork: true,
  });
  assert.equal(nonReadStatementUsed, false);
});
