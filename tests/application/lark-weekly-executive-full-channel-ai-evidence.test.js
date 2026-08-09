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
      bundle('facebook_organic', [metric('facebook:account_followers', 'Followers', 181083, null)], {
        topContent: [{
          rank: 1,
          external_content_id: 'fb-post-1',
          caption: 'สูตรแก้โจทย์เคมีใน 30 วิ',
          period_views: 150000,
          period_likes: 8000,
          period_comments: 300,
          period_shares: 1200,
          period_engagement: 9500,
          period_engagement_rate: 6.33,
          performance_status: 'winner',
          data_status: 'complete',
        }, {
          rank: 2,
          external_content_id: 'fb-post-2',
          caption: 'ก่อนสอบต้องรู้ 5 ข้อนี้',
          period_views: 120000,
          period_engagement: 7100,
          period_engagement_rate: 5.92,
          data_status: 'complete',
        }],
      }),
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
          ad_name: '(01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา',
          spend_micros: 1200000000,
          clicks: 4553,
          impressions: 582054,
          conversions: 42,
          conversion_value_micros: 4800000000,
          cpc_micros: 263562,
          cpa_micros: 28571429,
          roas: 4,
          data_status: 'complete',
        }, {
          rank: 2,
          external_ad_id: 'ad-2',
          ad_name: 'Creative B',
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

test('full-channel AI evidence keeps signals plus multiple content and paid decision candidates', () => {
  const report = factualReport();
  const statusVector = JSON.stringify(report.channels.map(({ channelKey }) => ({ channelKey })));
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: statusVector,
  });
  const summary = JSON.parse(built.metricSummaryJson);
  assert.equal(summary.promptShape, LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE);
  assert.equal(summary.promptShape, 'lark_ai_executive_decision_v1');
  assert.equal(summary.evidenceShape, 'executive_decision_v1');
  assert.equal(built.evidence.businessEvidenceChannelCount, 4);
  assert.equal(built.evidence.comparisonEvidenceChannelCount, 2);
  assert.ok(built.evidence.positiveComparisonChannelNames.includes('Meta Ads'));
  assert.ok(built.evidence.negativeComparisonChannelNames.includes('Meta Ads'));
  assert.ok(built.evidence.negativeComparisonChannelNames.includes('WooCommerce'));
  assert.ok(built.evidence.positiveComparisonMetricNames.includes('การแสดงผล'));
  assert.ok(built.evidence.negativeComparisonMetricNames.includes('การคลิก'));
  assert.ok(built.evidence.neutralComparisonMetricNames.includes('ค่าใช้จ่าย'));
  assert.ok(built.evidence.contentCandidateNames.includes('สูตรแก้โจทย์เคมีใน 30 วิ'));
  assert.ok(built.evidence.adCandidateNames.includes('(01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา'));
  assert.ok(built.evidence.scaleEvidenceAdNames.includes('(01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา'));
  assert.equal(built.evidence.funnelDivergences[0].type, 'awareness_up_outcome_down');
  assert.equal(built.evidence.organicPaidMappingAvailable, false);
  assert.ok(built.metricSummaryChars <= 8000);

  const facebook = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'facebook_organic');
  const instagram = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'instagram_organic');
  const meta = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'meta_ads');
  const woo = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'woocommerce');
  assert.equal(facebook.availableMetrics[0].display_name, 'ผู้ติดตาม');
  assert.equal(facebook.contentCandidates.length, 2);
  assert.equal(facebook.contentCandidates[0].shares, 1200);
  assert.equal(facebook.contentCandidates[0].engagement_rate, 6.33);
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
  assert.equal(meta.adCandidates.length, 2);
  assert.equal(meta.adCandidates[0].derived_ctr_percent, 0.78223);
  assert.equal(meta.adCandidates[0].conversion_value, 4800);
  assert.equal(meta.adCandidates[0].cpa, 28.5714);
  assert.equal(meta.adCandidates[0].roas, 4);
  assert.equal(woo.availableMetrics[0].display_name, 'ยอดขายสุทธิ');
  assert.equal(woo.availableMetrics[1].display_name, 'ยอดขายรวม');
  assert.equal(woo.availableMetrics[0].current_value, 168010);
  assert.ok(Math.abs(woo.availableMetrics[0].change_percent + 33) < 0.01);
  assert.match(summary.writerContract.recommendations, /\[SCALE\]/u);
  assert.match(summary.writerContract.recommendations, /ห้าม \[SCALE\]/u);
  assert.match(summary.writerContract.funnelDecision, /สวนทาง/u);
});

test('executive decision quality requires named content, named paid action and funnel divergence', () => {
  const report = factualReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: JSON.stringify(report.channels.map(({ channelKey }) => ({ channelKey }))),
  });
  const accepted = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 17,742.8 และ WooCommerce มียอดขายสุทธิ 168,010 ในสัปดาห์นี้ โดยการมองเห็นโตแต่ผลปลาย Funnel อ่อนลง',
    strengths: 'Meta Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'WooCommerce มียอดขายสุทธิลดลงเมื่อเทียบกับช่วงก่อน และ Meta Ads มีการคลิกลดลงเมื่อเทียบกับช่วงก่อน',
    recommendations: '[CONTENT] สูตรแก้โจทย์เคมีใน 30 วิ เป็น Organic winner ให้ทำคอนเทนต์แนวเดียวกันเพิ่มและใช้ [TEST] ทดสอบ Paid แบบจำกัดงบจาก Views 150,000 และ ER 6.33%\n[SCALE] (01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา เพิ่มงบแบบควบคุมเฉพาะตัวจาก Conversions 42 และ ROAS 4\n[NO-SCALE] ภาพรวมการแสดงผลเพิ่มแต่การคลิกและยอดขายสุทธิลดลง จึงยังไม่เพิ่มงบรวมจนกว่าปลาย Funnel ฟื้น',
  }, built.evidence);
  assert.deepEqual(accepted, { passed: true, violations: [] });

  const vague = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 17,742.8 และ WooCommerce มียอดขายสุทธิ 168,010 ในสัปดาห์นี้',
    strengths: 'Meta Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'WooCommerce มียอดขายสุทธิลดลงเมื่อเทียบกับช่วงก่อน และ Meta Ads มีการคลิกลดลงเมื่อเทียบกับช่วงก่อน',
    recommendations: 'ทบทวนครีเอทีฟและติดตามยอดขายในสัปดาห์หน้า',
  }, built.evidence);
  assert.equal(vague.passed, false);
  assert.ok(vague.violations.includes('recommendations_missing_decision_actions'));
  assert.ok(vague.violations.includes('recommendations_missing_content_action'));
  assert.ok(vague.violations.includes('recommendations_missing_paid_action'));
  assert.ok(vague.violations.includes('recommendations_missing_funnel_divergence'));
});

test('quality blocks unsupported scale and fabricated Organic-to-Paid identity claims', () => {
  const report = factualReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: JSON.stringify(report.channels.map(({ channelKey }) => ({ channelKey }))),
  });
  const evidenceWithoutScale = Object.freeze({ ...built.evidence, scaleEvidenceAdNames: Object.freeze([]) });
  const unsupportedScale = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 17,742.8 และ WooCommerce มียอดขายสุทธิ 168,010',
    strengths: 'Meta Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'WooCommerce มียอดขายสุทธิลดลงเมื่อเทียบกับช่วงก่อน และ Meta Ads มีการคลิกลดลงเมื่อเทียบกับช่วงก่อน',
    recommendations: '[CONTENT] สูตรแก้โจทย์เคมีใน 30 วิ ใช้ [TEST] ทดลอง Paid\n[SCALE] Creative B เพิ่มงบทันที\n[NO-SCALE] การแสดงผลเพิ่มแต่การคลิกและยอดขายสุทธิลดลง',
  }, evidenceWithoutScale);
  assert.equal(unsupportedScale.passed, false);
  assert.ok(unsupportedScale.violations.includes('recommendations_unsupported_scale'));

  const fabricatedLinkage = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 17,742.8 และ WooCommerce มียอดขายสุทธิ 168,010',
    strengths: 'Meta Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'WooCommerce มียอดขายสุทธิลดลงเมื่อเทียบกับช่วงก่อน และ Meta Ads มีการคลิกลดลงเมื่อเทียบกับช่วงก่อน',
    recommendations: '[CONTENT] สูตรแก้โจทย์เคมีใน 30 วิ คือโพสต์เดียวกันกับโฆษณา (01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา ให้ [TEST] ต่อ\n[NO-SCALE] การแสดงผลเพิ่มแต่การคลิกและยอดขายสุทธิลดลง',
  }, built.evidence);
  assert.equal(fabricatedLinkage.passed, false);
  assert.ok(fabricatedLinkage.violations.includes('recommendations_fabricated_organic_paid_linkage'));
});

test('full-channel AI quality still requires positive metric strength and negative metric weakness', () => {
  const report = factualReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: JSON.stringify(report.channels.map(({ channelKey }) => ({ channelKey }))),
  });
  const neutralStrength = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 17,742.8 และ WooCommerce มียอดขายสุทธิ 168,010 ในสัปดาห์นี้',
    strengths: 'Meta Ads มีค่าใช้จ่ายเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'WooCommerce มียอดขายสุทธิลดลงเมื่อเทียบกับช่วงก่อน',
    recommendations: '[CONTENT] สูตรแก้โจทย์เคมีใน 30 วิ ใช้ [TEST] ทดลอง Paid\n[KEEP] Creative B คงไว้ดูผล\n[NO-SCALE] การแสดงผลเพิ่มแต่การคลิกและยอดขายสุทธิลดลง',
  }, built.evidence);
  assert.equal(neutralStrength.passed, false);
  assert.ok(neutralStrength.violations.includes('strengths_missing_positive_metric'));
  assert.ok(neutralStrength.violations.includes('strengths_contains_neutral_metric'));

  const stale = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads ใช้งบ 17,742.8 ในสัปดาห์นี้',
    strengths: 'ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน',
    weaknesses: 'ยังไม่พบสัญญาณด้านผลงานที่ควรระวังจากข้อมูลที่มี',
    recommendations: '[CONTENT] สูตรแก้โจทย์เคมีใน 30 วิ ใช้ [TEST] ทดลอง Paid\n[KEEP] Creative B คงไว้\n[NO-SCALE] การแสดงผลเพิ่มแต่การคลิกและยอดขายสุทธิลดลง',
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
    recommendations: '[CONTENT] สูตรแก้โจทย์เคมีใน 30 วิ ใช้ [TEST] ทดลอง Paid\n[KEEP] Creative B คงไว้\n[NO-SCALE] การแสดงผลเพิ่มแต่การคลิกและยอดขายสุทธิลดลง',
  }, built.evidence);
  assert.equal(internalFields.passed, false);
  assert.ok(internalFields.violations.includes('internal_metric_field_language'));

  const awkwardWording = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีความทบทวนหน้า 3,025,762 ครั้ง และ WooCommerce มียอดขายสุทธิ 168,010 พร้อมการเปรียบเทียบ',
    strengths: 'Meta Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'WooCommerce มียอดขายสุทธิลดลงเมื่อเปรียบเทียบกับค่าเปรียบเทียบ',
    recommendations: '[CONTENT] สูตรแก้โจทย์เคมีใน 30 วิ ใช้ [TEST] ตามข้อมูลการเปรียบเทียบที่มี\n[KEEP] Creative B คงไว้\n[NO-SCALE] การแสดงผลเพิ่มแต่การคลิกและยอดขายสุทธิลดลง',
  }, built.evidence);
  assert.equal(awkwardWording.passed, false);
  assert.ok(awkwardWording.violations.includes('non_business_metric_language'));
  assert.ok(awkwardWording.violations.includes('non_executive_comparison_language'));
});
