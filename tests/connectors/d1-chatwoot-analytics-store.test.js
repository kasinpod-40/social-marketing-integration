import test from 'node:test';
import assert from 'node:assert/strict';
import { D1ChatwootAnalyticsStore } from '../../packages/connectors/src/chatwoot/d1-chatwoot-analytics-store.js';

test('Chatwoot D1 adapter accepts analytics content_type and rejects message content', async () => {
  const calls = [];
  const store = new D1ChatwootAnalyticsStore({ db: fakeDb(calls) });
  const row = messageRow();
  const result = await store.upsertMessageAnalyticsState(row);
  assert.equal(result.outcome, 'written');
  assert.match(calls[0].sql, /chatwoot_message_analytics_state/u);
  await assert.rejects(
    () => store.upsertMessageAnalyticsState({ ...row, content: 'must not persist' }),
    (error) => error?.code === 'CHATWOOT_PII_POLICY_VIOLATION',
  );
});

test('Chatwoot conversation upsert guards identity and increments reopen only on newer revision', async () => {
  const calls = [];
  const store = new D1ChatwootAnalyticsStore({ db: fakeDb(calls) });
  await store.upsertConversationState(conversationRow());
  assert.match(calls[0].sql, /excluded\.source_updated_at > chatwoot_conversation_state\.source_updated_at/u);
  assert.match(calls[0].sql, /excluded\.external_conversation_id = chatwoot_conversation_state\.external_conversation_id/u);
});

test('Chatwoot D1 adapter classifies database failures as retryable', async () => {
  const store = new D1ChatwootAnalyticsStore({
    db: {
      prepare() {
        return { bind() { return { async run() { throw new Error('D1 unavailable'); } }; } };
      },
    },
  });
  await assert.rejects(
    () => store.upsertMessageAnalyticsState(messageRow()),
    (error) => error?.code === 'CHATWOOT_D1_WRITE_FAILED' && error.retryable === true,
  );
});

function fakeDb(calls) {
  return {
    prepare(sql) {
      return {
        bind(...values) {
          calls.push({ sql, values });
          return {
            async run() { return { meta: { changes: 1 } }; },
            async all() { return { results: [] }; },
          };
        },
      };
    },
  };
}

function messageRow() {
  return {
    message_key: 'chatwoot:chat_dev:message:101',
    conversation_key: 'chatwoot:chat_dev:conversation:71',
    customer_key: 'customer_dev',
    account_key: 'chat_dev',
    external_account_id: '42',
    external_message_id: '101',
    external_conversation_id: '71',
    external_inbox_id: '3',
    message_type: 'incoming',
    direction: 'incoming',
    content_type: 'text',
    private: 0,
    sender_type: 'contact',
    external_sender_id: '9',
    attachment_count: 0,
    source_created_at: 1_785_079_000_000,
    source_updated_at: 1_785_079_000_000,
    metadata_hash: 'hash',
    last_coverage_run_id: 'coverage:messages',
    last_sync_run_id: 'sync:test',
    created_at: 1_785_080_000_000,
    updated_at: 1_785_080_000_000,
  };
}

function conversationRow() {
  return {
    conversation_key: 'chatwoot:chat_dev:conversation:71',
    customer_key: 'customer_dev',
    account_key: 'chat_dev',
    external_account_id: '42',
    external_conversation_id: '71',
    external_inbox_id: '3',
    external_contact_id: '9',
    status: 'open',
    priority: 'high',
    external_assignee_id: '11',
    external_team_id: '12',
    source_created_at: 1_785_078_000_000,
    source_updated_at: 1_785_079_000_000,
    last_activity_at: 1_785_079_000_000,
    waiting_since: null,
    source_availability_status: 'available',
    message_count: 1,
    incoming_message_count: 1,
    outgoing_message_count: 0,
    private_message_count: 0,
    attachment_message_count: 0,
    reopen_count_delta: 1,
    first_response_seconds: 120,
    first_response_business_seconds: 60,
    resolution_seconds: null,
    resolution_business_seconds: null,
    reply_seconds: null,
    reply_business_seconds: null,
    metrics_hash: 'metrics-hash',
    metadata_hash: 'metadata-hash',
    last_coverage_run_id: 'coverage:conversations',
    last_sync_run_id: 'sync:test',
    created_at: 1_785_080_000_000,
    updated_at: 1_785_080_000_000,
  };
}
