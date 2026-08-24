import { addDaysDateOnly } from '../../../packages/application/src/reports/report-period.js';
import { buildDashboardPresetJob } from '../../../packages/application/src/reports/dashboard-report-request.js';
import {
  REPORT_SOURCE_STATUS,
  listReportPlatformContracts,
} from '../../../packages/application/src/reports/report-platform-adapter-registry.js';
import { JOB_TRIGGERS, JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../../packages/application/src/jobs/queue-operation.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { readStorageRuntimeConfig } from '../../../packages/config/src/storage-runtime-config.js';
import { readMetaAdAccounts } from '../../../packages/config/src/meta-token-connection-config.js';
import { createDashboardReportSettingKey } from '../../../packages/config/src/report-settings.seed.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import {
  readBoolean,
  requireJobText,
} from './worker-runtime-support.js';

const DEFAULT_FACEBOOK_SYNC_TIME = '07:30';
const DEFAULT_TIKTOK_SYNC_TIME = '06:55';
const DEFAULT_INSTAGRAM_SYNC_TIME = '07:35';
const DEFAULT_DAILY_REPORT_TIME = '08:10';
const DEFAULT_CONTENT_DAILY_RETENTION_TIME = '08:05';
const DEFAULT_WEEKLY_REPORT_TIME = '08:15';
const DEFAULT_WEEKLY_REPORT_WEEKDAY = 'monday';
const DEFAULT_YOUTUBE_ANALYTICS_TIME = '07:50';
const DEFAULT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS = 7;
const DEFAULT_WOOCOMMERCE_SYNC_TIME = '01:30';
const DEFAULT_META_ADS_SYNC_TIME = '07:40';
const DEFAULT_CHATWOOT_SYNC_TIME = '07:45';
const DASHBOARD_WINDOWS = Object.freeze([1, 3, 7, 30]);
const SCHEDULED_REPORT_PLATFORM_SCOPES = Object.freeze(listReportPlatformContracts()
  .filter((contract) => contract.sourceStatus === REPORT_SOURCE_STATUS.ACTIVE)
  .map((contract) => contract.platformScope));
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
  const metaAdsEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_META_ADS_ENABLED, false)
    : false;
  const chatwootEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_CHATWOOT_ENABLED, false)
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
  const contentDailyRetentionEnabled = includePrimaryJobs
    ? readStorageRuntimeConfig(env).larkDailyRetentionEnabled
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
  if (metaAdsEnabled) {
    requireEnabledScheduleFlags(env, [
      'MKT_CONNECTOR_META_ADS_ENABLED',
      'MKT_META_SOURCE_READ_ENABLED',
      'MKT_META_D1_WRITE_ENABLED',
      'MKT_META_LARK_WRITE_ENABLED',
    ]);
  }
  if (chatwootEnabled) {
    requireEnabledScheduleFlags(env, [
      'MKT_CONNECTOR_CHATWOOT_ENABLED',
      'MKT_CHATWOOT_D1_WRITE_ENABLED',
      'MKT_CHATWOOT_LARK_WRITE_ENABLED',
      'MKT_CHATWOOT_REPORT_WRITE_ENABLED',
    ]);
    if (readBoolean(env.MKT_CHATWOOT_WEBHOOK_ENABLED, false)) {
      throw permanentError('Chatwoot scheduled polling cannot run with Webhook admission enabled', {
        code: 'MKT_SCHEDULE_CONFIG_INVALID',
        details: { fieldName: 'MKT_CHATWOOT_WEBHOOK_ENABLED' },
      });
    }
  }
  if (dailyEnabled || weeklyEnabled) {
    requireEnabledScheduleFlags(env, [
      'MKT_REPORT_D1_READ_ENABLED',
      'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
      'MKT_META_REPORT_READ_ENABLED',
      'MKT_WOOCOMMERCE_REPORT_READ_ENABLED',
    ]);
  }
  const needsLocalSchedule = tiktokEnabled
    || facebookEnabled
    || instagramEnabled
    || wooCommerceEnabled
    || metaAdsEnabled
    || chatwootEnabled
    || dailyEnabled
    || weeklyEnabled
    || contentDailyRetentionEnabled
    || youtubeEnabled;
  const timeZone = needsLocalSchedule
    ? requireJobText(env.DEFAULT_TIMEZONE ?? 'Asia/Bangkok', 'DEFAULT_TIMEZONE')
    : null;
  const local = needsLocalSchedule ? readZonedScheduleParts(requestedAt, timeZone) : null;
  const completedPeriodEnd = local ? addDaysDateOnly(local.date, -1) : null;
  const jobs = [];

  if (includePrimaryJobs && contentDailyRetentionEnabled) {
    const retentionTime = readScheduleTime(
      env.MKT_CONTENT_DAILY_RETENTION_TIME ?? DEFAULT_CONTENT_DAILY_RETENTION_TIME,
      'MKT_CONTENT_DAILY_RETENTION_TIME',
    );
    if (local.time === retentionTime) {
      jobs.push(createStableQueueOperationBody({
        schemaVersion: 1,
        type: JOB_TYPES.MKT_CONTENT_DAILY_RETENTION,
        trigger: JOB_TRIGGERS.MKT_CONTENT_DAILY_RETENTION_SCHEDULED,
        deferredPlatforms: readDeferredPlatforms(env.MKT_CONTENT_DAILY_RETENTION_DEFERRED_PLATFORMS),
      }, {
        operationId: `mkt-content-daily-retention-${local.date.replaceAll('-', '')}`,
        originalRequestedAt: Date.parse(requestedAt),
      }));
    }
  }

  if (includePrimaryJobs && tiktokEnabled) {
    const syncTime = readScheduleTime(
      env.MKT_TIKTOK_SYNC_TIME ?? DEFAULT_TIKTOK_SYNC_TIME,
      'MKT_TIKTOK_SYNC_TIME',
    );
    if (local.time === syncTime) {
      jobs.push(Object.freeze({
        schemaVersion: 1,
        type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_PROBE,
        trigger: 'scheduled',
        requestedAt,
        // Lark Native 07:00 เป็น Snapshot แรกหลังวันก่อนหน้าปิด จึงล็อกวันสมบูรณ์ล่าสุด.
        metricDate: completedPeriodEnd,
      }));
    }
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

  if (includePrimaryJobs && metaAdsEnabled) {
    const syncTime = readScheduleTime(
      env.MKT_META_ADS_SYNC_TIME ?? DEFAULT_META_ADS_SYNC_TIME,
      'MKT_META_ADS_SYNC_TIME',
    );
    if (local.time === syncTime) {
      const accounts = readMetaAdAccounts(
        env.META_AD_ACCOUNT_MAPPINGS,
        env.META_AD_ACCOUNT_ID,
      );
      if (accounts.length === 0) {
        throw permanentError('Meta Ads schedule requires at least one reviewed account mapping', {
          code: 'MKT_SCHEDULE_CONFIG_INVALID',
          details: { fieldName: 'META_AD_ACCOUNT_MAPPINGS' },
        });
      }
      for (const account of accounts) {
        const operationId = `meta-ads-${account.key}-scheduled-${completedPeriodEnd.replaceAll('-', '')}`;
        jobs.push(createStableQueueOperationBody({
          schemaVersion: 1,
          type: JOB_TYPES.META_ADS_SYNC,
          trigger: JOB_TRIGGERS.META_ORGANIC_SCHEDULED,
          sourceAccountKey: account.key,
          dryRun: false,
          d1Only: false,
          periodStart: completedPeriodEnd,
          periodEnd: completedPeriodEnd,
        }, {
          operationId,
          originalRequestedAt: Date.parse(requestedAt),
        }));
      }
    }
  }

  if (includePrimaryJobs && chatwootEnabled) {
    const syncTime = readScheduleTime(
      env.MKT_CHATWOOT_SYNC_TIME ?? DEFAULT_CHATWOOT_SYNC_TIME,
      'MKT_CHATWOOT_SYNC_TIME',
    );
    if (local.time === syncTime) {
      const runtime = loadCustomerRuntimeConfig(env);
      const accountKey = requireJobText(
        runtime.connectors.chatwoot?.accountKey,
        'connectors.chatwoot.accountKey',
      );
      const operationId = `chatwoot-daily-${completedPeriodEnd.replaceAll('-', '')}`;
      jobs.push(createStableQueueOperationBody({
        schemaVersion: 1,
        type: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC,
        trigger: JOB_TRIGGERS.CHATWOOT_SCHEDULED_DAILY,
        accountKey,
        dryRun: false,
      }, {
        operationId,
        originalRequestedAt: Date.parse(requestedAt),
      }));
    }
  }

  if (includePrimaryJobs && dailyEnabled) {
    const dailyTime = readScheduleTime(env.MKT_DAILY_REPORT_TIME ?? DEFAULT_DAILY_REPORT_TIME, 'MKT_DAILY_REPORT_TIME');
    if (local.time === dailyTime) {
      jobs.push(...buildScheduledDashboardJobs({
        cadence: 'daily',
        env,
        periodEnd: completedPeriodEnd,
        requestedAt,
        windowDays: DASHBOARD_WINDOWS,
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
      jobs.push(...buildScheduledDashboardJobs({
        cadence: 'weekly',
        env,
        periodEnd: completedPeriodEnd,
        requestedAt,
        windowDays: [7],
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

function buildScheduledDashboardJobs(input) {
  const requestedAt = Date.parse(input.requestedAt);
  const profileKey = requireJobText(input.env.MKT_CUSTOMER_PROFILE, 'MKT_CUSTOMER_PROFILE');
  return Object.freeze(SCHEDULED_REPORT_PLATFORM_SCOPES.flatMap((platformScope) => (
    input.windowDays.map((windowDays) => {
      const preset = buildDashboardPresetJob({
        trigger: JOB_TRIGGERS.DASHBOARD_SCHEDULED,
        requestedAt,
        periodEnd: input.periodEnd,
        timeZone: input.env.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
        windowDays,
        platformScope,
        reportSettingKey: createDashboardReportSettingKey({
          profileKey,
          platformScope,
          windowDays,
        }),
      });
      const operationId = [
        'report', input.cadence, platformScope, `${windowDays}d`,
        input.periodEnd.replaceAll('-', ''),
      ].join('-');
      return createStableQueueOperationBody({
        ...preset,
        scheduleCadence: input.cadence,
      }, {
        operationId,
        originalRequestedAt: requestedAt,
      });
    })
  )));
}

function requireEnabledScheduleFlags(env, fieldNames) {
  const disabled = fieldNames.filter((fieldName) => !readBoolean(env[fieldName], false));
  if (disabled.length > 0) {
    throw permanentError('Scheduled producer and consumer runtime gates are inconsistent', {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
      details: { fieldName: disabled[0], disabled },
    });
  }
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

function readDeferredPlatforms(value) {
  if (value === null || value === undefined || value === '') return Object.freeze([]);
  const platforms = String(value).split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (platforms.some((platform) => !/^[a-z][a-z0-9_-]*$/u.test(platform))) {
    throw permanentError('MKT_CONTENT_DAILY_RETENTION_DEFERRED_PLATFORMS is invalid', {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
      details: { fieldName: 'MKT_CONTENT_DAILY_RETENTION_DEFERRED_PLATFORMS' },
    });
  }
  return Object.freeze([...new Set(platforms)].sort());
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
