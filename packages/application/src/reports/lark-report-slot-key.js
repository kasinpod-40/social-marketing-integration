import { escapeReportIdentityPart } from '../use-cases/build-report-snapshot.js';

export const LARK_REPORT_SLOT_KEY_VERSION = 'lark-report-slot-v1';
export const LARK_REPORT_SLOT_KEY_FIELD = 'lark_slot_key';

/**
 * Lark is the customer-facing current materialization layer. Rolling report periods therefore
 * reuse one stable slot per customer/platform/account/report/window while D1 keeps the historical
 * report_id identities. Custom ranges intentionally remain request-scoped and do not collapse.
 */
export function buildLarkReportSlotBase(input = {}) {
  const periodKind = requireText(input.periodKind, 'periodKind');
  if (periodKind === 'custom_range') {
    return [
      LARK_REPORT_SLOT_KEY_VERSION,
      'custom',
      escapeReportIdentityPart(requireText(input.reportId, 'reportId')),
    ].join('::');
  }
  if (periodKind !== 'rolling_days') {
    throw new TypeError('Lark report slot periodKind must be rolling_days or custom_range');
  }

  return [
    LARK_REPORT_SLOT_KEY_VERSION,
    escapeReportIdentityPart(requireText(input.customerProfile, 'customerProfile')),
    escapeReportIdentityPart(requireText(input.customerKey, 'customerKey')),
    escapeReportIdentityPart(requireText(input.capability, 'capability')),
    escapeReportIdentityPart(requireText(input.platform, 'platform')),
    escapeReportIdentityPart(requireText(input.accountId, 'accountId')),
    escapeReportIdentityPart(requireText(input.reportType, 'reportType')),
    'rolling_days',
    `window:${positiveInteger(input.windowDays, 'windowDays')}`,
  ].join('::');
}

export function buildLarkMetricSlotKey(slotBase, reportMetricKey) {
  const suffix = stripReportIdentityPrefix(reportMetricKey, 'reportMetricKey');
  return `${requireText(slotBase, 'slotBase')}::metric::${suffix}`;
}

export function buildLarkTopContentSlotKey(slotBase, rank) {
  return `${requireText(slotBase, 'slotBase')}::content_rank:${positiveInteger(rank, 'rank')}`;
}

export function buildLarkTopAdsSlotKey(slotBase, rank) {
  return `${requireText(slotBase, 'slotBase')}::ad_rank:${positiveInteger(rank, 'rank')}`;
}

export function stripReportIdentityPrefix(value, fieldName = 'reportIdentity') {
  const text = requireText(value, fieldName);
  const separator = text.indexOf('::');
  if (separator < 0 || separator === text.length - 2) {
    throw new TypeError(`${fieldName} must contain a report identity prefix and stable suffix`);
  }
  return text.slice(separator + 2);
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}
