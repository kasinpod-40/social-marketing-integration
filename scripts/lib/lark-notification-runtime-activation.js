import { createHash } from 'node:crypto';

import {
  LARK_NOTIFICATION_RUNTIME_MODES,
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../../packages/config/src/lark-notification-runtime-config.js';
import {
  buildLarkNotificationControlledUatWranglerConfig,
  parseSourceReportIds,
  selectLarkNotificationExecutivePreview,
} from './lark-notification-controlled-uat.js';

export const LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONTRACT_VERSION =
  'lark_notification_runtime_activation_v1';

export const LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_NOTIFICATION_RUNTIME_ACTIVATION',
  value: 'ACTIVATE_REVIEWED_EXECUTIVE_NOTIFICATION_RUNTIME',
});

export const LARK_NOTIFICATION_RUNTIME_ROLLBACK_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_NOTIFICATION_RUNTIME_ROLLBACK',
  value: 'RESTORE_NOTIFICATION_RUNTIME_ALL_FALSE',
});

export const LARK_NOTIFICATION_RUNTIME_WINDOWS = Object.freeze([1, 3, 7, 30]);
export const LARK_NOTIFICATION_RUNTIME_MODE_ENV = 'MKT_NOTIFICATION_RUNTIME_MODE';

const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_PROFILE = 'integration_workspace';

export function assertLarkNotificationRuntimeActivationConfirmation(env = {}, mode = 'activate') {
  const contract = mode === 'rollback'
    ? LARK_NOTIFICATION_RUNTIME_ROLLBACK_CONFIRMATION
    : LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIRMATION;
  if (env?.[contract.envName] !== contract.value) {
    throw activationError(
      `Notification Runtime ${mode} requires ${contract.envName}=${contract.value}`,
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIRMATION_REQUIRED',
      { mode, envName: contract.envName },
    );
  }
  return true;
}

export function selectLarkNotificationRuntimeExecutivePreviews(records = []) {
  return Object.freeze(LARK_NOTIFICATION_RUNTIME_WINDOWS.map((windowDays) => (
    selectLarkNotificationExecutivePreview(records, { windowDays })
  )));
}

export function buildLarkNotificationRuntimeActivationWranglerConfig(
  configText,
  tableIds,
  options = {},
) {
  const active = options.active === true;
  const built = buildLarkNotificationControlledUatWranglerConfig(
    configText,
    tableIds,
    { active },
  );
  const config = structuredClone(built.config);
  const mode = active
    ? LARK_NOTIFICATION_RUNTIME_MODES.RUNTIME
    : LARK_NOTIFICATION_RUNTIME_MODES.DISABLED;
  const blocks = collectVars(config);
  if (blocks.length === 0) {
    config.vars = {};
    blocks.push(config.vars);
  }
  for (const vars of blocks) vars[LARK_NOTIFICATION_RUNTIME_MODE_ENV] = mode;
  return Object.freeze({
    ...built,
    config: deepFreeze(config),
    text: `${JSON.stringify(config, null, 2)}\n`,
    runtimeMode: mode,
  });
}

export function resolveLarkNotificationRuntimeActivationSettings(input = {}) {
  const previews = requireArray(input.previews, 'previews');
  if (previews.length !== LARK_NOTIFICATION_RUNTIME_WINDOWS.length) {
    throw activationError(
      'Runtime activation requires exact Executive 1D/3D/7D/30D Preview authority',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SOURCE_INVALID',
      { previewCount: previews.length },
    );
  }
  const sourceReportIds = [...new Set(previews.flatMap((record) => (
    parseSourceReportIds(record?.fields?.source_report_ids_json)
  )))].sort();
  if (sourceReportIds.length === 0) {
    throw activationError(
      'Runtime activation requires source Report identities',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SOURCE_INVALID',
    );
  }

  const snapshots = requireArray(input.snapshots, 'snapshots');
  const exactSnapshots = sourceReportIds.map((reportId) => exactRecord(
    snapshots,
    'report_id',
    reportId,
    'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SNAPSHOT_INVALID',
  ));
  const profiles = [...new Set(exactSnapshots.map((record) => (
    requireText(scalar(record.fields.customer_profile), 'customer_profile')
  )))];
  if (profiles.length !== 1 || profiles[0] !== SOURCE_PROFILE) {
    throw activationError(
      'Runtime source Reports must belong to the Integration Workspace',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SNAPSHOT_INVALID',
      { customerProfileCount: profiles.length },
    );
  }
  const settingKeys = [...new Set(exactSnapshots.map((record) => (
    requireText(scalar(record.fields.report_setting_key), 'report_setting_key')
  )))].sort();

  const expectedDestinationKeyHash = input.expectedDestinationKeyHash
    ?? LARK_EXECUTIVE_DESTINATION_KEY_HASH;
  if (!HASH.test(expectedDestinationKeyHash)) {
    throw new TypeError('expectedDestinationKeyHash must be SHA-256 hex');
  }

  const expectedState = input.expectedState ?? 'inactive';
  if (!['inactive', 'active', 'either'].includes(expectedState)) {
    throw new TypeError('expectedState must be inactive, active or either');
  }
  const settings = requireArray(input.settings, 'settings');
  const exactSettings = settingKeys.map((settingKey) => {
    const matches = settings.filter((record) => (
      String(scalar(record?.fields?.report_setting_key) ?? '') === settingKey
      && String(scalar(record?.fields?.customer_profile) ?? '') === SOURCE_PROFILE
    ));
    if (matches.length !== 1) {
      throw activationError(
        'Runtime activation requires one exact Report Setting',
        'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SETTINGS_INVALID',
        { matchCount: matches.length },
      );
    }
    return matches[0];
  });

  const groupIds = [];
  const baseline = exactSettings.map((record) => {
    const fields = record.fields ?? {};
    const enabled = readBoolean(fields.enabled, 'enabled');
    const aiEnabled = readBoolean(fields.ai_enabled, 'ai_enabled');
    const notificationEnabled = readBoolean(
      fields.notification_enabled,
      'notification_enabled',
    );
    if (!enabled) {
      throw activationError(
        'Runtime activation cannot enable a disabled Report Setting',
        'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SETTINGS_INVALID',
      );
    }
    if (expectedState === 'inactive' && (aiEnabled || notificationEnabled)) {
      throw activationError(
        'Runtime activation requires AI and notification initially false',
        'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SETTINGS_INVALID',
        { aiEnabled, notificationEnabled },
      );
    }
    if (expectedState === 'active' && (!aiEnabled || !notificationEnabled)) {
      throw activationError(
        'Runtime rollback requires the exact activated Settings',
        'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SETTINGS_INVALID',
        { aiEnabled, notificationEnabled },
      );
    }
    const groupId = requireText(scalar(fields.group_id), 'group_id');
    groupIds.push(groupId);
    return Object.freeze({
      recordId: requireText(record.recordId ?? record.record_id, 'recordId'),
      reportSettingKey: requireText(
        scalar(fields.report_setting_key),
        'report_setting_key',
      ),
      customerProfile: SOURCE_PROFILE,
      enabled,
      aiEnabled,
      notificationEnabled,
    });
  });
  const uniqueGroups = [...new Set(groupIds)];
  if (uniqueGroups.length !== 1
      || sha256(uniqueGroups[0]) !== expectedDestinationKeyHash) {
    throw activationError(
      'Runtime Settings do not resolve to the reviewed Executive destination',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_DESTINATION_INVALID',
      { destinationRedacted: true, destinationCount: uniqueGroups.length },
    );
  }

  return Object.freeze({
    sourceReportIds: Object.freeze(sourceReportIds),
    settingKeys: Object.freeze(settingKeys),
    customerProfile: SOURCE_PROFILE,
    destinationKeyHash: expectedDestinationKeyHash,
    baseline: Object.freeze(baseline),
  });
}

export function buildLarkNotificationRuntimeActivationReadbackSql() {
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'table' AND name = 'lark_notification_deliveries')
        AS notification_table_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_lark_notification_delivery_%')
        AS notification_index_count,
      (SELECT COUNT(*) FROM sync_locks WHERE expires_at > unixepoch('now') * 1000)
        AS active_locks,
      (SELECT COUNT(*) FROM lark_notification_deliveries)
        AS delivery_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE status = 'sent' AND mirror_status = 'mirrored')
        AS sent_mirrored_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE status <> 'sent' OR mirror_status <> 'mirrored')
        AS unsafe_delivery_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE ai_run_key LIKE 'notification-uat:%')
        AS controlled_uat_rows,
      (SELECT COUNT(*) FROM lark_notification_deliveries
        WHERE ai_run_key LIKE 'notification-uat:%'
          AND status = 'sent' AND mirror_status = 'mirrored')
        AS controlled_uat_sent_mirrored_rows;
  `);
}

export function normalizeLarkNotificationRuntimeActivationReadback(row = {}) {
  const value = Object.freeze({
    notificationTableCount: count(row.notification_table_count),
    notificationIndexCount: count(row.notification_index_count),
    activeLocks: count(row.active_locks),
    deliveryRows: count(row.delivery_rows),
    sentMirroredRows: count(row.sent_mirrored_rows),
    unsafeDeliveryRows: count(row.unsafe_delivery_rows),
    controlledUatRows: count(row.controlled_uat_rows),
    controlledUatSentMirroredRows: count(row.controlled_uat_sent_mirrored_rows),
  });
  if (value.notificationTableCount !== 1
      || value.notificationIndexCount !== 3
      || value.activeLocks !== 0
      || value.deliveryRows < 1
      || value.deliveryRows !== value.sentMirroredRows
      || value.unsafeDeliveryRows !== 0
      || value.controlledUatRows !== 1
      || value.controlledUatSentMirroredRows !== 1) {
    throw activationError(
      'Notification Runtime activation requires terminal mirrored delivery state and no active lock',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_REMOTE_STATE_INVALID',
      value,
    );
  }
  return value;
}

export function assertLarkNotificationRuntimeActivationStable(before, after) {
  const first = normalizeLarkNotificationRuntimeActivationReadback(toReadbackRow(before));
  const final = normalizeLarkNotificationRuntimeActivationReadback(toReadbackRow(after));
  if (JSON.stringify(first) !== JSON.stringify(final)) {
    throw activationError(
      'Runtime activation changed notification delivery evidence without Queue admission',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_DELIVERY_DRIFT',
      { before: first, after: final },
    );
  }
  return Object.freeze({
    deliveryRows: final.deliveryRows,
    sentMirroredRows: final.sentMirroredRows,
    additionalDeliveryRows: 0,
    additionalMessageSendCount: 0,
  });
}

export function assertLarkNotificationRuntimeSettingsState(records, authority, active) {
  const rows = requireArray(records, 'records');
  for (const baseline of authority.baseline) {
    const matches = rows.filter((record) => (
      String(scalar(record?.fields?.report_setting_key) ?? '')
        === baseline.reportSettingKey
      && String(scalar(record?.fields?.customer_profile) ?? '')
        === baseline.customerProfile
    ));
    if (matches.length !== 1
        || readBoolean(matches[0].fields.enabled, 'enabled') !== true
        || readBoolean(matches[0].fields.ai_enabled, 'ai_enabled') !== active
        || readBoolean(
          matches[0].fields.notification_enabled,
          'notification_enabled',
        ) !== active) {
      throw activationError(
        'Runtime Report Settings readback did not match the requested state',
        'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SETTINGS_READBACK_FAILED',
        { active, matchCount: matches.length },
      );
    }
  }
  return true;
}

function exactRecord(records, fieldName, expected, code) {
  const matches = records.filter((record) => (
    String(scalar(record?.fields?.[fieldName]) ?? '') === expected
  ));
  if (matches.length !== 1) {
    throw activationError(
      `Runtime activation requires one exact ${fieldName}`,
      code,
      { matchCount: matches.length },
    );
  }
  return matches[0];
}

function collectVars(config) {
  const blocks = [];
  if (config.vars && typeof config.vars === 'object' && !Array.isArray(config.vars)) {
    blocks.push(config.vars);
  }
  for (const environment of Object.values(config.env ?? {})) {
    if (environment?.vars && typeof environment.vars === 'object'
        && !Array.isArray(environment.vars)) blocks.push(environment.vars);
  }
  return blocks;
}

function toReadbackRow(value = {}) {
  return {
    notification_table_count: value.notificationTableCount,
    notification_index_count: value.notificationIndexCount,
    active_locks: value.activeLocks,
    delivery_rows: value.deliveryRows,
    sent_mirrored_rows: value.sentMirroredRows,
    unsafe_delivery_rows: value.unsafeDeliveryRows,
    controlled_uat_rows: value.controlledUatRows,
    controlled_uat_sent_mirrored_rows: value.controlledUatSentMirroredRows,
  };
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join(',');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) {
      if (value[key] !== undefined) return scalar(value[key]);
    }
  }
  return value;
}
function readBoolean(value, fieldName) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  throw activationError(
    `${fieldName} must be Boolean`,
    'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SETTINGS_INVALID',
    { fieldName },
  );
}
function count(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw activationError(
      'Runtime activation readback count is invalid',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_REMOTE_STATE_INVALID',
    );
  }
  return number;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw activationError(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}
function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const nested of Object.values(value)) deepFreeze(nested);
  return value;
}
function activationError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationRuntimeActivationError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
