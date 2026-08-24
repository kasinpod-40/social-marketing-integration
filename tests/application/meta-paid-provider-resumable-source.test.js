import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  META_PAID_PROVIDER_RESUMABLE_SOURCE_CONTRACT_VERSION,
  collectMetaPaidProviderResumableSource,
  isMetaAdsBusinessUseCaseRateLimit,
} from '../../scripts/lib/meta-paid-provider-resumable-source.js';

const REPOSITORY_HEAD = 'a'.repeat(40);
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

function rateLimitError() {
  const error = new Error('Meta Graph request failed: meta_ads.creatives.inventory');
  error.code = 'META_PERMANENT_API_ERROR';
  error.details = {
    status: 400,
    graphCode: 80004,
    graphSubcode: 2446079,
  };
  return error;
}

test('paid Meta resumable source checkpoints pages before rate limit and resumes without replay', async () => {
  const checkpointRoot = await mkdtemp(join(tmpdir(), 'meta-paid-resume-'));
  try {
    let firstAccountCalls = 0;
    let firstCreativeCalls = 0;
    let firstDailyCalls = 0;
    const firstAdapter = {
      async fetchAccount() {
        firstAccountCalls += 1;
        return accountEnvelope();
      },
      async fetchCreativesPage(input) {
        firstCreativeCalls += 1;
        if (firstCreativeCalls === 1) {
          assert.equal(input.after, null);
          assert.deepEqual(input.visitedCursors, []);
          return {
            rows: [{ id: 'creative-1' }],
            hasMore: true,
            nextCursor: 'cursor-1',
          };
        }
        assert.equal(input.after, 'cursor-1');
        throw rateLimitError();
      },
      async fetchDailyInsightsPage() {
        firstDailyCalls += 1;
        throw new Error('Daily must not start after Creative rate limit');
      },
    };

    await assert.rejects(
      () => collectMetaPaidProviderResumableSource({
        target: TARGET,
        sourceAccountId: SOURCE_ACCOUNT_ID,
        repositoryHead: REPOSITORY_HEAD,
        requestedAt: Date.parse('2026-08-24T01:30:00Z'),
        checkpointRoot,
        adapter: firstAdapter,
      }),
      (error) => error?.code === 'META_PAID_PROVIDER_RATE_LIMIT_RESUMABLE'
        && error?.details?.pagesCompleted === 1
        && error?.details?.rowCount === 1
        && error?.details?.resumeAvailable === true,
    );

    assert.equal(firstAccountCalls, 1);
    assert.equal(firstCreativeCalls, 2);
    assert.equal(firstDailyCalls, 0);

    const statePath = join(
      checkpointRoot,
      TARGET,
      'meta-ads-creatives-inventory',
      'state.json',
    );
    const state = JSON.parse(await readFile(statePath, 'utf8'));
    assert.equal(state.contractVersion, META_PAID_PROVIDER_RESUMABLE_SOURCE_CONTRACT_VERSION);
    assert.equal(state.pagesCompleted, 1);
    assert.equal(state.rowCount, 1);
    assert.equal(state.completed, false);
    assert.equal(state.nextCursor, 'cursor-1');

    let resumedAccountCalls = 0;
    let resumedCreativeCalls = 0;
    let resumedDailyCalls = 0;
    const resumedAdapter = {
      async fetchAccount() {
        resumedAccountCalls += 1;
        throw new Error('Account checkpoint must be reused');
      },
      async fetchCreativesPage(input) {
        resumedCreativeCalls += 1;
        assert.equal(input.after, 'cursor-1');
        assert.deepEqual(input.visitedCursors, []);
        return {
          rows: [{ id: 'creative-2' }],
          hasMore: false,
          nextCursor: null,
        };
      },
      async fetchDailyInsightsPage(input) {
        resumedDailyCalls += 1;
        assert.equal(input.after, null);
        assert.equal(input.since, '2026-07-01');
        assert.equal(input.until, '2026-07-31');
        return {
          rows: [{
            account_id: SOURCE_ACCOUNT_ID,
            date_start: '2026-07-31',
            date_stop: '2026-07-31',
          }],
          hasMore: false,
          nextCursor: null,
        };
      },
    };

    const resumed = await collectMetaPaidProviderResumableSource({
      target: TARGET,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      repositoryHead: REPOSITORY_HEAD,
      requestedAt: Date.parse('2026-08-24T01:40:00Z'),
      checkpointRoot,
      adapter: resumedAdapter,
    });

    assert.equal(resumedAccountCalls, 0);
    assert.equal(resumedCreativeCalls, 1);
    assert.equal(resumedDailyCalls, 1);
    assert.deepEqual(resumed.creatives.map((row) => row.id), ['creative-1', 'creative-2']);
    assert.equal(resumed.sourceSummary.creativePages, 2);
    assert.equal(resumed.sourceSummary.creativeRows, 2);
    assert.equal(resumed.sourceSummary.creativeResumedFromPages, 1);
    assert.equal(resumed.sourceSummary.dailyPages, 1);
    assert.equal(resumed.sourceSummary.dailyRows, 1);

    const neverCallAdapter = {
      async fetchAccount() { throw new Error('completed account checkpoint must be reused'); },
      async fetchCreativesPage() { throw new Error('completed Creative checkpoint must be reused'); },
      async fetchDailyInsightsPage() { throw new Error('completed Daily checkpoint must be reused'); },
    };
    const replay = await collectMetaPaidProviderResumableSource({
      target: TARGET,
      sourceAccountId: SOURCE_ACCOUNT_ID,
      repositoryHead: REPOSITORY_HEAD,
      requestedAt: Date.parse('2026-08-24T01:50:00Z'),
      checkpointRoot,
      adapter: neverCallAdapter,
    });
    assert.deepEqual(replay.creatives.map((row) => row.id), ['creative-1', 'creative-2']);
    assert.equal(replay.sourceSummary.creativeResumedFromPages, 2);
    assert.equal(replay.sourceSummary.dailyResumedFromPages, 1);
  } finally {
    await rm(checkpointRoot, { recursive: true, force: true });
  }
});

test('paid Meta Business Use Case rate limit detection is exact', () => {
  assert.equal(isMetaAdsBusinessUseCaseRateLimit(rateLimitError()), true);
  assert.equal(isMetaAdsBusinessUseCaseRateLimit({
    details: { graphCode: 80004, graphSubcode: 2446078 },
  }), false);
  assert.equal(isMetaAdsBusinessUseCaseRateLimit({
    details: { graphCode: 4, graphSubcode: 2446079 },
  }), false);
});
