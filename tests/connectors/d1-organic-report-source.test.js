import test from 'node:test';
import assert from 'node:assert/strict';
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
