import assert from 'node:assert/strict';
import test from 'node:test';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkWeekly7dFullChannelAiSynthesis,
} from '../../scripts/lib/lark-weekly-7d-full-channel-ai-synthesis.js';
import {
  LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_CONFIRMATION,
  assertFullChannelMessage,
  assertLarkWeekly7dFullChannelNotificationConfirmation,
  assertLarkWeekly7dFullChannelSourceAlignment,
  buildLarkWeekly7dFullChannelNotificationRow,
  isFullChannelWeeklyIdentity,
} from '../../scripts/lib/lark-weekly-7d-full-channel-notification.js';
import {
  buildLarkWeekly7dNotificationAdmissionRow,
} from '../../scripts/lib/lark-weekly-7d-notification-admission.js';

function retainedV9Evidence() {
  const channels = [
    {
      channelKey: 'meta_ads',
      displayName: 'Meta Ads',
      businessEvidencePresent: true,
      comparisonEvidencePresent: false,
      topAds: [{
        rank: 1,
        ad_name: '(01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา',
        clicks: 4553,
        impressions: 582054,
        spend_micros: 807690000000,
        derived_ctr_percent: 0.78223,
      }],
    },
    'tiktok_organic', 'facebook_organic', 'instagram_organic', 'youtube_organic',
    'google_ads', 'tiktok_ads', 'woocommerce', 'chatwoot',
  ].map((value) => typeof value === 'string'
    ? { channelKey: value, businessEvidencePresent: false, comparisonEvidencePresent: false }
    : value);
  return {
    metricSummaryJson: JSON.stringify({
      evidenceShape: 'executive_business_first_v2',
      promptShape: 'lark_ai_compact_quality_v6',
      qualityContext: {
        businessEvidenceChannelCount: 1,
        comparisonEvidenceChannelCount: 0,
        strengthsMode: 'fallback_no_comparison',
        recommendationMode: 'observed_only_business_followup',
        summaryRequiredFacts: [
          { channel: 'Meta Ads', metric: 'clicks', value: 4553 },
          { channel: 'Meta Ads', metric: 'impressions', value: 582054 },
          { channel: 'Meta Ads', metric: 'derived_ctr_percent', value: 0.78223 },
        ],
      },
      channelBusinessEvidence: channels,
    }),
    channelStatusVectorJson: JSON.stringify(channels.map(({ channelKey }) => ({
      channelKey,
      readinessStatus: channelKey === 'meta_ads' ? 'report_partial' : 'source_unavailable',
    }))),
  };
}

function sourceRecord() {
  const evidence = retainedV9Evidence();
  return {
    recordId: 'rec-source-v9',
    fields: {
      ai_run_key: 'weekly-quality-v9-source',
      report_id: 'weekly-quality-v9-source',
      template_version: 'weekly_executive_quality_v2_uat',
      scope_type: 'executive',
      channel_key: 'executive',
      capability: 'cross_channel',
      window_days: 7,
      period_start: Date.parse('2026-07-24T00:00:00+07:00'),
      period_end: Date.parse('2026-07-30T00:00:00+07:00'),
      compare_start: null,
      compare_end: null,
      comparison_mode: 'none',
      readiness_status: 'report_partial',
      generation_status: 'generated',
      failure_code: null,
      preview_mode: true,
      notification_eligible: false,
      sent_to_group: false,
      dedupe_key: 'a'.repeat(64),
      source_report_ids_json: JSON.stringify(['report-meta-7d']),
      metric_summary_json: evidence.metricSummaryJson,
      channel_status_vector_json: evidence.channelStatusVectorJson,
      insight_summary: 'Meta Ads มีจำนวนการคลิก 4553 ครั้ง และการแสดงผล 582054 ครั้ง ค่าดัชนีการคลิกที่คำนวณได้เป็น 0.78223 เปอร์เซ็นต์ ยังสรุปแนวโน้มผลงานไม่ได้เนื่องจากขาดข้อมูลเปรียบเทียบ',
      strengths: 'ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน',
      weaknesses: 'ยังไม่พบสัญญาณด้านผลงานที่ควรระวังจากข้อมูลที่มี',
      recommendations: '- คำนวณ CTR และ CPC จากข้อมูลโฆษณาที่มี แล้วใช้เป็น baseline เทียบกับสัปดาห์ถัดไป',
      severity: 'warning',
      notification_reason: 'controlled_preview',
      sent_at: null,
      cooldown_until: null,
    },
  };
}

function factualReport(clicks = 4553) {
  return buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: {
      periodStart: '2026-07-24', periodEnd: '2026-07-30',
      compareStart: null, compareEnd: null, comparisonMode: 'none',
    },
    reportBundles: [{
      channelKey: 'meta_ads',
      reportId: 'report-meta-7d',
      payload: { dataStatus: 'complete' },
      metricValues: [
        { metric_key: 'clicks', display_name: 'Clicks', current_value: clicks, unit: 'count', availability_status: 'available', metric_scope: 'summary', dimension_type: 'summary', rank: 1 },
        { metric_key: 'impressions', display_name: 'Impressions', current_value: 582054, unit: 'count', availability_status: 'available', metric_scope: 'summary', dimension_type: 'summary', rank: 2 },
      ],
      topContent: [],
      topAds: [{ rank: 1, external_ad_id: 'ad-1', ad_name: 'Campaign X', clicks, impressions: 582054, data_status: 'complete' }],
    }],
  });
}

function generatedSynthesis(source, factual) {
  const expected = buildLarkWeekly7dFullChannelAiSynthesis({
    sourceRecord: source,
    factualReport: factual,
  });
  return {
    recordId: 'rec-full-channel-synthesis',
    fields: {
      ...expected.fields,
      generation_status: 'generated',
      failure_code: null,
      generated_at: Date.parse('2026-08-09T10:00:00+07:00'),
      insight_summary: source.fields.insight_summary,
      strengths: source.fields.strengths,
      weaknesses: source.fields.weaknesses,
      recommendations: source.fields.recommendations,
    },
  };
}

function correctedNotification(source = sourceRecord(), factual = factualReport()) {
  return buildLarkWeekly7dFullChannelNotificationRow({
    sourceRecord: source,
    factualReport: factual,
    synthesisRecord: generatedSynthesis(source, factual),
  });
}

test('requires explicit corrected full-channel one-message confirmation', () => {
  assert.throws(
    () => assertLarkWeekly7dFullChannelNotificationConfirmation({}),
    (error) => error?.code === 'LARK_WEEKLY_7D_FULL_CHANNEL_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertLarkWeekly7dFullChannelNotificationConfirmation({
    [LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_CONFIRMATION.envName]:
      LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_CONFIRMATION.value,
  }), true);
});

test('requires generated full-channel synthesis and builds a new immutable notification identity', () => {
  const source = sourceRecord();
  const factual = factualReport();
  const oldAdmission = buildLarkWeekly7dNotificationAdmissionRow(source);
  assert.throws(
    () => buildLarkWeekly7dFullChannelNotificationRow({ sourceRecord: source, factualReport: factual }),
    /synthesisRecord/u,
  );
  const corrected = correctedNotification(source, factual);
  assert.equal(isFullChannelWeeklyIdentity(corrected.aiRunKey), true);
  assert.notEqual(corrected.aiRunKey, oldAdmission.aiRunKey);
  assert.notEqual(corrected.dedupeKey, oldAdmission.dedupeKey);
  assert.ok(corrected.synthesisAiRunKey.startsWith('weekly-7d-full-channel-ai:'));
  assert.equal(corrected.templateVersion, 'executive_weekly_7d_notification_v1');
  assert.equal(corrected.fields.notification_eligible, true);
  assert.equal(corrected.fields.preview_mode, false);
  assert.equal(corrected.fields.sent_to_group, false);
  assert.equal(corrected.channelSectionCount, 9);
  assert.equal(corrected.businessFactChannelCount, 1);
  assert.match(corrected.composedInsight, /🎵 TikTok Organic/u);
  assert.match(corrected.composedInsight, /💰 Meta Ads/u);
  assert.match(corrected.composedInsight, /💬 Chatwoot/u);
  assert.match(corrected.composedInsight, /4,553/u);
  assert.match(corrected.composedInsight, /582,054/u);
  assert.match(corrected.composedInsight, /CTR 0\.78%/u);
  assert.equal(corrected.fields.strengths, source.fields.strengths);
  assert.equal(corrected.fields.weaknesses, source.fields.weaknesses);
  assert.equal(corrected.fields.recommendations, source.fields.recommendations);
  assert.equal(corrected.qualityGate.passed, true);
});

test('factual checksum changes both synthesis and corrected notification identity', () => {
  const source = sourceRecord();
  const factualA = factualReport(4553);
  const factualB = factualReport(4554);
  const first = correctedNotification(source, factualA);
  const second = correctedNotification(source, factualB);
  assert.notEqual(first.synthesisAiRunKey, second.synthesisAiRunKey);
  assert.notEqual(first.aiRunKey, second.aiRunKey);
  assert.notEqual(first.factualReportSha256, second.factualReportSha256);
});

test('requires exact factual source Report and period alignment with accepted V9 authority', () => {
  const pass = assertLarkWeekly7dFullChannelSourceAlignment({
    expectedSourceReportIds: ['report-meta-7d'],
    collectedSourceReportIds: ['report-meta-7d'],
    expectedPeriod: { periodStart: '2026-07-24', periodEnd: '2026-07-30', comparisonMode: 'none', windowDays: 7 },
    collectedPeriod: { periodStart: '2026-07-24', periodEnd: '2026-07-30', comparisonMode: 'none', windowDays: 7 },
  });
  assert.deepEqual(pass.sourceReportIds, ['report-meta-7d']);
  assert.throws(
    () => assertLarkWeekly7dFullChannelSourceAlignment({
      expectedSourceReportIds: ['report-meta-7d'],
      collectedSourceReportIds: ['report-newer-7d'],
      expectedPeriod: { periodStart: '2026-07-24', periodEnd: '2026-07-30', comparisonMode: 'none', windowDays: 7 },
      collectedPeriod: { periodStart: '2026-07-31', periodEnd: '2026-08-06', comparisonMode: 'none', windowDays: 7 },
    }),
    (error) => ['LARK_WEEKLY_7D_FULL_CHANNEL_SOURCE_DRIFT', 'LARK_WEEKLY_7D_FULL_CHANNEL_PERIOD_DRIFT'].includes(error?.code),
  );
});

test('message acceptance requires all nine factual headings and generated synthesis outputs', () => {
  const corrected = correctedNotification();
  const message = [
    '📊 Social MKT Weekly Executive Report — 7D',
    'ช่วง 2026-07-24 ถึง 2026-07-30',
    '',
    'ภาพรวมสัปดาห์นี้',
    corrected.composedInsight,
    '',
    '🏆 สิ่งที่เด่นที่สุดประจำสัปดาห์', corrected.originalAiOutputs.strengths,
    '', '⚠️ สิ่งที่ต้องจับตา', corrected.originalAiOutputs.weaknesses,
    '', '🎯 สิ่งที่ควรทำสัปดาห์หน้า', corrected.originalAiOutputs.recommendations,
  ].join('\n');
  const accepted = assertFullChannelMessage({ admission: corrected, messageText: message });
  assert.equal(accepted.channelSectionCount, 9);
  const broken = message.replace('💬 Chatwoot', 'Chatwoot omitted');
  assert.throws(
    () => assertFullChannelMessage({ admission: corrected, messageText: broken }),
    (error) => error?.code === 'LARK_WEEKLY_7D_FULL_CHANNEL_MESSAGE_INVALID',
  );
});
