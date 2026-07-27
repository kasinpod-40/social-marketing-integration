import test from 'node:test';
import assert from 'node:assert/strict';
import {
  D1YouTubeOrganicReportSource,
} from '../../packages/connectors/src/youtube/d1-youtube-organic-report-source.js';

const PERIOD = Object.freeze({
  customerKey: 'integration_workspace',
  accountKey: 'channel_account',
  timeZone: 'Asia/Bangkok',
  periodStart: '2026-07-20',
  periodEnd: '2026-07-26',
  compareStart: '2026-07-13',
  compareEnd: '2026-07-19',
});

function contentState(id) {
  return {
    content_key: `youtube:channel_account:${id}`,
    customer_key: 'integration_workspace',
    platform: 'youtube',
    account_key: 'channel_account',
    external_content_id: id,
    published_at: Date.parse('2026-07-10T00:00:00Z'),
    source_availability_status: 'available',
  };
}

function observation(id, metricDate, views) {
  return {
    observation_key: `youtube:channel_account:${id}:${metricDate}:changed:v1`,
    content_key: `youtube:channel_account:${id}`,
    customer_key: 'integration_workspace',
    platform: 'youtube',
    account_key: 'channel_account',
    external_content_id: id,
    observed_at: Date.parse(`${metricDate}T12:00:00Z`),
    metric_date: metricDate,
    observation_kind: 'changed',
    views,
    likes: 0,
    comments: 0,
    shares: null,
    unique_viewers: null,
    avg_watch_time_seconds: null,
    total_watch_time_seconds: null,
    completion_rate: null,
    coverage_run_id: 'coverage:youtube:content',
    source_revision: 'watermark',
  };
}

function account(metricDate) {
  return {
    account_daily_key: `youtube:channel_account:${metricDate}`,
    customer_key: 'integration_workspace',
    platform: 'youtube',
    account_key: 'channel_account',
    source_account_id: 'UC_TEST',
    metric_date: metricDate,
    followers: null,
    views: 100,
    data_status: 'complete',
    coverage_run_id: 'coverage:youtube-account:1',
    source_revision: 'watermark',
  };
}

function completeContentCoverage(overrides = {}) {
  return {
    coverage_run_id: 'coverage:youtube:content',
    dataset_key: 'organic_content_cumulative',
    status: 'complete',
    expected_entities: 1,
    observed_entities: 1,
    expected_rows: 1,
    observed_rows: 1,
    failed_rows: 0,
    source_watermark: 'watermark',
    completed_at: Date.parse('2026-07-26T12:00:00Z'),
    ...overrides,
  };
}

function completeAccountCoverage(overrides = {}) {
  return {
    coverage_run_id: 'coverage:youtube-account:1',
    dataset_key: 'organic_account_snapshot',
    status: 'complete',
    expected_entities: 1,
    observed_entities: 1,
    expected_rows: 1,
    observed_rows: 1,
    failed_rows: 0,
    source_watermark: 'watermark',
    completed_at: Date.parse('2026-07-26T12:00:00Z'),
    ...overrides,
  };
}

function createDb(input = {}) {
  const calls = [];
  return {
    calls,
    prepare(sql) {
      const normalized = sql.replace(/\s+/gu, ' ').trim();
      return {
        bind(...bindings) {
          calls.push({ sql: normalized, bindings });
          return {
            async all() {
              if (normalized.includes('FROM organic_content_state s')) {
                return { results: input.states ?? [contentState('v1')] };
              }
              if (normalized.includes('FROM organic_content_observations o')) {
                if (normalized.includes('o.metric_date < ?')) {
                  return { results: input.baselineObservations ?? [] };
                }
                if (bindings[3] === PERIOD.compareEnd) {
                  return { results: input.compareObservations ?? [] };
                }
                return { results: input.currentObservations ?? [observation('v1', PERIOD.periodEnd, 10)] };
              }
              if (normalized.includes('FROM organic_account_daily_facts a')) {
                if (normalized.includes('a.metric_date < ?')) {
                  return { results: input.baselineAccounts ?? [] };
                }
                if (bindings[3] === PERIOD.compareEnd) {
                  return { results: input.compareAccounts ?? [] };
                }
                return { results: input.currentAccounts ?? [account(PERIOD.periodEnd)] };
              }
              if (normalized.includes('FROM data_coverage_runs r')) {
                return {
                  results: input.coverageRows ?? [
                    completeContentCoverage(),
                    completeAccountCoverage(),
                  ],
                };
              }
              if (normalized.includes('FROM data_coverage_entities')) {
                return {
                  results: input.coverageEntities ?? [{
                    external_entity_id: 'v1',
                    observation_status: 'observed',
                    source_revision: 'watermark',
                    observed_at: Date.parse('2026-07-26T12:00:00Z'),
                  }],
                };
              }
              throw new Error(`Unexpected SQL: ${normalized}`);
            },
          };
        },
      };
    },
  };
}

test('YouTube D1 report treats a missing-only Coverage entity as partial', async () => {
  const db = createDb({
    coverageRows: [
      completeContentCoverage({
        expected_entities: 2,
        observed_entities: 2,
        expected_rows: 2,
        observed_rows: 2,
      }),
      completeAccountCoverage(),
    ],
    coverageEntities: [
      {
        external_entity_id: 'v1',
        observation_status: 'observed',
        source_revision: 'watermark',
        observed_at: Date.parse('2026-07-26T12:00:00Z'),
      },
      {
        external_entity_id: 'v2',
        observation_status: 'missing',
        source_revision: 'watermark',
        observed_at: Date.parse('2026-07-26T12:00:00Z'),
      },
    ],
  });

  const result = await new D1YouTubeOrganicReportSource({ db }).load(PERIOD);
  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.readSummary.uncoveredContentCount, 1);
  assert.deepEqual(result.readSummary.uncoveredContentIds, ['v2']);
});

test('YouTube D1 report cannot be complete while account Coverage is partial', async () => {
  const db = createDb({
    coverageRows: [
      completeContentCoverage(),
      completeAccountCoverage({
        status: 'partial',
        observed_entities: 0,
        observed_rows: 0,
        failed_rows: 1,
      }),
    ],
  });

  const result = await new D1YouTubeOrganicReportSource({ db }).load(PERIOD);
  assert.equal(result.dataStatus, 'partial');
  assert.equal(result.readSummary.coverageStatus, 'complete');
  assert.equal(result.readSummary.accountCoverageStatus, 'partial');
});

test('YouTube D1 report reads observations and account facts only through complete Coverage', async () => {
  const db = createDb();
  const result = await new D1YouTubeOrganicReportSource({ db }).load(PERIOD);
  assert.equal(result.dataStatus, 'complete');
  const historicalQueries = db.calls.filter((call) => (
    call.sql.includes('FROM organic_content_observations o')
      || call.sql.includes('FROM organic_account_daily_facts a')
  ));
  assert.ok(historicalQueries.length >= 6);
  for (const call of historicalQueries) {
    assert.match(call.sql, /INNER JOIN data_coverage_runs c/u);
    assert.match(call.sql, /c\.status = 'complete'/u);
    assert.match(call.sql, /COALESCE\(c\.failed_rows, 0\) = 0/u);
  }
});
