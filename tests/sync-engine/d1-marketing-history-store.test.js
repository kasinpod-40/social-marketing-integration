import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  createAdsFactKey,
  createContentKey,
  createConversionFactKey,
  createObservationKey,
  createReportId,
} from '../../packages/application/src/storage/marketing-history-contract.js';
import { D1MarketingHistoryStore } from '../../packages/sync-engine/src/d1-marketing-history-store.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL('../../migrations/0009_storage_foundation.sql', import.meta.url);

async function createStore() {
  const d1 = createSqliteD1();
  d1.exec(await readFile(MIGRATION_URL, 'utf8'));
  return { d1, store: new D1MarketingHistoryStore({ db: d1 }) };
}

test('organic observation retry is idempotent and identity drift fails closed', async () => {
  const { d1, store } = await createStore();
  try {
    const row = organicObservation();
    assert.equal((await store.saveOrganicContentObservation(row)).status, 'created');
    assert.equal((await store.saveOrganicContentObservation(row)).status, 'skipped');
    assert.equal(d1.database.prepare('SELECT count(*) AS total FROM organic_content_observations').get().total, 1);

    await assert.rejects(
      () => store.saveOrganicContentObservation({ ...row, views: 101, metrics_hash: 'different-hash' }),
      (error) => error.code === 'D1_ORGANIC_OBSERVATION_IDENTITY_CONFLICT',
    );
    assert.equal(d1.database.prepare('SELECT count(*) AS total FROM organic_content_observations').get().total, 1);
  } finally {
    d1.close();
  }
});

test('organic current state preserves first observation and non-null metrics during later null input', async () => {
  const { d1, store } = await createStore();
  try {
    const first = organicContentState();
    await store.upsertOrganicContentState(first);
    await store.upsertOrganicContentState({
      ...first,
      first_seen_at: first.first_seen_at + 100,
      last_observed_at: first.last_observed_at + 100,
      last_changed_at: null,
      views: null,
      metrics_hash: 'same-metrics',
      metadata_hash: 'same-metadata',
      last_coverage_run_id: 'coverage-2',
      last_sync_run_id: 'sync-2',
      updated_at: first.updated_at + 100,
    });

    const stored = d1.database.prepare('SELECT * FROM organic_content_state WHERE content_key = ?')
      .get(first.content_key);
    assert.equal(stored.first_seen_at, first.first_seen_at);
    assert.equal(stored.last_observed_at, first.last_observed_at + 100);
    assert.equal(stored.views, 100);
    assert.equal(stored.last_coverage_run_id, 'coverage-2');
  } finally {
    d1.close();
  }
});

test('Ads old-day Attribution revision updates the same fact without adding a row', async () => {
  const { d1, store } = await createStore();
  try {
    const original = adsDailyFact();
    assert.equal((await store.upsertAdsDailyFact(original)).status, 'written');
    assert.equal((await store.upsertAdsDailyFact({ ...original, updated_at: 11 })).status, 'skipped');

    const revised = {
      ...original,
      spend_micros: 1_250_000,
      conversions: 2.5,
      source_revision: 'revision-2',
      source_payload_hash: 'payload-2',
      fetched_at: 20,
      sync_run_id: 'sync-ads-2',
      updated_at: 20,
    };
    assert.equal((await store.upsertAdsDailyFact(revised)).status, 'written');
    const rows = d1.database.prepare('SELECT * FROM ads_daily_facts').all();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].spend_micros, 1_250_000);
    assert.equal(rows[0].conversions, 2.5);
    assert.equal(rows[0].source_revision, 'revision-2');
  } finally {
    d1.close();
  }
});

test('different Ads segments and conversion actions remain separate facts', async () => {
  const { d1, store } = await createStore();
  try {
    const first = adsDailyFact();
    const second = { ...first, segment_key: 'attribution:data_driven', source_payload_hash: 'payload-segment-2' };
    second.ads_fact_key = createAdsFactKey(second);
    await store.upsertAdsDailyFact(first);
    await store.upsertAdsDailyFact(second);

    const purchase = conversionFact();
    const lead = {
      ...purchase,
      conversion_action_key: 'lead',
      conversion_action_name: 'Lead',
      conversion_category: 'lead',
      source_payload_hash: 'conversion-lead',
    };
    lead.conversion_fact_key = createConversionFactKey(lead);
    await store.upsertAdsConversionDailyFact(purchase);
    await store.upsertAdsConversionDailyFact(lead);

    assert.equal(d1.database.prepare('SELECT count(*) AS total FROM ads_daily_facts').get().total, 2);
    assert.equal(d1.database.prepare('SELECT count(*) AS total FROM ads_conversion_daily_facts').get().total, 2);
  } finally {
    d1.close();
  }
});

test('partial Coverage never removes or zeroes facts outside the observed response', async () => {
  const { d1, store } = await createStore();
  try {
    const first = adsDailyFact();
    const second = {
      ...first,
      external_entity_id: 'campaign-2',
      external_campaign_id: 'campaign-2',
      source_payload_hash: 'payload-campaign-2',
    };
    second.ads_fact_key = createAdsFactKey(second);
    await store.upsertAdsDailyFact(first);
    await store.upsertAdsDailyFact(second);

    await store.saveCoverageRun({
      coverage_run_id: 'coverage-partial', sync_run_id: 'sync-partial', customer_key: 'chemistry_k',
      platform: 'google_ads', account_key: 'chemistry_k', dataset_key: 'campaign_daily',
      metric_semantics: 'period', scope_mode: 'recent_window', period_start: '2026-07-22',
      period_end: '2026-07-22', source_timezone: 'Asia/Bangkok', status: 'partial',
      expected_entities: 2, observed_entities: 1, expected_rows: 2, observed_rows: 1,
      written_rows: 1, failed_rows: 0, source_watermark: 'partial-1', revisable_until: null,
      started_at: 1, completed_at: 2, error_code: null, created_at: 1, updated_at: 2,
    });
    await store.saveCoverageEntities([{
      coverage_entity_key: 'coverage-partial:campaign:campaign-1',
      coverage_run_id: 'coverage-partial', entity_type: 'campaign', external_entity_id: 'campaign-1',
      observation_status: 'observed', source_revision: 'revision-1', observed_at: 2, created_at: 2,
    }]);

    const rows = d1.database.prepare('SELECT external_entity_id, spend_micros FROM ads_daily_facts ORDER BY external_entity_id').all();
    assert.deepEqual(rows, [
      { external_entity_id: 'campaign-1', spend_micros: 1_000_000 },
      { external_entity_id: 'campaign-2', spend_micros: 1_000_000 },
    ]);
  } finally {
    d1.close();
  }
});

test('bounded range queries return deterministic order and reject unbounded limits', async () => {
  const { d1, store } = await createStore();
  try {
    const observation = organicObservation();
    await store.saveOrganicContentObservation(observation);
    const later = {
      ...observation,
      observed_at: observation.observed_at + 1_000,
      observation_kind: 'changed',
      metric_date: '2026-07-23',
      views: 120,
      metrics_hash: 'metrics-2',
      coverage_run_id: 'coverage-2', fetched_at: observation.fetched_at + 1_000,
      sync_run_id: 'sync-2', created_at: observation.created_at + 1_000,
    };
    later.observation_key = createObservationKey(later);
    await store.saveOrganicContentObservation(later);

    const observations = await store.listOrganicContentObservations({
      contentKey: observation.content_key, limit: 10,
    });
    assert.deepEqual(observations.map((row) => row.observation_key), [observation.observation_key, later.observation_key]);
    await assert.rejects(
      () => store.listOrganicContentObservations({ contentKey: observation.content_key, limit: 1001 }),
      (error) => error.code === 'MKT_STORAGE_QUERY_INVALID',
    );

    await store.upsertAdsDailyFact(adsDailyFact());
    assert.equal((await store.listAdsDailyFacts({
      customerKey: 'chemistry_k', platform: 'google_ads', accountKey: 'chemistry_k',
      periodStart: '2026-07-01', periodEnd: '2026-07-31', limit: 10,
    })).length, 1);
    await assert.rejects(
      () => store.listAdsDailyFacts({
        customerKey: 'chemistry_k', platform: 'google_ads', accountKey: 'chemistry_k',
        periodStart: '2026-07-01', periodEnd: '2026-07-31', limit: 5001,
      }),
      (error) => error.code === 'MKT_STORAGE_QUERY_INVALID',
    );
  } finally {
    d1.close();
  }
});

test('Report materialization and request state are idempotent and bounded', async () => {
  const { d1, store } = await createStore();
  try {
    const report = reportMaterialization();
    assert.equal((await store.saveReportMaterialization(report)).status, 'written');
    assert.equal((await store.saveReportMaterialization({ ...report, updated_at: 101 })).status, 'skipped');
    assert.equal((await store.listReportMaterializations({ customerKey: 'chemistry_k', accountKey: 'chemistry_k' })).length, 1);

    const pending = reportRequest();
    await store.saveReportRequest(pending);
    await store.saveReportRequest({
      ...pending,
      status: 'completed', result_report_id: report.report_id,
      started_at: 110, finished_at: 120, updated_at: 120,
    });
    const completed = await store.readReportRequest(pending.request_id);
    assert.equal(completed.status, 'completed');
    assert.equal(completed.result_report_id, report.report_id);
  } finally {
    d1.close();
  }
});

function organicContentState() {
  const row = {
    customer_profile: 'integration_workspace', customer_key: 'chemistry_k',
    platform: 'tiktok', account_key: 'chemistry_k', source_account_id: 'source-account',
    external_content_id: 'video-1', content_type: 'video', published_at: 900,
    first_seen_at: 1_000, last_observed_at: 1_100, last_changed_at: 1_100,
    source_availability_status: 'available', views: 100, likes: 10, comments: 1,
    shares: 2, unique_viewers: null, avg_watch_time_seconds: 3,
    total_watch_time_seconds: 300, completion_rate: 0.5,
    metrics_hash: 'same-metrics', metadata_hash: 'same-metadata',
    last_coverage_run_id: 'coverage-1', last_sync_run_id: 'sync-1',
    created_at: 1_000, updated_at: 1_100,
  };
  return { ...row, content_key: createContentKey(row) };
}

function organicObservation() {
  const row = {
    content_key: 'tiktok:chemistry_k:video-1', customer_key: 'chemistry_k',
    platform: 'tiktok', account_key: 'chemistry_k', external_content_id: 'video-1',
    observed_at: 1_721_000_000_000, metric_date: '2026-07-22', source_timezone: 'Asia/Bangkok',
    observation_kind: 'checkpoint', metric_semantics: 'cumulative', views: 100, likes: 10,
    comments: 1, shares: 2, unique_viewers: null, avg_watch_time_seconds: 3.5,
    total_watch_time_seconds: 350, completion_rate: 0.5, metrics_hash: 'metrics-1',
    source_revision: 'source-1', coverage_run_id: 'coverage-1', fetched_at: 1_721_000_000_000,
    sync_run_id: 'sync-1', created_at: 1_721_000_000_000,
  };
  return { ...row, observation_key: createObservationKey(row) };
}

function adsDailyFact() {
  const row = {
    customer_key: 'chemistry_k', platform: 'google_ads', account_key: 'chemistry_k',
    source_account_id: '5662332033', report_level: 'campaign', entity_type: 'campaign',
    external_entity_id: 'campaign-1', external_campaign_id: 'campaign-1',
    external_ad_group_id: null, external_ad_id: null, external_creative_id: null,
    metric_date: '2026-07-22', account_timezone: 'Asia/Bangkok', breakdown_key: 'none',
    segment_key: 'attribution:last_click', ad_channel: 'youtube_ads', currency: 'THB',
    spend_micros: 1_000_000, impressions: 100, reach: null, clicks: 5, conversions: 1.5,
    conversion_value_micros: 2_000_000, video_views: 50, video_view_rate: 0.5,
    average_cpv_micros: 20_000, actions_json: JSON.stringify([]),
    breakdown_json: JSON.stringify({ attribution: 'last_click' }), data_status: 'revisable',
    coverage_run_id: 'coverage-ads-1', source_revision: 'revision-1',
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
    source_payload_hash: 'conversion-payload-1', fetched_at: 10,
    sync_run_id: 'sync-ads-1', created_at: 10, updated_at: 10,
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

function reportRequest() {
  return {
    request_id: 'request-1', customer_key: 'chemistry_k', account_key: 'chemistry_k',
    platform_scope: 'tiktok', period_start: '2026-06-23', period_end: '2026-07-22',
    comparison_mode: 'previous_period', status: 'pending', result_report_id: null,
    requested_at: 100, started_at: null, finished_at: null, error_code: null,
    created_at: 100, updated_at: 100,
  };
}
