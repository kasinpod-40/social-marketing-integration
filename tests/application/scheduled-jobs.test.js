import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMARY_SCHEDULE_CRON,
  YOUTUBE_SCHEDULE_CRON,
  buildScheduledJobs,
  readZonedScheduleParts,
  resolveYouTubeAnalyticsEnabled,
} from '../../apps/sync-worker/src/index.js';

test('scheduler queues TikTok sync first and daily report at Bangkok 08:10', () => {
  const jobs = buildPrimaryScheduledJobs({
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
    'system.reliability-mirror.deliver',
  ]);
  assert.equal(jobs[0].metricDate, '2026-07-13');
  assert.equal(jobs[1].periodEnd, '2026-07-12');
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

  const weeklyJobs = buildPrimaryScheduledJobs({ scheduledAt: '2026-07-13T01:15:00Z', env });
  assert.deepEqual(weeklyJobs.map((job) => job.type), [
    'report.weekly.generate',
    'system.reliability-mirror.deliver',
  ]);
  assert.equal(weeklyJobs[0].periodEnd, '2026-07-12');
  assert.deepEqual(
    buildPrimaryScheduledJobs({ scheduledAt: '2026-07-14T01:15:00Z', env }).map((job) => job.type),
    ['system.reliability-mirror.deliver'],
  );
});

test('timezone schedule parts do not depend on runtime local timezone', () => {
  assert.deepEqual(readZonedScheduleParts('2026-07-12T18:30:00Z', 'Asia/Bangkok'), {
    date: '2026-07-13',
    weekday: 'monday',
    time: '01:30',
  });
});

test('enabled report schedules fail closed when time or setting key is invalid', () => {
  assert.throws(() => buildPrimaryScheduledJobs({
    scheduledAt: '2026-07-13T01:10:00Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:12',
      MKT_DAILY_REPORT_SETTING_KEY: 'daily',
    },
  }), (error) => error.code === 'MKT_SCHEDULE_CONFIG_INVALID');

  assert.throws(() => buildPrimaryScheduledJobs({
    scheduledAt: '2026-07-13T01:10:00Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
    },
  }), (error) => error.code === 'MKT_RUNTIME_CONFIG_INVALID');
});


test('scheduled date identity stays bound to scheduledTime even when consumption is later', () => {
  const jobs = buildPrimaryScheduledJobs({
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

test('scheduled report period uses the last completed local day across a year boundary', () => {
  const jobs = buildPrimaryScheduledJobs({
    scheduledAt: '2026-01-01T01:10:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'false',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
      MKT_DAILY_REPORT_SETTING_KEY: 'dev_ft_pumkin:tiktok:daily',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
    },
  });

  assert.equal(jobs[0].periodEnd, '2025-12-31');
});

test('scheduled report period uses the last completed local day across a month boundary', () => {
  const jobs = buildPrimaryScheduledJobs({
    scheduledAt: '2026-08-01T01:10:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'false',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
      MKT_DAILY_REPORT_SETTING_KEY: 'dev_ft_pumkin:tiktok:daily',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
    },
  });

  assert.equal(jobs[0].periodEnd, '2026-07-31');
});

test('scheduled report period uses leap day as the last completed local day', () => {
  const jobs = buildPrimaryScheduledJobs({
    scheduledAt: '2028-03-01T01:10:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'false',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
      MKT_DAILY_REPORT_SETTING_KEY: 'dev_ft_pumkin:tiktok:daily',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
    },
  });

  assert.equal(jobs[0].periodEnd, '2028-02-29');
});

test('YouTube cron queues an auto sync every 6 hours without duplicating primary jobs', () => {
  const jobs = buildScheduledJobs({
    event: {
      cron: YOUTUBE_SCHEDULE_CRON,
      scheduledTime: Date.parse('2026-07-19T06:50:00.000Z'),
    },
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_CONNECTOR_TIKTOK_ENABLED: 'true',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_SCHEDULE_YOUTUBE_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_TIME: '07:50',
      MKT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS: '7',
    },
  });

  assert.deepEqual(jobs, [{
    schemaVersion: 1,
    type: 'youtube.channel.organic.sync',
    trigger: 'scheduled',
    syncMode: 'auto',
    requestedAt: '2026-07-19T06:50:00.000Z',
    metricDate: '2026-07-19',
    analyticsEnabled: false,
  }]);
});

test('YouTube Analytics runs once daily and locks a 7-day completed Pacific range in the job', () => {
  const jobs = buildScheduledJobs({
    event: {
      cron: YOUTUBE_SCHEDULE_CRON,
      scheduledTime: Date.parse('2026-07-19T00:50:00.000Z'),
    },
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_YOUTUBE_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_TIME: '07:50',
      MKT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS: '7',
    },
  });

  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].analyticsEnabled, true);
  assert.equal(jobs[0].analyticsStartDate, '2026-07-11');
  assert.equal(jobs[0].analyticsEndDate, '2026-07-17');
});

test('primary cron never queues YouTube and YouTube cron never queues TikTok or reports', () => {
  const env = {
    DEFAULT_TIMEZONE: 'Asia/Bangkok',
    MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
    MKT_SCHEDULE_YOUTUBE_ENABLED: 'true',
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
    MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
  };
  const primary = buildScheduledJobs({
    event: { cron: PRIMARY_SCHEDULE_CRON, scheduledTime: Date.parse('2026-07-19T00:50:00Z') },
    env,
  });
  const youtube = buildScheduledJobs({
    event: { cron: YOUTUBE_SCHEDULE_CRON, scheduledTime: Date.parse('2026-07-19T00:50:00Z') },
    env,
  });

  assert.deepEqual(primary.map((job) => job.type), [
    'tiktok.creator.native.sync',
    'system.reliability-mirror.deliver',
  ]);
  assert.deepEqual(youtube.map((job) => job.type), ['youtube.channel.organic.sync']);
});


test('primary cron always queues a generic reliability mirror recovery drain without customer runtime flags', () => {
  const jobs = buildScheduledJobs({
    event: {
      cron: PRIMARY_SCHEDULE_CRON,
      scheduledTime: Date.parse('2026-07-19T00:55:00.000Z'),
    },
    env: {},
  });

  assert.deepEqual(jobs, [{
    schemaVersion: 1,
    type: 'system.reliability-mirror.deliver',
    trigger: 'scheduled',
    requestedAt: '2026-07-19T00:55:00.000Z',
  }]);
});

test('unknown cron is ignored and cannot enqueue TikTok, YouTube, or reports', () => {
  const jobs = buildScheduledJobs({
    event: { cron: '0 * * * *', scheduledTime: Date.parse('2026-07-19T00:50:00Z') },
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '07:50',
      MKT_DAILY_REPORT_SETTING_KEY: 'daily',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'true',
      MKT_WEEKLY_REPORT_TIME: '07:50',
      MKT_WEEKLY_REPORT_WEEKDAY: 'sunday',
      MKT_WEEKLY_REPORT_SETTING_KEY: 'weekly',
      MKT_SCHEDULE_YOUTUBE_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_TIME: '07:50',
    },
  });

  assert.deepEqual(jobs, []);
});

test('YouTube Analytics time fails closed when dedicated cron cannot reach it', () => {
  assert.throws(() => buildScheduledJobs({
    event: {
      cron: YOUTUBE_SCHEDULE_CRON,
      scheduledTime: Date.parse('2026-07-19T00:50:00.000Z'),
    },
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_YOUTUBE_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_TIME: '08:10',
    },
  }), (error) => {
    assert.equal(error?.code, 'MKT_SCHEDULE_CONFIG_INVALID');
    assert.deepEqual(error?.details?.supportedTimes, ['01:50', '07:50', '13:50', '19:50']);
    return true;
  });
});

test('YouTube Analytics lookback is bounded to protect API quota', () => {
  assert.throws(() => buildScheduledJobs({
    event: {
      cron: YOUTUBE_SCHEDULE_CRON,
      scheduledTime: Date.parse('2026-07-19T00:50:00.000Z'),
    },
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_YOUTUBE_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_ENABLED: 'true',
      MKT_YOUTUBE_ANALYTICS_TIME: '07:50',
      MKT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS: '32',
    },
  }), (error) => error?.code === 'MKT_SCHEDULE_CONFIG_INVALID');
});

test('Queue job can reduce but cannot elevate the YouTube Analytics runtime feature', () => {
  assert.equal(resolveYouTubeAnalyticsEnabled({ configured: 'true', requested: false }), false);
  assert.equal(resolveYouTubeAnalyticsEnabled({ configured: 'true', requested: true }), true);
  assert.throws(
    () => resolveYouTubeAnalyticsEnabled({ configured: 'false', requested: true }),
    (error) => error?.code === 'YOUTUBE_ANALYTICS_DISABLED',
  );
});

function buildPrimaryScheduledJobs(input) {
  const { scheduledAt, ...rest } = input;
  return buildScheduledJobs({
    ...rest,
    event: {
      cron: PRIMARY_SCHEDULE_CRON,
      scheduledTime: scheduledAt,
    },
  });
}
