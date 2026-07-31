import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildChatwootDailyRollupRows,
  createChatwootDailyRollupState,
  mergeChatwootDailyRollupState,
} from '../../packages/application/src/use-cases/chatwoot-daily-rollup.js';

const OBSERVED_AT = Date.parse('2026-07-31T01:00:00Z');

async function readRepositoryFile(path) {
  return readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('release examples expose the exact locked Chatwoot window contract', async () => {
  const [vars, wrangler] = await Promise.all([
    readRepositoryFile('.dev.vars.example'),
    readRepositoryFile('wrangler.sync.example.jsonc'),
  ]);
  const expected = {
    CHATWOOT_INITIAL_BACKFILL_DAYS: '30',
    CHATWOOT_INCREMENTAL_OVERLAP_DAYS: '3',
    CHATWOOT_SYNC_FREQUENCY: 'daily',
    CHATWOOT_AUTO_EXPAND_BACKFILL: 'false',
    CHATWOOT_INCLUDE_UPDATED_OLDER_CONVERSATIONS: 'true',
  };
  for (const [key, value] of Object.entries(expected)) {
    assert.match(vars, new RegExp(`^${key}=${value}$`, 'mu'));
    assert.match(wrangler, new RegExp(`"${key}": "${value}"`, 'u'));
  }
  assert.equal(vars.includes('CHATWOOT_INCREMENTAL_OVERLAP_HOURS'), false);
  assert.equal(wrangler.includes('CHATWOOT_INCREMENTAL_OVERLAP_HOURS'), false);
});

test('bounded rollup writes reconciled Coverage runs and entities for every materialized row', () => {
  const seed = createChatwootDailyRollupState({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    externalAccountId: 1,
    metricDate: '2026-07-30',
  });
  const state = mergeChatwootDailyRollupState(seed, [{
    conversationDailyKey: 'chatwoot:chemistry_k:conversation:9:2026-07-30',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    externalAccountId: 1,
    externalConversationId: 9,
    externalInboxId: 3,
    externalAgentId: 14,
    metricDate: '2026-07-30',
    newConversationCount: 1,
    resolvedCount: 0,
    reopenedCount: 0,
    incomingMessageCount: 2,
    outgoingMessageCount: 1,
    firstResponseSeconds: null,
    resolutionSeconds: null,
    replySeconds: null,
    sourceRevision: '100',
  }]);
  const rows = buildChatwootDailyRollupRows({
    state,
    reportingTimezone: 'Asia/Bangkok',
    syncRunId: 'chatwoot:chemistry_k:operation:unit:9',
    coverageRunIdPrefix: 'chatwoot:chemistry_k:operation:unit:9:coverage',
    fetchedAt: OBSERVED_AT,
  });
  const materialized = [...rows.agents, ...rows.inboxes, ...rows.account];
  assert.equal(rows.coverageRuns.length, 3);
  assert.equal(rows.coverageEntities.length, materialized.length);
  assert.deepEqual(
    new Set(rows.coverageRuns.map((row) => row.coverage_run_id)),
    new Set(materialized.map((row) => row.coverage_run_id)),
  );
  assert.equal(rows.coverageRuns.every((row) => row.scope_mode === 'report_range'), true);
  assert.equal(rows.coverageRuns.every((row) => row.status === 'partial'), true);
});

test('Worker route fences pagination limits and uses the Chatwoot legacy trigger constant', async () => {
  const source = await readRepositoryFile('apps/sync-worker/src/chatwoot-job-router.js');
  assert.match(source, /CHATWOOT_LEGACY_MANUAL_UAT/u);
  assert.match(source, /limits\.conversationPagesPerInvocation/u);
  assert.match(source, /limits\.reportingPagesPerInvocation/u);
  assert.match(source, /limits\.maxReportingPages/u);
});
