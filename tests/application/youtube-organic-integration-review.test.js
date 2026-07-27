import test from 'node:test';
import assert from 'node:assert/strict';
import {
  writeYouTubeOrganicStorageFirst,
} from '../../packages/application/src/storage/youtube-organic-history-storage.js';
import {
  syncYouTubeOrganicEndToEnd,
} from '../../packages/application/src/use-cases/sync-youtube-organic-end-to-end.js';

const OBSERVED_AT = Date.parse('2026-07-27T01:00:00Z');

function createCaptured(count) {
  const contentRows = [];
  const dailyRows = [];
  const rawVideos = [];
  for (let index = 0; index < count; index += 1) {
    const id = `video-${String(index).padStart(4, '0')}`;
    rawVideos.push(Object.freeze({
      raw_video_key: `youtube:UC_BATCH:${id}`,
      channel_id: 'UC_BATCH',
      video_id: id,
      source_availability_status: 'available',
      etag: `etag-${index}`,
    }));
    contentRows.push(Object.freeze({
      content_key: `youtube:channel_account:${id}`,
      platform: 'youtube',
      account_id: 'channel_account',
      external_content_id: id,
      content_type: 'video',
      published_at: Date.parse('2026-07-20T01:00:00Z'),
      caption: `Video ${index}`,
      content_url: `https://www.youtube.com/watch?v=${id}`,
      thumbnail_url: null,
      duration_seconds: 30,
      latest_views: index,
      latest_likes: 1,
      latest_comments: 0,
      latest_shares: null,
      latest_unique_viewers: null,
      avg_watch_time_seconds: null,
      completion_rate: null,
    }));
    dailyRows.push(Object.freeze({
      content_daily_key: `youtube:channel_account:${id}:2026-07-27`,
      metric_date: Date.parse('2026-07-27T00:00:00+07:00'),
      platform: 'youtube',
      account_id: 'channel_account',
      external_content_id: id,
      views: index,
      likes: 1,
      comments: 0,
      shares: null,
      unique_viewers: null,
      avg_watch_time_seconds: null,
      total_watch_time_seconds: null,
      completion_rate: null,
      traffic_sources: null,
      country_region_breakdown: null,
    }));
  }
  return new Map([
    ['rawChannels', [Object.freeze({
      raw_channel_key: 'youtube:UC_BATCH',
      channel_id: 'UC_BATCH',
      title: 'Batch Channel',
      uploads_playlist_id: 'UU_BATCH',
      view_count: 50_000,
      subscriber_count: 999,
      subscriber_count_hidden: true,
      video_count: count,
      fetched_at: OBSERVED_AT,
      source_payload_json: '{}',
    })]],
    ['rawVideos', rawVideos],
    ['rawAnalytics', []],
    ['contentRows', contentRows],
    ['dailyRows', dailyRows],
    ['accountRows', [{ account_key: 'youtube:channel_account' }]],
  ]);
}

function createDurableState() {
  const states = new Map();
  const observations = new Map();
  const coverage = new Map();
  const coverageEntities = new Map();
  const accountFacts = new Map();
  const stateReadBatchSizes = [];
  const coverageEvents = [];
  let failAccountWrite = false;
  let failContentWrite = false;

  const store = {
    async saveCoverageRun(row) {
      coverage.set(row.coverage_run_id, Object.freeze({ ...row }));
      coverageEvents.push(Object.freeze({
        id: row.coverage_run_id,
        dataset: row.dataset_key,
        status: row.status,
      }));
      return Object.freeze({ status: 'written' });
    },
    async upsertOrganicAccountDailyFact(row) {
      if (failAccountWrite) {
        const error = new Error('synthetic account retry failure');
        error.code = 'SYNTHETIC_ACCOUNT_RETRY_FAILURE';
        throw error;
      }
      const existed = accountFacts.has(row.account_daily_key);
      accountFacts.set(row.account_daily_key, Object.freeze({ ...row }));
      return Object.freeze({ status: existed ? 'skipped' : 'written' });
    },
  };
  const gateway = {
    store,
    async listOrganicContentStatesByKeys(keys) {
      stateReadBatchSizes.push(keys.length);
      assert.ok(keys.length <= 1_000, `state read exceeded D1 gateway limit: ${keys.length}`);
      return keys.flatMap((key) => states.has(key) ? [states.get(key)] : []);
    },
    async readCoverageRun(id) {
      return coverage.get(id) ?? null;
    },
    async upsertOrganicContentState(row) {
      if (failContentWrite) {
        const error = new Error('synthetic content retry failure');
        error.code = 'SYNTHETIC_CONTENT_RETRY_FAILURE';
        throw error;
      }
      const existed = states.has(row.content_key);
      states.set(row.content_key, Object.freeze({ ...row }));
      return Object.freeze({ status: existed ? 'skipped' : 'written' });
    },
    async saveOrganicContentObservation(row) {
      const existing = observations.get(row.observation_key);
      if (existing) {
        assert.deepEqual(existing, row);
        return Object.freeze({ status: 'skipped' });
      }
      observations.set(row.observation_key, Object.freeze({ ...row }));
      return Object.freeze({ status: 'created' });
    },
    async saveCoverageRun(row) {
      return store.saveCoverageRun(row);
    },
    async saveCoverageEntities(rows) {
      return rows.map((row) => {
        const existed = coverageEntities.has(row.coverage_entity_key);
        coverageEntities.set(row.coverage_entity_key, Object.freeze({ ...row }));
        return Object.freeze({ status: existed ? 'skipped' : 'written' });
      });
    },
  };

  return {
    gateway,
    store,
    states,
    observations,
    coverage,
    coverageEntities,
    accountFacts,
    stateReadBatchSizes,
    coverageEvents,
    failAccountWrites() {
      failAccountWrite = true;
    },
    failContentWrites() {
      failContentWrite = true;
    },
  };
}

function context(durable) {
  return Object.freeze({
    gateway: durable.gateway,
    store: durable.store,
    customerProfile: 'dev_ft_pumkin',
    customerKey: 'integration_workspace',
    accountKey: 'channel_account',
    sourceAccountId: 'UC_BATCH',
    sourceTimezone: 'Asia/Bangkok',
    metricDate: '2026-07-27',
    observedAt: OBSERVED_AT,
    fetchedAt: OBSERVED_AT,
    syncRunId: 'sync-attempt-1',
    workKey: 'youtube:batch-message',
    generation: OBSERVED_AT,
    scopeMode: 'full_inventory',
    async assertLockActive() {},
  });
}

test('YouTube D1-first storage batches more than 1,000 Content identities within the shared gateway limit', async () => {
  const durable = createDurableState();
  const result = await writeYouTubeOrganicStorageFirst(context(durable), createCaptured(1_001));

  assert.equal(result.status, 'complete');
  assert.equal(result.content.contentRows, 1_001);
  assert.equal(durable.states.size, 1_001);
  assert.equal(durable.observations.size, 1_001);
  assert.equal(durable.coverageEntities.size, 1_001);
  assert.equal(Math.max(...durable.stateReadBatchSizes), 500);
  assert.equal([...durable.accountFacts.values()][0].followers, null);
});

test('completed YouTube account Coverage is never downgraded to partial by a failed retry', async () => {
  const durable = createDurableState();
  const captured = createCaptured(2);
  const first = await writeYouTubeOrganicStorageFirst(context(durable), captured);
  const accountCoverageId = first.accountCoverageRunId;
  assert.equal(durable.coverage.get(accountCoverageId).status, 'complete');

  const eventOffset = durable.coverageEvents.length;
  durable.failAccountWrites();
  await assert.rejects(
    () => writeYouTubeOrganicStorageFirst({
      ...context(durable),
      syncRunId: 'sync-attempt-2',
    }, captured),
    (error) => error.code === 'SYNTHETIC_ACCOUNT_RETRY_FAILURE',
  );

  assert.equal(durable.coverage.get(accountCoverageId).status, 'complete');
  const retryEvents = durable.coverageEvents.slice(eventOffset)
    .filter((event) => event.id === accountCoverageId);
  assert.equal(retryEvents.some((event) => event.status === 'partial'), false);
});

test('completed YouTube content Coverage is never downgraded to partial by a failed retry', async () => {
  const durable = createDurableState();
  const captured = createCaptured(2);
  const first = await writeYouTubeOrganicStorageFirst(context(durable), captured);
  const contentCoverageId = first.contentCoverageRunId;
  assert.equal(durable.coverage.get(contentCoverageId).status, 'complete');

  const eventOffset = durable.coverageEvents.length;
  durable.failContentWrites();
  await assert.rejects(
    () => writeYouTubeOrganicStorageFirst({
      ...context(durable),
      syncRunId: 'sync-attempt-2',
    }, captured),
    (error) => error.code === 'SYNTHETIC_CONTENT_RETRY_FAILURE',
  );

  assert.equal(durable.coverage.get(contentCoverageId).status, 'complete');
  const retryEvents = durable.coverageEvents.slice(eventOffset)
    .filter((event) => event.id === contentCoverageId);
  assert.equal(retryEvents.some((event) => event.status === 'partial'), false);
});

test('YouTube cumulative metricDate must match the durable observation date', async () => {
  const store = {
    async saveCoverageRun() {},
    async upsertOrganicAccountDailyFact() {},
  };
  const historyGateway = {
    store,
    async assertSchemaReady() {},
    async listOrganicContentStatesByKeys() { return []; },
    async upsertOrganicContentState() {},
    async saveOrganicContentObservation() {},
    async readCoverageRun() { return null; },
    async saveCoverageRun() {},
    async saveCoverageEntities() {},
  };
  await assert.rejects(() => syncYouTubeOrganicEndToEnd({
    historyGateway,
    historyStore: store,
    requestedAt: Date.parse('2026-07-27T01:00:00Z'),
    generation: Date.parse('2026-07-27T01:00:00Z'),
    metricDate: '2026-07-26',
    sourceTimezone: 'Asia/Bangkok',
  }), (error) => error.code === 'YOUTUBE_METRIC_DATE_GENERATION_MISMATCH');
});
