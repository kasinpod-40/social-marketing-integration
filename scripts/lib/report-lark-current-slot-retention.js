import {
  buildLarkMetricSlotKey,
  buildLarkReportSlotBase,
  buildLarkTopAdsSlotKey,
  buildLarkTopContentSlotKey,
  LARK_REPORT_SLOT_KEY_FIELD,
} from '../../packages/application/src/reports/lark-report-slot-key.js';

export const REPORT_LARK_CURRENT_SLOT_RETENTION_VERSION = 'report-lark-current-slot-retention-v1';
export const REPORT_LARK_CURRENT_SLOT_RETENTION_CONFIRMATION = 'APPLY_REPORT_LARK_CURRENT_SLOT_RETENTION_V1';

const DASHBOARD_REPORT_TYPE = 'dashboard_performance_report';
const TABLE_ROLES = Object.freeze({
  snapshots: Object.freeze({
    tableName: '🧾 MKT_Report_Snapshots',
    primaryKey: 'report_id',
  }),
  metrics: Object.freeze({
    tableName: '📊 MKT_Report_Metric_Values',
    primaryKey: 'report_metric_key',
  }),
  topContent: Object.freeze({
    tableName: '🏆 MKT_Report_Top_Content',
    primaryKey: 'report_content_key',
  }),
  topAds: Object.freeze({
    tableName: '📣 MKT_Report_Top_Ads',
    primaryKey: 'report_ad_key',
  }),
});

export function reportLarkCurrentSlotTableRoles() {
  return TABLE_ROLES;
}

export function assertReportLarkCurrentSlotRetentionConfirmation(value) {
  if (value !== REPORT_LARK_CURRENT_SLOT_RETENTION_CONFIRMATION) {
    throw operatorError(
      'Report Lark current-slot retention confirmation is missing',
      'REPORT_LARK_CURRENT_SLOT_CONFIRMATION_REQUIRED',
    );
  }
}

export function planReportLarkCurrentSlotRetention(input = {}) {
  const role = requireRole(input.role);
  const records = requireArray(input.records, 'records');
  const managed = [];
  const legacyPreserved = [];

  for (const record of records) {
    const classified = classifyRecord(role, record);
    if (classified.kind === 'legacy_preserved') legacyPreserved.push(classified);
    else managed.push(classified);
  }

  const retainBySlot = new Map();
  for (const row of managed) {
    const previous = retainBySlot.get(row.slotKey);
    if (!previous || compareLatest(row, previous) > 0) retainBySlot.set(row.slotKey, row);
  }

  const retainedRecordIds = new Set([...retainBySlot.values()].map((row) => row.recordId));
  const updates = [];
  const deletes = [];
  let customRangeCount = 0;

  for (const row of managed) {
    if (row.periodKind === 'custom_range') customRangeCount += 1;
    if (!retainedRecordIds.has(row.recordId)) {
      deletes.push(Object.freeze({
        recordId: row.recordId,
        slotKey: row.slotKey,
        periodEnd: row.periodEnd,
        generatedAt: row.generatedAt,
        primaryValue: row.primaryValue,
      }));
      continue;
    }
    if (row.existingSlotKey !== row.slotKey) {
      updates.push(Object.freeze({
        recordId: row.recordId,
        slotKey: row.slotKey,
        fields: Object.freeze({ [LARK_REPORT_SLOT_KEY_FIELD]: row.slotKey }),
      }));
    }
  }

  const rollingSlotCount = [...retainBySlot.values()]
    .filter((row) => row.periodKind === 'rolling_days').length;
  const customSlotCount = retainBySlot.size - rollingSlotCount;
  const managedRetainedCount = retainBySlot.size;

  return Object.freeze({
    role,
    recordCount: records.length,
    managedRecordCount: managed.length,
    managedRetainedCount,
    legacyPreservedCount: legacyPreserved.length,
    retainedCount: managedRetainedCount + legacyPreserved.length,
    staleDeleteCount: deletes.length,
    slotKeyUpdateCount: updates.length,
    rollingSlotCount,
    customSlotCount,
    customRangeRecordCount: customRangeCount,
    updates: Object.freeze(updates),
    deletes: Object.freeze(deletes),
    retained: Object.freeze([...retainBySlot.values()].map((row) => Object.freeze({
      recordId: row.recordId,
      slotKey: row.slotKey,
      periodEnd: row.periodEnd,
      generatedAt: row.generatedAt,
      primaryValue: row.primaryValue,
    }))),
    legacyPreserved: Object.freeze(legacyPreserved.map((row) => Object.freeze({
      recordId: row.recordId,
      primaryValue: row.primaryValue,
      reportType: row.reportType,
      reason: row.reason,
    }))),
  });
}

function classifyRecord(role, record) {
  const source = requireObject(record, 'record');
  const recordId = requireText(source.recordId ?? source.record_id, 'recordId');
  const fields = requireObject(source.fields ?? {}, 'record.fields');
  const primaryValue = optionalText(fields[TABLE_ROLES[role].primaryKey]);
  const periodKind = optionalText(fields.period_kind);
  const reportType = optionalText(fields.report_type);

  // Rows created before the dashboard materialization contract may not have period_kind at all.
  // They are historical non-dashboard presentation rows and are preserved untouched. A dashboard
  // row missing period_kind is malformed current materialization and must still fail closed.
  if (!periodKind) {
    if (reportType === DASHBOARD_REPORT_TYPE) {
      throw operatorError(
        'Dashboard Report row is missing period_kind',
        'REPORT_LARK_CURRENT_SLOT_DASHBOARD_PERIOD_KIND_REQUIRED',
        { role, recordId, primaryValue },
      );
    }
    return Object.freeze({
      kind: 'legacy_preserved',
      recordId,
      primaryValue,
      reportType,
      reason: 'legacy_non_dashboard_missing_period_kind',
    });
  }

  return normalizeManagedRecord(role, {
    recordId,
    fields,
    primaryValue: requireText(primaryValue, TABLE_ROLES[role].primaryKey),
    periodKind,
  });
}

function normalizeManagedRecord(role, input) {
  const fields = input.fields;
  const reportId = requireText(fields.report_id, 'report_id');
  const slotBase = buildLarkReportSlotBase({
    reportId,
    customerProfile: requireText(fields.customer_profile, 'customer_profile'),
    customerKey: requireText(fields.customer_key, 'customer_key'),
    capability: requireText(fields.capability, 'capability'),
    platform: normalizePlatform(fields.platform),
    accountId: requireText(fields.account_id, 'account_id'),
    reportType: requireText(fields.report_type, 'report_type'),
    periodKind: input.periodKind,
    windowDays: fields.window_days,
  });
  const slotKey = buildRoleSlotKey(role, slotBase, fields, input.primaryValue);
  return Object.freeze({
    kind: 'managed',
    recordId: input.recordId,
    fields,
    primaryValue: input.primaryValue,
    periodKind: input.periodKind,
    periodEnd: requireEpoch(fields.period_end, 'period_end'),
    generatedAt: requireEpoch(fields.generated_at, 'generated_at'),
    existingSlotKey: optionalText(fields[LARK_REPORT_SLOT_KEY_FIELD]),
    slotKey,
  });
}

function buildRoleSlotKey(role, slotBase, fields, primaryValue) {
  if (role === 'snapshots') return slotBase;
  if (role === 'metrics') return buildLarkMetricSlotKey(slotBase, primaryValue);
  if (role === 'topContent') {
    return buildLarkTopContentSlotKey(slotBase, positiveInteger(fields.rank, 'rank'));
  }
  if (role === 'topAds') {
    return buildLarkTopAdsSlotKey(slotBase, positiveInteger(fields.rank, 'rank'));
  }
  throw new TypeError(`Unsupported report Lark retention role: ${role}`);
}

function compareLatest(left, right) {
  if (left.periodEnd !== right.periodEnd) return left.periodEnd - right.periodEnd;
  if (left.generatedAt !== right.generatedAt) return left.generatedAt - right.generatedAt;
  return left.recordId.localeCompare(right.recordId);
}

function normalizePlatform(value) {
  if (Array.isArray(value)) {
    if (value.length !== 1) throw new TypeError('platform must resolve to exactly one value');
    return requireText(value[0], 'platform');
  }
  return requireText(value, 'platform');
}

function requireRole(value) {
  const role = requireText(value, 'role');
  if (!Object.hasOwn(TABLE_ROLES, role)) throw new TypeError(`Unknown report Lark retention role: ${role}`);
  return role;
}

function requireEpoch(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive epoch`);
  return Math.trunc(number);
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
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

function operatorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportLarkCurrentSlotRetentionError';
  error.code = code;
  error.details = Object.freeze(details);
  return error;
}
