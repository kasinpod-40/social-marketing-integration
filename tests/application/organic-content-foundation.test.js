import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeOrganicContentBatch } from '../../packages/application/src/use-cases/normalize-organic-content-batch.js';
import {
  analyzeOrganicDestinationConsistency,
  planOrganicContentDestination,
} from '../../packages/application/src/use-cases/plan-organic-content-destination.js';
import {
  assertYouTubeSyncReady,
  prepareYouTubeOrganicSync,
} from '../../packages/application/src/use-cases/prepare-youtube-organic-sync.js';

test('generic organic batch isolates invalid rows and deduplicates stable keys', () => {
  const result = normalizeOrganicContentBatch({
    rawRows: [{ id: 'a' }, { id: 'a' }, { id: null }],
    normalizeRow: (row) => {
      if (!row.id) throw new Error('missing id');
      return {
        identity: 'source-1',
        content: { content_key: `p:a:${row.id}`, external_content_id: row.id },
        dailySnapshot: { content_daily_key: `p:a:${row.id}:2026-07-15`, external_content_id: row.id },
      };
    },
    readSourceIdentity: (row) => row.identity,
  });
  assert.equal(result.contentRows.length, 1);
  assert.equal(result.duplicateContentRows, 1);
  assert.equal(result.skippedRows.length, 1);
  assert.deepEqual(result.sourceIdentities, ['source-1']);
});

test('generic destination reconciliation detects only the missing counterpart', () => {
  const result = analyzeOrganicDestinationConsistency(
    { createRows: [{ external_content_id: 'new-content' }] },
    { createRows: [] },
  );
  assert.equal(result.required, true);
  assert.deepEqual(result.missingContentIds, ['new-content']);
  assert.deepEqual(result.missingDailySnapshotIds, []);
});

test('generic destination planner prepares both canonical tables and returns reconciliation', async () => {
  const calls = [];
  const result = await planOrganicContentDestination({
    repository: repositoryStub(),
    syncEngine: {
      async planByKey(input) {
        calls.push({ tableId: input.tableId, keyField: input.keyField });
        return input.tableId === 'tblContent'
          ? plan([{ external_content_id: 'video-1' }])
          : plan([]);
      },
    },
    tables: { mktContent: 'tblContent', mktContentDaily: 'tblDaily' },
    contentRows: [{ content_key: 'youtube:a:video-1', external_content_id: 'video-1' }],
    dailySnapshotRows: [{
      content_daily_key: 'youtube:a:video-1:2026-07-15',
      external_content_id: 'video-1',
    }],
  });

  assert.deepEqual(calls, [
    { tableId: 'tblContent', keyField: 'content_key' },
    { tableId: 'tblDaily', keyField: 'content_daily_key' },
  ]);
  assert.equal(result.reconciliation.required, true);
  assert.deepEqual(result.reconciliation.missingContentIds, ['video-1']);
});

test('YouTube preparation stays read-only and fails closed on source identity mismatch', async () => {
  let plannerCallCount = 0;
  const result = await prepareYouTubeOrganicSync({
    channelId: 'channel-A',
    accountId: 'account-A',
    metricDate: '2026-07-15',
    channelResource: youtubeChannel('channel-A'),
    videoResources: [youtubeVideo('video-1', 'channel-B')],
    dictionaryRules: [],
    repository: repositoryStub(),
    syncEngine: {
      async planByKey() {
        plannerCallCount += 1;
        return plan([]);
      },
    },
    tables: { mktContent: 'tblContent', mktContentDaily: 'tblDaily' },
  });

  assert.equal(result.readyToWrite, false);
  assert.equal(result.plans, null);
  assert.equal(plannerCallCount, 0);
  assert.equal(result.normalized.skippedRows.length, 1);
  assert.throws(
    () => assertYouTubeSyncReady(result),
    (error) => error?.code === 'YOUTUBE_SYNC_NOT_READY' && error.retryable === false,
  );
});

function repositoryStub() {
  return {
    async prepareRows() { return []; },
    async createMany() { return 0; },
    async updateMany() { return 0; },
  };
}

function plan(createRows) {
  return Object.freeze({
    createRows: Object.freeze(createRows),
    updateRows: Object.freeze([]),
    unchangedRows: Object.freeze([]),
  });
}

function youtubeChannel(channelId) {
  return {
    id: channelId,
    snippet: { title: 'Test channel' },
    contentDetails: { relatedPlaylists: { uploads: 'uploads-1' } },
    statistics: { viewCount: '1', subscriberCount: '1', videoCount: '1' },
  };
}

function youtubeVideo(videoId, channelId) {
  return {
    id: videoId,
    snippet: {
      channelId,
      title: 'Test video',
      description: '',
      publishedAt: '2026-07-15T01:00:00Z',
    },
    contentDetails: { duration: 'PT10S' },
    statistics: { viewCount: '1', likeCount: '0', commentCount: '0' },
  };
}
