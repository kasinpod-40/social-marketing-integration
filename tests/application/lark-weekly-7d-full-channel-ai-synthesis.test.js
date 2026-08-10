import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER,
  assertLarkWeekly7dFullChannelAiGenerated,
  assertLarkWeekly7dFullChannelAiPrepared,
  buildLarkWeekly7dFullChannelAiSynthesis,
  isLarkWeekly7dFullChannelAiIdentity,
} from '../../scripts/lib/lark-weekly-7d-full-channel-ai-synthesis.js';

function sourceRecord() {
  const channelBusinessEvidence = [
    {
      channelKey: 'meta_ads', displayName: 'Meta Ads', businessEvidencePresent: true,
      comparisonEvidencePresent: false,
      topAds: [{ ad_name: 'Campaign X', clicks: 4553, impressions: 582054, derived_ctr_percent: 0.78223 }],
    },
    'tiktok_organic', 'facebook_organic', 'instagram_organic', 'youtube_organic',
    'google_ads', 'tiktok_ads', 'woocommerce', 'chatwoot',
  ].map((item) => typeof item === 'string'
    ? { channelKey: item, businessEvidencePresent: false, comparisonEvidencePresent: false }
    : item);
  return {
    recordId: 'rec-v9',
    fields: {
      ai_run_key: 'v9-source', report_id: 'v9-source',
      template_version: 'weekly_executive_quality_v2_uat',
      scope_type: 'executive', channel_key: 'executive', capability: 'cross_channel', window_days: 7,
      period_start: Date.parse('2026-07-25T00:00:00+07:00'),
      period_end: Date.parse('2026-07-31T00:00:00+07:00'),
      compare_start: Date.parse('2026-07-18T00:00:00+07:00'),
      compare_end: Date.parse('2026-07-24T00:00:00+07:00'),
      comparison_mode: 'previous_period', readiness_status: 'report_partial',
      generation_status: 'generated', failure_code: null, preview_mode: true,
      notification_eligible: false, sent_to_group: false, dedupe_key: 'a'.repeat(64),
      source_report_ids_json: JSON.stringify(['report-meta']),
      metric_summary_json: JSON.stringify({
        evidenceShape: 'executive_business_first_v2', promptShape: 'lark_ai_compact_quality_v6',
        qualityContext: {
          businessEvidenceChannelCount: 1, comparisonEvidenceChannelCount: 0,
          strengthsMode: 'fallback_no_comparison', recommendationMode: 'observed_only_business_followup',
          summaryRequiredFacts: [{ channel: 'Meta Ads', metric: 'clicks', value: 4553 }],
        },
        channelBusinessEvidence,
      }),
      channel_status_vector_json: JSON.stringify(channelBusinessEvidence.map(({ channelKey }) => ({ channelKey }))),
      insight_summary: 'Meta Ads มีจำนวนการคลิก 4553 ครั้ง และการแสดงผล 582054 ครั้ง ค่าดัชนีการคลิกที่คำนวณได้เป็น 0.78223 เปอร์เซ็นต์',
      strengths: 'ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน',
      weaknesses: 'ยังไม่พบสัญญาณด้านผลงานที่ควรระวังจากข้อมูลที่มี',
      recommendations: '- คำนวณ CTR และ CPC จากข้อมูลโฆษณาที่มี แล้วใช้เป็น baseline เทียบกับสัปดาห์ถัดไป',
      notification_reason: 'controlled_preview', sent_at: null, cooldown_until: null,
    },
  };
}

function factualReport() {
  return buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: {
      periodStart: '2026-07-25', periodEnd: '2026-07-31',
      compareStart: '2026-07-18', compareEnd: '2026-07-24', comparisonMode: 'previous_period',
    },
    reportBundles: [{
      channelKey: 'meta_ads', reportId: 'report-meta', payload: { dataStatus: 'complete' },
      metricValues: [{
        metric_key: 'meta_ads:clicks', display_name: 'Clicks', current_value: 4553,
        compare_value: null, unit: 'count', availability_status: 'available',
        metric_scope: 'period_delta', dimension_type: 'summary', rank: 1,
      }],
      topContent: [],
      topAds: [{ rank: 1, external_ad_id: 'ad-1', ad_name: 'Campaign X', clicks: 4553, impressions: 582054, data_status: 'complete' }],
    }],
  });
}

function decisionReadyOutputs(source) {
  return {
    insight_summary: source.fields.insight_summary,
    strengths: source.fields.strengths,
    weaknesses: source.fields.weaknesses,
    recommendations: '[TEST] Campaign X ทดลองครีเอทีฟต่อแบบจำกัดงบเพื่อวัดผลจากข้อมูลโฆษณาที่มี\n[KEEP] Campaign X คงไว้เป็นตัวทดสอบจนมีหลักฐาน Conversion/ROAS เพิ่มเติม',
  };
}

test('builds stable new synthesis identity without mutating accepted V9 fields', () => {
  const source = sourceRecord();
  const before = structuredClone(source.fields);
  const first = buildLarkWeekly7dFullChannelAiSynthesis({ sourceRecord: source, factualReport: factualReport() });
  const second = buildLarkWeekly7dFullChannelAiSynthesis({ sourceRecord: source, factualReport: factualReport() });
  assert.equal(isLarkWeekly7dFullChannelAiIdentity(first.aiRunKey), true);
  assert.equal(first.aiRunKey, second.aiRunKey);
  assert.notEqual(first.aiRunKey, source.fields.ai_run_key);
  assert.equal(first.fields.generation_status, 'pending');
  assert.equal(first.fields.failure_code, null);
  assert.equal(first.fields.preview_mode, true);
  assert.equal(first.fields.notification_eligible, false);
  assert.equal(first.fields.sent_to_group, false);
  assert.deepEqual(source.fields, before);
  assert.equal(assertLarkWeekly7dFullChannelAiPrepared(first.fields, first), true);
});

test('prepared synthesis rejects trigger marker until Native AI completion', () => {
  const synthesis = buildLarkWeekly7dFullChannelAiSynthesis({ sourceRecord: sourceRecord(), factualReport: factualReport() });
  assert.throws(
    () => assertLarkWeekly7dFullChannelAiPrepared({
      ...synthesis.fields,
      failure_code: LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER,
    }, synthesis),
    (error) => error?.code === 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_PREPARED_INVALID',
  );
});

test('generated synthesis requires decision-ready quality-passed outputs and remains notification-ineligible', () => {
  const source = sourceRecord();
  const synthesis = buildLarkWeekly7dFullChannelAiSynthesis({ sourceRecord: source, factualReport: factualReport() });
  const generated = {
    ...synthesis.fields,
    generation_status: 'generated',
    failure_code: null,
    generated_at: Date.now(),
    ...decisionReadyOutputs(source),
  };
  const accepted = assertLarkWeekly7dFullChannelAiGenerated(generated, synthesis);
  assert.equal(accepted.qualityGate.passed, true);
  assert.equal(generated.notification_eligible, false);
  assert.equal(generated.sent_to_group, false);

  assert.throws(
    () => assertLarkWeekly7dFullChannelAiGenerated({ ...generated, notification_eligible: true }, synthesis),
    (error) => error?.code === 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_GENERATED_INVALID',
  );
});

test('generated synthesis blocks the old generic follow-up recommendation', () => {
  const source = sourceRecord();
  const synthesis = buildLarkWeekly7dFullChannelAiSynthesis({ sourceRecord: source, factualReport: factualReport() });
  assert.throws(
    () => assertLarkWeekly7dFullChannelAiGenerated({
      ...synthesis.fields,
      generation_status: 'generated',
      failure_code: null,
      generated_at: Date.now(),
      insight_summary: source.fields.insight_summary,
      strengths: source.fields.strengths,
      weaknesses: source.fields.weaknesses,
      recommendations: '- คำนวณ CTR และ CPC จากข้อมูลโฆษณาที่มี แล้วใช้เป็น baseline เทียบกับสัปดาห์ถัดไป',
    }, synthesis),
    (error) => error?.code === 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_QUALITY_FAILED'
      && error?.details?.violations?.includes('recommendations_missing_decision_actions'),
  );
});
