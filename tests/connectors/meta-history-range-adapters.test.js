import assert from 'node:assert/strict';
import test from 'node:test';

import {
  InstagramOrganicSourceAdapter,
  boundInstagramContentPage,
} from '../../packages/connectors/src/meta/instagram-organic-source.adapter.js';
import {
  MetaAdsSourceAdapter,
  decodeAdsHistoryCursor,
} from '../../packages/connectors/src/meta/meta-ads-source.adapter.js';

test('Instagram inventory keeps exact month rows and retires pagination after lower boundary', async () => {
  const client = fakeClient([{ rows: [
    { id: '3', timestamp: '2026-07-31T09:00:00+0000' },
    { id: '2', timestamp: '2026-07-15T09:00:00+0000' },
    { id: '1', timestamp: '2026-06-30T09:00:00+0000' },
  ], hasMore: true, nextCursor: 'provider-next' }]);
  const adapter = new InstagramOrganicSourceAdapter({
    client,
    contentDateRange: { since: '2026-07-01', until: '2026-07-31' },
  });

  const result = await adapter.fetchContentPage({ accountId: '17841413521012797' });
  assert.deepEqual(result.rows.map((row) => row.id), ['3', '2']);
  assert.equal(result.hasMore, false);
  assert.equal(result.nextCursor, null);
});

test('Instagram inventory continues through pages newer than the requested month', () => {
  const result = boundInstagramContentPage({
    rows: [
      { id: '2', timestamp: '2026-08-02T00:00:00Z' },
      { id: '1', timestamp: '2026-08-01T00:00:00Z' },
    ],
    hasMore: true,
    nextCursor: 'next',
  }, { since: '2026-07-01', until: '2026-07-31' });
  assert.deepEqual(result.rows, []);
  assert.equal(result.hasMore, true);
  assert.equal(result.nextCursor, 'next');
});

test('Instagram inventory fails closed when provider order is not newest-first', () => {
  assert.throws(
    () => boundInstagramContentPage({
      rows: [
        { id: '1', timestamp: '2026-07-01T00:00:00Z' },
        { id: '2', timestamp: '2026-07-02T00:00:00Z' },
      ],
      hasMore: false,
      nextCursor: null,
    }, { since: '2026-07-01', until: '2026-07-31' }),
    /newest-first/u,
  );
});

test('Meta Ads multi-month history advances in exact inclusive 31-day chunks', async () => {
  const calls = [];
  const client = fakeClient([
    { rows: [], hasMore: false, nextCursor: null },
    { rows: [], hasMore: false, nextCursor: null },
    { rows: [], hasMore: false, nextCursor: null },
  ], calls);
  const adapter = new MetaAdsSourceAdapter({ client });

  const first = await adapter.fetchDailyInsightsPage({
    adAccountId: 'act_505898710119851',
    since: '2026-05-01',
    until: '2026-07-31',
  });
  const firstCursor = decodeAdsHistoryCursor(first.nextCursor, {
    since: '2026-05-01',
    until: '2026-07-31',
  });
  assert.deepEqual(firstCursor, {
    chunkSince: '2026-06-01',
    chunkUntil: '2026-07-01',
    providerAfter: null,
  });

  const second = await adapter.fetchDailyInsightsPage({
    adAccountId: '505898710119851',
    since: '2026-05-01',
    until: '2026-07-31',
    after: first.nextCursor,
  });
  const secondCursor = decodeAdsHistoryCursor(second.nextCursor, {
    since: '2026-05-01',
    until: '2026-07-31',
  });
  assert.deepEqual(secondCursor, {
    chunkSince: '2026-07-02',
    chunkUntil: '2026-07-31',
    providerAfter: null,
  });

  const third = await adapter.fetchDailyInsightsPage({
    adAccountId: '505898710119851',
    since: '2026-05-01',
    until: '2026-07-31',
    after: second.nextCursor,
  });
  assert.equal(third.hasMore, false);
  assert.equal(third.nextCursor, null);
  assert.deepEqual(calls.map((call) => JSON.parse(call.query.time_range)), [
    { since: '2026-05-01', until: '2026-05-31' },
    { since: '2026-06-01', until: '2026-07-01' },
    { since: '2026-07-02', until: '2026-07-31' },
  ]);
});

test('Meta Ads multi-month cursor preserves provider pagination inside one chunk', async () => {
  const calls = [];
  const client = fakeClient([
    { rows: [], hasMore: true, nextCursor: 'provider-page-2' },
    { rows: [], hasMore: false, nextCursor: null },
  ], calls);
  const adapter = new MetaAdsSourceAdapter({ client });
  const first = await adapter.fetchDailyInsightsPage({
    adAccountId: '505898710119851',
    since: '2026-01-01',
    until: '2026-04-30',
  });
  const decoded = decodeAdsHistoryCursor(first.nextCursor, {
    since: '2026-01-01',
    until: '2026-04-30',
  });
  assert.equal(decoded.providerAfter, 'provider-page-2');
  assert.equal(decoded.chunkSince, '2026-01-01');
  assert.equal(decoded.chunkUntil, '2026-01-31');

  await adapter.fetchDailyInsightsPage({
    adAccountId: '505898710119851',
    since: '2026-01-01',
    until: '2026-04-30',
    after: first.nextCursor,
  });
  assert.equal(calls[1].options.after, 'provider-page-2');
});

test('Meta Ads retains the legacy direct cursor contract for one 31-day window', async () => {
  const calls = [];
  const client = fakeClient([
    { rows: [], hasMore: false, nextCursor: null },
  ], calls);
  const adapter = new MetaAdsSourceAdapter({ client });
  await adapter.fetchDailyInsightsPage({
    adAccountId: '505898710119851',
    since: '2026-07-01',
    until: '2026-07-31',
    after: 'legacy-provider-cursor',
    visitedCursors: ['older-provider-cursor'],
  });
  assert.equal(calls[0].options.after, 'legacy-provider-cursor');
  assert.deepEqual(calls[0].options.visitedCursors, ['older-provider-cursor']);
});

function fakeClient(pages, calls = []) {
  let index = 0;
  return {
    async get() {
      throw new Error('Unexpected node read');
    },
    async getPage(path, query, options) {
      calls.push({ path, query, options });
      const page = pages[index];
      index += 1;
      if (!page) throw new Error('Unexpected additional page read');
      return page;
    },
  };
}
