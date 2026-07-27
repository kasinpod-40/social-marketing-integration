import test from 'node:test';
import assert from 'node:assert/strict';
import { ChatwootApiClient } from '../../packages/connectors/src/chatwoot/chatwoot-api.client.js';

test('Chatwoot client keeps token in header and parses bounded conversation page', async () => {
  let request = null;
  const client = makeClient(async (url, options) => {
    request = { url: String(url), options };
    return jsonResponse({ data: { meta: { all_count: 1 }, payload: [{ id: 7001 }] } });
  });
  const page = await client.listConversationsPage({ page: 1 });
  assert.equal(page.rows.length, 1);
  assert.equal(page.totalCount, 1);
  assert.equal(request.url.includes('secret-token'), false);
  assert.equal(new Headers(request.options.headers).get('api_access_token'), 'secret-token');
  assert.equal(new URL(request.url).pathname, '/api/v1/accounts/42/conversations');
});

test('Chatwoot client retries non-JSON 429 and 503 responses', async () => {
  let attempts = 0;
  const delays = [];
  const client = makeClient(async () => {
    attempts += 1;
    if (attempts === 1) return new Response('<html>limited</html>', { status: 429, headers: { 'retry-after': '1' } });
    if (attempts === 2) return new Response('', { status: 503 });
    return jsonResponse({ payload: [] });
  }, {
    maxAttempts: 3,
    sleepImpl: async (delay) => delays.push(delay),
    randomImpl: () => 0,
  });
  assert.deepEqual(await client.listInboxes(), []);
  assert.equal(attempts, 3);
  assert.equal(delays.length, 2);
  assert.equal(delays[0], 1000);
});

test('Chatwoot client exposes backward initial pagination and forward cursor semantics', async () => {
  const requests = [];
  const client = makeClient(async (url) => {
    requests.push(new URL(String(url)));
    const parsed = new URL(String(url));
    if (parsed.searchParams.has('after')) {
      return jsonResponse({ payload: ids(101, 200), meta: { labels: [] } });
    }
    if (parsed.searchParams.has('before')) {
      return jsonResponse({ payload: ids(61, 80), meta: { labels: [] } });
    }
    return jsonResponse({ payload: ids(81, 100), meta: { labels: [] } });
  });

  const initial = await client.listMessagesPage({ conversationId: 7 });
  assert.equal(initial.mode, 'before');
  assert.equal(initial.hasMore, true);
  assert.equal(initial.nextBefore, '81');
  assert.equal(initial.nextAfter, '100');

  const previous = await client.listMessagesPage({ conversationId: 7, before: 81 });
  assert.equal(previous.nextBefore, '61');
  assert.equal(previous.hasMore, true);

  const next = await client.listMessagesPage({ conversationId: 7, after: 100 });
  assert.equal(next.mode, 'after');
  assert.equal(next.hasMore, true);
  assert.equal(next.nextAfter, '200');
  assert.equal(requests.length, 3);
});

test('Chatwoot message pagination rejects non-increasing cursors', async () => {
  const client = makeClient(async () => jsonResponse({
    payload: [{ id: 100 }, { id: 100 }],
    meta: { labels: [] },
  }));
  await assert.rejects(
    () => client.listMessagesPage({ conversationId: 7, after: 99 }),
    (error) => error?.code === 'CHATWOOT_MESSAGE_CURSOR_REPEATED' && error.retryable === false,
  );
});

test('Chatwoot account reporting events send bounded since and until seconds', async () => {
  let requested = null;
  const client = makeClient(async (url) => {
    requested = new URL(String(url));
    return jsonResponse({ meta: { count: 0, current_page: 1, total_pages: 1 }, payload: [] });
  });
  await client.listAccountReportingEventsPage({
    page: 1,
    since: 1_785_000_000_000,
    until: 1_785_086_400_000,
  });
  assert.equal(requested.searchParams.get('since'), '1785000000');
  assert.equal(requested.searchParams.get('until'), '1785086400');
});

test('Chatwoot collectPages fails closed when declared total is incomplete', async () => {
  const client = makeClient(async () => jsonResponse({}));
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

function makeClient(fetchImpl, overrides = {}) {
  return new ChatwootApiClient({
    baseUrl: 'https://chat.example.test',
    accountId: 42,
    accessToken: 'secret-token',
    fetchImpl,
    ...overrides,
  });
}

function ids(start, end) {
  return Array.from({ length: end - start + 1 }, (_, index) => ({ id: start + index }));
}

function jsonResponse(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}
