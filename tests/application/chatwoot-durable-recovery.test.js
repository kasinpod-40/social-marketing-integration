import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATWOOT_RUNTIME_MODES,
  createInitialChatwootDurableState,
  isConversationInChatwootWindow,
  resolveChatwootRuntimeWindow,
} from '../../packages/application/src/use-cases/chatwoot-runtime-contract.js';
import { syncChatwootDurableRuntime } from '../../packages/application/src/use-cases/sync-chatwoot-durable-runtime.js';

const REQUESTED_AT = Date.parse('2026-07-31T01:00:00Z');
const DAY_MS = 86_400_000;

function noOpStore() {
  const methods = [
    'upsertAccountState', 'upsertInboxState', 'upsertContactState', 'upsertAgentState',
    'upsertTeamState', 'upsertLabelState', 'upsertConversationState',
    'upsertConversationLabelState', 'upsertMessageAnalyticsState', 'upsertReportingEventFact',
    'upsertConversationDailyFact', 'upsertAgentDailyFact', 'upsertInboxDailyFact',
    'upsertAccountDailyFact',
  ];
  const store = Object.fromEntries(methods.map((method) => [method, async () => ({ method })]));
  store.readConversationStates = async () => [];
  store.readConversationLabelStates = async () => [];
  return store;
}

function requiredClient(overrides = {}) {
  return {
    listInboxes: async () => [],
    listAgents: async () => [],
    listTeams: async () => [],
    listLabels: async () => [],
    listConversationsPage: async () => ({ page: 1, rows: [], totalCount: 0, hasMore: false }),
    listConversationReportingEvents: async () => [],
    listConversationLabels: async () => [],
    listMessagesPage: async () => ({
      rows: [], mode: 'before', nextAfter: null, nextBefore: null, hasMore: false, labels: [],
    }),
    listAccountReportingEventsPage: async () => ({
      page: 1, rows: [], totalCount: 0, totalPages: 1, hasMore: false,
    }),
    ...overrides,
  };
}

function runtimeInput(overrides = {}) {
  return {
    mode: CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
    continuationSequence: 2,
    requestedAt: REQUESTED_AT,
    generation: REQUESTED_AT,
    workKey: 'chatwoot:chemistry_k:daily-operation',
    cursorKey: 'chatwoot:chemistry_k:analytics',
    syncRunId: 'chatwoot:chemistry_k:daily-operation',
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    externalAccountId: 1,
    reportingTimezone: 'Asia/Bangkok',
    limits: {
      conversationPagesPerInvocation: 1,
      reportingPagesPerInvocation: 5,
      maxConversations: 5_000,
      maxContacts: 5_000,
      maxReportingEvents: 100_000,
      maxMessagePagesPerConversation: 50,
      maxMessagesPerConversation: 1_000,
    },
    flags: { reportWrite: false, larkWrite: false },
    incrementalStateStore: {
      loadCheckpoint: async () => ({ cursor: null, recordStates: [] }),
      saveCheckpoint: async () => ({ recordsSaved: 0, fullSnapshot: false }),
    },
    assertCurrent: async () => undefined,
    ...overrides,
  };
}

test('daily overlap includes a late-arriving update on an older-created Conversation', () => {
  const window = resolveChatwootRuntimeWindow({
    mode: CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
    requestedAt: REQUESTED_AT,
  });
  assert.equal(window.endAt - window.startAt, 3 * DAY_MS);
  assert.equal(isConversationInChatwootWindow({
    created_at: REQUESTED_AT - 300 * DAY_MS,
    updated_at: REQUESTED_AT - 2 * DAY_MS,
    last_activity_at: REQUESTED_AT - 2 * DAY_MS,
  }, window), true);
  assert.equal(isConversationInChatwootWindow({
    created_at: REQUESTED_AT - 300 * DAY_MS,
    updated_at: REQUESTED_AT - 4 * DAY_MS,
    last_activity_at: REQUESTED_AT - 4 * DAY_MS,
  }, window), false);
});

test('partial failure reruns the same durable Reporting unit without duplicate Stable keys', async () => {
  const durableState = {
    ...createInitialChatwootDurableState({
      mode: CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
      requestedAt: REQUESTED_AT,
    }),
    stage: 'reporting',
    mastersComplete: true,
    conversationsComplete: true,
    conversationPage: 2,
    conversationPagesProcessed: 1,
    nextSequence: 2,
  };
  const event = {
    id: 501,
    name: 'first_response',
    account_id: 1,
    value: 42,
    conversation_id: 9,
    inbox_id: 3,
    user_id: 14,
    event_start_time: Math.floor((REQUESTED_AT - DAY_MS) / 1_000),
    event_end_time: Math.floor((REQUESTED_AT - DAY_MS + 42_000) / 1_000),
    created_at: Math.floor((REQUESTED_AT - DAY_MS) / 1_000),
    updated_at: Math.floor((REQUESTED_AT - DAY_MS) / 1_000),
  };
  const stableBusinessKeys = new Set();
  const stableCoverageKeys = new Set();
  let failAfterBusinessWrite = true;
  let phaseWrites = 0;
  const store = noOpStore();
  store.upsertAccountState = async () => {
    throw new Error('Reporting unit must not rewrite latest-state Account');
  };
  store.upsertReportingEventFact = async (row) => {
    stableBusinessKeys.add(row.reporting_event_key);
    if (failAfterBusinessWrite) {
      failAfterBusinessWrite = false;
      throw new Error('simulated interruption after stable business write');
    }
    return { outcome: 'skipped' };
  };
  const coverageStore = {
    saveCoverageRun: async (row) => {
      stableCoverageKeys.add(row.coverage_run_id);
      return row;
    },
    saveCoverageEntities: async (rows) => rows,
  };
  const workStore = {
    loadPhase: async () => ({ state: durableState }),
    savePhase: async (input) => {
      phaseWrites += 1;
      return { state: input.state };
    },
  };
  const input = runtimeInput({
    client: requiredClient({
      listAccountReportingEventsPage: async () => ({
        page: 1,
        rows: [event],
        totalCount: 1,
        totalPages: 1,
        hasMore: false,
      }),
    }),
    chatwootStore: store,
    coverageStore,
    workStore,
  });

  await assert.rejects(
    syncChatwootDurableRuntime(input),
    /simulated interruption/u,
  );
  assert.equal(phaseWrites, 0);
  assert.equal(stableBusinessKeys.size, 1);

  const recovered = await syncChatwootDurableRuntime(input);
  assert.equal(recovered.status, 'continuation_required');
  assert.equal(recovered.stage, 'checkpoint');
  assert.equal(recovered.nextSequence, 3);
  assert.equal(phaseWrites, 1);
  assert.equal(stableBusinessKeys.size, 1);
  assert.equal(stableCoverageKeys.size, 1);
});
