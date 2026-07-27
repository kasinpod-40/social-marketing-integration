import test from 'node:test';
import assert from 'node:assert/strict';
import { D1YouTubeOrganicReportSource } from '../../packages/connectors/src/youtube/d1-youtube-organic-report-source.js';

const PERIOD = Object.freeze({
  customerKey: 'integration_workspace',
  accountKey: 'channel_account',
  timeZone: 'Asia/Bangkok',
  periodStart: '2026-07-20',
  periodEnd: '2026-07-26',
  compareStart: '2026-07-13',
  compareEnd: '2026-07-19',
});

function contentState(id, input = {}) {
  return {
    content_key: `youtube:channel_account:${id}`,
    customer_key: 'integration_workspace',
    platform: 'youtube',
    account_key: 'channel_account',
    external_content_id: id,
    published_at: Date.parse('2026-07-10T00:00:00Z'),
    source_availability_status: input.availability ?? 'available',
  };
}

function observation(id, metricDate, views, kind = 'changed') {
  return {
    observation_key: `youtube:channel_account:${id}:${metricDate}:${kind}:v1`,
    content_key: `youtube:channel_account:${id}`,
    customer_key: 'integration_workspace',
    platform: 'youtube',
    account_key: 'channel_account',
    external_content_id: id,
    observed_at: Date.parse(`${metricDate}T12:00:00Z`),
    metric_date: metricDate,
    source_timezone: 'Asia/Bangkok',
    observation_kind: kind,
    metric_semantics: 'cumulative',
    views,
    likes: views === null ? null : 0,
    comments: null,
    shares: null,
    unique_viewers: null,
    avg_watch_time_seconds: null,
    total_watch_time_seconds: null,
    completion_rate: null,
    coverage_run_id: 'coverage:youtube:content',
    source_revision: 'watermark',
  };
}

function account(metricDate, followers, views) {
  return {
    account_daily_key: `youtube:channel_account:${metricDate}`,
    customer_key: 'integration_workspace',
    platform: 'youtube',
    account_key: 'channel_account',
    source_account_id: 'UC_TEST',
    metric_date: metricDate,
    followers,
    views,
    data_status: 'complete',
    coverage_run_id: 'coverage:youtube-account:1',
    source_revision: 'watermark',
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
                const date = bindings[3];
                if (normalized.includes('o.metric_date < ?')) {
                  return { results: input.baselineObservations ?? [observation('v1', '2026-07-12', 20, 'initial')] };
                }
                if (date === '2026-07-19') {
                  return { results: input.compareObservations ?? [observation('v1', '2026-07-19', 10)] };
                }
                return { results: input.currentObservations ?? [observation('v1', '2026-07-26', 0, 'correction')] };
              }
              if (normalized.includes('FROM organic_account_daily_facts a')) {
                const date = bindings[3];
                if (normalized.includes('a.metric_date < ?')) {
                  return { results: input.baselineAccounts ?? [account('2026-07-12', null, 100)] };
                }
                if (date === '2026-07-19') {
                  return { results: input.compareAccounts ?? [account('2026-07-19', null, 150)] };
                }
                return { results: input.currentAccounts ?? [account('2026-07-26', null, 200)] };
              }
              if (normalized.includes('FROM data_coverage_runs r')) {
                return { results: input.coverageRows ?? [
                  {
                    coverage_run_id: 'coverage:youtube:content',
                    dataset_key: 'organic_content_cumulative',
                    status: 'complete',
                    expected_entities: 1,
                    observed_entities: 1,
                    failed_rows: 0,
                    source_watermark: 'watermark',
                    completed_at: Date.parse('2026-07-26T12:00:00Z'),
                  },
                  {
                    coverage_run_id: 'coverage:youtube-account:1',
                    dataset_key: 'organic_account_snapshot',
                    status: 'complete',
                    failed_rows: 0,
                    completed_at: Date.parse('2026-07-26T12:00:00Z'),
                  },
                ] };
              }
              if (normalized.includes('FROM data_coverage_entities')) {
                return { results: input.coverageEntities ?? [{
                  external_entity_id: 'v1',
                  observation_status: 'observed',
                  source_revision: 'watermark',
                  observed_at: Date.parse('2026-07-26T12:00:00Z'),
                }] };
              }
              throw new Error(`Unexpected SQL: ${normalized}`);
            },
          };
        },
      };
    },
  };
}

test('D1 YouTube source preserves zero, correction, baseline, account null and Coverage status', async () => {
  const db = createDb();
  const source = new D1YouTubeOrganicReportSource({ db });
  const result = await source.load(PERIOD);

  assert.equal(result.contents.length, 1);
  assert.equal(result.contents[0].externalContentId, 'v1');
  assert.equal(result.dailySnapshots.length, 3);
  assert.equal(result.dailySnapshots.find((row) => row.metricDate === '2026-07-26').views, 0);
  assert.equal(result.dailySnapshots.find((row) => row.metricDate === '2026-07-26').observationKind, 'correction');
  assert.equal(result.dailySnapshots.find((row) => row.metricDate === '2026-07-12').views, 20);
  assert.equal(result.accountDailySnapshots.length, 3);
  assert.equal(result.accountDailySnapshots.at(-1).followers, null);
  assert.equal(result.dataStatus, 'complete');
  assert.equal(result.readSummary.coverageStatus, 'complete');
  assert.equal(result.readSummary.accountCoverageStatus, 'complete');
  assert.equal(result.readSummary.uncoveredContentCount, 0);
  assert.equal(db.calls.every((call) => call.sql.includes('LIMIT')), true);
});

test('D1 YouTube source supports more than the historical 800-content Lark cap', async () => {
  const count = 801;
  const states = Array.from({ length: count }, (_, index) => contentState(`v${index}`));
  const currentObservations = Array.from(
    { length: count },
    (_, index) => observation(`v${index}`, '2026-07-26', index, 'initial'),
  );
  const coverageEntities = Array.from({ length: count }, (_, index) => ({
    external_entity_id: `v${index}`,
    observation_status: 'observed',
    source_revision: 'watermark',
    observed_at: Date.parse('2026-07-26T12:00:00Z'),
  }));
  const db = createDb({
    states,
    currentObservations,
    compareObservations: [],
    baselineObservations: [],
    coverageRows: [
      {
        coverage_run_id: 'coverage:youtube:content',
        dataset_key: 'organic_content_cumulative',
        status: 'complete',
        expected_entities: count,
        observed_entities: count,
        failed_rows: 0,
        completed_at: Date.parse('2026-07-26T12:00:00Z'),
      },
      {
        coverage_run_id: 'coverage:youtube-account:1',
        dataset_key: 'organic_account_snapshot',
        status: 'complete',
        expected_entities: 1,
        observed_entities: 1,
        expected_rows: 1,
        observed_rows: 1,
        failed_rows: 0,
        completed_at: Date.parse('2026-07-26T12:00:00Z'),
      },
    ],
    coverageEntities,
  });
  const result = await new D1YouTubeOrganicReportSource({ db }).load(PERIOD);
  assert.equal(result.contents.length, count);
  assert.equal(result.readSummary.externalContentIds, count);
  assert.equal(result.dataStatus, 'complete');
});

test('D1 YouTube source fails closed on bounds and incomplete Coverage', async () => {
  const boundedDb = createDb({ states: [contentState('v1'), contentState('v2')] });
  await assert.rejects(() => new D1YouTubeOrganicReportSource({ db: boundedDb }).load({
    ...PERIOD,
    maxContentRecords: 1,
  }), (error) => error.code === 'REPORT_D1_SOURCE_CONTENT_LIMIT_EXCEEDED');

  const partialDb = createDb({
    coverageRows: [{
      coverage_run_id: 'coverage:youtube:content',
      dataset_key: 'organic_content_cumulative',
      status: 'partial',
      expected_entities: 1,
      observed_entities: 1,
      failed_rows: 1,
      completed_at: Date.parse('2026-07-26T12:00:00Z'),
    }],
    coverageEntities: [{ external_entity_id: 'v1', observation_status: 'missing' }],
  });
  const partial = await new D1YouTubeOrganicReportSource({ db: partialDb }).load(PERIOD);
  assert.equal(partial.dataStatus, 'partial');
  assert.equal(partial.readSummary.uncoveredContentCount, 1);
});
