import test from 'node:test';
import assert from 'node:assert/strict';
import { D1ChatwootReportSource } from '../../packages/connectors/src/d1-chatwoot-report-source.js';

function createDb({ facts, snapshot, coverageRows }) {
  return {
    prepare(sql) {
      return {
        bind() {
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
  metric_date: '2026-08-01',
  reporting_timezone: 'Asia/Bangkok',
  external_conversation_id: 10,
  external_inbox_id: 20,
  external_agent_id: 30,
  data_status: 'partial',
  new_conversation_count: 1,
  resolved_count: 1,
  reopened_count: 0,
  incoming_message_count: 2,
  outgoing_message_count: 1,
  private_message_count: 0,
  attachment_message_count: 0,
  first_response_seconds: 10,
  resolution_seconds: 20,
  reply_seconds: 5,
  coverage_run_id: 'conversation-daily',
  source_revision: '1785558008068',
  fetched_at: 1785558008068,
});

const snapshot = Object.freeze({
  metric_date: '2026-08-01',
  reporting_timezone: 'Asia/Bangkok',
  data_status: 'partial',
  conversation_count: 42,
  open_conversation_count: null,
  pending_conversation_count: null,
  snoozed_conversation_count: null,
  active_agent_count: null,
  active_inbox_count: null,
  coverage_run_id: 'account-daily',
  source_revision: '1785558008068',
  fetched_at: 1785558008068,
});

function coverage(datasetKey, overrides = {}) {
  return Object.freeze({
    dataset_key: datasetKey,
    status: 'complete',
    failed_rows: 0,
    expected_entities: 1,
    observed_entities: 1,
    coverage_run_id: `${datasetKey}-coverage`,
    source_watermark: '1785558008068',
    completed_at: 1785558008068,
    updated_at: 1785558008068,
    ...overrides,
  });
}

function source(coverageRows) {
  return new D1ChatwootReportSource({
    db: createDb({ facts: [fact], snapshot, coverageRows }),
  });
}

const loadInput = Object.freeze({
  customerKey: 'chemistry_k',
  accountKey: 'chemistry_k',
  periodStart: '2026-08-01',
  periodEnd: '2026-08-01',
});

test('finalized required Coverage makes writer-native partial Chatwoot daily facts report-complete', async () => {
  const result = await source([
    coverage('chatwoot.conversation_daily'),
    coverage('chatwoot.account_daily'),
  ]).load(loadInput);

  assert.equal(result.facts[0].data_status, 'partial');
  assert.equal(result.periodEndSnapshot.data_status, 'partial');
  assert.equal(result.coverage.status, 'complete');
  assert.equal(result.coverage.complete, true);
  assert.equal(result.coverage.selectedDatasetCount, 2);
  assert.equal(result.coverage.watermarkDatasetCount, 2);
  assert.equal(result.readSummary.coverageComplete, true);
});

test('partial daily rows do not bypass missing or failed required Coverage', async () => {
  const missingDataset = await source([
    coverage('chatwoot.conversation_daily'),
  ]).load(loadInput);
  assert.equal(missingDataset.coverage.complete, false);
  assert.equal(missingDataset.coverage.selectedDatasetCount, 1);

  const failedDataset = await source([
    coverage('chatwoot.conversation_daily'),
    coverage('chatwoot.account_daily', { failed_rows: 1 }),
  ]).load(loadInput);
  assert.equal(failedDataset.coverage.complete, false);
  assert.equal(failedDataset.coverage.failedRows, 1);
});
