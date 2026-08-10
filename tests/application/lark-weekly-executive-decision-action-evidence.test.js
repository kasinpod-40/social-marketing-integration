import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkWeeklyExecutiveFullChannelAiEvidence,
  validateLarkWeeklyExecutiveFullChannelAiOutputs,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';

const PERIOD = Object.freeze({
  periodStart: '2026-08-03',
  periodEnd: '2026-08-09',
  compareStart: '2026-07-27',
  compareEnd: '2026-08-02',
  comparisonMode: 'previous_period',
});

function metric(metricKey, displayName, current, compare, unit = 'count', rank = 1) {
  return {
    metric_key: metricKey,
    display_name: displayName,
    current_value: current,
    compare_value: compare,
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

function statusVector(report) {
  return JSON.stringify(report.channels.map(({ channelKey }) => ({
    channelKey,
    readinessStatus: 'report_ready',
  })));
}

function currentDecisionReport() {
  return buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [
      bundle('meta_ads', [
        metric('meta_ads:spend_micros', 'Spend', 2857350000, 12876000000, 'currency', 1),
        metric('meta_ads:impressions', 'Impressions', 406054, 2308430, 'count', 2),
        metric('meta_ads:reach', 'Reach', 366805, 2016677, 'count', 3),
      ], {
        topAds: [{
          rank: 1,
          external_ad_id: 'meta-ad-1',
          ad_name: 'Sale M.5/1 02',
          spend_micros: 122500000,
          clicks: 57,
          impressions: 4352,
          conversions: null,
          conversion_value_micros: null,
          cpc_micros: 2150000,
          cpa_micros: null,
          roas: null,
          data_status: 'complete',
        }],
      }),
      bundle('google_ads', [
        metric('google_ads:spend_micros', 'Spend', 8446395000, 7771000000, 'currency', 1),
        metric('google_ads:impressions', 'Impressions', 274173, 211421, 'count', 2),
        metric('google_ads:clicks', 'Clicks', 3035, 4330, 'count', 3),
        metric('google_ads:conversions', 'Conversions', 0, 5, 'count', 4),
      ]),
    ],
  });
}

test('detects Thai conversion as lower-funnel divergence and exposes conditional NO-SCALE evidence', () => {
  const report = currentDecisionReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: statusVector(report),
  });
  const summary = JSON.parse(built.metricSummaryJson);

  assert.equal(built.evidence.funnelDivergences.length, 1);
  assert.ok(built.evidence.funnelDivergences[0].positiveFacts.some(({ metric: name }) => name === 'การแสดงผล'));
  assert.ok(built.evidence.funnelDivergences[0].negativeFacts.some(({ metric: name }) => name === 'คอนเวอร์ชัน'));
  assert.deepEqual(summary.funnelMetrics.up, ['การแสดงผล']);
  assert.ok(summary.funnelMetrics.down.includes('คอนเวอร์ชัน'));
  assert.match(summary.writerContract.funnelDecision, /NO-SCALE/u);
  assert.ok(built.metricSummaryChars <= 2800);
});

test('rejects the live bare-label recommendations that previously passed', () => {
  const report = currentDecisionReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: statusVector(report),
  });
  const checked = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 2,857.35 บาท และ Google Ads มีค่าใช้จ่าย 8,446.395 บาท',
    strengths: 'Google Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบช่วงก่อน',
    weaknesses: 'Google Ads มีคอนเวอร์ชันลดลงเมื่อเทียบช่วงก่อน',
    recommendations: '[TEST] Sale M.5/1 02\n[NO-SCALE] broad budget\n[TEST] TikTok Organic\n[TEST] Instagram Organic',
  }, built.evidence);

  assert.equal(checked.passed, false);
  assert.ok(checked.violations.includes('recommendations_missing_action_detail'));
  assert.ok(checked.violations.includes('recommendations_missing_evidence_anchor'));
  assert.ok(checked.violations.includes('recommendations_missing_funnel_divergence'));
});

test('accepts concise actions when each line has a next step and an evidence anchor', () => {
  const report = currentDecisionReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: statusVector(report),
  });
  const checked = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 2,857.35 บาท และ Google Ads มีค่าใช้จ่าย 8,446.395 บาท',
    strengths: 'Google Ads มีการแสดงผลเพิ่มขึ้นเมื่อเทียบช่วงก่อน',
    weaknesses: 'Google Ads มีคอนเวอร์ชันลดลงเมื่อเทียบช่วงก่อน',
    recommendations: '[TEST] Sale M.5/1 02 ทดลองต่อแบบงบจำกัดเพื่อวัดคอนเวอร์ชัน\n[NO-SCALE] Google Ads ยังไม่เพิ่มงบรวม เพราะการแสดงผลเพิ่มขึ้นแต่คอนเวอร์ชันลดลง',
  }, built.evidence);

  assert.deepEqual(checked, { passed: true, violations: [] });
});

test('omits NO-SCALE instructions when no funnel divergence exists', () => {
  const report = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [bundle('meta_ads', [
      metric('meta_ads:spend_micros', 'Spend', 1000000000, null, 'currency', 1),
    ], {
      topAds: [{
        rank: 1,
        external_ad_id: 'meta-ad-1',
        ad_name: 'Sale M.5/1 02',
        spend_micros: 1000000000,
        clicks: 50,
        impressions: 5000,
        conversions: null,
        conversion_value_micros: null,
        cpc_micros: 20000000,
        cpa_micros: null,
        roas: null,
        data_status: 'complete',
      }],
    })],
  });
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: statusVector(report),
  });
  const summary = JSON.parse(built.metricSummaryJson);

  assert.equal(built.evidence.funnelDivergences.length, 0);
  assert.equal(Object.hasOwn(summary, 'funnelMetrics'), false);
  assert.equal(Object.hasOwn(summary.writerContract, 'funnelDecision'), false);

  const checked = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 1,000 บาท',
    strengths: 'ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน',
    weaknesses: 'ยังไม่พบสัญญาณด้านผลงานที่ควรระวังจากข้อมูลที่มี',
    recommendations: '[TEST] Sale M.5/1 02 ทดลองต่อเพื่อวัดผล\n[NO-SCALE] Meta Ads ยังไม่เพิ่มงบรวม',
  }, built.evidence);

  assert.equal(checked.passed, false);
  assert.ok(checked.violations.includes('recommendations_unsupported_no_scale'));
});
