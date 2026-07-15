import test from 'node:test';
import assert from 'node:assert/strict';
import { preflightYouTubeDevAccess } from '../../packages/application/src/use-cases/preflight-youtube-dev-access.js';

const channel = (id) => ({
  id,
  snippet: { title: 'Channel' },
  contentDetails: { relatedPlaylists: { uploads: `UU_${id}` } },
  statistics: { viewCount: '1', subscriberCount: '1', videoCount: '1' },
});

test('preflights public data and owner Analytics identity without writing', async () => {
  const publicClient = {
    async getChannel() { return channel('channel_A'); },
    async listUploadVideoIds() { return ['video_A']; },
    async listVideos() { return [{ id: 'video_A', snippet: { channelId: 'channel_A' } }]; },
  };
  const ownerClient = {
    async getChannel() { return channel('channel_A'); },
    async queryAnalytics() {
      return { columnHeaders: [{ name: 'day' }], rows: [] };
    },
  };
  const result = await preflightYouTubeDevAccess({
    publicClient, ownerClient, channelId: 'channel_A', analyticsEnabled: true,
    analyticsStartDate: '2026-07-01', analyticsEndDate: '2026-07-02',
  });
  assert.equal(result.ok, true);
  assert.equal(result.ownerAnalytics.ownershipVerified, true);
  assert.deepEqual(result.publicData.sampleVideoIds, ['video_A']);
});

test('preflight rejects OAuth identity from a different channel', async () => {
  const publicClient = {
    async getChannel() { return channel('channel_A'); },
    async listUploadVideoIds() { return []; },
    async listVideos() { return []; },
  };
  const ownerClient = { async getChannel() { return channel('channel_B'); } };
  await assert.rejects(
    preflightYouTubeDevAccess({ publicClient, ownerClient, channelId: 'channel_A', analyticsEnabled: true }),
    /identity mismatch/u,
  );
});
