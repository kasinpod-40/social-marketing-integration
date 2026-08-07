import assert from 'node:assert/strict';
import test from 'node:test';

import {
  assertLarkNativeAiWeekly7dControlledUatReadback,
  buildLarkNativeAiWeekly7dControlledUat,
  planLarkNativeAiWeekly7dControlledUatWrite,
} from '../../packages/application/src/reports/build-lark-native-ai-weekly-7d-controlled-uat.js';

const GENERATED_AT = Date.parse('2026-08-07T09:30:00.000Z');
const TARGET_PERIOD = Object.freeze({
  windowDays: 7,
  periodStart: '2026-07-21',
  periodEnd: '2026-07-27',
  comparisonMode: 'previous_period',
  compareStart: '2026-07-14',
  compareEnd: '2026-07-20',
});

function metric(reportId, key, current, compare, rank) {
  return {
    report_id: reportId,
    metric_key: key,
    display_name: key,
    current_value: current,
    compare_value: compare,
    change_value: current - compare,
    change_percent: compare === 0 ? null : (current - compare) / compare,
    unit: 'count',
    availability_status: 'available',
    availability_message: 'พร้อมใช้งาน',
    metric_scope: 'summary',
    dimension_type: 'summary',
    dimension_value: 'all',
    rank,
  };
}

function tiktokBundle() {
  const reportId = 'dashboard_performance_report::integration_workspace::tiktok::7d';
  return {
    channelKey: 'tiktok_organic',
    reportId,
    reportSettingKey: 'integration_workspace:tiktok:rolling:7d',
    accountId: 'tiktok:account',
    payload: {
      schemaVersion: 'report_materialization_v1',
      sourceReportId: reportId,
      platformScope: 'tiktok',
      capability: 'organic',
      reportType: 'dashboard_performance_report',
      period: { periodKind: 'rolling_days', ...TARGET_PERIOD },
      dataStatus: 'complete',
      coverageRate: 1,
      metricPayload: {},
      collections: {},
      topContent: [],
      topAds: [],
      source: 'validated_lark_report_output',
      sourceWatermark: 'lark-report:tiktok:7d:latest',
      generatedAt: GENERATED_AT - 1000,
      sourceUnavailableReason: null,
      aiSummary: null,
    },
    metricValues: [
      metric(reportId, 'video_views', 125000, 106000, 1),
      metric(reportId, 'likes', 8900, 7600, 2),
      metric(reportId, 'engagement', 4200, 3500, 3),
    ],
    topContent: [
      {
        rank: 1,
        external_content_id: 'video-1',
        caption: 'คลิปตัวอย่างยอดวิวสูง',
        period_views: 38000,
        period_likes: 2600,
        period_comments: 120,
        period_shares: 90,
        period_engagement: 2810,
        data_status: 'complete',
      },
    ],
    topAds: [],
  };
}

function input() {
  return {
    generatedAt: GENERATED_AT,
    targetPeriod: TARGET_PERIOD,
    settings: [{
      reportSettingKey: 'integration_workspace:tiktok:rolling:7d',
      platforms: ['tiktok'],
      reportType: 'dashboard_performance_report',
      capability: 'organic',
      windowDays: 7,
      accountId: 'tiktok:account',
      enabled: true,
    }],
    reportBundles: [tiktokBundle()],
  };
}

test('builds one isolated 7D Executive UAT row with business-first TikTok evidence', async () => {
  const result = await buildLarkNativeAiWeekly7dControlledUat(input());
  assert.equal(result.ok, true);
  assert.equal(result.contractVersion, 'lark_native_ai_weekly_7d_controlled_uat_v1');
  assert.equal(result.targetPeriod.periodKind, 'rolling_days');
  assert.equal(result.executiveRow.scope_type, 'executive');
  assert.equal(result.executiveRow.window_days, '7');
  assert.equal(result.executiveRow.template_version, 'weekly_executive_quality_v2_uat');
  assert.equal(result.executiveRow.preview_mode, true);
  assert.equal(result.executiveRow.notification_eligible, false);
  assert.equal(result.executiveRow.sent_to_group, false);
  assert.equal(result.executiveRow.generation_status, 'pending');
  assert.equal(result.executiveRow.insight_summary, null);
  assert.equal(result.executiveRow.strengths, null);
  assert.equal(result.executiveRow.weaknesses, null);
  assert.equal(result.executiveRow.recommendations, null);
  assert.equal(result.executiveRow.failure_code, null);
  assert.equal(result.executiveRow.generated_at, null);
  assert.equal(result.executiveRow.sent_at, null);
  assert.equal(result.uiConfiguration.promptVersion, 'lark_native_ai_automation_prompts_v2');
  assert.equal(result.uiConfiguration.actionCount, 4);

  const summary = JSON.parse(result.executiveRow.metric_summary_json);
  assert.equal(summary.evidenceShape, 'executive_business_first_v2');
  const tiktok = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'tiktok_organic');
  assert.equal(tiktok.availableMetrics[0].metric_key, 'video_views');
  assert.equal(tiktok.availableMetrics[0].current_value, 125000);
  assert.equal(tiktok.availableMetrics[0].compare_value, 106000);
  assert.equal(tiktok.topContent[0].caption, 'คลิปตัวอย่างยอดวิวสูง');
  assert.equal(tiktok.topContent[0].period_views, 38000);
  assert.equal(summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'facebook_organic').readinessStatus, 'configuration_missing');
});

test('rejects a non-rolling 7D target period before building any AI row', async () => {
  await assert.rejects(
    () => buildLarkNativeAiWeekly7dControlledUat({
      ...input(),
      targetPeriod: { ...TARGET_PERIOD, periodKind: 'calendar_week' },
    }),
    (error) => error.code === 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_PERIOD_KIND_INVALID',
  );
});

test('plans create, safe update, zero drift and blocks an unsafe retained row', async () => {
  const { executiveRow } = await buildLarkNativeAiWeekly7dControlledUat(input());
  const create = planLarkNativeAiWeekly7dControlledUatWrite({ desiredRow: executiveRow, existingRecords: [] });
  assert.equal(create.status, 'create');
  assert.equal(create.writeCount, 1);

  const existing = { recordId: 'rec_uat', fields: structuredClone(executiveRow) };
  const noOp = planLarkNativeAiWeekly7dControlledUatWrite({ desiredRow: executiveRow, existingRecords: [existing] });
  assert.equal(noOp.status, 'zero_drift');
  assert.equal(noOp.writeCount, 0);

  const drifted = structuredClone(existing);
  drifted.fields.metric_summary_json = JSON.stringify({ stale: true });
  drifted.fields.generation_status = 'generated';
  drifted.fields.insight_summary = 'old UAT output';
  const update = planLarkNativeAiWeekly7dControlledUatWrite({ desiredRow: executiveRow, existingRecords: [drifted] });
  assert.equal(update.status, 'update');
  assert.equal(update.writeCount, 1);
  assert.equal(update.action.fields.insight_summary, null);
  assert.equal(update.action.fields.strengths, null);
  assert.equal(update.action.fields.weaknesses, null);
  assert.equal(update.action.fields.recommendations, null);
  assert.equal(update.action.fields.generation_status, 'pending');

  const unsafe = structuredClone(existing);
  unsafe.fields.sent_to_group = true;
  assert.throws(
    () => planLarkNativeAiWeekly7dControlledUatWrite({ desiredRow: executiveRow, existingRecords: [unsafe] }),
    (error) => error.code === 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_EXISTING_ROW_UNSAFE',
  );
});

test('requires exact one-row readback and preserves all notification gates false', async () => {
  const { executiveRow } = await buildLarkNativeAiWeekly7dControlledUat(input());
  const readback = assertLarkNativeAiWeekly7dControlledUatReadback({
    desiredRow: executiveRow,
    records: [{ recordId: 'rec_uat', fields: structuredClone(executiveRow) }],
  });
  assert.equal(readback.ok, true);
  assert.equal(readback.generationStatus, 'pending');

  assert.throws(
    () => assertLarkNativeAiWeekly7dControlledUatReadback({ desiredRow: executiveRow, records: [] }),
    (error) => error.code === 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_READBACK_COUNT_INVALID',
  );
});
