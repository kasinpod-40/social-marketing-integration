import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { D1GoogleAdsLiveAdmissionStore } from '../../packages/connectors/src/google-ads/d1-google-ads-live-admission-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const RUN_ID = '123e4567-e89b-42d3-a456-426614174000';
const NOW = 1785031200000;
const DIGEST = 'a'.repeat(64);

async function fixture(options = {}) {
  const [transport, admission] = await Promise.all([
    readFile(new URL('../../migrations/0013_google_ads_signed_delivery_transport.sql', import.meta.url), 'utf8'),
    readFile(new URL('../../migrations/0015_google_ads_live_admission.sql', import.meta.url), 'utf8'),
  ]);
  const d1 = createSqliteD1();
  d1.exec(transport);
  d1.exec(admission);
  insertRun(d1, options);
  return {
    d1,
    store: new D1GoogleAdsLiveAdmissionStore({ db: d1, now: () => NOW }),
  };
}

function reservation(overrides = {}) {
  return {
    runId: RUN_ID,
    operationId: RUN_ID,
    workKey: `google_ads:${RUN_ID}`,
    generation: NOW,
    originalRequestedAt: NOW,
    queueBodyDigest: DIGEST,
    now: NOW,
    ...overrides,
  };
}

test('LIVE admission is atomic, exact-retry safe and conflict detecting', async () => {
  const value = await fixture();
  try {
    const first = await value.store.reserve(reservation());
    assert.equal(first.disposition, 'reserved');
    assert.equal(first.admission.status, 'live_validated');

    const retry = await value.store.reserve(reservation({ now: NOW + 1 }));
    assert.equal(retry.disposition, 'exact_retry');
    assert.equal(retry.admission.operationId, RUN_ID);

    await assert.rejects(
      () => value.store.reserve(reservation({ queueBodyDigest: 'b'.repeat(64), now: NOW + 2 })),
      (error) => error.code === 'GOOGLE_ADS_LIVE_ADMISSION_CONFLICT',
    );
    assert.equal(
      value.d1.database.prepare('SELECT COUNT(*) AS total FROM google_ads_live_admissions').get().total,
      1,
    );
  } finally {
    value.d1.close();
  }
});

test('send and processing transitions are idempotent and completion redacts payload', async () => {
  const value = await fixture();
  try {
    await value.store.reserve(reservation());
    const sending = await value.store.markSendPending({ runId: RUN_ID, now: NOW + 1 });
    assert.equal(sending.sendAttempts, 1);
    const duplicateSending = await value.store.markSendPending({ runId: RUN_ID, now: NOW + 2 });
    assert.equal(duplicateSending.sendAttempts, 1);

    const queued = await value.store.markQueued({ runId: RUN_ID, messageId: 'queue-message', now: NOW + 3 });
    assert.equal(queued.status, 'queued');
    const processing = await value.store.markProcessing({ runId: RUN_ID, now: NOW + 4 });
    assert.equal(processing.status, 'processing');

    const completed = await value.store.markCompleted({
      runId: RUN_ID,
      reconciliation: { expected: 1, failed: 0 },
      now: NOW + 5,
    });
    assert.equal(completed.status, 'completed');
    assert.deepEqual(completed.reconciliation, { expected: 1, failed: 0 });
    assert.equal(
      value.d1.database.prepare(
        'SELECT payload_json FROM google_ads_delivery_chunks WHERE run_id = ?',
      ).get(RUN_ID).payload_json,
      null,
    );
  } finally {
    value.d1.close();
  }
});

test('incomplete or PREVIEW runs cannot reserve LIVE admission', async () => {
  const incomplete = await fixture({ receivedRows: 0 });
  try {
    await assert.rejects(
      () => incomplete.store.reserve(reservation()),
      (error) => error.code === 'GOOGLE_ADS_LIVE_RUN_NOT_ADMISSIBLE',
    );
  } finally {
    incomplete.d1.close();
  }

  const preview = await fixture({ mode: 'PREVIEW' });
  try {
    await assert.rejects(
      () => preview.store.reserve(reservation()),
      (error) => error.code === 'GOOGLE_ADS_LIVE_RUN_NOT_ADMISSIBLE',
    );
  } finally {
    preview.d1.close();
  }
});

function insertRun(d1, options = {}) {
  const mode = options.mode ?? 'LIVE';
  const receivedRows = options.receivedRows ?? 1;
  d1.database.prepare(`
    INSERT INTO google_ads_delivery_runs (
      run_id, run_fingerprint, schema_version, mode, run_started_at,
      identity_fingerprint, source_timezone, manifest_json, manifest_digest,
      expected_chunk_count, expected_row_count, received_chunk_count,
      received_row_count, status, error_code, expires_at,
      payload_retention_until, audit_expires_at, completed_at,
      payload_redacted_at, created_at, updated_at
    ) VALUES (?, ?, 'google_ads_manager_script_signed_delivery_v1', ?, ?, ?,
      'Asia/Bangkok', '{}', ?, 1, 1, 1, ?, 'assembling', NULL, ?, ?, ?, NULL, NULL, ?, ?)
  `).run(
    RUN_ID,
    'r'.repeat(43),
    mode,
    NOW,
    '1'.repeat(64),
    '2'.repeat(64),
    receivedRows,
    NOW + 7_200_000,
    NOW + 604_800_000,
    NOW + 2_592_000_000,
    NOW,
    NOW,
  );
  d1.database.prepare(`
    INSERT INTO google_ads_delivery_chunks (
      idempotency_key, run_id, dataset_key, chunk_index, chunk_count,
      total_rows, row_count, body_digest, payload_json, payload_bytes,
      reservation_id, received_at, redacted_at
    ) VALUES (?, ?, 'account', 0, 1, 1, 1, ?, '{}', 2, ?, ?, NULL)
  `).run(`google-ads:${RUN_ID}:account:0`, RUN_ID, '3'.repeat(64), `${RUN_ID}:reservation`, NOW);
}
