import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { JOB_TRIGGERS, JOB_TYPES } from '../jobs/job-catalog.js';
import { resolveReportPeriod } from './report-period.js';

/** Build one generic preset job; the caller decides whether and when to send it. */
export function buildDashboardPresetJob(input = {}) {
  const requestedAt = requireTimestamp(input.requestedAt ?? Date.now(), 'requestedAt');
  const period = resolveReportPeriod({
    periodKind: 'rolling_days',
    windowDays: input.windowDays,
    periodEnd: input.periodEnd,
    comparisonMode: input.comparisonMode ?? 'previous_period',
    timeZone: input.timeZone,
    now: new Date(requestedAt),
  });
  const trigger = input.trigger ?? JOB_TRIGGERS.DASHBOARD_PRESET;
  if (![JOB_TRIGGERS.DASHBOARD_PRESET, JOB_TRIGGERS.DASHBOARD_SCHEDULED].includes(trigger)) {
    throw new TypeError('Dashboard preset trigger is unsupported');
  }
  const sourceWatermark = optionalText(input.sourceWatermark);
  if (trigger === JOB_TRIGGERS.DASHBOARD_PRESET && !sourceWatermark) {
    throw new TypeError('sourceWatermark is required');
  }
  return Object.freeze({
    schemaVersion: 1,
    type: JOB_TYPES.REPORT_MATERIALIZATION_GENERATE,
    trigger,
    requestedAt: new Date(requestedAt).toISOString(),
    reportSettingKey: requireText(input.reportSettingKey, 'reportSettingKey'),
    platformScope: requireText(input.platformScope, 'platformScope'),
    periodKind: period.periodKind,
    windowDays: period.windowDays,
    periodEnd: period.periodEnd,
    comparisonMode: period.comparisonMode,
    ...(sourceWatermark ? { sourceWatermark } : {}),
  });
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/** Claim then enqueue one CUSTOM_RANGE request with a watermark-bound idempotency key. */
export async function admitDashboardReportRequest(input = {}) {
  const store = requireMethod(input.store, 'claim');
  const queue = requireMethod(input.queue, 'send');
  const requestedAt = requireTimestamp(input.requestedAt ?? Date.now(), 'requestedAt');
  const platformScope = requireText(input.platformScope, 'platformScope');
  const period = resolveReportPeriod({
    periodKind: 'custom_range',
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    comparisonMode: input.comparisonMode ?? 'previous_period',
    timeZone: input.timeZone,
    now: new Date(requestedAt),
    maxCustomRangeDays: input.maxCustomRangeDays,
  });
  const identity = Object.freeze({
    contract: 'dashboard-report-request-v1',
    customerKey: requireText(input.customerKey, 'customerKey'),
    accountKey: requireText(input.accountKey, 'accountKey'),
    platformScope,
    reportSettingKey: requireText(input.reportSettingKey, 'reportSettingKey'),
    formulaVersion: requireText(input.formulaVersion, 'formulaVersion'),
    sourceWatermark: requireText(input.sourceWatermark, 'sourceWatermark'),
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    comparisonMode: period.comparisonMode,
  });
  const requestId = `report-request:${platformScope}:${await createStableFingerprint(identity)}`;
  const claim = await store.claim({
    requestId,
    customerKey: identity.customerKey,
    accountKey: identity.accountKey,
    platformScope,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    comparisonMode: period.comparisonMode,
    requestedAt,
  });
  if ((!claim.created && claim.request.status === 'pending')
    || new Set(['processing', 'completed']).has(claim.request.status)) {
    return Object.freeze({ request: claim.request, enqueued: false, period });
  }
  await queue.send({
    schemaVersion: 1,
    type: JOB_TYPES.REPORT_MATERIALIZATION_GENERATE,
    trigger: 'dashboard_custom_range',
    requestedAt: new Date(requestedAt).toISOString(),
    reportRequestId: requestId,
    reportSettingKey: identity.reportSettingKey,
    platformScope,
    periodKind: 'custom_range',
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
    comparisonMode: period.comparisonMode,
    sourceWatermark: identity.sourceWatermark,
  });
  return Object.freeze({ request: claim.request, enqueued: true, period });
}

function requireMethod(value, method) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`dashboard report request requires ${method}`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function requireTimestamp(value, fieldName) {
  if (!Number.isSafeInteger(value) || value < 0) throw new TypeError(`${fieldName} must be an epoch millisecond`);
  return value;
}
