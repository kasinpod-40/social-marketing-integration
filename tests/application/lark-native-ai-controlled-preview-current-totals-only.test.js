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

for (const evidence of [
  { windowDays: 7, newContent: 3, tracked: 2024, covered: 3, missing: 2021, coverageRate: 0.0015 },
  { windowDays: 30, newContent: 26, tracked: 2024, covered: 26, missing: 1998, coverageRate: 0.0128 },
]) {
  test(`admits ${evidence.windowDays}D current totals while suppressing incomplete period comparison`, async () => {
    const input = controlledInput(evidence.windowDays);
    applyTikTokCurrentTotalsOnlyPartial(input, evidence);

    const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
    assert.equal(plan.status, 'ready_for_controlled_preview');
    assert.equal(plan.blockers.length, 0);
    assert.deepEqual(plan.goldenDatasetAuthority, {
      platform: 'tiktok',
      admissionClass: 'current_totals_only_low_baseline',
      previewEligible: true,
      currentTotalsReady: true,
      comparisonReady: false,
      periodDeltasSuppressed: true,
      baselineCoverageRate: evidence.coverageRate,
      trackedContentCount: evidence.tracked,
      coveredContentCount: evidence.covered,
      missingContentCount: evidence.missing,
      newContentCount: evidence.newContent,
    });

    const row = plan.larkPlan.rows.find(({ channelKey }) => channelKey === 'tiktok_organic');
    assert.equal(row.fields.data_status, 'partial');
    assert.equal(row.fields.readiness_status, 'report_partial');
    assert.equal(row.fields.generation_status, 'pending');
    assert.equal(row.fields.coverage_rate, null);

    const summary = JSON.parse(row.fields.metric_summary_json);
    assert.equal(summary.availabilityStatus, 'partial');
    assert.equal(summary.coverageStatus, 'partial');
    assert.equal(summary.freshness.status, 'fresh');
    assert.equal(summary.summaryMetrics.length, 17);
    assert.equal(summary.summaryMetrics.every((metric) => (
      metric.metricKey.startsWith('tiktok:period_')
        ? metric.availabilityStatus === 'baseline_incomplete'
          && metric.currentValue === null
          && metric.observed === false
        : true
    )), true);
    assert.equal(summary.summaryMetrics.some(({ metricKey, currentValue, compareValue, observed }) => (
      metricKey === 'tiktok:latest_total_views'
        && currentValue === 136515253
        && compareValue === null
        && observed === true
    )), true);
  });
}

test('keeps low-baseline evidence blocked when the selected window has no new content', async () => {
  const input = controlledInput(7);
  applyTikTokCurrentTotalsOnlyPartial(input, {
    windowDays: 7,
    newContent: 0,
    tracked: 2024,
    covered: 3,
    missing: 2021,
    coverageRate: 0.0015,
  });
  await assertTikTokBlocked(input);
});

test('keeps low-baseline evidence blocked when zero content has baseline coverage', async () => {
  const input = controlledInput(30);
  applyTikTokCurrentTotalsOnlyPartial(input, {
    windowDays: 30,
    newContent: 26,
    tracked: 2024,
    covered: 0,
    missing: 2024,
    coverageRate: 0,
  });
  await assertTikTokBlocked(input);
});

test('keeps low-baseline evidence blocked when a current total is unavailable', async () => {
  const input = controlledInput(30);
  applyTikTokCurrentTotalsOnlyPartial(input, {
    windowDays: 30,
    newContent: 26,
    tracked: 2024,
    covered: 26,
    missing: 1998,
    coverageRate: 0.0128,
  });
  const views = tiktokMetrics(input).find(({ metric_key: metricKey }) => (
    metricKey === 'tiktok:latest_total_views'
  ));
  views.availability_status = 'baseline_incomplete';
  views.current_value = null;
  views.observed = false;
  await assertTikTokBlocked(input);
});

test('keeps low-baseline evidence blocked when counters do not reconcile', async () => {
  const input = controlledInput(30);
  applyTikTokCurrentTotalsOnlyPartial(input, {
    windowDays: 30,
    newContent: 26,
    tracked: 2024,
    covered: 26,
    missing: 1997,
    coverageRate: 0.0128,
  });
  await assertTikTokBlocked(input);
});

async function assertTikTokBlocked(input) {
  const plan = await buildLarkNativeAiControlledPreviewReadiness(input);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.goldenDatasetAuthority.previewEligible, false);
  assert.equal(plan.blockers.some(({ code }) => code === 'GOLDEN_DATASET_TIKTOK_NOT_COMPLETE'), true);
}

function controlledInput(windowDays) {
  const offlineInput = createLarkNativeAiOfflineFixture('executive_mixed_availability').input;
  offlineInput.window.windowDays = windowDays;
  for (const channel of offlineInput.channels) {
    if (channel.report) channel.report.payload.period.windowDays = windowDays;
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
      capturedAt: Date.parse('2026-08-03T11:02:57.523Z'),
      metaRemoteLockReleased: true,
      workerFlagsAllFalse: true,
      previewUrlsDisabled: true,
      productionBlocked: true,
      scheduleEnabled: false,
    },
    approval: {
      confirmation: LARK_NATIVE_AI_CONTROLLED_PREVIEW_APPROVAL_PHRASE,
      approvalId: `approval-20260803-current-totals-only-${windowDays}d`,
      approvedAt: Date.parse('2026-08-03T11:02:57.523Z'),
      approvedHeadSha: HEAD,
    },
  };
}

function applyTikTokCurrentTotalsOnlyPartial(input, {
  windowDays,
  newContent,
  tracked,
  covered,
  missing,
  coverageRate,
}) {
  const tiktok = input.offlineInput.channels.find(({ platform }) => platform === 'tiktok');
  const reportId = tiktok.report.reportId;
  tiktok.availabilityStatus = 'partial';
  tiktok.coverageStatus = 'partial';
  tiktok.availabilityMessage = `Validated TikTok ${windowDays}D current totals are available; period comparison is suppressed because baseline coverage is incomplete.`;
  tiktok.report.payload.dataStatus = 'partial';
  tiktok.report.payload.coverageRate = coverageRate;
  tiktok.report.metricValues = [
    baselineMetric(reportId, 'tiktok:period_views', 1),
    baselineMetric(reportId, 'tiktok:period_likes', 2),
    baselineMetric(reportId, 'tiktok:period_comments', 3),
    baselineMetric(reportId, 'tiktok:period_shares', 4),
    baselineMetric(reportId, 'tiktok:period_engagement', 5),
    baselineMetric(reportId, 'tiktok:period_engagement_rate', 6, 'ratio'),
    currentMetric(reportId, 'tiktok:latest_total_views', 136515253, 7),
    currentMetric(reportId, 'tiktok:latest_total_likes', 6354691, 8),
    currentMetric(reportId, 'tiktok:latest_total_comments', 26002, 9),
    currentMetric(reportId, 'tiktok:latest_total_shares', 578086, 10),
    currentMetric(reportId, 'tiktok:latest_total_engagement', 6958779, 11),
    currentMetric(reportId, 'tiktok:latest_engagement_rate', 0.051, 12, 'ratio'),
    qualityMetric(reportId, 'tiktok:new_content_count', newContent, 13),
    qualityMetric(reportId, 'tiktok:tracked_content_count', tracked, 14),
    qualityMetric(reportId, 'tiktok:baseline_covered_content_count', covered, 15),
    qualityMetric(reportId, 'tiktok:baseline_missing_content_count', missing, 16),
    qualityMetric(reportId, 'tiktok:baseline_coverage_rate', coverageRate, 17, 'ratio'),
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
    compareValue: null,
    availabilityStatus: 'baseline_incomplete',
    observed: false,
    baselineStatus: 'missing',
    rank,
    unit,
  });
}

function currentMetric(reportId, metricKey, currentValue, rank, unit = 'count') {
  return previewMetric({
    reportId,
    metricKey,
    currentValue,
    compareValue: null,
    availabilityStatus: 'available',
    observed: true,
    baselineStatus: 'missing',
    rank,
    unit,
  });
}

function qualityMetric(reportId, metricKey, currentValue, rank, unit = 'count') {
  return previewMetric({
    reportId,
    metricKey,
    currentValue,
    compareValue: 0,
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
