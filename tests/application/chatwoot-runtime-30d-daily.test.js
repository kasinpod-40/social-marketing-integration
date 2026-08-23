import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  JOB_SCHEMA_VERSIONS,
  JOB_TRIGGERS,
  JOB_TYPES,
  getJobDefinition,
} from '../../packages/application/src/jobs/job-catalog.js';
import {
  CHATWOOT_RUNTIME_CONTRACT,
  CHATWOOT_RUNTIME_JOB_SCHEMA_VERSION,
  CHATWOOT_RUNTIME_MODES,
  buildChatwootRuntimePlan,
  createInitialChatwootDurableState,
  isConversationAtOrBeforeChatwootBoundary,
  isConversationInChatwootWindow,
  resolveChatwootRuntimeMode,
  resolveChatwootRuntimeWindow,
} from '../../packages/application/src/use-cases/chatwoot-runtime-contract.js';
import {
  buildChatwootDailyRollupRows,
  createChatwootDailyRollupState,
  mergeChatwootDailyRollupState,
} from '../../packages/application/src/use-cases/chatwoot-daily-rollup.js';
import { syncChatwootDurableRuntime } from '../../packages/application/src/use-cases/sync-chatwoot-durable-runtime.js';
import { readChatwootRuntimeConfig } from '../../packages/config/src/chatwoot-runtime-config.js';
import { ChatwootDurableApiClient } from '../../packages/connectors/src/chatwoot/chatwoot-durable-api.client.js';
import { assertChatwootManualRuntime } from '../../apps/sync-worker/src/chatwoot-job-router.js';

const REQUESTED_AT = Date.parse('2026-07-31T01:00:00Z');
const DAY_MS = 86_400_000;

function methodObject(methods) {
  return Object.fromEntries(methods.map((name) => [name, async () => {
    throw new Error(`unexpected ${name}`);
  }]));
}

test('Chatwoot runtime contract is locked to 30d initial and daily 3d overlap', () => {
  assert.deepEqual(CHATWOOT_RUNTIME_CONTRACT, {
    initialBackfillDays: 30,
    incrementalOverlapDays: 3,
    syncFrequency: 'daily',
    autoExpandBackfill: false,
    includeUpdatedOlderConversations: true,
  });
  const initial = resolveChatwootRuntimeWindow({
    mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
    requestedAt: REQUESTED_AT,
  });
  const daily = resolveChatwootRuntimeWindow({
    mode: CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
    requestedAt: REQUESTED_AT,
  });
  assert.equal(initial.endAt - initial.startAt, 30 * DAY_MS);
  assert.equal(daily.endAt - daily.startAt, 3 * DAY_MS);
  assert.equal(initial.autoExpanded, false);
  assert.equal(daily.includeUpdatedOlderConversations, true);
});

test('Chatwoot catalog centralizes triggers and schema version', () => {
  const definition = getJobDefinition(JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC);
  assert.equal(definition.schemaVersion, JOB_SCHEMA_VERSIONS.CHATWOOT_RUNTIME);
  assert.equal(CHATWOOT_RUNTIME_JOB_SCHEMA_VERSION, JOB_SCHEMA_VERSIONS.CHATWOOT_RUNTIME);
  assert.equal(JOB_TRIGGERS.CHATWOOT_LEGACY_MANUAL_UAT, 'manual_uat');
  assert.deepEqual(definition.allowedTriggers, [
    JOB_TRIGGERS.CHATWOOT_INITIAL_30_DAY_UAT,
    JOB_TRIGGERS.CHATWOOT_DAILY_INCREMENTAL,
    JOB_TRIGGERS.CHATWOOT_SCHEDULED_DAILY,
  ]);
  assert.equal(
    resolveChatwootRuntimeMode(JOB_TRIGGERS.CHATWOOT_DAILY_INCREMENTAL),
    CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
  );
  assert.equal(
    resolveChatwootRuntimeMode(JOB_TRIGGERS.CHATWOOT_SCHEDULED_DAILY),
    CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
  );
});

test('Chatwoot runtime admits only the exact reviewed customer Production tuple', () => {
  const runtime = {
    environment: 'production',
    profileKey: 'chemistry_k',
    infrastructureOwner: 'customer',
    customerKey: 'chemistry_k',
    connectors: { chatwoot: { enabled: true, accountKey: 'chemistry_k' } },
  };
  const config = {
    flags: {
      connector: true,
      d1Write: true,
      larkWrite: true,
      reportWrite: true,
      schedule: false,
      webhook: false,
    },
  };
  assert.equal(
    assertChatwootManualRuntime(runtime, config, JOB_TRIGGERS.CHATWOOT_DAILY_INCREMENTAL).accountKey,
    'chemistry_k',
  );
  assert.throws(
    () => assertChatwootManualRuntime(
      { ...runtime, infrastructureOwner: 'developer' },
      config,
      JOB_TRIGGERS.CHATWOOT_DAILY_INCREMENTAL,
    ),
    (error) => error.code === 'CHATWOOT_MANUAL_UAT_TARGET_INVALID',
  );
});

test('all-false config retains exact locked runtime values and rejects expansion', () => {
  const config = readChatwootRuntimeConfig({});
  assert.equal(config.flags.connector, false);
  assert.equal(config.flags.d1Write, false);
  assert.equal(config.flags.larkWrite, false);
  assert.equal(config.flags.reportWrite, false);
  assert.equal(config.flags.schedule, false);
  assert.equal(config.flags.webhook, false);
  assert.deepEqual(config.contract, CHATWOOT_RUNTIME_CONTRACT);
  assert.equal(config.limits.incrementalOverlapHours, 72);
  assert.equal(config.limits.conversationRowsPerInvocation, 1);
  assert.throws(
    () => readChatwootRuntimeConfig({ CHATWOOT_INITIAL_BACKFILL_DAYS: '90' }),
    (error) => error?.code === 'CHATWOOT_RUNTIME_CONFIG_INVALID',
  );
  assert.throws(
    () => readChatwootRuntimeConfig({ CHATWOOT_AUTO_EXPAND_BACKFILL: 'true' }),
    (error) => error?.code === 'CHATWOOT_RUNTIME_CONFIG_INVALID',
  );
});

test('old-created Conversation is included when updated inside the sync window', () => {
  const window = resolveChatwootRuntimeWindow({
    mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
    requestedAt: REQUESTED_AT,
  });
  assert.equal(isConversationInChatwootWindow({
    created_at: REQUESTED_AT - 400 * DAY_MS,
    updated_at: REQUESTED_AT - 2 * DAY_MS,
    last_activity_at: REQUESTED_AT - 2 * DAY_MS,
  }, window), true);
  assert.equal(isConversationInChatwootWindow({
    created_at: REQUESTED_AT - 400 * DAY_MS,
    updated_at: REQUESTED_AT - 100 * DAY_MS,
  }, window), false);
});

test('Conversation identity discovery excludes post-boundary creations from convergence', () => {
  const window = resolveChatwootRuntimeWindow({
    mode: CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
    requestedAt: REQUESTED_AT,
  });
  assert.equal(isConversationAtOrBeforeChatwootBoundary({
    created_at: REQUESTED_AT,
  }, window), true);
  assert.equal(isConversationAtOrBeforeChatwootBoundary({
    created_at: REQUESTED_AT + 1,
  }, window), false);
  assert.throws(
    () => isConversationAtOrBeforeChatwootBoundary({}, window),
    (error) => error?.code === 'CHATWOOT_RUNTIME_TIMESTAMP_INVALID',
  );
});

test('plan supports at least 1,125 Reporting pages with bounded resumable units and no actions', () => {
  const plan = buildChatwootRuntimePlan({
    mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
    requestedAt: REQUESTED_AT,
    conversationPages: 304,
    conversationRows: 7_600,
    reportingPages: 1_125,
    conversationPagesPerInvocation: 1,
    reportingPagesPerInvocation: 5,
  });
  assert.equal(plan.conversationUnits, 7_600);
  assert.equal(plan.reportingUnits, 225);
  assert.equal(plan.totalUnits, 7_827);
  assert.equal(plan.queueMessagesSent, 0);
  assert.equal(plan.remoteD1Mutations, 0);
  assert.equal(plan.remoteLarkMutations, 0);
  assert.equal(plan.automaticBackfillExpansion, false);
});

test('durable Provider client accepts verified Reporting page 1,125 without raising generic limit', async () => {
  let requestedUrl = null;
  const client = new ChatwootDurableApiClient({
    baseUrl: 'https://chatwoot.example.test',
    accountId: 1,
    accessToken: 'test-token',
    maxPages: 1_000,
    maxReportingPages: 5_000,
    fetchImpl: async (url) => {
      requestedUrl = String(url);
      return new Response(JSON.stringify({
        payload: [],
        meta: { current_page: 1_125, total_pages: 1_125, count: 28_103 },
      }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  const page = await client.listAccountReportingEventsPage({
    page: 1_125,
    since: REQUESTED_AT - 30 * DAY_MS,
    until: REQUESTED_AT,
  });
  assert.equal(page.page, 1_125);
  assert.equal(page.totalPages, 1_125);
  assert.equal(page.totalCount, 28_103);
  assert.equal(page.hasMore, false);
  assert.match(requestedUrl, /page=1125/u);
});

test('daily rollup preserves missing metrics as null and stable keys on rerun', () => {
  const seed = createChatwootDailyRollupState({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    externalAccountId: 1,
    metricDate: '2026-07-30',
  });
  const merged = mergeChatwootDailyRollupState(seed, [{
    conversationDailyKey: 'chatwoot:chemistry_k:conversation:9:2026-07-30',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    externalAccountId: 1,
    externalConversationId: 9,
    externalInboxId: 3,
    externalAgentId: 14,
    metricDate: '2026-07-30',
    newConversationCount: 0,
    resolvedCount: 0,
    reopenedCount: 0,
    incomingMessageCount: 2,
    outgoingMessageCount: 1,
    firstResponseSeconds: null,
    resolutionSeconds: null,
    replySeconds: null,
    sourceRevision: '100',
  }]);
  const input = {
    state: merged,
    reportingTimezone: 'Asia/Bangkok',
    syncRunId: 'sync-1',
    coverageRunIdPrefix: 'coverage-1',
    fetchedAt: REQUESTED_AT,
  };
  const rows = buildChatwootDailyRollupRows(input);
  const rerun = buildChatwootDailyRollupRows(input);
  assert.deepEqual(rerun, rows);
  assert.equal(rows.agents[0].avg_first_response_seconds, null);
  assert.equal(rows.account[0].avg_resolution_seconds, null);
  assert.equal(rows.inboxes[0].incoming_message_count, 2);
  assert.equal(rows.account[0].account_daily_key, 'chatwoot:chemistry_k:account:2026-07-30');
});

test('stale continuation resumes from durable sequence without Provider or Business writes', async () => {
  const state = {
    ...createInitialChatwootDurableState({
      mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
      requestedAt: REQUESTED_AT,
    }),
    nextSequence: 2,
    stage: 'conversations',
    mastersComplete: true,
  };
  let phaseWrites = 0;
  const result = await syncChatwootDurableRuntime({
    mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
    continuationSequence: 1,
    requestedAt: REQUESTED_AT,
    generation: REQUESTED_AT,
    workKey: 'chatwoot:chemistry_k:operation',
    cursorKey: 'chatwoot:chemistry_k:analytics',
    syncRunId: 'chatwoot:chemistry_k:operation',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    externalAccountId: 1,
    reportingTimezone: 'Asia/Bangkok',
    limits: {
      conversationPagesPerInvocation: 1,
      reportingPagesPerInvocation: 5,
      maxConversations: 5000,
      maxContacts: 5000,
      maxReportingEvents: 100000,
      maxMessagePagesPerConversation: 50,
      maxMessagesPerConversation: 1000,
    },
    flags: { reportWrite: false, larkWrite: false },
    workStore: {
      loadPhase: async () => ({ state }),
      savePhase: async () => { phaseWrites += 1; },
    },
    client: methodObject([
      'listInboxes', 'listAgents', 'listTeams', 'listLabels', 'listConversationsPage',
      'getConversation',
      'listConversationReportingEvents', 'listConversationLabels', 'listMessagesPage',
      'listAccountReportingEventsPage',
    ]),
    chatwootStore: methodObject([
      'upsertAccountState', 'upsertInboxState', 'upsertContactState', 'upsertAgentState',
      'upsertTeamState', 'upsertLabelState', 'upsertConversationState',
      'upsertConversationLabelState', 'upsertMessageAnalyticsState', 'upsertReportingEventFact',
      'upsertConversationDailyFact', 'upsertAgentDailyFact', 'upsertInboxDailyFact',
      'upsertAccountDailyFact', 'readConversationStates', 'readConversationLabelStates',
    ]),
    coverageStore: methodObject(['saveCoverageRun', 'saveCoverageEntities']),
    incrementalStateStore: methodObject(['loadCheckpoint', 'saveCheckpoint']),
  });
  assert.equal(result.status, 'stale_continuation');
  assert.equal(result.nextSequence, 2);
  assert.equal(result.needsContinuation, true);
  assert.equal(phaseWrites, 0);
});

test('shared Queue/DLQ terminal path includes Chatwoot durable work', async () => {
  const source = await readFile(
    new URL('../../apps/sync-worker/src/queue-batch-router.js', import.meta.url),
    'utf8',
  );
  assert.match(source, /new Set\(\['youtube', 'tiktok', 'chatwoot'\]\)/u);
  assert.match(source, /\['facebook', 'instagram', 'tiktok', 'youtube', 'chatwoot'\]/u);
  assert.match(source, /queue-terminal-safe-d1-resumable-work-store/u);
});

test('plan-only operator contains no Queue, D1, Lark, deployment or schedule execution', async () => {
  const source = await readFile(
    new URL('../../scripts/chatwoot-runtime-plan.mjs', import.meta.url),
    'utf8',
  );
  assert.equal(source.includes('MKT_SYNC_QUEUE'), false);
  assert.equal(source.includes('MKT_STATE_DB'), false);
  assert.equal(source.includes('LARK_'), false);
  assert.equal(source.includes('wrangler deploy'), false);
  assert.match(source, /queueMessages: 0/u);
  assert.match(source, /remoteD1Mutations: 0/u);
});
