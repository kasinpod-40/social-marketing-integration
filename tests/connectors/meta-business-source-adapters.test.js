import assert from 'node:assert/strict';
import test from 'node:test';

import { FacebookOrganicSourceAdapter } from '../../packages/connectors/src/meta/facebook-organic-source.adapter.js';
import { InstagramOrganicSourceAdapter } from '../../packages/connectors/src/meta/instagram-organic-source.adapter.js';
import { MetaAdsSourceAdapter } from '../../packages/connectors/src/meta/meta-ads-source.adapter.js';

test('Facebook source adapter performs contract-bound GET reads and returns a cursor envelope', async () => {
  const calls = [];
  const client = fakeReadClient({
    calls,
    getResult: { id: 'page_fixture_001', name: 'Fixture Page' },
    pageResult: {
      rows: [{ id: 'post_fixture_001' }],
      hasMore: true,
      nextCursor: 'opaque/cursor+value',
    },
  });
  const adapter = new FacebookOrganicSourceAdapter({ client });

  const account = await adapter.fetchAccount({ pageId: 'page_fixture_001' });
  const page = await adapter.fetchContentPage({
    pageId: 'page_fixture_001',
    after: 'prior/cursor',
    since: '2026-07-01',
    until: '2026-07-27',
  });

  assert.equal(account.datasetKey, 'facebook.account.latest');
  assert.equal(calls[0].path, 'page_fixture_001');
  assert.equal(calls[0].options.operationName, 'facebook.account.latest');
  assert.equal(calls[1].path, 'page_fixture_001/posts');
  assert.equal(calls[1].options.operationName, 'facebook.content.inventory');
  assert.equal(calls[1].options.after, 'prior/cursor');
  assert.equal(calls[1].query.since, '2026-07-01');
  assert.equal(calls[1].query.until, '2026-07-27');
  assert.equal(page.nextCursor, 'opaque/cursor+value');
  assert.equal(adapter.createPost, undefined);
});

test('Facebook source adapter sends only approved metric candidates and date filters', async () => {
  const calls = [];
  const adapter = new FacebookOrganicSourceAdapter({
    client: fakeReadClient({
      calls,
      getResult: {
        data: [],
        paging: {
          next: 'https://graph.facebook.com/v25.0/page_fixture_001/insights?since=next',
          previous: 'https://graph.facebook.com/v25.0/page_fixture_001/insights?since=previous',
        },
      },
    }),
  });

  await adapter.fetchContentInsightsPage({
    pageId: 'page_fixture_001',
    contentId: 'post_fixture_001',
    since: '2026-07-01',
    until: '2026-07-23',
    period: 'lifetime',
  });

  assert.equal(calls[0].path, 'post_fixture_001/insights');
  assert.match(calls[0].query.metric, /post_media_view/u);
  assert.equal(calls[0].query.since, '2026-07-01');
  assert.equal(calls[0].query.until, '2026-07-23');
  assert.equal(calls[0].options.operationName, 'facebook.content.insights');
  assert.equal(calls[0].method, 'get');
});

test('Instagram source adapter enforces /me identity authority', async () => {
  const matching = new InstagramOrganicSourceAdapter({
    client: fakeReadClient({
      getResult: { user_id: 'ig_fixture_001', id: 'scoped_fixture_001' },
    }),
  });
  const account = await matching.fetchAccount({ accountId: 'ig_fixture_001' });
  assert.equal(account.sourceAccountId, 'ig_fixture_001');

  const mismatching = new InstagramOrganicSourceAdapter({
    client: fakeReadClient({
      getResult: { user_id: 'other_fixture_001', id: 'scoped_fixture_001' },
    }),
  });
  await assert.rejects(
    mismatching.fetchAccount({ accountId: 'ig_fixture_001' }),
    (error) => error?.code === 'META_INSTAGRAM_ACCOUNT_IDENTITY_MISMATCH'
      && error?.retryable === false,
  );
});

test('Meta Ads source adapter keeps Insights reads daily, bounded and account-scoped', async () => {
  const calls = [];
  const adapter = new MetaAdsSourceAdapter({
    client: fakeReadClient({
      calls,
      pageResult: {
        rows: [{
          account_id: '987650001',
          date_start: '2026-07-23',
          date_stop: '2026-07-23',
        }],
        hasMore: false,
        nextCursor: null,
      },
    }),
  });

  const result = await adapter.fetchDailyInsightsPage({
    adAccountId: 'act_987650001',
    since: '2026-07-23',
    until: '2026-07-23',
  });

  assert.equal(calls[0].path, 'act_987650001/insights');
  assert.equal(calls[0].query.level, 'ad');
  assert.equal(calls[0].query.time_increment, 1);
  assert.equal(calls[0].query.breakdowns, 'publisher_platform');
  assert.equal(calls[0].query.action_breakdowns, 'action_type');
  assert.equal(calls[0].options.operationName, 'meta_ads.performance.daily');
  assert.equal(result.sourceAccountId, '987650001');
  assert.equal(adapter.updateCampaign, undefined);

  await assert.rejects(
    adapter.fetchDailyInsightsPage({
      adAccountId: '987650001',
      since: '2026-01-01',
      until: '2026-02-01',
    }),
    /exceeds 31 inclusive days/u,
  );
});

test('Meta Ads source adapter rejects malformed and out-of-scope response dates', async () => {
  const malformed = new MetaAdsSourceAdapter({
    client: fakeReadClient({
      pageResult: {
        rows: [{
          account_id: '987650001',
          date_start: 'not-a-date',
          date_stop: '2026-07-23',
        }],
        hasMore: false,
        nextCursor: null,
      },
    }),
  });
  await assert.rejects(
    malformed.fetchDailyInsightsPage({
      adAccountId: '987650001',
      since: '2026-07-23',
      until: '2026-07-23',
    }),
    /date_start/u,
  );

  const wrongAccount = new MetaAdsSourceAdapter({
    client: fakeReadClient({
      pageResult: {
        rows: [{
          account_id: '111111111',
          date_start: '2026-07-23',
          date_stop: '2026-07-23',
        }],
        hasMore: false,
        nextCursor: null,
      },
    }),
  });
  await assert.rejects(
    wrongAccount.fetchDailyInsightsPage({
      adAccountId: '987650001',
      since: '2026-07-23',
      until: '2026-07-23',
    }),
    (error) => error?.code === 'META_AD_ACCOUNT_IDENTITY_MISMATCH',
  );
});

test('Meta source adapters reject malformed page envelopes instead of fabricating no data', async () => {
  const missingRows = new FacebookOrganicSourceAdapter({
    client: fakeReadClient({
      pageResult: { hasMore: false, nextCursor: null },
    }),
  });
  await assert.rejects(
    missingRows.fetchContentPage({ pageId: 'page_fixture_001' }),
    /requires rows array/u,
  );

  const missingCursor = new FacebookOrganicSourceAdapter({
    client: fakeReadClient({
      pageResult: { rows: [], hasMore: true, nextCursor: null },
    }),
  });
  await assert.rejects(
    missingCursor.fetchContentPage({ pageId: 'page_fixture_001' }),
    /requires nextCursor/u,
  );
});

function fakeReadClient(input = {}) {
  return {
    async get(path, query, options) {
      input.calls?.push({ method: 'get', path, query, options });
      return input.getResult ?? {};
    },
    async getPage(path, query, options) {
      input.calls?.push({ method: 'getPage', path, query, options });
      return input.pageResult ?? { rows: [], hasMore: false, nextCursor: null };
    },
  };
}
