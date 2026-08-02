import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATWOOT_REPORT_CAPABILITY,
  CHATWOOT_REPORT_CONTRACT,
  CHATWOOT_REPORT_PLATFORM_SCOPE,
  CHATWOOT_REPORT_TOP_DIMENSION_LIMIT,
  CHATWOOT_REPORT_WINDOWS,
  assertChatwootReportContract,
  getChatwootReportMetric,
} from '../../packages/config/src/chatwoot-report-contract.js';

test('Chatwoot Report contract remains unwired customer-service design for 1/3/7/30', () => {
  assert.equal(CHATWOOT_REPORT_PLATFORM_SCOPE, 'chatwoot');
  assert.equal(CHATWOOT_REPORT_CAPABILITY, 'customer_service');
  assert.deepEqual(CHATWOOT_REPORT_WINDOWS, [1, 3, 7, 30]);
  assert.equal(CHATWOOT_REPORT_CONTRACT.contractVersion, 'chatwoot_generic_report_contract_v1');
  assert.equal(assertChatwootReportContract(), true);
});

test('Chatwoot summary metrics derive only from approved daily fact tables', () => {
  assert.equal(CHATWOOT_REPORT_CONTRACT.summaryMetrics.length, 19);
  assert.deepEqual(
    [...new Set(CHATWOOT_REPORT_CONTRACT.summaryMetrics.map((metric) => metric.sourceTable))].sort(),
    ['chatwoot_account_daily_facts', 'chatwoot_conversation_daily_facts'],
  );
  assert.ok(CHATWOOT_REPORT_CONTRACT.summaryMetrics.every((metric) => metric.currentOnIncomplete === null));
  assert.ok(CHATWOOT_REPORT_CONTRACT.summaryMetrics.every((metric) => metric.observedZero === 0));
});

test('Chatwoot duration metrics use eligible sums and counts rather than averages of averages', () => {
  for (const metricKey of [
    'chatwoot:average_first_response_seconds',
    'chatwoot:average_resolution_seconds',
    'chatwoot:average_reply_seconds',
  ]) {
    assert.equal(
      getChatwootReportMetric(metricKey).aggregation,
      'sum_non_null_divide_count_non_null',
    );
  }
  assert.ok(CHATWOOT_REPORT_CONTRACT.rejectedMetrics.some(
    (entry) => entry.metricName === 'average_of_daily_averages',
  ));
});

test('Chatwoot dimensions are bounded, opaque and non-comparable across ranks', () => {
  assert.deepEqual(
    CHATWOOT_REPORT_CONTRACT.dimensions.map((entry) => entry.dimensionType),
    ['inbox', 'agent'],
  );
  for (const dimension of CHATWOOT_REPORT_CONTRACT.dimensions) {
    assert.equal(dimension.rankLimit, CHATWOOT_REPORT_TOP_DIMENSION_LIMIT);
    assert.equal(dimension.fixedRankPlaceholders, true);
    assert.equal(dimension.comparisonEligible, false);
    assert.ok(dimension.rankings.every((ranking) => ranking.emptyRankValue === null));
  }
});

test('Chatwoot Report design rejects unsupported rates, SLA, CSAT, labels and PII metrics', () => {
  const rejected = new Set(CHATWOOT_REPORT_CONTRACT.rejectedMetrics.map((entry) => entry.metricName));
  for (const metricName of [
    'resolution_rate',
    'sla_compliance_rate',
    'csat_score',
    'unique_contacts',
    'label_rankings',
    'message_content_metrics',
  ]) assert.equal(rejected.has(metricName), true);

  assert.equal(CHATWOOT_REPORT_CONTRACT.piiBoundary.messageBody, 'forbidden');
  assert.equal(CHATWOOT_REPORT_CONTRACT.piiBoundary.email, 'forbidden');
  assert.equal(CHATWOOT_REPORT_CONTRACT.piiBoundary.phone, 'forbidden');
  assert.equal(CHATWOOT_REPORT_CONTRACT.piiBoundary.opaqueInboxId, 'allowed');
  assert.equal(CHATWOOT_REPORT_CONTRACT.piiBoundary.opaqueAgentId, 'allowed');
});
