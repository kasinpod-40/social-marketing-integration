import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatwootApiClient } from '../../packages/connectors/src/chatwoot/chatwoot-api.client.js';

test('Chatwoot client keeps token in header and parses bounded conversation page', async () => {
  let request = null;
  const client = new ChatwootApiClient({
    baseUrl: 'https://chat.example.test',
    accountId: 42,
    accessToken: 'secret-token',
    fetchImpl: async (url, options) => {
      request = { url: String(url), options };
      return jsonResponse({ data: { meta: { all_count: 1 }, payload: [{ id: 7001 }] } });
    },
  });

  const page = await client.listConversationsPage({ page: 1 });
  assert.equal(page.rows.length, 1);
  assert.equal(page.totalCount, 1);
  assert.equal(request.url.includes('secret-token'), false);
  assert.equal(new Headers(request.options.headers).get('api_access_token'), 'secret-token');
  assert.equal(new URL(request.url).pathname, '/api/v1/accounts/42/conversations');
});

test('Chatwoot client retries bounded 429 and honors success response', async () => {
  let attempts = 0;
  const delays = [];
  const client = new ChatwootApiClient({
    baseUrl: 'https://chat.example.test',
    accountId: 42,
    accessToken: 'secret-token',
    maxAttempts: 2,
    sleepImpl: async (delay) => delays.push(delay),
    randomImpl: () => 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) return jsonResponse({ error: 'rate limited' }, 429, { 'retry-after': '1' });
      return jsonResponse({ payload: [] });
    },
  });

  assert.deepEqual(await client.listInboxes(), []);
  assert.equal(attempts, 2);
  assert.deepEqual(delays, [1000]);
});

test('Chatwoot message pagination rejects non-increasing cursor', async () => {
  const client = new ChatwootApiClient({
    baseUrl: 'https://chat.example.test',
    accountId: 42,
    accessToken: 'secret-token',
    fetchImpl: async () => jsonResponse({ payload: [{ id: 100 }, { id: 100 }], meta: { labels: [] } }),
  });

  await assert.rejects(
    () => client.listMessagesPage({ conversationId: 7, after: 99 }),
    (error) => error?.code === 'CHATWOOT_MESSAGE_CURSOR_REPEATED' && error.retryable === false,
  );
});

test('Chatwoot collectPages fails closed when declared total is incomplete', async () => {
  const client = new ChatwootApiClient({
    baseUrl: 'https://chat.example.test',
    accountId: 42,
    accessToken: 'secret-token',
    fetchImpl: async () => jsonResponse({}),
  });

  await assert.rejects(
    () => client.collectPages(async (page) => ({
      page,
      rows: page === 1 ? [{ id: 1 }] : [],
      totalCount: 2,
      hasMore: false,
    })),
    (error) => error?.code === 'CHATWOOT_PAGE_INCOMPLETE',
  );
});

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
