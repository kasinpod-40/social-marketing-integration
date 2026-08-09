import { addDaysDateOnly } from '../../../packages/application/src/reports/report-period.js';
import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../../packages/application/src/jobs/queue-operation.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import {
  readBoolean,
  requireJobText,
} from './worker-runtime-support.js';

const DEFAULT_FACEBOOK_SYNC_TIME = '07:30';
const DEFAULT_INSTAGRAM_SYNC_TIME = '07:35';
const DEFAULT_DAILY_REPORT_TIME = '08:10';
const DEFAULT_WEEKLY_REPORT_TIME = '08:15';
const DEFAULT_WEEKLY_REPORT_WEEKDAY = 'monday';
const DEFAULT_YOUTUBE_ANALYTICS_TIME = '07:50';
const DEFAULT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS = 7;
const DEFAULT_WOOCOMMERCE_SYNC_TIME = '01:30';
const YOUTUBE_ANALYTICS_TIMEZONE = 'America/Los_Angeles';
const SCHEDULE_WEEKDAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const YOUTUBE_SCHEDULE_MINUTE_UTC = 50;
const YOUTUBE_SCHEDULE_HOURS_UTC = Object.freeze([0, 6, 12, 18]);

export const PRIMARY_SCHEDULE_CRON = '*/5 * * * *';
export const YOUTUBE_SCHEDULE_CRON = `${YOUTUBE_SCHEDULE_MINUTE_UTC} ${YOUTUBE_SCHEDULE_HOURS_UTC.join(',')} * * *`;

export function buildScheduledJobs(input = {}) {
  const env = input.env ?? {};
  const requestedAt = normalizeScheduledAt(input.scheduledAt ?? input.event?.scheduledTime);
  const cron = optionalJobText(input.event?.cron);
  const includePrimaryJobs = cron === PRIMARY_SCHEDULE_CRON;
  const includeYouTubeJobs = cron === YOUTUBE_SCHEDULE_CRON;
  if (!includePrimaryJobs && !includeYouTubeJobs) return Object.freeze([]);

  const tiktokEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_TIKTOK_ENABLED, false)
    : false;
  const facebookEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_FACEBOOK_ENABLED, false)
    : false;
  const instagramEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_INSTAGRAM_ENABLED, false)
    : false;
  const wooCommerceEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_WOOCOMMERCE_ENABLED, false)
    : false;
  const dailyEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_DAILY_REPORT_ENABLED, false)
    : false;
  const weeklyEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED, false)
    : false;
  const youtubeEnabled = includeYouTubeJobs
    ? readBoolean(env.MKT_SCHEDULE_YOUTUBE_ENABLED, false)
    : false;
  const postProcessReportEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED, false)
    : false;
  if (tiktokEnabled && !readBoolean(env.MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED, false)) {
    throw permanentError(
      'TikTok schedule requires watermark admission instead of blind Business sync',
      {
        code: 'MKT_SCHEDULE_CONFIG_INVALID',
        details: { fieldName: 'MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED' },
      },
    );
  }
  if (dailyEnabled && postProcessReportEnabled) {
    throw permanentError(
      'Scheduled Daily report cannot run alongside post-processing report admission',
      {
        code: 'MKT_SCHEDULE_CONFIG_INVALID',
        details: { fieldName: 'MKT_SCHEDULE_DAILY_REPORT_ENABLED' },
      },
    );
  }
  const needsLocalSchedule = tiktokEnabled
    || facebookEnabled
    || instagramEnabled
    || wooCommerceEnabled
    || dailyEnabled
    || weeklyEnabled
    || youtubeEnabled;
  const timeZone = needsLocalSchedule
    ? requireJobText(env.DEFAULT_TIMEZONE ?? 'Asia/Bangkok', 'DEFAULT_TIMEZONE')
    : null;
  const local = needsLocalSchedule ? readZonedScheduleParts(requestedAt, timeZone) : null;
  const completedPeriodEnd = local ? addDaysDateOnly(local.date, -1) : null;
  const jobs = [];

  if (includePrimaryJobs && tiktokEnabled) {
    jobs.push(Object.freeze({
      schemaVersion: 1,
      type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_PROBE,
      trigger: 'scheduled',
      requestedAt,
      // Lark Native 07:00 เป็น Snapshot แรกหลังวันก่อนหน้าปิด จึงล็อกวันสมบูรณ์ล่าสุด.
      metricDate: completedPeriodEnd,
    }));
  }

  if (includePrimaryJobs && facebookEnabled) {
    const syncTime = readScheduleTime(
      env.MKT_FACEBOOK_SYNC_TIME ?? DEFAULT_FACEBOOK_SYNC_TIME,
      'MKT_FACEBOOK_SYNC_TIME',
    );
    if (local.time === syncTime) {
      jobs.push(createMetaOrganicScheduledJob({
        platform: 'facebook',
        type: JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
        requestedAt,
        periodEnd: completedPeriodEnd,
      }));
    }
  }

  if (includePrimaryJobs && instagramEnabled) {
    const syncTime = readScheduleTime(
      env.MKT_INSTAGRAM_SYNC_TIME ?? DEFAULT_INSTAGRAM_SYNC_TIME,
      'MKT_INSTAGRAM_SYNC_TIME',
    );
    if (local.time === syncTime) {
      jobs.push(createMetaOrganicScheduledJob({
        platform: 'instagram',
        type: JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
        requestedAt,
        periodEnd: completedPeriodEnd,
      }));
    }
  }

  if (includePrimaryJobs && wooCommerceEnabled) {
    const syncTime = readScheduleTime(
      env.MKT_WOOCOMMERCE_SYNC_TIME ?? DEFAULT_WOOCOMMERCE_SYNC_TIME,
      'MKT_WOOCOMMERCE_SYNC_TIME',
    );
    if (local.time === syncTime) {
      const operationId = `scheduled-${local.date.replaceAll('-', '')}-${local.time.replace(':', '')}`;
      jobs.push(createStableQueueOperationBody({
        schemaVersion: 1,
        type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC,
        trigger: 'scheduled',
        // Schedule เป็น Incremental เท่านั้น; Full reconciliation ต้องผ่าน Operator แยก.
        fullReconciliation: false,
      }, {
        operationId,
        originalRequestedAt: Date.parse(requestedAt),
      }));
    }
  }

  if (includePrimaryJobs && dailyEnabled) {
    const dailyTime = readScheduleTime(env.MKT_DAILY_REPORT_TIME ?? DEFAULT_DAILY_REPORT_TIME, 'MKT_DAILY_REPORT_TIME');
    if (local.time === dailyTime) {
      jobs.push(Object.freeze({
        schemaVersion: 1,
        type: JOB_TYPES.DAILY_REPORT_GENERATE,
        trigger: 'scheduled',
        requestedAt,
        // รายงานใช้วันสมบูรณ์ล่าสุด และล็อก Identity ตั้งแต่ Producer ไม่ให้ Queue delay เปลี่ยนช่วง
        periodEnd: completedPeriodEnd,
        reportSettingKey: requireJobText(env.MKT_DAILY_REPORT_SETTING_KEY, 'MKT_DAILY_REPORT_SETTING_KEY'),
      }));
    }
  }

  if (includePrimaryJobs && weeklyEnabled) {
    const weeklyTime = readScheduleTime(env.MKT_WEEKLY_REPORT_TIME ?? DEFAULT_WEEKLY_REPORT_TIME, 'MKT_WEEKLY_REPORT_TIME');
    const weeklyWeekday = readScheduleWeekday(
      env.MKT_WEEKLY_REPORT_WEEKDAY ?? DEFAULT_WEEKLY_REPORT_WEEKDAY,
      'MKT_WEEKLY_REPORT_WEEKDAY',
    );
    if (local.time === weeklyTime && local.weekday === weeklyWeekday) {
      jobs.push(Object.freeze({
        schemaVersion: 1,
        type: JOB_TYPES.WEEKLY_REPORT_GENERATE,
        trigger: 'scheduled',
        requestedAt,
        periodEnd: completedPeriodEnd,
        reportSettingKey: requireJobText(env.MKT_WEEKLY_REPORT_SETTING_KEY, 'MKT_WEEKLY_REPORT_SETTING_KEY'),
      }));
    }
  }

  if (includeYouTubeJobs && youtubeEnabled) {
    const analyticsConfigured = readBoolean(env.MKT_YOUTUBE_ANALYTICS_ENABLED, false);
    const analyticsTime = analyticsConfigured
      ? readSupportedYouTubeAnalyticsTime({
        value: env.MKT_YOUTUBE_ANALYTICS_TIME ?? DEFAULT_YOUTUBE_ANALYTICS_TIME,
        requestedAt,
        timeZone,
      })
      : null;
    const analyticsEnabled = analyticsConfigured && local.time === analyticsTime;
    const job = {
      schemaVersion: 1,
      type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
      trigger: 'scheduled',
      syncMode: 'auto',
      requestedAt,
      metricDate: local.date,
      analyticsEnabled,
    };
    if (analyticsEnabled) {
      const sourceLocal = readZonedScheduleParts(requestedAt, YOUTUBE_ANALYTICS_TIMEZONE);
      const endDate = addDaysDateOnly(sourceLocal.date, -1);
      const lookbackDays = readBoundedPositiveInteger(
        env.MKT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS,
        DEFAULT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS,
        31,
        'MKT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS',
      );
      job.analyticsStartDate = addDaysDateOnly(endDate, -(lookbackDays - 1));
      job.analyticsEndDate = endDate;
    }
    jobs.push(Object.freeze(job));
  }

  if (includePrimaryJobs) {
    // Durable outbox ต้องมี Recovery wake-up ที่ไม่พึ่ง write ครั้งถัดไป
    // เพื่อให้ Queue send ที่ล้มหลัง D1 primary success ไม่ทำให้งาน Mirror ค้างถาวร.
    jobs.push(Object.freeze({
      schemaVersion: 1,
      type: JOB_TYPES.RELIABILITY_MIRROR_DELIVER,
      trigger: 'scheduled',
      requestedAt,
    }));
  }

  return Object.freeze(jobs);
}

function createMetaOrganicScheduledJob({ platform, type, requestedAt, periodEnd }) {
  const dateKey = requireJobText(periodEnd, 'periodEnd').replaceAll('-', '');
  return createStableQueueOperationBody({
    schemaVersion: 1,
    type,
    trigger: 'scheduled',
    dryRun: false,
    d1Only: false,
    periodStart: periodEnd,
    periodEnd,
  }, {
    operationId: `${platform}-scheduled-${dateKey}`,
    originalRequestedAt: Date.parse(requestedAt),
  });
}

/** อ่านเวลาและวันตาม Timezone จาก scheduledTime ของ Cloudflare โดยไม่พึ่ง Timezoneเครื่อง */
export function readZonedScheduleParts(value, timeZone) {
  const requestedAt = normalizeScheduledAt(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: requireJobText(timeZone, 'timeZone'),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(requestedAt));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Object.freeze({
    date: [
      requireJobText(byType.year, 'scheduled year'),
      requireJobText(byType.month, 'scheduled month'),
      requireJobText(byType.day, 'scheduled day'),
    ].join('-'),
    weekday: requireJobText(byType.weekday, 'scheduled weekday').toLowerCase(),
    time: `${requireJobText(byType.hour, 'scheduled hour')}:${requireJobText(byType.minute, 'scheduled minute')}`,
  });
}

/** Queue payload ลดสิทธิ์ Analytics ได้ แต่ห้ามยกระดับเหนือ Runtime feature flag */
export function resolveYouTubeAnalyticsEnabled(input = {}) {
  const configured = readBoolean(input.configured, false);
  const requested = readBoolean(input.requested, configured);
  if (requested && !configured) {
    throw permanentError('YouTube job cannot enable Analytics while the runtime feature is disabled', {
      code: 'YOUTUBE_ANALYTICS_DISABLED',
    });
  }
  return configured && requested;
}

function normalizeScheduledAt(value) {
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' ? value : requireJobText(value, 'scheduledAt'));
  if (Number.isNaN(date.getTime())) {
    throw permanentError('Scheduled time must be a valid instant', {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
    });
  }
  return date.toISOString();
}

function readScheduleTime(value, fieldName) {
  const text = requireJobText(value, fieldName);
  const match = /^(?:[01]\d|2[0-3]):([0-5]\d)$/u.exec(text);
  if (!match || Number(match[1]) % 5 !== 0) {
    throw permanentError(`${fieldName} must use HH:mm and a 5-minute boundary`, {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
      details: { fieldName, value: text },
    });
  }
  return text;
}

function readSupportedYouTubeAnalyticsTime(input) {
  const fieldName = 'MKT_YOUTUBE_ANALYTICS_TIME';
  const configuredTime = readScheduleTime(input.value, fieldName);
  const supportedTimes = listYouTubeCronLocalTimes(input.requestedAt, input.timeZone);
  if (!supportedTimes.includes(configuredTime)) {
    throw permanentError(`${fieldName} must match a local time reached by YOUTUBE_SCHEDULE_CRON`, {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
      details: { fieldName, supportedTimes },
    });
  }
  return configuredTime;
}

function listYouTubeCronLocalTimes(requestedAt, timeZone) {
  const anchor = new Date(normalizeScheduledAt(requestedAt));
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();
  return Object.freeze([...new Set(YOUTUBE_SCHEDULE_HOURS_UTC.map((hour) => (
    readZonedScheduleParts(
      new Date(Date.UTC(year, month, day, hour, YOUTUBE_SCHEDULE_MINUTE_UTC)),
      timeZone,
    ).time
  )))].sort());
}

function readScheduleWeekday(value, fieldName) {
  const text = requireJobText(value, fieldName).toLowerCase();
  if (!SCHEDULE_WEEKDAYS.has(text)) {
    throw permanentError(`${fieldName} must be an English weekday`, {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
      details: { fieldName, value: text },
    });
  }
  return text;
}

function optionalJobText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireJobText(value, 'event.cron');
}

function readBoundedPositiveInteger(value, fallback, maximum, fieldName) {
  const number = value === null || value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw permanentError(`${fieldName} must be an integer from 1 to ${maximum}`, {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return number;
}
