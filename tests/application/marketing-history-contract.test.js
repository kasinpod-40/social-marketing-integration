import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createAccountDailyKey,
  createAdsFactKey,
  createContentKey,
  createConversionFactKey,
  createObservationKey,
  createReportId,
  STORAGE_JSON_LIMITS,
  validateStorageRow,
} from '../../packages/application/src/storage/marketing-history-contract.js';

test('approved Storage Stable keys are deterministic', () => {
  const content = {
    platform: 'tiktok', account_key: 'chemistry_k', external_content_id: 'video-1',
  };
  assert.equal(createContentKey(content), 'tiktok:chemistry_k:video-1');
  assert.equal(createObservationKey({
    content_key: 'tiktok:chemistry_k:video-1', observed_at: 1_721_000_000_000,
    observation_kind: 'checkpoint',
  }), 'tiktok:chemistry_k:video-1:1721000000000:checkpoint:v1');
  assert.equal(createAccountDailyKey({
    platform: 'instagram', account_key: 'chemistry_k', metric_date: '2026-07-22',
  }), 'instagram:chemistry_k:2026-07-22');
  assert.equal(createAdsFactKey({
    platform: 'google_ads', account_key: 'chemistry_k', report_level: 'campaign',
    external_entity_id: 'campaign-1', metric_date: '2026-07-22',
    breakdown_key: 'none', segment_key: 'attribution:last_click',
  }), 'google_ads:chemistry_k:campaign:campaign-1:2026-07-22:none:attribution:last_click');
  assert.equal(createConversionFactKey({
    platform: 'google_ads', account_key: 'chemistry_k', report_level: 'campaign',
    external_entity_id: 'campaign-1', metric_date: '2026-07-22',
    conversion_action_key: 'purchase', conversion_category: 'purchase',
    segment_key: 'attribution:last_click',
  }), 'google_ads:chemistry_k:campaign:campaign-1:2026-07-22:purchase:purchase:attribution:last_click');
  assert.equal(createReportId({
    report_setting_key: 'integration_workspace:tiktok:daily', account_key: 'chemistry_k',
    period_kind: '30D', period_start: '2026-06-23', period_end: '2026-07-22',
    formula_version: 'organic-v2',
  }), 'integration_workspace:tiktok:daily:chemistry_k:30D:2026-06-23:2026-07-22:organic-v2');
});

test('observation contract rejects retry identity drift and non-cumulative semantics', () => {
  const row = organicObservation();
  assert.equal(validateStorageRow('organic_content_observations', row).observation_key, row.observation_key);
  assert.throws(
    () => validateStorageRow('organic_content_observations', {
      ...row,
      observation_key: `${row.content_key}:${row.observed_at + 1}:checkpoint:v1`,
    }),
    (error) => error.code === 'MKT_STORAGE_CONTRACT_INVALID',
  );
  assert.throws(
    () => validateStorageRow('organic_content_observations', {
      ...row,
      metric_semantics: 'period',
    }),
    /must be cumulative/u,
  );
});

test('complete Coverage fails closed when expected and observed scopes do not reconcile', () => {
  const complete = coverageRun();
  assert.equal(validateStorageRow('data_coverage_runs', complete).status, 'complete');
  assert.throws(
    () => validateStorageRow('data_coverage_runs', { ...complete, observed_entities: 9 }),
    /must reconcile/u,
  );
  assert.throws(
    () => validateStorageRow('data_coverage_runs', { ...complete, failed_rows: 1 }),
    /cannot contain failed_rows/u,
  );
  assert.throws(
    () => validateStorageRow('data_coverage_runs', { ...complete, status: 'invented' }),
    /must be one of/u,
  );
});

test('bounded JSON validates UTF-8 byte size and requires report payload version', () => {
  const base = reportMaterialization();
  assert.equal(validateStorageRow('report_materializations', base).report_id, base.report_id);
  assert.throws(
    () => validateStorageRow('report_materializations', {
      ...base,
      payload_json: JSON.stringify({ body: 'missing version' }),
    }),
    /schemaVersion or version/u,
  );
  assert.throws(
    () => validateStorageRow('report_materializations', {
      ...base,
      payload_json: JSON.stringify({ version: 'v1', body: 'ก'.repeat(STORAGE_JSON_LIMITS.reportPayloadBytes) }),
    }),
    /exceeds 262144 bytes/u,
  );

  const ads = adsDailyFact();
  assert.throws(
    () => validateStorageRow('ads_daily_facts', {
      ...ads,
      actions_json: JSON.stringify({ actions: 'x'.repeat(STORAGE_JSON_LIMITS.actionsBytes) }),
    }),
    /exceeds 65536 bytes/u,
  );
});

test('Ads grain preserves breakdown, attribution segment and conversion action identities', () => {
  const first = adsDailyFact();
  const second = {
    ...first,
    segment_key: 'attribution:data_driven',
  };
  second.ads_fact_key = createAdsFactKey(second);
  assert.notEqual(first.ads_fact_key, second.ads_fact_key);
  validateStorageRow('ads_daily_facts', first);
  validateStorageRow('ads_daily_facts', second);

  const conversionA = conversionFact();
  const conversionB = {
    ...conversionA,
    conversion_action_key: 'lead',
    conversion_category: 'lead',
  };
  conversionB.conversion_fact_key = createConversionFactKey(conversionB);
  assert.notEqual(conversionA.conversion_fact_key, conversionB.conversion_fact_key);
  validateStorageRow('ads_conversion_daily_facts', conversionA);
  validateStorageRow('ads_conversion_daily_facts', conversionB);
});

test('unknown fields and invalid report completion fail closed', () => {
  assert.throws(
    () => validateStorageRow('organic_content_observations', {
      ...organicObservation(), secret_token: 'must-not-persist',
    }),
    /unknown fields/u,
  );
  assert.throws(
    () => validateStorageRow('report_requests', {
      request_id: 'request-1', customer_key: 'chemistry_k', account_key: 'chemistry_k',
      platform_scope: 'tiktok', period_start: '2026-07-01', period_end: '2026-07-22',
      comparison_mode: 'previous_period', status: 'completed', result_report_id: null,
      requested_at: 1, started_at: 2, finished_at: null,
      error_code: null, created_at: 1, updated_at: 2,
    }),
    /result_report_id is required/u,
  );
});

function organicObservation() {
  const row = {
    content_key: 'tiktok:chemistry_k:video-1',
    customer_key: 'chemistry_k', platform: 'tiktok', account_key: 'chemistry_k',
    external_content_id: 'video-1', observed_at: 1_721_000_000_000,
    metric_date: '2026-07-22', source_timezone: 'Asia/Bangkok',
    observation_kind: 'checkpoint', metric_semantics: 'cumulative',
    views: 100, likes: 10, comments: 1, shares: 2, unique_viewers: null,
    avg_watch_time_seconds: 3.5, total_watch_time_seconds: 350,
    completion_rate: 0.5, metrics_hash: 'metrics-v1', source_revision: 'source-v1',
    coverage_run_id: 'coverage-1', fetched_at: 1_721_000_000_000,
    sync_run_id: 'sync-1', created_at: 1_721_000_000_000,
  };
  return { ...row, observation_key: createObservationKey(row) };
}

function coverageRun() {
  return {
    coverage_run_id: 'coverage-1', sync_run_id: 'sync-1', customer_key: 'chemistry_k',
    platform: 'tiktok', account_key: 'chemistry_k', dataset_key: 'organic_content',
    metric_semantics: 'cumulative', scope_mode: 'full_inventory',
    period_start: null, period_end: null, source_timezone: 'Asia/Bangkok', status: 'complete',
    expected_entities: 10, observed_entities: 10, expected_rows: 10, observed_rows: 10,
    written_rows: 10, failed_rows: 0, source_watermark: 'watermark-1',
    revisable_until: null, started_at: 1, completed_at: 2, error_code: null,
    created_at: 1, updated_at: 2,
  };
}

function adsDailyFact() {
  const row = {
    customer_key: 'chemistry_k', platform: 'google_ads', account_key: 'chemistry_k',
    source_account_id: '5662332033', report_level: 'campaign', entity_type: 'campaign',
    external_entity_id: 'campaign-1', external_campaign_id: 'campaign-1',
    external_ad_group_id: null, external_ad_id: null, external_creative_id: null,
    metric_date: '2026-07-22', account_timezone: 'Asia/Bangkok',
    breakdown_key: 'none', segment_key: 'attribution:last_click', ad_channel: 'youtube_ads',
    currency: 'THB', spend_micros: 1_000_000, impressions: 100, reach: null, clicks: 5,
    conversions: 1.5, conversion_value_micros: 2_000_000, video_views: 50,
    video_view_rate: 0.5, average_cpv_micros: 20_000,
    actions_json: JSON.stringify([]), breakdown_json: JSON.stringify({ attribution: 'last_click' }),
    data_status: 'revisable', coverage_run_id: 'coverage-ads-1', source_revision: 'revision-1',
    source_payload_hash: 'payload-1', fetched_at: 10, sync_run_id: 'sync-ads-1',
    created_at: 10, updated_at: 10,
  };
  return { ...row, ads_fact_key: createAdsFactKey(row) };
}

function conversionFact() {
  const row = {
    customer_key: 'chemistry_k', platform: 'google_ads', account_key: 'chemistry_k',
    source_account_id: '5662332033', report_level: 'campaign', external_entity_id: 'campaign-1',
    external_campaign_id: 'campaign-1', external_ad_group_id: null, external_ad_id: null,
    metric_date: '2026-07-22', account_timezone: 'Asia/Bangkok',
    conversion_action_key: 'purchase', conversion_action_name: 'Purchase',
    conversion_category: 'purchase', segment_key: 'attribution:last_click', currency: 'THB',
    conversions: 1.5, all_conversions: 2, conversion_value_micros: 2_000_000,
    all_conversion_value_micros: 2_500_000, data_status: 'revisable',
    coverage_run_id: 'coverage-ads-1', source_revision: 'revision-1',
    source_payload_hash: 'conversion-payload-1', fetched_at: 10, sync_run_id: 'sync-ads-1',
    created_at: 10, updated_at: 10,
  };
  return { ...row, conversion_fact_key: createConversionFactKey(row) };
}

function reportMaterialization() {
  const row = {
    report_setting_key: 'integration_workspace:tiktok:daily', customer_key: 'chemistry_k',
    platform_scope: 'tiktok', account_key: 'chemistry_k', report_type: 'organic',
    period_kind: '30D', window_days: 30, period_start: '2026-06-23', period_end: '2026-07-22',
    compare_start: '2026-05-24', compare_end: '2026-06-22', data_status: 'complete',
    coverage_rate: 1, formula_version: 'organic-v2', source_watermark: 'watermark-1',
    payload_json: JSON.stringify({ version: 'v1', metrics: { views: 100 } }),
    payload_checksum: 'checksum-1', generated_at: 100, expires_at: null,
    created_at: 100, updated_at: 100,
  };
  return { ...row, report_id: createReportId(row) };
}
