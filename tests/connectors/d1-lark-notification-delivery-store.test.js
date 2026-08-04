import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { D1LarkNotificationDeliveryStore } from '../../packages/connectors/src/lark/d1-lark-notification-delivery-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const migration = readFileSync('migrations/0019_lark_notification_delivery.sql', 'utf8');
const hashA = 'a'.repeat(64);
const hashB = 'b'.repeat(64);
const hashC = 'c'.repeat(64);

function claimInput(overrides = {}) {
  return {
    notificationAttemptKey: `run:1::${hashA}`,
    aiRunKey: 'run:1',
    dedupeKey: hashA,
    reportId: 'report:1',
    reportSettingKey: 'setting:1',
    customerProfile: 'integration_workspace',
    destinationKeyHash: hashB,
    templateVersion: 'executive_report_notification_v1',
    payloadChecksum: hashC,
    ownerId: 'owner:1',
    leaseMs: 1_000,
    claimedAt: 1_000,
    ...overrides,
  };
}

function setup() {
  const db = createSqliteD1();
  db.exec(migration);
  return { db, store: new D1LarkNotificationDeliveryStore({ db, now: () => 1_000 }) };
}

test('only one caller acquires an active notification attempt', async () => {
  const { db, store } = setup();
  try {
    const first = await store.claim(claimInput());
    const replay = await store.claim(claimInput({ ownerId: 'owner:2', claimedAt: 1_500 }));
    assert.equal(first.acquired, true);
    assert.equal(first.disposition, 'claimed');
    assert.equal(replay.acquired, false);
    assert.equal(replay.disposition, 'in_flight');
    assert.equal(replay.delivery.claimOwner, 'owner:1');
    assert.equal(replay.delivery.claimCount, 1);
  } finally {
    db.close();
  }
});

test('an expired pre-send claim can be reclaimed, but sending can never be reclaimed', async () => {
  const { db, store } = setup();
  try {
    await store.claim(claimInput());
    const reclaimed = await store.claim(claimInput({ ownerId: 'owner:2', claimedAt: 2_001 }));
    assert.equal(reclaimed.acquired, true);
    assert.equal(reclaimed.delivery.claimOwner, 'owner:2');
    assert.equal(reclaimed.delivery.claimCount, 2);
    await store.markSending({
      notificationAttemptKey: claimInput().notificationAttemptKey,
      ownerId: 'owner:2',
      attemptedAt: 2_100,
    });
    const unsafeReplay = await store.claim(claimInput({ ownerId: 'owner:3', claimedAt: 9_000 }));
    assert.equal(unsafeReplay.acquired, false);
    assert.equal(unsafeReplay.disposition, 'in_flight');
    assert.equal(unsafeReplay.delivery.status, 'sending');
  } finally {
    db.close();
  }
});

test('sent delivery is terminal and every replay is a no-send dedupe', async () => {
  const { db, store } = setup();
  try {
    await store.claim(claimInput());
    await store.markSending({
      notificationAttemptKey: claimInput().notificationAttemptKey,
      ownerId: 'owner:1',
      attemptedAt: 1_100,
    });
    const sent = await store.markSent({
      notificationAttemptKey: claimInput().notificationAttemptKey,
      ownerId: 'owner:1',
      sentAt: 1_200,
      messageIdHash: hashA,
    });
    assert.equal(sent.status, 'sent');
    const replay = await store.claim(claimInput({ ownerId: 'owner:2', claimedAt: 9_000 }));
    assert.equal(replay.acquired, false);
    assert.equal(replay.disposition, 'already_sent');
    assert.equal(replay.delivery.sentAt, 1_200);
  } finally {
    db.close();
  }
});

test('unknown remote outcome becomes terminal and forbids automatic reclaim', async () => {
  const { db, store } = setup();
  try {
    await store.claim(claimInput());
    await store.markSending({
      notificationAttemptKey: claimInput().notificationAttemptKey,
      ownerId: 'owner:1',
      attemptedAt: 1_100,
    });
    const blocked = await store.markBlockedUnknown({
      notificationAttemptKey: claimInput().notificationAttemptKey,
      ownerId: 'owner:1',
      errorMessage: 'request timeout after dispatch',
    });
    assert.equal(blocked.status, 'blocked_unknown');
    const replay = await store.claim(claimInput({ ownerId: 'owner:2', claimedAt: 9_000 }));
    assert.equal(replay.acquired, false);
    assert.equal(replay.disposition, 'blocked');
  } finally {
    db.close();
  }
});

test('same attempt key with different immutable identity fails closed', async () => {
  const { db, store } = setup();
  try {
    await store.claim(claimInput());
    await assert.rejects(
      () => store.claim(claimInput({ reportId: 'report:other', ownerId: 'owner:2' })),
      (error) => error.code === 'LARK_NOTIFICATION_ATTEMPT_IDENTITY_CONFLICT',
    );
  } finally {
    db.close();
  }
});
