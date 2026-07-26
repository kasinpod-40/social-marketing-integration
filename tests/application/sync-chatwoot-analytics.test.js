import test from 'node:test';
import assert from 'node:assert/strict';
import { syncChatwootAnalytics } from '../../packages/application/src/use-cases/sync-chatwoot-analytics.js';

test('Chatwoot sync fails closed unless all write gates are explicit', async () => {
  await assert.rejects(
    () => syncChatwootAnalytics({}),
    (error) => error?.code === 'CHATWOOT_PROCESSING_GATES_DISABLED',
  );
});

test('Chatwoot sync writes D1 then Lark then checkpoint through injected shared contracts', async () => {
  const order = [];
  const tables = Object.fromEntries([
    'rawChatwootAccounts', 'rawChatwootInboxes', 'rawChatwootContacts', 'rawChatwootAgents',
    'rawChatwootTeams', 'rawChatwootLabels', 'rawChatwootConversations',
    'rawChatwootConversationLabels', 'rawChatwootMessageAnalytics', 'rawChatwootReportingEvents',
    'mktConversations', 'mktConversationDaily', 'mktAgentDaily', 'mktInboxDaily',
    'mktConversationAccountDaily',
  ].map((key) => [key, `table:${key}`]));
  const chatwootStore = makeChatwootStore(order);
  const coverageStore = {
    async saveCoverageRun() { order.push('d1:coverage-run'); },
    async saveCoverageEntities() { order.push('d1:coverage-entities'); },
  };
  const incrementalStateStore = {
    async loadCheckpoint() { return null; },
    async saveCheckpoint(value) { order.push('checkpoint'); return value; },
  };
  const syncEngine = {
    async planByKey(value) { return { ...value, stats: { total: value.rows.length } }; },
    async executePlan(plan) {
      order.push(`lark:${plan.tableId}`);
      return { created: plan.rows.length, updated: 0, skipped: 0, stats: plan.stats };
    },
  };
  const client = {
    async listInboxes() { return []; },
    async listAgents() { return []; },
    async listTeams() { return []; },
    async listLabels() { return []; },
    async listConversationsPage() { return { page: 1, rows: [], totalCount: 0, hasMore: false }; },
    async listContactsPage() { return { page: 1, rows: [], totalCount: 0, hasMore: false }; },
    async listAccountReportingEventsPage() { return { page: 1, rows: [], totalCount: 0, hasMore: false }; },
    async listConversationLabels() { return []; },
    async listMessagesPage() { throw new Error('no conversation should read messages'); },
    async collectPages(readPage) {
      const page = await readPage(1);
      return { rows: page.rows, pagesProcessed: 1, declaredTotal: page.totalCount, complete: true };
    },
  };

  const result = await syncChatwootAnalytics({
    d1WriteEnabled: true,
    larkWriteEnabled: true,
    checkpointWriteEnabled: true,
    webhookEnabled: false,
    customerProfile: 'integration_workspace',
    customerKey: 'customer_dev',
    accountKey: 'chat_dev',
    externalAccountId: '42',
    reportingTimezone: 'Asia/Bangkok',
    syncRunId: 'sync:chatwoot:test',
    observedAt: 1_785_080_000_000,
    client,
    chatwootStore,
    coverageStore,
    incrementalStateStore,
    repository: {},
    syncEngine,
    tables,
    assertLockActive: async () => order.push('lock'),
  });

  assert.equal(result.status, 'completed');
  assert.equal(result.source.conversationsSelected, 0);
  assert.equal(result.lark.tables.length, 15);
  assert.ok(order.indexOf('d1:account') < order.findIndex((value) => value.startsWith('lark:')));
  assert.ok(order.findLastIndex((value) => value.startsWith('lark:')) < order.indexOf('checkpoint'));
  assert.equal(order.at(-1), 'checkpoint');
});

function makeChatwootStore(order) {
  const store = {
    async readConversationStates() { return []; },
  };
  const methods = [
    ['upsertAccountState', 'account'], ['upsertInboxState', 'inbox'],
    ['upsertContactState', 'contact'], ['upsertAgentState', 'agent'],
    ['upsertTeamState', 'team'], ['upsertLabelState', 'label'],
    ['upsertConversationState', 'conversation'], ['upsertConversationLabelState', 'conversation-label'],
    ['upsertMessageAnalyticsState', 'message'], ['upsertReportingEventFact', 'reporting-event'],
    ['upsertConversationDailyFact', 'conversation-daily'], ['upsertAgentDailyFact', 'agent-daily'],
    ['upsertInboxDailyFact', 'inbox-daily'], ['upsertAccountDailyFact', 'account-daily'],
  ];
  for (const [method, label] of methods) {
    store[method] = async () => {
      order.push(`d1:${label}`);
      return { outcome: 'written', rows: 1 };
    };
  }
  return store;
}
