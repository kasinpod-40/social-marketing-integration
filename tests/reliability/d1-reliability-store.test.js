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
    payload: {
      consumerSecret: 'private',
      privateKey: 'PRIVATE',
      signingKey: 'SIGNING',
      credential: 'CREDENTIAL',
      accessToken: 'ACCESS',
      channelId: 'channel_A',
      metricDate: '2026-07-11',
    },
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
  assert.match(db.calls[1].sql, /dead_letter_jobs.status IN \('redrive_pending', 'redriven'\)/u);
  const operationalPayload = JSON.parse(db.calls[1].bindings[5]);
  assert.equal(operationalPayload.consumerSecret, '[REDACTED]');
  assert.equal(operationalPayload.privateKey, '[REDACTED]');
  assert.equal(operationalPayload.signingKey, '[REDACTED]');
  assert.equal(operationalPayload.credential, '[REDACTED]');
  assert.equal(operationalPayload.accessToken, '[REDACTED]');
  assert.doesNotMatch(db.calls[1].bindings[5], /channel_A/u);
  assert.match(db.calls[1].bindings[5], /2026-07-11/);
  const replayPayload = JSON.parse(db.calls[1].bindings[6]);
  assert.equal(replayPayload.consumerSecret, '[REDACTED]');
  assert.equal(replayPayload.privateKey, '[REDACTED]');
  assert.equal(replayPayload.signingKey, '[REDACTED]');
  assert.equal(replayPayload.credential, '[REDACTED]');
  assert.equal(replayPayload.accessToken, '[REDACTED]');
  assert.match(db.calls[1].bindings[6], /channel_A/u);
  assert.equal(db.calls[1].bindings[8], 'Source identity validation failed');
});


test('non-object or oversized dead-letter payload remains persistable but is not redrive eligible', async () => {
  const db = createFakeD1([1, 1]);
  const store = new D1ReliabilityStore({ db, now: () => 1_000 });

  await store.saveDeadLetter({
    dlqId: 'dlq-string',
    payload: '{bad json',
    status: 'open',
  });
  await store.saveDeadLetter({
    dlqId: 'dlq-large',
    payload: { type: 'youtube.channel.organic.sync', note: 'x'.repeat(60_000) },
    status: 'open',
  });

  assert.equal(db.calls[0].bindings[6], null);
  assert.equal(db.calls[1].bindings[6], null);
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

test('D1 dead-letter redrive reserves a durable generation and completes idempotently', async () => {
  const row = {
    dlq_id: 'dlq:message-old',
    message_id: 'message-old',
    queue_name: 'sync-main',
    job_type: 'youtube.channel.organic.sync',
    schema_version: 1,
    payload_json: JSON.stringify({ type: 'youtube.channel.organic.sync' }),
    replay_payload_json: JSON.stringify({
      schemaVersion: 1,
      type: 'youtube.channel.organic.sync',
      requestedAt: '2026-07-18T00:00:00.000Z',
    }),
    error_code: 'YOUTUBE_ANALYTICS_ROW_SCOPE_MISMATCH',
    retry_count: 0,
    status: 'redrive_pending',
    redrive_requested_at: Date.parse('2026-07-19T00:00:00.000Z'),
    redrive_reference: 'redrive:dlq:message-old:1784419200000',
    redriven_at: null,
  };
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql: String(sql), bindings: [] };
      calls.push(call);
      return {
        bind(...values) { call.bindings = values; return this; },
        async run() { return { meta: { changes: 1 } }; },
        async first() { return row; },
      };
    },
  };
  const store = new D1ReliabilityStore({
    db,
    now: () => Date.parse('2026-07-19T00:00:00.000Z'),
  });

  const prepared = await store.prepareDeadLetterRedrive({
    dlqId: row.dlq_id,
    requestedAt: row.redrive_requested_at,
    redriveReference: row.redrive_reference,
  });
  await store.markDeadLetterRedriven({
    dlqId: row.dlq_id,
    redrivenAt: Date.parse('2026-07-19T00:00:01.000Z'),
  });

  assert.equal(prepared.status, 'redrive_pending');
  assert.equal(prepared.payload.type, 'youtube.channel.organic.sync');
  assert.equal(prepared.redriveRequestedAt, row.redrive_requested_at);
  assert.match(calls[1].sql, /SET status = 'redrive_pending'/u);
  assert.match(calls[3].sql, /status = 'redriven'/u);
});


test('recursive redrive is rejected before D1 changes the dead-letter status', async () => {
  const row = {
    dlq_id: 'dlq:redrive-command',
    message_id: 'message-redrive-command',
    queue_name: 'sync-main',
    job_type: 'system.dead-letter.redrive',
    schema_version: 1,
    payload_json: JSON.stringify({ type: 'system.dead-letter.redrive' }),
    replay_payload_json: JSON.stringify({
      schemaVersion: 1,
      type: 'system.dead-letter.redrive',
      dlqId: 'dlq:redrive-command',
    }),
    error_code: 'SYNTHETIC',
    retry_count: 0,
    status: 'open',
    redrive_requested_at: null,
    redrive_reference: null,
    redriven_at: null,
  };
  const calls = [];
  const db = {
    prepare(sql) {
      const call = { sql: String(sql), bindings: [] };
      calls.push(call);
      return {
        bind(...values) { call.bindings = values; return this; },
        async first() { return { ...row }; },
        async run() {
          row.status = 'redrive_pending';
          return { meta: { changes: 1 } };
        },
      };
    },
  };
  const store = new D1ReliabilityStore({ db, now: () => 1_000 });

  await assert.rejects(
    store.prepareDeadLetterRedrive({
      dlqId: row.dlq_id,
      requestedAt: 1_000,
      redriveReference: 'redrive:self',
      forbiddenJobTypes: ['system.dead-letter.redrive'],
    }),
    (error) => error?.code === 'DEAD_LETTER_REDRIVE_RECURSION_BLOCKED'
      && error.retryable === false,
  );

  assert.equal(row.status, 'open');
  assert.equal(calls.length, 1);
  assert.match(calls[0].sql, /SELECT[\s\S]*FROM dead_letter_jobs/u);
  assert.ok(calls.every((call) => !/SET status = 'redrive_pending'/u.test(call.sql)));
});
