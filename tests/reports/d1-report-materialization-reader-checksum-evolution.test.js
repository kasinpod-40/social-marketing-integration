import test from 'node:test';
import assert from 'node:assert/strict';
import { D1ReportMaterializationReader } from '../../packages/connectors/src/d1-report-materialization-reader.js';
import { createStableFingerprint } from '../../packages/shared/src/hash/stable-fingerprint.js';

const GENERATED_AT = 1_785_300_000_000;

function createLegacyPayload(overrides = {}) {
  return {
    schemaVersion: 'dashboard-materialization-v2',
    sourceReportId: null,
    platformScope: 'tiktok',
    capability: 'organic',
    reportType: 'dashboard_performance_report',
    period: {
      periodKind: 'rolling_days',
      windowDays: 3,
      periodStart: '2026-07-26',
      periodEnd: '2026-07-28',
      comparisonMode: 'previous_period',
      compareStart: '2026-07-23',
      compareEnd: '2026-07-25',
    },
    dataStatus: 'complete',
    coverageRate: 1,
    metricPayload: {},
    topContent: [],
    topAds: [],
    source: 'd1_historical_facts',
    sourceWatermark: 'watermark-1',
    generatedAt: GENERATED_AT,
    sourceUnavailableReason: null,
    aiSummary: null,
    ...overrides,
  };
}

async function createRow(payload, checksumPayload = payload) {
  return {
    report_id: 'setting:account:rolling_days:2026-07-26:2026-07-28:formula-v1',
    report_setting_key: 'setting',
    customer_key: 'chemistry_k',
    platform_scope: 'tiktok',
    account_key: 'account',
    report_type: 'dashboard_performance_report',
    period_kind: 'rolling_days',
    window_days: 3,
    period_start: '2026-07-26',
    period_end: '2026-07-28',
    compare_start: '2026-07-23',
    compare_end: '2026-07-25',
    data_status: 'complete',
    coverage_rate: 1,
    formula_version: 'formula-v1',
    source_watermark: 'watermark-1',
    payload_json: JSON.stringify(payload),
    payload_checksum: await createStableFingerprint(checksumPayload),
    generated_at: GENERATED_AT,
    expires_at: null,
    created_at: GENERATED_AT,
    updated_at: GENERATED_AT,
  };
}

function createReader(row) {
  return new D1ReportMaterializationReader({
    db: {
      prepare() {
        return {
          bind() {
            return {
              async first() {
                return row;
              },
            };
          },
        };
      },
    },
  });
}

test('reader verifies legacy raw JSON before adding current schema defaults', async () => {
  const legacyPayload = createLegacyPayload();
  assert.equal(Object.hasOwn(legacyPayload, 'collections'), false);
  const result = await createReader(await createRow(legacyPayload)).readById(
    'setting:account:rolling_days:2026-07-26:2026-07-28:formula-v1',
  );

  assert.deepEqual(result.payload.collections, {});
  assert.equal(result.payload.platformScope, 'tiktok');
  assert.equal(result.row.payload_checksum, await createStableFingerprint(legacyPayload));
});

test('reader still rejects an actually modified stored payload', async () => {
  const originalPayload = createLegacyPayload();
  const tamperedPayload = createLegacyPayload({
    metricPayload: { views: { currentValue: 999 } },
  });
  const reader = createReader(await createRow(tamperedPayload, originalPayload));

  await assert.rejects(
    () => reader.readById('setting:account:rolling_days:2026-07-26:2026-07-28:formula-v1'),
    (error) => error.code === 'REPORT_MATERIALIZATION_CHECKSUM_MISMATCH',
  );
});

test('reader accepts current payloads that already contain collections', async () => {
  const currentPayload = createLegacyPayload({ collections: {} });
  const result = await createReader(await createRow(currentPayload)).readById(
    'setting:account:rolling_days:2026-07-26:2026-07-28:formula-v1',
  );
  assert.deepEqual(result.payload.collections, {});
});

test('reader selects the latest formula revision for one exact retained period identity', async () => {
  const period = {
    periodKind: 'rolling_days',
    windowDays: 7,
    periodStart: '2026-09-14',
    periodEnd: '2026-09-20',
    comparisonMode: 'previous_period',
    compareStart: '2026-09-07',
    compareEnd: '2026-09-13',
  };
  const payload = createLegacyPayload({ platformScope: 'youtube', period });
  const row = {
    ...await createRow(payload),
    report_id: 'chemistry_k:youtube:rolling:7d:chemistry_k:rolling_days:2026-09-14:2026-09-20:youtube-organic-v2',
    report_setting_key: 'chemistry_k:youtube:rolling:7d',
    platform_scope: 'youtube',
    account_key: 'chemistry_k',
    window_days: 7,
    period_start: period.periodStart,
    period_end: period.periodEnd,
    compare_start: period.compareStart,
    compare_end: period.compareEnd,
    formula_version: 'youtube-organic-v2',
  };
  let capturedSql = '';
  let capturedBindings = [];
  const reader = new D1ReportMaterializationReader({
    db: {
      prepare(sql) {
        capturedSql = sql;
        return {
          bind(...bindings) {
            capturedBindings = bindings;
            return { async first() { return row; } };
          },
        };
      },
    },
  });

  const result = await reader.readLatestForPeriod({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    platformScope: 'youtube',
    reportSettingKey: 'chemistry_k:youtube:rolling:7d',
    periodKind: 'rolling_days',
    windowDays: 7,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  });

  assert.equal(result.row.formula_version, 'youtube-organic-v2');
  assert.match(capturedSql, /period_start = \? AND period_end = \? AND window_days = \?/u);
  assert.match(capturedSql, /ORDER BY generated_at DESC, report_id ASC/u);
  assert.deepEqual(capturedBindings, [
    'chemistry_k',
    'chemistry_k',
    'youtube',
    'chemistry_k:youtube:rolling:7d',
    'rolling_days',
    '2026-09-14',
    '2026-09-20',
    7,
  ]);
});
