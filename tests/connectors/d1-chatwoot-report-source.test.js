import test from 'node:test';
import assert from 'node:assert/strict';
import { D1ChatwootReportSource } from '../../packages/connectors/src/d1-chatwoot-report-source.js';

function createDb(input = {}) {
  const facts = input.facts ?? [];
  const snapshot = input.snapshot ?? null;
  const coverage = input.coverage ?? null;
  return {
    prepare(sql) {
      return {
        bind() {
          return {
            async all() {
              if (sql.includes('chatwoot_conversation_daily_facts')) return { results: facts };
              return { results: [] };
            },
            async first() {
              if (sql.includes('chatwoot_account_daily_facts')) return snapshot;
              if (sql.includes('data_coverage_runs')) return coverage;
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
  coverage_run_id: 'coverage-redacted',
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
  coverage_run_id: 'coverage-redacted',
  source_revision: 'watermark-1',
  fetched_at: 1,
});

const coverage = Object.freeze({
  status: 'completed',
  failed_rows: 0,
  expected_entities: 65,
  observed_entities: 65,
  coverage_run_id: 'coverage-redacted',
  source_watermark: 'watermark-1',
});

test('reads bounded Chatwoot facts, period-end snapshot and completed Coverage', async () => {
  const source = new D1ChatwootReportSource({
    db: createDb({ facts: [fact], snapshot, coverage }),
  });
  const result = await source.load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
  });
  assert.equal(result.facts.length, 1);
  assert.equal(result.periodEndSnapshot.conversation_count, 65);
  assert.equal(result.coverage.status, 'complete');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.readSummary.reportingTimezone, 'Asia/Bangkok');
  assert.equal(result.readSummary.sourceWatermark, 'watermark-1');
  assert.equal(Object.hasOwn(result.facts[0], 'message_body'), false);
  assert.equal(Object.hasOwn(result.facts[0], 'contact_email'), false);
});

test('fails closed when fact rows exceed the configured bound', async () => {
  const source = new D1ChatwootReportSource({
    db: createDb({ facts: [fact, { ...fact, external_conversation_id: 11 }], snapshot, coverage }),
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
      coverage,
    }),
  });
  await assert.rejects(() => source.load({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    periodStart: '2026-07-01',
    periodEnd: '2026-07-31',
  }), (error) => error?.code === 'CHATWOOT_REPORT_TIMEZONE_DRIFT');
});
