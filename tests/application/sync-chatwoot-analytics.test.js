import test from 'node:test';
import assert from 'node:assert/strict';
import { syncChatwootAnalytics } from '../../packages/application/src/use-cases/sync-chatwoot-analytics.js';
import { transientError } from '../../packages/shared/src/errors/runtime-error.js';

const OBSERVED_AT = Date.parse('2026-07-27T12:00:00Z');

test('Chatwoot sync requires isolated connector/D1/checkpoint/report gates', async () => {
  await assert.rejects(
    () => syncChatwootAnalytics({}),
    (error) => error?.code === 'CHATWOOT_CONNECTOR_DISABLED',
  );
  await assert.rejects(
    () => syncChatwootAnalytics({ connectorEnabled: true }),
    (error) => error?.code === 'CHATWOOT_PROCESSING_GATES_DISABLED',
  );
  await assert.rejects(
    () => syncChatwootAnalytics({
      connectorEnabled: true,
      d1WriteEnabled: true,
      checkpointWriteEnabled: true,
      reportWriteEnabled: true,
      fullSnapshot: false,
    }),
    (error) => error?.code === 'CHATWOOT_REPORT_REQUIRES_FULL_SNAPSHOT',
  );
});

test('Chatwoot state-only sync writes D1, finalizes coverage, and checkpoints without report/Lark rows', async () => {
  const order = [];
  const coverageRows = [];
  const store = makeStore({ order });
  const result = await syncChatwootAnalytics({
    ...baseInput(),
    connectorEnabled: true,
    d1WriteEnabled: true,
    larkWriteEnabled: false,
    reportWriteEnabled: false,
    checkpointWriteEnabled: true,
    fullSnapshot: false,
    client: emptyClient(),
    chatwootStore: store,
    coverageStore: {
      async saveCoverageRun(row) { coverageRows.push(row); order.push(`coverage:${row.status}`); },
      async saveCoverageEntities() { order.push('coverage:entities'); },
    },
    incrementalStateStore: checkpointStore(order),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.lark.enabled, false);
  assert.equal(result.gates.reportWriteEnabled, false);
  assert.equal(order.includes('d1:conversation-daily'), false);
  assert.equal(order.includes('d1:agent-daily'), false);
  assert.equal(order.includes('d1:inbox-daily'), false);
  assert.equal(order.includes('d1:account-daily'), false);
  assert.equal(coverageRows.some((row) => row.status === 'partial'), true);
  assert.equal(coverageRows.some((row) => row.status === 'complete'), true);
  assert.equal(order.at(-1), 'checkpoint');
});

test('Chatwoot sync backfills complete message history with backward before pagination', async () => {
  const captured = [];
  const client = clientWithConversations([conversation(71)], {
    async listMessagesPage(input) {
      if (input.before === undefined) return messagePage(26, 45, true);
      if (String(input.before) === '26') return messagePage(6, 25, true);
      if (String(input.before) === '6') return messagePage(1, 5, false);
      throw new Error(`unexpected before ${input.before}`);
    },
    async listConversationReportingEvents() { return []; },
  });
  const result = await syncChatwootAnalytics({
    ...baseInput(),
    connectorEnabled: true,
    d1WriteEnabled: true,
    larkWriteEnabled: false,
    reportWriteEnabled: false,
    checkpointWriteEnabled: true,
    fullSnapshot: false,
    client,
    chatwootStore: makeStore({ capturedConversations: captured }),
    coverageStore: coverageStore(),
    incrementalStateStore: checkpointStore([]),
  });
  assert.equal(result.source.messagesSelected, 45);
  assert.equal(captured[0].message_count, 45);
  assert.equal(captured[0].incoming_message_count, 45);
});

test('Chatwoot sync defers one retryable Conversation while committing the healthy peers', async () => {
  const captured = [];
  const client = clientWithConversations([conversation(71), conversation(72)], {
    async listMessagesPage(input) {
      if (String(input.conversationId) === '71') {
        throw transientError('provider timeout', { code: 'CHATWOOT_TRANSIENT_API_ERROR' });
      }
      return { rows: [], hasMore: false, nextBefore: null };
    },
    async listConversationReportingEvents() { return []; },
  });
  const result = await syncChatwootAnalytics({
    ...baseInput(),
    connectorEnabled: true,
    d1WriteEnabled: true,
    larkWriteEnabled: false,
    reportWriteEnabled: false,
    checkpointWriteEnabled: true,
    fullSnapshot: true,
    client,
    chatwootStore: makeStore({ capturedConversations: captured }),
    coverageStore: coverageStore(),
    incrementalStateStore: checkpointStore([]),
  });

  assert.equal(result.source.conversationsSelected, 1);
  assert.deepEqual(result.source.deferredConversationIds, ['71']);
  assert.deepEqual(captured.map((row) => row.external_conversation_id), ['72']);
});

test('Chatwoot sync rethrows when every selected Conversation is retryable', async () => {
  const client = clientWithConversations([conversation(71)], {
    async listMessagesPage() {
      throw transientError('provider timeout', { code: 'CHATWOOT_TRANSIENT_API_ERROR' });
    },
    async listConversationReportingEvents() { return []; },
  });

  await assert.rejects(
    syncChatwootAnalytics({
      ...baseInput(),
      connectorEnabled: true,
      d1WriteEnabled: true,
      larkWriteEnabled: false,
      reportWriteEnabled: false,
      checkpointWriteEnabled: true,
      fullSnapshot: true,
      client,
      chatwootStore: makeStore({}),
      coverageStore: coverageStore(),
      incrementalStateStore: checkpointStore([]),
    }),
    (error) => error?.code === 'CHATWOOT_TRANSIENT_API_ERROR' && error.retryable === true,
  );
});

test('Chatwoot sync omits an orphan label reference without fabricating a label identity', async () => {
  const order = [];
  const captured = [];
  const client = clientWithConversations([conversation(71)], {
    async listConversationLabels() { return ['retired-label']; },
  });
  const row = conversation(71);
  delete row.labels;
  client.listConversationsPage = async () => ({
    page: 1, rows: [row], totalCount: 1, hasMore: false,
  });
  const result = await syncChatwootAnalytics({
    ...baseInput(),
    connectorEnabled: true,
    d1WriteEnabled: true,
    larkWriteEnabled: false,
    reportWriteEnabled: false,
    checkpointWriteEnabled: true,
    fullSnapshot: true,
    client,
    chatwootStore: makeStore({ order, capturedConversations: captured }),
    coverageStore: coverageStore(),
    incrementalStateStore: checkpointStore(order),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.source.unresolvedLabelReferences, 1);
  assert.equal(result.reconciliation.labelReferencesComplete, false);
  assert.equal(result.reconciliation.unresolvedLabelReferences, 1);
  assert.equal(captured.length, 1);
  assert.equal(order.includes('d1:conversation-label'), false);
});

test('Chatwoot sync batches D1 state and label reads above 500 conversations', async () => {
  const rows = Array.from({ length: 501 }, (_, index) => conversation(index + 1));
  const stateBatches = [];
  const labelBatches = [];
  const store = makeStore({
    readConversationStates: async (input) => {
      stateBatches.push(input.externalConversationIds.length);
      return [];
    },
    readConversationLabelStates: async (input) => {
      labelBatches.push(input.externalConversationIds.length);
      return [];
    },
  });
  const client = clientWithConversations(rows, {
    async listMessagesPage() { return { rows: [], hasMore: false, nextBefore: null }; },
    async listConversationReportingEvents() { return []; },
  });
  const result = await syncChatwootAnalytics({
    ...baseInput(),
    connectorEnabled: true,
    d1WriteEnabled: true,
    larkWriteEnabled: false,
    reportWriteEnabled: false,
    checkpointWriteEnabled: true,
    fullSnapshot: true,
    maxConversations: 1_000,
    client,
    chatwootStore: store,
    coverageStore: coverageStore(),
    incrementalStateStore: checkpointStore([]),
  });
  assert.equal(result.source.conversationsSelected, 501);
  assert.deepEqual(stateBatches, [500, 1]);
  assert.deepEqual(labelBatches, [500, 1]);
});

test('Chatwoot Lark failure leaves only partial coverage and does not checkpoint', async () => {
  const coverageRows = [];
  let checkpointed = false;
  const tables = stateTables();
  await assert.rejects(
    () => syncChatwootAnalytics({
      ...baseInput(),
      connectorEnabled: true,
      d1WriteEnabled: true,
      larkWriteEnabled: true,
      reportWriteEnabled: false,
      checkpointWriteEnabled: true,
      fullSnapshot: false,
      client: emptyClient(),
      chatwootStore: makeStore({}),
      coverageStore: {
        async saveCoverageRun(row) { coverageRows.push(row); },
        async saveCoverageEntities() {},
      },
      incrementalStateStore: {
        async loadCheckpoint() { return null; },
        async saveCheckpoint() { checkpointed = true; },
      },
      repository: {},
      tables,
      syncEngine: {
        async planByKey(value) { return value; },
        async executePlan() { throw new Error('Lark unavailable'); },
      },
    }),
    /Lark unavailable/u,
  );
  assert.equal(coverageRows.length > 0, true);
  assert.equal(coverageRows.every((row) => row.status === 'partial'), true);
  assert.equal(checkpointed, false);
});

test('Chatwoot Lark state-only mode writes only the customer-facing conversation table', async () => {
  const tables = stateTables();
  const result = await syncChatwootAnalytics({
    ...baseInput(),
    connectorEnabled: true,
    d1WriteEnabled: true,
    larkWriteEnabled: true,
    reportWriteEnabled: false,
    checkpointWriteEnabled: true,
    fullSnapshot: false,
    client: emptyClient(),
    chatwootStore: makeStore({}),
    coverageStore: coverageStore(),
    incrementalStateStore: checkpointStore([]),
    repository: {},
    tables,
    syncEngine: {
      async planByKey(value) { return { ...value, stats: { total: value.rows.length } }; },
      async executePlan(plan) {
        return { created: plan.rows.length, updated: 0, skipped: 0, stats: plan.stats };
      },
    },
  });
  assert.equal(result.lark.tables.length, 1);
  assert.equal(result.lark.tables.some((row) => row.tableKey === 'mktConversationDaily'), false);
});

function baseInput() {
  return {
    customerProfile: 'integration_workspace',
    customerKey: 'customer_dev',
    accountKey: 'chat_dev',
    externalAccountId: '42',
    reportingTimezone: 'Asia/Bangkok',
    syncRunId: 'sync:chatwoot:test',
    observedAt: OBSERVED_AT,
    webhookEnabled: false,
  };
}

function emptyClient() {
  return clientWithConversations([], {});
}

function clientWithConversations(conversations, overrides) {
  const client = {
    async listInboxes() { return []; },
    async listAgents() { return []; },
    async listTeams() { return []; },
    async listLabels() { return []; },
    async listConversationsPage() {
      return { page: 1, rows: conversations, totalCount: conversations.length, hasMore: false };
    },
    async listContactsPage() { return { page: 1, rows: [], totalCount: 0, hasMore: false }; },
    async listConversationLabels() { return []; },
    async listMessagesPage() { return { rows: [], hasMore: false, nextBefore: null }; },
    async listConversationReportingEvents() { return []; },
    async collectPages(readPage) {
      const page = await readPage(1);
      return { rows: page.rows, pagesProcessed: 1, declaredTotal: page.totalCount, complete: true };
    },
    ...overrides,
  };
  return client;
}

function conversation(id) {
  return {
    id,
    account_id: 42,
    inbox_id: 3,
    status: 'open',
    created_at: '2026-07-25T01:00:00Z',
    updated_at: '2026-07-27T04:00:00Z',
    last_activity_at: '2026-07-27T04:00:00Z',
    labels: [],
    meta: {},
  };
}

function messagePage(start, end, hasMore) {
  const rows = Array.from({ length: end - start + 1 }, (_, index) => ({
    id: start + index,
    account_id: 42,
    conversation_id: 71,
    inbox_id: 3,
    message_type: 0,
    content_type: 'text',
    private: false,
    sender_type: 'Contact',
    sender_id: 9,
    created_at: 1_785_000_000 + index,
  }));
  return { rows, hasMore, nextBefore: rows.length ? String(rows[0].id) : null };
}

function makeStore(options) {
  const order = options.order ?? [];
  const capturedConversations = options.capturedConversations ?? [];
  const store = {
    async readConversationStates(input) {
      return options.readConversationStates ? options.readConversationStates(input) : [];
    },
    async readConversationLabelStates(input) {
      return options.readConversationLabelStates ? options.readConversationLabelStates(input) : [];
    },
  };
  const methods = [
    ['upsertAccountState', 'account'], ['upsertInboxState', 'inbox'],
    ['upsertContactState', 'contact'], ['upsertAgentState', 'agent'],
    ['upsertTeamState', 'team'], ['upsertLabelState', 'label'],
    ['upsertConversationLabelState', 'conversation-label'],
    ['upsertMessageAnalyticsState', 'message'], ['upsertReportingEventFact', 'reporting-event'],
    ['upsertConversationDailyFact', 'conversation-daily'], ['upsertAgentDailyFact', 'agent-daily'],
    ['upsertInboxDailyFact', 'inbox-daily'], ['upsertAccountDailyFact', 'account-daily'],
  ];
  store.upsertConversationState = async (row) => {
    order.push('d1:conversation');
    capturedConversations.push(row);
    return { outcome: 'written', rows: 1 };
  };
  for (const [method, label] of methods) {
    store[method] = async () => {
      order.push(`d1:${label}`);
      return { outcome: 'written', rows: 1 };
    };
  }
  return store;
}

function coverageStore() {
  return {
    async saveCoverageRun() {},
    async saveCoverageEntities() {},
  };
}

function checkpointStore(order) {
  return {
    async loadCheckpoint() { return null; },
    async saveCheckpoint(value) { order.push('checkpoint'); return value; },
  };
}

function stateTables() {
  return Object.fromEntries([
    'mktConversations',
  ].map((key) => [key, `table:${key}`]));
}
