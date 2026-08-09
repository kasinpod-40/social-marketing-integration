import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_WEEKLY_EXECUTIVE_FACTUAL_REPORT_SHAPE,
  buildLarkWeeklyExecutiveFactualReport,
  parseLarkWeeklyExecutiveFactualReport,
  renderLarkWeeklyExecutiveChannelSections,
  serializeLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';

const PERIOD = Object.freeze({
  periodStart: '2026-07-25',
  periodEnd: '2026-07-31',
  compareStart: '2026-07-18',
  compareEnd: '2026-07-24',
  comparisonMode: 'previous_period',
});

function metaBundle() {
  return {
    channelKey: 'meta_ads',
    reportId: 'report-meta-7d',
    payload: { dataStatus: 'complete' },
    metricValues: [
      {
        metric_key: 'meta_ads:clicks', display_name: 'Clicks', current_value: 4553,
        compare_value: null, change_percent: null, unit: 'count',
        availability_status: 'available', metric_scope: 'period_delta', dimension_type: 'summary', rank: 1,
      },
      {
        metric_key: 'meta_ads:impressions', display_name: 'Impressions', current_value: 582054,
        compare_value: null, change_percent: null, unit: 'count',
        availability_status: 'available', metric_scope: 'period_delta', dimension_type: 'summary', rank: 2,
      },
      {
        metric_key: 'hidden_dimension', display_name: 'Hidden', current_value: 999,
        unit: 'count', availability_status: 'available', metric_scope: 'period_delta', dimension_type: 'campaign', rank: 3,
      },
    ],
    topContent: [],
    topAds: [{
      rank: 1,
      external_ad_id: 'ad-1',
      ad_name: '(01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา',
      currency: 'THB',
      spend_micros: 1200000000,
      clicks: 4553,
      impressions: 582054,
      conversions: 42,
      conversion_value_micros: 4800000000,
      cpc_micros: 263562,
      cpa_micros: 28571429,
      roas: 4,
      ctr: 0,
      data_status: 'complete',
    }, {
      rank: 2,
      external_ad_id: 'ad-2',
      ad_name: 'Creative B',
      currency: 'THB',
      spend_micros: 900000000,
      clicks: 1400,
      impressions: 260000,
      conversions: 5,
      conversion_value_micros: 700000000,
      cpc_micros: 642857,
      cpa_micros: 180000000,
      roas: 0.78,
      data_status: 'complete',
    }],
  };
}

function organicBundle(channelKey) {
  const prefix = channelKey === 'facebook_organic' ? 'facebook' : 'instagram';
  return {
    channelKey,
    reportId: `report-${prefix}-7d`,
    payload: { dataStatus: channelKey === 'facebook_organic' ? 'complete' : 'partial' },
    metricValues: [
      {
        metric_key: `${prefix}:period_views`, display_name: 'Views', current_value: 125000,
        compare_value: 100000, change_percent: 0.25, unit: 'count',
        availability_status: 'available', metric_scope: 'period_delta', dimension_type: 'summary', rank: 1,
      },
      {
        metric_key: `${prefix}:period_likes`, display_name: 'Likes', current_value: 2400,
        unit: 'count', availability_status: 'available', metric_scope: 'period_delta', dimension_type: 'summary', rank: 2,
      },
      {
        metric_key: `${prefix}:latest_total_views`, display_name: 'Latest total views', current_value: 900000,
        unit: 'count', availability_status: 'available', metric_scope: 'current_total', dimension_type: 'summary', rank: 1,
      },
    ],
    topContent: [],
    topAds: [],
  };
}

function wooBundle() {
  return {
    channelKey: 'woocommerce',
    reportId: 'report-woo-7d',
    payload: { dataStatus: 'revisable' },
    metricValues: [
      {
        metric_key: 'woocommerce:net_sales_micros', display_name: 'Net sales', current_value: 125000000000,
        compare_value: 100000000000, change_percent: 0.25, unit: 'currency',
        availability_status: 'available', metric_scope: 'period_delta', dimension_type: 'summary', rank: 1,
      },
      {
        metric_key: 'woocommerce:gross_sales_micros', display_name: 'Gross sales', current_value: 140000000000,
        unit: 'currency', availability_status: 'available', metric_scope: 'period_delta', dimension_type: 'summary', rank: 2,
      },
      {
        metric_key: 'woocommerce:dimension:product:net_sales_micros:rank:1', display_name: 'Top product', current_value: 99000000000,
        unit: 'currency', availability_status: 'available', metric_scope: 'period_delta', dimension_type: 'product', rank: 1,
      },
    ],
    topContent: [],
    topAds: [],
  };
}

test('full-channel factual report always preserves all nine channels in reviewed order', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({ targetPeriod: PERIOD, reportBundles: [metaBundle()] });
  assert.equal(report.evidenceShape, LARK_WEEKLY_EXECUTIVE_FACTUAL_REPORT_SHAPE);
  assert.equal(report.evidenceShape, 'executive_notification_full_channel_v4');
  assert.equal(report.channelCount, 9);
  assert.equal(report.businessFactChannelCount, 1);
  assert.deepEqual(report.channels.map(({ channelKey }) => channelKey), [
    'tiktok_organic', 'facebook_organic', 'instagram_organic', 'youtube_organic',
    'meta_ads', 'google_ads', 'tiktok_ads', 'woocommerce', 'chatwoot',
  ]);
});

test('period_delta and current_total are business-safe scopes but period facts are prioritized', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [organicBundle('facebook_organic'), organicBundle('instagram_organic')],
  });
  assert.equal(report.businessFactChannelCount, 2);
  for (const key of ['facebook_organic', 'instagram_organic']) {
    const channel = report.channels.find(({ channelKey }) => channelKey === key);
    assert.equal(channel.hasBusinessFacts, true);
    assert.equal(channel.metrics[0].metricKey.endsWith(':period_views'), true);
    assert.equal(channel.metrics[1].metricKey.endsWith(':period_likes'), true);
    assert.equal(channel.metrics[2].metricKey.endsWith(':latest_total_views'), true);
  }
});

test('WooCommerce summary period metrics are admitted while dimension-ranked rows remain excluded', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({ targetPeriod: PERIOD, reportBundles: [wooBundle()] });
  const woo = report.channels.find(({ channelKey }) => channelKey === 'woocommerce');
  assert.equal(woo.hasBusinessFacts, true);
  assert.deepEqual(woo.metrics.map(({ metricKey }) => metricKey), [
    'woocommerce:net_sales_micros',
    'woocommerce:gross_sales_micros',
  ]);
  const section = renderLarkWeeklyExecutiveChannelSections(report).find(({ channelKey }) => channelKey === 'woocommerce');
  assert.ok(section.lines.some((line) => line.includes('125,000')));
  assert.equal(section.lines.some((line) => line.includes('Top product')), false);
});

test('channel rendering formats real facts and explicitly renders missing channels', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({ targetPeriod: PERIOD, reportBundles: [metaBundle()] });
  const sections = renderLarkWeeklyExecutiveChannelSections(report);
  assert.equal(sections.length, 9);
  assert.deepEqual(sections[0].lines, ['ยังไม่พบข้อมูลสำหรับช่วงนี้']);
  const meta = sections.find(({ channelKey }) => channelKey === 'meta_ads');
  assert.ok(meta.lines.some((line) => line.includes('4,553')));
  assert.ok(meta.lines.some((line) => line.includes('582,054')));
  assert.ok(meta.lines.some((line) => line.includes('CTR 0.78%')));
  assert.ok(meta.lines.some((line) => line.includes('ROAS 4')));
  assert.ok(meta.lines.some((line) => line.includes('Ad #2: Creative B')));
  assert.equal(meta.lines.some((line) => line.includes('Hidden')), false);
});

test('factual report preserves multiple organic candidates and decision metrics', () => {
  const bundle = organicBundle('facebook_organic');
  bundle.topContent = [
    { rank: 1, external_content_id: 'post-1', caption: 'สูตรแก้โจทย์เคมีใน 30 วิ', period_views: 150000, period_likes: 8000, period_comments: 300, period_shares: 1200, period_engagement: 9500, period_engagement_rate: 6.33, performance_status: 'winner', data_status: 'complete' },
    { rank: 2, external_content_id: 'post-2', caption: 'ก่อนสอบต้องรู้ 5 ข้อนี้', period_views: 120000, period_likes: 6000, period_comments: 220, period_shares: 900, period_engagement: 7120, period_engagement_rate: 5.93, data_status: 'complete' },
    { rank: 3, external_content_id: 'post-3', caption: 'สรุปกรดเบสในหนึ่งนาที', period_views: 90000, period_engagement: 4800, period_engagement_rate: 5.33, data_status: 'complete' },
    { rank: 4, external_content_id: 'post-4', caption: 'โจทย์ท้ายบท', period_views: 60000, period_engagement: 2100, period_engagement_rate: 3.5, data_status: 'complete' },
  ];
  const report = buildLarkWeeklyExecutiveFactualReport({ targetPeriod: PERIOD, reportBundles: [bundle] });
  const facebook = report.channels.find(({ channelKey }) => channelKey === 'facebook_organic');
  assert.equal(facebook.contentCandidates.length, 4);
  assert.equal(facebook.topContent.caption, 'สูตรแก้โจทย์เคมีใน 30 วิ');
  assert.equal(facebook.contentCandidates[0].periodShares, 1200);
  assert.equal(facebook.contentCandidates[0].performanceStatus, 'winner');
  const rendered = renderLarkWeeklyExecutiveChannelSections(report).find(({ channelKey }) => channelKey === 'facebook_organic');
  assert.ok(rendered.lines.some((line) => line.includes('Content #1: สูตรแก้โจทย์เคมีใน 30 วิ')));
  assert.ok(rendered.lines.some((line) => line.includes('Shares 1,200')));
  assert.equal(rendered.lines.some((line) => line.includes('Content #4')), false);
});

test('currency micros are presentation-scaled without changing canonical current or compare values', () => {
  const bundle = metaBundle();
  bundle.metricValues = [{
    metric_key: 'meta_ads:spend_micros', display_name: 'Spend', current_value: 807690000000,
    compare_value: 700000000000, change_percent: null, unit: 'currency',
    availability_status: 'available', metric_scope: 'period_delta', dimension_type: 'summary', rank: 1,
  }];
  const report = buildLarkWeeklyExecutiveFactualReport({ targetPeriod: PERIOD, reportBundles: [bundle] });
  const meta = report.channels.find(({ channelKey }) => channelKey === 'meta_ads');
  assert.equal(meta.metrics[0].currentValue, 807690000000);
  assert.equal(meta.metrics[0].displayValue, 807690);
  assert.equal(meta.metrics[0].compareValue, 700000000000);
  const rendered = renderLarkWeeklyExecutiveChannelSections(report).find(({ channelKey }) => channelKey === 'meta_ads');
  assert.ok(rendered.lines.some((line) => line.includes('807,690')));
  assert.ok(rendered.lines.some((line) => line.includes('+15.38% เทียบช่วงก่อน')));
  assert.equal(rendered.lines.some((line) => line.includes('807,690,000,000')), false);
});

test('raw contradictory ad CTR is ignored and full paid decision metrics are preserved', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({ targetPeriod: PERIOD, reportBundles: [metaBundle()] });
  const meta = report.channels.find(({ channelKey }) => channelKey === 'meta_ads');
  assert.equal(meta.topAd.derivedCtrPercent, 0.78223);
  assert.equal(meta.adCandidates.length, 2);
  assert.equal(meta.topAd.conversions, 42);
  assert.equal(meta.topAd.conversionValueMicros, 4800000000);
  assert.equal(meta.topAd.cpaMicros, 28571429);
  assert.equal(meta.topAd.roas, 4);
});

test('serialization round-trips exact bounded factual report', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [organicBundle('facebook_organic'), metaBundle(), wooBundle()],
  });
  const json = serializeLarkWeeklyExecutiveFactualReport(report);
  const parsed = parseLarkWeeklyExecutiveFactualReport(json);
  assert.equal(parsed.channelCount, 9);
  assert.equal(parsed.businessFactChannelCount, 3);
  assert.deepEqual(parsed.sourceReportIds, ['report-facebook-7d', 'report-meta-7d', 'report-woo-7d']);
  assert.equal(parsed.channels.find(({ channelKey }) => channelKey === 'meta_ads').adCandidates.length, 2);
});

test('placeholder Top Content and Top Ads never become business facts', () => {
  const bundle = metaBundle();
  bundle.metricValues = [];
  bundle.topContent = [{ rank: 1, caption: 'ไม่มีข้อมูล', content_url: 'https://invalid.example/', data_status: 'no_data' }];
  bundle.topAds = [{ rank: 1, external_ad_id: 'no_data_1', ad_name: 'ไม่มีข้อมูล', data_status: 'no_data' }];
  const report = buildLarkWeeklyExecutiveFactualReport({ targetPeriod: PERIOD, reportBundles: [bundle] });
  const meta = report.channels.find(({ channelKey }) => channelKey === 'meta_ads');
  assert.equal(meta.hasBusinessFacts, false);
  assert.deepEqual(renderLarkWeeklyExecutiveChannelSections(report)
    .find(({ channelKey }) => channelKey === 'meta_ads').lines, ['ยังไม่พบข้อมูลสำหรับช่วงนี้']);
});
