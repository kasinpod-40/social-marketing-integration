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
