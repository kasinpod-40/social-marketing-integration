import test from 'node:test';
import assert from 'node:assert/strict';
import { D1ChatwootReportSource } from '../../packages/connectors/src/d1-chatwoot-report-source.js';

function createDb(input = {}) {
  const facts = input.facts ?? [];
  const snapshot = input.snapshot ?? null;
  const coverageRows = input.coverageRows ?? [];
  const calls = input.calls ?? [];
  return {
    prepare(sql) {
      return {
        bind(...bindings) {
          calls.push({ sql, bindings });
          return {
            async all() {
              if (sql.includes('chatwoot_conversation_daily_facts')) return { results: facts };
              if (sql.includes('data_coverage_runs')) return { results: coverageRows };
              return { results: [] };
            },
            async first() {
              if (sql.includes('chatwoot_account_daily_facts')) return snapshot;
              return null;
            },
          };
        },
      };
    },
  };
}

const fact = Object.freeze({
  metric_date: '2026-07-31',
  reporting_timezone: 'Asia/Bangkok',
  external_conversation_id: 10,
  external_inbox_id: 20,
  external_agent_id: 30,
  data_status: 'complete',
  new_conversation_count: 1,
  resolved_count: 1,
  reopened_count: 0,
  incoming_message_count: 3,
  outgoing_message_count: 2,
  private_message_count: 0,
  attachment_message_count: 1,
  first_response_seconds: 20,
  resolution_seconds: 120,
  reply_seconds: 10,
  coverage_run_id: 'coverage-conversation',
  source_revision: 'watermark-1',
  fetched_at: 1,
});

const snapshot = Object.freeze({
  metric_date: '2026-07-31',
  reporting_timezone: 'Asia/Bangkok',
  data_status: 'complete',
  conversation_count: 65,
  open_conversation_count: 7,
  pending_conversation_count: 3,
  snoozed_conversation_count: 2,
  active_agent_count: 4,
  active_inbox_count: 2,
  coverage_run_id: 'coverage-account',
  source_revision: 'watermark-1',
  fetched_at: 1,
});

const coverageRows = Object.freeze([
  Object.freeze({
    dataset_key: 'chatwoot.account_daily',
    status: 'completed',
    failed_rows: 0,
    expected_entities: 42,
    observed_entities: 42,
    coverage_run_id: 'coverage-account',
    source_watermark: 'watermark-1',
    completed_at: 100,
    updated_at: 100,
  }),
  Object.freeze({
    dataset_key: 'chatwoot.conversation_daily',
    status: 'completed',
    failed_rows: 0,
    expected_entities: 65,
    observed_entities: 65,
    coverage_run_id: 'coverage-conversation',
    source_watermark: 'watermark-1',
    completed_at: 100,
    updated_at: 100,
  }),
]);

test('selects same-timestamp Chatwoot conversation/account daily Coverage with watermarks', async () => {
  const calls = [];
  const source = new D1ChatwootReportSource({
    db: createDb({ facts: [fact], snapshot, coverageRows, calls }),
  });
  const result = await source.load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
  });
  const coverageSql = calls.find((call) => call.sql.includes('data_coverage_runs')).sql;
  assert.match(coverageSql, /PARTITION BY dataset_key/u);
  assert.match(coverageSql, /dataset_key IN \(\?, \?\)/u);
  assert.deepEqual(
    calls.find((call) => call.sql.includes('data_coverage_runs')).bindings.slice(2, 4),
    ['chatwoot.conversation_daily', 'chatwoot.account_daily'],
  );
  assert.doesNotMatch(coverageSql, /chatwoot\.accounts/u);
  assert.equal(result.facts.length, 1);
  assert.equal(result.periodEndSnapshot.conversation_count, 65);
  assert.equal(result.coverage.status, 'complete');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.selectedDatasetCount, 2);
  assert.equal(result.coverage.watermarkDatasetCount, 2);
  assert.equal(result.readSummary.reportingTimezone, 'Asia/Bangkok');
  assert.equal(result.readSummary.sourceWatermark, 'watermark-1');
  assert.equal(Object.hasOwn(result.facts[0], 'message_body'), false);
  assert.equal(Object.hasOwn(result.facts[0], 'contact_email'), false);
});

test('fails closed when fact rows exceed the configured bound', async () => {
  const source = new D1ChatwootReportSource({
    db: createDb({
      facts: [fact, { ...fact, external_conversation_id: 11 }],
      snapshot,
      coverageRows,
    }),
  });
  await assert.rejects(() => source.load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
    maxFactRows: 1,
  }), (error) => error?.code === 'CHATWOOT_REPORT_D1_FACT_LIMIT_EXCEEDED');
});

test('fails closed on reporting timezone drift', async () => {
  const source = new D1ChatwootReportSource({
    db: createDb({
      facts: [fact, { ...fact, external_conversation_id: 11, reporting_timezone: 'UTC' }],
      snapshot,
      coverageRows,
    }),
  });
  await assert.rejects(() => source.load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
  }), (error) => error?.code === 'CHATWOOT_REPORT_TIMEZONE_DRIFT');
});
