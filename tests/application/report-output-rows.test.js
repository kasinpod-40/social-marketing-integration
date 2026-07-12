import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportMetricValueRows,
  buildReportTopContentRows,
} from '../../packages/application/src/reports/build-report-output-rows.js';

const period = {
  periodStart: '2026-07-06', periodEnd: '2026-07-12',
  compareStart: '2026-06-29', compareEnd: '2026-07-05',
};
const common = {
  reportId: 'report-1', reportSettingKey: 'dev:tiktok:weekly', customerProfile: 'dev',
  reportType: 'weekly_organic_report', accountId: 'ft_pumkin', period,
  generatedAt: Date.parse('2026-07-13T01:00:00Z'), utcOffset: '+07:00',
};

test('builds normalized metric rows with stable report keys', () => {
  const rows = buildReportMetricValueRows({
    ...common, dataStatus: 'complete', sourceSnapshotCount: 4,
    metrics: {
      'tiktok:period_views': {
        metricKey: 'tiktok:period_views', displayName: 'Views', current: 100,
        compare: 80, change: 20, changePercent: 0.25, unit: 'count',
        formulaVersion: 'tiktok-organic-v1', clientVisible: true, sortOrder: 10,
      },
    },
  });

  assert.equal(rows[0].report_metric_key, 'report-1::tiktok%3Aperiod_views::summary::all');
  assert.equal(rows[0].current_value, 100);
  assert.equal(rows[0].rank, 1);
  assert.equal(rows[0].client_visible, true);
});

test('top content rows use fixed rank keys and fill unused slots deterministically', () => {
  const contentRows = [{
    content: {
      contentKey: 'tiktok:ft:1', externalContentId: '1', caption: 'clip',
      contentUrl: 'https://tiktok.com/v/1', thumbnailUrl: null, publishedAt: 1,
    },
    periodViews: 100, periodLikes: 10, periodComments: 2, periodShares: 1,
    periodEngagement: 13, periodEngagementRate: 0.13,
    current: { views: 200 }, performanceStatus: 'growing', dataStatus: 'complete',
  }];
  const rows = buildReportTopContentRows({ ...common, contentRows, limit: 3 });

  assert.equal(rows.length, 3);
  assert.equal(rows[0].report_content_key, 'report-1::rank:1');
  assert.equal(rows[0].content_key, 'tiktok:ft:1');
  assert.equal(rows[1].report_content_key, 'report-1::rank:2');
  assert.equal(rows[1].data_status, 'no_data');
  assert.equal(rows[1].content_key, 'no_data:report-1:2');
  assert.equal(rows[1].caption, 'ไม่มีข้อมูล');
  assert.equal(rows[1].content_url, 'https://www.tiktok.com/');
});

test('top content output rejects limits above the production safety cap', () => {
  assert.throws(
    () => buildReportTopContentRows({ ...common, contentRows: [], limit: 101 }),
    /between 1 and 100/,
  );
});
