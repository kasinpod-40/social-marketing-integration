import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMARY_SCHEDULE_CRON,
  buildScheduledJobs,
} from '../../apps/sync-worker/src/scheduled-jobs.js';

function build(env) {
  return buildScheduledJobs({
    event: {
      cron: PRIMARY_SCHEDULE_CRON,
      scheduledTime: Date.parse('2026-07-26T01:10:00.000Z'),
    },
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      ...env,
    },
  });
}

test('post-processing report admission cannot run beside blind Daily report schedule', () => {
  assert.throws(() => build({
    MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED: 'true',
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
    MKT_DAILY_REPORT_TIME: '08:10',
    MKT_DAILY_REPORT_SETTING_KEY: 'integration_workspace:tiktok:daily',
  }), (error) => error.code === 'MKT_SCHEDULE_CONFIG_INVALID'
    && error.details.fieldName === 'MKT_SCHEDULE_DAILY_REPORT_ENABLED');
});

test('post-processing report mode leaves Daily schedule absent', () => {
  const jobs = build({
    MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED: 'true',
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
  });
  assert.deepEqual(jobs.map((job) => job.type), ['system.reliability-mirror.deliver']);
});
