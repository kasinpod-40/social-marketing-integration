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
  periodStart: '2026-07-24',
  periodEnd: '2026-07-30',
  compareStart: null,
  compareEnd: null,
  comparisonMode: 'none',
});

function metaBundle() {
  return {
    channelKey: 'meta_ads',
    reportId: 'report-meta-7d',
    payload: { dataStatus: 'complete' },
    metricValues: [
      {
        metric_key: 'clicks', display_name: 'Clicks', current_value: 4553,
        compare_value: null, change_percent: null, unit: 'count',
        availability_status: 'available', metric_scope: 'summary', dimension_type: 'summary', rank: 1,
      },
      {
        metric_key: 'impressions', display_name: 'Impressions', current_value: 582054,
        compare_value: null, change_percent: null, unit: 'count',
        availability_status: 'available', metric_scope: 'summary', dimension_type: 'summary', rank: 2,
      },
      {
        metric_key: 'hidden_dimension', display_name: 'Hidden', current_value: 999,
        unit: 'count', availability_status: 'available', metric_scope: 'summary', dimension_type: 'campaign', rank: 3,
      },
    ],
    topContent: [],
    topAds: [{
      rank: 1,
      external_ad_id: 'ad-1',
      ad_name: '(01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา',
      clicks: 4553,
      impressions: 582054,
      ctr: 0,
      data_status: 'complete',
    }],
  };
}

test('full-channel factual report always preserves all nine channels in reviewed order', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [metaBundle()],
  });
  assert.equal(report.evidenceShape, LARK_WEEKLY_EXECUTIVE_FACTUAL_REPORT_SHAPE);
  assert.equal(report.channelCount, 9);
  assert.equal(report.businessFactChannelCount, 1);
  assert.deepEqual(report.channels.map(({ channelKey }) => channelKey), [
    'tiktok_organic', 'facebook_organic', 'instagram_organic', 'youtube_organic',
    'meta_ads', 'google_ads', 'tiktok_ads', 'woocommerce', 'chatwoot',
  ]);
  assert.deepEqual(report.sourceReportIds, ['report-meta-7d']);
});

test('channel rendering formats real facts and explicitly renders missing channels', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [metaBundle()],
  });
  const sections = renderLarkWeeklyExecutiveChannelSections(report);
  assert.equal(sections.length, 9);
  assert.deepEqual(sections[0].lines, ['ยังไม่พบข้อมูลสำหรับช่วงนี้']);
  const meta = sections.find(({ channelKey }) => channelKey === 'meta_ads');
  assert.ok(meta.lines.some((line) => line.includes('4,553')));
  assert.ok(meta.lines.some((line) => line.includes('582,054')));
  assert.ok(meta.lines.some((line) => line.includes('CTR 0.78%')));
  assert.equal(meta.lines.some((line) => line.includes('Hidden')), false);
});

test('currency micros are presentation-scaled without changing canonical current value', () => {
  const bundle = metaBundle();
  bundle.metricValues = [{
    metric_key: 'spend_micros', display_name: 'Spend', current_value: 807690000000,
    compare_value: 700000000000, change_percent: null, unit: 'currency',
    availability_status: 'available', metric_scope: 'summary', dimension_type: 'summary', rank: 1,
  }];
  const report = buildLarkWeeklyExecutiveFactualReport({ targetPeriod: PERIOD, reportBundles: [bundle] });
  const meta = report.channels.find(({ channelKey }) => channelKey === 'meta_ads');
  assert.equal(meta.metrics[0].currentValue, 807690000000);
  assert.equal(meta.metrics[0].displayValue, 807690);
  assert.equal(meta.metrics[0].compareValue, 700000);
  const rendered = renderLarkWeeklyExecutiveChannelSections(report)
    .find(({ channelKey }) => channelKey === 'meta_ads');
  assert.ok(rendered.lines.some((line) => line.includes('807,690')));
  assert.equal(rendered.lines.some((line) => line.includes('807,690,000,000')), false);
});

test('raw contradictory ad CTR is ignored in favor of clicks/impressions derived CTR', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [metaBundle()],
  });
  const meta = report.channels.find(({ channelKey }) => channelKey === 'meta_ads');
  assert.equal(meta.topAd.derivedCtrPercent, 0.78223);
});

test('serialization round-trips exact bounded factual report', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [metaBundle()],
  });
  const json = serializeLarkWeeklyExecutiveFactualReport(report);
  const parsed = parseLarkWeeklyExecutiveFactualReport(json);
  assert.equal(parsed.channelCount, 9);
  assert.equal(parsed.businessFactChannelCount, 1);
  assert.deepEqual(parsed.sourceReportIds, ['report-meta-7d']);
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
