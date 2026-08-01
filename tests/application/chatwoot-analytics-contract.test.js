import test from 'node:test';
import assert from 'node:assert/strict';
import {
  hashChatwootLabelTitle,
  normalizeChatwootAccount,
  normalizeChatwootAgent,
  normalizeChatwootContact,
  normalizeChatwootConversation,
  normalizeChatwootInbox,
  normalizeChatwootLabel,
  normalizeChatwootMessage,
  normalizeChatwootReportingEvent,
  normalizeChatwootTeam,
} from '../../packages/connectors/src/chatwoot/chatwoot-analytics-normalizers.js';
import {
  finalizeChatwootCoverageRuns,
  prepareChatwootAnalyticsSync,
} from '../../packages/application/src/use-cases/prepare-chatwoot-analytics-sync.js';
import { validateStorageRow } from '../../packages/application/src/storage/marketing-history-contract.js';

const OBSERVED_AT = Date.parse('2026-07-27T12:00:00Z');
const BASE_CONTEXT = Object.freeze({
  customerKey: 'customer_dev',
  accountKey: 'chat_dev',
  externalAccountId: '42',
});

test('Chatwoot normalizers discard direct PII, message bodies, and label text', async () => {
  const rows = await buildNormalizedRows({ observedAt: OBSERVED_AT });
  const serialized = JSON.stringify(rows);
  for (const forbiddenValue of [
    'person@example.test', '+66123456789', 'Sensitive Person', 'private message text',
    'https://files.example.test/private.pdf', 'Agent Name', 'VIP Alice',
  ]) {
    assert.equal(serialized.includes(forbiddenValue), false);
  }
  assert.equal(rows.message.contentType, 'text');
  assert.equal(rows.message.attachmentCount, 1);
  assert.equal(rows.label.titleHash, await hashChatwootLabelTitle('VIP Alice'));
  assert.equal(rows.conversation.firstResponseSeconds, 120);
});

test('Chatwoot conversation normalizer accepts fractional epoch seconds from the live API', async () => {
  const conversation = await normalizeChatwootConversation({
    id: 71,
    account_id: 42,
    inbox_id: 3,
    status: 'open',
    created_at: 1785557000,
    updated_at: 1785558008.123,
  }, {
    ...BASE_CONTEXT,
    observedAt: OBSERVED_AT,
  });

  assert.equal(conversation.sourceUpdatedAt, 1785558008123);
});

test('Chatwoot incremental source hashes exclude observation timestamps', async () => {
  const first = await buildPrepared({ observedAt: OBSERVED_AT, includeReports: false, fullSnapshot: false });
  const second = await buildPrepared({ observedAt: OBSERVED_AT + 60_000, includeReports: false, fullSnapshot: false });
  const firstHashes = Object.fromEntries(first.incremental.sourceRecordStates.map((row) => [
    row.sourceRecordId,
    row.sourceHash,
  ]));
  const secondHashes = Object.fromEntries(second.incremental.sourceRecordStates.map((row) => [
    row.sourceRecordId,
    row.sourceHash,
  ]));
  assert.deepEqual(secondHashes, firstHashes);
});

test('Chatwoot daily facts use message and event dates, not conversation update date', async () => {
  const result = await buildPrepared({ observedAt: OBSERVED_AT, includeReports: true, fullSnapshot: true });
  const rows = result.d1.conversationDaily;
  const dates = rows.map((row) => row.metric_date);
  assert.deepEqual(dates, ['2026-07-25', '2026-07-26']);
  const dayOne = rows.find((row) => row.metric_date === '2026-07-25');
  const dayTwo = rows.find((row) => row.metric_date === '2026-07-26');
  assert.equal(dayOne.new_conversation_count, 1);
  assert.equal(dayOne.incoming_message_count, 1);
  assert.equal(dayTwo.outgoing_message_count, 1);
  assert.equal(dayTwo.first_response_seconds, 120);
  assert.equal(dates.includes('2026-07-27'), false);
  assert.equal(result.d1.accountDaily.every((row) => row.data_status === 'partial'), true);
  assert.equal(result.d1.accountDaily.every((row) => row.active_agent_count === null), true);
});

test('Chatwoot report preparation does not invent empty zero daily rows', async () => {
  const context = { ...BASE_CONTEXT, observedAt: OBSERVED_AT };
  const account = await normalizeChatwootAccount({ id: 42 }, context);
  const result = await prepareChatwootAnalyticsSync({
    customerProfile: 'integration_workspace',
    ...context,
    reportingTimezone: 'Asia/Bangkok',
    syncRunId: 'sync:empty',
    fullSnapshot: true,
    includeReports: true,
    account,
    inboxes: [],
    contacts: [],
    agents: [],
    teams: [],
    labels: [],
    conversations: [],
    messages: [],
    reportingEvents: [],
  });
  assert.deepEqual(result.d1.conversationDaily, []);
  assert.deepEqual(result.d1.agentDaily, []);
  assert.deepEqual(result.d1.inboxDaily, []);
  assert.deepEqual(result.d1.accountDaily, []);
});

test('Chatwoot coverage stays partial until required sinks finish', async () => {
  const result = await buildPrepared({ observedAt: OBSERVED_AT, includeReports: false, fullSnapshot: true });
  for (const coverage of result.d1.coverageRuns) {
    assert.doesNotThrow(() => validateStorageRow('data_coverage_runs', coverage));
    assert.equal(coverage.status, 'partial');
    assert.equal(coverage.completed_at, null);
  }
  const contacts = result.d1.coverageRuns.find((row) => row.dataset_key === 'chatwoot.resolved_contacts');
  assert.equal(contacts.scope_mode, 'exact_entities');
  const finalized = finalizeChatwootCoverageRuns(result.d1.coverageRuns, OBSERVED_AT + 1);
  for (const coverage of finalized) {
    assert.doesNotThrow(() => validateStorageRow('data_coverage_runs', coverage));
    assert.equal(coverage.status, 'complete');
    assert.equal(coverage.written_rows, coverage.observed_rows);
  }
});

test('Chatwoot label state emits explicit inactive rows for removed labels', async () => {
  const result = await buildPrepared({
    observedAt: OBSERVED_AT,
    includeReports: false,
    fullSnapshot: false,
    previousConversationLabels: [
      { externalConversationId: '71', externalLabelId: '99', active: true },
    ],
  });
  const removed = result.d1.conversationLabels.find((row) => row.external_label_id === '99');
  assert.equal(removed.active, 0);
  assert.equal(removed.removed_at, OBSERVED_AT);
  assert.equal(removed.account_key, 'chat_dev');
});

async function buildPrepared(options) {
  const rows = await buildNormalizedRows({ observedAt: options.observedAt });
  return prepareChatwootAnalyticsSync({
    customerProfile: 'integration_workspace',
    ...BASE_CONTEXT,
    observedAt: options.observedAt,
    reportingTimezone: 'Asia/Bangkok',
    syncRunId: `sync:${options.observedAt}`,
    coverageRunIdPrefix: `coverage:${options.observedAt}`,
    fullSnapshot: options.fullSnapshot,
    includeReports: options.includeReports,
    account: rows.account,
    inboxes: [rows.inbox],
    contacts: [rows.contact],
    agents: [rows.agent],
    teams: [rows.team],
    labels: [rows.label],
    conversations: [rows.conversation],
    messages: [rows.incomingMessage, rows.outgoingMessage],
    reportingEvents: [rows.event],
    previousConversationLabels: options.previousConversationLabels ?? [],
  });
}

async function buildNormalizedRows({ observedAt }) {
  const context = { ...BASE_CONTEXT, observedAt };
  const account = await normalizeChatwootAccount({ id: 42 }, context);
  const inbox = await normalizeChatwootInbox({
    id: 3,
    channel_type: 'Channel::WebWidget',
    medium: 'website',
    timezone: 'Asia/Bangkok',
    enable_auto_assignment: true,
    working_hours_enabled: true,
    csat_survey_enabled: false,
    allow_messages_after_resolved: true,
    website_token: 'must-not-persist',
  }, context);
  const contact = await normalizeChatwootContact({
    id: 9,
    name: 'Sensitive Person',
    email: 'person@example.test',
    phone_number: '+66123456789',
    blocked: false,
    availability_status: 'online',
    created_at: '2026-07-25T01:00:00Z',
    last_activity_at: '2026-07-27T01:00:00Z',
  }, context);
  const agent = await normalizeChatwootAgent({
    id: 11,
    account_id: 42,
    name: 'Agent Name',
    email: 'agent@example.test',
    role: 'administrator',
    availability_status: 'available',
    auto_offline: true,
    confirmed: true,
  }, context);
  const team = await normalizeChatwootTeam({
    id: 12,
    account_id: 42,
    name: 'Private Team',
    allow_auto_assign: true,
  }, context);
  const label = await normalizeChatwootLabel({
    id: 13,
    title: 'VIP Alice',
    color: '#ABCDEF',
    show_on_sidebar: true,
  }, context);
  const incomingMessage = await normalizeChatwootMessage({
    id: 101,
    account_id: 42,
    conversation_id: 71,
    inbox_id: 3,
    message_type: 0,
    content_type: 'text',
    content: 'private message text',
    processed_message_content: 'private message text',
    private: false,
    sender_type: 'Contact',
    sender_id: 9,
    created_at: '2026-07-25T02:00:00Z',
    attachments: [{ data_url: 'https://files.example.test/private.pdf', file_type: 'file' }],
  }, context);
  const outgoingMessage = await normalizeChatwootMessage({
    id: 102,
    account_id: 42,
    conversation_id: 71,
    inbox_id: 3,
    message_type: 1,
    content_type: 'text',
    private: false,
    sender_type: 'User',
    sender_id: 11,
    created_at: '2026-07-26T03:00:00Z',
  }, context);
  const event = await normalizeChatwootReportingEvent({
    id: 201,
    name: 'first_response',
    value: 120,
    value_in_business_hours: 60,
    account_id: 42,
    conversation_id: 71,
    inbox_id: 3,
    user_id: 11,
    event_start_time: '2026-07-26T02:58:00Z',
    event_end_time: '2026-07-26T03:00:00Z',
    created_at: '2026-07-26T03:00:00Z',
    updated_at: '2026-07-26T03:00:00Z',
  }, context);
  const conversation = await normalizeChatwootConversation({
    id: 71,
    account_id: 42,
    inbox_id: 3,
    status: 'open',
    priority: 'high',
    created_at: '2026-07-25T01:00:00Z',
    updated_at: '2026-07-27T04:00:00Z',
    last_activity_at: '2026-07-27T04:00:00Z',
    meta: {
      sender: { id: 9, name: 'Sensitive Person', email: 'person@example.test' },
      assignee: { id: 11, name: 'Agent Name' },
      team: { id: 12, name: 'Private Team' },
    },
  }, {
    ...context,
    messages: [incomingMessage, outgoingMessage],
    reportingEvents: [event],
    labelIds: [13],
    previousStatus: 'open',
    previousSourceUpdatedAt: Date.parse('2026-07-26T04:00:00Z'),
  });
  return {
    account,
    inbox,
    contact,
    agent,
    team,
    label,
    incomingMessage,
    outgoingMessage,
    message: incomingMessage,
    event,
    conversation,
  };
}
