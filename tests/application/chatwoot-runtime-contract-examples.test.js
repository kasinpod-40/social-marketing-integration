import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildChatwootDailyRollupRows,
  createChatwootDailyRollupState,
  mergeChatwootDailyRollupState,
} from '../../packages/application/src/use-cases/chatwoot-daily-rollup.js';
import {
  CHATWOOT_RUNTIME_MODES,
  buildChatwootRuntimePlan,
  isChatwootEventInWindow,
  resolveChatwootRuntimeWindow,
} from '../../packages/application/src/use-cases/chatwoot-runtime-contract.js';
import { ChatwootDurableApiClient } from '../../packages/connectors/src/chatwoot/chatwoot-durable-api.client.js';

const OBSERVED_AT = Date.parse('2026-07-31T01:00:00Z');
const DAY_MS = 86_400_000;

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

test('plan counts every bounded source, rollup and finalization unit without execution', () => {
  const plan = buildChatwootRuntimePlan({
    mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
    requestedAt: OBSERVED_AT,
    conversationPages: 304,
    reportingPages: 1_125,
    rollupPages: 31,
    conversationPagesPerInvocation: 1,
    reportingPagesPerInvocation: 5,
  });
  assert.equal(plan.mastersUnits, 1);
  assert.equal(plan.conversationUnits, 304);
  assert.equal(plan.reportingUnits, 225);
  assert.equal(plan.rollupUnits, 31);
  assert.equal(plan.finalizationUnits, 1);
  assert.equal(plan.totalUnits, 562);
  assert.equal(plan.queueMessagesSent, 0);
});

test('late-updated Reporting Event remains in the daily overlap', () => {
  const window = resolveChatwootRuntimeWindow({
    mode: CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
    requestedAt: OBSERVED_AT,
  });
  assert.equal(isChatwootEventInWindow({
    event_end_time: Math.floor((OBSERVED_AT - 30 * DAY_MS) / 1_000),
    created_at: Math.floor((OBSERVED_AT - 30 * DAY_MS) / 1_000),
    updated_at: Math.floor((OBSERVED_AT - 2 * DAY_MS) / 1_000),
  }, window), true);
});

test('empty Reporting window with zero total pages completes without continuation', async () => {
  const client = new ChatwootDurableApiClient({
    baseUrl: 'https://chatwoot.example.test',
    accountId: 1,
    accessToken: 'test-token',
    maxReportingPages: 5_000,
    fetchImpl: async () => new Response(JSON.stringify({
      payload: [],
      meta: { current_page: 1, total_pages: 0, count: 0 },
    }), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  });
  const page = await client.listAccountReportingEventsPage({
    page: 1,
    since: OBSERVED_AT - 3 * DAY_MS,
    until: OBSERVED_AT,
  });
  assert.equal(page.totalPages, 0);
  assert.equal(page.totalCount, 0);
  assert.equal(page.hasMore, false);
  assert.deepEqual(page.rows, []);
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
  const durableRuntime = await readRepositoryFile(
    'packages/application/src/use-cases/sync-chatwoot-durable-runtime.js',
  );
  assert.match(source, /CHATWOOT_LEGACY_MANUAL_UAT/u);
  assert.match(source, /limits\.conversationPagesPerInvocation/u);
  assert.match(durableRuntime, /limits\.conversationRowsPerInvocation/u);
  assert.match(source, /limits\.reportingPagesPerInvocation/u);
  assert.match(source, /limits\.maxReportingPages/u);
});
