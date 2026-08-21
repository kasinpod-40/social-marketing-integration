import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildReportRuntimeCloseoutCandidates,
} from '../../scripts/lib/report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_REVIEWED_CHANNELS,
  assertReviewedReportRuntimeCloseoutPreflight,
  assertYouTubeReportRuntimeCloseoutPreflight,
  buildReportRuntimeMultiwindowExecutionPlan,
  resolveReviewedReportRuntimeCloseoutTarget,
} from '../../scripts/lib/report-runtime-closeout-channel-binding.js';
import {
  buildReportRuntimeOrganicPreflightSql,
  buildReportRuntimePreflightSql,
} from '../../scripts/lib/report-runtime-closeout-reviewed-binding.js';

const REQUESTED_AT = Date.parse('2026-08-03T05:00:00Z');

test('shared selector exposes proven Report channels while TikTok Ads stays planned', () => {
  assert.deepEqual(REPORT_RUNTIME_REVIEWED_CHANNELS, [
    'facebook', 'instagram', 'youtube',
    'meta_ads', 'google_ads', 'tiktok_ads',
    'woocommerce', 'chatwoot',
  ]);
  const expected = {
    facebook: ['organic', 'active'],
    instagram: ['organic', 'active'],
    youtube: ['organic', 'active'],
    meta_ads: ['paid_ads', 'active'],
    google_ads: ['paid_ads', 'active'],
    tiktok_ads: ['paid_ads', 'planned'],
    woocommerce: ['commerce', 'active'],
    chatwoot: ['customer_service', 'active'],
  };
  for (const [platformScope, [capability, sourceStatus]] of Object.entries(expected)) {
    const target = resolveReviewedReportRuntimeCloseoutTarget({
      MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: platformScope,
    });
    assert.equal(target.platformScope, platformScope);
    assert.equal(target.capability, capability);
    assert.equal(target.sourceStatus, sourceStatus);
    assert.equal(target.reviewedHandoffRequired, true);
    assert.equal(target.multiwindowRequired, true);
  }
});

test('Organic preflight selects exact datasets and historical Connector alerts do not block', () => {
  const datasets = {
    facebook: ['facebook.content.cumulative', 'facebook.account.daily'],
    instagram: ['instagram.content.cumulative', 'instagram.account.daily'],
    youtube: ['organic_content_cumulative', null],
  };
  for (const [platformScope, [contentDataset, accountDataset]] of Object.entries(datasets)) {
    const target = resolveReviewedReportRuntimeCloseoutTarget({
      MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: platformScope,
    });
    const sql = buildReportRuntimeOrganicPreflightSql({
      target: { ...target, customerKey: 'chemistry_k' },
    });
    assert.match(sql, new RegExp(`platform = '${platformScope}'`, 'u'));
    assert.match(sql, new RegExp(`dataset_key = '${contentDataset.replaceAll('.', '\\.')}'`, 'u'));
    if (accountDataset) assert.match(sql, new RegExp(accountDataset.replaceAll('.', '\\.'), 'u'));
  }

  const instagram = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'instagram',
  });
  assert.equal(assertReviewedReportRuntimeCloseoutPreflight(readyRow({
    coverage_status: 'complete',
    source_watermark: 'instagram-watermark',
    period_end: '2026-07-31',
    source_scope: 'content',
    content_state_count: 26,
    observation_count: 26,
    historical_connector_critical_alerts: 4,
  }), instagram), true);

  const facebook = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'facebook',
  });
  assert.equal(assertReviewedReportRuntimeCloseoutPreflight(readyRow({
    coverage_status: 'complete',
    source_watermark: 'facebook-account-watermark',
    period_end: '2026-07-31',
    source_scope: 'account',
    content_state_count: 0,
    observation_count: 0,
    account_fact_count: 2,
    historical_connector_critical_alerts: 3,
  }), facebook), true);

  assert.equal(assertYouTubeReportRuntimeCloseoutPreflight(readyRow({
    coverage_status: 'complete',
    source_watermark: 'youtube-watermark',
    period_end: '2026-08-01',
    source_scope: 'content',
    content_state_count: 837,
    observation_count: 837,
  })), true);
});

test('Report DLQ guard is target-scoped while unknown payloads still fail closed', () => {
  const facebook = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'facebook',
  });
  const sql = buildReportRuntimePreflightSql({
    target: { ...facebook, customerKey: 'chemistry_k' },
  });
  assert.match(sql, /json_valid\(payload_json\) = 0/u);
  assert.match(sql, /json_extract\(payload_json, '\$\.platformScope'\) IS NULL/u);
  assert.match(sql, /json_extract\(payload_json, '\$\.platformScope'\) = 'facebook'/u);
  assert.doesNotMatch(sql, /json_extract\(payload_json, '\$\.platformScope'\) = 'meta_ads'/u);

  assert.throws(() => assertReviewedReportRuntimeCloseoutPreflight(readyRow({
    coverage_status: 'complete',
    source_watermark: 'facebook-account-watermark',
    period_end: '2026-07-31',
    source_scope: 'account',
    content_state_count: 0,
    observation_count: 0,
    account_fact_count: 2,
    open_report_dlq: 1,
  }), facebook), (error) => (
    error.code === 'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_NOT_READY'
      && error.details.platformScope === 'facebook'
      && error.details.openReportDlq === 1
  ));
});

test('Paid Ads preflight follows Meta detailed ad and Google campaign source grains', () => {
  const meta = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'meta_ads',
  });
  const metaSql = buildReportRuntimePreflightSql({
    target: { ...meta, customerKey: 'chemistry_k' },
  });
  assert.match(metaSql, /report_level IN \('ad'\)/u);
  assert.match(metaSql, /breakdown_key LIKE 'publisher_platform=%'/u);
  assert.match(metaSql, /segment_key = 'none'/u);
  assert.equal(assertReviewedReportRuntimeCloseoutPreflight(readyRow({
    coverage_status: 'complete',
    source_watermark: 'meta-watermark',
    period_end: '2026-07-31',
    ads_summary_fact_count: 170,
    ads_ranking_fact_count: 170,
    ads_entity_count: 170,
    ads_ranking_required: 1,
  }), meta), true);

  const google = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'google_ads',
  });
  const googleSql = buildReportRuntimePreflightSql({
    target: { ...google, customerKey: 'chemistry_k' },
  });
  assert.match(googleSql, /report_level IN \('campaign'\)/u);
  assert.match(googleSql, /breakdown_key = 'all'/u);
  assert.match(googleSql, /segment_key = 'all'/u);
  assert.equal(assertReviewedReportRuntimeCloseoutPreflight(readyRow({
    coverage_status: 'complete',
    source_watermark: 'google-watermark',
    period_end: '2026-07-25',
    ads_summary_fact_count: 285,
    ads_ranking_fact_count: 0,
    ads_entity_count: 760,
    ads_ranking_required: 0,
  }), google), true);

  const tiktokAds = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'tiktok_ads',
  });
  assert.throws(() => assertReviewedReportRuntimeCloseoutPreflight(readyRow({
    coverage_status: 'complete',
    source_watermark: 'tiktok-ads-watermark',
    period_end: '2026-08-01',
    ads_summary_fact_count: 31,
    ads_ranking_fact_count: 100,
    ads_entity_count: 20,
    ads_ranking_required: 1,
  }), tiktokAds), (error) => (
    error.code === 'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_NOT_READY'
      && error.details.sourceStatus === 'planned'
  ));
});

test('WooCommerce and Chatwoot use exact report coverage despite historical alerts', () => {
  const woo = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'woocommerce',
  });
  const wooSql = buildReportRuntimePreflightSql({ target: { ...woo, customerKey: 'chemistry_k' } });
  assert.match(wooSql, /dataset_key = 'woocommerce_orders'/u);
  assert.equal(assertReviewedReportRuntimeCloseoutPreflight(readyRow({
    coverage_status: 'complete',
    coverage_scope_mode: 'full_inventory',
    source_watermark: 'woo-watermark',
    period_end: '2026-07-31',
    daily_fact_count: 212,
    order_state_count: 3_439,
    historical_connector_critical_alerts: 3,
  }), woo), true);

  const chatwoot = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'chatwoot',
  });
  const chatwootSql = buildReportRuntimePreflightSql({
    target: { ...chatwoot, customerKey: 'chemistry_k' },
  });
  assert.match(chatwootSql, /PARTITION BY dataset_key/u);
  assert.match(chatwootSql, /chatwoot\.conversation_daily/u);
  assert.match(chatwootSql, /chatwoot\.account_daily/u);
  assert.doesNotMatch(chatwootSql, /chatwoot\.accounts/u);
  assert.equal(assertReviewedReportRuntimeCloseoutPreflight(readyRow({
    coverage_status: 'complete',
    coverage_required_count: 2,
    coverage_watermark_count: 2,
    source_watermark: 'chatwoot-watermark',
    period_end: '2026-08-01',
    conversation_fact_count: 200,
    account_fact_count: 42,
  }), chatwoot), true);
});

test('active Report incident still blocks while retained Connector alert remains evidence only', () => {
  const instagram = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'instagram',
  });
  assert.throws(() => assertReviewedReportRuntimeCloseoutPreflight(readyRow({
    coverage_status: 'complete',
    source_watermark: 'instagram-watermark',
    period_end: '2026-07-31',
    source_scope: 'content',
    content_state_count: 26,
    observation_count: 26,
    open_report_critical_alerts: 1,
    historical_connector_critical_alerts: 9,
  }), instagram), (error) => (
    error.code === 'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_NOT_READY'
      && error.details.openReportCriticalAlerts === 1
      && error.details.historicalConnectorCriticalAlerts === 9
  ));
});

test('multiwindow planner filters shared presets to exact reviewed 1/3/7/30 order', () => {
  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: REQUESTED_AT,
    periodEnd: '2026-08-01',
    sourceWatermark: 'youtube-watermark',
    platformScope: 'youtube',
    accountKey: 'chemistry_k',
    formulaVersion: 'youtube-organic-v1',
  });
  const required = candidates.filter((row) => [1, 3, 7, 30].includes(row.windowDays));
  const existing = required.filter((row) => [3, 7].includes(row.windowDays)).map((row) => row.reportId);
  const plan = buildReportRuntimeMultiwindowExecutionPlan(candidates, existing, [
    { windowDays: 1, action: 'create_materialization' },
    { windowDays: 3, action: 'refresh_or_repair_materialization' },
    { windowDays: 7, action: 'reuse_or_idempotent_verify' },
    { windowDays: 30, action: 'create_materialization' },
  ]);
  assert.deepEqual(plan.map((row) => row.windowDays), [1, 3, 7, 30]);
  assert.deepEqual(plan.map((row) => row.operation), ['fresh', 'refresh', 'verify', 'fresh']);
});

function readyRow(overrides = {}) {
  return {
    coverage_required_count: 1,
    coverage_watermark_count: 1,
    active_report_work_count: 0,
    active_report_locks: 0,
    open_report_dlq: 0,
    open_report_critical_alerts: 0,
    historical_connector_critical_alerts: 0,
    ...overrides,
  };
}
