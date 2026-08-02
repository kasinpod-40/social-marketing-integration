import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMetaOrganicWriteSet } from '../../packages/application/src/use-cases/build-meta-organic-write-set.js';

const FETCHED_AT = Date.parse('2026-07-24T00:05:00Z');

test('builds Facebook Raw, Canonical, account daily and Organic history inputs with stable keys', () => {
  const writeSet = buildMetaOrganicWriteSet({
    connectorKey: 'facebook',
    accountId: 'page_fixture_001',
    accountKey: 'chemistry_k_facebook',
    customerProfile: 'chemistry_k',
    customerKey: 'chemistry_k',
    syncRunId: 'sync_meta_1',
    operationId: 'operation_meta_1',
    fetchedAt: FETCHED_AT,
    accountResource: {
      id: 'page_fixture_001',
      name: 'Fixture Facebook Page',
      username: 'fixture.facebook',
      category: 'Education',
      fan_count: '1200',
      followers_count: 1250,
      link: 'https://example.test/facebook/fixture?tracking=remove',
    },
    contentResources: [{
      id: 'post_fixture_001',
      message: 'Synthetic Facebook post',
      created_time: '2026-07-23T17:30:00+0000',
      updated_time: '2026-07-23T18:00:00+0000',
      permalink_url: 'https://example.test/facebook/posts/fixture?tracking=remove',
      is_published: true,
    }],
    contentInsights: [{
      contentId: 'post_fixture_001',
      insights: [{
        name: 'post_media_view',
        period: 'lifetime',
        values: [{ value: 0, end_time: '2026-07-24T00:00:00+0000' }],
      }],
    }],
    accountInsights: [],
  });

  assert.equal(writeSet.raw.organicAccounts[0].raw_account_key, 'facebook:page_fixture_001');
  assert.equal(writeSet.raw.organicAccounts[0].username, 'fixture.facebook');
  assert.equal(writeSet.raw.organicAccounts[0].followers_count, 1250);
  assert.equal(
    writeSet.raw.organicAccounts[0].profile_url,
    'https://example.test/facebook/fixture?tracking=remove',
  );
  assert.equal(
    writeSet.raw.organicContent[0].raw_content_key,
    'facebook:page_fixture_001:post_fixture_001',
  );
  assert.equal(writeSet.raw.organicMetrics[0].value_number, 0);
  assert.equal(
    writeSet.raw.organicMetrics[0].metric_date,
    Date.parse('2026-07-24T00:00:00+07:00'),
  );
  assert.equal(writeSet.canonical.content[0].latest_views, 0);
  assert.equal(writeSet.canonical.content[0].content_key, 'facebook:page_fixture_001:post_fixture_001');
  assert.equal(writeSet.canonical.contentDaily[0].views, 0);
  assert.equal(writeSet.d1.organicHistoryBatch.contentRows.length, 1);
  assert.equal(
    writeSet.d1.organicHistoryBatch.contentRows[0].content_key,
    'facebook:chemistry_k_facebook:post_fixture_001',
  );
  assert.equal(
    writeSet.d1.organicHistoryBatch.dailySnapshotRows[0].account_id,
    'chemistry_k_facebook',
  );
  assert.equal(writeSet.d1.accountDailyFacts[0].followers, 1250);
  assert.equal(writeSet.reconciliation.missingContentInsightRows, 0);
  assert.deepEqual(writeSet.canonical.accounts[0], {
    account_key: 'facebook:page_fixture_001',
    platform: 'facebook',
    account_id: 'page_fixture_001',
    account_name: 'Fixture Facebook Page',
    account_type: 'page',
    last_sync_at: FETCHED_AT,
  });
});

test('keeps Meta reach in Raw metrics without mislabeling it as unique viewers', () => {
  const writeSet = buildMetaOrganicWriteSet({
    connectorKey: 'facebook',
    accountId: 'page_fixture_001',
    accountKey: 'chemistry_k_facebook',
    customerProfile: 'chemistry_k',
    customerKey: 'chemistry_k',
    syncRunId: 'sync_meta_reach',
    operationId: 'operation_meta_reach',
    fetchedAt: FETCHED_AT,
    accountResource: { id: 'page_fixture_001', name: 'Fixture Facebook Page' },
    contentResources: [{
      id: 'post_fixture_reach',
      created_time: '2026-07-23T17:30:00+0000',
    }],
    contentInsights: [{
      contentId: 'post_fixture_reach',
      insights: [{
        name: 'reach',
        period: 'lifetime',
        values: [{ value: 5, end_time: '2026-07-24T00:00:00+0000' }],
      }],
    }],
    accountInsights: [],
  });
  assert.equal(writeSet.raw.organicMetrics[0].metric_name, 'reach');
  assert.equal(writeSet.raw.organicMetrics[0].value_number, 5);
  assert.equal(Object.hasOwn(writeSet.canonical.content[0], 'latest_unique_viewers'), false);
  assert.equal(writeSet.canonical.contentDaily.length, 0);
  assert.equal(writeSet.d1.organicHistoryBatch.contentRows.length, 0);
});

test('does not overwrite Organic latest metrics with null when content insights are absent', () => {
  const writeSet = buildMetaOrganicWriteSet({
    connectorKey: 'instagram',
    accountId: 'ig_fixture_001',
    accountKey: 'chemistry_k_instagram',
    customerProfile: 'chemistry_k',
    customerKey: 'chemistry_k',
    syncRunId: 'sync_meta_2',
    operationId: 'operation_meta_2',
    fetchedAt: FETCHED_AT,
    accountResource: {
      user_id: 'ig_fixture_001',
      id: 'scoped_fixture_001',
      username: 'fixture.instagram',
      name: 'Fixture Instagram',
      account_type: 'BUSINESS',
      followers_count: 2345,
      follows_count: 123,
      media_count: 45,
    },
    contentResources: [{
      id: 'media_fixture_001',
      caption: 'Synthetic Instagram reel',
      media_type: 'VIDEO',
      media_product_type: 'REELS',
      permalink: 'https://example.test/instagram/reel/fixture?tracking=remove',
      timestamp: '2026-07-23T23:30:00+0000',
    }],
    contentInsights: [],
    accountInsights: [],
  });

  assert.equal(writeSet.canonical.content.length, 1);
  assert.equal(Object.hasOwn(writeSet.canonical.content[0], 'latest_views'), false);
  assert.equal(writeSet.canonical.contentDaily.length, 0);
  assert.equal(writeSet.d1.organicHistoryBatch.contentRows.length, 0);
  assert.equal(writeSet.reconciliation.missingContentInsightRows, 1);
  assert.deepEqual(writeSet.canonical.accounts[0], {
    account_key: 'instagram:ig_fixture_001',
    platform: 'instagram',
    account_id: 'ig_fixture_001',
    account_name: 'Fixture Instagram',
    account_type: 'business',
    last_sync_at: FETCHED_AT,
  });
  assert.equal(writeSet.raw.organicAccounts[0].username, 'fixture.instagram');
});

test('maps an unavailable Provider descriptor to the approved Lark other shape without inventing a value', () => {
  const writeSet = buildMetaOrganicWriteSet({
    connectorKey: 'instagram',
    accountId: 'ig_fixture_001',
    accountKey: 'chemistry_k_instagram',
    customerProfile: 'chemistry_k',
    customerKey: 'chemistry_k',
    syncRunId: 'sync_meta_unavailable',
    operationId: 'operation_meta_unavailable',
    fetchedAt: FETCHED_AT,
    accountResource: {
      user_id: 'ig_fixture_001',
      id: 'scoped_fixture_001',
      username: 'fixture.instagram',
      name: 'Fixture Instagram',
      account_type: 'BUSINESS',
    },
    contentResources: [],
    contentInsights: [],
    accountInsights: [{
      name: 'follows_and_unfollows',
      period: 'day',
      id: 'ig_fixture_001/insights/follows_and_unfollows/day',
      title: 'Follows and unfollows',
      description: 'Unavailable for the selected range',
    }],
  });

  assert.equal(writeSet.raw.organicMetrics[0].response_shape, 'other');
  assert.equal(writeSet.raw.organicMetrics[0].value_number, null);
  assert.equal(writeSet.raw.organicMetrics[0].value_json, null);
  assert.match(writeSet.raw.organicMetrics[0].source_payload_json, /Unavailable for the selected range/u);
});

test('keeps Instagram Provider identity in Canonical rows and account_key in D1 history', () => {
  const writeSet = buildMetaOrganicWriteSet({
    connectorKey: 'instagram',
    accountId: 'ig_fixture_001',
    accountKey: 'chemistry_k_instagram',
    customerProfile: 'chemistry_k',
    customerKey: 'chemistry_k',
    syncRunId: 'sync_meta_identity',
    operationId: 'operation_meta_identity',
    fetchedAt: FETCHED_AT,
    accountResource: {
      user_id: 'ig_fixture_001',
      id: 'scoped_fixture_001',
      username: 'fixture.instagram',
      name: 'Fixture Instagram',
      account_type: 'BUSINESS',
    },
    contentResources: [{
      id: 'media_fixture_001',
      media_type: 'VIDEO',
      timestamp: '2026-07-23T23:30:00+0000',
    }],
    contentInsights: [{
      contentId: 'media_fixture_001',
      insights: [{
        name: 'views',
        period: 'lifetime',
        values: [{ value: 7, end_time: '2026-07-24T00:00:00+0000' }],
      }],
    }],
    accountInsights: [],
  });

  assert.equal(
    writeSet.canonical.content[0].content_key,
    'instagram:ig_fixture_001:media_fixture_001',
  );
  assert.equal(
    writeSet.d1.organicHistoryBatch.contentRows[0].content_key,
    'instagram:chemistry_k_instagram:media_fixture_001',
  );
  assert.equal(
    writeSet.d1.organicHistoryBatch.dailySnapshotRows[0].account_id,
    'chemistry_k_instagram',
  );
});
