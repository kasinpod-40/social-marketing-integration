import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkWeeklyExecutiveFactualReport,
  renderLarkWeeklyExecutiveChannelSections,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE,
  buildLarkWeeklyExecutiveFullChannelAiEvidence,
  validateLarkWeeklyExecutiveFullChannelAiOutputs,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';

const PERIOD = Object.freeze({
  periodStart: '2026-07-25',
  periodEnd: '2026-07-31',
  compareStart: '2026-07-18',
  compareEnd: '2026-07-24',
  comparisonMode: 'previous_period',
});

function metric(metricKey, displayName, current, compare, unit = 'count', rank = 1, rawChangePercent = null) {
  return {
    metric_key: metricKey,
    display_name: displayName,
    current_value: current,
    compare_value: compare,
    change_percent: rawChangePercent,
    unit,
    availability_status: 'available',
    metric_scope: 'period_delta',
    dimension_type: 'summary',
    rank,
  };
}

function bundle(channelKey, metricValues, extra = {}) {
  return {
    channelKey,
    reportId: `report-${channelKey}`,
    payload: { dataStatus: 'complete' },
    metricValues,
    topContent: [],
    topAds: [],
    ...extra,
  };
}

function factualReport() {
  return buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [
      bundle('facebook_organic', [metric('facebook:account_followers', 'Followers', 181083, null)]),
      bundle('instagram_organic', [
        metric('instagram:account_views', 'Account views', 8789578, null, 'count', 1),
        metric('instagram:account_reach', 'Account reach', 2074657, null, 'count', 2),
      ]),
      bundle('meta_ads', [
        metric('meta_ads:spend_micros', 'Spend', 17742800000, 16582000000, 'currency', 1, 0.0007),
        metric('meta_ads:impressions', 'Impressions', 3025762, 2909329, 'count', 2, 999),
        metric('meta_ads:reach', 'Reach', 2640585, 2543100, 'count', 3, 999),
        metric('meta_ads:clicks', 'Clicks', 38627, 43401, 'count', 4, -0.11),
      ], {
        topAds: [{
          rank: 1,
          external_ad_id: 'ad-1',
          ad_name: 'Campaign X',
          clicks: 4553,
          impressions: 582054,
          data_status: 'complete',
        }],
      }),
      bundle('woocommerce', [
        metric('woocommerce:net_sales_micros', 'Net sales', 168010000000, 250761000000, 'currency', 1, -0.0033),
        metric('woocommerce:gross_sales_micros', 'Gross sales', 170210000000, 253995000000, 'currency', 2, -99),
      ]),
    ],
  });
}

test('weekly factual rendering derives percentage points from canonical current and compare values', () => {
  const report = factualReport();
  const sections = renderLarkWeeklyExecutiveChannelSections(report);
  const meta = sections.find(({ channelKey }) => channelKey === 'meta_ads');
  const woo = sections.find(({ channelKey }) => channelKey === 'woocommerce');
  assert.ok(meta.lines.some((line) => line.includes('Spend: 17,742.8 (+7% เทียบช่วงก่อน)')));
  assert.ok(meta.lines.some((line) => line.includes('Impressions: 3,025,762 (+4% เทียบช่วงก่อน)')));
  assert.ok(meta.lines.some((line) => line.includes('Clicks: 38,627 (-11% เทียบช่วงก่อน)')));
  assert.ok(woo.lines.some((line) => line.includes('Net sales: 168,010 (-33% เทียบช่วงก่อน)')));
  assert.equal(meta.lines.some((line) => line.includes('+0.07%')), false);
  assert.equal(woo.lines.some((line) => line.includes('-0.33%')), false);
});

test('zero comparison never produces infinity or a fabricated percentage', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [bundle('woocommerce', [
      metric('woocommerce:refunds_micros', 'Refunds', 0, 0, 'currency', 1, 123),
    ])],
  });
  const line = renderLarkWeeklyExecutiveChannelSections(report)
    .find(({ channelKey }) => channelKey === 'woocommerce').lines[0];
  assert.match(line, /Refunds: 0 \(ช่วงก่อน 0\)/u);
  assert.doesNotMatch(line, /Infinity|NaN|123%/u);
});

test('full-channel AI evidence keeps neutral context plus strongest positive and negative signals', () => {
  const report = factualReport();
  const statusVector = JSON.stringify(report.channels.map(({ channelKey }) => ({ channelKey })));
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: statusVector,
  });
  const summary = JSON.parse(built.metricSummaryJson);
  assert.equal(summary.promptShape, LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE);
  assert.equal(built.evidence.businessEvidenceChannelCount, 4);
  assert.equal(built.evidence.comparisonEvidenceChannelCount, 2);
  assert.ok(built.evidence.positiveComparisonChannelNames.includes('Meta Ads'));
  assert.ok(built.evidence.negativeComparisonChannelNames.includes('Meta Ads'));
  assert.ok(built.evidence.negativeComparisonChannelNames.includes('WooCommerce'));
  assert.ok(built.evidence.positiveComparisonMetricNames.includes('การแสดงผล'));
  assert.ok(built.evidence.negativeComparisonMetricNames.includes('การคลิก'));
  assert.ok(built.evidence.neutralComparisonMetricNames.includes('ค่าใช้จ่าย'));
  assert.ok(built.metricSummaryChars <= 4000);

  const facebook = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'facebook_organic');
  const instagram = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'instagram_organic');
  const meta = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'meta_ads');
  const woo = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'woocommerce');
  assert.equal(facebook.availableMetrics[0].display_name, 'ผู้ติดตาม');
  assert.equal(instagram.availableMetrics[0].display_name, 'ยอดดู');
  assert.equal(instagram.availableMetrics[1].display_name, 'การเข้าถึง');
  assert.deepEqual(
    meta.availableMetrics.map(({ metric_key }) => metric_key),
    ['meta_ads:spend_micros', 'meta_ads:impressions', 'meta_ads:clicks'],
  );
  assert.deepEqual(
    meta.availableMetrics.map(({ signal }) => signal),
    ['neutral', 'positive', 'negative'],
  );
  assert.equal(meta.availableMetrics[0].current_value, 17742.8);
  assert.ok(Math.abs(meta.availableMetrics[0].change_percent - 7) < 0.01);
  assert.equal(meta.availableMetrics[2].display_name, 'การคลิก');
  assert.ok(Math.abs(meta.availableMetrics[2].change_percent + 11) < 0.1);
  assert.equal(woo.availableMetrics[0].display_name, 'ยอดขายสุทธิ');
  assert.equal(woo.availableMetrics[1].display_name, 'ยอดขายรวม');
  assert.equal(woo.availableMetrics[0].current_value, 168010);
  assert.ok(Math.abs(woo.availableMetrics[0].change_percent + 33) < 0.01);
  assert.equal(meta.topAds[0].derived_ctr_percent, 0.78223);
  assert.match(summary.writerContract.language, /display_name/u);
  assert.match(summary.writerContract.strengths, /signal=positive/u);
  assert.match(summary.writerContract.comparison, /เทียบช่วงก่อน/u);
});

test('full-channel AI quality requires positive metric strength and negative metric weakness', () => {
  const report = factualReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: JSON.stringify(report.channels.map(({ channelKey }) => ({ channelKey }))),
  });
  const accepted = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 17,742.8 และ WooCommerce มียอดขายสุทธิ 168,010 ในสัปดาห์นี้ โดยผลของสองช่องทางเคลื่อนไหวต่างทิศทางกัน',
    strengths: 'Meta Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'WooCommerce มียอดขายสุทธิลดลงเมื่อเทียบกับช่วงก่อน และ Meta Ads มีการคลิกลดลงเมื่อเทียบกับช่วงก่อน',
    recommendations: '- ทบทวนครีเอทีฟและเส้นทางโฆษณาที่ทำให้จำนวนคลิกอ่อนลง พร้อมวางแผนกิจกรรมการขายเพื่อฟื้นยอด WooCommerce สัปดาห์ถัดไป',
  }, built.evidence);
  assert.deepEqual(accepted, { passed: true, violations: [] });

  const neutralStrength = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 17,742.8 และ WooCommerce มียอดขายสุทธิ 168,010 ในสัปดาห์นี้',
    strengths: 'Meta Ads มีค่าใช้จ่ายเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'WooCommerce มียอดขายสุทธิลดลงเมื่อเทียบกับช่วงก่อน',
    recommendations: '- ทบทวนครีเอทีฟและยอดขาย WooCommerce สัปดาห์ถัดไป',
  }, built.evidence);
  assert.equal(neutralStrength.passed, false);
  assert.ok(neutralStrength.violations.includes('strengths_missing_positive_metric'));
  assert.ok(neutralStrength.violations.includes('strengths_contains_neutral_metric'));

  const stale = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads ใช้งบ 17,742.8 ในสัปดาห์นี้',
    strengths: 'ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน',
    weaknesses: 'ยังไม่พบสัญญาณด้านผลงานที่ควรระวังจากข้อมูลที่มี',
    recommendations: '- คำนวณ CTR และ CPC จากข้อมูลโฆษณาที่มี แล้วใช้เป็น baseline เทียบกับสัปดาห์ถัดไป',
  }, built.evidence);
  assert.equal(stale.passed, false);
  assert.ok(stale.violations.includes('insight_missing_cross_channel_coverage'));
  assert.ok(stale.violations.includes('strengths_ignored_positive_comparison'));
  assert.ok(stale.violations.includes('weaknesses_ignored_negative_comparison'));
});

test('full-channel AI quality rejects internal fields and non-executive comparison wording', () => {
  const report = factualReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: JSON.stringify(report.channels.map(({ channelKey }) => ({ channelKey }))),
  });
  const internalFields = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 17,742.8 และ WooCommerce มียอดขายสุทธิ 168,010',
    strengths: 'Meta Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'WooCommerce มี change_percent ลดลงจาก compare_value 250310',
    recommendations: '- ทบทวนครีเอทีฟและยอดขาย WooCommerce สัปดาห์ถัดไป',
  }, built.evidence);
  assert.equal(internalFields.passed, false);
  assert.ok(internalFields.violations.includes('internal_metric_field_language'));

  const awkwardWording = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีความทบทวนหน้า 3,025,762 ครั้ง และ WooCommerce มียอดขายสุทธิ 168,010 พร้อมการเปรียบเทียบ',
    strengths: 'Meta Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'WooCommerce มียอดขายสุทธิลดลงเมื่อเปรียบเทียบกับค่าเปรียบเทียบ',
    recommendations: '- ติดตามยอดขายตามข้อมูลการเปรียบเทียบที่มี',
  }, built.evidence);
  assert.equal(awkwardWording.passed, false);
  assert.ok(awkwardWording.violations.includes('non_business_metric_language'));
  assert.ok(awkwardWording.violations.includes('non_executive_comparison_language'));
});
