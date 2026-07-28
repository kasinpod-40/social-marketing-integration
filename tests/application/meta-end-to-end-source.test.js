import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectMetaEndToEndSourceUnit,
  createMetaSourceCheckpoint,
} from '../../packages/application/src/use-cases/collect-meta-end-to-end-source.js';

test('collects exactly one bounded Facebook page and returns a durable cursor', async () => {
  const calls = [];
  const adapters = {
    facebook: {
      async fetchContentPage(input) {
        calls.push(input);
        return {
          rows: [{ id: 'post_1', updated_time: '2026-07-24T00:00:00+0000' }],
          hasMore: true,
          nextCursor: 'cursor_2',
        };
      },
    },
  };
  const unit = await collectMetaEndToEndSourceUnit({
    connectorKey: 'facebook',
    datasetKey: 'facebook.content.inventory',
    adapters,
    identities: { sourceAccountId: 'page_1' },
    state: { pageNumber: 1 },
    dateRange: { since: '2026-07-01', until: '2026-07-27' },
  });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].since, '2026-07-01');
  assert.equal(calls[0].until, '2026-07-27');
  assert.equal(unit.rowCount, 1);
  assert.equal(unit.sourceStatus, 'partial');
  assert.equal(unit.nextState.after, 'cursor_2');
  assert.equal(unit.nextState.pageNumber, 2);
  assert.equal(unit.sourceWatermark, '2026-07-24T00:00:00+0000');

  const checkpoint = createMetaSourceCheckpoint({
    unit,
    cursorKey: 'meta:facebook:page_1:content',
    syncRunId: 'sync_1',
    completedAt: 1784829780000,
  });
  assert.equal(checkpoint.complete, false);
  assert.equal(checkpoint.after, 'cursor_2');
});

test('Meta Ads empty inventory is successful no_data_confirmed', async () => {
  const unit = await collectMetaEndToEndSourceUnit({
    connectorKey: 'meta_ads',
    datasetKey: 'meta_ads.campaigns.inventory',
    adapters: {
      meta_ads: {
        async fetchCampaignsPage() {
          return { rows: [], hasMore: false, nextCursor: null };
        },
      },
    },
    identities: { sourceAccountId: '987650001' },
  });
  assert.equal(unit.rowCount, 0);
  assert.equal(unit.sourceStatus, 'no_data_confirmed');
  assert.equal(unit.nextState, null);
});

test('fails closed when a paged source omits its next cursor or exceeds the configured page cap', async () => {
  const adapters = {
    facebook: {
      async fetchContentPage() {
        return { rows: [], hasMore: true, nextCursor: null };
      },
    },
  };
  await assert.rejects(
    collectMetaEndToEndSourceUnit({
      connectorKey: 'facebook',
      datasetKey: 'facebook.content.inventory',
      adapters,
      identities: { sourceAccountId: 'page_1' },
    }),
    (error) => error.code === 'META_END_TO_END_CURSOR_MISSING',
  );
  await assert.rejects(
    collectMetaEndToEndSourceUnit({
      connectorKey: 'facebook',
      datasetKey: 'facebook.content.inventory',
      adapters,
      identities: { sourceAccountId: 'page_1' },
      state: { pageNumber: 3 },
      maxPages: 2,
    }),
    (error) => error.code === 'META_END_TO_END_PAGE_LIMIT',
  );
});

test('rejects a repeated source cursor before durable continuation', async () => {
  await assert.rejects(
    collectMetaEndToEndSourceUnit({
      connectorKey: 'instagram',
      datasetKey: 'instagram.content.inventory',
      adapters: {
        instagram: {
          async fetchContentPage() {
            return { rows: [], hasMore: true, nextCursor: 'same_cursor' };
          },
        },
      },
      identities: { sourceAccountId: 'ig_1' },
      state: { pageNumber: 2, after: 'same_cursor', visitedCursors: [] },
    }),
    (error) => error.code === 'META_END_TO_END_CURSOR_REPEATED',
  );
});
