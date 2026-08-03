import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_REQUIRED_LARK_FIELDS,
} from '../../packages/config/src/lark-native-ai-controlled-preview-contract.js';
import { buildLarkNativeAiControlledPreviewReadiness } from '../../packages/application/src/reports/build-lark-native-ai-controlled-preview-readiness.js';
import { createLarkNativeAiOfflineFixture } from '../fixtures/lark-native-ai-offline-preview-fixtures.js';

const HEAD = 'a'.repeat(40);
const SCHEMA_SHA = 'b'.repeat(64);
const REMOTE_SHA = 'c'.repeat(64);

for (const windowDays of [1, 3, 7, 30]) {
  test(`builds exact all-channel controlled-preview plan for ${windowDays}D`, async () => {
    const input = controlledInput({ windowDays, lockReleased: true, approved: true });
    const plan = await buildLarkNativeAiControlledPreviewReadiness(input);

    assert.equal(plan.status, 'ready_for_controlled_preview');
    assert.equal(plan.runIdentity.windowDays, windowDays);
    assert.equal(plan.larkPlan.rowCount, 10);
    assert.equal(plan.larkPlan.expectedRowCount, 10);
    assert.equal(plan.larkPlan.operationsEvidenceIncludedInExecutive, true);
    assert.equal(plan.blockers.length, 0);
    assert.equal(plan.safety.executorImplemented, false);
    assert.equal(plan.safety.executionAuthorized, false);
    assert.equal(plan.safety.aiCallCount, 0);
    assert.equal(plan.safety.larkRecordWriteCount, 0);
    assert.equal(plan.safety.production, 'BLOCKED');

    const channelKeys = plan.larkPlan.rows.map(({ channelKey }) => channelKey);
    assert.deepEqual(channelKeys, [
      'tiktok_organic', 'facebook_organic', 'instagram_organic', 'youtube_organic',
      'meta_ads', 'google_ads', 'tiktok_ads', 'woocommerce', 'chatwoot', 'executive',
    ]);
    assert.equal(channelKeys.includes('operations'), false);
    const instagram = plan.larkPlan.rows.find(({ channelKey }) => channelKey === 'instagram_organic');
    const executive = plan.larkPlan.rows.at(-1);
    const vector = JSON.parse(executive.fields.channel_status_vector_json);
    assert.equal(vector.some(({ platform }) => platform === 'operations'), true);
    assert.equal(instagram.fields.readiness_status, 'report_partial');
    assert.equal(instagram.fields.coverage_rate, null);
    assert.equal(executive.fields.coverage_rate, null);
    assert.equal(executive.fields.notification_eligible, false);
    assert.equal(executive.fields.preview_mode, true);
    assert.equal(executive.fields.sent_to_group, false);
    for (const field of LARK_NATIVE_AI_CONTROLLED_PREVIEW_REQUIRED_LARK_FIELDS) {
      assert.equal(Object.prototype.hasOwnProperty.call(executive.fields, field), true, field);
    }
  });
}

test('waits for the Meta Remote lock without creating a hard blocker', async () => {
  const plan = await buildLarkNativeAiControlledPreviewReadiness(
    controlledInput({ lockReleased: false, approved: false }),
  );
  assert.equal(plan.status, 'waiting_for_remote_lock');
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.nextAction, 'wait_for_meta_remote_lock_release');
});

test('requires exact explicit approval after the Remote lock is released', async () => {
  const plan = await buildLarkNativeAiControlledPreviewReadiness(
    controlledInput({ lockReleased: true, approved: false }),
  );
  assert.equal(plan.status, 'awaiting_explicit_preview_approval');
  assert.equal(plan.blockers.length, 0);
  assert.equal(plan.approval.present, false);
});

test('blocks when Lark schema zero-drift authority is missing', async () => {
  const input = controlledInput({ lockReleased: true, approved: true });
  delete input.schemaAuthority;
  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers.some(({ code }) => code === 'SCHEMA_AUTHORITY_REQUIRED'), true);
});

test('blocks when TikTok Golden Dataset is no longer complete', async () => {
  const input = controlledInput({ lockReleased: true, approved: true });
  const tiktok = input.offlineInput.channels.find(({ platform }) => platform === 'tiktok');
  tiktok.availabilityStatus = 'partial';
  tiktok.coverageStatus = 'partial';
  tiktok.report.payload.dataStatus = 'partial';
  tiktok.report.payload.coverageRate = 0.5;
  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers.some(({ code }) => code === 'GOLDEN_DATASET_TIKTOK_NOT_COMPLETE'), true);
});

test('admits a verified TikTok baseline-only partial Golden Dataset without relabeling it complete', async () => {
  const input = controlledInput({ windowDays: 1, lockReleased: true, approved: true });
  applyTikTokBaselineOnlyPartial(input, {
    tracked: 2024,
    covered: 2021,
    missing: 3,
    coverageRate: 0.9985,
  });

  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  assert.equal(plan.status, 'ready_for_controlled_preview');
  assert.equal(plan.blockers.length, 0);
  const tiktokRow = plan.larkPlan.rows.find(({ channelKey }) => channelKey === 'tiktok_organic');
  assert.equal(tiktokRow.fields.readiness_status, 'report_partial');
  assert.equal(tiktokRow.fields.data_status, 'report_partial');
  const metrics = JSON.parse(tiktokRow.fields.metric_summary_json).summaryMetrics;
  assert.equal(metrics.some(({ metricKey, currentValue }) => (
    metricKey === 'tiktok:latest_total_views' && currentValue === 136515253
  )), true);
  assert.equal(metrics.some(({ metricKey, availabilityStatus }) => (
    metricKey === 'tiktok:period_views' && availabilityStatus === 'baseline_incomplete'
  )), true);
});

test('keeps baseline-only partial blocked below 99 percent coverage', async () => {
  const input = controlledInput({ windowDays: 1, lockReleased: true, approved: true });
  applyTikTokBaselineOnlyPartial(input, {
    tracked: 2024,
    covered: 1983,
    missing: 41,
    coverageRate: 1983 / 2024,
  });
  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers.some(({ code }) => code === 'GOLDEN_DATASET_TIKTOK_NOT_COMPLETE'), true);
});

test('keeps baseline-only partial blocked when a current total is unavailable', async () => {
  const input = controlledInput({ windowDays: 1, lockReleased: true, approved: true });
  applyTikTokBaselineOnlyPartial(input, {
    tracked: 2024,
    covered: 2021,
    missing: 3,
    coverageRate: 0.9985,
  });
  const tiktok = input.offlineInput.channels.find(({ platform }) => platform === 'tiktok');
  const views = tiktok.report.metricValues.find(({ metric_key: metricKey }) => (
    metricKey === 'tiktok:latest_total_views'
  ));
  views.availability_status = 'baseline_incomplete';
  views.current_value = null;
  views.observed = false;
  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers.some(({ code }) => code === 'GOLDEN_DATASET_TIKTOK_NOT_COMPLETE'), true);
});

test('keeps baseline-only partial blocked when coverage counters do not reconcile', async () => {
  const input = controlledInput({ windowDays: 1, lockReleased: true, approved: true });
  applyTikTokBaselineOnlyPartial(input, {
    tracked: 2024,
    covered: 2021,
    missing: 2,
    coverageRate: 0.9985,
  });
  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers.some(({ code }) => code === 'GOLDEN_DATASET_TIKTOK_NOT_COMPLETE'), true);
});

test('rejects approval bound to another exact Head', async () => {
  const input = controlledInput({ lockReleased: true, approved: true });
  input.approval.approvedHeadSha = 'd'.repeat(40);
  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers.some(({ code }) => code === 'APPROVAL_INVALID_HEAD_MISMATCH'), true);
});

test('same evidence produces stable run, evidence and row dedupe identities', async () => {
  const input = controlledInput({ lockReleased: true, approved: true });
  const first = await buildLarkNativeAiControlledPreviewReadiness(structuredClone(input));
  const second = await buildLarkNativeAiControlledPreviewReadiness(structuredClone(input));
  assert.equal(first.previewRunKey, second.previewRunKey);
  assert.equal(first.evidenceChecksum, second.evidenceChecksum);
  assert.equal(first.dedupeKey, second.dedupeKey);
  assert.equal(first.planId, second.planId);
  assert.deepEqual(
    first.larkPlan.rows.map(({ fields }) => fields.dedupe_key),
    second.larkPlan.rows.map(({ fields }) => fields.dedupe_key),
  );
});

test('observed zero remains zero and unavailable channels remain skipped', async () => {
  const input = controlledInput({ lockReleased: true, approved: true });
  const tiktok = input.offlineInput.channels.find(({ platform }) => platform === 'tiktok');
  tiktok.report.metricValues[0].current_value = 0;
  tiktok.report.metricValues[0].observed = true;
  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  const tiktokRow = plan.larkPlan.rows.find(({ channelKey }) => channelKey === 'tiktok_organic');
  const youtubeRow = plan.larkPlan.rows.find(({ channelKey }) => channelKey === 'youtube_organic');
  const metrics = JSON.parse(tiktokRow.fields.metric_summary_json).summaryMetrics;
  assert.equal(metrics[0].currentValue, 0);
  assert.equal(youtubeRow.fields.generation_status, 'skipped');
  assert.equal(youtubeRow.fields.data_status, 'report_missing');
  assert.equal(youtubeRow.fields.coverage_rate, null);
});

function controlledInput({ windowDays = 30, lockReleased, approved }) {
  const offlineInput = createLarkNativeAiOfflineFixture('executive_mixed_availability').input;
  setWindow(offlineInput, windowDays);
  return {
    offlineInput,
    repository: { branch: 'main', clean: true, exactHeadSha: HEAD },
    schemaAuthority: {
      validationStatus: 'validated',
      frozen: true,
      targetTable: '🧠 MKT_AI_Report_Runs',
      status: 'zero_drift',
      requiredViewCount: 6,
      exactViewFilterCount: 6,
      remainingLogicalActionCount: 0,
      evidenceSha256: SCHEMA_SHA,
    },
    remoteAuthority: {
      source: 'all_channel_audit_workstream',
      validationStatus: 'validated',
      frozen: true,
      evidenceSha256: REMOTE_SHA,
      capturedAt: Date.parse('2026-08-03T05:00:00.000Z'),
      metaRemoteLockReleased: lockReleased,
      workerFlagsAllFalse: true,
      previewUrlsDisabled: true,
      productionBlocked: true,
      scheduleEnabled: false,
    },
    approval: approved ? {
      confirmation: LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE,
      approvalId: 'approval-20260803-controlled-preview',
      approvedAt: Date.parse('2026-08-03T05:10:00.000Z'),
      approvedHeadSha: HEAD,
    } : undefined,
  };
}

function setWindow(input, windowDays) {
  input.window.windowDays = windowDays;
  for (const channel of input.channels) {
    if (!channel.report) continue;
    channel.report.payload.period.windowDays = windowDays;
  }
}

function applyTikTokBaselineOnlyPartial(input, {
  tracked,
  covered,
  missing,
  coverageRate,
}) {
  const tiktok = input.offlineInput.channels.find(({ platform }) => platform === 'tiktok');
  const reportId = tiktok.report.reportId;
  tiktok.availabilityStatus = 'partial';
  tiktok.coverageStatus = 'partial';
  tiktok.availabilityMessage = 'Validated TikTok Report output is partial because baseline coverage is incomplete.';
  tiktok.report.payload.dataStatus = 'partial';
  tiktok.report.payload.coverageRate = coverageRate;
  tiktok.report.metricValues = [
    baselineMetric(reportId, 'tiktok:period_views', 1),
    baselineMetric(reportId, 'tiktok:period_likes', 2),
    baselineMetric(reportId, 'tiktok:period_comments', 3),
    baselineMetric(reportId, 'tiktok:period_shares', 4),
    baselineMetric(reportId, 'tiktok:period_engagement', 5),
    baselineMetric(reportId, 'tiktok:period_engagement_rate', 6, 'ratio'),
    availableMetric(reportId, 'tiktok:latest_total_views', 136515253, 7),
    availableMetric(reportId, 'tiktok:latest_total_likes', 6354691, 8),
    availableMetric(reportId, 'tiktok:latest_total_comments', 26002, 9),
    availableMetric(reportId, 'tiktok:latest_total_shares', 578086, 10),
    availableMetric(reportId, 'tiktok:latest_total_engagement', 6958779, 11),
    availableMetric(reportId, 'tiktok:latest_engagement_rate', 0.051, 12, 'ratio'),
    availableMetric(reportId, 'tiktok:new_content_count', 0, 13),
    availableMetric(reportId, 'tiktok:tracked_content_count', tracked, 14),
    availableMetric(reportId, 'tiktok:baseline_covered_content_count', covered, 15),
    availableMetric(reportId, 'tiktok:baseline_missing_content_count', missing, 16),
    availableMetric(reportId, 'tiktok:baseline_coverage_rate', coverageRate, 17, 'ratio'),
  ];
}

function baselineMetric(reportId, metricKey, rank, unit = 'count') {
  return previewMetric({
    reportId,
    metricKey,
    currentValue: null,
    compareValue: metricKey.endsWith('_rate') ? null : 0,
    availabilityStatus: 'baseline_incomplete',
    observed: false,
    baselineStatus: metricKey.endsWith('_rate') ? 'missing' : 'complete',
    rank,
    unit,
  });
}

function availableMetric(reportId, metricKey, currentValue, rank, unit = 'count') {
  return previewMetric({
    reportId,
    metricKey,
    currentValue,
    compareValue: currentValue,
    availabilityStatus: 'available',
    observed: true,
    baselineStatus: 'complete',
    rank,
    unit,
  });
}

function previewMetric({
  reportId,
  metricKey,
  currentValue,
  compareValue,
  availabilityStatus,
  observed,
  baselineStatus,
  rank,
  unit,
}) {
  return {
    report_id: reportId,
    metric_key: metricKey,
    display_name: metricKey,
    current_value: currentValue,
    compare_value: compareValue,
    change_value: currentValue === null || compareValue === null ? null : currentValue - compareValue,
    change_percent: null,
    unit,
    currency: null,
    availability_status: availabilityStatus,
    availability_message: availabilityStatus === 'available'
      ? 'Validated current value.'
      : 'Current period delta is unavailable because the content baseline is incomplete.',
    metric_scope: 'summary',
    dimension_type: 'summary',
    dimension_value: 'all',
    rank,
    baseline_status: baselineStatus,
    aggregation_method: 'direct_observation',
    ratio_numerator_metric_key: null,
    ratio_denominator_metric_key: null,
    weight_metric_key: null,
    observed,
  };
}
