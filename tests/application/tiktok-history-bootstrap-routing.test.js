import test from 'node:test';
import assert from 'node:assert/strict';
import {
  JOB_TYPES,
  getJobDefinition,
} from '../../packages/application/src/jobs/job-catalog.js';
import { readStorageRuntimeConfig } from '../../packages/config/src/storage-runtime-config.js';
import { processJobWithHistoryBootstrap } from '../../apps/sync-worker/src/history-bootstrap-job-router.js';
import {
  PRIMARY_SCHEDULE_CRON,
  YOUTUBE_SCHEDULE_CRON,
  buildScheduledJobs,
} from '../../apps/sync-worker/src/scheduled-jobs.js';

const SCHEDULED_AT = '2026-07-23T01:10:00.000Z';

test('history bootstrap Job is active manual-only and never emitted by schedules', () => {
  const definition = getJobDefinition(JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP);
  assert.equal(definition.implementationStatus, 'active');
  assert.equal(definition.manualOnly, true);

  const environments = [{}, {
    MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
    MKT_DAILY_REPORT_TIME: '08:10',
    MKT_DAILY_REPORT_SETTING_KEY: 'setting:daily',
    DEFAULT_TIMEZONE: 'Asia/Bangkok',
  }, {
    MKT_SCHEDULE_YOUTUBE_ENABLED: 'true',
    DEFAULT_TIMEZONE: 'Asia/Bangkok',
  }];
  for (const env of environments) {
    for (const cron of [PRIMARY_SCHEDULE_CRON, YOUTUBE_SCHEDULE_CRON]) {
      const jobs = buildScheduledJobs({
        env,
        scheduledAt: SCHEDULED_AT,
        event: { cron, scheduledTime: SCHEDULED_AT },
      });
      assert.equal(
        jobs.some((job) => job.type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP),
        false,
      );
    }
  }
});

test('Storage backfill fails closed unless D1 write is enabled', () => {
  assert.throws(
    () => readStorageRuntimeConfig({
      MKT_TIME_SERIES_D1_WRITE_ENABLED: 'false',
      MKT_TIME_SERIES_D1_BACKFILL_ENABLED: 'true',
    }),
    (error) => error.code === 'MKT_STORAGE_RUNTIME_CONFIG_INVALID',
  );
  const enabled = readStorageRuntimeConfig({
    MKT_TIME_SERIES_D1_WRITE_ENABLED: 'true',
    MKT_TIME_SERIES_D1_BACKFILL_ENABLED: 'true',
  });
  assert.equal(enabled.timeSeriesD1WriteEnabled, true);
  assert.equal(enabled.timeSeriesD1BackfillEnabled, true);
});

test('history bootstrap rejects scheduled or malformed triggers before infrastructure access', async () => {
  let runtimeReads = 0;
  await assert.rejects(
    () => processJobWithHistoryBootstrap({
      job: {
        body: {
          type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP,
          trigger: 'scheduled',
        },
      },
      getRuntimeConfig() {
        runtimeReads += 1;
        throw new Error('must not read runtime');
      },
    }),
    (error) => error.code === 'TIKTOK_HISTORY_BOOTSTRAP_MANUAL_ONLY',
  );
  assert.equal(runtimeReads, 0);
});
