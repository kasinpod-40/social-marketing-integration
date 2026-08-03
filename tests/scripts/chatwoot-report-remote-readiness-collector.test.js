import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATWOOT_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
  CHATWOOT_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF,
  assertChatwootReportRemoteCollectorConfirmation,
  assertChatwootSelectOnlySql,
  buildChatwootReportRemoteEvidence,
  parseChatwootCollectorFailure,
  parseChatwootRemoteJson,
  sanitizeChatwootRemoteEvidence,
  unwrapChatwootRemoteRows,
} from '../../scripts/lib/chatwoot-report-remote-readiness-collector.js';

test('internal collector requires reviewed-terminal handoff', () => {
  assert.throws(() => assertChatwootReportRemoteCollectorConfirmation({
    CONFIRM_CHATWOOT_REPORT_REMOTE_READINESS_COLLECTOR:
      CHATWOOT_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
  }), (error) => error?.code === 'CHATWOOT_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF_REQUIRED');
  assert.equal(assertChatwootReportRemoteCollectorConfirmation({
    CONFIRM_CHATWOOT_REPORT_REMOTE_READINESS_COLLECTOR:
      CHATWOOT_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
    MKT_CHATWOOT_REPORT_REMOTE_INTERNAL_HANDOFF:
      CHATWOOT_REPORT_REMOTE_COLLECTOR_INTERNAL_HANDOFF,
  }), true);
});

test('blocks non-read-only SQL including mutation CTEs', () => {
  assert.equal(assertChatwootSelectOnlySql('SELECT 1;'), 'SELECT 1;');
  assert.equal(assertChatwootSelectOnlySql('WITH x AS (SELECT 1) SELECT * FROM x;'), 'WITH x AS (SELECT 1) SELECT * FROM x;');
  assert.throws(() => assertChatwootSelectOnlySql('DELETE FROM report_materializations;'), (error) => (
    error?.code === 'CHATWOOT_REPORT_REMOTE_COLLECTOR_NON_SELECT_BLOCKED'
  ));
  assert.throws(() => assertChatwootSelectOnlySql('WITH x AS (UPDATE y SET a = 1 RETURNING *) SELECT * FROM x;'));
});

test('parses prefixed remote JSON and unwraps D1 result pages', () => {
  const parsed = parseChatwootRemoteJson('notice\n[{"results":[{"count":2}]}]');
  assert.deepEqual(unwrapChatwootRemoteRows(parsed), [{ count: 2 }]);
});

test('preserves structured internal failure while redacting sensitive identities', () => {
  const parsed = parseChatwootCollectorFailure(`warning\n${JSON.stringify({
    ok: false,
    stage: 'local-contracts-and-config',
    code: 'CHATWOOT_FINAL_UAT_TABLE_MAPPING_INVALID',
    message: 'Required mapping is missing',
    details: {
      field: 'LARK_TABLE_RAW_CHATWOOT_ACCOUNTS',
      tableId: 'tbl-secret',
      authorization: 'Bearer secret',
    },
  })}`);
  assert.deepEqual(parsed, {
    stage: 'local-contracts-and-config',
    code: 'CHATWOOT_FINAL_UAT_TABLE_MAPPING_INVALID',
    message: 'Required mapping is missing',
    details: { field: 'LARK_TABLE_RAW_CHATWOOT_ACCOUNTS' },
  });
  assert.equal(parseChatwootCollectorFailure('plain stderr only'), null);
});

test('builds fixed Chatwoot target and redacts infrastructure identities', () => {
  const evidence = buildChatwootReportRemoteEvidence({
    runtime: {}, catalog: {}, source: {}, report: {}, incidents: {}, windows: [],
  });
  assert.equal(evidence.target.platformScope, 'chatwoot');
  const sanitized = sanitizeChatwootRemoteEvidence({
    databaseId: 'hidden',
    nested: { authorization: 'hidden', count: 1 },
  });
  assert.deepEqual(sanitized, { nested: { count: 1 } });
});
