import assert from 'node:assert/strict';
import test from 'node:test';

import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE,
} from '../../packages/config/src/lark-native-ai-controlled-preview-contract.js';
import {
  buildLarkNativeAiControlledPreviewReadiness,
} from '../../packages/application/src/reports/build-lark-native-ai-controlled-preview-readiness.js';
import { createLarkNativeAiOfflineFixture } from '../fixtures/lark-native-ai-offline-preview-fixtures.js';

const HEAD = 'a'.repeat(40);
const SCHEMA_SHA = 'b'.repeat(64);
const REMOTE_SHA = 'c'.repeat(64);

test('admits the retained 99.85 percent TikTok baseline-only partial evidence', async () => {
  const input = controlledInput();
  applyTikTokBaselineOnlyPartial(input, {
    tracked: 2024,
    covered: 2021,
    missing: 3,
    coverageRate: 0.9985,
  });

  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  assert.equal(plan.status, 'ready_for_controlled_preview');
  assert.equal(plan.blockers.length, 0);
  const row = plan.larkPlan.rows.find(({ channelKey }) => channelKey === 'tiktok_organic');
  assert.equal(row.fields.data_status, 'partial');
  assert.equal(row.fields.readiness_status, 'report_partial');
  assert.equal(row.fields.generation_status, 'pending');
  assert.equal(row.fields.coverage_rate, null);

  const metricSummary = JSON.parse(row.fields.metric_summary_json);
  assert.equal(metricSummary.availabilityStatus, 'partial');
  assert.equal(metricSummary.coverageStatus, 'partial');
  assert.equal(metricSummary.freshness.status, 'fresh');
  assert.equal(metricSummary.summaryMetrics.length, 17);
  assert.equal(metricSummary.summaryMetrics.some(({ metricKey, currentValue, observed }) => (
    metricKey === 'tiktok:latest_total_views'
      && currentValue === 136515253
      && observed === true
  )), true);
  assert.equal(metricSummary.summaryMetrics.some(({ metricKey, availabilityStatus, currentValue, observed }) => (
    metricKey === 'tiktok:period_views'
      && availabilityStatus === 'baseline_incomplete'
      && currentValue === null
      && observed === false
  )), true);
});

test('keeps a baseline-only partial below 99 percent coverage blocked', async () => {
  const input = controlledInput();
  applyTikTokBaselineOnlyPartial(input, {
    tracked: 2024,
    covered: 1983,
    missing: 41,
    coverageRate: 1983 / 2024,
  });
  await assertTikTokNotComplete(input);
});

test('keeps a baseline-only partial blocked when one current total is unavailable', async () => {
  const input = controlledInput();
  applyTikTokBaselineOnlyPartial(input, {
    tracked: 2024,
    covered: 2021,
    missing: 3,
    coverageRate: 0.9985,
  });
  const views = tiktokMetrics(input).find(({ metric_key: metricKey }) => (
    metricKey === 'tiktok:latest_total_views'
  ));
  views.availability_status = 'baseline_incomplete';
  views.current_value = null;
  views.observed = false;
  await assertTikTokNotComplete(input);
});

test('keeps a baseline-only partial blocked when coverage counters do not reconcile', async () => {
  const input = controlledInput();
  applyTikTokBaselineOnlyPartial(input, {
    tracked: 2024,
    covered: 2021,
    missing: 2,
    coverageRate: 0.9985,
  });
  await assertTikTokNotComplete(input);
});

test('keeps a baseline-only partial blocked when an unexpected summary metric is unavailable', async () => {
  const input = controlledInput();
  applyTikTokBaselineOnlyPartial(input, {
    tracked: 2024,
    covered: 2021,
    missing: 3,
    coverageRate: 0.9985,
  });
  const tiktok = input.offlineInput.channels.find(({ platform }) => platform === 'tiktok');
  tiktok.report.metricValues.push(previewMetric({
    reportId: tiktok.report.reportId,
    metricKey: 'tiktok:unexpected_current_metric',
    currentValue: null,
    compareValue: null,
    availabilityStatus: 'baseline_incomplete',
    observed: false,
    baselineStatus: 'missing',
    rank: 18,
    unit: 'count',
  }));
  await assertTikTokNotComplete(input);
});

test('keeps stale baseline-only partial evidence blocked', async () => {
  const input = controlledInput();
  applyTikTokBaselineOnlyPartial(input, {
    tracked: 2024,
    covered: 2021,
    missing: 3,
    coverageRate: 0.9985,
  });
  const tiktok = input.offlineInput.channels.find(({ platform }) => platform === 'tiktok');
  tiktok.report.freshness.status = 'stale';
  await assertTikTokNotComplete(input);
});

async function assertTikTokNotComplete(input) {
  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.blockers.some(({ code }) => code === 'GOLDEN_DATASET_TIKTOK_NOT_COMPLETE'), true);
}

function controlledInput() {
  const offlineInput = createLarkNativeAiOfflineFixture('executive_mixed_availability').input;
  offlineInput.window.windowDays = 1;
  for (const channel of offlineInput.channels) {
    if (channel.report) channel.report.payload.period.windowDays = 1;
  }
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
      source: 'explicit_sequential_lark_only_handoff',
      validationStatus: 'validated',
      frozen: true,
      evidenceSha256: REMOTE_SHA,
      capturedAt: Date.parse('2026-08-03T10:15:27.677Z'),
      metaRemoteLockReleased: true,
      workerFlagsAllFalse: true,
      previewUrlsDisabled: true,
      productionBlocked: true,
      scheduleEnabled: false,
    },
    approval: {
      confirmation: LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE,
      approvalId: 'approval-20260803-baseline-only-partial',
      approvedAt: Date.parse('2026-08-03T10:15:27.677Z'),
      approvedHeadSha: HEAD,
    },
  };
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
  tiktok.availabilityMessage = 'Validated TikTok 1D Report output is partial.';
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

function tiktokMetrics(input) {
  return input.offlineInput.channels.find(({ platform }) => platform === 'tiktok').report.metricValues;
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
      : 'Period delta is unavailable because the comparison baseline is incomplete.',
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
