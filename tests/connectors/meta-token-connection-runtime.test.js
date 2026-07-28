import test from 'node:test';
import assert from 'node:assert/strict';
import { createMetaTokenConnectionRuntime } from '../../packages/connectors/src/meta/meta-token-connection-runtime.js';
import { preflightMetaCustomerConnections } from '../../packages/application/src/use-cases/preflight-meta-customer-connections.js';

test('Meta runtime uses separate bearer secrets, versioned GETs and no token query params', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => {
    const parsed = new URL(url);
    calls.push({
      hostname: parsed.hostname,
      pathname: parsed.pathname,
      method: init.method,
      authorization: init.headers.get('authorization'),
      hasTokenQuery: parsed.searchParams.has('access_token'),
    });
    if (parsed.hostname === 'graph.instagram.com') {
      return Response.json({ user_id: 'ig-private', account_type: 'BUSINESS' });
    }
    if (parsed.pathname.endsWith('/permissions')) {
      return Response.json({
        data: [
          { permission: 'pages_show_list', status: 'granted' },
          { permission: 'pages_read_engagement', status: 'granted' },
          { permission: 'ads_read', status: 'granted' },
          { permission: 'business_management', status: 'granted' },
        ],
      });
    }
    if (parsed.pathname.endsWith('/accounts')) {
      return Response.json({
        data: [{ id: 'page-private', instagram_business_account: { id: 'ig-private' } }],
      });
    }
    if (parsed.pathname.endsWith('/adaccounts')) {
      return Response.json({
        data: [
          { id: 'act_505898710119851', account_id: '505898710119851', account_status: 1 },
          { id: 'act_851206695716861', account_id: '851206695716861', account_status: 1 },
        ],
      });
    }
    return Response.json({ error: { code: 100 } }, { status: 400 });
  };
  const runtime = createMetaTokenConnectionRuntime({
    META_GRAPH_API_VERSION: 'v25.0',
    META_ACCESS_TOKEN: 'facebook-token-private',
    META_FACEBOOK_PAGE_ACCESS_TOKEN: 'facebook-page-token-private',
    META_INSTAGRAM_ACCESS_TOKEN: 'instagram-token-private',
    META_FACEBOOK_PAGE_ID: 'page-private',
    META_INSTAGRAM_ACCOUNT_ID: 'ig-private',
    META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=505898710119851,chemistry_k3=851206695716861',
  }, { fetchImpl });
  const result = await preflightMetaCustomerConnections(runtime);

  assert.equal(result.ok, true);
  assert.equal(calls.length, 5);
  assert.equal(calls.every((call) => call.method === 'GET'), true);
  assert.equal(calls.every((call) => call.pathname.startsWith('/v25.0/')), true);
  assert.equal(calls.every((call) => call.hasTokenQuery === false), true);
  for (const call of calls) {
    assert.equal(
      call.authorization,
      call.hostname === 'graph.instagram.com'
        ? 'Bearer instagram-token-private'
        : 'Bearer facebook-token-private',
    );
  }
  const serialized = JSON.stringify(result);
  assert.doesNotMatch(
    serialized,
    /facebook-token-private|instagram-token-private|page-private|ig-private|505898710119851|851206695716861/u,
  );
});

test('Facebook business source uses only the Page access token', async () => {
  const calls = [];
  const runtime = createMetaTokenConnectionRuntime({
    META_GRAPH_API_VERSION: 'v25.0',
    META_ACCESS_TOKEN: 'facebook-user-token-private',
    META_FACEBOOK_PAGE_ACCESS_TOKEN: 'facebook-page-token-private',
    META_FACEBOOK_PAGE_ID: 'page-private',
  }, {
    fetchImpl: async (url, init) => {
      calls.push({
        pathname: new URL(url).pathname,
        authorization: init.headers.get('authorization'),
      });
      return Response.json({ data: [], paging: {} });
    },
  });

  await runtime.sources.facebook.fetchContentPage({ pageId: 'page-private' });

  assert.deepEqual(calls, [{
    pathname: '/v25.0/page-private/posts',
    authorization: 'Bearer facebook-page-token-private',
  }]);
});
