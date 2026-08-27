import test from 'node:test';
import assert from 'node:assert/strict';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { InMemoryResumableWorkStore } from '../../packages/sync-engine/src/in-memory-resumable-work-store.js';
import { syncYouTubeOrganicToLark as runYouTubeOrganicSync } from '../../packages/application/src/use-cases/sync-youtube-organic-to-lark.js';
import { YOUTUBE_ANALYTICS_COLUMNS } from '../../packages/connectors/src/youtube/youtube-raw.adapter.js';
import { transientError } from '../../packages/shared/src/errors/runtime-error.js';
import { runReliableSync } from '../../packages/reliability/src/reliable-sync-runner.js';
import { InMemoryLeaseLockManager } from '../../packages/reliability/src/in-memory-lease-lock-manager.js';

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

function syncYouTubeOrganicToLark(input) {
  return runYouTubeOrganicSync({
    customerKey: 'integration_workspace',
    historyGateway: { async listOrganicContentStatesByKeys() { return []; } },
    analyticsStore: { async listStableKeysByScope() { return []; } },
    ...input,
  });
}

test('writes only customer-facing canonical tables and checkpoints idempotently', async () => {
  const repository = createRepository();
  const stateStore = createStateStore();
  const resumableWorkStore = new InMemoryResumableWorkStore();
  const publicClient = {
    async getChannel() { return CHANNEL; },
    async listUploadVideoIdsPage() {
      return { videoIds: videos.map((video) => video.id), nextPageToken: null };
    },
    async listVideos() { return videos; },
  };
  const base = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    resumableWorkStore,
    publicClient,
    syncRunId: 'run-1', channelId: 'channel_A', accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin', cursorKey: 'youtube-lock', metricDate: '2026-07-15',
    reportingTimezone: 'Asia/Bangkok', syncMode: 'full', now: () => 1000,
    generation: 1000, requestedAt: 1000, tables: TABLES,
  };
  const first = await syncYouTubeOrganicToLark(base);
  assert.equal(Object.hasOwn(first.tables, 'rawChannels'), false);
  assert.equal(Object.hasOwn(first.tables, 'rawVideos'), false);
  assert.equal(first.tables.content.result.created, 2);
  assert.equal(first.tables.dailySnapshots.result.created, 2);
  assert.equal(first.tables.accounts.result.created, 1);
  assert.equal(first.checkpointSaved, true);
  assert.equal(repository.events.at(-1), 'write:accounts');
  assert.equal(stateStore.saved.length, 1);

  const second = await syncYouTubeOrganicToLark({
    ...base, syncRunId: 'run-2', syncEngine: new TableSyncEngine(),
    generation: 2000, requestedAt: 2000,
  });
  assert.equal(Object.hasOwn(second.tables, 'rawChannels'), false);
  assert.equal(Object.hasOwn(second.tables, 'rawVideos'), false);
  assert.equal(second.tables.content.result.skipped, 2);
  assert.equal(second.tables.dailySnapshots.result.skipped, 2);
  assert.equal(second.tables.accounts.result.skipped, 1);
});

test('stable Free-plan execution persists one source unit then resumes without duplicate writes', async () => {
  const repository = createRepository();
  const stateStore = createStateStore();
  const resumableWorkStore = new InMemoryResumableWorkStore();
  let uploadRequests = 0;
  let videoRequests = 0;
  const publicClient = {
    async getChannel() { return CHANNEL; },
    async listUploadVideoIdsPage() {
      uploadRequests += 1;
      return { videoIds: videos.map((video) => video.id), nextPageToken: null };
    },
    async listVideos() { videoRequests += 1; return videos; },
  };
  const input = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    resumableWorkStore,
    publicClient,
    syncRunId: 'run-free-1', channelId: 'channel_A', accountKey: 'youtube_dev',
    customerProfile: 'integration_workspace', cursorKey: 'youtube-lock-free',
    workKey: 'youtube:scheduled-20260715', metricDate: '2026-07-15',
    reportingTimezone: 'Asia/Bangkok', syncMode: 'full', now: () => 1000,
    generation: 1000, requestedAt: 1000, tables: TABLES,
    maxSourceUnitsPerInvocation: 1,
  };

  const first = await syncYouTubeOrganicToLark(input);
  assert.equal(first.continuationRequired, true);
  assert.equal(first.continuationPhase, 'youtube_content_resources');
  assert.equal(uploadRequests, 1);
  assert.equal(videoRequests, 0);
  assert.equal(repository.events.some((event) => event.startsWith('write:')), false);

  const second = await syncYouTubeOrganicToLark({ ...input, syncRunId: 'run-free-2' });
  assert.equal(second.checkpointSaved, true);
  assert.equal(uploadRequests, 1);
  assert.equal(videoRequests, 1);
  assert.equal(second.tables.content.result.created, 2);
  assert.equal(stateStore.saved.length, 1);
});

test('stable Free-plan execution checkpoints bounded destination rows before publishing account freshness', async () => {
  const repository = createRepository();
  const stateStore = createStateStore();
  const resumableWorkStore = new InMemoryResumableWorkStore();
  const input = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    resumableWorkStore,
    publicClient: {
      async getChannel() { return CHANNEL; },
      async listUploadVideoIdsPage() {
        return { videoIds: videos.map((video) => video.id), nextPageToken: null };
      },
      async listVideos() { return videos; },
    },
    syncRunId: 'run-destination-1', channelId: 'channel_A', accountKey: 'youtube_dev',
    customerProfile: 'integration_workspace', cursorKey: 'youtube-lock-destination',
    workKey: 'youtube:scheduled-destination-20260715', metricDate: '2026-07-15',
    reportingTimezone: 'Asia/Bangkok', syncMode: 'full', now: () => 1000,
    generation: 1000, requestedAt: 1000, tables: TABLES,
    maxDestinationRowsPerInvocation: 1,
  };

  const continuations = [];
  let result;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    result = await syncYouTubeOrganicToLark({ ...input, syncRunId: `run-destination-${attempt + 1}` });
    if (result.continuationRequired !== true) break;
    continuations.push(result.continuationPhase);
  }

  assert.equal(result.checkpointSaved, true);
  assert.deepEqual(continuations, [
    'youtube_destination_content_v1',
    'youtube_destination_content_v1',
    'youtube_destination_daily_v1',
    'youtube_destination_daily_v1',
  ]);
  assert.equal(result.tables.content.result.created, 2);
  assert.equal(result.tables.dailySnapshots.result.created, 2);
  assert.equal(result.tables.accounts.result.created, 1);
  assert.equal(repository.events.at(-1), 'write:accounts');
  assert.equal(stateStore.saved.length, 1);
});

test('destination unit sequences remain unique when the execution batch shrinks or grows mid-phase', async () => {
  const repository = createRepository();
  const resumableWorkStore = new InMemoryResumableWorkStore();
  const input = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: createStateStore(),
    resumableWorkStore,
    publicClient: {
      async getChannel() { return CHANNEL; },
      async listUploadVideoIdsPage() {
        return { videoIds: videos.map((video) => video.id), nextPageToken: null };
      },
      async listVideos() { return videos; },
    },
    syncRunId: 'run-destination-resize-1', channelId: 'channel_A', accountKey: 'youtube_dev',
    customerProfile: 'integration_workspace', cursorKey: 'youtube-lock-destination-resize',
    workKey: 'youtube:scheduled-destination-resize-20260715', metricDate: '2026-07-15',
    reportingTimezone: 'Asia/Bangkok', syncMode: 'full', now: () => 1000,
    generation: 1000, requestedAt: 1000, tables: TABLES,
    maxDestinationRowsPerInvocation: 1,
  };

  const first = await syncYouTubeOrganicToLark(input);
  assert.equal(first.continuationPhase, 'youtube_destination_content_v1');
  const second = await syncYouTubeOrganicToLark({
    ...input,
    syncRunId: 'run-destination-resize-2',
    maxDestinationRowsPerInvocation: 2,
  });
  assert.equal(second.continuationPhase, 'youtube_destination_content_v1');

  const staged = await resumableWorkStore.listPhaseUnits({
    workKey: input.workKey,
    phase: 'youtube_destination_content_v1',
    afterSequence: 0,
    limit: 10,
  });
  assert.deepEqual(staged.units.map((unit) => unit.sequence), [0, 1]);
});

test('stable Free-plan execution uses a smaller D1 batch before larger Lark destination batches', async () => {
  const repository = createRepository();
  const stateStore = createStateStore();
  const resumableWorkStore = new InMemoryResumableWorkStore();
  const tableEngine = new TableSyncEngine();
  const storageStarts = [];
  let canonicalCaptureCalls = 0;
  let canonicalRows;
  const syncEngine = {
    captureSourceRows() {},
    captureCanonicalRows(rows) { canonicalCaptureCalls += 1; canonicalRows = rows; },
    async executeStorage() { throw new Error('unbounded storage must not run'); },
    async executeStorageBatch({ startIndex, maxRows, contentTotals, preselected, expectedItems }) {
      storageStarts.push(startIndex);
      const totalRows = preselected ? expectedItems : canonicalRows.contentRows.length;
      const nextIndex = preselected
        ? startIndex + canonicalRows.contentRows.length
        : Math.min(totalRows, startIndex + maxRows);
      const content = {
        contentRows: nextIndex - startIndex,
        stateWritten: nextIndex - startIndex,
        stateSkipped: 0,
        observationsCreated: nextIndex - startIndex,
        observationsSkipped: 0,
        observationsNotRequired: 0,
        coverageEntitiesWritten: nextIndex - startIndex,
        coverageEntitiesSkipped: 0,
        classifications: [],
      };
      if (nextIndex < totalRows || preselected) {
        return { complete: false, nextIndex, expectedItems: totalRows, content };
      }
      return {
        complete: true,
        nextIndex,
        expectedItems: totalRows,
        storage: {
          status: 'complete',
          content: {
            ...content,
            contentRows: contentTotals.contentRows + content.contentRows,
            stateWritten: contentTotals.stateWritten + content.stateWritten,
            observationsCreated: contentTotals.observationsCreated + content.observationsCreated,
            coverageEntitiesWritten: contentTotals.coverageEntitiesWritten + content.coverageEntitiesWritten,
          },
        },
      };
    },
    resumeStorage() {},
    planByKey: (value) => tableEngine.planByKey(value),
    executePlan: (plan, options) => tableEngine.executePlan(plan, options),
  };
  const input = {
    repository, syncEngine, incrementalStateStore: stateStore, resumableWorkStore,
    publicClient: {
      async getChannel() { return CHANNEL; },
      async listUploadVideoIdsPage() {
        return { videoIds: videos.map((video) => video.id), nextPageToken: null };
      },
      async listVideos() { return videos; },
    },
    syncRunId: 'run-storage-1', channelId: 'channel_A', accountKey: 'youtube_dev',
    customerProfile: 'integration_workspace', cursorKey: 'youtube-lock-storage',
    workKey: 'youtube:scheduled-storage-20260715', metricDate: '2026-07-15',
    reportingTimezone: 'Asia/Bangkok', syncMode: 'full', now: () => 1000,
    generation: 1000, requestedAt: 1000, tables: TABLES,
    maxStorageRowsPerInvocation: 1,
    maxDestinationRowsPerInvocation: 1,
  };

  let result;
  let fastDestinationResumeProven = false;
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const capturesBefore = canonicalCaptureCalls;
    result = await syncYouTubeOrganicToLark({ ...input, syncRunId: `run-storage-${attempt + 1}` });
    const contentProgress = await resumableWorkStore.loadPhase({
      workKey: input.workKey,
      phase: 'youtube_destination_content_v1',
    });
    if (contentProgress?.complete && contentProgress.processedItems === videos.length
      && canonicalCaptureCalls === capturesBefore) {
      fastDestinationResumeProven = true;
    }
    if (result.continuationRequired !== true) break;
    if (storageStarts.length < 2) {
      assert.equal(repository.events.some((event) => event.startsWith('read:')), false);
    }
  }
  assert.equal(result.checkpointSaved, true);
  assert.deepEqual(storageStarts, [0, 1, 2]);
  assert.equal(result.tables.content.result.created, 2);
  assert.equal(fastDestinationResumeProven, true);
});

test('operator-style dry-run plans with Lark GET, writes no Business data and replays completed work', async () => {
  const repository = createRepository();
  const stateStore = createStateStore();
  const resumableWorkStore = new InMemoryResumableWorkStore();
  let providerRequests = 0;
  let completionDecorations = 0;
  const publicClient = {
    async getChannel() { providerRequests += 1; return CHANNEL; },
    async listUploadVideoIdsPage() {
      providerRequests += 1;
      return { videoIds: videos.map((video) => video.id), nextPageToken: null };
    },
    async listVideos() { providerRequests += 1; return videos; },
  };
  const input = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    resumableWorkStore,
    publicClient,
    ownerClient: null,
    syncRunId: 'youtube-dry-run:operation-a',
    channelId: 'channel_A',
    accountKey: 'youtube_dev',
    customerProfile: 'integration_workspace',
    cursorKey: 'youtube-lock',
    workKey: 'youtube:operation-a',
    metricDate: '2026-07-15',
    reportingTimezone: 'Asia/Bangkok',
    syncMode: 'full',
    analyticsEnabled: false,
    dryRun: true,
    now: () => 1000,
    generation: 1000,
    requestedAt: 1000,
    tables: TABLES,
    async decorateCompletion(completion) {
      completionDecorations += 1;
      return {
        ...completion,
        endToEnd: {
          contract: 'youtube-organic-end-to-end-v1',
          storage: { historySyncRunId: 'history:youtube:test' },
        },
      };
    },
  };
  const first = await syncYouTubeOrganicToLark(input);
  const providerRequestsAfterFirst = providerRequests;
  assert.equal(first.mode, 'dry_run');
  assert.equal(first.checkpointSaved, false);
  assert.equal(stateStore.saved.length, 0);
  assert.equal(repository.events.some((event) => event.startsWith('write:')), false);
  assert.ok(repository.events.some((event) => event.startsWith('read:')));
  assert.equal(first.endToEnd.storage.historySyncRunId, 'history:youtube:test');
  assert.equal(completionDecorations, 1);

  const replay = await syncYouTubeOrganicToLark({
    ...input,
    syncRunId: 'youtube-dry-run:operation-a',
    syncEngine: new TableSyncEngine(),
  });
  assert.equal(replay.mode, 'already_completed');
  assert.equal(replay.checkpointSaved, false);
  assert.deepEqual(replay.warnings, first.warnings);
  assert.deepEqual(replay.reconciliation, first.reconciliation);
  assert.deepEqual(replay.sourceSummary, first.sourceSummary);
  assert.equal(replay.warningOutbox, null);
  assert.equal(replay.endToEnd.storage.historySyncRunId, 'history:youtube:test');
  assert.equal(completionDecorations, 1);
  assert.equal(providerRequests, providerRequestsAfterFirst);
  assert.equal(stateStore.saved.length, 0);
  assert.equal(repository.events.some((event) => event.startsWith('write:')), false);
});

test('full reconciliation reads prior missing-video state from D1 without a RAW Lark write', async () => {
  const repository = createRepository();
  const stateStore = createStateStore({
    cursor: { lastFullSyncAt: 100, incrementalRunCount: 0 },
    recordStates: [{ sourceRecordId: 'video_gone', externalContentId: 'video_gone', sourceHash: 'old' }],
  });
  const result = await syncYouTubeOrganicToLark({
    repository, syncEngine: new TableSyncEngine(), incrementalStateStore: stateStore,
    resumableWorkStore: new InMemoryResumableWorkStore(),
    publicClient: {
      async getChannel() { return CHANNEL; },
      async listUploadVideoIdsPage() { return { videoIds: [], nextPageToken: null }; },
      async listVideos() { return []; },
    },
    syncRunId: 'run-missing', channelId: 'channel_A', accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin', cursorKey: 'youtube-lock', metricDate: '2026-07-15',
    historyGateway: {
      async listOrganicContentStatesByKeys() {
        return [{
          external_content_id: 'video_gone', source_availability_status: 'available',
          last_observed_at: 500, last_changed_at: 500, views: 99,
        }];
      },
    },
    syncMode: 'full', now: () => 2000, tables: TABLES,
  });
  assert.equal(result.sourceSummary.missingVideos, 1);
  assert.equal(repository.count('videos'), 0);
  assert.equal(Object.hasOwn(result.tables, 'rawVideos'), false);
  assert.equal(result.warnings[0].code, 'YOUTUBE_VIDEO_RECONCILIATION_REQUIRED');
  assert.deepEqual(result.reconciliation.missingVideoIds, ['video_gone']);
});

test('tracks an unavailable playlist identity without creating a RAW Lark row', async () => {
  const repository = createRepository();
  const result = await syncYouTubeOrganicToLark({
    repository, syncEngine: new TableSyncEngine(), incrementalStateStore: createStateStore(),
    resumableWorkStore: new InMemoryResumableWorkStore(),
    publicClient: {
      async getChannel() { return CHANNEL; },
      async listUploadVideoIdsPage() {
        return { videoIds: ['video_unavailable'], nextPageToken: null };
      },
      async listVideos() { return []; },
    },
    syncRunId: 'run-unavailable', channelId: 'channel_A', accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin', cursorKey: 'youtube-lock', metricDate: '2026-07-15',
    syncMode: 'full', now: () => 3000, tables: TABLES,
  });
  assert.equal(result.sourceSummary.missingVideos, 1);
  assert.equal(repository.count('videos'), 0);
  assert.equal(Object.hasOwn(result.tables, 'rawVideos'), false);
});

test('retains a previously observed Analytics key that disappears on re-fetch and warns once', async () => {
  const missingStableKey = 'youtube:channel_A:video_A:2026-07-14';
  const repository = createRepository();
  const analyticsRows = [
    ['2026-07-14', 'video_B', 11, 2, 1, 0, 5, 30, 50],
    ['2026-07-15', 'video_A', 12, 3, 1, 0, 6, 31, 51],
  ];
  const stateStore = createStateStore();
  const resumableWorkStore = new InMemoryResumableWorkStore();
  const input = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    resumableWorkStore,
    publicClient: {
      async getChannel() { return CHANNEL; },
      async listUploadVideoIdsPage() {
        return { videoIds: videos.map((video) => video.id), nextPageToken: null };
      },
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
    analyticsStore: {
      async listStableKeysByScope() { return [missingStableKey]; },
    },
    analyticsStartDate: '2026-07-14',
    analyticsEndDate: '2026-07-15',
    now: () => 4000,
    generation: 4000,
    requestedAt: 4000,
    tables: TABLES,
  };
  const result = await syncYouTubeOrganicToLark(input);

  assert.equal(repository.count('analytics'), 0);
  assert.equal(Object.hasOwn(result.tables, 'rawAnalytics'), false);
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
    generation: 5000,
    requestedAt: 5000,
  });
  assert.equal(Object.hasOwn(rerun.tables, 'rawAnalytics'), false);
  assert.deepEqual(rerun.reconciliation.missingAnalyticsStableKeys, [missingStableKey]);
  assert.equal(rerun.warnings[0].code, 'YOUTUBE_ANALYTICS_RECONCILIATION_REQUIRED');
});

test('incremental Content reads 100 recent videos while Analytics queries all 837 tracked videos', async () => {
  const allVideos = Array.from({ length: 837 }, (_, index) => ({
    id: `video_${String(index).padStart(3, '0')}`,
    snippet: {
      channelId: 'channel_A',
      title: `Tracked video ${index}`,
      description: 'Tracked lesson',
      publishedAt: '2026-07-01T00:00:00Z',
    },
    contentDetails: { duration: 'PT1M' },
    statistics: { viewCount: String(index + 1), likeCount: '2', commentCount: '1' },
    status: { privacyStatus: 'public' },
  }));
  const recentVideos = allVideos.slice(-100);
  const oldVideoId = allVideos[0].id;
  const missingStableKey = `youtube:channel_A:${oldVideoId}:2026-07-14`;
  const repository = createRepository({
    analytics: [{
      raw_analytics_daily_key: missingStableKey,
      source_metric_date: '2026-07-14',
      channel_id: 'channel_A',
      video_id: oldVideoId,
      views: 99,
      fetched_at: 500,
    }],
  });
  const stateStore = createStateStore({
    cursor: { lastFullSyncAt: 4_000, incrementalRunCount: 1 },
    recordStates: allVideos.map((video) => ({
      sourceRecordId: video.id,
      externalContentId: video.id,
      sourceHash: `hash:${video.id}`,
    })),
  });
  const uploadCalls = [];
  const analyticsCalls = [];
  const resumableWorkStore = new InMemoryResumableWorkStore();
  const publicClient = {
    async getChannel() {
      return {
        ...CHANNEL,
        statistics: { ...CHANNEL.statistics, videoCount: String(allVideos.length) },
      };
    },
    async listUploadVideoIdsPage(input) {
      uploadCalls.push(input);
      const offset = input.pageToken ? Number(input.pageToken) : 0;
      const pageIds = recentVideos.slice(offset, offset + 50).map((video) => video.id);
      const nextOffset = offset + pageIds.length;
      return {
        videoIds: pageIds,
        nextPageToken: nextOffset < recentVideos.length ? String(nextOffset) : null,
      };
    },
    async listVideos({ videoIds }) {
      const requested = new Set(videoIds);
      return recentVideos.filter((video) => requested.has(video.id));
    },
  };
  const ownerClient = {
    async getChannel() { return CHANNEL; },
    async queryAnalytics(input) {
      analyticsCalls.push(input);
      return {
        columnHeaders: YOUTUBE_ANALYTICS_COLUMNS.map((name) => ({ name })),
        rows: [],
      };
    },
  };
  const input = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    resumableWorkStore,
    publicClient,
    ownerClient,
    analyticsStore: {
      async listStableKeysByScope() { return [missingStableKey]; },
    },
    syncRunId: 'run-incremental-analytics',
    channelId: 'channel_A',
    accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin',
    cursorKey: 'youtube-lock',
    metricDate: '2026-07-15',
    syncMode: 'auto',
    recentVideoLimit: 100,
    analyticsEnabled: true,
    analyticsStartDate: '2026-07-14',
    analyticsEndDate: '2026-07-14',
    now: () => 5_000,
    generation: 5_000,
    requestedAt: 5_000,
    tables: TABLES,
  };

  const result = await syncYouTubeOrganicToLark(input);
  const queriedVideoIds = analyticsCalls.flatMap((call) => call.filters
    .replace(/^video==/u, '')
    .split(','));

  assert.equal(result.incremental.mode, 'incremental');
  assert.deepEqual(uploadCalls, [
    { uploadsPlaylistId: 'UU_A', pageToken: null },
    { uploadsPlaylistId: 'UU_A', pageToken: '50' },
  ]);
  assert.equal(result.sourceSummary.playlistVideoIds, 100);
  assert.equal(result.sourceSummary.contentInventoryPages, 2);
  assert.equal(result.sourceSummary.analyticsTrackedVideoIds, 837);
  assert.equal(result.sourceSummary.analyticsSelectedVideos, 837);
  assert.equal(result.sourceSummary.analyticsSuccessfullyQueriedVideos, 837);
  assert.equal(result.sourceSummary.analyticsFailedVideos, 0);
  assert.equal(result.sourceSummary.analyticsChunksProcessed, 17);
  assert.equal(result.sourceSummary.analyticsCompletenessStatus, 'complete');
  assert.equal(analyticsCalls.length, 17);
  assert.equal(new Set(queriedVideoIds).size, 837);
  assert.equal(queriedVideoIds.includes(oldVideoId), true);
  assert.deepEqual(result.reconciliation.missingAnalyticsStableKeys, [missingStableKey]);
  assert.equal(result.warnings[0].code, 'YOUTUBE_ANALYTICS_RECONCILIATION_REQUIRED');

  analyticsCalls.length = 0;
  const rerun = await syncYouTubeOrganicToLark({
    ...input,
    syncRunId: 'run-incremental-analytics-rerun',
    syncEngine: new TableSyncEngine(),
    generation: 5_001,
    requestedAt: 5_001,
  });
  assert.equal(rerun.sourceSummary.analyticsTrackedVideoIds, 837);
  assert.equal(analyticsCalls.length, 17);
  assert.deepEqual(rerun.reconciliation.missingAnalyticsStableKeys, [missingStableKey]);
});

test('initial Full backfill resumes playlist pagination and traverses all 837 videos without duplicates', async () => {
  const allVideos = createYoutubeVideos(837);
  const repository = createRepository();
  const stateStore = createStateStore();
  const resumableWorkStore = new InMemoryResumableWorkStore();
  const publicClient = createPagedPublicClient(allVideos, { failPageTokenOnce: '450' });
  const base = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    resumableWorkStore,
    publicClient,
    workKey: 'youtube-message-full-837',
    syncRunId: 'run-full-837-attempt-1',
    channelId: 'channel_A',
    accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin',
    cursorKey: 'youtube-lock',
    metricDate: '2026-07-15',
    syncMode: 'full',
    now: () => 6_000,
    generation: 6_000,
    requestedAt: 6_000,
    tables: TABLES,
  };

  await assert.rejects(
    syncYouTubeOrganicToLark(base),
    (error) => error?.code === 'YOUTUBE_TRANSIENT_API_ERROR' && error.retryable === true,
  );
  assert.equal(repository.count('content'), 0);
  const callsBeforeRetry = publicClient.uploadCalls.length;

  const result = await syncYouTubeOrganicToLark({
    ...base,
    syncRunId: 'run-full-837-attempt-2',
    syncEngine: new TableSyncEngine(),
  });

  assert.equal(publicClient.uploadCalls[callsBeforeRetry].pageToken, '450');
  assert.equal(result.sourceSummary.playlistVideoIds, 837);
  assert.equal(result.sourceSummary.contentInventoryPages, 17);
  assert.equal(result.sourceSummary.contentInventoryResumedPages, 9);
  assert.equal(result.sourceSummary.contentResourceChunks, 17);
  assert.equal(result.resumableWork.resumed, true);
  assert.equal(stateStore.saved.at(-1).records.length, 837);
  assert.equal(repository.count('videos'), 0);
  assert.equal(repository.count('content'), 837);
  assert.equal(repository.count('daily'), 837);

  const rerun = await syncYouTubeOrganicToLark({
    ...base,
    workKey: 'youtube-message-full-837-rerun',
    syncRunId: 'run-full-837-rerun',
    syncEngine: new TableSyncEngine(),
    generation: 6_001,
    requestedAt: 6_001,
  });
  assert.equal(Object.hasOwn(rerun.tables, 'rawVideos'), false);
  assert.equal(rerun.tables.content.result.created, 0);
  assert.equal(rerun.tables.dailySnapshots.result.created, 0);
  assert.equal(repository.count('videos'), 0);
  assert.equal(repository.count('content'), 837);
  assert.equal(repository.count('daily'), 837);
});

test('Analytics retry resumes at the failed chunk without writing RAW Lark rows', async () => {
  const allVideos = createYoutubeVideos(837);
  const recentVideos = allVideos.slice(-100);
  const repository = createRepository();
  const stateStore = createStateStore({
    cursor: { lastFullSyncAt: 6_000, incrementalRunCount: 1 },
    recordStates: allVideos.map((video) => ({
      sourceRecordId: video.id,
      externalContentId: video.id,
      sourceHash: `hash:${video.id}`,
    })),
  });
  const resumableWorkStore = new InMemoryResumableWorkStore();
  const publicClient = createPagedPublicClient(recentVideos);
  const successfulFilters = [];
  let analyticsCallCount = 0;
  let failOnce = true;
  const ownerClient = {
    async getChannel() { return CHANNEL; },
    async queryAnalytics(input) {
      analyticsCallCount += 1;
      if (failOnce && analyticsCallCount === 6) {
        failOnce = false;
        throw transientError('Synthetic Analytics chunk failure', {
          code: 'YOUTUBE_TRANSIENT_API_ERROR',
        });
      }
      const selectedIds = input.filters.replace(/^video==/u, '').split(',');
      successfulFilters.push(selectedIds);
      return {
        columnHeaders: YOUTUBE_ANALYTICS_COLUMNS.map((name) => ({ name })),
        rows: selectedIds.map((videoId) => [
          '2026-07-14', videoId, 1, 1, 1, 1, 1, 1, 1,
        ]),
      };
    },
  };
  const base = {
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    resumableWorkStore,
    publicClient,
    ownerClient,
    workKey: 'youtube-message-analytics-retry',
    syncRunId: 'run-analytics-attempt-1',
    channelId: 'channel_A',
    accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin',
    cursorKey: 'youtube-lock',
    metricDate: '2026-07-15',
    syncMode: 'auto',
    recentVideoLimit: 100,
    analyticsEnabled: true,
    analyticsStartDate: '2026-07-14',
    analyticsEndDate: '2026-07-14',
    now: () => 7_000,
    generation: 7_000,
    requestedAt: 7_000,
    tables: TABLES,
  };

  await assert.rejects(
    syncYouTubeOrganicToLark(base),
    (error) => error?.code === 'YOUTUBE_TRANSIENT_API_ERROR'
      && error.details.analyticsCompleteness.totalTrackedVideos === 837
      && error.details.analyticsCompleteness.successfullyQueriedVideos === 250
      && error.details.analyticsCompleteness.failedVideos === 587,
  );
  assert.equal(repository.count('analytics'), 0);
  const uploadCallsBeforeRetry = publicClient.uploadCalls.length;
  const videoCallsBeforeRetry = publicClient.videoCalls.length;

  const resumed = await syncYouTubeOrganicToLark({
    ...base,
    syncRunId: 'run-analytics-attempt-2',
    syncEngine: new TableSyncEngine(),
  });
  assert.equal(resumed.continuationRequired, true);
  assert.equal(resumed.continuationPhase, 'youtube_owner_analytics');
  assert.equal(publicClient.uploadCalls.length, uploadCallsBeforeRetry);
  assert.equal(publicClient.videoCalls.length, videoCallsBeforeRetry);
  assert.equal(analyticsCallCount, 18);
  assert.equal(new Set(successfulFilters.flat()).size, 837);
  assert.equal(successfulFilters.flat().length, 837);

  const recovered = await syncYouTubeOrganicToLark({
    ...base,
    syncRunId: 'run-analytics-attempt-3',
    syncEngine: new TableSyncEngine(),
  });
  assert.equal(publicClient.uploadCalls.length, uploadCallsBeforeRetry);
  assert.equal(publicClient.videoCalls.length, videoCallsBeforeRetry);
  assert.equal(analyticsCallCount, 18);
  assert.equal(recovered.sourceSummary.analyticsSuccessfullyQueriedVideos, 837);
  assert.equal(recovered.sourceSummary.analyticsChunksProcessed, 17);
  assert.equal(recovered.sourceSummary.analyticsCompletenessStatus, 'complete');
  assert.equal(Object.hasOwn(recovered.tables, 'rawAnalytics'), false);
  assert.equal(repository.count('analytics'), 0);

  const rerun = await syncYouTubeOrganicToLark({
    ...base,
    workKey: 'youtube-message-analytics-rerun',
    syncRunId: 'run-analytics-rerun',
    syncEngine: new TableSyncEngine(),
    generation: 7_001,
    requestedAt: 7_001,
  });
  assert.equal(Object.hasOwn(rerun.tables, 'rawAnalytics'), false);
  assert.equal(repository.count('analytics'), 0);
});

test('Analytics completeness guard detects a missing queried-video marker before Lark writes', async () => {
  const allVideos = createYoutubeVideos(101);
  const repository = createRepository();
  const stateStore = createStateStore({
    cursor: { lastFullSyncAt: 7_000, incrementalRunCount: 1 },
    recordStates: allVideos.map((video) => ({
      sourceRecordId: video.id,
      externalContentId: video.id,
      sourceHash: `hash:${video.id}`,
    })),
  });
  const baseWorkStore = new InMemoryResumableWorkStore();
  const corruptingWorkStore = createCorruptingAnalyticsScopeStore(baseWorkStore);
  const publicClient = createPagedPublicClient(allVideos.slice(-100));
  const ownerClient = {
    async getChannel() { return CHANNEL; },
    async queryAnalytics() {
      return {
        columnHeaders: YOUTUBE_ANALYTICS_COLUMNS.map((name) => ({ name })),
        rows: [],
      };
    },
  };

  await assert.rejects(
    syncYouTubeOrganicToLark({
      repository,
      syncEngine: new TableSyncEngine(),
      incrementalStateStore: stateStore,
      resumableWorkStore: corruptingWorkStore,
      publicClient,
      ownerClient,
      workKey: 'youtube-message-scope-corruption',
      syncRunId: 'run-scope-corruption',
      channelId: 'channel_A',
      accountKey: 'youtube_dev',
      customerProfile: 'dev_ft_pumkin',
      cursorKey: 'youtube-lock',
      metricDate: '2026-07-15',
      syncMode: 'auto',
      recentVideoLimit: 100,
      analyticsEnabled: true,
      analyticsStartDate: '2026-07-14',
      analyticsEndDate: '2026-07-14',
      now: () => 8_000,
      tables: TABLES,
    }),
    (error) => error?.code === 'YOUTUBE_ANALYTICS_SCOPE_INCOMPLETE'
      && error.retryable === true
      && error.details.missingVideoCount === 1
      && error.details.analyticsCompleteness.totalTrackedVideos === 101,
  );
  assert.equal(repository.count('channels'), 0);
  assert.equal(repository.count('analytics'), 0);
  assert.deepEqual(baseWorkStore.resetEvents.map((event) => event.phase), ['youtube_owner_analytics']);
});

test('stale retry is superseded after a newer generation commits and cannot roll back Lark or checkpoint data', async () => {
  const repository = createRepository();
  const stateStore = createStateStore();
  const originalSaveCheckpoint = stateStore.saveCheckpoint.bind(stateStore);
  let failOldCheckpointOnce = true;
  stateStore.saveCheckpoint = async (value) => {
    if (failOldCheckpointOnce && value.cursor.lastSyncRunId === 'run-old-attempt-1') {
      failOldCheckpointOnce = false;
      throw transientError('Synthetic old-generation checkpoint failure', {
        code: 'D1_INCREMENTAL_CHECKPOINT_WRITE_FAILED',
      });
    }
    return originalSaveCheckpoint(value);
  };
  const resumableWorkStore = new InMemoryResumableWorkStore();
  const videoAt = (views) => [{
    ...videos[0],
    statistics: { ...videos[0].statistics, viewCount: String(views) },
  }];
  const clientAt = (views, onCall = () => undefined) => ({
    async getChannel() { onCall(); return CHANNEL; },
    async listUploadVideoIdsPage() {
      onCall();
      return { videoIds: ['video_A'], nextPageToken: null };
    },
    async listVideos() { onCall(); return videoAt(views); },
  });
  const common = {
    repository,
    incrementalStateStore: stateStore,
    resumableWorkStore,
    channelId: 'channel_A',
    accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin',
    cursorKey: 'youtube-lock',
    metricDate: '2026-07-15',
    syncMode: 'full',
    tables: TABLES,
  };

  await assert.rejects(
    syncYouTubeOrganicToLark({
      ...common,
      syncEngine: new TableSyncEngine(),
      publicClient: clientAt(100),
      workKey: 'youtube:message-old',
      syncRunId: 'run-old-attempt-1',
      generation: 1_000,
      requestedAt: 1_000,
      now: () => 1_000,
    }),
    (error) => error?.code === 'D1_INCREMENTAL_CHECKPOINT_WRITE_FAILED',
  );

  await syncYouTubeOrganicToLark({
    ...common,
    syncEngine: new TableSyncEngine(),
    publicClient: clientAt(200),
    workKey: 'youtube:message-new',
    syncRunId: 'run-new',
    generation: 2_000,
    requestedAt: 2_000,
    now: () => 2_000,
  });

  let staleSourceCalls = 0;
  const staleRetry = await syncYouTubeOrganicToLark({
    ...common,
    syncEngine: new TableSyncEngine(),
    publicClient: clientAt(100, () => { staleSourceCalls += 1; }),
    workKey: 'youtube:message-old',
    syncRunId: 'run-old-attempt-2',
    generation: 1_000,
    requestedAt: 1_000,
    now: () => 3_000,
  });

  assert.equal(staleRetry.mode, 'superseded');
  assert.equal(staleSourceCalls, 0);
  assert.equal(repository.read('content', 'content_key', 'youtube:youtube_dev:video_A').fields.latest_views, 200);
  assert.equal(stateStore.checkpoint.cursor.lastSyncRunId, 'run-new');
});

test('Analytics rows outside requested video or date scope fail closed before staging or Lark writes', async () => {
  const cases = [
    {
      name: 'video',
      row: ['2026-07-14', 'video_OUTSIDE', 1, 1, 1, 1, 1, 1, 1],
    },
    {
      name: 'date',
      row: ['2026-07-13', 'video_A', 1, 1, 1, 1, 1, 1, 1],
    },
  ];

  for (const scenario of cases) {
    const repository = createRepository();
    const stateStore = createStateStore();
    await assert.rejects(
      syncYouTubeOrganicToLark({
        repository,
        syncEngine: new TableSyncEngine(),
        incrementalStateStore: stateStore,
        resumableWorkStore: new InMemoryResumableWorkStore(),
        publicClient: createPagedPublicClient([videos[0]]),
        ownerClient: {
          async getChannel() { return CHANNEL; },
          async queryAnalytics() {
            return {
              columnHeaders: YOUTUBE_ANALYTICS_COLUMNS.map((name) => ({ name })),
              rows: [scenario.row],
            };
          },
        },
        workKey: `youtube:scope-${scenario.name}`,
        syncRunId: `run-scope-${scenario.name}`,
        channelId: 'channel_A',
        accountKey: 'youtube_dev',
        customerProfile: 'dev_ft_pumkin',
        cursorKey: 'youtube-lock',
        metricDate: '2026-07-15',
        syncMode: 'full',
        analyticsEnabled: true,
        analyticsStartDate: '2026-07-14',
        analyticsEndDate: '2026-07-14',
        now: () => 9_000,
        tables: TABLES,
      }),
      (error) => error?.code === 'YOUTUBE_ANALYTICS_ROW_SCOPE_MISMATCH'
        && error.retryable === false
        && error.details?.reason === scenario.name,
    );
    assert.equal(repository.count('analytics'), 0);
    assert.equal(stateStore.saved.length, 0);
  }
});

test('warning outbox survives alert persistence failure and retry delivers one business warning without rerunning Source', async () => {
  const repository = createRepository({
    videos: [{
      raw_video_key: 'youtube:channel_A:video_gone',
      channel_id: 'channel_A',
      video_id: 'video_gone',
      view_count: 99,
      source_availability_status: 'available',
      fetched_at: 500,
    }],
  });
  const stateStore = createStateStore({
    cursor: null,
    recordStates: [{
      sourceRecordId: 'video_gone',
      externalContentId: 'video_gone',
      sourceHash: 'old',
    }],
  });
  const resumableWorkStore = new InMemoryResumableWorkStore();
  let sourceCalls = 0;
  const publicClient = {
    async getChannel() { sourceCalls += 1; return CHANNEL; },
    async listUploadVideoIdsPage() { return { videoIds: [], nextPageToken: null }; },
    async listVideos() { return []; },
  };
  let failWarningAlertOnce = true;
  const alerts = [];
  const store = {
    async saveSyncRun() { return true; },
    async saveSystemAlert(alert) {
      if (failWarningAlertOnce && alert.alertType === 'sync_completed_with_warnings') {
        failWarningAlertOnce = false;
        throw transientError('Synthetic alert store failure', {
          code: 'D1_SYSTEM_ALERT_WRITE_FAILED',
        });
      }
      alerts.push(alert);
      return true;
    },
  };
  const execute = ({ syncRunId, assertLockActive }) => syncYouTubeOrganicToLark({
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    resumableWorkStore,
    publicClient,
    syncRunId,
    assertLockActive,
    workKey: 'youtube:warning-message',
    generation: 10_000,
    requestedAt: 10_000,
    channelId: 'channel_A',
    accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin',
    cursorKey: 'youtube-lock',
    metricDate: '2026-07-15',
    syncMode: 'auto',
    now: () => 10_000,
    tables: TABLES,
  });
  const run = (syncRunId) => runReliableSync({
    store,
    lockManager: new InMemoryLeaseLockManager(),
    warningOutboxStore: resumableWorkStore,
    syncRunId,
    customerProfile: 'dev_ft_pumkin',
    accountKey: 'youtube_dev',
    platform: 'youtube',
    source: 'youtube_data_api',
    syncType: 'organic_sync',
    leaseMs: 60_000,
    alertOnResultWarnings: true,
    execute,
  });

  await assert.rejects(
    run('run-warning-attempt-1'),
    (error) => error?.code === 'D1_SYSTEM_ALERT_WRITE_FAILED' && error.retryable === true,
  );
  await run('run-warning-attempt-2');

  assert.equal(sourceCalls, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alertType, 'sync_completed_with_warnings');
  assert.equal(new Set(alerts.map((alert) => alert.alertId)).size, 1);
});



test('old completed warning replays after a newer generation claims the cursor', async () => {
  const repository = createRepository({
    videos: [{
      raw_video_key: 'youtube:channel_A:video_gone',
      channel_id: 'channel_A',
      video_id: 'video_gone',
      view_count: 99,
      source_availability_status: 'available',
      fetched_at: 500,
    }],
  });
  const stateStore = createStateStore({
    cursor: null,
    recordStates: [{
      sourceRecordId: 'video_gone',
      externalContentId: 'video_gone',
      sourceHash: 'old',
    }],
  });
  const resumableWorkStore = new InMemoryResumableWorkStore();
  let sourceCalls = 0;
  const publicClient = {
    async getChannel() { sourceCalls += 1; return CHANNEL; },
    async listUploadVideoIdsPage() { return { videoIds: [], nextPageToken: null }; },
    async listVideos() { return []; },
  };
  let failOnce = true;
  const alerts = [];
  const reliabilityStore = {
    async saveSyncRun() { return true; },
    async saveSystemAlert(alert) {
      if (failOnce && alert.alertType === 'sync_completed_with_warnings') {
        failOnce = false;
        throw transientError('Synthetic alert failure', {
          code: 'D1_SYSTEM_ALERT_WRITE_FAILED',
        });
      }
      alerts.push(alert);
      return true;
    },
  };
  const executeOld = ({ syncRunId, assertLockActive }) => syncYouTubeOrganicToLark({
    repository,
    syncEngine: new TableSyncEngine(),
    incrementalStateStore: stateStore,
    resumableWorkStore,
    publicClient,
    syncRunId,
    assertLockActive,
    workKey: 'youtube:warning-old',
    generation: 10_000,
    requestedAt: 10_000,
    channelId: 'channel_A',
    accountKey: 'youtube_dev',
    customerProfile: 'dev_ft_pumkin',
    cursorKey: 'youtube-lock',
    metricDate: '2026-07-15',
    syncMode: 'auto',
    now: () => 10_000,
    tables: TABLES,
  });
  const runOld = (syncRunId) => runReliableSync({
    store: reliabilityStore,
    lockManager: new InMemoryLeaseLockManager(),
    warningOutboxStore: resumableWorkStore,
    syncRunId,
    customerProfile: 'dev_ft_pumkin',
    accountKey: 'youtube_dev',
    platform: 'youtube',
    source: 'youtube_data_api',
    syncType: 'organic_sync',
    leaseMs: 60_000,
    alertOnResultWarnings: true,
    execute: executeOld,
  });

  await assert.rejects(
    runOld('run-warning-old-1'),
    (error) => error?.code === 'D1_SYSTEM_ALERT_WRITE_FAILED',
  );

  const newer = await resumableWorkStore.beginWork({
    workKey: 'youtube:newer-message',
    cursorKey: 'youtube-lock',
    workType: 'youtube_organic_sync',
    operationFingerprint: 'newer-operation',
    generation: 20_000,
    requestedAt: 20_000,
  });
  assert.equal(newer.superseded, false);
  await resumableWorkStore.completeWork({
    workKey: 'youtube:newer-message',
    completion: { mode: 'write', warnings: [] },
  });

  await runOld('run-warning-old-2');

  assert.equal(sourceCalls, 1);
  assert.equal(alerts.length, 1);
  assert.equal(alerts[0].alertType, 'sync_completed_with_warnings');
  assert.equal(new Set(alerts.map((alert) => alert.alertId)).size, 1);
  assert.equal((await resumableWorkStore.listPendingWarnings({ limit: 25 })).length, 0);
});

function createStateStore(checkpoint = null) {
  return {
    checkpoint,
    saved: [],
    async loadCheckpoint() { return this.checkpoint; },
    async saveCheckpoint(value) {
      this.saved.push(value);
      const recordStatesById = new Map((value.fullSnapshot
        ? []
        : (this.checkpoint?.recordStates ?? []))
        .map((record) => [record.sourceRecordId, record]));
      for (const record of value.records) {
        recordStatesById.set(record.sourceRecordId, {
          ...record,
          lastSeenAt: value.cursor.lastSuccessfulSyncAt,
        });
      }
      this.checkpoint = {
        cursor: value.cursor,
        recordStates: [...recordStatesById.values()],
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
      api.events.push(`read:${tableId}`);
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
    count(tableId) {
      return (stores.get(tableId) ?? []).length;
    },
  };
  return api;
}

function createYoutubeVideos(count) {
  return Array.from({ length: count }, (_, index) => ({
    id: `video_${String(index).padStart(4, '0')}`,
    snippet: {
      channelId: 'channel_A',
      title: `Tracked video ${index}`,
      description: 'Tracked lesson',
      publishedAt: '2026-07-01T00:00:00Z',
    },
    contentDetails: { duration: 'PT1M' },
    statistics: { viewCount: String(index + 1), likeCount: '2', commentCount: '1' },
    status: { privacyStatus: 'public' },
  }));
}

function createPagedPublicClient(allVideos, options = {}) {
  const byId = new Map(allVideos.map((video) => [video.id, video]));
  let failed = false;
  return {
    uploadCalls: [],
    videoCalls: [],
    async getChannel() {
      return {
        ...CHANNEL,
        statistics: { ...CHANNEL.statistics, videoCount: String(allVideos.length) },
      };
    },
    async listUploadVideoIdsPage(input) {
      this.uploadCalls.push({ ...input });
      if (!failed && options.failPageTokenOnce === String(input.pageToken)) {
        failed = true;
        throw transientError('Synthetic playlist page failure', {
          code: 'YOUTUBE_TRANSIENT_API_ERROR',
        });
      }
      const offset = input.pageToken ? Number(input.pageToken) : 0;
      const videoIds = allVideos.slice(offset, offset + 50).map((video) => video.id);
      const nextOffset = offset + videoIds.length;
      return {
        videoIds,
        nextPageToken: nextOffset < allVideos.length ? String(nextOffset) : null,
      };
    },
    async listVideos({ videoIds }) {
      this.videoCalls.push([...videoIds]);
      return videoIds.map((videoId) => byId.get(videoId)).filter(Boolean);
    },
  };
}

function createCorruptingAnalyticsScopeStore(base) {
  let corrupted = false;
  return {
    beginWork: (...args) => base.beginWork(...args),
    assertCurrentGeneration: (...args) => base.assertCurrentGeneration(...args),
    loadPhase: (...args) => base.loadPhase(...args),
    savePhase: (...args) => base.savePhase(...args),
    resetPhase: (...args) => base.resetPhase(...args),
    saveWarningOutbox: (...args) => base.saveWarningOutbox(...args),
    listPendingWarnings: (...args) => base.listPendingWarnings(...args),
    cleanupExpiredWork: (...args) => base.cleanupExpiredWork(...args),
    completeWork: (...args) => base.completeWork(...args),
    async listPhaseUnits(input) {
      const result = await base.listPhaseUnits(input);
      if (corrupted || input.phase !== 'youtube_owner_analytics') return result;
      const units = result.units.map((unit) => structuredClone(unit));
      const target = units.find((unit) => unit.payload.queriedVideoIds?.length > 0);
      if (!target) return result;
      target.payload.queriedVideoIds = target.payload.queriedVideoIds.slice(1);
      corrupted = true;
      return Object.freeze({ ...result, units: Object.freeze(units) });
    },
  };
}
