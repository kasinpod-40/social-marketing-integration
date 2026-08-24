import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PRIMARY_SCHEDULE_CRON,
  YOUTUBE_SCHEDULE_CRON,
  buildScheduledJobs,
  readZonedScheduleParts,
  resolveYouTubeAnalyticsEnabled,
} from '../../apps/sync-worker/src/index.js';

test('scheduler queues TikTok probe plus all active 1D/3D/7D/30D Shared materializations', () => {
  const jobs = buildPrimaryScheduledJobs({
    scheduledAt: '2026-07-13T01:10:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_TIKTOK_SYNC_TIME: '08:10',
      MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED: 'true',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
      ...reportRuntimeEnv(),
    },
  });

  assert.equal(jobs.length, 34);
  assert.equal(jobs[0].type, 'tiktok.creator.native.probe');
  assert.deepEqual(jobs.slice(1, -1).map((job) => job.type),
    Array(32).fill('report.materialization.generate'));
  assert.equal(jobs.at(-1).type, 'system.reliability-mirror.deliver');
  assert.equal(jobs[0].metricDate, '2026-07-12');
  assert.equal(jobs[1].periodEnd, '2026-07-12');
  assert.equal(jobs[1].reportSettingKey, 'integration_workspace:facebook:rolling:1d');
  assert.deepEqual([...new Set(jobs.slice(1, -1).map((job) => job.windowDays))], [1, 3, 7, 30]);
  assert.equal(jobs[1].operationId, 'report-daily-facebook-1d-20260712');
  assert.equal(jobs[1].workKey, 'report:report-daily-facebook-1d-20260712');
});

test('TikTok schedule fails closed without watermark admission', () => {
  assert.throws(() => buildPrimaryScheduledJobs({
    scheduledAt: '2026-07-13T01:10:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_TIKTOK_SYNC_TIME: '08:10',
    },
  }), (error) => error.code === 'MKT_SCHEDULE_CONFIG_INVALID'
    && error.details.fieldName === 'MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED');
});

test('weekly report is due only on configured Bangkok weekday and time', () => {
  const env = {
    DEFAULT_TIMEZONE: 'Asia/Bangkok',
    MKT_SCHEDULE_TIKTOK_ENABLED: 'false',
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
    MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'true',
    MKT_WEEKLY_REPORT_TIME: '08:15',
    MKT_WEEKLY_REPORT_WEEKDAY: 'monday',
    ...reportRuntimeEnv(),
  };

  const weeklyJobs = buildPrimaryScheduledJobs({ scheduledAt: '2026-07-13T01:15:00Z', env });
  assert.equal(weeklyJobs.length, 9);
  assert.deepEqual(weeklyJobs.slice(0, -1).map((job) => job.type),
    Array(8).fill('report.materialization.generate'));
  assert.equal(weeklyJobs.at(-1).type, 'system.reliability-mirror.deliver');
  assert.equal(weeklyJobs[0].periodEnd, '2026-07-12');
  assert.equal(weeklyJobs[0].windowDays, 7);
  assert.equal(weeklyJobs[0].operationId, 'report-weekly-facebook-7d-20260712');
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
      ...reportRuntimeEnv(),
    },
  }), (error) => error.code === 'MKT_SCHEDULE_CONFIG_INVALID');

  assert.throws(() => buildPrimaryScheduledJobs({
    scheduledAt: '2026-07-13T01:10:00Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
      ...reportRuntimeEnv({ MKT_CUSTOMER_PROFILE: '' }),
    },
  }), (error) => error.code === 'MKT_RUNTIME_CONFIG_INVALID');
});


test('scheduled date identity stays bound to the previous completed day even when consumption is later', () => {
  const jobs = buildPrimaryScheduledJobs({
    scheduledAt: '2026-07-12T16:55:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
      MKT_TIKTOK_SYNC_TIME: '23:55',
      MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED: 'true',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'false',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
    },
  });

  assert.equal(jobs[0].requestedAt, '2026-07-12T16:55:00.000Z');
  assert.equal(jobs[0].metricDate, '2026-07-11');
});

test('scheduled report period uses the last completed local day across a year boundary', () => {
  const jobs = buildPrimaryScheduledJobs({
    scheduledAt: '2026-01-01T01:10:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_TIKTOK_ENABLED: 'false',
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: 'true',
      MKT_DAILY_REPORT_TIME: '08:10',
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
      ...reportRuntimeEnv(),
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
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
      ...reportRuntimeEnv(),
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
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'false',
      ...reportRuntimeEnv(),
    },
  });

  assert.equal(jobs[0].periodEnd, '2028-02-29');
});

test('Meta Ads schedule emits one previous-day stable operation per reviewed account mapping', () => {
  const scheduledAt = '2026-08-09T00:40:00.000Z';
  const jobs = buildPrimaryScheduledJobs({
    scheduledAt,
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_META_ADS_ENABLED: 'true',
      MKT_CONNECTOR_META_ADS_ENABLED: 'true',
      MKT_META_SOURCE_READ_ENABLED: 'true',
      MKT_META_D1_WRITE_ENABLED: 'true',
      MKT_META_LARK_WRITE_ENABLED: 'true',
      META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=111,chemistry_k3=222',
    },
  });

  assert.deepEqual(jobs.map((job) => job.type), [
    'meta.ads.sync',
    'meta.ads.sync',
    'system.reliability-mirror.deliver',
  ]);
  assert.deepEqual(jobs.slice(0, 2).map((job) => job.sourceAccountKey), [
    'chemistry_k2',
    'chemistry_k3',
  ]);
  assert.equal(jobs[0].operationId, 'meta-ads-chemistry_k2-scheduled-20260808');
  assert.equal(jobs[0].workKey, 'meta_ads:chemistry_k2:meta-ads-chemistry_k2-scheduled-20260808');
  assert.equal(jobs[0].periodStart, '2026-08-08');
  assert.equal(jobs[0].periodEnd, '2026-08-08');
  assert.equal(jobs[0].originalRequestedAt, Date.parse(scheduledAt));
});

test('Meta Ads schedule fails closed before enqueue when a consumer gate or mapping is missing', () => {
  const base = {
    DEFAULT_TIMEZONE: 'Asia/Bangkok',
    MKT_SCHEDULE_META_ADS_ENABLED: 'true',
    MKT_CONNECTOR_META_ADS_ENABLED: 'true',
    MKT_META_SOURCE_READ_ENABLED: 'true',
    MKT_META_D1_WRITE_ENABLED: 'true',
    MKT_META_LARK_WRITE_ENABLED: 'true',
  };
  assert.throws(() => buildPrimaryScheduledJobs({
    scheduledAt: '2026-08-09T00:40:00.000Z',
    env: { ...base, MKT_META_LARK_WRITE_ENABLED: 'false' },
  }), (error) => error?.code === 'MKT_SCHEDULE_CONFIG_INVALID'
    && error?.details?.fieldName === 'MKT_META_LARK_WRITE_ENABLED');
  assert.throws(() => buildPrimaryScheduledJobs({
    scheduledAt: '2026-08-09T00:40:00.000Z',
    env: base,
  }), (error) => error?.code === 'MKT_SCHEDULE_CONFIG_INVALID'
    && error?.details?.fieldName === 'META_AD_ACCOUNT_MAPPINGS');
});

test('Chatwoot schedule emits one account-scoped daily incremental operation', () => {
  const scheduledAt = '2026-08-09T00:45:00.000Z';
  const jobs = buildPrimaryScheduledJobs({
    scheduledAt,
    env: {
      MKT_ENV: 'development',
      MKT_CUSTOMER_PROFILE: 'integration_workspace',
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_CHATWOOT_ENABLED: 'true',
      MKT_CONNECTOR_CHATWOOT_ENABLED: 'true',
      MKT_CHATWOOT_D1_WRITE_ENABLED: 'true',
      MKT_CHATWOOT_LARK_WRITE_ENABLED: 'true',
      MKT_CHATWOOT_REPORT_WRITE_ENABLED: 'true',
      MKT_CHATWOOT_WEBHOOK_ENABLED: 'false',
    },
  });

  assert.deepEqual(jobs.map((job) => job.type), [
    'chatwoot.conversations.sync',
    'system.reliability-mirror.deliver',
  ]);
  assert.equal(jobs[0].trigger, 'chatwoot_scheduled_daily');
  assert.equal(jobs[0].operationId, 'chatwoot-daily-20260808');
  assert.equal(jobs[0].workKey, 'chatwoot:chemistry_k:chatwoot-daily-20260808');
  assert.equal(jobs[0].accountKey, 'chemistry_k');
});

test('Google Ads schedule remains at the external Manager Script provider boundary', () => {
  const jobs = buildPrimaryScheduledJobs({
    scheduledAt: '2026-08-09T00:40:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_SCHEDULE_GOOGLE_ADS_ENABLED: 'true',
    },
  });
  assert.deepEqual(jobs.map((job) => job.type), ['system.reliability-mirror.deliver']);
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
    MKT_TIKTOK_SYNC_TIME: '07:50',
    MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED: 'true',
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
    'tiktok.creator.native.probe',
    'system.reliability-mirror.deliver',
  ]);
  assert.equal(primary[0].metricDate, '2026-07-18');
  assert.deepEqual(youtube.map((job) => job.type), ['youtube.channel.organic.sync']);
});

test('TikTok probe is queued only once at the configured local time', () => {
  const env = {
    DEFAULT_TIMEZONE: 'Asia/Bangkok',
    MKT_SCHEDULE_TIKTOK_ENABLED: 'true',
    MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED: 'true',
    MKT_TIKTOK_SYNC_TIME: '06:55',
  };
  const due = buildPrimaryScheduledJobs({ scheduledAt: '2026-07-18T23:55:00.000Z', env });
  const notDue = buildPrimaryScheduledJobs({ scheduledAt: '2026-07-19T00:00:00.000Z', env });

  assert.deepEqual(due.map((job) => job.type), [
    'tiktok.creator.native.probe',
    'system.reliability-mirror.deliver',
  ]);
  assert.deepEqual(notDue.map((job) => job.type), ['system.reliability-mirror.deliver']);
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

function reportRuntimeEnv(overrides = {}) {
  return {
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_REPORT_D1_READ_ENABLED: 'true',
    MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'true',
    MKT_META_REPORT_READ_ENABLED: 'true',
    MKT_WOOCOMMERCE_REPORT_READ_ENABLED: 'true',
    ...overrides,
  };
}
