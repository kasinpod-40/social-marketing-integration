import test from 'node:test';
import assert from 'node:assert/strict';
import { D1ChatwootDailyRollupSource } from '../../packages/connectors/src/chatwoot/d1-chatwoot-daily-rollup-source.js';

test('Chatwoot rollup source overlays authoritative Reporting events by local day', async () => {
  const calls = [];
  const source = new D1ChatwootDailyRollupSource({
    db: {
      prepare(sql) {
        return {
          bind(...values) {
            calls.push({ sql, values });
            return {
              async all() {
                return { results: [sourceRow()] };
              },
            };
          },
        };
      },
    },
  });

  const page = await source.listConversationDailyPage({
    accountKey: 'chemistry_k',
    metricDate: '2026-09-16',
    reportingTimezone: 'Asia/Bangkok',
    limit: 500,
  });

  assert.equal(page.complete, true);
  assert.equal(page.rows[0].firstResponse.sum, 538);
  assert.equal(page.rows[0].firstResponse.count, 2);
  assert.equal(page.rows[0].resolvedCount, 1);
  assert.equal(page.rows[0].resolution.sum, 1314);
  assert.equal(page.rows[0].coverageRunId, 'coverage:reporting');
  assert.match(calls[0].sql, /FROM chatwoot_reporting_event_facts/u);
  assert.match(calls[0].sql, /event_end_at >= \? AND event_end_at < \?/u);
  assert.match(calls[0].sql, /MAX\(CASE WHEN event_name IN/u);
  assert.equal(calls[0].values[0], 'chemistry_k');
  assert.equal(calls[0].values[2] - calls[0].values[1], 86_400_000);
});

function sourceRow() {
  return {
    conversation_daily_key: 'chatwoot:chemistry_k:conversation:10552:2026-09-16',
    customer_key: 'chemistry_k',
    account_key: 'chemistry_k',
    external_account_id: 1,
    external_conversation_id: 10552,
    external_inbox_id: 4,
    external_agent_id: 6,
    external_team_id: null,
    metric_date: '2026-09-16',
    reporting_timezone: 'Asia/Bangkok',
    status: null,
    new_conversation_count: 1,
    resolved_count: 1,
    reopened_count: 0,
    incoming_message_count: 4,
    outgoing_message_count: 3,
    private_message_count: 0,
    attachment_message_count: 0,
    first_response_sum: 538,
    first_response_count: 2,
    first_response_business_sum: 0,
    first_response_business_count: 0,
    resolution_sum: 1314,
    resolution_count: 1,
    resolution_business_sum: 0,
    resolution_business_count: 0,
    reply_sum: 180,
    reply_count: 3,
    reply_business_sum: 0,
    reply_business_count: 0,
    coverage_run_id: 'coverage:reporting',
    source_revision: '1789568332922',
  };
}
