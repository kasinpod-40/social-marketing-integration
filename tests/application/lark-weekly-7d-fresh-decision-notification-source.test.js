import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
} from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import {
  buildFreshWeekly7dExecutiveDecisionNotificationAdmission,
} from '../../scripts/lib/lark-weekly-7d-fresh-decision-notification-source.js';
import {
  buildLarkWeekly7dExecutiveDecisionSynthesis,
} from '../../scripts/lib/lark-weekly-7d-executive-decision-preview.js';

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
    payload: { dataStatus: 'complete', generatedAt: 1_786_294_800_000 },
    metricValues,
    topContent: [],
    topAds: [],
    ...extra,
  };
}

function authority() {
  const reportBundles = [
    bundle('meta_ads', [
      metric('meta_ads:spend_micros', 'Spend', 2857350000, 12876000000, 'currency'),
      metric('meta_ads:impressions', 'Impressions', 406054, 2308140),
      metric('meta_ads:clicks', 'Clicks', 5387, 29076),
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
        roas: null,
        data_status: 'complete',
      }],
    }),
    bundle('google_ads', [
      metric('google_ads:impressions', 'Impressions', 274173, 211405),
      metric('google_ads:clicks', 'Clicks', 3035, 4330, 'count', 2),
      metric('google_ads:conversions', 'Conversions', 0, 8, 'count', 3),
    ]),
  ];
  const factualReport = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: PERIOD,
    reportBundles,
  });
  const sourceReportIds = [...factualReport.sourceReportIds].sort();
  const seed = {
    fields: {
      ai_run_key: 'weekly-seed-source',
      report_id: 'weekly-seed-source',
      template_version: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
      scope_type: 'executive',
      channel_key: 'executive',
      capability: 'cross_channel',
      window_days: 7,
      readiness_status: 'report_available',
      severity: 'info',
      generation_status: 'generated',
      failure_code: null,
      preview_mode: true,
      notification_eligible: false,
      sent_to_group: false,
      dedupe_key: 'a'.repeat(64),
      source_report_ids_json: JSON.stringify(sourceReportIds),
      channel_status_vector_json: JSON.stringify([
        { channelKey: 'meta_ads', readinessStatus: 'report_available' },
        { channelKey: 'google_ads', readinessStatus: 'report_available' },
      ]),
      period_start: PERIOD.periodStart,
      period_end: PERIOD.periodEnd,
      compare_start: PERIOD.compareStart,
      compare_end: PERIOD.compareEnd,
      comparison_mode: PERIOD.comparisonMode,
    },
  };
  const synthesis = buildLarkWeekly7dExecutiveDecisionSynthesis({ sourceRecord: seed, factualReport });
  const generated = structuredClone(synthesis.fields);
  Object.assign(generated, {
    generation_status: 'generated',
    failure_code: null,
    insight_summary: 'Meta Ads มีค่าใช้จ่าย 2,857.35 บาท และ Google Ads มีการแสดงผล 274,173 ครั้ง',
    strengths: 'Google Ads การแสดงผลเพิ่มขึ้นเมื่อเทียบกับช่วงก่อน',
    weaknesses: 'Google Ads คอนเวอร์ชันลดลงเมื่อเทียบกับช่วงก่อน',
    recommendations: '[TEST] Sale M.5/1 02 ทดสอบต่อแบบจำกัดงบ โดยวัด CTR 1.30974%\n[NO-SCALE] Google Ads ไม่เพิ่มงบรวม เพราะ การแสดงผล +29.6909% แต่ คอนเวอร์ชัน -100%',
    generated_at: 1_786_294_800_000,
  });
  return { factualReport, synthesis, sourceRecord: { recordId: 'rec-fresh-v4', fields: generated } };
}

test('clones the exact generated Fresh v4 decision into one full-channel notification identity', () => {
  const input = authority();
  const original = structuredClone(input.sourceRecord);
  const admission = buildFreshWeekly7dExecutiveDecisionNotificationAdmission({
    sourceRecord: input.sourceRecord,
    synthesis: input.synthesis,
  });

  assert.match(admission.sourceAiRunKey, /^weekly-7d-executive-decision-ai:[a-f0-9]{64}$/u);
  assert.match(admission.aiRunKey, /^notification-weekly-7d:[a-f0-9]{64}$/u);
  assert.equal(admission.qualityGate.passed, true);
  assert.equal(admission.fields.preview_mode, false);
  assert.equal(admission.fields.notification_eligible, true);
  assert.equal(admission.fields.sent_to_group, false);
  assert.equal(admission.fields.failure_code, null);
  assert.match(admission.fields.insight_summary, /💰 Meta Ads/u);
  assert.match(admission.fields.insight_summary, /🔎 Google Ads/u);
  assert.match(admission.reviewedMessage.text, /🎯 สิ่งที่ควรทำสัปดาห์หน้า/u);
  assert.match(admission.reviewedMessage.text, /Sale M\.5\/1 02 ทดสอบต่อแบบจำกัดงบ/u);
  assert.match(admission.reviewedMessageSha256, /^[a-f0-9]{64}$/u);
  assert.ok(admission.reviewedMessageBytes > 0);
  assert.deepEqual(input.sourceRecord, original);
});
