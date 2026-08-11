import {
  createReportId,
} from '../storage/marketing-history-contract.js';
import {
  createDashboardReportSettingKey,
} from '../../../config/src/report-settings.seed.js';
import {
  getReportPlatformContract,
} from './report-platform-adapter-registry.js';

/**
 * Rebuild exact Dashboard Report identities from the same shared contracts used by materialization.
 *
 * This intentionally does not parse report_id text. Callers supply the reviewed platform set and
 * period; the canonical Setting key, platform formula version and Report ID builders remain the
 * only identity authorities.
 */
export function resolveDashboardReportSourceAuthority(input = {}) {
  const sourceReportIds = uniqueTextList(input.sourceReportIds, 'sourceReportIds');
  const platformScopes = uniqueTextList(input.platformScopes, 'platformScopes');
  const profileKey = requireText(input.profileKey, 'profileKey');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const periodKind = requireExact(input.periodKind ?? 'rolling_days', 'rolling_days', 'periodKind');
  const periodStart = requireDateOnly(input.periodStart, 'periodStart');
  const periodEnd = requireDateOnly(input.periodEnd, 'periodEnd');
  const windowDays = positiveInteger(input.windowDays, 'windowDays');

  const authorities = platformScopes.map((platformScope) => {
    const contract = getReportPlatformContract(platformScope);
    const reportSettingKey = createDashboardReportSettingKey({
      profileKey,
      platformScope: contract.platformScope,
      windowDays,
    });
    const reportId = createReportId({
      report_setting_key: reportSettingKey,
      account_key: accountKey,
      period_kind: periodKind,
      period_start: periodStart,
      period_end: periodEnd,
      formula_version: contract.formulaVersion,
    });
    return Object.freeze({
      platformScope: contract.platformScope,
      capability: contract.capability,
      reportSettingKey,
      formulaVersion: contract.formulaVersion,
      reportId,
    });
  });

  const expectedIds = authorities.map(({ reportId }) => reportId).sort();
  const observedIds = [...sourceReportIds].sort();
  if (JSON.stringify(expectedIds) !== JSON.stringify(observedIds)) {
    throw authorityError(
      'Source Report identities do not match the canonical Dashboard Report contracts',
      'DASHBOARD_REPORT_SOURCE_AUTHORITY_MISMATCH',
      {
        expectedCount: expectedIds.length,
        observedCount: observedIds.length,
        missingCount: expectedIds.filter((value) => !observedIds.includes(value)).length,
        unexpectedCount: observedIds.filter((value) => !expectedIds.includes(value)).length,
      },
    );
  }

  return deepFreeze({
    sourceReportIds: Object.freeze(observedIds),
    platformScopes: Object.freeze([...platformScopes]),
    profileKey,
    accountKey,
    periodKind,
    periodStart,
    periodEnd,
    windowDays,
    reportSettingKeys: Object.freeze(authorities.map(({ reportSettingKey }) => reportSettingKey).sort()),
    authorities: Object.freeze(authorities),
  });
}

function uniqueTextList(value, label) {
  if (!Array.isArray(value) || value.length === 0) {
    throw new TypeError(`${label} must be a non-empty array`);
  }
  const rows = value.map((item) => requireText(item, label));
  if (new Set(rows).size !== rows.length) {
    throw new TypeError(`${label} must not contain duplicates`);
  }
  return Object.freeze(rows);
}
function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} is required`);
  }
  return value.trim();
}
function requireExact(value, expected, label) {
  const text = requireText(value, label);
  if (text !== expected) throw new TypeError(`${label} must be ${expected}`);
  return text;
}
function requireDateOnly(value, label) {
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new TypeError(`${label} must be YYYY-MM-DD`);
  return text;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${label} must be a positive integer`);
  return number;
}
function authorityError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'DashboardReportSourceAuthorityError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
