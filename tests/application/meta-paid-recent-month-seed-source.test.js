import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  META_PAID_RECENT_MONTH_SEED_PERIOD,
  collectMetaPaidRecentMonthSeedSource,
  isMetaAdsBusinessUseCaseRateLimit,
} from '../../scripts/lib/meta-paid-recent-month-seed-source.js';

const REPOSITORY_HEAD = 'b'.repeat(40);
const SOURCE_ACCOUNT_ID = '505898710119851';
const TARGET = 'chemistry_k2';

function accountEnvelope() {
  return {
    resource: {
      id: `act_${SOURCE_ACCOUNT_ID}`,
      account_id: SOURCE_ACCOUNT_ID,
      name: 'Chemistry K2',
      account_status: 1,
      currency: 'THB',
      timezone_name: 'Asia/Bangkok',
    },
  };
}

function dailyRow(adId, date = '2026-08-20') {
  return {
    account_id: SOURCE_ACCOUNT_ID,
    campaign_id: '100',
    campaign_name: 'Campaign',
    objective: 'OUTCOME_SALES',
    adset_id: '200',
    adset_name: 'Ad Set',
    ad_id: adId,
    ad_name: `Ad ${adId}`,
    date_start: date,
    date_stop: date,
    spend: '1.00',
    impressions: '10',
    reach: '9',
    clicks: '1',
    actions: [],
    action_values: [],
  };
}

function rateLimitError() {
  const error = new Error('Meta Ads Management Business Use Case rate limit');
  error.code = 'META_PERMANENT_API_ERROR';
  error.details = {
    status: 400,
    graphCode: 80004,
    graphSubcode: 2446079,
  };
  return error;
}

test('recent-month seed reads Daily first and resolves only activity-scoped creatives', async () => {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'meta-paid-recent-month-'));
  try {
    let accountCalls = 0;
    let dailyCalls = 0;
    const adapter = {
      async fetchAccount() {
        accountCalls += 1;
        return accountEnvelope();
      },
      async fetchDailyInsightsPage(input) {
        dailyCalls += 1;
        assert.equal(input.since, META_PAID_RECENT_MONTH_SEED_PERIOD.since);
        assert.equal(input.until, META_PAID_RECENT_MONTH_SEED_PERIOD.until);
        if (dailyCalls === 1) {
          assert.equal(input.after, null);
          return {
            rows: [dailyRow('10'), dailyRow('20')],
            hasMore: true,
            nextCursor: 'daily-cursor-1',
          };
        }
        assert.equal(input.after, 'daily-cursor-1');
        return {
          rows: [dailyRow('10'), dailyRow('30', '2026-08-21')],
          hasMore: false,
          nextCursor: null,
        };
      },
    };
    const lookupCalls = [];
    const source = await collectMetaPaidRecentMonthSeedSource({
      target: TARGET,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      repositoryHead: REPOSITORY_HEAD,
      requestedAt: Date.parse('2026-08-24T04:30:00Z'),
      checkpointRoot,
      adapter,
      async lookupCreativeForAd({ adAccountId, adId }) {
        assert.equal(adAccountId, SOURCE_ACCOUNT_ID);
        lookupCalls.push(adId);
        return {
          adId,
          accountId: SOURCE_ACCOUNT_ID,
          creative: {
            id: adId === '20' ? 'creative-shared' : adId === '10' ? 'creative-shared' : 'creative-30',
            name: `Creative ${adId}`,
          },
        };
      },
    });

    assert.equal(accountCalls, 1);
    assert.equal(dailyCalls, 2);
    assert.deepEqual(lookupCalls, ['10', '20', '30']);
    assert.equal(source.dailyInsights.length, 4);
    assert.deepEqual(source.creatives.map((row) => row.id), ['creative-30', 'creative-shared']);
    assert.equal(source.sourceSummary.dailyPages, 2);
    assert.equal(source.sourceSummary.activeAdCount, 3);
    assert.equal(source.sourceSummary.creativeRows, 2);
    assert.equal(source.sourceSummary.creativeLookupsResumed, 0);
    assert.deepEqual(source.period, META_PAID_RECENT_MONTH_SEED_PERIOD);

    const replay = await collectMetaPaidRecentMonthSeedSource({
      target: TARGET,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      repositoryHead: REPOSITORY_HEAD,
      requestedAt: Date.parse('2026-08-24T04:40:00Z'),
      checkpointRoot,
      adapter: {
        async fetchAccount() { throw new Error('account checkpoint must be reused'); },
        async fetchDailyInsightsPage() { throw new Error('Daily checkpoint must be reused'); },
      },
      async lookupCreativeForAd() {
        throw new Error('Creative lookup checkpoints must be reused');
      },
    });

    assert.equal(replay.sourceSummary.dailyResumedFromPages, 2);
    assert.equal(replay.sourceSummary.creativeLookupsResumed, 3);
    assert.deepEqual(replay.creatives.map((row) => row.id), ['creative-30', 'creative-shared']);
  } finally {
    await rm(checkpointRoot, { recursive: true, force: true });
  }
});

test('recent-month seed checkpoints activity Creative lookups across BUC throttles', async () => {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'meta-paid-recent-month-rate-'));
  try {
    const adapter = {
      async fetchAccount() { return accountEnvelope(); },
      async fetchDailyInsightsPage() {
        return {
          rows: [dailyRow('10'), dailyRow('20')],
          hasMore: false,
          nextCursor: null,
        };
      },
    };
    const firstLookups = [];
    await assert.rejects(
      () => collectMetaPaidRecentMonthSeedSource({
        target: TARGET,
        sourceAccountId: SOURCE_ACCOUNT_ID,
        repositoryHead: REPOSITORY_HEAD,
        requestedAt: Date.parse('2026-08-24T04:50:00Z'),
        checkpointRoot,
        adapter,
        async lookupCreativeForAd({ adId }) {
          firstLookups.push(adId);
          if (adId === '20') throw rateLimitError();
          return {
            adId,
            accountId: SOURCE_ACCOUNT_ID,
            creative: { id: 'creative-10', name: 'Creative 10' },
          };
        },
      }),
      (error) => error?.code === 'META_PAID_PROVIDER_RATE_LIMIT_RESUMABLE'
        && error?.details?.resumeAvailable === true
        && error?.details?.datasetKey === 'meta_ads.creatives.activity_scoped',
    );
    assert.deepEqual(firstLookups, ['10', '20']);

    const resumedLookups = [];
    const resumed = await collectMetaPaidRecentMonthSeedSource({
      target: TARGET,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      repositoryHead: REPOSITORY_HEAD,
      requestedAt: Date.parse('2026-08-24T05:00:00Z'),
      checkpointRoot,
      adapter: {
        async fetchAccount() { throw new Error('account checkpoint must be reused'); },
        async fetchDailyInsightsPage() { throw new Error('Daily checkpoint must be reused'); },
      },
      async lookupCreativeForAd({ adId }) {
        resumedLookups.push(adId);
        return {
          adId,
          accountId: SOURCE_ACCOUNT_ID,
          creative: { id: `creative-${adId}`, name: `Creative ${adId}` },
        };
      },
    });
    assert.deepEqual(resumedLookups, ['20']);
    assert.equal(resumed.sourceSummary.creativeLookupsResumed, 1);
    assert.deepEqual(resumed.creatives.map((row) => row.id), ['creative-10', 'creative-20']);
  } finally {
    await rm(checkpointRoot, { recursive: true, force: true });
  }
});

test('recent-month seed Business Use Case rate limit detection is exact', () => {
  assert.equal(isMetaAdsBusinessUseCaseRateLimit(rateLimitError()), true);
  assert.equal(isMetaAdsBusinessUseCaseRateLimit({
    details: { graphCode: 80004, graphSubcode: 2446078 },
  }), false);
  assert.equal(isMetaAdsBusinessUseCaseRateLimit({
    details: { graphCode: 4, graphSubcode: 2446079 },
  }), false);
});
