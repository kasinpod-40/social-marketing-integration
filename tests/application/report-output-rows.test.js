import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportMetricValueRows,
  buildReportTopAdsRows,
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

test('metric rows preserve Organic chart-only label, Views and Engagement fields', () => {
  const [row] = buildReportMetricValueRows({
    ...common,
    dataStatus: 'complete',
    metrics: [{
      metricKey: 'youtube:content_performance',
      displayName: 'Clip 1',
      current: 100,
      unit: 'count',
      formulaVersion: 'organic-v1',
      clientVisible: true,
      dimensionType: 'summary',
      dimensionValue: 'organic_content_rank:1',
      rank: 1,
      contentChartLabel: '001 · Clip 1',
      contentPeriodViews: 100,
      contentPeriodEngagement: 13,
    }],
  });

  assert.equal(row.content_chart_label, '001 · Clip 1');
  assert.equal(row.content_period_views, 100);
  assert.equal(row.content_period_engagement, 13);
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

test('top content output rejects limits above the bounded production safety cap', () => {
  assert.throws(
    () => buildReportTopContentRows({ ...common, contentRows: [], limit: 50_001 }),
    /between 1 and 50000/,
  );
});

test('Google campaign ranking keeps Campaign identity without fabricating an Ad ID', () => {
  const rows = buildReportTopAdsRows({
    ...common,
    platform: 'google_ads',
    adRows: [{
      external_ad_id: null,
      external_campaign_id: 'campaign-1',
      ad_name: 'Search Campaign',
      spend_micros: 5_500_000,
      ctr: 0.0126,
      data_status: 'complete',
    }],
    limit: 1,
  });

  assert.equal(rows[0].external_ad_id, null);
  assert.equal(rows[0].external_campaign_id, 'campaign-1');
  assert.equal(rows[0].ad_name, 'Search Campaign');
  assert.equal(rows[0].ad_chart_label, '001 · Search Campaign');
  assert.equal(rows[0].spend_amount, 5.5);
  assert.equal(rows[0].ctr_percent, 1.26);
});
