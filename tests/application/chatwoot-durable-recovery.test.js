import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CHATWOOT_RUNTIME_MODES,
  assertChatwootDurableState,
  createInitialChatwootDurableState,
  isConversationInChatwootWindow,
  resolveChatwootRuntimeWindow,
} from '../../packages/application/src/use-cases/chatwoot-runtime-contract.js';
import { syncChatwootDurableRuntime } from '../../packages/application/src/use-cases/sync-chatwoot-durable-runtime.js';

const REQUESTED_AT = Date.parse('2026-07-31T01:00:00Z');
const DAY_MS = 86_400_000;

test('zero-progress deployed Daily discovery upgrades safely to paginated two-pass state', () => {
  const state = {
    ...createInitialChatwootDurableState({
      mode: CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
      requestedAt: REQUESTED_AT,
    }),
    conversationDiscoveryStrategy: 'updated_within_once',
    stage: 'conversations',
    mastersComplete: true,
  };
  const upgraded = assertChatwootDurableState(state, {
    mode: CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
    requestedAt: REQUESTED_AT,
  });
  assert.equal(upgraded.conversationDiscoveryStrategy, 'stable_identity_two_pass');
  assert.equal(upgraded.conversationRowsScanned, 0);
  assert.deepEqual(upgraded.conversationSeenIds, []);
});

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
    getConversation: async (id) => ({ id }),
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
      conversationRowsPerInvocation: 1,
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

test('Initial Conversation scan keeps stable two-pass discovery and one detail row per delivery', async () => {
  let durableState = {
    ...createInitialChatwootDurableState({
      mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
      requestedAt: REQUESTED_AT,
    }),
    stage: 'conversations',
    mastersComplete: true,
    nextSequence: 2,
  };
  const rows = [91, 92].map((id) => ({
    id,
    account_id: 1,
    inbox_id: 3,
    status: 'open',
    created_at: REQUESTED_AT - DAY_MS,
    updated_at: REQUESTED_AT - DAY_MS,
    last_activity_at: REQUESTED_AT - DAY_MS,
  }));
  const written = [];
  const store = noOpStore();
  store.upsertConversationState = async (row) => {
    written.push(row.external_conversation_id ?? row.externalConversationId);
    return row;
  };
  const workStore = {
    loadPhase: async () => ({ state: durableState }),
    savePhase: async (input) => {
      durableState = input.state;
      return { state: input.state };
    },
  };
  const input = runtimeInput({
    mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
    continuationSequence: 2,
    client: requiredClient({
      listConversationsPage: async () => ({
        page: 1, rows, totalCount: 2, hasMore: false,
      }),
      getConversation: async (id) => rows.find((row) => row.id === id),
    }),
    chatwootStore: store,
    coverageStore: {
      saveCoverageRun: async (row) => row,
      saveCoverageEntities: async (values) => values,
    },
    workStore,
  });

  const first = await syncChatwootDurableRuntime(input);
  assert.deepEqual(written, ['91']);
  assert.equal(first.stage, 'conversations');
  assert.equal(durableState.conversationPage, 1);
  assert.equal(durableState.conversationRowOffset, 1);
  assert.deepEqual(durableState.conversationSeenIds, [91, 92]);
  assert.deepEqual(durableState.conversationPendingIds, [92]);
  assert.equal(durableState.conversationDiscoveryPass, 2);
  assert.equal(first.nextSequence, 3);

  const second = await syncChatwootDurableRuntime({ ...input, continuationSequence: 3 });
  assert.deepEqual(written, ['91', '92']);
  assert.equal(second.stage, 'conversations');
  assert.equal(durableState.conversationRowOffset, 2);
  assert.equal(durableState.conversationPageFingerprint, null);
  assert.equal(second.nextSequence, 4);

  const third = await syncChatwootDurableRuntime({ ...input, continuationSequence: 4 });
  assert.deepEqual(written, ['91', '92']);
  assert.equal(third.stage, 'reporting');
  assert.equal(durableState.conversationsSelected, 2);
  assert.equal(third.nextSequence, 5);
});

test('Daily Conversation discovery uses page-bounded stable two-pass convergence', async () => {
  let durableState = {
    ...createInitialChatwootDurableState({
      mode: CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
      requestedAt: REQUESTED_AT,
    }),
    stage: 'conversations',
    mastersComplete: true,
    nextSequence: 2,
  };
  const rows = [91, 92].map((id) => ({
    id,
    account_id: 1,
    inbox_id: 3,
    status: 'open',
    created_at: REQUESTED_AT - DAY_MS,
    updated_at: REQUESTED_AT - DAY_MS,
    last_activity_at: REQUESTED_AT - DAY_MS,
  }));
  const requests = [];
  const workStore = {
    loadPhase: async () => ({ state: durableState }),
    savePhase: async (input) => {
      durableState = input.state;
      return { state: input.state };
    },
  };
  const input = runtimeInput({
    now: () => REQUESTED_AT + 60_000,
    client: requiredClient({
      listConversationsPage: async (request) => {
        requests.push(request);
        return { page: 1, rows, totalCount: rows.length, hasMore: false };
      },
      getConversation: async (id) => rows.find((row) => row.id === id),
    }),
    chatwootStore: noOpStore(),
    coverageStore: {
      saveCoverageRun: async (row) => row,
      saveCoverageEntities: async (values) => values,
    },
    workStore,
  });

  await syncChatwootDurableRuntime(input);
  await syncChatwootDurableRuntime({ ...input, continuationSequence: 3 });
  const third = await syncChatwootDurableRuntime({ ...input, continuationSequence: 4 });

  assert.equal(requests.length, 2);
  assert.equal(requests[0].page, 1);
  assert.equal(requests[0].updatedWithinSeconds, undefined);
  assert.equal(durableState.conversationRowsScanned, 2);
  assert.equal(durableState.conversationsSelected, 2);
  assert.equal(durableState.conversationDiscoveryComplete, true);
  assert.equal(third.stage, 'reporting');
});

test('legacy page fingerprint resume migrates to stable identity discovery', async () => {
  const initial = createInitialChatwootDurableState({
    mode: CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL,
    requestedAt: REQUESTED_AT,
  });
  const {
    conversationSeenIds: _seen,
    conversationPendingIds: _pending,
    conversationDiscoveryPass: _pass,
    conversationNewIdsInPass: _newIds,
    conversationDiscoveryStrategy: _strategy,
    conversationDiscoveryComplete: _discoveryComplete,
    conversationUpdatedWithinSeconds: _updatedWithinSeconds,
    conversationLegacyDriftRecovered: _recovered,
    ...legacyInitial
  } = initial;
  const state = {
    ...legacyInitial,
    stage: 'conversations',
    mastersComplete: true,
    nextSequence: 3,
    conversationRowOffset: 1,
    conversationPageFingerprint: '0'.repeat(64),
  };
  let durableState = state;
  const row = {
    id: 92,
    account_id: 1,
    inbox_id: 3,
    status: 'open',
    created_at: REQUESTED_AT - DAY_MS,
    updated_at: REQUESTED_AT - DAY_MS,
  };
  const input = runtimeInput({
    continuationSequence: 3,
    client: requiredClient({
      listConversationsPage: async () => ({
        page: 1,
        rows: [row],
        totalCount: 1,
        hasMore: false,
      }),
      getConversation: async () => row,
    }),
    chatwootStore: noOpStore(),
    coverageStore: {
      saveCoverageRun: async (row) => row,
      saveCoverageEntities: async (values) => values,
    },
    workStore: {
      loadPhase: async () => ({ state: durableState }),
      savePhase: async (value) => {
        durableState = value.state;
        return { state: value.state };
      },
    },
  });
  const result = await syncChatwootDurableRuntime(input);
  assert.equal(result.stage, 'conversations');
  assert.equal(durableState.conversationLegacyDriftRecovered, true);
  assert.equal(durableState.conversationDiscoveryStrategy, 'stable_identity_two_pass');
  assert.deepEqual(durableState.conversationSeenIds, [92]);
  assert.equal(durableState.conversationsSelected, 1);
  assert.equal(durableState.conversationPageFingerprint, null);
});

test('identity discovery deduplicates mutable pages and fails closed on detail identity mismatch', async () => {
  let durableState = {
    ...createInitialChatwootDurableState({
      mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
      requestedAt: REQUESTED_AT,
    }),
    stage: 'conversations',
    mastersComplete: true,
    nextSequence: 1,
  };
  const row = {
    id: 92,
    account_id: 1,
    inbox_id: 3,
    status: 'open',
    created_at: REQUESTED_AT - DAY_MS,
    updated_at: REQUESTED_AT - DAY_MS,
  };
  const input = runtimeInput({
    mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
    continuationSequence: 1,
    client: requiredClient({
      listConversationsPage: async () => ({
        page: 1, rows: [row, row], totalCount: 1, hasMore: false,
      }),
      getConversation: async () => ({ ...row, id: 93 }),
    }),
    chatwootStore: noOpStore(),
    coverageStore: {
      saveCoverageRun: async (value) => value,
      saveCoverageEntities: async (values) => values,
    },
    workStore: {
      loadPhase: async () => ({ state: durableState }),
      savePhase: async (value) => {
        durableState = value.state;
        return { state: value.state };
      },
    },
  });
  await assert.rejects(
    syncChatwootDurableRuntime(input),
    (error) => error?.code === 'CHATWOOT_CONVERSATION_IDENTITY_MISMATCH',
  );
  assert.deepEqual(durableState.conversationSeenIds, []);
});

test('post-boundary Conversation discovered during verification does not keep the run alive', async () => {
  let durableState = {
    ...createInitialChatwootDurableState({
      mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
      requestedAt: REQUESTED_AT,
    }),
    stage: 'conversations',
    mastersComplete: true,
    nextSequence: 5,
    conversationPage: 1,
    conversationSeenIds: [91],
    conversationDiscoveryPass: 2,
    conversationNewIdsInPass: 0,
  };
  let detailReads = 0;
  const futureRow = {
    id: 92,
    account_id: 1,
    inbox_id: 3,
    status: 'open',
    created_at: REQUESTED_AT + 1_000,
    updated_at: REQUESTED_AT + 1_000,
    last_activity_at: REQUESTED_AT + 1_000,
  };
  const input = runtimeInput({
    mode: CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT,
    continuationSequence: 5,
    client: requiredClient({
      listConversationsPage: async () => ({
        page: 1, rows: [futureRow], totalCount: 2, hasMore: false,
      }),
      getConversation: async () => {
        detailReads += 1;
        return futureRow;
      },
    }),
    chatwootStore: noOpStore(),
    coverageStore: {
      saveCoverageRun: async (value) => value,
      saveCoverageEntities: async (values) => values,
    },
    workStore: {
      loadPhase: async () => ({ state: durableState }),
      savePhase: async (value) => {
        durableState = value.state;
        return { state: value.state };
      },
    },
  });

  const result = await syncChatwootDurableRuntime(input);

  assert.equal(result.stage, 'reporting');
  assert.equal(durableState.conversationsComplete, true);
  assert.equal(durableState.conversationNewIdsInPass, 0);
  assert.deepEqual(durableState.conversationSeenIds, [91, 92]);
  assert.deepEqual(durableState.conversationPendingIds, []);
  assert.equal(detailReads, 0);
});

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
