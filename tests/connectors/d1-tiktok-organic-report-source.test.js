import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTikTokOrganicPeriodMetrics } from '../../packages/application/src/reports/calculate-tiktok-organic-report.js';
import { D1TikTokOrganicReportSource } from '../../packages/connectors/src/tiktok/d1-tiktok-organic-report-source.js';

const TOTAL = 1_001;

function makeObservation(id, date, observedAt, overrides = {}) {
  return {
    observation_key: `tiktok:chemistry_k:${id}:${observedAt}:changed:v1`,
    content_key: `tiktok:chemistry_k:${id}`,
    customer_key: 'chemistry_k',
    platform: 'tiktok',
    account_key: 'chemistry_k',
    external_content_id: String(id),
    observed_at: observedAt,
    metric_date: date,
    views: 100 + id,
    likes: 10 + id,
    comments: id,
    shares: id,
    unique_viewers: null,
    avg_watch_time_seconds: 2,
    total_watch_time_seconds: 200,
    completion_rate: 0.5,
    coverage_run_id: 'coverage:tiktok:latest',
    source_revision: 'watermark-latest',
    ...overrides,
  };
}

function buildD1() {
  const states = Array.from({ length: TOTAL }, (_, index) => {
    const id = index + 1;
    return {
      content_key: `tiktok:chemistry_k:${id}`,
      customer_key: 'chemistry_k',
      platform: 'tiktok',
      account_key: 'chemistry_k',
      external_content_id: String(id),
      published_at: Date.parse('2026-01-01T00:00:00Z'),
    };
  });
  const byDate = new Map([
    ['2026-07-10', Array.from({ length: TOTAL }, (_, index) => {
      const id = index + 1;
      if (id === 1) return makeObservation(id, '2026-07-10', 30, { views: 0 });
      if (id === 2) return makeObservation(id, '2026-07-10', 30, { likes: null });
      return makeObservation(id, '2026-07-10', 30);
    })],
    ['2026-07-03', Array.from({ length: TOTAL }, (_, index) => {
      const id = index + 1;
      return makeObservation(id, '2026-07-03', 20, { views: id === 1 ? 8 : 50 + id });
    })],
    ['2026-06-26', Array.from({ length: TOTAL }, (_, index) => {
      const id = index + 1;
      return makeObservation(id, '2026-06-26', 10, { views: id === 1 ? 5 : id });
    })],
  ]);

  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async all() {
              if (sql.includes('FROM organic_content_state')) return { results: states };
              if (sql.includes('ROW_NUMBER() OVER')) {
                const boundary = bindings[3];
                if (sql.includes('metric_date < ?')) return { results: byDate.get('2026-06-26') };
                return { results: byDate.get(boundary) ?? [] };
              }
              throw new Error(`Unexpected all query: ${sql}`);
            },
            async first() {
              if (!sql.includes('FROM data_coverage_runs')) {
                throw new Error(`Unexpected first query: ${sql}`);
              }
              return {
                coverage_run_id: 'coverage:tiktok:latest',
                status: 'complete',
                expected_entities: TOTAL,
                observed_entities: TOTAL,
                failed_rows: 0,
                source_watermark: 'watermark-latest',
                completed_at: 40,
              };
            },
          };
        },
      };
    },
  };
}

test('D1 TikTok report source supports more than 800 identities with comparison boundaries', async () => {
  const source = new D1TikTokOrganicReportSource({ db: buildD1() });
  const result = await source.load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    timeZone: 'Asia/Bangkok',
    periodStart: '2026-07-04',
    periodEnd: '2026-07-10',
    compareStart: '2026-06-27',
    compareEnd: '2026-07-03',
    maxContentRecords: 2_000,
  });

  assert.equal(result.contents.length, TOTAL);
  assert.equal(result.readSummary.externalContentIds, TOTAL);
  assert.equal(result.readSummary.dailyQueries, 3);
  assert.equal(result.readSummary.coverageStatus, 'complete');
  assert.equal(result.readSummary.sourceWatermark, 'watermark-latest');
  assert.deepEqual(
    [...new Set(result.dailySnapshots.filter((row) => row.externalContentId === '1').map((row) => row.metricDate))],
    ['2026-06-26', '2026-07-03', '2026-07-10'],
  );
});

test('D1 report source preserves null, observed zero and negative corrections', async () => {
  const source = new D1TikTokOrganicReportSource({ db: buildD1() });
  const result = await source.load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-04',
    periodEnd: '2026-07-10',
    maxContentRecords: 2_000,
  });
  const zero = result.dailySnapshots.find(
    (row) => row.externalContentId === '1' && row.metricDate === '2026-07-10',
  );
  const missing = result.dailySnapshots.find(
    (row) => row.externalContentId === '2' && row.metricDate === '2026-07-10',
  );
  assert.equal(zero.views, 0);
  assert.equal(missing.likes, null);

  const calculated = calculateTikTokOrganicPeriodMetrics({
    contents: result.contents,
    dailySnapshots: result.dailySnapshots,
    periodStart: '2026-07-04',
    periodEnd: '2026-07-10',
  });
  const corrected = calculated.contentRows.find((row) => row.content.externalContentId === '1');
  assert.equal(corrected.periodViews, -5);
  assert.equal(corrected.performanceStatus, 'corrected_down');
});

test('D1 TikTok report source fails closed at its configured bound', async () => {
  const source = new D1TikTokOrganicReportSource({ db: buildD1() });
  await assert.rejects(() => source.load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-04',
    periodEnd: '2026-07-10',
    maxContentRecords: 800,
  }), (error) => error.code === 'REPORT_D1_SOURCE_CONTENT_LIMIT_EXCEEDED');
});
