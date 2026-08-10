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
    change_percent: null,
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

function paidFunnelReport() {
  return buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [
      bundle('meta_ads', [
        metric('meta_ads:spend_micros', 'Spend', 2857350000, 12876000000, 'currency'),
      ], {
        topAds: [{
          rank: 1,
          external_ad_id: 'meta-ad-1',
          ad_name: 'Sale M.5/1 02',
          spend_micros: 1200000000,
          clicks: 4553,
          impressions: 582054,
          conversions: 12,
          conversion_value_micros: 2400000000,
          cpc_micros: 263562,
          cpa_micros: 100000000,
          roas: 2,
          data_status: 'complete',
        }, {
          rank: 2,
          external_ad_id: 'meta-ad-2',
          ad_name: 'Sale TRI 01',
          spend_micros: 900000000,
          clicks: 1800,
          impressions: 260000,
          conversions: 4,
          conversion_value_micros: 800000000,
          roas: 0.89,
          data_status: 'complete',
        }],
      }),
      bundle('google_ads', [
        metric('google_ads:impressions', 'Impressions', 274173, 211405),
        metric('google_ads:conversions', 'Conversions', 0, 8, 'count', 2),
        metric('google_ads:spend_micros', 'Spend', 8446395000, 8000000000, 'currency', 3),
      ]),
    ],
  });
}

function statusVector(report) {
  return JSON.stringify(report.channels.map(({ channelKey }) => ({
    channelKey,
    readinessStatus: 'report_ready',
  })));
}

test('content-empty paid funnel evidence emits exact decision-ready recommendation blueprints', () => {
  const report = paidFunnelReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: statusVector(report),
  });
  const summary = JSON.parse(built.metricSummaryJson);

  assert.ok(built.metricSummaryChars <= 2800);
  assert.deepEqual(built.evidence.contentCandidateNames, []);
  assert.ok(built.evidence.adCandidateNames.includes('Sale M.5/1 02'));
  assert.equal(built.evidence.funnelDivergences.length, 1);
  assert.match(summary.writerContract.recommendations, /COPY rb exactly/u);
  assert.equal(summary.rb.length, 2);
  assert.match(summary.rb[0], /^\[TEST\] Sale M\.5\/1 02 ทดสอบต่อแบบจำกัดงบ/u);
  assert.match(summary.rb[0], /คอนเวอร์ชัน 12 และ ROAS 2/u);
  assert.match(summary.rb[1], /^\[NO-SCALE\] Google Ads ไม่เพิ่มงบรวม/u);
  assert.match(summary.rb[1], /การแสดงผล \+29\./u);
  assert.match(summary.rb[1], /คอนเวอร์ชัน -100%/u);

  const quality = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 2,857.35 บาท และ Google Ads มีการแสดงผล 274,173 ครั้ง',
    strengths: 'Google Ads การแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'Google Ads คอนเวอร์ชันลดลงเมื่อเทียบกับช่วงก่อน',
    recommendations: summary.rb.join('\n'),
  }, built.evidence);
  assert.deepEqual(quality, { passed: true, violations: [] });
});

test('latest live vague wording remains blocked instead of weakening the quality gate', () => {
  const report = paidFunnelReport();
  const built = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: statusVector(report),
  });
  const quality = validateLarkWeeklyExecutiveFullChannelAiOutputs({
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 2,857.35 บาท และ Google Ads มีการแสดงผล 274,173 ครั้ง',
    strengths: 'Google Ads การแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'Google Ads คอนเวอร์ชันลดลงเมื่อเทียบกับช่วงก่อน',
    recommendations: '[NO-SCALE] กล่าวถึง metric การแสดงผล และ metric คอนเวอร์ชัน\n[TEST] ใช้แคมเปญ Sale M.5/1 02',
  }, built.evidence);

  assert.equal(quality.passed, false);
  assert.ok(quality.violations.includes('recommendations_missing_action_detail'));
});
