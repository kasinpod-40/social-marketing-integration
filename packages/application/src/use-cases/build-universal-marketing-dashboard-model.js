import { validateReportMaterializationPayload } from '../reports/report-materialization-payload.js';
import {
  UNIVERSAL_MARKETING_DASHBOARD_CONTRACT,
  UNIVERSAL_MARKETING_DASHBOARD_VERSION,
  validateUniversalMarketingDashboardContract,
} from '../../../config/src/universal-marketing-dashboard-contract.js';

const COMPLETE_STATUS = 'complete';

/**
 * Build a renderer-neutral Dashboard model from validated Report materializations only.
 * Platforms, capabilities, accounts, metrics and collection kinds are discovered from records.
 */
export function buildUniversalMarketingDashboardModel(input = {}) {
  validateUniversalMarketingDashboardContract(input.contract ?? UNIVERSAL_MARKETING_DASHBOARD_CONTRACT);
  const materializations = requireArray(input.materializations, 'materializations')
    .map((item, index) => normalizeMaterialization(item, index));
  const selection = normalizeSelection(input.selection ?? {});
  const selected = materializations.filter((item) => matchesSelection(item, selection));
  const reports = selected.sort(compareMaterializations).map(buildReportModel);
  const sections = buildSections(reports);
  const warnings = reports.flatMap((report) => report.dataQuality.warnings);

  return deepFreeze({
    schemaVersion: UNIVERSAL_MARKETING_DASHBOARD_VERSION,
    source: 'validated_report_materializations',
    discovery: buildDiscovery(materializations),
    selection,
    reportCount: reports.length,
    reports,
    sections,
    dataQuality: {
      status: warnings.length === 0 ? COMPLETE_STATUS : 'attention_required',
      warningCount: warnings.length,
      warnings,
    },
  });
}

function normalizeMaterialization(value, index) {
  const item = requireObject(value, `materializations[${index}]`);
  const row = optionalObject(item.row) ?? {};
  const payload = validateReportMaterializationPayload(item.payload ?? row.payload);
  return Object.freeze({
    reportId: requireText(item.reportId ?? row.report_id, `materializations[${index}].reportId`),
    reportSettingKey: requireText(
      item.reportSettingKey ?? row.report_setting_key,
      `materializations[${index}].reportSettingKey`,
    ),
    customerKey: optionalText(item.customerKey ?? row.customer_key),
    customerProfile: optionalText(item.customerProfile ?? row.customer_profile),
    accountId: requireText(
      item.accountId ?? row.account_key ?? row.account_id,
      `materializations[${index}].accountId`,
    ),
    generatedAt: requireEpoch(item.generatedAt ?? row.generated_at ?? payload.generatedAt, 'generatedAt'),
    payload,
  });
}

function buildReportModel(item) {
  const cards = Object.entries(item.payload.metricPayload)
    .map(([fallbackKey, metric]) => normalizeMetric(metric, fallbackKey))
    .filter((metric) => metric.clientVisible)
    .sort(compareMetrics);
  const collections = buildCollections(item.payload);
  const warnings = buildDataQualityWarnings(item);

  return Object.freeze({
    reportId: item.reportId,
    reportSettingKey: item.reportSettingKey,
    customerKey: item.customerKey,
    customerProfile: item.customerProfile,
    platform: item.payload.platformScope,
    capability: item.payload.capability,
    accountId: item.accountId,
    reportType: item.payload.reportType,
    period: item.payload.period,
    generatedAt: item.generatedAt,
    cards,
    collections,
    rankings: collections,
    dataQuality: Object.freeze({
      dataStatus: item.payload.dataStatus,
      coverageRate: item.payload.coverageRate,
      warnings,
    }),
  });
}

function normalizeMetric(value, fallbackKey) {
  const metric = requireObject(value, `metricPayload.${fallbackKey}`);
  return Object.freeze({
    metricKey: requireText(metric.metricKey ?? fallbackKey, 'metric.metricKey'),
    displayName: requireText(metric.displayName ?? metric.metricKey ?? fallbackKey, 'metric.displayName'),
    unit: requireText(metric.unit ?? 'count', 'metric.unit'),
    current: optionalFinite(metric.current, 'metric.current'),
    compare: optionalFinite(metric.compare, 'metric.compare'),
    change: optionalFinite(metric.change, 'metric.change'),
    changePercent: optionalFinite(metric.changePercent, 'metric.changePercent'),
    sortOrder: finiteOrDefault(metric.sortOrder, 1_000),
    clientVisible: metric.clientVisible === true,
    formulaVersion: optionalText(metric.formulaVersion),
  });
}

function buildCollections(payload) {
  const entries = new Map(Object.entries(payload.collections ?? {}));
  if (!entries.has('top_content') && payload.topContent.length > 0) entries.set('top_content', payload.topContent);
  if (!entries.has('top_ads') && payload.topAds.length > 0) entries.set('top_ads', payload.topAds);
  return Object.freeze([...entries.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([kind, rows]) => buildCollection(kind, rows)));
}

function buildCollection(kind, rows) {
  return Object.freeze({
    kind,
    rows: requireArray(rows, kind).map((row, index) => {
      const normalized = requireObject(row, `${kind}[${index}]`);
      return deepFreeze({
        ...normalized,
        rank: Number.isSafeInteger(Number(normalized.rank)) ? Number(normalized.rank) : index + 1,
      });
    }),
  });
}

function buildSections(reports) {
  const grouped = new Map();
  for (const report of reports) {
    const list = grouped.get(report.capability) ?? [];
    list.push(report);
    grouped.set(report.capability, list);
  }
  return Object.freeze([...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([capability, capabilityReports]) => Object.freeze({
      capability,
      reportCount: capabilityReports.length,
      platforms: uniqueSorted(capabilityReports.map((report) => report.platform)),
      accountIds: uniqueSorted(capabilityReports.map((report) => report.accountId)),
      collectionKinds: uniqueSorted(capabilityReports.flatMap((report) => report.collections.map((item) => item.kind))),
      reports: Object.freeze(capabilityReports),
    })));
}

function buildDiscovery(materializations) {
  return Object.freeze({
    customerKeys: uniqueSorted(materializations.map((item) => item.customerKey).filter(Boolean)),
    customerProfiles: uniqueSorted(materializations.map((item) => item.customerProfile).filter(Boolean)),
    platforms: uniqueSorted(materializations.map((item) => item.payload.platformScope)),
    capabilities: uniqueSorted(materializations.map((item) => item.payload.capability)),
    accountIds: uniqueSorted(materializations.map((item) => item.accountId)),
    periodKinds: uniqueSorted(materializations.map((item) => item.payload.period.periodKind)),
    windowDays: uniqueNumbers(materializations.map((item) => item.payload.period.windowDays).filter((value) => value !== null)),
    reportSettingKeys: uniqueSorted(materializations.map((item) => item.reportSettingKey)),
    collectionKinds: uniqueSorted(materializations.flatMap((item) => discoverCollectionKinds(item.payload))),
  });
}

function discoverCollectionKinds(payload) {
  const kinds = Object.keys(payload.collections ?? {});
  if (payload.topContent.length > 0 && !kinds.includes('top_content')) kinds.push('top_content');
  if (payload.topAds.length > 0 && !kinds.includes('top_ads')) kinds.push('top_ads');
  return kinds;
}

function buildDataQualityWarnings(item) {
  const warnings = [];
  if (item.payload.dataStatus !== COMPLETE_STATUS) {
    warnings.push(Object.freeze({
      code: 'DASHBOARD_DATA_STATUS_NOT_COMPLETE',
      reportId: item.reportId,
      platform: item.payload.platformScope,
      dataStatus: item.payload.dataStatus,
    }));
  }
  if (item.payload.coverageRate !== null && item.payload.coverageRate < 1) {
    warnings.push(Object.freeze({
      code: 'DASHBOARD_COVERAGE_PARTIAL',
      reportId: item.reportId,
      platform: item.payload.platformScope,
      coverageRate: item.payload.coverageRate,
    }));
  }
  return Object.freeze(warnings);
}

function normalizeSelection(value) {
  const selection = requireObject(value, 'selection');
  return Object.freeze({
    customerKey: optionalText(selection.customerKey),
    customerProfile: optionalText(selection.customerProfile),
    platform: optionalText(selection.platform),
    capability: optionalText(selection.capability),
    accountId: optionalText(selection.accountId),
    periodKind: optionalText(selection.periodKind),
    windowDays: optionalPositiveInteger(selection.windowDays),
    reportSettingKey: optionalText(selection.reportSettingKey),
  });
}

function matchesSelection(item, selection) {
  return (!selection.customerKey || item.customerKey === selection.customerKey)
    && (!selection.customerProfile || item.customerProfile === selection.customerProfile)
    && (!selection.platform || item.payload.platformScope === selection.platform)
    && (!selection.capability || item.payload.capability === selection.capability)
    && (!selection.accountId || item.accountId === selection.accountId)
    && (!selection.periodKind || item.payload.period.periodKind === selection.periodKind)
    && (!selection.windowDays || item.payload.period.windowDays === selection.windowDays)
    && (!selection.reportSettingKey || item.reportSettingKey === selection.reportSettingKey);
}

function compareMaterializations(left, right) {
  return right.generatedAt - left.generatedAt
    || left.payload.platformScope.localeCompare(right.payload.platformScope)
    || left.accountId.localeCompare(right.accountId)
    || left.reportId.localeCompare(right.reportId);
}
function compareMetrics(left, right) {
  return left.sortOrder - right.sortOrder || left.metricKey.localeCompare(right.metricKey);
}
function uniqueSorted(values) { return Object.freeze([...new Set(values)].sort()); }
function uniqueNumbers(values) { return Object.freeze([...new Set(values)].sort((left, right) => left - right)); }
function optionalPositiveInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError('selection.windowDays must be positive');
  return number;
}
function optionalFinite(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${fieldName} must be finite`);
  return number;
}
function finiteOrDefault(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}
function requireEpoch(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be epoch milliseconds`);
  return number;
}
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function optionalObject(value) { return value && typeof value === 'object' && !Array.isArray(value) ? value : null; }
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
