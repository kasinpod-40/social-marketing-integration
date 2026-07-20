import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReliabilityMirrorOutboxId,
  D1ReliabilityMirrorOutbox,
} from '../../packages/reliability/src/d1-reliability-mirror-outbox.js';

test('D1 mirror outbox uses deterministic identity and reopens updates as pending', async () => {
  const db = createFakeD1();
  const outbox = new D1ReliabilityMirrorOutbox({ db, now: () => 1_000 });
  const payload = { syncId: 'run-1', platform: 'tiktok' };

  await outbox.schedule({ method: 'saveSyncRun', payload });
  await outbox.schedule({ method: 'saveSyncRun', payload: { ...payload, status: 'success' } });

  assert.equal(buildReliabilityMirrorOutboxId('saveSyncRun', payload), 'reliability-mirror:sync-run:run-1');
  assert.equal(db.calls.length, 2);
  assert.equal(db.calls[0].bindings[0], db.calls[1].bindings[0]);
  assert.match(db.calls[0].sql, /ON CONFLICT\(outbox_id\)/u);
  assert.match(db.calls[0].sql, /status = 'pending'/u);
  assert.match(db.calls[0].sql, /delivered_at = NULL/u);
});

test('D1 mirror outbox reads bounded pending rows and validates payload identity', async () => {
  const row = {
    outbox_id: 'reliability-mirror:system-alert:alert-1',
    mirror_method: 'saveSystemAlert',
    payload_json: JSON.stringify({ alertId: 'alert-1', platform: 'system' }),
    revision: 3,
    delivery_attempts: 2,
    created_at: 100,
    updated_at: 200,
  };
  const db = createFakeD1({ rows: [row] });
  const outbox = new D1ReliabilityMirrorOutbox({ db });

  const pending = await outbox.listPending({ limit: 10 });

  assert.equal(db.calls[0].bindings[0], 10);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].revision, 3);
  assert.equal(pending[0].method, 'saveSystemAlert');
  assert.equal(pending[0].payload.alertId, 'alert-1');
  assert.equal(pending[0].deliveryAttempts, 2);
});

test('D1 mirror outbox returns malformed stored payload as an invalid item for quarantine', async () => {
  const db = createFakeD1({ rows: [{
    outbox_id: 'reliability-mirror:system-alert:alert-1',
    mirror_method: 'saveSystemAlert',
    payload_json: '{bad json',
    revision: 1,
    delivery_attempts: 0,
    created_at: 100,
    updated_at: 100,
  }] });
  const outbox = new D1ReliabilityMirrorOutbox({ db });

  const pending = await outbox.listPending({ limit: 10 });

  assert.equal(pending.length, 1);
  assert.equal(pending[0].invalid, true);
  assert.equal(pending[0].validationCode, 'RELIABILITY_MIRROR_OUTBOX_INVALID');
  assert.equal('payload' in pending[0], false);
});

test('D1 mirror outbox marks success and retryable failure without exposing payload', async () => {
  const db = createFakeD1();
  const outbox = new D1ReliabilityMirrorOutbox({ db, now: () => 5_000 });

  await outbox.markDeliveryFailed({
    outboxId: 'reliability-mirror:sync-run:run-1',
    revision: 2,
    errorCode: 'LARK_TRANSIENT_API_ERROR',
    errorMessage: 'expected=account_A actual=account_B',
  });
  await outbox.markPermanentFailed({
    outboxId: 'reliability-mirror:system-alert:alert-bad',
    revision: 1,
    errorCode: 'RELIABILITY_MIRROR_OUTBOX_INVALID',
    errorMessage: 'bad payload',
  });
  await outbox.markDelivered({ outboxId: 'reliability-mirror:sync-run:run-1', revision: 2 });

  assert.match(db.calls[0].sql, /delivery_attempts = delivery_attempts \+ 1/u);
  assert.match(db.calls[0].sql, /AND revision = \?/u);
  assert.doesNotMatch(String(db.calls[0].bindings[1]), /account_A|account_B/u);
  assert.match(db.calls[1].sql, /status = 'failed_permanent'/u);
  assert.match(db.calls[2].sql, /status = 'delivered'/u);
});

function createFakeD1(input = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const call = { sql: String(sql), bindings: [] };
      calls.push(call);
      return {
        bind(...values) { call.bindings = values; return this; },
        async run() { return { meta: { changes: 1 } }; },
        async all() { return { results: input.rows ?? [] }; },
      };
    },
  };
}
