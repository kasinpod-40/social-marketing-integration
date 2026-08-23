import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_PAID_PROVIDER_DIRECT_LARK_MAX_PAGES,
  META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS,
  buildMetaPaidProviderLarkWriteSet,
  collectMetaPaidProviderPages,
  validateMetaPaidProviderLarkResults,
} from '../../scripts/lib/meta-paid-provider-direct-lark-materializer.js';

test('provider direct Meta recovery can paginate creatives beyond the shared 100-page runtime ceiling', async () => {
  const totalPages = 101;
  const cursors = Array.from({ length: totalPages - 1 }, (_, index) => `cursor-${index + 1}`);
  const observed = [];

  const result = await collectMetaPaidProviderPages({
    target: 'chemistry_k2',
    datasetKey: 'meta_ads.creatives.inventory',
    fetchPage: async ({ after, visitedCursors, page }) => {
      observed.push({ after, visitedCursors, page });
      return {
        rows: [{ id: `creative-${page}` }],
        hasMore: page < totalPages,
        nextCursor: page < totalPages ? cursors[page - 1] : null,
      };
    },
  });

  assert.equal(META_PAID_PROVIDER_DIRECT_LARK_MAX_PAGES, 500);
  assert.equal(result.pages, 101);
  assert.equal(result.rows.length, 101);
  assert.equal(result.rows[0].id, 'creative-1');
  assert.equal(result.rows.at(-1).id, 'creative-101');
  assert.equal(observed[100].after, 'cursor-100');
  assert.ok(observed[100].visitedCursors.includes('cursor-99'));
  assert.ok(!observed[100].visitedCursors.includes('cursor-100'));
});

test('provider direct Meta recovery fails closed at its isolated page ceiling', async () => {
  await assert.rejects(
    () => collectMetaPaidProviderPages({
      target: 'chemistry_k2',
      datasetKey: 'meta_ads.creatives.inventory',
      maxPages: 3,
      fetchPage: async ({ page }) => ({
        rows: [{ id: `creative-${page}` }],
        hasMore: true,
        nextCursor: `cursor-${page}`,
      }),
    }),
    (error) => error?.code === 'META_PAID_PROVIDER_DIRECT_LARK_PAGE_LIMIT'
      && error?.details?.maxPages === 3,
  );
});

test('provider direct Meta recovery rejects repeated cursors before Lark', async () => {
  await assert.rejects(
    () => collectMetaPaidProviderPages({
      target: 'chemistry_k3',
      datasetKey: 'meta_ads.performance.daily',
      fetchPage: async ({ page }) => ({
        rows: [],
        hasMore: true,
        nextCursor: page === 1 ? 'same-cursor' : 'same-cursor',
      }),
    }),
    (error) => error?.code === 'META_PAID_PROVIDER_DIRECT_LARK_CURSOR_REPEATED',
  );
});

test('provider direct Meta source builds only the required canonical Creative and July Daily payloads without entity inventory reads', async () => {
  const requestedAt = Date.parse('2026-08-24T01:00:00+07:00');
  const writeSet = await buildMetaPaidProviderLarkWriteSet({
    target: 'chemistry_k2',
    sourceAccountId: '505898710119851',
    operationId: 'meta-chemistry_k2-provider-direct-20260701-20260731-123456789abc',
    requestedAt,
    accountResource: {
      id: 'act_505898710119851',
      account_id: '505898710119851',
      name: 'Chemistry K2',
      account_status: 1,
      currency: 'THB',
      timezone_name: 'Asia/Bangkok',
    },
    creatives: [{
      id: 'creative_fixture_001',
      name: 'Fixture Creative',
      object_type: 'VIDEO',
      updated_time: '2026-07-31T12:00:00+0000',
    }],
    dailyInsights: [{
      account_id: '505898710119851',
      account_currency: 'THB',
      campaign_id: 'campaign_fixture_001',
      campaign_name: 'Fixture Campaign',
      adset_id: 'adset_fixture_001',
      adset_name: 'Fixture Ad Set',
      ad_id: 'ad_fixture_001',
      ad_name: 'Fixture Ad',
      date_start: '2026-07-31',
      date_stop: '2026-07-31',
      publisher_platform: 'facebook',
      spend: '10.000000',
      impressions: '100',
      reach: '80',
      clicks: '5',
    }],
  });

  assert.equal(writeSet.canonical.adsAccounts.length, 1);
  assert.equal(writeSet.canonical.adsCampaigns.length, 0);
  assert.equal(writeSet.canonical.adsAdGroups.length, 0);
  assert.equal(writeSet.canonical.adsAds.length, 0);
  assert.equal(writeSet.canonical.adsCreatives.length, 1);
  assert.equal(writeSet.canonical.adsCreatives[0].external_creative_id, 'creative_fixture_001');
  assert.equal(writeSet.canonical.adsDaily.length, 1);
  assert.equal(writeSet.canonical.adsDaily[0].external_ad_id, 'ad_fixture_001');
  assert.equal(writeSet.canonical.adsDaily[0].spend_micros, 10_000_000);
  assert.equal(writeSet.reconciliation.larkProjectionMode, 'curated_reports');
});

test('provider direct Meta Lark reconciliation is locked to Creatives and Daily', () => {
  assert.deepEqual(META_PAID_PROVIDER_DIRECT_LARK_TABLE_KEYS, [
    'mktAdsCreatives',
    'mktAdsDaily',
  ]);
  const results = [
    {
      tableKey: 'mktAdsCreatives',
      expected: 12,
      created: 0,
      updated: 0,
      skipped: 12,
      duplicateInputRows: 0,
    },
    {
      tableKey: 'mktAdsDaily',
      expected: 4,
      created: 0,
      updated: 0,
      skipped: 4,
      duplicateInputRows: 0,
    },
  ];
  assert.equal(validateMetaPaidProviderLarkResults(results, { idempotent: true }), true);
});

test('provider direct Meta idempotent replay rejects any mutation', () => {
  assert.throws(
    () => validateMetaPaidProviderLarkResults([
      {
        tableKey: 'mktAdsCreatives',
        expected: 1,
        created: 0,
        updated: 1,
        skipped: 0,
        duplicateInputRows: 0,
      },
      {
        tableKey: 'mktAdsDaily',
        expected: 0,
        created: 0,
        updated: 0,
        skipped: 0,
        duplicateInputRows: 0,
      },
    ], { idempotent: true }),
    (error) => error?.code === 'META_PAID_PROVIDER_DIRECT_LARK_IDEMPOTENCY_INVALID',
  );
});
