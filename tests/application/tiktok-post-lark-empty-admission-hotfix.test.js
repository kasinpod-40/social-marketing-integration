import assert from 'node:assert/strict';
import test from 'node:test';
import {
  buildTikTokAdmissionStatusSql,
  normalizeTikTokAdmissionStatusRow,
} from '../../scripts/lib/tiktok-post-lark-gap-reconciliation.js';

const SOURCE_WATERMARK = 'a'.repeat(64);
const METRIC_DATE = '2026-07-27';

function emptyAdmissionSentinel() {
  return {
    admission_key: null,
    status: null,
    source_watermark: null,
    metric_date: null,
    source_record_count: null,
    sync_run_id: null,
    error_code: null,
    requested_at: null,
    completed_at: null,
    updated_at: null,
  };
}

test('TikTok admission lookup always returns one read-only sentinel row', () => {
  const sql = buildTikTokAdmissionStatusSql({
    sourceWatermark: SOURCE_WATERMARK,
    metricDate: METRIC_DATE,
  });

  assert.match(sql, /^SELECT /u);
  assert.match(sql, /FROM \(SELECT 1 AS singleton\) AS seed LEFT JOIN/u);
  assert.match(sql, /LIMIT 1 \) AS candidate ON 1 = 1;$/u);
  assert.doesNotMatch(sql, /\b(?:INSERT|UPDATE|DELETE|CREATE|DROP|ALTER)\b/iu);
});

test('all-null admission sentinel normalizes to no existing admission', () => {
  assert.equal(normalizeTikTokAdmissionStatusRow(emptyAdmissionSentinel(), {
    sourceWatermark: SOURCE_WATERMARK,
    metricDate: METRIC_DATE,
  }), null);
});

test('partial admission sentinel remains fail-closed', () => {
  assert.throws(
    () => normalizeTikTokAdmissionStatusRow({
      ...emptyAdmissionSentinel(),
      source_watermark: SOURCE_WATERMARK,
    }, {
      sourceWatermark: SOURCE_WATERMARK,
      metricDate: METRIC_DATE,
    }),
    (error) => error.code === 'TIKTOK_GAP_RECONCILIATION_VALUE_INVALID',
  );
});

test('completed admission normalization contract is unchanged', () => {
  const row = {
    admission_key: 'tiktok-admission:abc',
    status: 'completed',
    source_watermark: SOURCE_WATERMARK,
    metric_date: METRIC_DATE,
    source_record_count: 2024,
    sync_run_id: 'sync-run-1',
    error_code: null,
    requested_at: Date.UTC(2026, 6, 27, 0, 0, 0),
    completed_at: Date.UTC(2026, 6, 27, 0, 5, 0),
    updated_at: Date.UTC(2026, 6, 27, 0, 5, 0),
  };

  const result = normalizeTikTokAdmissionStatusRow(row, {
    sourceWatermark: SOURCE_WATERMARK,
    metricDate: METRIC_DATE,
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.sourceRecordCount, 2024);
  assert.equal(result.syncRunId, 'sync-run-1');
});
