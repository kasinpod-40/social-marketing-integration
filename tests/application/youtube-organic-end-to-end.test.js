import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildEndToEndCompletion,
  resolveYouTubeCoverageScopeMode,
} from '../../packages/application/src/use-cases/sync-youtube-organic-end-to-end.js';
import {
  YouTubeStorageFirstSyncEngine,
} from '../../packages/application/src/storage/youtube-storage-first-sync-engine.js';
import { normalizeYouTubeVideo } from '../../packages/application/src/use-cases/normalize-youtube-video.js';
import { YouTubeApiClient } from '../../packages/connectors/src/youtube/youtube-api.client.js';
import { mapYouTubeChannelResource } from '../../packages/connectors/src/youtube/youtube-organic.adapter.js';

const OBSERVED_AT = Date.parse('2026-07-26T12:00:00Z');

function createDurableState() {
  const states = new Map();
  const observations = new Map();
  const coverage = new Map();
  const coverageEntities = new Map();
  const accountFacts = new Map();
  const analyticsFacts = new Map();
  const events = [];
  const write = (map, key, row, event) => {
    const before = map.get(key);
    map.set(key, Object.freeze({ ...row }));
    events.push(event);
    return Object.freeze({ status: before && JSON.stringify(before) === JSON.stringify(row) ? 'skipped' : 'written' });
  };
  const gateway = {
    store: {
      saveCoverageRun: (row) => write(coverage, row.coverage_run_id, row, `d1:coverage:${row.status}`),
      upsertOrganicAccountDailyFact: (row) => write(accountFacts, row.account_daily_key, row, 'd1:account'),
    },
    async assertSchemaReady() { return { ready: true }; },
    async listOrganicContentStatesByKeys(keys) {
      return keys.flatMap((key) => states.has(key) ? [states.get(key)] : []);
    },
    async readCoverageRun(id) { return coverage.get(id) ?? null; },
    async upsertOrganicContentState(row) {
      return write(states, row.content_key, row, `d1:state:${row.external_content_id}`);
    },
    async saveOrganicContentObservation(row) {
      const before = observations.get(row.observation_key);
      if (before) {
        assert.deepEqual(before, row);
        events.push(`d1:observation-skip:${row.external_content_id}`);
        return Object.freeze({ status: 'skipped' });
      }
      observations.set(row.observation_key, Object.freeze({ ...row }));
      events.push(`d1:observation:${row.external_content_id}`);
      return Object.freeze({ status: 'created' });
    },
    async saveCoverageRun(row) {
      return write(coverage, row.coverage_run_id, row, `d1:coverage:${row.status}`);
    },
    async saveCoverageEntities(rows) {
      return rows.map((row) => write(
        coverageEntities,
        row.coverage_entity_key,
        row,
        `d1:coverage-entity:${row.external_entity_id}`,
      ));
    },
  };
  const analyticsStore = {
    async assertSchemaReady() { return { ready: true }; },
    async listStableKeysByScope() { return [...analyticsFacts.keys()]; },
    async upsertMany(rows) {
      for (const row of rows) analyticsFacts.set(row.raw_analytics_daily_key, row);
      events.push(`d1:analytics:${rows.length}`);
      return { rows: rows.length, written: rows.length, skipped: 0 };
    },
  };
  return { gateway, analyticsStore, states, observations, coverage, coverageEntities, accountFacts, analyticsFacts, events };
}

function createInnerEngine(events, input = {}) {
  let fail = input.failFirstExecute === true;
  return {
    async planByKey(value) {
      return Object.freeze({
        tableId: value.tableId,
        createRows: Object.freeze([...value.rows]),
        updateRows: Object.freeze([]),
        skipped: 0,
        duplicateInputRows: 0,
      });
    },
    async executePlan(plan) {
      events.push(`lark:${plan.tableId}`);
      if (fail) {
        fail = false;
        const error = new Error('synthetic partial Lark failure');
        error.code = 'TABLE_SYNC_PARTIAL_WRITE';
        throw error;
      }
      return Object.freeze({ created: plan.createRows.length, updated: 0, skipped: 0 });
    },
  };
}

function fixtureRows() {
  const baseContent = (id, views) => Object.freeze({
    content_key: `youtube:channel_account:${id}`,
    platform: 'youtube',
    account_id: 'channel_account',
    external_content_id: id,
    content_type: 'video',
    published_at: Date.parse('2026-07-20T01:00:00Z'),
    caption: `Video ${id}`,
    content_url: `https://www.youtube.com/watch?v=${id}`,
    thumbnail_url: null,
    duration_seconds: 30,
    latest_views: views,
    latest_likes: 2,
    latest_comments: 1,
    latest_shares: null,
    latest_unique_viewers: null,
    avg_watch_time_seconds: null,
    completion_rate: null,
  });
  const daily = (id, views) => Object.freeze({
    content_daily_key: `youtube:channel_account:${id}:2026-07-26`,
    metric_date: Date.parse('2026-07-26T00:00:00+07:00'),
    platform: 'youtube',
    account_id: 'channel_account',
    external_content_id: id,
    views,
    likes: 2,
    comments: 1,
    shares: null,
    unique_viewers: null,
    avg_watch_time_seconds: null,
    total_watch_time_seconds: null,
    completion_rate: null,
    traffic_sources: null,
    country_region_breakdown: null,
  });
  return Object.freeze({
    rawChannels: Object.freeze([{
      raw_channel_key: 'youtube:UC_TEST',
      channel_id: 'UC_TEST',
      title: 'Test Channel',
      uploads_playlist_id: 'UU_TEST',
      view_count: 500,
      subscriber_count: null,
      subscriber_count_hidden: true,
      video_count: 3,
      fetched_at: OBSERVED_AT,
      source_payload_json: '{}',
    }]),
    rawVideos: Object.freeze([
      { raw_video_key: 'youtube:UC_TEST:v1', channel_id: 'UC_TEST', video_id: 'v1', source_availability_status: 'available', etag: 'a' },
      { raw_video_key: 'youtube:UC_TEST:v2', channel_id: 'UC_TEST', video_id: 'v2', source_availability_status: 'missing', etag: null },
      { raw_video_key: 'youtube:UC_TEST:v3', channel_id: 'UC_TEST', video_id: 'v3', source_availability_status: 'private', etag: 'c' },
    ]),
    rawAnalytics: Object.freeze([]),
    contentRows: Object.freeze([baseContent('v1', 100), baseContent('v3', 30)]),
    dailyRows: Object.freeze([daily('v1', 100), daily('v3', 30)]),
    accountRows: Object.freeze([{ account_key: 'youtube:channel_account' }]),
  });
}

async function captureAll(engine, rows) {
  const definitions = [
    ['raw-channels', 'raw_channel_key', rows.rawChannels],
    ['raw-videos', 'raw_video_key', rows.rawVideos],
    ['raw-analytics', 'raw_analytics_daily_key', rows.rawAnalytics],
    ['content', 'content_key', rows.contentRows],
    ['daily', 'content_daily_key', rows.dailyRows],
    ['accounts', 'account_key', rows.accountRows],
  ];
  const plans = [];
  for (const [tableId, keyField, selectedRows] of definitions) {
    plans.push(await engine.planByKey({
      repository: {},
      tableId,
      keyField,
      rows: selectedRows,
    }));
  }
  return plans;
}

function context(durable) {
  return Object.freeze({
    gateway: durable.gateway,
    analyticsStore: durable.analyticsStore,
    store: durable.gateway.store,
    customerProfile: 'dev_ft_pumkin',
    customerKey: 'integration_workspace',
    accountKey: 'channel_account',
    sourceAccountId: 'UC_TEST',
    sourceTimezone: 'Asia/Bangkok',
    metricDate: '2026-07-26',
    observedAt: OBSERVED_AT,
    fetchedAt: OBSERVED_AT,
    syncRunId: 'sync-attempt-1',
    workKey: 'youtube:message-1',
    generation: OBSERVED_AT,
    scopeMode: 'full_inventory',
  });
}

test('Coverage scope follows the existing YouTube checkpoint decision for forced reconciliation', async () => {
  const noCheckpoint = await resolveYouTubeCoverageScopeMode({
    requested: 'incremental',
    incrementalStateStore: { async loadCheckpoint() { return null; } },
    cursorKey: 'sync:youtube:test',
    now: OBSERVED_AT,
    fullSyncIntervalMs: 86_400_000,
  });
  assert.equal(noCheckpoint, 'full_inventory');

  const recent = await resolveYouTubeCoverageScopeMode({
    requested: 'incremental',
    incrementalStateStore: {
      async loadCheckpoint() {
        return { cursor: { lastFullSyncAt: OBSERVED_AT - 3_600_000 } };
      },
    },
    cursorKey: 'sync:youtube:test',
    now: OBSERVED_AT,
    fullSyncIntervalMs: 86_400_000,
  });
  assert.equal(recent, 'recent_window');
});

test('end-to-end storage identity is part of the durable work completion', () => {
  const completion = buildEndToEndCompletion({
    completion: { mode: 'write', checkpointSaved: true },
    d1WriteEnabled: true,
    larkWriteEnabled: true,
    storage: {
      historySyncRunId: 'history:youtube:test',
      contentCoverageRunId: 'coverage:youtube:test',
      accountCoverageRunId: 'coverage:youtube-account:test',
    },
  });
  assert.equal(completion.endToEnd.contract, 'youtube-organic-end-to-end-v1');
  assert.equal(completion.endToEnd.storage.historySyncRunId, 'history:youtube:test');
  assert.equal(completion.endToEnd.storage.contentCoverageRunId, 'coverage:youtube:test');
  assert.equal(completion.endToEnd.storage.accountCoverageRunId, 'coverage:youtube-account:test');
  assert.deepEqual(completion.endToEnd.larkTargets, [
    'MKT_Accounts', 'MKT_Content', 'MKT_Content_Daily',
  ]);
});

test('D1 is durable before Lark, retry is idempotent, and unavailable states stay non-destructive', async () => {
  const durable = createDurableState();
  const rows = fixtureRows();
  const first = new YouTubeStorageFirstSyncEngine({
    tableSyncEngine: createInnerEngine(durable.events, { failFirstExecute: true }),
    context: context(durable),
    d1WriteEnabled: true,
    larkWriteEnabled: true,
  });
  const firstPlans = await captureAll(first, rows);

  await assert.rejects(() => first.executePlan(firstPlans[0]), /synthetic partial Lark failure/);
  assert.equal(durable.events.findIndex((event) => event.startsWith('d1:state:'))
    < durable.events.findIndex((event) => event.startsWith('lark:')), true);
  assert.equal(durable.observations.size, 2);
  assert.equal(durable.states.get('youtube:channel_account:v1').source_availability_status, 'available');
  assert.equal(durable.states.get('youtube:channel_account:v2').source_availability_status, 'missing');
  assert.equal(durable.states.get('youtube:channel_account:v3').source_availability_status, 'private');
  assert.equal(durable.states.get('youtube:channel_account:v2').views, null);
  assert.equal(durable.accountFacts.values().next().value.followers, null);

  const retry = new YouTubeStorageFirstSyncEngine({
    tableSyncEngine: createInnerEngine(durable.events),
    context: { ...context(durable), syncRunId: 'sync-attempt-2' },
    d1WriteEnabled: true,
    larkWriteEnabled: true,
  });
  const retryPlans = await captureAll(retry, rows);
  for (const plan of retryPlans) await retry.executePlan(plan);

  assert.equal(durable.observations.size, 2);
  assert.equal(retry.storageResult.contentCoverageRunId, first.storageResult.contentCoverageRunId);
  assert.equal(retry.storageResult.historySyncRunId, first.storageResult.historySyncRunId);
  assert.equal(durable.states.get('youtube:channel_account:v2').source_availability_status, 'missing');
});

test('uploads pagination is bounded and videos.list keeps id mode without maxResults', async () => {
  const urls = [];
  const client = new YouTubeApiClient({
    apiKey: 'test-key',
    maxPages: 3,
    fetchImpl: async (url) => {
      urls.push(String(url));
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/playlistItems')) {
        const token = parsed.searchParams.get('pageToken');
        return {
          ok: true,
          status: 200,
          async json() {
            return token
              ? { items: [{ contentDetails: { videoId: 'v2' } }] }
              : { items: [{ contentDetails: { videoId: 'v1' } }], nextPageToken: 'next' };
          },
        };
      }
      return { ok: true, status: 200, async json() { return { items: [] }; } };
    },
  });
  assert.deepEqual(await client.listUploadVideoIds({ uploadsPlaylistId: 'UU_TEST' }), ['v1', 'v2']);
  await client.listVideos({ videoIds: ['v1', 'v2'] });
  const videosUrl = new URL(urls.find((value) => value.includes('/videos?')));
  assert.equal(videosUrl.searchParams.get('id'), 'v1,v2');
  assert.equal(videosUrl.searchParams.has('maxResults'), false);
});

test('quotaExceeded is permanent while canonical mapping preserves null unsupported metrics', async () => {
  const client = new YouTubeApiClient({
    apiKey: 'test-key',
    fetchImpl: async () => ({
      ok: false,
      status: 403,
      async json() {
        return { error: { code: 403, errors: [{ reason: 'quotaExceeded' }] } };
      },
    }),
  });
  await assert.rejects(
    () => client.getChannel({ channelId: 'UC_TEST' }),
    (error) => error.code === 'YOUTUBE_QUOTA_EXHAUSTED' && error.retryable === false,
  );

  const normalized = normalizeYouTubeVideo({
    accountId: 'channel_account',
    channelId: 'UC_TEST',
    metricDate: '2026-07-26',
    sourceTimezone: 'Asia/Bangkok',
    video: {
      id: 'v1',
      snippet: {
        channelId: 'UC_TEST',
        publishedAt: '2026-07-20T01:00:00Z',
        title: 'Example',
        description: '',
        thumbnails: {},
      },
      contentDetails: { duration: 'PT30S' },
      statistics: { viewCount: '10', likeCount: '2', commentCount: '1' },
      status: { privacyStatus: 'public' },
    },
  });
  assert.equal(normalized.content.content_key, 'youtube:channel_account:v1');
  assert.equal(normalized.dailySnapshot.shares, null);
  assert.equal(normalized.dailySnapshot.unique_viewers, null);
});

test('hidden subscriber count stays null instead of becoming observed zero', () => {
  const channel = mapYouTubeChannelResource({
    id: 'UC_TEST',
    snippet: { title: 'Hidden Channel' },
    contentDetails: { relatedPlaylists: { uploads: 'UU_TEST' } },
    statistics: {
      hiddenSubscriberCount: true,
      subscriberCount: '999',
      viewCount: '100',
      videoCount: '2',
    },
  }, 'UC_TEST');
  assert.equal(channel.subscriberCountHidden, true);
  assert.equal(channel.metrics.subscribers, null);
});
