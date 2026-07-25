import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  D1GoogleAdsManagerDeliveryStore,
} from '../../packages/connectors/src/google-ads/d1-google-ads-manager-delivery-store.js';
import {
  createStableFingerprint,
  stableSerialize,
} from '../../packages/shared/src/hash/stable-fingerprint.js';
import { hashSecureToken } from '../../packages/shared/src/security/secure-token.js';
import {
  GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
  GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
  createGoogleAdsDeliveryEnvelope,
} from '../helpers/google-ads-manager-delivery-fixture.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL(
  '../../migrations/0013_google_ads_signed_delivery_transport.sql',
  import.meta.url,
);

test('nonce reservation is atomic and rejects a replay race', async () => {
  const fixture = await createStore();
  try {
    const input = {
      nonceFingerprint: await hashSecureToken('nonce-fixture'),
      requestTimestampSeconds: Math.trunc(GOOGLE_ADS_DELIVERY_FIXTURE_NOW / 1_000),
      now: GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
    };
    const results = await Promise.allSettled([
      fixture.store.reserveNonce(input),
      fixture.store.reserveNonce(input),
    ]);
    assert.equal(results.filter((item) => item.status === 'fulfilled').length, 1);
    assert.equal(results.filter((item) => (
      item.status === 'rejected'
      && item.reason?.code === 'GOOGLE_ADS_DELIVERY_NONCE_REPLAYED'
    )).length, 1);
  } finally {
    fixture.d1.close();
  }
});

test('chunk reservation is atomic, exact-retry safe and rejects changed-body conflict', async () => {
  const fixture = await createStore();
  try {
    const input = await createStageInput();
    const staged = await fixture.store.stageChunk(input);
    assert.equal(staged.disposition, 'staged');
    assert.equal(staged.run.receivedChunkCount, 1);
    assert.equal(staged.run.receivedRowCount, 1);

    const replay = await fixture.store.stageChunk({
      ...input,
      reservationId: '223e4567-e89b-42d3-a456-426614174001',
    });
    assert.equal(replay.disposition, 'exact_retry');
    assert.equal(replay.run.receivedChunkCount, 1);

    await assert.rejects(
      () => fixture.store.stageChunk({
        ...input,
        bodyDigest: 'f'.repeat(64),
        reservationId: '323e4567-e89b-42d3-a456-426614174002',
      }),
      (error) => error?.code === 'GOOGLE_ADS_DELIVERY_IDEMPOTENCY_CONFLICT',
    );
    assert.equal(
      fixture.d1.database.prepare(
        'SELECT COUNT(*) AS total FROM google_ads_delivery_chunks',
      ).get().total,
      1,
    );
  } finally {
    fixture.d1.close();
  }
});

test('PREVIEW completion atomically redacts payload and expired cleanup retains only bounded audit', async () => {
  const fixture = await createStore();
  try {
    const input = await createStageInput();
    await fixture.store.stageChunk(input);
    const completed = await fixture.store.completePreview({
      runId: input.runId,
      now: GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
    });
    assert.equal(completed.status, 'preview_validated');
    assert.equal(
      fixture.d1.database.prepare(`
        SELECT payload_json, redacted_at
        FROM google_ads_delivery_chunks
        WHERE run_id = ?
      `).get(input.runId).payload_json,
      null,
    );

    await fixture.store.cleanupExpired({
      now: GOOGLE_ADS_DELIVERY_FIXTURE_NOW + (8 * 24 * 60 * 60 * 1_000),
    });
    const retained = await fixture.store.getRun(input.runId);
    assert.equal(retained.status, 'preview_validated');
    assert.ok(retained.payloadRedactedAt);
  } finally {
    fixture.d1.close();
  }
});

test('incomplete PREVIEW completion fails without redacting staged recovery payload', async () => {
  const fixture = await createStore();
  try {
    const input = await createStageInput();
    await fixture.store.stageChunk({
      ...input,
      expectedChunkCount: 2,
    });

    await assert.rejects(
      () => fixture.store.completePreview({
        runId: input.runId,
        now: GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
      }),
      (error) => error?.code === 'GOOGLE_ADS_DELIVERY_RUN_INCOMPLETE',
    );
    const staged = fixture.d1.database.prepare(`
      SELECT payload_json, redacted_at
      FROM google_ads_delivery_chunks
      WHERE run_id = ?
    `).get(input.runId);
    assert.equal(typeof staged.payload_json, 'string');
    assert.equal(staged.redacted_at, null);
  } finally {
    fixture.d1.close();
  }
});

async function createStore() {
  const sql = await readFile(MIGRATION_URL, 'utf8');
  const d1 = createSqliteD1();
  d1.exec(sql);
  return {
    d1,
    store: new D1GoogleAdsManagerDeliveryStore({
      db: d1,
      now: () => GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
    }),
  };
}

async function createStageInput() {
  const envelope = createGoogleAdsDeliveryEnvelope();
  const manifestJson = stableSerialize(envelope.manifest);
  return {
    runId: envelope.runId,
    runFingerprint: await hashSecureToken(envelope.runId),
    schemaVersion: envelope.schemaVersion,
    mode: envelope.mode,
    runStartedAt: Date.parse(envelope.runStartedAt),
    identityFingerprint: await createStableFingerprint(
      GOOGLE_ADS_DELIVERY_RUNTIME_IDENTITY,
    ),
    sourceTimezone: envelope.sourceTimezone,
    manifestJson,
    manifestDigest: await createStableFingerprint(envelope.manifest),
    expectedChunkCount: 1,
    expectedRowCount: 1,
    idempotencyKey: `google-ads:${envelope.runId}:account:0`,
    datasetKey: 'account',
    chunkIndex: 0,
    chunkCount: 1,
    totalRows: 1,
    rowCount: 1,
    bodyDigest: await createStableFingerprint(envelope),
    payloadJson: stableSerialize(envelope),
    reservationId: '123e4567-e89b-42d3-a456-426614174000',
    now: GOOGLE_ADS_DELIVERY_FIXTURE_NOW,
  };
}
