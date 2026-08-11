import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildAutomaticWeeklyExecutiveScheduledJobs,
} from '../../apps/sync-worker/src/lark-weekly-executive-scheduled-job.js';
import { PRIMARY_SCHEDULE_CRON } from '../../apps/sync-worker/src/scheduled-jobs.js';

const BASE_ENV = Object.freeze({
  DEFAULT_TIMEZONE: 'Asia/Bangkok',
  MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED: 'true',
  MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: 'true',
  MKT_REPORT_D1_READ_ENABLED: 'true',
  MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: 'true',
  MKT_NOTIFICATION_RUNTIME_ENABLED: 'true',
  MKT_NOTIFICATION_LARK_SEND_ENABLED: 'true',
  MKT_NOTIFICATION_LARK_MIRROR_ENABLED: 'true',
  MKT_NOTIFICATION_RUNTIME_MODE: 'runtime',
  MKT_WEEKLY_REPORT_TIME: '08:15',
  MKT_WEEKLY_REPORT_WEEKDAY: 'monday',
  MKT_WEEKLY_NOTIFICATION_TIME: '08:30',
});

function buildAt(iso, env = BASE_ENV) {
  return buildAutomaticWeeklyExecutiveScheduledJobs({
    event: { cron: PRIMARY_SCHEDULE_CRON, scheduledTime: Date.parse(iso) },
    scheduledAt: iso,
    env,
  });
}

test('automatic Weekly Executive queues one period-bound stable orchestration after Weekly Report', () => {
  const jobs = buildAt('2026-08-17T01:30:00.000Z');
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].type, 'lark.notification.send');
  assert.equal(jobs[0].trigger, 'lark_notification_runtime');
  assert.equal(jobs[0].automaticWeekly, true);
  assert.equal(jobs[0].scheduleCadence, 'weekly');
  assert.equal(jobs[0].periodEnd, '2026-08-16');
  assert.equal(jobs[0].operationId, 'weekly-executive-auto-20260816');
  assert.equal(jobs[0].workKey, 'lark_notification:weekly-executive-auto-20260816');
  assert.equal(jobs[0].generation, Date.parse('2026-08-17T01:30:00.000Z'));
  assert.equal(jobs[0].originalRequestedAt, jobs[0].generation);
});

test('automatic Weekly Executive remains absent when schedule gate is off or not due', () => {
  assert.deepEqual(buildAt('2026-08-17T01:25:00.000Z'), []);
  assert.deepEqual(buildAt('2026-08-18T01:30:00.000Z'), []);
  assert.deepEqual(buildAt('2026-08-17T01:30:00.000Z', {
    ...BASE_ENV,
    MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED: 'false',
  }), []);
});

test('automatic Weekly Executive fails closed when runtime gates are incomplete', () => {
  assert.throws(() => buildAt('2026-08-17T01:30:00.000Z', {
    ...BASE_ENV,
    MKT_NOTIFICATION_LARK_MIRROR_ENABLED: 'false',
  }), (error) => error?.code === 'MKT_SCHEDULE_CONFIG_INVALID'
    && error?.details?.fieldName === 'MKT_NOTIFICATION_LARK_MIRROR_ENABLED');

  assert.throws(() => buildAt('2026-08-17T01:30:00.000Z', {
    ...BASE_ENV,
    MKT_NOTIFICATION_RUNTIME_MODE: 'controlled_uat',
  }), (error) => error?.code === 'MKT_SCHEDULE_CONFIG_INVALID'
    && error?.details?.fieldName === 'MKT_NOTIFICATION_RUNTIME_MODE');
});

test('automatic Weekly Executive time must be after the Weekly Report time', () => {
  assert.throws(() => buildAt('2026-08-17T01:15:00.000Z', {
    ...BASE_ENV,
    MKT_WEEKLY_NOTIFICATION_TIME: '08:15',
  }), (error) => error?.code === 'MKT_SCHEDULE_CONFIG_INVALID'
    && error?.details?.fieldName === 'MKT_WEEKLY_NOTIFICATION_TIME');
});
