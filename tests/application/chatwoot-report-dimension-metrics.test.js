import test from 'node:test';
import assert from 'node:assert/strict';
import { buildChatwootDimensionMetricPayload } from '../../packages/application/src/reports/build-chatwoot-dimension-metric-payload.js';

test('builds six Chatwoot rankings with twenty fixed rows each', () => {
  const rows = buildChatwootDimensionMetricPayload({
    platform: 'chatwoot',
    formulaVersion: 'chatwoot-customer-service-v1',
    coverageComplete: true,
    facts: [
      {
        external_inbox_id: 20,
        external_agent_id: 200,
        new_conversation_count: 2,
        resolved_count: 4,
        incoming_message_count: 6,
        outgoing_message_count: 8,
      },
      {
        external_inbox_id: 10,
        external_agent_id: 100,
        new_conversation_count: 3,
        resolved_count: 1,
        incoming_message_count: 9,
        outgoing_message_count: 2,
      },
    ],
  });
  assert.equal(rows.length, 120);
  const inboxNew = rows.filter((row) => row.metricKey === 'chatwoot:inbox:new_conversations');
  assert.equal(inboxNew.length, 20);
  assert.equal(inboxNew[0].dimensionValue, 'rank:1');
  assert.equal(inboxNew[0].sourceDimensionValue, '10');
  assert.equal(inboxNew[0].current, 3);
  assert.equal(inboxNew[1].sourceDimensionValue, '20');
  assert.equal(inboxNew[2].current, null);
  assert.equal(inboxNew[2].clientVisible, false);
  assert.equal(inboxNew.every((row) => row.compare === null && row.change === null), true);

  const agentResolved = rows.filter((row) => row.metricKey === 'chatwoot:agent:resolved_conversations');
  assert.equal(agentResolved[0].sourceDimensionValue, '200');
  assert.equal(agentResolved[0].current, 4);
  assert.match(agentResolved[0].displayName, /Agent 200/u);
});

test('emits only null non-visible placeholders when Chatwoot Coverage is incomplete', () => {
  const rows = buildChatwootDimensionMetricPayload({
    platform: 'chatwoot',
    formulaVersion: 'chatwoot-customer-service-v1',
    coverageComplete: false,
    facts: [{
      external_inbox_id: 10,
      external_agent_id: 100,
      new_conversation_count: 3,
      resolved_count: 1,
      incoming_message_count: 9,
      outgoing_message_count: 2,
    }],
  });
  assert.equal(rows.length, 120);
  assert.equal(rows.every((row) => row.current === null), true);
  assert.equal(rows.every((row) => row.clientVisible === false), true);
  assert.equal(rows.every((row) => row.availabilityStatus === 'source_unavailable'), true);
});

test('rejects non-opaque dimension identities instead of materializing labels or PII', () => {
  assert.throws(() => buildChatwootDimensionMetricPayload({
    platform: 'chatwoot',
    formulaVersion: 'chatwoot-customer-service-v1',
    coverageComplete: true,
    facts: [{
      external_inbox_id: 'customer@email.example',
      external_agent_id: 100,
      new_conversation_count: 1,
      resolved_count: 1,
      incoming_message_count: 1,
      outgoing_message_count: 1,
    }],
  }), /opaque numeric text/u);
});
