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

test('shared selector exposes ready and waiting Report channels through existing contracts', () => {
  assert.deepEqual(REPORT_RUNTIME_REVIEWED_CHANNELS, [
    'facebook', 'instagram', 'youtube',
    'meta_ads', 'google_ads', 'tiktok_ads',
    'woocommerce', 'chatwoot',
  ]);
  const expected = {
    facebook: ['organic', 'uat_pending'],
    instagram: ['organic', 'uat_pending'],
    youtube: ['organic', 'active'],
    meta_ads: ['paid_ads', 'uat_pending'],
    google_ads: ['paid_ads', 'uat_pending'],
    tiktok_ads: ['paid_ads', 'planned'],
    woocommerce: ['commerce', 'active'],
    chatwoot: ['customer_service', 'uat_pending'],
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

test('Organic preflight binds Facebook, Instagram and YouTube without channel-specific SQL', () => {
  for (const platformScope of ['facebook', 'instagram', 'youtube']) {
    const target = resolveReviewedReportRuntimeCloseoutTarget({
      MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: platformScope,
    });
    const sql = buildReportRuntimeOrganicPreflightSql({
      target: { ...target, customerKey: 'chemistry_k' },
    });
    assert.match(sql, new RegExp(`platform = '${platformScope}'`, 'u'));
    assert.match(sql, /dataset_key = 'organic_content_cumulative'/u);
    assert.equal(assertReviewedReportRuntimeCloseoutPreflight({
      coverage_status: 'complete',
      source_watermark: `${platformScope}-watermark`,
      period_end: '2026-08-01',
      content_state_count: 10,
      observation_count: 20,
      active_report_locks: 0,
      open_report_dlq: 0,
      open_report_critical_alerts: 0,
    }, target), true);
  }
  assert.equal(assertYouTubeReportRuntimeCloseoutPreflight({
    coverage_status: 'complete',
    source_watermark: 'youtube-watermark',
    period_end: '2026-08-01',
    content_state_count: 837,
    observation_count: 837,
    active_report_locks: 0,
    open_report_dlq: 0,
    open_report_critical_alerts: 0,
  }), true);
});

test('Paid Ads preflight uses account and ad facts while planned TikTok Ads stays blocked', () => {
  for (const platformScope of ['meta_ads', 'google_ads']) {
    const target = resolveReviewedReportRuntimeCloseoutTarget({
      MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: platformScope,
    });
    const sql = buildReportRuntimePreflightSql({
      target: { ...target, customerKey: 'chemistry_k' },
    });
    assert.match(sql, /FROM ads_daily_facts/u);
    assert.match(sql, /report_level = 'account'/u);
    assert.match(sql, /report_level = 'ad'/u);
    assert.match(sql, /breakdown_key = 'none'/u);
    assert.match(sql, /segment_key = 'none'/u);
    assert.equal(assertReviewedReportRuntimeCloseoutPreflight({
      coverage_status: 'complete',
      source_watermark: `${platformScope}-watermark`,
      period_end: '2026-08-01',
      ads_summary_fact_count: 31,
      ads_ranking_fact_count: 100,
      ads_entity_count: 20,
      active_report_locks: 0,
      open_report_dlq: 0,
      open_report_critical_alerts: 0,
    }, target), true);
  }

  const tiktokAds = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'tiktok_ads',
  });
  assert.throws(() => assertReviewedReportRuntimeCloseoutPreflight({
    coverage_status: 'complete',
    source_watermark: 'tiktok-ads-watermark',
    period_end: '2026-08-01',
    ads_summary_fact_count: 31,
    ads_ranking_fact_count: 100,
    ads_entity_count: 20,
    active_report_locks: 0,
    open_report_dlq: 0,
    open_report_critical_alerts: 0,
  }, tiktokAds), (error) => (
    error.code === 'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_NOT_READY'
      && error.details.sourceStatus === 'planned'
  ));
});

test('Commerce and Customer Service preflight reuse shared closeout with capability facts', () => {
  const woo = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'woocommerce',
  });
  const wooSql = buildReportRuntimePreflightSql({ target: { ...woo, customerKey: 'chemistry_k' } });
  assert.match(wooSql, /commerce_daily_sales_facts/u);
  assert.match(wooSql, /commerce_order_state/u);
  assert.equal(assertReviewedReportRuntimeCloseoutPreflight({
    coverage_status: 'complete',
    coverage_scope_mode: 'full_inventory',
    source_watermark: 'woo-watermark',
    period_end: '2026-08-01',
    daily_fact_count: 10,
    order_state_count: 20,
    active_report_locks: 0,
    open_report_dlq: 0,
    open_report_critical_alerts: 0,
  }, woo), true);

  const chatwoot = resolveReviewedReportRuntimeCloseoutTarget({
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: 'chatwoot',
  });
  const chatwootSql = buildReportRuntimePreflightSql({
    target: { ...chatwoot, customerKey: 'chemistry_k' },
  });
  assert.match(chatwootSql, /chatwoot_conversation_daily_facts/u);
  assert.match(chatwootSql, /chatwoot_account_daily_facts/u);
  assert.equal(assertReviewedReportRuntimeCloseoutPreflight({
    coverage_status: 'complete',
    source_watermark: 'chatwoot-watermark',
    period_end: '2026-08-01',
    conversation_fact_count: 10,
    account_fact_count: 5,
    active_report_locks: 0,
    open_report_dlq: 0,
    open_report_critical_alerts: 0,
  }, chatwoot), true);
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
