import { createHash } from 'node:crypto';

import { createReportSettingRowsForProfile } from '../../packages/config/src/report-settings.seed.js';
import { LARK_EXECUTIVE_DESTINATION_KEY_HASH } from '../../packages/config/src/lark-notification-runtime-config.js';
import { readLarkText } from '../../packages/connectors/src/shared/lark-cell-value.js';
import {
  parseSourceReportIds,
  resolveLarkNotificationControlledUatTables,
} from './lark-notification-controlled-uat.js';
import {
  LARK_NOTIFICATION_RUNTIME_WINDOWS,
  resolveLarkNotificationRuntimeActivationSettings,
  selectLarkNotificationRuntimeExecutivePreviews,
} from './lark-notification-runtime-activation.js';

export const REPORT_SETTINGS_NOTIFICATION_RUNTIME_AUTHORITY_VERSION =
  'report_settings_notification_runtime_authority_v1';

export async function resolveReportSettingsNotificationRuntimeAuthority(input = {}) {
  const client = requireMethod(input.client, 'listTables', 'client');
  const repository = requireMethod(
    requireMethod(input.repository, 'listByFieldValues', 'repository'),
    'listByFieldValues',
    'repository',
  );
  const reportSettingsTableId = requireText(
    input.reportSettingsTableId,
    'reportSettingsTableId',
  );

  const canonicalKeys = createReportSettingRowsForProfile('integration_workspace')
    .map((row) => row.report_setting_key);
  const canonicalRows = await repository.listByFieldValues(
    reportSettingsTableId,
    'report_setting_key',
    canonicalKeys,
  );
  const activeRows = collectActiveCanonicalRows(canonicalRows, canonicalKeys);
  if (activeRows.length === 0) {
    return Object.freeze({
      contractVersion: REPORT_SETTINGS_NOTIFICATION_RUNTIME_AUTHORITY_VERSION,
      state: 'inactive',
      settingKeys: Object.freeze([]),
      settingCount: 0,
      groupId: null,
      destinationKeyHash: null,
    });
  }
  if (activeRows.length !== LARK_NOTIFICATION_RUNTIME_WINDOWS.length) {
    throw authorityError(
      'Notification Runtime preservation requires exactly four active canonical Report Settings',
      'REPORT_SETTINGS_NOTIFICATION_RUNTIME_ACTIVE_SCOPE_INVALID',
      { activeSettingCount: activeRows.length },
    );
  }

  const tableIds = resolveLarkNotificationControlledUatTables(await client.listTables());
  if (tableIds.reportSettings !== reportSettingsTableId) {
    throw authorityError(
      'Notification Runtime Report Settings table differs from the Finalizer table authority',
      'REPORT_SETTINGS_NOTIFICATION_RUNTIME_TABLE_MISMATCH',
    );
  }

  const executiveRows = await repository.listByFieldValues(
    tableIds.aiRuns,
    'scope_type',
    ['executive'],
  );
  const previews = selectLarkNotificationRuntimeExecutivePreviews(executiveRows);
  const sourceReportIds = [...new Set(previews.flatMap((record) => (
    parseSourceReportIds(record?.fields?.source_report_ids_json)
  )))].sort();
  const snapshotRows = await repository.listByFieldValues(
    tableIds.reportSnapshots,
    'report_id',
    sourceReportIds,
  );
  const settingKeys = [...new Set(sourceReportIds.map((reportId) => {
    const matches = snapshotRows.filter((record) => (
      readRequiredText(record?.fields?.report_id, 'report_id') === reportId
    ));
    if (matches.length !== 1) {
      throw authorityError(
        'Notification Runtime preservation requires one exact source Report Snapshot',
        'REPORT_SETTINGS_NOTIFICATION_RUNTIME_SNAPSHOT_INVALID',
        { matchCount: matches.length },
      );
    }
    return readRequiredText(
      matches[0]?.fields?.report_setting_key,
      'report_setting_key',
    );
  }))].sort();
  const settingRows = await repository.listByFieldValues(
    reportSettingsTableId,
    'report_setting_key',
    settingKeys,
  );
  const authority = resolveLarkNotificationRuntimeActivationSettings({
    previews,
    snapshots: snapshotRows,
    settings: settingRows,
    expectedState: 'active',
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });

  const observedActiveKeys = activeRows.map((row) => row.reportSettingKey).sort();
  if (stableJson(observedActiveKeys) !== stableJson(authority.settingKeys)) {
    throw authorityError(
      'Active Report Settings differ from the exact Executive Notification Runtime authority',
      'REPORT_SETTINGS_NOTIFICATION_RUNTIME_ACTIVE_SCOPE_INVALID',
      {
        activeSettingCount: observedActiveKeys.length,
        authoritySettingCount: authority.settingKeys.length,
      },
    );
  }

  const groupIds = [...new Set(settingRows.map((record) => (
    readRequiredText(record?.fields?.group_id, 'group_id')
  )))];
  if (groupIds.length !== 1
    || sha256(groupIds[0]) !== LARK_EXECUTIVE_DESTINATION_KEY_HASH) {
    throw authorityError(
      'Notification Runtime destination no longer matches the reviewed Executive destination',
      'REPORT_SETTINGS_NOTIFICATION_RUNTIME_DESTINATION_INVALID',
      { destinationCount: groupIds.length },
    );
  }

  return Object.freeze({
    contractVersion: REPORT_SETTINGS_NOTIFICATION_RUNTIME_AUTHORITY_VERSION,
    state: 'active',
    settingKeys: Object.freeze([...authority.settingKeys]),
    settingCount: authority.settingKeys.length,
    groupId: groupIds[0],
    destinationKeyHash: authority.destinationKeyHash,
  });
}

function collectActiveCanonicalRows(records, canonicalKeys) {
  const allowed = new Set(canonicalKeys);
  const byKey = new Map();
  for (const record of requireArray(records, 'canonicalSettings')) {
    const key = readRequiredText(record?.fields?.report_setting_key, 'report_setting_key');
    if (!allowed.has(key)) {
      throw authorityError(
        'Report Settings lookup returned a non-canonical key',
        'REPORT_SETTINGS_NOTIFICATION_RUNTIME_ACTIVE_SCOPE_INVALID',
      );
    }
    if (byKey.has(key)) {
      throw authorityError(
        'Duplicate canonical Report Setting blocks Notification Runtime preservation',
        'REPORT_SETTINGS_NOTIFICATION_RUNTIME_ACTIVE_SCOPE_INVALID',
        { duplicateKey: true },
      );
    }
    const aiEnabled = readBoolean(record?.fields?.ai_enabled, 'ai_enabled');
    const notificationEnabled = readBoolean(
      record?.fields?.notification_enabled,
      'notification_enabled',
    );
    if (aiEnabled !== notificationEnabled) {
      throw authorityError(
        'AI and Notification flags are mixed on a canonical Report Setting',
        'REPORT_SETTINGS_NOTIFICATION_RUNTIME_STATE_MIXED',
      );
    }
    byKey.set(key, Object.freeze({
      reportSettingKey: key,
      aiEnabled,
      notificationEnabled,
    }));
  }
  return [...byKey.values()].filter((row) => row.aiEnabled && row.notificationEnabled);
}

function readRequiredText(value, label) {
  return readLarkText(value, { allowNull: false, label });
}

function readBoolean(value, fieldName) {
  if (value === true || value === 1) return true;
  if (value === false || value === 0 || value === null || value === undefined || value === '') {
    return false;
  }
  const normalized = String(value).trim().toLowerCase();
  if (['true', '1', 'yes'].includes(normalized)) return true;
  if (['false', '0', 'no'].includes(normalized)) return false;
  throw authorityError(
    `${fieldName} must be Boolean`,
    'REPORT_SETTINGS_NOTIFICATION_RUNTIME_STATE_INVALID',
    { fieldName },
  );
}

function requireMethod(value, method, label) {
  if (typeof value?.[method] !== 'function') {
    throw new TypeError(`${label}.${method} is required`);
  }
  return value;
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
function stableJson(value) { return JSON.stringify(value); }
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function authorityError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportSettingsNotificationRuntimeAuthorityError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
