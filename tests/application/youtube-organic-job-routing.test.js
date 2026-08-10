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

test('Analytics-enabled route requests the exact Customer Connection owner client before work', async () => {
  const marker = new Error('owner-client-factory-reached');
  let observed;
  await assert.rejects(() => processYouTubeOrganicEndToEndJob({
    env: {
      MKT_YOUTUBE_END_TO_END_ENABLED: 'true',
      MKT_TIME_SERIES_D1_WRITE_ENABLED: 'true',
      MKT_YOUTUBE_LARK_WRITE_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_ENABLED: 'true',
      YOUTUBE_CHANNEL_ID: 'UC_CUSTOMER_CHANNEL',
      LARK_TABLE_MKT_ACCOUNTS: 'tbl_accounts',
      LARK_TABLE_RAW_YOUTUBE_CHANNELS: 'tbl_raw_channels',
      LARK_TABLE_RAW_YOUTUBE_VIDEOS: 'tbl_raw_videos',
      LARK_TABLE_RAW_YOUTUBE_ANALYTICS_DAILY: 'tbl_raw_analytics',
      LARK_TABLE_MKT_CONTENT: 'tbl_content',
      LARK_TABLE_MKT_CONTENT_DAILY: 'tbl_content_daily',
      LARK_TABLE_MKT_SYNC_LOG: 'tbl_sync_log',
      LARK_TABLE_MKT_SYSTEM_ALERTS: 'tbl_alerts',
    },
    job: {
      body: {
        type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
        dryRun: false,
        analyticsEnabled: true,
      },
    },
    getRuntimeConfig() {
      return {
        environment: 'development',
        profileKey: 'integration_workspace',
        customerKey: 'chemistry_k',
        connectors: {
          youtube: { enabled: true, accountKey: 'chemistry_k' },
        },
      };
    },
    getInfrastructure() {
      return {
        getReliability() { return { store: {}, lockManager: {} }; },
        getResumableWorkStore() { return {}; },
      };
    },
    dependencies: {
      async createYouTubeRuntimeClients(_env, options) {
        observed = options;
        throw marker;
      },
    },
  }), (error) => error === marker);
  assert.deepEqual(observed, {
    publicApiKeyOnly: false,
    analyticsEnabled: true,
    customerKey: 'chemistry_k',
    channelId: 'UC_CUSTOMER_CHANNEL',
  });
});
