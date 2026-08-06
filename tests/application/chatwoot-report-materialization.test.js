import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportMetricValueRows } from '../../packages/application/src/reports/build-report-output-rows.js';
import {
  buildChatwootMetricPayload,
  calculateChatwootPeriodMetrics,
} from '../../packages/application/src/reports/calculate-chatwoot-period-metrics.js';

function completeSource(overrides = {}) {
  return {
    facts: [
      {
        new_conversation_count: 1,
        resolved_count: 1,
        reopened_count: 0,
        incoming_message_count: 4,
        outgoing_message_count: 2,
        private_message_count: 1,
        attachment_message_count: 0,
        first_response_seconds: 10,
        resolution_seconds: 100,
        reply_seconds: null,
      },
      {
        new_conversation_count: 2,
        resolved_count: 0,
        reopened_count: 1,
        incoming_message_count: 3,
        outgoing_message_count: 5,
        private_message_count: 0,
        attachment_message_count: 2,
        first_response_seconds: 30,
        resolution_seconds: null,
        reply_seconds: 8,
      },
    ],
    periodEndSnapshot: {
      conversation_count: 65,
      open_conversation_count: 7,
      pending_conversation_count: 3,
      snoozed_conversation_count: 2,
      active_agent_count: 4,
      active_inbox_count: 2,
    },
    coverage: { complete: true },
    ...overrides,
  };
}

test('calculates Chatwoot period sums, eligible counts and weighted duration averages', () => {
  const result = calculateChatwootPeriodMetrics(completeSource());
  assert.equal(result.dataStatus, 'complete');
  assert.equal(result.coverageRate, 1);
  assert.equal(result.metrics['chatwoot:new_conversations'], 3);
  assert.equal(result.metrics['chatwoot:resolved_conversations'], 1);
  assert.equal(result.metrics['chatwoot:incoming_messages'], 7);
  assert.equal(result.metrics['chatwoot:first_response_eligible_count'], 2);
  assert.equal(result.metrics['chatwoot:average_first_response_seconds'], 20);
  assert.equal(result.metrics['chatwoot:resolution_eligible_count'], 1);
  assert.equal(result.metrics['chatwoot:average_resolution_seconds'], 100);
  assert.equal(result.metrics['chatwoot:reply_eligible_count'], 1);
  assert.equal(result.metrics['chatwoot:average_reply_seconds'], 8);
  assert.equal(result.metrics['chatwoot:conversation_count_end'], 65);
  assert.equal(result.metrics['chatwoot:active_inboxes_end'], 2);
});

test('keeps every Chatwoot Business metric null when Coverage is incomplete', () => {
  const result = calculateChatwootPeriodMetrics(completeSource({ coverage: { complete: false } }));
  assert.equal(result.dataStatus, 'source_unavailable');
  assert.equal(result.coverageRate, null);
  assert.equal(Object.values(result.metrics).every((value) => value === null), true);
});

test('builds comparison payload without inventing a percentage for a zero baseline', () => {
  const current = calculateChatwootPeriodMetrics(completeSource());
  const compare = calculateChatwootPeriodMetrics(completeSource({
    facts: [],
    periodEndSnapshot: {
      conversation_count: 60,
      open_conversation_count: 0,
      pending_conversation_count: 0,
      snoozed_conversation_count: 0,
      active_agent_count: 3,
      active_inbox_count: 2,
    },
  }));
  const payload = buildChatwootMetricPayload({
    platform: 'chatwoot',
    formulaVersion: 'chatwoot-customer-service-v1',
    current,
    compare,
  });
  assert.equal(Object.keys(payload).length, 19);
  assert.equal(payload['chatwoot:new_conversations'].current, 3);
  assert.equal(payload['chatwoot:new_conversations'].compare, 0);
  assert.equal(payload['chatwoot:new_conversations'].change, 3);
  assert.equal(payload['chatwoot:new_conversations'].changePercent, null);
  assert.equal(payload['chatwoot:conversation_count_end'].compare, 60);
  assert.equal(payload['chatwoot:conversation_count_end'].change, 5);
});

test('maps Chatwoot period-end snapshots to the canonical current_total Dashboard scope', () => {
  const current = calculateChatwootPeriodMetrics(completeSource());
  const payload = buildChatwootMetricPayload({
    platform: 'chatwoot',
    formulaVersion: 'chatwoot-customer-service-v1',
    current,
  });

  assert.equal(payload['chatwoot:new_conversations'].metricScope, 'period_delta');
  assert.equal(payload['chatwoot:conversation_count_end'].metricScope, 'current_total');
  assert.equal(
    Object.values(payload).some((metric) => metric.metricScope === 'period_end_snapshot'),
    false,
  );

  const rows = buildReportMetricValueRows({
    reportId: 'integration_workspace:chatwoot:rolling:1d:chemistry_k:rolling_days:2026-08-01:2026-08-01:chatwoot-customer-service-v1',
    reportSettingKey: 'integration_workspace:chatwoot:rolling:1d',
    customerProfile: 'integration_workspace',
    accountId: 'chemistry_k',
    reportType: 'dashboard_performance_report',
    platform: 'chatwoot',
    dataStatus: 'complete',
    metrics: payload,
    period: {
      periodStart: '2026-08-01',
      periodEnd: '2026-08-01',
      compareStart: null,
      compareEnd: null,
    },
    generatedAt: Date.parse('2026-08-02T00:00:00.000Z'),
    utcOffset: '+07:00',
    sourceSnapshotCount: 2,
  });

  assert.equal(rows.length, 19);
  assert.equal(
    rows.find((row) => row.metric_key === 'chatwoot:new_conversations')?.metric_scope,
    'period_delta',
  );
  assert.equal(
    rows.find((row) => row.metric_key === 'chatwoot:conversation_count_end')?.metric_scope,
    'current_total',
  );
});
