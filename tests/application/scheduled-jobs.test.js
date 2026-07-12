import test from 'node:test';
import assert from 'node:assert/strict';
import { buildScheduledJobs, readZonedScheduleParts } from '../../apps/sync-worker/src/index.js';

test('scheduler queues TikTok sync first and daily report at Bangkok 08:10', () => {
  const jobs = buildScheduledJobs({
    scheduledAt: '2026-07-13T01:10:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
      MKT_DAILY_REPORT_SETTING_KEY: 'dev_ft_pumkin:tiktok:daily',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
    },
  });

  assert.deepEqual(jobs.map((job) => job.type), [
    'tiktok.creator.native.sync',
    'report.daily.generate',
  ]);
  assert.equal(jobs[0].metricDate, '2026-07-13');
  assert.equal(jobs[1].periodEnd, '2026-07-13');
  assert.equal(jobs[1].reportSettingKey, 'dev_ft_pumkin:tiktok:daily');
});

test('weekly report is due only on configured Bangkok weekday and time', () => {
  const env = {
    DEFAULT_TIMEZONE: 'Asia/Bangkok',
    MKT_SCHEDULE_TIKTOK_ENABLED: 'false',
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
    MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'true',
    MKT_WEEKLY_REPORT_TIME: '08:15',
    MKT_WEEKLY_REPORT_WEEKDAY: 'monday',
    MKT_WEEKLY_REPORT_SETTING_KEY: 'dev_ft_pumkin:tiktok:weekly',
  };

  const weeklyJobs = buildScheduledJobs({ scheduledAt: '2026-07-13T01:15:00Z', env });
  assert.deepEqual(weeklyJobs.map((job) => job.type), ['report.weekly.generate']);
  assert.equal(weeklyJobs[0].periodEnd, '2026-07-13');
  assert.equal(buildScheduledJobs({ scheduledAt: '2026-07-14T01:15:00Z', env }).length, 0);
});

test('timezone schedule parts do not depend on runtime local timezone', () => {
  assert.deepEqual(readZonedScheduleParts('2026-07-12T18:30:00Z', 'Asia/Bangkok'), {
    date: '2026-07-13',
    weekday: 'monday',
    time: '01:30',
  });
});

test('enabled report schedules fail closed when time or setting key is invalid', () => {
  assert.throws(() => buildScheduledJobs({
    scheduledAt: '2026-07-13T01:10:00Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:12',
      MKT_DAILY_REPORT_SETTING_KEY: 'daily',
    },
  }), (error) => error.code === 'MKT_SCHEDULE_CONFIG_INVALID');

  assert.throws(() => buildScheduledJobs({
    scheduledAt: '2026-07-13T01:10:00Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
    },
  }), (error) => error.code === 'MKT_RUNTIME_CONFIG_INVALID');
});


test('scheduled date identity stays bound to scheduledTime even when consumption is later', () => {
  const jobs = buildScheduledJobs({
    scheduledAt: '2026-07-12T16:59:59.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
    },
  });

  assert.equal(jobs[0].requestedAt, '2026-07-12T16:59:59.000Z');
  assert.equal(jobs[0].metricDate, '2026-07-12');
});
