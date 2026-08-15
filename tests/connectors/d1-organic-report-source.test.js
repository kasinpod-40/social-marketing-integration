import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateOrganicPeriodMetrics } from '../../packages/application/src/reports/calculate-organic-period-metrics.js';
import { D1OrganicReportSource } from '../../packages/connectors/src/d1-organic-report-source.js';

test('Facebook falls back to proven Account Daily facts without fabricating Content observations', async () => {
  const calls = [];
  const accountFacts = [
    accountFact('2026-07-30', 10, 100),
    accountFact('2026-07-31', 5, 101),
  ];
  const db = createD1((sql, bindings, method) => {
    calls.push({ sql, bindings, method });
    if (sql.includes('organic_account_daily_facts')) return accountFacts;
    if (sql.includes('organic_content_state')) return [];
    if (sql.includes('organic_content_observations')) return [];
    if (sql.includes('data_coverage_runs')) {
      if (bindings[3] === 'facebook.account.daily') return {
        coverage_run_id: 'facebook-account-coverage',
        dataset_key: 'facebook.account.daily',
        status: 'complete',
        expected_rows: 2,
        observed_rows: 2,
        failed_rows: 0,
        source_watermark: 'facebook-account-watermark',
        completed_at: 100,
      };
      return {
        coverage_run_id: 'facebook-content-coverage',
        dataset_key: 'facebook.content.cumulative',
        status: 'complete',
        expected_rows: 26,
        observed_rows: 26,
        failed_rows: 0,
        source_watermark: 'facebook-content-watermark',
        completed_at: 100,
      };
    }
    if (sql.includes('data_coverage_entities')) {
      throw new Error('Account scope must not infer Content coverage entities');
    }
    return method === 'all' ? [] : null;
  });

  const result = await new D1OrganicReportSource({ db, platform: 'facebook' }).load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-30',
    periodEnd: '2026-07-31',
    compareStart: '2026-07-28',
    compareEnd: '2026-07-29',
  });

  assert.deepEqual(result.contents, []);
  assert.deepEqual(result.observations, []);
  assert.equal(result.accountDailyFacts.length, 2);
  assert.equal(result.readSummary.sourceScope, 'account');
  assert.equal(result.readSummary.coverageDatasetKey, 'facebook.account.daily');
  assert.equal(result.readSummary.sourceWatermark, 'facebook-account-watermark');
  assert.equal(result.readSummary.accountFactRecords, 2);
  assert.equal(calls.some((call) => call.sql.includes('data_coverage_entities')), false);
});

test('Facebook scopes current totals to the exact complete full-inventory coverage set', async () => {
  const currentRows = [
    observation('current', '2026-08-14', 200, { views: 100, likes: 5, comments: 2, shares: 1 }),
    observation('stale', '2026-08-13', 100, { views: 50, likes: null, comments: null, shares: 3 }),
  ];
  const states = currentRows.map((row) => ({
    content_key: row.content_key,
    published_at: Date.parse('2026-08-01T00:00:00Z'),
  }));
  const db = createD1((sql, bindings, method) => {
    if (sql.includes('organic_account_daily_facts')) return [];
    if (sql.includes('organic_content_state')) return states;
    if (sql.includes('organic_content_observations')) {
      return sql.includes('metric_date < ?') ? [] : currentRows;
    }
    if (sql.includes('data_coverage_entities')) {
      return [{ external_entity_id: 'current', observation_status: 'observed' }];
    }
    if (sql.includes('data_coverage_runs')) {
      if (bindings[3] === 'facebook.account.daily') return null;
      return {
        coverage_run_id: 'facebook-content-coverage-20260814',
        dataset_key: 'facebook.content.cumulative',
        status: 'complete',
        scope_mode: 'full_inventory',
        period_end: '2026-08-14',
        expected_entities: 1,
        observed_entities: 1,
        failed_rows: 0,
        completed_at: 300,
      };
    }
    return method === 'all' ? [] : null;
  });

  const result = await new D1OrganicReportSource({ db, platform: 'facebook' }).load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-08-14',
    periodEnd: '2026-08-14',
  });

  assert.deepEqual(result.contents.map((row) => row.externalContentId), ['current']);
  assert.deepEqual(result.observations.map((row) => row.externalContentId), ['current']);
  assert.equal(result.readSummary.authoritativeInventoryScoped, true);
  assert.equal(result.readSummary.authoritativeInventoryEntityCount, 1);
  assert.equal(result.readSummary.excludedStaleContentRecords, 1);
  assert.equal(result.readSummary.excludedStaleObservationRecords, 1);
  assert.equal(result.readSummary.uncoveredContentCount, 0);

  const calculated = calculateOrganicPeriodMetrics({
    platform: 'facebook',
    contents: result.contents,
    observations: result.observations,
    periodStart: '2026-08-14',
    periodEnd: '2026-08-14',
    coverageStatus: result.readSummary.coverageStatus,
  });
  assert.equal(calculated.metrics.latest_total_views, 100);
  assert.equal(calculated.metrics.latest_total_likes, 5);
  assert.equal(calculated.metrics.latest_total_comments, 2);
  assert.equal(calculated.metrics.latest_total_shares, 1);
});

test('Facebook keeps strict null evidence when full-inventory coverage cannot be proven', async () => {
  const rows = [
    observation('current', '2026-08-14', 200, { likes: 5 }),
    observation('stale', '2026-08-13', 100, { likes: null }),
  ];
  const db = createD1((sql, bindings, method) => {
    if (sql.includes('organic_account_daily_facts')) return [];
    if (sql.includes('organic_content_state')) return rows.map((row) => ({ content_key: row.content_key }));
    if (sql.includes('organic_content_observations')) return sql.includes('metric_date < ?') ? [] : rows;
    if (sql.includes('data_coverage_entities')) {
      return [{ external_entity_id: 'current', observation_status: 'observed' }];
    }
    if (sql.includes('data_coverage_runs')) {
      if (bindings[3] === 'facebook.account.daily') return null;
      return {
        coverage_run_id: 'facebook-partial-coverage',
        dataset_key: 'facebook.content.cumulative',
        status: 'partial',
        scope_mode: 'full_inventory',
        period_end: '2026-08-14',
        expected_entities: 2,
        observed_entities: 1,
        failed_rows: 1,
      };
    }
    return method === 'all' ? [] : null;
  });

  const result = await new D1OrganicReportSource({ db, platform: 'facebook' }).load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-08-14',
    periodEnd: '2026-08-14',
  });

  assert.equal(result.contents.length, 2);
  assert.equal(result.readSummary.authoritativeInventoryScoped, false);
  assert.equal(result.readSummary.excludedStaleContentRecords, 0);
  const calculated = calculateOrganicPeriodMetrics({
    platform: 'facebook',
    contents: result.contents,
    observations: result.observations,
    periodStart: '2026-08-14',
    periodEnd: '2026-08-14',
    coverageStatus: result.readSummary.coverageStatus,
  });
  assert.equal(calculated.metrics.latest_total_likes, null);
});

function accountFact(metricDate, views, followers) {
  return Object.freeze({
    account_daily_key: `facebook:chemistry_k:${metricDate}`,
    customer_key: 'chemistry_k',
    platform: 'facebook',
    account_key: 'chemistry_k',
    metric_date: metricDate,
    account_timezone: 'Asia/Bangkok',
    followers,
    follows: 20,
    profile_views: null,
    views,
    reach: views,
    accounts_engaged: 1,
    total_interactions: 2,
    net_follows: 1,
    data_status: 'complete',
    source_revision: 'facebook-account-watermark',
  });
}

function observation(externalContentId, metricDate, observedAt, metrics = {}) {
  return {
    observation_key: `facebook:chemistry_k:${externalContentId}:${observedAt}:changed:v1`,
    content_key: `facebook:chemistry_k:${externalContentId}`,
    external_content_id: externalContentId,
    observed_at: observedAt,
    metric_date: metricDate,
    views: Object.hasOwn(metrics, 'views') ? metrics.views : 10,
    likes: Object.hasOwn(metrics, 'likes') ? metrics.likes : 1,
    comments: Object.hasOwn(metrics, 'comments') ? metrics.comments : 0,
    shares: Object.hasOwn(metrics, 'shares') ? metrics.shares : 0,
    unique_viewers: null,
    avg_watch_time_seconds: null,
    total_watch_time_seconds: null,
    completion_rate: null,
    coverage_run_id: 'facebook-content-coverage-20260814',
    source_revision: 'facebook-watermark-20260814',
  };
}

function createD1(resolver) {
  return {
    prepare(sql) {
      return {
        bindings: [],
        bind(...bindings) { this.bindings = bindings; return this; },
        async all() {
          const rows = resolver(sql, this.bindings, 'all');
          return { results: Array.isArray(rows) ? rows : [] };
        },
        async first() {
          const row = resolver(sql, this.bindings, 'first');
          return row && !Array.isArray(row) ? row : null;
        },
      };
    },
  };
}
