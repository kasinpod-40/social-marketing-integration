import {
  createReportSettingRowsForProfile,
  LEGACY_REPORT_SETTING_KEYS,
} from '../../../config/src/report-settings.seed.js';
import { readLarkText } from '../../../connectors/src/shared/lark-cell-value.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const LEGACY_PROFILES = new Set(['dev_ft_pumkin', 'uat_chemistry_k']);

/**
 * วางแผน Canonical upsert และ exact-key legacy retirement โดยไม่เขียน Lark
 * Legacy rows ถูก Disable เท่านั้นเพื่อรักษา Historical report lineage
 */
export async function planDashboardReportSettingsReconciliation(input = {}) {
  const repository = requireRepository(input.repository);
  const syncEngine = requireSyncEngine(input.syncEngine);
  const tableId = requireText(input.tableId, 'tableId');
  const profileKey = requireText(input.profileKey, 'profileKey');
  if (profileKey !== 'integration_workspace') {
    throw permanentError('Dashboard report settings reconciliation is Integration Workspace only', {
      code: 'DASHBOARD_REPORT_SETTINGS_PROFILE_INVALID',
      details: { profileKey },
    });
  }

  const canonicalRows = createReportSettingRowsForProfile(profileKey);
  const canonicalPlan = await syncEngine.planByKey({
    repository,
    tableId,
    keyField: 'report_setting_key',
    rows: canonicalRows,
  });
  const legacyRecords = await repository.listByFieldValues(
    tableId,
    'report_setting_key',
    LEGACY_REPORT_SETTING_KEYS,
  );
  const legacy = normalizeLegacyRecords(legacyRecords);

  return Object.freeze({
    tableId,
    canonicalRows,
    canonicalPlan,
    legacyRecords: legacy.records,
    summary: Object.freeze({
      canonicalExpected: canonicalRows.length,
      canonicalCreates: canonicalPlan.createRows.length,
      canonicalUpdates: canonicalPlan.updateRows.length,
      canonicalSkipped: canonicalPlan.skipped,
      legacyFound: legacy.records.length,
      legacyEnabled: legacy.enabledRecords.length,
      legacyAlreadyDisabled: legacy.records.length - legacy.enabledRecords.length,
      deleteCount: 0,
    }),
  });
}

/** Execute แผนที่ตรวจแล้ว: Canonical ก่อน จากนั้น Disable legacy exact keys */
export async function applyDashboardReportSettingsReconciliation(input = {}) {
  const plan = requirePlan(input.plan);
  const repository = requireRepository(input.repository);
  const syncEngine = requireSyncEngine(input.syncEngine);

  const canonical = await syncEngine.executePlan(plan.canonicalPlan);
  const enabledLegacy = plan.legacyRecords.filter((record) => record.enabled);
  const legacyResult = enabledLegacy.length === 0
    ? { updated: 0 }
    : await repository.updateMany(
      plan.tableId,
      enabledLegacy.map((record) => Object.freeze({
        recordId: record.recordId,
        fields: Object.freeze({ enabled: false }),
      })),
    );
  const legacyDisabled = requireExactCount(
    legacyResult?.updated,
    enabledLegacy.length,
    'legacy settings disabled',
  );
  const verification = await verifyDashboardReportSettingsReconciliation({
    repository,
    tableId: plan.tableId,
    canonicalRows: plan.canonicalRows,
  });

  return Object.freeze({
    canonical,
    legacyDisabled,
    verification,
    deleteCount: 0,
  });
}

/** Verify only canonical active rows remain; legacy rows may remain only as disabled lineage */
export async function verifyDashboardReportSettingsReconciliation(input = {}) {
  const repository = requireRepository(input.repository);
  const tableId = requireText(input.tableId, 'tableId');
  const canonicalRows = requireArray(input.canonicalRows, 'canonicalRows');
  const canonicalKeys = canonicalRows.map((row) => row.report_setting_key);
  const records = await repository.listByFieldValues(
    tableId,
    'report_setting_key',
    [...canonicalKeys, ...LEGACY_REPORT_SETTING_KEYS],
  );
  const byKey = new Map();
  for (const record of records) {
    const key = readLarkText(record?.fields?.report_setting_key, {
      allowNull: false,
      label: 'report_setting_key',
    });
    if (byKey.has(key)) {
      throw permanentError(`Duplicate report setting during verification: ${key}`, {
        code: 'DASHBOARD_REPORT_SETTING_DUPLICATE',
        details: { key },
      });
    }
    byKey.set(key, record);
  }

  for (const expected of canonicalRows) {
    const actual = byKey.get(expected.report_setting_key);
    if (!actual
      || readLarkText(actual.fields?.customer_profile, {
        allowNull: false,
        label: 'customer_profile',
      }) !== 'integration_workspace'
      || readCheckbox(actual.fields?.enabled) !== true) {
      throw permanentError(`Canonical report setting verification failed: ${expected.report_setting_key}`, {
        code: 'DASHBOARD_REPORT_SETTING_VERIFICATION_FAILED',
        details: { key: expected.report_setting_key },
      });
    }
  }

  const activeLegacy = LEGACY_REPORT_SETTING_KEYS.filter((key) => {
    const record = byKey.get(key);
    return record ? readCheckbox(record.fields?.enabled) === true : false;
  });
  if (activeLegacy.length > 0) {
    throw permanentError('Legacy developer report settings remain active', {
      code: 'DASHBOARD_REPORT_LEGACY_ACTIVE',
      details: { activeLegacy },
    });
  }

  return Object.freeze({
    canonicalActive: canonicalKeys.length,
    legacyActive: 0,
    legacyRetainedDisabled: LEGACY_REPORT_SETTING_KEYS.filter((key) => byKey.has(key)).length,
    deleteCount: 0,
  });
}

function normalizeLegacyRecords(records) {
  const byKey = new Map();
  const normalized = [];
  for (const record of requireArray(records, 'legacyRecords')) {
    const key = readLarkText(record?.fields?.report_setting_key, {
      allowNull: false,
      label: 'report_setting_key',
    });
    if (!LEGACY_REPORT_SETTING_KEYS.includes(key)) {
      throw permanentError('Legacy report query returned an unexpected key', {
        code: 'DASHBOARD_REPORT_LEGACY_SCOPE_INVALID',
        details: { key },
      });
    }
    if (byKey.has(key)) {
      throw permanentError(`Duplicate legacy report setting: ${key}`, {
        code: 'DASHBOARD_REPORT_SETTING_DUPLICATE',
        details: { key },
      });
    }
    const profile = readLarkText(record.fields?.customer_profile, {
      allowNull: false,
      label: 'customer_profile',
    });
    const platforms = readTextList(record.fields?.platforms);
    if (!LEGACY_PROFILES.has(profile) || !platforms.includes('tiktok')) {
      throw permanentError(`Legacy report setting identity is not safe to retire: ${key}`, {
        code: 'DASHBOARD_REPORT_LEGACY_SCOPE_INVALID',
        details: { key, profile, platforms },
      });
    }
    const normalizedRecord = Object.freeze({
      recordId: requireText(record?.recordId ?? record?.record_id, 'recordId'),
      key,
      enabled: readCheckbox(record.fields?.enabled),
    });
    byKey.set(key, normalizedRecord);
    normalized.push(normalizedRecord);
  }
  return Object.freeze({
    records: Object.freeze(normalized),
    enabledRecords: Object.freeze(normalized.filter((record) => record.enabled)),
  });
}

function readTextList(value) {
  const text = readLarkText(value, { allowNull: true, separator: ',' });
  return text
    ? [...new Set(text.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))]
    : [];
}

function readCheckbox(value) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined || value === '') {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw permanentError('Report setting enabled value is invalid', {
    code: 'DASHBOARD_REPORT_SETTING_INVALID',
  });
}

function requireExactCount(value, expected, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number !== expected) {
    throw permanentError(`Unexpected ${label} count`, {
      code: 'DASHBOARD_REPORT_SETTINGS_PARTIAL_WRITE',
      details: { expected, actual: Number.isFinite(number) ? number : null },
    });
  }
  return number;
}

function requirePlan(value) {
  if (!value || typeof value !== 'object' || !value.canonicalPlan) {
    throw new TypeError('Dashboard report settings apply requires plan');
  }
  return value;
}

function requireRepository(repository) {
  for (const method of ['listByFieldValues', 'prepareRows', 'createMany', 'updateMany']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`Dashboard report settings require repository.${method}`);
    }
  }
  return repository;
}

function requireSyncEngine(syncEngine) {
  for (const method of ['planByKey', 'executePlan']) {
    if (typeof syncEngine?.[method] !== 'function') {
      throw new TypeError(`Dashboard report settings require syncEngine.${method}`);
    }
  }
  return syncEngine;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}
