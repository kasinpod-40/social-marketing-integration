import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableMirrorReliabilityStore } from '../../packages/reliability/src/durable-mirror-reliability-store.js';
import { runReliableSync } from '../../packages/reliability/src/reliable-sync-runner.js';

test('durable reliability store persists primary and outbox before sending a generic delivery job', async () => {
  const calls = [];
  const primary = {
    async saveSyncRun(entry) { calls.push(['primary', entry.syncId]); return 'd1-ok'; },
  };
  const outbox = {
    async schedule(input) { calls.push(['outbox', input.method, input.payload.syncId]); return { scheduled: true }; },
  };
  const sent = [];
  const store = new DurableMirrorReliabilityStore({
    primary,
    outbox,
    queue: { async send(job) { calls.push(['queue', job.type]); sent.push(job); } },
    deliveryJobType: 'system.reliability-mirror.deliver',
    now: () => Date.parse('2026-07-20T00:00:00.000Z'),
  });

  const result = await store.saveSyncRun({ syncId: 'run-1' });

  assert.deepEqual(calls, [
    ['primary', 'run-1'],
    ['outbox', 'saveSyncRun', 'run-1'],
    ['queue', 'system.reliability-mirror.deliver'],
  ]);
  assert.deepEqual(sent[0], {
    schemaVersion: 1,
    type: 'system.reliability-mirror.deliver',
    requestedAt: '2026-07-20T00:00:00.000Z',
  });
  assert.equal(JSON.stringify(sent[0]).includes('run-1'), false);
  assert.equal(result.primarySucceeded, true);
  assert.equal(result.mirrorScheduled, true);
});

test('queue signal failure leaves durable work pending without changing primary success', async () => {
  let primaryCalls = 0;
  let outboxCalls = 0;
  const errors = [];
  const store = new DurableMirrorReliabilityStore({
    primary: { async saveSystemAlert() { primaryCalls += 1; return 'd1-ok'; } },
    outbox: { async schedule() { outboxCalls += 1; } },
    queue: { async send() { throw new Error('queue unavailable'); } },
    deliveryJobType: 'system.reliability-mirror.deliver',
    onScheduleError: (event) => errors.push(event),
  });

  const result = await store.saveSystemAlert({ alertId: 'alert-1' });
  assert.equal(primaryCalls, 1);
  assert.equal(outboxCalls, 1);
  assert.equal(result.primarySucceeded, true);
  assert.equal(result.primaryResult, 'd1-ok');
  assert.equal(result.mirrorScheduled, false);
  assert.equal(errors.length, 1);
  assert.equal(errors[0].code, 'RELIABILITY_MIRROR_QUEUE_SEND_FAILED');
});

test('dead letters remain D1-primary only and do not schedule Lark delivery', async () => {
  let outboxCalls = 0;
  let queueCalls = 0;
  const store = new DurableMirrorReliabilityStore({
    primary: { async saveDeadLetter() { return 'saved'; } },
    outbox: { async schedule() { outboxCalls += 1; } },
    queue: { async send() { queueCalls += 1; } },
    deliveryJobType: 'system.reliability-mirror.deliver',
  });

  const result = await store.saveDeadLetter({ dlqId: 'dlq-1' });

  assert.equal(result.primaryResult, 'saved');
  assert.equal(result.mirrorScheduled, false);
  assert.equal(outboxCalls, 0);
  assert.equal(queueCalls, 0);
});

test('diagnostic callback failure cannot change a persisted primary result', async () => {
  const store = new DurableMirrorReliabilityStore({
    primary: { async saveSyncRun() { return 'd1-ok'; } },
    outbox: { async schedule() {} },
    queue: { async send() { throw new Error('queue unavailable'); } },
    deliveryJobType: 'system.reliability-mirror.deliver',
    onScheduleError() { throw new Error('logger unavailable'); },
  });

  const result = await store.saveSyncRun({ syncId: 'run-logger' });
  assert.equal(result.primarySucceeded, true);
  assert.equal(result.mirrorScheduled, false);
});


test('mirror queue outage cannot relabel a successful reliable sync as failed', async () => {
  const statuses = [];
  const store = new DurableMirrorReliabilityStore({
    primary: {
      async saveSyncRun(entry) { statuses.push(entry.status); },
      async saveSystemAlert() {},
    },
    outbox: { async schedule() {} },
    queue: { async send() { throw new Error('queue unavailable'); } },
    deliveryJobType: 'system.reliability-mirror.deliver',
  });
  const lockManager = {
    async acquire() { return { acquired: true, expiresAt: Date.now() + 60_000 }; },
    async renew() { return { renewed: true, expiresAt: Date.now() + 60_000 }; },
    async release() { return true; },
  };

  const result = await runReliableSync({
    store,
    lockManager,
    customerProfile: 'profile',
    accountKey: 'account',
    platform: 'tiktok',
    source: 'test',
    syncType: 'test',
    leaseMs: 60_000,
    renewIntervalMs: 30_000,
    execute: async () => ({ mode: 'write', content: { created: 1 } }),
  });

  assert.equal(result.mode, 'write');
  assert.deepEqual(statuses, ['running', 'success']);
});
