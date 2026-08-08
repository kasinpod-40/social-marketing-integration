import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONFIRMATION,
  assertLarkWeekly7dNotificationAdmissionBaseline,
  assertLarkWeekly7dNotificationAdmissionConfirmation,
  assertLarkWeekly7dNotificationAdmissionDelivered,
  assertLarkWeekly7dNotificationAdmissionStable,
  buildLarkWeekly7dNotificationAdmissionJob,
  buildLarkWeekly7dNotificationAdmissionRow,
  isExactAcceptedWeekly7dSource,
  normalizeLarkWeekly7dNotificationAdmissionReadback,
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
    'tiktok_organic',
    'facebook_organic',
    'instagram_organic',
    'youtube_organic',
    'google_ads',
    'tiktok_ads',
    'woocommerce',
    'chatwoot',
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
      insight_summary: 'Meta Ads มีจำนวนการคลิก 4553 ครั้ง และการแสดงผล 582054 ครั้ง ค่าดัชนีการคลิกที่คำนวณได้เป็น 0.78223 เปอร์เซ็นต์ แคมเปญโฆษณา (01-12) โปรโหมด เคมีรู้กันวันเดียว - สำเนา เป็นอันดับ 1 ในรายการที่มีข้อมูล ยังสรุปแนวโน้มผลงานไม่ได้เนื่องจากขาดข้อมูลเปรียบเทียบ',
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

function readback(overrides = {}) {
  return normalizeLarkWeekly7dNotificationAdmissionReadback({
    notification_table_count: 1,
    notification_index_count: 3,
    active_locks: 0,
    total_delivery_rows: 2,
    sent_mirrored_rows: 2,
    unsafe_delivery_rows: 0,
    unrelated_unsafe_delivery_rows: 0,
    controlled_uat_rows: 1,
    controlled_uat_sent_mirrored_rows: 1,
    runtime_smoke_rows: 1,
    runtime_smoke_sent_mirrored_rows: 1,
    admission_delivery_rows: 0,
    admission_delivery_status: null,
    admission_mirror_status: null,
    admission_claim_count: null,
    admission_sent_at: null,
    admission_message_id_hash: null,
    ...overrides,
  });
}

test('requires an explicit one-message admission confirmation', () => {
  assert.throws(
    () => assertLarkWeekly7dNotificationAdmissionConfirmation({}),
    (error) => error?.code === 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertLarkWeekly7dNotificationAdmissionConfirmation({
    [LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONFIRMATION.envName]:
      LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONFIRMATION.value,
  }), true);
});

test('clones the accepted V9 row into a dedicated sendable identity without mutating source evidence', () => {
  const source = sourceRecord();
  const original = structuredClone(source);
  assert.equal(isExactAcceptedWeekly7dSource(source.fields), true);
  const admission = buildLarkWeekly7dNotificationAdmissionRow(source);
  assert.match(admission.aiRunKey, /^notification-weekly-7d:[a-f0-9]{64}$/u);
  assert.equal(admission.fields.report_id, admission.aiRunKey);
  assert.equal(admission.fields.notification_eligible, true);
  assert.equal(admission.fields.preview_mode, false);
  assert.equal(admission.fields.sent_to_group, false);
  assert.equal(admission.fields.generation_status, 'generated');
  assert.equal(admission.fields.template_version, 'executive_weekly_7d_notification_v1');
  assert.equal(admission.qualityGate.passed, true);
  assert.equal(admission.evidence.derivedCtrFacts[0].derivedCtrPercent, 0.78223);
  assert.deepEqual(source, original);
});

test('rejects a source whose accepted business output drifts from the retained CTR evidence', () => {
  const source = sourceRecord();
  source.fields.insight_summary = 'Meta Ads มี 4553 clicks จาก 582054 impressions และค่าดัชนีการคลิกเป็น 0 เปอร์เซ็นต์';
  assert.equal(isExactAcceptedWeekly7dSource(source.fields), false);
  assert.throws(
    () => buildLarkWeekly7dNotificationAdmissionRow(source),
    (error) => error?.code === 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_QUALITY_FAILED',
  );
});

test('builds one existing runtime job for the dedicated identity', () => {
  const admission = buildLarkWeekly7dNotificationAdmissionRow(sourceRecord());
  const job = buildLarkWeekly7dNotificationAdmissionJob({
    aiRunKey: admission.aiRunKey,
    operationId: 'weekly_notification_operation',
    requestedAt: 1_786_165_200_000,
  });
  assert.equal(job.type, 'lark.notification.send');
  assert.equal(job.trigger, 'lark_notification_runtime');
  assert.equal(job.aiRunKey, admission.aiRunKey);
});

test('permits only the exact admission row to be transient during polling', () => {
  const baseline = assertLarkWeekly7dNotificationAdmissionBaseline(readback());
  const transient = readback({
    total_delivery_rows: 3,
    sent_mirrored_rows: 2,
    unsafe_delivery_rows: 1,
    admission_delivery_rows: 1,
    admission_delivery_status: 'sending',
    admission_mirror_status: 'pending',
    admission_claim_count: 1,
  });
  assert.equal(transient.unrelatedUnsafeDeliveryRows, 0);
  assert.throws(
    () => assertLarkWeekly7dNotificationAdmissionDelivered(baseline, transient),
    (error) => error?.code === 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_NOT_CONFIRMED',
  );
  assert.throws(
    () => normalizeLarkWeekly7dNotificationAdmissionReadback({
      notification_table_count: 1,
      notification_index_count: 3,
      active_locks: 0,
      total_delivery_rows: 4,
      sent_mirrored_rows: 2,
      unsafe_delivery_rows: 2,
      unrelated_unsafe_delivery_rows: 1,
      controlled_uat_rows: 1,
      controlled_uat_sent_mirrored_rows: 1,
      runtime_smoke_rows: 1,
      runtime_smoke_sent_mirrored_rows: 1,
      admission_delivery_rows: 1,
      admission_delivery_status: 'sending',
      admission_mirror_status: 'pending',
      admission_claim_count: 1,
    }),
    (error) => error?.code === 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_REMOTE_STATE_INVALID',
  );
});

test('accepts exactly one sent/mirrored delivery and proves stable no-admission observation', () => {
  const baseline = assertLarkWeekly7dNotificationAdmissionBaseline(readback());
  const final = readback({
    total_delivery_rows: 3,
    sent_mirrored_rows: 3,
    admission_delivery_rows: 1,
    admission_delivery_status: 'sent',
    admission_mirror_status: 'mirrored',
    admission_claim_count: 1,
    admission_sent_at: 1_786_165_200_500,
    admission_message_id_hash: 'b'.repeat(64),
  });
  const delivered = assertLarkWeekly7dNotificationAdmissionDelivered(baseline, final);
  assert.equal(delivered.additionalDeliveryRows, 1);
  assert.equal(delivered.additionalMessageSendCount, 1);
  const stable = assertLarkWeekly7dNotificationAdmissionStable(delivered, final);
  assert.equal(stable.duplicateDeliveryRows, 0);
  assert.equal(stable.additionalMessageSendCountDuringObservation, 0);
});
