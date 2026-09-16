import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import {
  buildTikTokPortfolioAccountDailyFact,
  projectOrganicAccountDailyFactToLark,
} from '../../packages/application/src/use-cases/organic-account-daily-projection.js';
import { createTikTokOrganicHistoryHooks } from '../../packages/application/src/storage/tiktok-organic-history-hooks.js';
import { createContentKey } from '../../packages/application/src/storage/marketing-history-contract.js';
import { D1OrganicHistoryGateway } from '../../packages/connectors/src/d1-organic-history-gateway.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const OBSERVED_AT = Date.parse('2026-09-16T01:00:00.000Z');
const MIGRATION_URL = new URL('../../migrations/0009_storage_foundation.sql', import.meta.url);

test('TikTok portfolio Account Daily preserves exact sums and projects the canonical Lark identity', () => {
  const fact = buildTikTokPortfolioAccountDailyFact({
    aggregate: {
      row_count: 2,
      views_present: 2,
      views_total: 300,
      interactions_present: 2,
      interactions_total: 36,
    },
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    sourceAccountId: 'chemistry_k',
    metricDate: '2026-09-15',
    sourceTimezone: 'Asia/Bangkok',
    coverageRunId: 'coverage:tiktok:account',
    sourceRevision: 'source-revision',
    fetchedAt: OBSERVED_AT,
    observedAt: OBSERVED_AT,
    syncRunId: 'history:tiktok:test',
  });
  assert.equal(fact.account_daily_key, 'tiktok:chemistry_k:2026-09-15');
  assert.equal(fact.views, 300);
  assert.equal(fact.total_interactions, 36);
  assert.equal(fact.data_status, 'complete');

  const lark = projectOrganicAccountDailyFactToLark({
    fact,
    canonicalAccountKey: 'tiktok:chemistry_k',
  });
  assert.equal(lark.account_daily_key, 'tiktok:chemistry_k:2026-09-15');
  assert.equal(lark.account_key, 'tiktok:chemistry_k');
  assert.equal(lark.metric_date, Date.parse('2026-09-14T17:00:00.000Z'));
  assert.equal(lark.views, 300);
  assert.equal(lark.total_interactions, 36);
  assert.equal('followers' in lark, false);
});

test('TikTok portfolio Account Daily keeps incomplete metrics null instead of inventing zero', () => {
  const fact = buildTikTokPortfolioAccountDailyFact({
    aggregate: {
      row_count: 2,
      views_present: 1,
      views_total: 100,
      interactions_present: 0,
      interactions_total: 0,
    },
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    metricDate: '2026-09-15',
    sourceTimezone: 'Asia/Bangkok',
    coverageRunId: 'coverage:tiktok:account',
    sourceRevision: 'source-revision',
    fetchedAt: OBSERVED_AT,
    observedAt: OBSERVED_AT,
    syncRunId: 'history:tiktok:test',
  });
  assert.equal(fact.views, null);
  assert.equal(fact.total_interactions, null);
  assert.equal(fact.data_status, 'partial');
});

test('TikTok history hook persists one exact Account Daily fact and reruns idempotently', async () => {
  const d1 = createSqliteD1();
  try {
    d1.exec(await readFile(MIGRATION_URL, 'utf8'));
    const gateway = new D1OrganicHistoryGateway({ db: d1 });
    for (const [externalContentId, views, likes] of [
      ['video-1', 100, 10],
      ['video-2', 200, 20],
    ]) {
      const row = {
        customer_profile: 'chemistry-k-prod',
        customer_key: 'chemistry_k',
        platform: 'tiktok',
        account_key: 'chemistry_k',
        source_account_id: 'chemistry_k',
        external_content_id: externalContentId,
        content_type: 'video',
        published_at: OBSERVED_AT - 86_400_000,
        first_seen_at: OBSERVED_AT,
        last_observed_at: OBSERVED_AT,
        last_changed_at: OBSERVED_AT,
        source_availability_status: 'available',
        views,
        likes,
        comments: 1,
        shares: 2,
        unique_viewers: null,
        avg_watch_time_seconds: null,
        total_watch_time_seconds: null,
        completion_rate: null,
        metrics_hash: `metrics-${externalContentId}`,
        metadata_hash: `metadata-${externalContentId}`,
        last_coverage_run_id: 'coverage:tiktok:content',
        last_sync_run_id: 'history:tiktok:test',
        created_at: OBSERVED_AT,
        updated_at: OBSERVED_AT,
      };
      await gateway.upsertOrganicContentState({ ...row, content_key: createContentKey(row) });
    }
    const hooks = createTikTokOrganicHistoryHooks({
      gateway,
      customerProfile: 'chemistry-k-prod',
      customerKey: 'chemistry_k',
      platform: 'tiktok',
      accountKey: 'chemistry_k',
      sourceAccountId: 'chemistry_k',
      sourceTimezone: 'Asia/Bangkok',
      metricDate: '2026-09-15',
      observedAt: OBSERVED_AT,
      fetchedAt: OBSERVED_AT,
      historySyncRunId: 'history:tiktok:test',
      coverageRunId: 'coverage:tiktok:content',
      sourceRevision: 'source-revision',
      sourceWatermark: 'source-watermark',
      scopeMode: 'full_inventory',
      datasetKey: 'organic_content_cumulative',
    });
    const first = await hooks.materializeAccountDaily();
    const second = await hooks.materializeAccountDaily();
    assert.equal(first.write.status, 'written');
    assert.equal(second.write.status, 'skipped');
    assert.equal(first.larkRow.account_daily_key, 'tiktok:chemistry_k:2026-09-15');
    assert.equal(first.larkRow.views, 300);
    assert.equal(first.larkRow.total_interactions, 36);
    assert.equal(
      d1.database.prepare('SELECT COUNT(*) AS total FROM organic_account_daily_facts').get().total,
      1,
    );
  } finally {
    d1.close();
  }
});
