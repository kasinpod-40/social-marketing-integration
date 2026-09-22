import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkWeeklyExecutiveFactualReport,
  renderLarkWeeklyExecutiveChannelSections,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkWeeklyExecutiveDeterministicInsightSummary,
  buildLarkWeeklyExecutiveFullChannelAiEvidence,
  repairLarkWeeklyExecutiveFullChannelAiOutputs,
  validateLarkWeeklyExecutiveFullChannelAiOutputs,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import {
  LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
} from '../../packages/application/src/reports/lark-native-ai-executive-writer-quality.js';

const PERIOD = Object.freeze({
  periodStart: '2026-09-14',
  periodEnd: '2026-09-20',
  compareStart: '2026-09-07',
  compareEnd: '2026-09-13',
  comparisonMode: 'previous_period',
});

function metric(metricKey, displayName, currentValue, compareValue, unit, rank, metricScope = 'period_delta') {
  return Object.freeze({
    metric_key: metricKey,
    display_name: displayName,
    current_value: currentValue,
    compare_value: compareValue,
    change_value: compareValue === null ? null : currentValue - compareValue,
    change_percent: null,
    unit,
    availability_status: 'available',
    metric_scope: metricScope,
    dimension_type: 'summary',
    rank,
  });
}

function bundle(channelKey, metrics) {
  return Object.freeze({
    channelKey,
    reportId: `report-${channelKey}`,
    payload: Object.freeze({ dataStatus: 'complete' }),
    metricValues: Object.freeze(metrics),
    topContent: Object.freeze([]),
    topAds: Object.freeze([]),
  });
}

function factualReport() {
  return buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles: [
      bundle('facebook_organic', [
        metric('facebook:account_followers', 'Followers', 181448, null, 'count', 1, 'current_total'),
      ]),
      bundle('youtube_organic', [
        metric('youtube:views_gained', 'Views gained', 17508, 17425.35155756248, 'count', 1),
      ]),
      bundle('woocommerce', [
        metric('woocommerce:net_sales_micros', 'Net sales', 209710000000, 200000000000, 'currency', 1),
      ]),
    ],
  });
}

function evidenceFor(report) {
  return buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport: report,
    channelStatusVectorJson: JSON.stringify(report.channels.map(({ channelKey }) => ({
      channelKey,
      readinessStatus: 'report_ready',
    }))),
  }).evidence;
}

function acceptedOutputs(insightSummary) {
  return Object.freeze({
    insight_summary: insightSummary,
    strengths: 'YouTube Organic มี Views gained เพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
    recommendations: [
      '[KEEP] YouTube Organic คงไว้ติดตาม Views gained ในสัปดาห์ถัดไป',
      '[KEEP] WooCommerce คงไว้ติดตาม ยอดขายสุทธิ ในสัปดาห์ถัดไป',
    ].join('\n'),
  });
}

test('YouTube Views gained renders as a count with ครั้ง and never as multiplier เท่า', () => {
  const report = factualReport();
  const youtube = renderLarkWeeklyExecutiveChannelSections(report)
    .find(({ channelKey }) => channelKey === 'youtube_organic');
  assert.ok(youtube.lines.some((line) => line.includes('Views gained: 17,508 ครั้ง')));
  assert.ok(youtube.lines.some((line) => line.includes('% เทียบช่วงก่อน)')));
  assert.equal(youtube.lines.some((line) => /17,508\s*เท่า/u.test(line)), false);
});

test('deterministic Weekly overview keeps channel ownership, semantic units and four-digit comparison percent', () => {
  const report = factualReport();
  const insight = buildLarkWeeklyExecutiveDeterministicInsightSummary(evidenceFor(report));
  assert.match(insight, /WooCommerce.*209,710 บาท/u);
  assert.match(insight, /Facebook Organic.*181,448 คน/u);
  assert.match(insight, /YouTube Organic.*Views gained 17,508 ครั้ง \(เพิ่ม 0\.4743%\)/u);
  assert.doesNotMatch(insight, /Views gained 17,508 เท่า/u);
  assert.doesNotMatch(insight, /\(เพิ่ม 0\.4743\)/u);
});

test('quality rejects wrong-channel Views and missing percent then repairs only the delivery projection from factual evidence', () => {
  const report = factualReport();
  const evidence = evidenceFor(report);
  const bad = acceptedOutputs(
    'Facebook Organic มี Views gained 17,508 เท่า (เพิ่ม 0.4743) และ WooCommerce มียอดขายสุทธิ 209,710 บาท',
  );
  const rejected = validateLarkWeeklyExecutiveFullChannelAiOutputs(bad, evidence);
  assert.equal(rejected.passed, false);
  assert.ok(rejected.violations.includes('insight_comparison_percent_unit_missing'));
  assert.ok(rejected.violations.includes('insight_view_count_unit_invalid'));
  assert.ok(rejected.violations.includes('insight_fact_channel_mismatch'));

  const repaired = repairLarkWeeklyExecutiveFullChannelAiOutputs(bad, evidence);
  assert.equal(repaired.repaired, true);
  assert.equal(repaired.repairCode, 'bounded_weekly_fact_format_v2');
  assert.equal(repaired.qualityGate.passed, true);
  assert.match(repaired.outputs.insight_summary, /YouTube Organic.*Views gained 17,508 ครั้ง \(เพิ่ม 0\.4743%\)/u);
  assert.doesNotMatch(repaired.outputs.insight_summary, /Facebook Organic.*Views gained 17,508/u);
  assert.equal(repaired.outputs.strengths, bad.strengths);
  assert.equal(repaired.outputs.weaknesses, bad.weaknesses);
});
