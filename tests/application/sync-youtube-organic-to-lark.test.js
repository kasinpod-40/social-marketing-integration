import test from 'node:test';
import assert from 'node:assert/strict';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { syncYouTubeOrganicToLark } from '../../packages/application/src/use-cases/sync-youtube-organic-to-lark.js';
import { YOUTUBE_ANALYTICS_COLUMNS } from '../../packages/connectors/src/youtube/youtube-raw.adapter.js';

const TABLES = Object.freeze({
  mktAccounts: 'accounts', rawYouTubeChannels: 'channels', rawYouTubeVideos: 'videos',
  rawYouTubeAnalyticsDaily: 'analytics', mktContent: 'content', mktContentDaily: 'daily',
});
const CHANNEL = Object.freeze({
  id: 'channel_A', snippet: { title: 'Channel A' },
  contentDetails: { relatedPlaylists: { uploads: 'UU_A' } },
  statistics: { viewCount: '100', subscriberCount: '20', videoCount: '2' },
});
const videos = ['A', 'B'].map((suffix, index) => ({
  id: `video_${suffix}`,
  snippet: {
    channelId: 'channel_A', title: `Video ${suffix}`, description: 'Lesson',
    publishedAt: `2026-07-${String(13 + index).padStart(2, '0')}T00:00:00Z`,
  },
  contentDetails: { duration: 'PT1M' },
  statistics: { viewCount: String(10 + index), likeCount: '2', commentCount: '1' },
  status: { privacyStatus: 'public' },
}));

test('writes RAW, canonical, account-last and checkpoint idempotently', async () => {
  const repository = createRepository();
  const stateStore = createStateStore();
  const publicClient = {
    async getChannel() { return CHANNEL; },
    async listUploadVideoIds() { return videos.map((video) => video.id); },
    async listVideos() { return videos; },
  };
  const base = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    publicClient,
    syncRunId: 'run-1', channelId: 'channel_A', accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin', cursorKey: 'youtube-lock', metricDate: '2026-07-15',
    reportingTimezone: 'Asia/Bangkok', syncMode: 'full', now: () => 1000, tables: TABLES,
  };
  const first = await syncYouTubeOrganicToLark(base);
  assert.equal(first.tables.rawChannels.result.created, 1);
  assert.equal(first.tables.rawVideos.result.created, 2);
  assert.equal(first.tables.content.result.created, 2);
  assert.equal(first.tables.dailySnapshots.result.created, 2);
  assert.equal(first.tables.accounts.result.created, 1);
  assert.equal(first.checkpointSaved, true);
  assert.equal(repository.events.at(-1), 'write:accounts');
  assert.equal(stateStore.saved.length, 1);

  const second = await syncYouTubeOrganicToLark({
    ...base, syncRunId: 'run-2', syncEngine: new TableSyncEngine(),
  });
  assert.equal(second.tables.rawChannels.result.skipped, 1);
  assert.equal(second.tables.rawVideos.result.skipped, 2);
  assert.equal(second.tables.content.result.skipped, 2);
  assert.equal(second.tables.dailySnapshots.result.skipped, 2);
  assert.equal(second.tables.accounts.result.skipped, 1);
});

test('full reconciliation marks prior missing videos without zeroing prior metrics', async () => {
  const repository = createRepository({
    videos: [{
      raw_video_key: 'youtube:channel_A:video_gone', channel_id: 'channel_A', video_id: 'video_gone',
      view_count: 99, source_availability_status: 'available', fetched_at: 500,
    }],
  });
  const stateStore = createStateStore({
    cursor: { lastFullSyncAt: 100, incrementalRunCount: 0 },
    recordStates: [{ sourceRecordId: 'video_gone', externalContentId: 'video_gone', sourceHash: 'old' }],
  });
  const result = await syncYouTubeOrganicToLark({
    repository, syncEngine: new TableSyncEngine(), incrementalStateStore: stateStore,
    publicClient: {
      async getChannel() { return CHANNEL; },
      async listUploadVideoIds() { return []; },
      async listVideos() { return []; },
    },
    syncRunId: 'run-missing', channelId: 'channel_A', accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin', cursorKey: 'youtube-lock', metricDate: '2026-07-15',
    syncMode: 'full', now: () => 2000, tables: TABLES,
  });
  assert.equal(result.sourceSummary.missingVideos, 1);
  const record = repository.read('videos', 'raw_video_key', 'youtube:channel_A:video_gone');
  assert.equal(record.fields.source_availability_status, 'missing');
  assert.equal(record.fields.view_count, 99);
  assert.equal(record.fields.channel_id, 'channel_A');
  assert.equal(record.fields.video_id, 'video_gone');
  assert.equal(result.warnings[0].code, 'YOUTUBE_VIDEO_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.reconciliation.missingVideoIds, ['video_gone']);
});

test('creates a complete reconciliation RAW row when playlist id has no videos.list resource', async () => {
  const repository = createRepository();
  const result = await syncYouTubeOrganicToLark({
    repository, syncEngine: new TableSyncEngine(), incrementalStateStore: createStateStore(),
    publicClient: {
      async getChannel() { return CHANNEL; },
      async listUploadVideoIds() { return ['video_unavailable']; },
      async listVideos() { return []; },
    },
    syncRunId: 'run-unavailable', channelId: 'channel_A', accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin', cursorKey: 'youtube-lock', metricDate: '2026-07-15',
    syncMode: 'full', now: () => 3000, tables: TABLES,
  });
  const record = repository.read('videos', 'raw_video_key', 'youtube:channel_A:video_unavailable');
  assert.equal(result.tables.rawVideos.result.created, 1);
  assert.equal(record.fields.channel_id, 'channel_A');
  assert.equal(record.fields.video_id, 'video_unavailable');
  assert.equal(record.fields.last_seen_at, 3000);
  assert.equal(record.fields.missing_since, 3000);
  assert.equal(record.fields.source_availability_status, 'missing');
  assert.equal(Object.hasOwn(record.fields, 'view_count'), false);
});

test('retains a previously observed Analytics key that disappears on re-fetch and warns once', async () => {
  const missingStableKey = 'youtube:channel_A:video_A:2026-07-14';
  const repository = createRepository({
    analytics: [
      {
        raw_analytics_daily_key: missingStableKey,
        source_metric_date: '2026-07-14', channel_id: 'channel_A', video_id: 'video_A',
        views: 99, fetched_at: 500,
      },
      {
        raw_analytics_daily_key: 'youtube:channel_A:video_A:2026-07-13',
        source_metric_date: '2026-07-13', channel_id: 'channel_A', video_id: 'video_A', views: 88,
      },
      {
        raw_analytics_daily_key: 'youtube:other_channel:video_A:2026-07-14',
        source_metric_date: '2026-07-14', channel_id: 'other_channel', video_id: 'video_A', views: 77,
      },
      {
        raw_analytics_daily_key: 'youtube:channel_A:video_unqueried:2026-07-14',
        source_metric_date: '2026-07-14', channel_id: 'channel_A', video_id: 'video_unqueried', views: 66,
      },
    ],
  });
  const analyticsRows = [
    ['2026-07-14', 'video_B', 11, 2, 1, 0, 5, 30, 50],
    ['2026-07-15', 'video_A', 12, 3, 1, 0, 6, 31, 51],
  ];
  const stateStore = createStateStore();
  const input = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    publicClient: {
      async getChannel() { return CHANNEL; },
      async listUploadVideoIds() { return videos.map((video) => video.id); },
      async listVideos() { return videos; },
    },
    ownerClient: {
      async getChannel() { return CHANNEL; },
      async queryAnalytics() {
        return {
          columnHeaders: YOUTUBE_ANALYTICS_COLUMNS.map((name) => ({ name })),
          rows: analyticsRows,
        };
      },
    },
    syncRunId: 'run-analytics-reconciliation',
    channelId: 'channel_A',
    accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin',
    cursorKey: 'youtube-lock',
    metricDate: '2026-07-15',
    syncMode: 'full',
    analyticsEnabled: true,
    analyticsStartDate: '2026-07-14',
    analyticsEndDate: '2026-07-15',
    now: () => 4000,
    tables: TABLES,
  };
  const result = await syncYouTubeOrganicToLark(input);

  const retained = repository.read('analytics', 'raw_analytics_daily_key', missingStableKey);
  assert.equal(retained.fields.views, 99);
  assert.equal(retained.fields.fetched_at, 500);
  assert.equal(result.tables.rawAnalytics.result.created, 2);
  assert.equal(result.sourceSummary.missingAnalyticsRows, 1);
  assert.deepEqual(result.reconciliation.missingAnalyticsStableKeys, [missingStableKey]);
  assert.equal(result.reconciliation.analytics.previouslyObservedStableKeys, 1);
  assert.equal(result.reconciliation.analytics.observedStableKeys, 2);
  assert.deepEqual(
    result.warnings.map((warning) => warning.code),
    ['YOUTUBE_ANALYTICS_RECONCILIATION_REQUIRED'],
  );
  assert.equal(result.warnings[0].missingCount, 1);

  const rerun = await syncYouTubeOrganicToLark({
    ...input,
    syncRunId: 'run-analytics-reconciliation-rerun',
    syncEngine: new TableSyncEngine(),
  });
  assert.equal(rerun.tables.rawAnalytics.result.skipped, 2);
  assert.deepEqual(rerun.reconciliation.missingAnalyticsStableKeys, [missingStableKey]);
  assert.equal(rerun.warnings[0].code, 'YOUTUBE_ANALYTICS_RECONCILIATION_REQUIRED');
});

function createStateStore(checkpoint = null) {
  return {
    checkpoint,
    saved: [],
    async loadCheckpoint() { return this.checkpoint; },
    async saveCheckpoint(value) {
      this.saved.push(value);
      this.checkpoint = {
        cursor: value.cursor,
        recordStates: value.records.map((record) => ({ ...record, lastSeenAt: value.cursor.lastSuccessfulSyncAt })),
      };
    },
  };
}

function createRepository(seed = {}) {
  const stores = new Map();
  let sequence = 0;
  for (const [tableId, rows] of Object.entries(seed)) {
    stores.set(tableId, rows.map((fields) => ({ recordId: `seed-${++sequence}`, fields: { ...fields } })));
  }
  const api = {
    events: [],
    async prepareRows(_tableId, rows) { return rows.map((row) => ({ ...row })); },
    async prepareExistingRecords(_tableId, records) { return records; },
    async listByFieldValues(tableId, fieldName, values) {
      const allowed = new Set(values.map(String));
      return (stores.get(tableId) ?? []).filter((record) => allowed.has(String(record.fields[fieldName])));
    },
    async createMany(tableId, rows) {
      api.events.push(`write:${tableId}`);
      const target = stores.get(tableId) ?? [];
      for (const fields of rows) target.push({ recordId: `record-${++sequence}`, fields: { ...fields } });
      stores.set(tableId, target);
      return { created: rows.length };
    },
    async updateMany(tableId, records) {
      api.events.push(`write:${tableId}`);
      const target = stores.get(tableId) ?? [];
      for (const update of records) {
        const existing = target.find((record) => record.recordId === update.recordId);
        Object.assign(existing.fields, update.fields);
      }
      return { updated: records.length };
    },
    read(tableId, fieldName, value) {
      return (stores.get(tableId) ?? []).find((record) => record.fields[fieldName] === value);
    },
  };
  return api;
}
