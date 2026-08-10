import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  assertFreshWeekly7dDecisionPeriod,
  assertLarkWeekly7dExecutiveDecisionGenerated,
  assertLarkWeekly7dExecutiveDecisionPrepared,
  buildLarkWeekly7dExecutiveDecisionSynthesis,
  isLarkWeekly7dExecutiveDecisionIdentity,
} from '../../scripts/lib/lark-weekly-7d-executive-decision-preview.js';

const NOW = Date.parse('2026-08-10T08:06:00+07:00');

function channelStatusVector() {
  return [
    'tiktok_organic', 'facebook_organic', 'instagram_organic', 'youtube_organic',
    'meta_ads', 'google_ads', 'tiktok_ads', 'woocommerce', 'chatwoot',
  ].map((channelKey) => ({ channelKey }));
}

function sourceRecord() {
  return {
    recordId: null,
    fields: {
      ai_run_key: 'fresh-source-2026-08-09',
      report_id: 'fresh-source-2026-08-09',
      template_version: 'weekly_executive_quality_v2_uat',
      scope_type: 'executive',
      channel_key: 'executive',
      capability: 'cross_channel',
      window_days: 7,
      period_start: Date.parse('2026-08-03T00:00:00+07:00'),
      period_end: Date.parse('2026-08-09T00:00:00+07:00'),
      compare_start: Date.parse('2026-07-27T00:00:00+07:00'),
      compare_end: Date.parse('2026-08-02T00:00:00+07:00'),
      comparison_mode: 'previous_period',
      readiness_status: 'report_partial',
      severity: 'info',
      generation_status: 'pending',
      failure_code: null,
      preview_mode: true,
      notification_eligible: false,
      sent_to_group: false,
      dedupe_key: 'b'.repeat(64),
      source_report_ids_json: JSON.stringify(['report-meta-fresh']),
      channel_status_vector_json: JSON.stringify(channelStatusVector()),
      metric_summary_json: '{}',
      insight_summary: null,
      strengths: null,
      weaknesses: null,
      recommendations: null,
      notification_reason: 'controlled_preview',
      sent_at: null,
      cooldown_until: null,
    },
  };
}

function factualReport() {
  return buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: {
      periodStart: '2026-08-03', periodEnd: '2026-08-09',
      compareStart: '2026-07-27', compareEnd: '2026-08-02', comparisonMode: 'previous_period',
    },
    reportBundles: [{
      channelKey: 'meta_ads',
      reportId: 'report-meta-fresh',
      payload: { dataStatus: 'complete' },
      metricValues: [
        {
          metric_key: 'meta_ads:impressions', display_name: 'Impressions', current_value: 120000,
          compare_value: 100000, change_percent: 20, unit: 'count', availability_status: 'available',
          metric_scope: 'period_delta', dimension_type: 'summary', rank: 1,
        },
        {
          metric_key: 'meta_ads:clicks', display_name: 'Clicks', current_value: 3200,
          compare_value: 4000, change_percent: -20, unit: 'count', availability_status: 'available',
          metric_scope: 'period_delta', dimension_type: 'summary', rank: 1,
        },
      ],
      topContent: [],
      topAds: [{
        rank: 1,
        external_ad_id: 'ad-fresh-1',
        ad_name: 'Fresh Campaign A',
        clicks: 3200,
        impressions: 120000,
        spend: 15000,
        data_status: 'complete',
      }],
    }],
  });
}

function decisionReadyOutputs() {
  return {
    insight_summary: 'Meta Ads มีการแสดงผล 120000 เพิ่มขึ้น 20% แต่การคลิก 3200 ลดลง 20% เมื่อเทียบกับช่วงก่อน จึงเห็นสัญญาณต้น Funnel และปลาย Funnel สวนทางกัน',
    strengths: 'Meta Ads มีการแสดงผลเพิ่มขึ้น 20% เมื่อเทียบกับช่วงก่อน',
    weaknesses: 'Meta Ads มีการคลิกลดลง 20% เมื่อเทียบกับช่วงก่อน แม้การแสดงผลเพิ่มขึ้น',
    recommendations: '[TEST] Fresh Campaign A มีการแสดงผล 120000 และการคลิก 3200 แต่ยังไม่มี Conversion/ROAS จึงทดสอบต่อด้วยงบจำกัด\n[NO-SCALE] Fresh Campaign A ยังไม่มีหลักฐานปลาย Funnel และการคลิกลดลง จึงไม่เพิ่มงบรวมในรอบนี้',
  };
}

test('accepts the latest exact seven completed Bangkok days after the historical closeout', () => {
  const accepted = assertFreshWeekly7dDecisionPeriod({
    periodStart: '2026-08-03',
    periodEnd: '2026-08-09',
  }, NOW);
  assert.equal(accepted.previousCompletedBangkokDay, '2026-08-09');
  assert.equal(accepted.periodStart, '2026-08-03');
  assert.equal(accepted.periodEnd, '2026-08-09');
});

test('rejects the historical delivered period as not fresh', () => {
  assert.throws(
    () => assertFreshWeekly7dDecisionPeriod({
      periodStart: '2026-07-25',
      periodEnd: '2026-07-31',
    }, NOW),
    (error) => error?.code === 'LARK_WEEKLY_7D_EXECUTIVE_DECISION_PERIOD_NOT_FRESH',
  );
});

test('rejects a period that includes the current incomplete Bangkok day', () => {
  assert.throws(
    () => assertFreshWeekly7dDecisionPeriod({
      periodStart: '2026-08-04',
      periodEnd: '2026-08-10',
    }, NOW),
    (error) => error?.code === 'LARK_WEEKLY_7D_EXECUTIVE_DECISION_PERIOD_INCOMPLETE',
  );
});

test('builds a stable fresh synthesis identity and keeps persisted delivery flags safe', () => {
  const source = sourceRecord();
  const before = structuredClone(source.fields);
  const first = buildLarkWeekly7dExecutiveDecisionSynthesis({ sourceRecord: source, factualReport: factualReport() });
  const second = buildLarkWeekly7dExecutiveDecisionSynthesis({ sourceRecord: source, factualReport: factualReport() });
  assert.equal(first.aiRunKey, second.aiRunKey);
  assert.equal(isLarkWeekly7dExecutiveDecisionIdentity(first.aiRunKey), true);
  assert.notEqual(first.aiRunKey, source.fields.ai_run_key);
  assert.equal(first.fields.generation_status, 'pending');
  assert.equal(first.fields.failure_code, null);
  assert.equal(first.fields.preview_mode, true);
  assert.equal(first.fields.notification_eligible, false);
  assert.equal(first.fields.sent_to_group, false);
  assert.equal(first.evidence.evidence.funnelDivergences.length, 1);
  assert.equal(first.evidence.evidence.organicPaidMappingAvailable, false);
  assert.deepEqual(source.fields, before);
  assert.equal(assertLarkWeekly7dExecutiveDecisionPrepared(first.fields, first), true);
});

test('generated fresh decision passes only with explicit decision-ready actions', () => {
  const synthesis = buildLarkWeekly7dExecutiveDecisionSynthesis({
    sourceRecord: sourceRecord(),
    factualReport: factualReport(),
  });
  const accepted = assertLarkWeekly7dExecutiveDecisionGenerated({
    ...synthesis.fields,
    generation_status: 'generated',
    generated_at: NOW,
    ...decisionReadyOutputs(),
  }, synthesis);
  assert.equal(accepted.qualityGate.passed, true);

  assert.throws(
    () => assertLarkWeekly7dExecutiveDecisionGenerated({
      ...synthesis.fields,
      generation_status: 'generated',
      generated_at: NOW,
      insight_summary: decisionReadyOutputs().insight_summary,
      strengths: decisionReadyOutputs().strengths,
      weaknesses: decisionReadyOutputs().weaknesses,
      recommendations: 'ติดตาม CTR และ CPC ต่อในสัปดาห์หน้าแล้วค่อยวิเคราะห์อีกครั้ง',
    }, synthesis),
    (error) => error?.code === 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED'
      && error?.details?.violations?.includes('recommendations_missing_decision_actions'),
  );
});

test('fresh source Report identity and period drift fail closed', () => {
  const source = sourceRecord();
  source.fields.source_report_ids_json = JSON.stringify(['different-report']);
  assert.throws(
    () => buildLarkWeekly7dExecutiveDecisionSynthesis({ sourceRecord: source, factualReport: factualReport() }),
    (error) => error?.code === 'LARK_WEEKLY_7D_EXECUTIVE_DECISION_SOURCE_INVALID'
      && error?.details?.invalid?.includes('sourceReportIds'),
  );
});
