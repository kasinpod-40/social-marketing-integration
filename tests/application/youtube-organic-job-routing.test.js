import test from 'node:test';
import assert from 'node:assert/strict';
import { processYouTubeOrganicEndToEndJob } from '../../apps/sync-worker/src/youtube-organic-job-router.js';
import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';

test('YouTube end-to-end route is fail-closed when the new runtime flag is absent', async () => {
  await assert.rejects(() => processYouTubeOrganicEndToEndJob({
    env: {},
    job: { body: { type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC } },
  }), (error) => error.code === 'YOUTUBE_END_TO_END_DISABLED' && error.retryable === false);
});

test('YouTube end-to-end non-dry execution requires the shared D1 write gate', async () => {
  await assert.rejects(() => processYouTubeOrganicEndToEndJob({
    env: {
      MKT_YOUTUBE_END_TO_END_ENABLED: 'true',
      MKT_TIME_SERIES_D1_WRITE_ENABLED: 'false',
    },
    job: { body: { type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC } },
  }), (error) => error.code === 'YOUTUBE_END_TO_END_D1_WRITE_DISABLED');
});

test('YouTube end-to-end Lark delivery flag is default false after the shared D1 gate', async () => {
  await assert.rejects(() => processYouTubeOrganicEndToEndJob({
    env: {
      MKT_YOUTUBE_END_TO_END_ENABLED: 'true',
      MKT_TIME_SERIES_D1_WRITE_ENABLED: 'true',
    },
    job: { body: { type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC } },
  }), (error) => error.code === 'YOUTUBE_END_TO_END_LARK_WRITE_DISABLED');
});
