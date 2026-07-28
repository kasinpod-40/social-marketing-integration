import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { createReportId } from '../storage/marketing-history-contract.js';
import { inclusiveDayCount } from './report-period.js';

/** Persist one platform-neutral Dashboard materialization through the shared D1 store. */
export async function saveDashboardReportMaterialization(input = {}) {
  const store = requireMethod(input.store, 'saveReportMaterialization');
  const result = requireObject(input.result, 'result');
  const period = requireObject(result.period, 'result.period');
  const platformScope = requireText(input.platformScope ?? result.platform, 'platformScope');
  const formulaVersion = requireText(input.formulaVersion, 'formulaVersion');
  const periodKind = requireText(period.periodKind ?? input.periodKind ?? 'rolling_days', 'periodKind');
  const windowDays = inclusiveDayCount(period.periodStart, period.periodEnd);
  const payload = Object.freeze({
    schemaVersion: requireText(input.schemaVersion, 'schemaVersion'),
    sourceReportId: result.reportId,
    platformScope,
    reportType: result.reportType,
    period,
    dataStatus: result.dataStatus,
    coverageRate: input.coverageRate ?? result.baselineCoverageRate ?? null,
    metricPayload: result.metricPayload,
    topContentCount: result.topContentCount ?? 0,
    topAdsCount: result.topAdsCount ?? 0,
  });
  const payloadChecksum = await createStableFingerprint(payload);
  const generatedAt = requireTimestamp(input.generatedAt, 'generatedAt');
  const reportId = createReportId({
    report_setting_key: result.reportSettingKey,
    account_key: requireText(input.accountKey, 'accountKey'),
    period_kind: periodKind,
    period_start: period.periodStart,
    period_end: period.periodEnd,
    formula_version: formulaVersion,
  });
  const write = await store.saveReportMaterialization({
    report_id: reportId,
    report_setting_key: result.reportSettingKey,
    customer_key: requireText(input.customerKey, 'customerKey'),
    platform_scope: platformScope,
    account_key: requireText(input.accountKey, 'accountKey'),
    report_type: result.reportType,
    period_kind: periodKind,
    window_days: periodKind === 'rolling_days' ? windowDays : null,
    period_start: period.periodStart,
    period_end: period.periodEnd,
    compare_start: period.compareStart,
    compare_end: period.compareEnd,
    data_status: normalizeDataStatus(result.dataStatus),
    coverage_rate: input.coverageRate ?? result.baselineCoverageRate ?? null,
    formula_version: formulaVersion,
    source_watermark: input.sourceWatermark ?? null,
    payload_json: JSON.stringify(payload),
    payload_checksum: payloadChecksum,
    generated_at: generatedAt,
    expires_at: input.expiresAt ?? null,
    created_at: generatedAt,
    updated_at: generatedAt,
  });
  return Object.freeze({ ...write, reportId, sourceReportId: result.reportId, payloadChecksum });
}

function normalizeDataStatus(value) {
  return value === 'no_data' ? 'no_data_confirmed' : value;
}

function requireMethod(value, method) {
  if (typeof value?.[method] !== 'function') throw new TypeError(`report materialization requires store.${method}`);
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
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
