import assert from 'node:assert/strict';
import test from 'node:test';

import { buildAllChannelAiPreviewRows } from '../../packages/application/src/reports/build-all-channel-ai-preview.js';
import {
  LARK_NATIVE_AI_CHANNELS,
  LARK_NATIVE_AI_WINDOW_DAYS,
} from '../../packages/config/src/lark-native-ai-all-channel-contract.js';

const GENERATED_AT = Date.parse('2026-08-02T15:00:00.000Z');
const PERIODS = Object.freeze([
  period(1, '2026-07-31', '2026-07-31'),
  period(3, '2026-07-29', '2026-07-31'),
  period(7, '2026-07-25', '2026-07-31'),
  period(30, '2026-07-02', '2026-07-31'),
]);

function period(windowDays, periodStart, periodEnd) {
  return Object.freeze({ windowDays, periodStart, periodEnd, comparisonMode: 'none' });
}

function settings({ duplicateTikTok = false } = {}) {
  const configuredPlatforms = LARK_NATIVE_AI_CHANNELS
    .filter(({ channelKey }) => channelKey !== 'chatwoot')
    .map(({ platform }) => platform);
  const rows = configuredPlatforms.flatMap((platform) => LARK_NATIVE_AI_WINDOW_DAYS.map((windowDays) => ({
    reportSettingKey: `dashboard:${platform}:${windowDays}d`,
    platforms: [platform],
    windowDays,
    accountId: `${platform}:account`,
    enabled: true,
  })));
  if (duplicateTikTok) {
    rows.push({
      reportSettingKey: 'dashboard:tiktok:1d:duplicate',
      platforms: ['tiktok'],
      windowDays: 1,
      accountId: 'tiktok:account',
      enabled: true,
    });
  }
  return rows;
}

function tiktokBundle(periodInput, overrides = {}) {
  const reportId = `dashboard_performance_report::integration_workspace::tiktok::${periodInput.windowDays}d`;
  const metrics = Array.from({ length: 17 }, (_, index) => {
    const available = index < 11;
    return {
      report_id: reportId,
      metric_key: `metric_${String(index + 1).padStart(2, '0')}`,
      display_name: `Metric ${index + 1}`,
      current_value: available ? (index === 0 ? 0 : index * 10) : null,
      compare_value: available ? index * 9 : null,
      change_value: available ? index : null,
      change_percent: available ? index / 100 : null,
      unit: index === 10 ? 'percent' : 'count',
      availability_status: available ? 'available' : 'baseline_incomplete',
      availability_message: available ? 'พร้อมใช้งาน' : 'Baseline ยังไม่ครบ',
      metric_scope: 'summary',
      rank: index + 1,
    };
  });
  if (overrides.metricValue !== undefined) metrics[1] = { ...metrics[1], current_value: overrides.metricValue };
  const dataStatus = overrides.dataStatus ?? 'partial';
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
        comparisonMode: 'none',
      },
      dataStatus,
      coverageRate: dataStatus === 'no_data_confirmed' ? 1 : 0.6471,
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
    metricValues: dataStatus === 'no_data_confirmed' ? [] : metrics,
    topContent: [],
    topAds: [],
  };
}

function input(overrides = {}) {
  return {
    customerKey: 'integration_workspace',
    customerProfile: 'integration_workspace',
    templateVersion: 'all_channel_preview_v1',
    generatedAt: GENERATED_AT,
    utcOffset: '+07:00',
    periods: PERIODS,
    settings: settings(),
    reportBundles: PERIODS.map((item) => tiktokBundle(item)),
    ...overrides,
  };
}

test('builds 40 all-channel Preview rows and never hides channels without Report data', async () => {
  const rows = await buildAllChannelAiPreviewRows(input());
  assert.equal(rows.length, 40);

  for (const windowDays of LARK_NATIVE_AI_WINDOW_DAYS) {
    const windowRows = rows.filter((row) => row.window_days === String(windowDays));
    assert.equal(windowRows.length, 10);
    assert.deepEqual(
      windowRows.map((row) => row.channel_key),
      [...LARK_NATIVE_AI_CHANNELS.map(({ channelKey }) => channelKey), 'executive'],
    );

    const tiktok = windowRows.find((row) => row.channel_key === 'tiktok_organic');
    assert.equal(tiktok.readiness_status, 'report_partial');
    assert.equal(tiktok.generation_status, 'pending');

    for (const channelKey of [
      'facebook_organic', 'instagram_organic', 'youtube_organic',
      'meta_ads', 'google_ads', 'tiktok_ads', 'woocommerce',
    ]) {
      const row = windowRows.find((candidate) => candidate.channel_key === channelKey);
      assert.equal(row.readiness_status, 'report_missing');
      assert.match(row.readiness_message, /ยังไม่มีข้อมูล Report/u);
      assert.equal(row.generation_status, 'skipped');
    }

    const chatwoot = windowRows.find((row) => row.channel_key === 'chatwoot');
    assert.equal(chatwoot.readiness_status, 'configuration_missing');
    assert.match(chatwoot.readiness_message, /ยังไม่ได้ตั้งค่า Report/u);

    const executive = windowRows.find((row) => row.channel_key === 'executive');
    assert.equal(executive.readiness_status, 'report_partial');
    assert.equal(executive.generation_status, 'pending');
    const summary = JSON.parse(executive.metric_summary_json);
    assert.equal(summary.overallCoverageState, 'partial_coverage');
    assert.equal(summary.counts.validated, 1);
    assert.equal(summary.channelStatuses.length, 9);
  }

  assert.ok(rows.every((row) => row.preview_mode === true));
  assert.ok(rows.every((row) => row.notification_eligible === false));
  assert.ok(rows.every((row) => row.sent_to_group === false));
  assert.ok(rows.every((row) => row.sent_at === null));
});

test('preserves observed zero and keeps unavailable metrics null instead of fabricating zero', async () => {
  const rows = await buildAllChannelAiPreviewRows(input());
  const tiktok1d = rows.find((row) => row.channel_key === 'tiktok_organic' && row.window_days === '1');
  const summary = JSON.parse(tiktok1d.metric_summary_json);

  assert.equal(summary.availableMetrics.length, 11);
  assert.equal(summary.unavailableMetrics.length, 6);
  assert.equal(summary.availableMetrics[0].current_value, 0);
  assert.equal(summary.availableMetrics[0].availability_status, 'available');
  assert.equal(summary.unavailableMetrics[0].current_value, null);
  assert.equal(summary.unavailableMetrics[0].availability_status, 'baseline_incomplete');

  const facebook1d = rows.find((row) => row.channel_key === 'facebook_organic' && row.window_days === '1');
  const missingSummary = JSON.parse(facebook1d.metric_summary_json);
  assert.deepEqual(missingSummary.availableMetrics, []);
  assert.deepEqual(missingSummary.unavailableMetrics, []);
  assert.doesNotMatch(facebook1d.insight_summary, /ศูนย์|0/u);
});

test('is idempotent for the same settings, Reports, periods and template', async () => {
  const first = await buildAllChannelAiPreviewRows(input());
  const second = await buildAllChannelAiPreviewRows(input());
  assert.deepEqual(second, first);
  assert.equal(new Set(first.map((row) => row.ai_run_key)).size, 40);
  assert.equal(new Set(first.map((row) => row.dedupe_key)).size, 40);
});

test('shows no_reports_available when every configured channel lacks a Report', async () => {
  const rows = await buildAllChannelAiPreviewRows(input({ reportBundles: [] }));
  const executiveRows = rows.filter((row) => row.channel_key === 'executive');
  assert.equal(executiveRows.length, 4);
  for (const row of executiveRows) {
    assert.equal(row.readiness_status, 'report_missing');
    assert.equal(row.generation_status, 'skipped');
    assert.equal(JSON.parse(row.metric_summary_json).overallCoverageState, 'no_reports_available');
  }
});

test('fails closed on conflicting exact Report checksums but still emits every channel row', async () => {
  const conflicting = [
    ...PERIODS.map((item) => tiktokBundle(item)),
    tiktokBundle(PERIODS[0], { metricValue: 999 }),
  ];
  const rows = await buildAllChannelAiPreviewRows(input({ reportBundles: conflicting }));
  assert.equal(rows.length, 40);
  const tiktok1d = rows.find((row) => row.channel_key === 'tiktok_organic' && row.window_days === '1');
  assert.equal(tiktok1d.readiness_status, 'validation_failed');
  assert.equal(tiktok1d.failure_code, 'AI_REPORT_CHECKSUM_CONFLICT');
  assert.equal(tiktok1d.generation_status, 'failed');

  const executive1d = rows.find((row) => row.channel_key === 'executive' && row.window_days === '1');
  assert.equal(executive1d.readiness_status, 'validation_failed');
  assert.equal(JSON.parse(executive1d.metric_summary_json).overallCoverageState, 'validation_blocked');
});

test('fails closed on duplicate enabled Report settings for the same channel and window', async () => {
  const rows = await buildAllChannelAiPreviewRows(input({ settings: settings({ duplicateTikTok: true }) }));
  const tiktok1d = rows.find((row) => row.channel_key === 'tiktok_organic' && row.window_days === '1');
  assert.equal(tiktok1d.readiness_status, 'validation_failed');
  assert.equal(tiktok1d.failure_code, 'AI_SETTING_IDENTITY_CONFLICT');
});

test('represents a validated empty period as no_data_confirmed rather than a zero metric set', async () => {
  const reportBundles = PERIODS.map((item) => (
    item.windowDays === 1 ? tiktokBundle(item, { dataStatus: 'no_data_confirmed' }) : tiktokBundle(item)
  ));
  const rows = await buildAllChannelAiPreviewRows(input({ reportBundles }));
  const tiktok1d = rows.find((row) => row.channel_key === 'tiktok_organic' && row.window_days === '1');
  assert.equal(tiktok1d.readiness_status, 'no_data_confirmed');
  assert.equal(tiktok1d.generation_status, 'skipped');
  const summary = JSON.parse(tiktok1d.metric_summary_json);
  assert.deepEqual(summary.availableMetrics, []);
  assert.deepEqual(summary.unavailableMetrics, []);
  assert.doesNotMatch(tiktok1d.insight_summary, /ศูนย์|0/u);
});
