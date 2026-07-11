import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportSnapshot } from '../../packages/application/src/use-cases/build-report-snapshot.js';

test('builds a stable Canva-style report snapshot row', () => {
  const row = buildReportSnapshot({
    reportType: 'weekly_organic_report',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-07',
    compareStart: '2025-07-01',
    compareEnd: '2025-07-07',
    comparisonMode: 'year_over_year',
    platforms: ['tiktok', 'facebook', 'tiktok'],
    courseName: 'M.4/1',
    metricPayload: { views: { current: 1000, previous: 800 } },
    topContent: [{ content_key: 'tiktok:a:v1', views: 1000 }],
    topAds: [],
    generatedAt: '2026-07-08T10:00:00.000Z',
  });

  assert.equal(row.report_id, 'weekly_organic_report::2026-07-01::2026-07-07::year_over_year::2025-07-01::2025-07-07::facebook+tiktok::M.4/1');
  assert.deepEqual(row.platform, ['facebook', 'tiktok']);
  assert.equal(row.metric_payload_json, '{"views":{"current":1000,"previous":800}}');
  assert.equal(row.top_content_json, '[{"content_key":"tiktok:a:v1","views":1000}]');
});

test('requires comparison dates when comparison mode is active', () => {
  assert.throws(
    () => buildReportSnapshot({
      reportType: 'yoy_report',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-07',
      comparisonMode: 'year_over_year',
      platforms: ['youtube'],
      metricPayload: {},
    }),
    /requires compareStart and compareEnd/,
  );
});


test('rejects impossible dates, reversed ranges, and timezone-less generatedAt', () => {
  assert.throws(
    () => buildReportSnapshot({
      reportType: 'weekly_organic_report',
      periodStart: '2026-02-30',
      periodEnd: '2026-03-07',
      platforms: ['tiktok'],
      metricPayload: {},
    }),
    /not a valid calendar date/,
  );
  assert.throws(
    () => buildReportSnapshot({
      reportType: 'weekly_organic_report',
      periodStart: '2026-07-08',
      periodEnd: '2026-07-01',
      platforms: ['tiktok'],
      metricPayload: {},
    }),
    /start must not be after end/,
  );
  assert.throws(
    () => buildReportSnapshot({
      reportType: 'weekly_organic_report',
      periodStart: '2026-07-01',
      periodEnd: '2026-07-07',
      platforms: ['tiktok'],
      metricPayload: {},
      generatedAt: '2026-07-08T10:00:00',
    }),
    /explicit timezone/,
  );
});

test('rejects payload values that JSON would silently erase or change', () => {
  const base = {
    reportType: 'weekly_organic_report',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-07',
    platforms: ['tiktok'],
  };

  assert.throws(
    () => buildReportSnapshot({ ...base, metricPayload: { generated: new Date() } }),
    /plain JSON objects and arrays/,
  );
  assert.throws(
    () => buildReportSnapshot({ ...base, metricPayload: { views: Number.NaN } }),
    /non-JSON value/,
  );
  assert.throws(
    () => buildReportSnapshot({ ...base, metricPayload: { views: undefined } }),
    /non-JSON value/,
  );
});

test('escapes report-id separators so different dimensions cannot collide', () => {
  const base = {
    reportType: 'weekly_organic_report',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-07',
    metricPayload: {},
  };
  const first = buildReportSnapshot({
    ...base,
    platforms: ['a+b'],
    courseName: 'เคมี::ม.4',
  });
  const second = buildReportSnapshot({
    ...base,
    platforms: ['a', 'b'],
    courseName: 'เคมี%3A%3Aม.4',
  });

  assert.notEqual(first.report_id, second.report_id);
  assert.match(first.report_id, /a%2Bb::เคมี%3A%3Aม\.4$/u);
  assert.match(second.report_id, /a\+b::เคมี%253A%253Aม\.4$/u);
});
