import test from 'node:test';
import assert from 'node:assert/strict';
import { D1GoogleAdsDeliveryStore } from '../../packages/connectors/src/google-ads/d1-google-ads-delivery-store.js';

function createDb(options = {}) {
  const statements = [];
  const rows = [...(options.rows ?? [])];
  const changes = [...(options.changes ?? [])];
  return {
    statements,
    prepare(sql) {
      const statement = {
        sql: String(sql), bindings: [],
        bind(...values) { this.bindings = values; return this; },
        async run() {
          if (options.runError) throw options.runError;
          if (typeof options.onRun === 'function') return options.onRun(this);
          return { meta: { changes: changes.length ? changes.shift() : 1 } };
        },
        async first() {
          if (typeof options.onFirst === 'function') return options.onFirst(this);
          return rows.shift() ?? null;
        },
      };
      statements.push(statement);
      return statement;
    },
  };
}

const PAYLOAD_EXPIRY = 604_801_000;

test('nonce reservation rejects a replay when INSERT OR IGNORE changes zero rows', async () => {
  const store = new D1GoogleAdsDeliveryStore({ db: createDb({ changes: [0] }), now: () => 1000 });
  await assert.rejects(
    store.reserveNonce({ nonce: 'abcdefghijklmnopqrstuv', keyId: 'key-1', contentSha256: 'a'.repeat(64), receivedAt: 1000, expiresAt: 2000 }),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_REPLAY_REJECTED' && error.retryable === false,
  );
});

test('delivery reservation reports an idempotent duplicate for the same digest', async () => {
  const db = createDb({
    changes: [0],
    rows: [{
      idempotency_key: 'google-ads:id', delivery_id: 'id', content_sha256: 'a'.repeat(64),
      mode: 'LIVE', status: 'queued', payload_json: '{}', payload_expires_at: PAYLOAD_EXPIRY,
      queue_attempts: 1, queued_at: 10, processing_at: null, completed_at: null,
      reconciliation_json: null, last_error_code: null, created_at: 1, updated_at: 10,
    }],
  });
  const result = await new D1GoogleAdsDeliveryStore({ db, now: () => 20 }).reserveDelivery({
    idempotencyKey: 'google-ads:id', deliveryId: 'id', contentSha256: 'a'.repeat(64),
    mode: 'LIVE', payloadJson: '{}', payloadExpiresAt: PAYLOAD_EXPIRY,
  });
  assert.equal(result.duplicate, true);
  assert.equal(result.status, 'queued');
  assert.equal(result.payloadExpiresAt, PAYLOAD_EXPIRY);
});

test('idempotency key reused with a different body is a permanent conflict', async () => {
  const db = createDb({
    changes: [0],
    rows: [{
      idempotency_key: 'google-ads:id', delivery_id: 'id', content_sha256: 'b'.repeat(64),
      mode: 'LIVE', status: 'queued', payload_json: '{}', payload_expires_at: PAYLOAD_EXPIRY,
      queue_attempts: 1,
    }],
  });
  await assert.rejects(
    new D1GoogleAdsDeliveryStore({ db }).reserveDelivery({
      idempotencyKey: 'google-ads:id', deliveryId: 'id', contentSha256: 'a'.repeat(64),
      mode: 'LIVE', payloadJson: '{}', payloadExpiresAt: PAYLOAD_EXPIRY,
    }),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_IDEMPOTENCY_CONFLICT',
  );
});

test('preview and completed states redact the durable payload immediately', async () => {
  const db = createDb();
  const store = new D1GoogleAdsDeliveryStore({ db, now: () => 2000 });
  await store.markPreviewValidated({ deliveryId: 'preview-id', validation: { ok: true } });
  await store.markCompleted({ deliveryId: 'live-id', reconciliation: { rows: 12 } });
  const updateStatements = db.statements.filter((item) => /UPDATE google_ads_deliveries/u.test(item.sql));
  assert.equal(updateStatements.length, 2);
  assert.equal(updateStatements.every((item) => item.bindings[0] === '{}'), true);
  assert.match(updateStatements[0].sql, /preview_validated/u);
  assert.match(updateStatements[1].sql, /completed/u);
});


test('permanent failure retains the bounded payload for DLQ redrive until expiry', async () => {
  const db = createDb();
  await new D1GoogleAdsDeliveryStore({ db, now: () => 3000 }).markFailed({
    deliveryId: 'failed-id', retryable: false, errorCode: 'BAD_SCHEMA',
  });
  assert.doesNotMatch(db.statements[0].sql, /payload_json\s*=/u);
  assert.equal(db.statements[0].bindings[0], 'failed_permanent');
  assert.equal(db.statements[0].bindings.includes('BAD_SCHEMA'), true);
});

test('retention cleanup expires stale payloads fail-closed and deletes old terminal audit rows', async () => {
  const db = createDb();
  await new D1GoogleAdsDeliveryStore({ db }).cleanupRetention({ now: 50_000, auditCutoff: 20_000 });
  assert.equal(db.statements.length, 3);
  assert.match(db.statements[0].sql, /DELETE FROM google_ads_delivery_nonces/u);
  assert.match(db.statements[1].sql, /GOOGLE_ADS_DELIVERY_PAYLOAD_EXPIRED/u);
  assert.match(db.statements[1].sql, /failed_permanent/u);
  assert.match(db.statements[2].sql, /preview_validated.*failed_permanent.*completed/su);
  assert.deepEqual(db.statements[2].bindings, [20_000]);
});


test('expired payload fails closed on read and is redacted without a new schedule', async () => {
  const db = createDb({
    rows: [{
      idempotency_key: 'google-ads:id', delivery_id: 'id', content_sha256: 'a'.repeat(64),
      mode: 'LIVE', status: 'failed_permanent', payload_json: '{"private":true}', payload_expires_at: 999,
      queue_attempts: 1, queued_at: 10, processing_at: 20, completed_at: 30,
      reconciliation_json: null, last_error_code: 'BAD_SCHEMA', created_at: 1, updated_at: 30,
    }],
  });
  await assert.rejects(
    new D1GoogleAdsDeliveryStore({ db, now: () => 1000 }).readDeliveryById('id'),
    (error) => error.code === 'GOOGLE_ADS_DELIVERY_PAYLOAD_EXPIRED' && error.retryable === false,
  );
  const update = db.statements.find((item) => /UPDATE google_ads_deliveries/u.test(item.sql));
  assert.equal(update.bindings[0], '{}');
  assert.equal(update.bindings.includes('id'), true);
});

test('processing accepts queue-send/mark race recovery states', async () => {
  for (const status of ['reserved', 'queue_failed', 'queued', 'processing', 'failed_retryable']) {
    const db = createDb({ changes: [1] });
    await new D1GoogleAdsDeliveryStore({ db, now: () => 10 }).markProcessing('delivery-id');
    assert.match(db.statements[0].sql, new RegExp(`'${status}'`, 'u'));
  }
});

test('D1 outages remain retryable for Queue/backoff handling', async () => {
  const store = new D1GoogleAdsDeliveryStore({ db: createDb({ runError: new Error('offline') }) });
  await assert.rejects(
    store.reserveNonce({ nonce: 'abcdefghijklmnopqrstuv', keyId: 'key-1', contentSha256: 'a'.repeat(64), receivedAt: 1000, expiresAt: 2000 }),
    (error) => error.code === 'D1_GOOGLE_ADS_NONCE_WRITE_FAILED' && error.retryable === true,
  );
});
