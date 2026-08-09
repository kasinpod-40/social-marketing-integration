import assert from 'node:assert/strict';
import test from 'node:test';

import { diagnoseLarkWeekly7dFactualSource } from '../../scripts/lib/lark-weekly-7d-factual-source-diagnostics.js';

function bundle(channelKey, overrides = {}) {
  return {
    channelKey,
    reportId: `report-${channelKey}`,
    payload: { dataStatus: 'complete' },
    metricValues: [],
    topContent: [],
    topAds: [],
    ...overrides,
  };
}

test('diagnostics preserve all nine channels and distinguish missing source from empty report', () => {
  const result = diagnoseLarkWeekly7dFactualSource({
    reportBundles: [bundle('facebook_organic')],
  });
  assert.equal(result.channelCount, 9);
  assert.equal(result.sourceReportChannelCount, 1);
  assert.equal(result.businessFactChannelCount, 0);
  const facebook = result.channels.find(({ channelKey }) => channelKey === 'facebook_organic');
  const tiktok = result.channels.find(({ channelKey }) => channelKey === 'tiktok_organic');
  assert.equal(facebook.emptyReason, 'report_has_no_fact_rows');
  assert.equal(tiktok.emptyReason, 'source_report_missing');
});

test('diagnostics explain each metric exclusion class and retain bounded samples', () => {
  const result = diagnoseLarkWeekly7dFactualSource({
    reportBundles: [bundle('instagram_organic', {
      metricValues: [
        { metric_key: 'dimensioned', metric_scope: 'summary', dimension_type: 'post', availability_status: 'available', current_value: 10 },
        { metric_key: 'data_quality', metric_scope: 'data_quality', dimension_type: 'summary', availability_status: 'available', current_value: 1 },
        { metric_key: 'unavailable', metric_scope: 'summary', dimension_type: 'summary', availability_status: 'not_available', current_value: null },
        { metric_key: 'null_metric', metric_scope: 'summary', dimension_type: 'summary', availability_status: 'available', current_value: null },
        { metric_key: 'views', metric_scope: 'summary', dimension_type: 'summary', availability_status: 'available', current_value: 125000 },
      ],
    })],
  });
  const ig = result.channels.find(({ channelKey }) => channelKey === 'instagram_organic');
  assert.equal(ig.metricRows, 5);
  assert.equal(ig.usableSummaryMetricRows, 1);
  assert.deepEqual(ig.usableMetricKeys, ['views']);
  assert.deepEqual(ig.rejectedMetricRows, { scope: 1, dimension: 1, availability: 1, nullValue: 1 });
  assert.equal(ig.hasBusinessFacts, true);
  assert.equal(ig.emptyReason, null);
});

test('real Top Content or Top Ads counts as business evidence even with no usable summary metrics', () => {
  const result = diagnoseLarkWeekly7dFactualSource({
    reportBundles: [
      bundle('facebook_organic', {
        topContent: [{ caption: 'โพสต์จริง', content_url: 'https://facebook.com/post/1', data_status: 'complete' }],
      }),
      bundle('meta_ads', {
        topAds: [{ external_ad_id: 'ad-1', ad_name: 'โฆษณาจริง', data_status: 'complete' }],
      }),
    ],
  });
  assert.equal(result.businessFactChannelCount, 2);
  assert.equal(result.channels.find(({ channelKey }) => channelKey === 'facebook_organic').realTopContentRows, 1);
  assert.equal(result.channels.find(({ channelKey }) => channelKey === 'meta_ads').realTopAdsRows, 1);
});

test('placeholder ranking rows are excluded', () => {
  const result = diagnoseLarkWeekly7dFactualSource({
    reportBundles: [bundle('woocommerce', {
      topContent: [{ caption: 'ไม่มีข้อมูล', content_url: 'https://invalid.example/', data_status: 'no_data' }],
      topAds: [{ external_ad_id: 'no_data_1', ad_name: 'ไม่มีข้อมูล', data_status: 'no_data' }],
    })],
  });
  const woo = result.channels.find(({ channelKey }) => channelKey === 'woocommerce');
  assert.equal(woo.realTopContentRows, 0);
  assert.equal(woo.realTopAdsRows, 0);
  assert.equal(woo.hasBusinessFacts, false);
});
