import test from 'node:test';
import assert from 'node:assert/strict';
import {
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
import { prepareChatwootAnalyticsSync } from '../../packages/application/src/use-cases/prepare-chatwoot-analytics-sync.js';
import { validateStorageRow } from '../../packages/application/src/storage/marketing-history-contract.js';

const OBSERVED_AT = 1_785_080_000_000;
const SOURCE_UPDATED_AT = 1_785_079_000;
const CONTEXT = Object.freeze({
  customerKey: 'customer_dev',
  accountKey: 'chat_dev',
  externalAccountId: '42',
  observedAt: OBSERVED_AT,
});

test('Chatwoot analytics normalizers discard direct PII and message bodies', async () => {
  const rows = await buildNormalizedRows();
  const serialized = JSON.stringify(rows);
  for (const forbiddenValue of [
    'person@example.test', '+66123456789', 'Sensitive Person', 'private message text',
    'https://files.example.test/private.pdf', 'Agent Name',
  ]) {
    assert.equal(serialized.includes(forbiddenValue), false);
  }
  assert.equal(rows.message.contentType, 'text');
  assert.equal(rows.message.attachmentCount, 1);
  assert.equal(rows.conversation.reopenCountDelta, 1);
  assert.equal(rows.conversation.firstResponseSeconds, 120);
});

test('Chatwoot write sets use valid shared coverage contracts and deterministic daily rows', async () => {
  const rows = await buildNormalizedRows();
  const result = await prepareChatwootAnalyticsSync({
    customerProfile: 'dev_profile',
    ...CONTEXT,
    reportingTimezone: 'Asia/Bangkok',
    syncRunId: 'sync:chatwoot:test',
    coverageRunIdPrefix: 'coverage:test',
    fullSnapshot: false,
    account: rows.account,
    inboxes: [rows.inbox],
    contacts: [rows.contact],
    agents: [rows.agent],
    teams: [rows.team],
    labels: [rows.label],
    conversations: [rows.conversation],
    messages: [rows.message],
    reportingEvents: [rows.event],
  });

  for (const coverage of result.d1.coverageRuns) {
    assert.doesNotThrow(() => validateStorageRow('data_coverage_runs', coverage));
    assert.equal(coverage.scope_mode, 'recent_window');
  }
  for (const entity of result.d1.coverageEntities) {
    assert.doesNotThrow(() => validateStorageRow('data_coverage_entities', entity));
  }

  assert.equal(result.d1.conversationDaily[0].reopened_count, 1);
  assert.equal(result.d1.agentDaily[0].assigned_conversation_count, 1);
  assert.equal(result.d1.inboxDaily[0].conversation_count, 1);
  assert.equal(result.d1.accountDaily[0].open_conversation_count, 1);
  assert.equal(result.lark.raw.messages[0].content_type, 'text');
  assert.equal(result.reconciliation.complete, true);

  const serialized = JSON.stringify(result);
  assert.equal(serialized.includes('private message text'), false);
  assert.equal(serialized.includes('person@example.test'), false);
});

async function buildNormalizedRows() {
  const account = await normalizeChatwootAccount({ id: 42 }, CONTEXT);
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
  }, CONTEXT);
  const contact = await normalizeChatwootContact({
    id: 9,
    name: 'Sensitive Person',
    email: 'person@example.test',
    phone_number: '+66123456789',
    blocked: false,
    availability_status: 'online',
    created_at: SOURCE_UPDATED_AT - 500,
    last_activity_at: SOURCE_UPDATED_AT,
  }, CONTEXT);
  const agent = await normalizeChatwootAgent({
    id: 11,
    account_id: 42,
    name: 'Agent Name',
    email: 'agent@example.test',
    role: 'administrator',
    availability_status: 'available',
    auto_offline: true,
    confirmed: true,
  }, CONTEXT);
  const team = await normalizeChatwootTeam({ id: 12, account_id: 42, name: 'Private Team', allow_auto_assign: true }, CONTEXT);
  const label = await normalizeChatwootLabel({ id: 13, title: 'Priority', color: '#ABCDEF', show_on_sidebar: true }, CONTEXT);
  const message = await normalizeChatwootMessage({
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
    created_at: SOURCE_UPDATED_AT - 100,
    attachments: [{ data_url: 'https://files.example.test/private.pdf', file_type: 'file' }],
  }, CONTEXT);
  const event = await normalizeChatwootReportingEvent({
    id: 201,
    name: 'first_response',
    value: 120,
    value_in_business_hours: 60,
    account_id: 42,
    conversation_id: 71,
    inbox_id: 3,
    user_id: 11,
    event_start_time: SOURCE_UPDATED_AT - 200,
    event_end_time: SOURCE_UPDATED_AT - 80,
    created_at: SOURCE_UPDATED_AT - 80,
    updated_at: SOURCE_UPDATED_AT,
  }, CONTEXT);
  const conversation = await normalizeChatwootConversation({
    id: 71,
    account_id: 42,
    inbox_id: 3,
    status: 'open',
    priority: 'high',
    created_at: SOURCE_UPDATED_AT - 1000,
    updated_at: SOURCE_UPDATED_AT,
    last_activity_at: SOURCE_UPDATED_AT,
    meta: {
      sender: { id: 9, name: 'Sensitive Person', email: 'person@example.test' },
      assignee: { id: 11, name: 'Agent Name' },
      team: { id: 12, name: 'Private Team' },
    },
  }, {
    ...CONTEXT,
    messages: [message],
    reportingEvents: [event],
    labelIds: [13],
    previousStatus: 'resolved',
    previousSourceUpdatedAt: (SOURCE_UPDATED_AT - 10) * 1000,
  });
  return { account, inbox, contact, agent, team, label, message, event, conversation };
}
