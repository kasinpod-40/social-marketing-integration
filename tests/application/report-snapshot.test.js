import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportSnapshot } from '../../packages/application/src/use-cases/build-report-snapshot.js';

function baseInput(overrides = {}) {
  return {
    reportSettingKey: 'dev_ft_pumkin:tiktok:weekly',
    customerProfile: 'dev_ft_pumkin',
    accountId: 'ft_pumkin',
    reportType: 'weekly_organic_report',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-07',
    comparisonMode: 'none',
    platforms: ['tiktok'],
    metricPayload: {},
    generatedAt: '2026-07-08T10:00:00.000Z',
    formulaVersion: 'tiktok-organic-v1',
    sourceSnapshotCount: 20,
    dataStatus: 'complete',
    ...overrides,
  };
}

test('builds a stable Lark-ready report snapshot row', () => {
  const row = buildReportSnapshot(baseInput({
    compareStart: '2025-07-01',
    compareEnd: '2025-07-07',
    comparisonMode: 'year_over_year',
    platforms: ['tiktok', 'facebook', 'tiktok'],
    courseName: 'M.4/1',
    metricPayload: { views: { current: 1000, previous: 800 } },
    topContent: [{ content_key: 'tiktok:a:v1', views: 1000 }],
    topAds: [],
    baselineCoverageRate: 1,
  }));

  assert.equal(
    row.report_id,
    'weekly_organic_report::dev_ft_pumkin::ft_pumkin::2026-07-01::2026-07-07::year_over_year::2025-07-01::2025-07-07::facebook+tiktok::M.4/1::dev_ft_pumkin%3Atiktok%3Aweekly',
  );
  assert.deepEqual(row.platform, ['facebook', 'tiktok']);
  assert.equal(row.metric_payload_json, '{"views":{"current":1000,"previous":800}}');
  assert.equal(row.top_content_json, '[{"content_key":"tiktok:a:v1","views":1000}]');
  assert.equal(row.period_start, Date.parse('2026-06-30T17:00:00.000Z'));
  assert.equal(row.period_end, Date.parse('2026-07-06T17:00:00.000Z'));
  assert.equal(row.generated_at, Date.parse('2026-07-08T10:00:00.000Z'));
  assert.equal(row.formula_version, 'tiktok-organic-v1');
});

test('persists the shared dashboard period identity on materialized snapshots', () => {
  const row = buildReportSnapshot(baseInput({
    reportType: 'dashboard_performance_report',
    reportSettingKey: 'integration_workspace:tiktok:rolling:30d',
    customerProfile: 'integration_workspace',
    accountId: 'chemistry_k',
    periodKind: 'rolling_days',
    windowDays: 30,
  }));
  assert.equal(row.period_kind, 'rolling_days');
  assert.equal(row.window_days, 30);
  assert.throws(
    () => buildReportSnapshot(baseInput({
      reportType: 'dashboard_performance_report',
      periodKind: 'custom_range',
      windowDays: 9,
    })),
    /must not define windowDays/,
  );
});

test('requires comparison dates when comparison mode is active', () => {
  assert.throws(
    () => buildReportSnapshot(baseInput({
      reportType: 'yoy_report',
      comparisonMode: 'year_over_year',
    })),
    /requires compareStart and compareEnd/,
  );
});

test('rejects impossible dates, reversed ranges, and timezone-less generatedAt', () => {
  assert.throws(
    () => buildReportSnapshot(baseInput({ periodStart: '2026-02-30' })),
    /not a valid calendar date/,
  );
  assert.throws(
    () => buildReportSnapshot(baseInput({ periodStart: '2026-07-08', periodEnd: '2026-07-01' })),
    /start must not be after end/,
  );
  assert.throws(
    () => buildReportSnapshot(baseInput({ generatedAt: '2026-07-08T10:00:00' })),
    /explicit timezone/,
  );
});

test('rejects payload values that JSON would silently erase or change', () => {
  assert.throws(
    () => buildReportSnapshot(baseInput({ metricPayload: { generated: new Date() } })),
    /plain JSON objects and arrays/,
  );
  assert.throws(
    () => buildReportSnapshot(baseInput({ metricPayload: { views: Number.NaN } })),
    /non-JSON value/,
  );
  assert.throws(
    () => buildReportSnapshot(baseInput({ metricPayload: { views: undefined } })),
    /non-JSON value/,
  );
});

test('escapes report-id separators so different dimensions cannot collide', () => {
  const first = buildReportSnapshot(baseInput({
    platforms: ['a+b'],
    courseName: 'เคมี::ม.4',
    reportSettingKey: 'setting::one',
  }));
  const second = buildReportSnapshot(baseInput({
    platforms: ['a', 'b'],
    courseName: 'เคมี%3A%3Aม.4',
    reportSettingKey: 'setting:one',
  }));

  assert.notEqual(first.report_id, second.report_id);
  assert.match(first.report_id, /a%2Bb::เคมี%3A%3Aม\.4::setting%3A%3Aone$/u);
  assert.match(second.report_id, /a\+b::เคมี%253A%253Aม\.4::setting%3Aone$/u);
});
