import test from 'node:test';
import assert from 'node:assert/strict';
import { D1ReliabilityStore } from '../../packages/reliability/src/d1-reliability-store.js';

test('D1 lease lock uses atomic upsert result and owner-scoped release', async () => {
  const db = createFakeD1([1, 0, 1]);
  const store = new D1ReliabilityStore({ db, now: () => 1000 });

  const first = await store.acquire({ lockKey: 'profile:tiktok:account:native', ownerId: 'run-1', leaseMs: 5000 });
  const second = await store.acquire({ lockKey: 'profile:tiktok:account:native', ownerId: 'run-2', leaseMs: 5000 });
  const released = await store.release({ lockKey: 'profile:tiktok:account:native', ownerId: 'run-1' });

  assert.equal(first.acquired, true);
  assert.equal(second.acquired, false);
  assert.equal(second.expiresAt, null);
  assert.equal(released, true);
  assert.match(db.calls[0].sql, /ON CONFLICT\(lock_key\)/);
  assert.match(db.calls[2].sql, /owner_id = \?/);
});

test('D1 sync run persistence redacts secret-like keys in details JSON', async () => {
  const db = createFakeD1([1]);
  const store = new D1ReliabilityStore({ db, now: () => 1000 });

  await store.saveSyncRun({
    syncId: 'run-1',
    customerProfile: 'dev_ft_pumkin',
    platform: 'tiktok',
    accountKey: 'ft_pumkin',
    source: 'source',
    syncType: 'native_import',
    status: 'failed',
    startedAt: 1,
    finishedAt: 2,
    recordsPulled: 20,
    recordsCreated: 1,
    recordsUpdated: 2,
    recordsSkipped: 17,
    recordsWritten: 3,
    retryCount: 0,
    errorCode: 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
    errorMessage: 'YouTube channel identity mismatch: expected=channel_A, actual=channel_B',
    details: {
      apiToken: 'should-not-leak',
      missingVideoIds: ['video_A'],
      safe: 'ok',
    },
  });

  assert.equal(db.calls[0].bindings[16], 'Source identity validation failed');
  const detailsJson = db.calls[0].bindings[17];
  assert.match(detailsJson, /\[REDACTED\]/);
  assert.doesNotMatch(detailsJson, /should-not-leak/);
  assert.doesNotMatch(detailsJson, /video_A|channel_A|channel_B/u);
  assert.match(detailsJson, /"safe":"ok"/);
});


test('D1 persists system alerts and dead letters with redacted structured payloads', async () => {
  const db = createFakeD1([1, 1]);
  const store = new D1ReliabilityStore({ db, now: () => 1000 });

  await store.saveSystemAlert({
    alertId: 'alert-1',
    syncRunId: 'run-1',
    alertType: 'sync_failed',
    severity: 'critical',
    platform: 'tiktok',
    status: 'open',
    message: 'YouTube channel identity mismatch: expected=channel_A, actual=channel_B',
    errorCode: 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
    details: { authorization: 'Bearer private', requestedChannelId: 'channel_A', safe: true },
    createdAt: 900,
  });
  await store.saveDeadLetter({
    dlqId: 'dlq-1',
    messageId: 'message-1',
    queueName: 'sync-dlq',
    jobType: 'tiktok.creator.native.sync',
    schemaVersion: 1,
    payload: { consumerSecret: 'private', channelId: 'channel_A', metricDate: '2026-07-11' },
    errorCode: 'YOUTUBE_CHANNEL_IDENTITY_MISMATCH',
    errorMessage: 'YouTube channel identity mismatch: expected=channel_A, actual=channel_B',
    retryCount: 5,
    status: 'open',
  });

  assert.match(db.calls[0].sql, /INSERT INTO system_alerts/);
  assert.equal(db.calls[0].bindings[6], 'Source identity validation failed');
  assert.doesNotMatch(db.calls[0].bindings[8], /Bearer private/);
  assert.doesNotMatch(db.calls[0].bindings[8], /channel_A|channel_B/u);
  assert.match(db.calls[1].sql, /INSERT INTO dead_letter_jobs/);
  assert.doesNotMatch(db.calls[1].bindings[5], /private/);
  assert.doesNotMatch(db.calls[1].bindings[5], /channel_A/u);
  assert.match(db.calls[1].bindings[5], /2026-07-11/);
  assert.equal(db.calls[1].bindings[7], 'Source identity validation failed');
});

test('D1 wraps database failures as retryable operational errors', async () => {
  const db = createFailingD1(new Error('database offline'));
  const store = new D1ReliabilityStore({ db });

  await assert.rejects(
    () => store.saveSystemAlert({
      alertId: 'alert-1', alertType: 'sync_failed', severity: 'critical',
      platform: 'tiktok', status: 'open', message: 'failed',
    }),
    (error) => error.code === 'D1_SYSTEM_ALERT_WRITE_FAILED'
      && error.retryable === true
      && error.details.causeMessage === 'database offline',
  );
});

function createFakeD1(changesQueue) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql: String(sql), bindings: [] };
      calls.push(call);
      return {
        bind(...values) {
          call.bindings = values;
          return this;
        },
        async run() {
          return { meta: { changes: changesQueue.shift() ?? 1 } };
        },
      };
    },
  };
}


function createFailingD1(error) {
  return {
    prepare() {
      return {
        bind() { return this; },
        async run() { throw error; },
      };
    },
  };
}

test('D1 renew extends the lease only for the current owner', async () => {
  const db = createFakeD1([1, 0]);
  const store = new D1ReliabilityStore({ db, now: () => 2_000 });

  const renewed = await store.renew({ lockKey: 'profile:tiktok:account:native', ownerId: 'run-1', leaseMs: 5_000 });
  const lost = await store.renew({ lockKey: 'profile:tiktok:account:native', ownerId: 'run-2', leaseMs: 5_000 });

  assert.deepEqual(renewed, {
    renewed: true,
    lockKey: 'profile:tiktok:account:native',
    ownerId: 'run-1',
    expiresAt: 7_000,
  });
  assert.equal(lost.renewed, false);
  assert.match(db.calls[0].sql, /UPDATE sync_locks/);
  assert.match(db.calls[0].sql, /owner_id = \?/);
});
