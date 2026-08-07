import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAllChannelAiPreviewRows } from '../../packages/application/src/reports/build-all-channel-ai-preview.js';
import {
  LARK_NATIVE_AI_CHANNELS,
  LARK_NATIVE_AI_WINDOW_DAYS,
} from '../../packages/config/src/lark-native-ai-all-channel-contract.js';

const GENERATED_AT = Date.parse('2026-08-07T08:00:00.000Z');
const PERIODS = Object.freeze([
  period(1, '2026-08-06', '2026-08-06'),
  period(3, '2026-08-04', '2026-08-06'),
  period(7, '2026-07-31', '2026-08-06', '2026-07-24', '2026-07-30'),
  period(30, '2026-07-08', '2026-08-06'),
]);

function period(windowDays, periodStart, periodEnd, compareStart = null, compareEnd = null) {
  return Object.freeze({
    windowDays,
    periodStart,
    periodEnd,
    comparisonMode: compareStart ? 'previous_period' : 'none',
    compareStart,
    compareEnd,
  });
}

function settings() {
  return LARK_NATIVE_AI_CHANNELS.flatMap(({ platform, capability }) => (
    LARK_NATIVE_AI_WINDOW_DAYS.map((windowDays) => ({
      reportSettingKey: `dashboard:${platform}:${windowDays}d`,
      platforms: [platform],
      capability,
      windowDays,
      accountId: `${platform}:account`,
      enabled: true,
    }))
  ));
}

function metric(reportId, index, overrides = {}) {
  return {
    report_id: reportId,
    metric_key: overrides.metricKey ?? `metric_${String(index).padStart(2, '0')}`,
    display_name: overrides.displayName ?? `Metric ${index}`,
    current_value: overrides.currentValue ?? index * 100,
    compare_value: overrides.compareValue ?? index * 90,
    change_value: overrides.changeValue ?? index * 10,
    change_percent: overrides.changePercent ?? 0.1,
    unit: overrides.unit ?? 'count',
    availability_status: 'available',
    availability_message: 'พร้อมใช้งาน',
    metric_scope: overrides.metricScope ?? 'summary',
    dimension_type: overrides.dimensionType ?? 'summary',
    dimension_value: overrides.dimensionValue ?? 'all',
    rank: index,
  };
}

function tiktokBundle(periodInput) {
  const reportId = `dashboard_performance_report::integration_workspace::tiktok::${periodInput.windowDays}d`;
  const metrics = periodInput.windowDays === 7
    ? Array.from({ length: 30 }, (_, offset) => {
      const index = offset + 1;
      if (index === 1) return metric(reportId, index, {
        metricKey: 'video_views', displayName: 'Video Views', currentValue: 125000,
        compareValue: 106000, changeValue: 19000, changePercent: 0.1792,
      });
      if (index === 2) return metric(reportId, index, {
        metricKey: 'likes', displayName: 'Likes', currentValue: 8900,
        compareValue: 7600, changeValue: 1300, changePercent: 0.1711,
      });
      if (index === 3) return metric(reportId, index, {
        metricKey: 'engagement_rate', displayName: 'Engagement Rate', currentValue: 0.084,
        compareValue: 0.075, changeValue: 0.009, changePercent: 0.12, unit: 'ratio',
      });
      return metric(reportId, index);
    })
    : [metric(reportId, 1, { metricKey: 'video_views', displayName: 'Video Views' })];

  const topContent = periodInput.windowDays === 7
    ? Array.from({ length: 5 }, (_, offset) => ({
      rank: offset + 1,
      content_key: `tiktok:content:${offset + 1}`,
      title: `คลิปตัวอย่าง ${offset + 1}`,
      views: 38000 - (offset * 4000),
      likes: 2600 - (offset * 250),
    }))
    : [];

  return {
    channelKey: 'tiktok_organic',
    reportId,
    reportSettingKey: `dashboard:tiktok:${periodInput.windowDays}d`,
    accountId: 'tiktok:account',
    payload: {
      schemaVersion: 'report_materialization_v1',
      sourceReportId: reportId,
      platformScope: 'tiktok',
      capability: 'organic',
      reportType: 'dashboard_performance_report',
      period: {
        periodKind: 'rolling_days',
        windowDays: periodInput.windowDays,
        periodStart: periodInput.periodStart,
        periodEnd: periodInput.periodEnd,
        comparisonMode: periodInput.comparisonMode,
        compareStart: periodInput.compareStart,
        compareEnd: periodInput.compareEnd,
      },
      dataStatus: 'complete',
      coverageRate: 1,
      metricPayload: {},
      collections: {},
      topContent: [],
      topAds: [],
      source: 'validated_report_materialization',
      sourceWatermark: `watermark:${periodInput.windowDays}d`,
      generatedAt: GENERATED_AT + periodInput.windowDays,
      sourceUnavailableReason: null,
      aiSummary: null,
    },
    metricValues: metrics,
    topContent,
    topAds: [],
  };
}

function input() {
  return {
    customerKey: 'integration_workspace',
    customerProfile: 'integration_workspace',
    templateVersion: 'all_channel_preview_v1',
    generatedAt: GENERATED_AT,
    utcOffset: '+07:00',
    periods: PERIODS,
    settings: settings(),
    reportBundles: PERIODS.map(tiktokBundle),
  };
}

test('carries bounded 7D channel performance and Top Content into Executive AI evidence', async () => {
  const rows = await buildAllChannelAiPreviewRows(input());
  const executive = rows.find((row) => row.channel_key === 'executive' && row.window_days === '7');
  assert.ok(executive);

  const summary = JSON.parse(executive.metric_summary_json);
  assert.equal(summary.evidenceShape, 'executive_business_first_v2');
  assert.equal(summary.channelBusinessEvidence.length, 9);
  assert.equal(summary.channelBusinessEvidence.some(({ channelKey }) => channelKey === 'operations'), false);

  const tiktok = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'tiktok_organic');
  assert.equal(tiktok.displayName, 'TikTok Organic');
  assert.equal(tiktok.readinessStatus, 'report_available');
  assert.equal(tiktok.availableMetrics.length, 24);
  assert.equal(tiktok.availableMetrics[0].metric_key, 'video_views');
  assert.equal(tiktok.availableMetrics[0].current_value, 125000);
  assert.equal(tiktok.availableMetrics[0].compare_value, 106000);
  assert.equal(tiktok.availableMetrics[0].change_percent, 0.1792);
  assert.equal(tiktok.topContent.length, 3);
  assert.equal(tiktok.topContent[0].title, 'คลิปตัวอย่าง 1');
  assert.equal(tiktok.topContent[0].views, 38000);

  const facebook = summary.channelBusinessEvidence.find(({ channelKey }) => channelKey === 'facebook_organic');
  assert.equal(facebook.displayName, 'Facebook Organic');
  assert.equal(facebook.readinessStatus, 'report_missing');
  assert.deepEqual(facebook.availableMetrics, []);
  assert.deepEqual(facebook.topContent, []);

  const statusVector = JSON.parse(executive.channel_status_vector_json);
  assert.equal(statusVector.length, 9);
  assert.equal(statusVector.find(({ channelKey }) => channelKey === 'facebook_organic').displayName, 'Facebook Organic');
});

test('keeps 7D previous-period evidence explicit and deterministic for weekly AI generation', async () => {
  const first = await buildAllChannelAiPreviewRows(input());
  const second = await buildAllChannelAiPreviewRows(input());
  const firstExecutive = first.find((row) => row.channel_key === 'executive' && row.window_days === '7');
  const secondExecutive = second.find((row) => row.channel_key === 'executive' && row.window_days === '7');

  assert.equal(firstExecutive.comparison_mode, 'previous_period');
  assert.equal(firstExecutive.compare_start, Date.parse('2026-07-23T17:00:00.000Z'));
  assert.equal(firstExecutive.compare_end, Date.parse('2026-07-29T17:00:00.000Z'));
  assert.equal(firstExecutive.metric_summary_json, secondExecutive.metric_summary_json);
  assert.equal(firstExecutive.source_report_checksum, secondExecutive.source_report_checksum);
  assert.equal(firstExecutive.dedupe_key, secondExecutive.dedupe_key);
});
