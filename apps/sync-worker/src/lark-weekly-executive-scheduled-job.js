import { addDaysDateOnly } from '../../../packages/application/src/reports/report-period.js';
import {
  JOB_SCHEMA_VERSIONS,
  JOB_TRIGGERS,
  JOB_TYPES,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { createStableQueueOperationBody } from '../../../packages/application/src/jobs/queue-operation.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import {
  PRIMARY_SCHEDULE_CRON,
  readZonedScheduleParts,
} from './scheduled-jobs.js';
import {
  readBoolean,
  requireJobText,
} from './worker-runtime-support.js';

const DEFAULT_WEEKLY_NOTIFICATION_TIME = '09:30';
const DEFAULT_WEEKLY_REPORT_TIME = '09:15';
const DEFAULT_WEEKLY_REPORT_WEEKDAY = 'monday';
const WEEKDAYS = new Set([
  'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
]);

/**
 * Build one period-bound automatic Weekly Executive orchestration job after the Shared 7D Report window.
 * Reuse the reviewed `lark.notification.send` Queue type, but mark this payload as an explicit
 * automatic Weekly orchestration request. The Worker resolves Fresh AI first; no destination or
 * message payload is admitted by the Cron producer.
 */
export function buildAutomaticWeeklyExecutiveScheduledJobs(input = {}) {
  const env = input.env ?? {};
  const event = input.event ?? {};
  if (String(event.cron ?? '') !== PRIMARY_SCHEDULE_CRON) return Object.freeze([]);
  if (!readBoolean(env.MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED, false)) {
    return Object.freeze([]);
  }

  requireEnabled(env, [
    'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
    'MKT_REPORT_D1_READ_ENABLED',
    'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
    'MKT_NOTIFICATION_RUNTIME_ENABLED',
    'MKT_NOTIFICATION_LARK_SEND_ENABLED',
    'MKT_NOTIFICATION_LARK_MIRROR_ENABLED',
  ]);
  const runtimeMode = requireJobText(
    env.MKT_NOTIFICATION_RUNTIME_MODE,
    'MKT_NOTIFICATION_RUNTIME_MODE',
  ).toLowerCase();
  if (runtimeMode !== 'runtime') {
    throw scheduleError('Automatic Weekly Notification requires runtime mode', {
      fieldName: 'MKT_NOTIFICATION_RUNTIME_MODE',
    });
  }

  const timeZone = requireJobText(env.DEFAULT_TIMEZONE ?? 'Asia/Bangkok', 'DEFAULT_TIMEZONE');
  const scheduledAt = normalizeScheduledAt(input.scheduledAt ?? event.scheduledTime);
  const local = readZonedScheduleParts(scheduledAt, timeZone);
  const weekday = readWeekday(
    env.MKT_WEEKLY_REPORT_WEEKDAY ?? DEFAULT_WEEKLY_REPORT_WEEKDAY,
    'MKT_WEEKLY_REPORT_WEEKDAY',
  );
  const reportTime = readScheduleTime(
    env.MKT_WEEKLY_REPORT_TIME ?? DEFAULT_WEEKLY_REPORT_TIME,
    'MKT_WEEKLY_REPORT_TIME',
  );
  const notificationTime = readScheduleTime(
    env.MKT_WEEKLY_NOTIFICATION_TIME ?? DEFAULT_WEEKLY_NOTIFICATION_TIME,
    'MKT_WEEKLY_NOTIFICATION_TIME',
  );
  if (minutesOfDay(notificationTime) <= minutesOfDay(reportTime)) {
    throw scheduleError('Weekly Notification time must be after Weekly Report time', {
      fieldName: 'MKT_WEEKLY_NOTIFICATION_TIME',
    });
  }
  if (local.weekday !== weekday || local.time !== notificationTime) return Object.freeze([]);

  const periodEnd = addDaysDateOnly(local.date, -1);
  const dateKey = periodEnd.replaceAll('-', '');
  const job = createStableQueueOperationBody({
    schemaVersion: JOB_SCHEMA_VERSIONS.LARK_NOTIFICATION_RUNTIME,
    type: JOB_TYPES.LARK_NOTIFICATION_SEND,
    trigger: JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME,
    automaticWeekly: true,
    periodEnd,
    scheduleCadence: 'weekly',
  }, {
    operationId: `weekly-executive-auto-${dateKey}`,
    originalRequestedAt: Date.parse(scheduledAt),
  });
  return Object.freeze([job]);
}

function requireEnabled(env, fieldNames) {
  const disabled = fieldNames.filter((fieldName) => !readBoolean(env[fieldName], false));
  if (disabled.length > 0) {
    throw scheduleError('Automatic Weekly Notification producer/runtime gates are inconsistent', {
      fieldName: disabled[0],
      disabled,
    });
  }
}

function readScheduleTime(value, fieldName) {
  const text = requireJobText(value, fieldName);
  const match = /^(?:[01]\d|2[0-3]):([0-5]\d)$/u.exec(text);
  if (!match || Number(match[1]) % 5 !== 0) {
    throw scheduleError(`${fieldName} must use HH:mm on a 5-minute boundary`, {
      fieldName,
    });
  }
  return text;
}

function readWeekday(value, fieldName) {
  const text = requireJobText(value, fieldName).toLowerCase();
  if (!WEEKDAYS.has(text)) {
    throw scheduleError(`${fieldName} must be an English weekday`, { fieldName });
  }
  return text;
}

function minutesOfDay(value) {
  const [hour, minute] = value.split(':').map(Number);
  return (hour * 60) + minute;
}

function normalizeScheduledAt(value) {
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' ? value : value ?? Number.NaN);
  if (Number.isNaN(date.getTime())) {
    throw scheduleError('Automatic Weekly Notification requires a valid scheduled instant');
  }
  return date.toISOString();
}

function scheduleError(message, details = {}) {
  return permanentError(message, {
    code: 'MKT_SCHEDULE_CONFIG_INVALID',
    details,
  });
}
