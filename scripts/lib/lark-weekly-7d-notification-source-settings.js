import { createHash } from 'node:crypto';

import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../../packages/config/src/lark-notification-runtime-config.js';

const SOURCE_PROFILE = 'integration_workspace';
const HASH = /^[a-f0-9]{64}$/u;

/**
 * Resolve the exact active Report Settings authority for one accepted Fresh Weekly 7D source.
 *
 * This deliberately does not depend on historical Executive Preview rows from other windows.
 * The accepted Fresh source already binds the exact Report identities used by its decision,
 * so every one of those Reports must still resolve to one retained Snapshot and one active
 * Setting at the reviewed Executive destination.
 */
export function resolveLarkWeekly7dNotificationSourceSettings(input = {}) {
  const sourceReportIds = normalizeSourceReportIds(input.sourceReportIds);
  const snapshots = requireArray(input.snapshots, 'snapshots');
  const settings = requireArray(input.settings, 'settings');
  const expectedDestinationKeyHash = input.expectedDestinationKeyHash
    ?? LARK_EXECUTIVE_DESTINATION_KEY_HASH;
  if (!HASH.test(expectedDestinationKeyHash)) {
    throw new TypeError('expectedDestinationKeyHash must be SHA-256 hex');
  }

  const exactSnapshots = sourceReportIds.map((reportId) => exactRecord(
    snapshots,
    'report_id',
    reportId,
    'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_REPORT_INVALID',
  ));
  const profiles = [...new Set(exactSnapshots.map((record) => (
    requireText(scalar(record.fields.customer_profile), 'customer_profile')
  )))];
  if (profiles.length !== 1 || profiles[0] !== SOURCE_PROFILE) {
    throw sourceError(
      'Fresh Weekly 7D source Reports must belong to the Integration Workspace',
      'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_REPORT_INVALID',
      { customerProfileCount: profiles.length },
    );
  }

  const settingKeys = [...new Set(exactSnapshots.map((record) => (
    requireText(scalar(record.fields.report_setting_key), 'report_setting_key')
  )))].sort();
  const groupIds = [];
  const baseline = settingKeys.map((settingKey) => {
    const matches = settings.filter((record) => (
      String(scalar(record?.fields?.report_setting_key) ?? '') === settingKey
      && String(scalar(record?.fields?.customer_profile) ?? '') === SOURCE_PROFILE
    ));
    if (matches.length !== 1) {
      throw sourceError(
        'Fresh Weekly 7D source requires one exact Report Setting',
        'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID',
        { matchCount: matches.length },
      );
    }
    const record = matches[0];
    const fields = record.fields ?? {};
    const enabled = readBoolean(fields.enabled, 'enabled');
    const aiEnabled = readBoolean(fields.ai_enabled, 'ai_enabled');
    const notificationEnabled = readBoolean(
      fields.notification_enabled,
      'notification_enabled',
    );
    if (!enabled || !aiEnabled || !notificationEnabled) {
      throw sourceError(
        'Fresh Weekly 7D source Report Settings must remain active',
        'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID',
        { enabled, aiEnabled, notificationEnabled },
      );
    }
    groupIds.push(requireText(scalar(fields.group_id), 'group_id'));
    return Object.freeze({
      recordId: requireText(record.recordId ?? record.record_id, 'recordId'),
      reportSettingKey: settingKey,
      customerProfile: SOURCE_PROFILE,
      enabled,
      aiEnabled,
      notificationEnabled,
    });
  });

  const uniqueGroups = [...new Set(groupIds)];
  if (uniqueGroups.length !== 1 || sha256(uniqueGroups[0]) !== expectedDestinationKeyHash) {
    throw sourceError(
      'Fresh Weekly 7D source Settings do not resolve to the reviewed Executive destination',
      'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_DESTINATION_INVALID',
      { destinationRedacted: true, destinationCount: uniqueGroups.length },
    );
  }

  return deepFreeze({
    sourceReportIds,
    settingKeys,
    customerProfile: SOURCE_PROFILE,
    destinationKeyHash: expectedDestinationKeyHash,
    baseline,
  });
}

function normalizeSourceReportIds(value) {
  const rows = requireArray(value, 'sourceReportIds')
    .map((item) => requireText(item, 'sourceReportId'));
  const unique = [...new Set(rows)].sort();
  if (unique.length === 0 || unique.length !== rows.length) {
    throw sourceError(
      'Fresh Weekly 7D source Report identities must be non-empty and unique',
      'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_REPORT_INVALID',
      { sourceReportCount: unique.length },
    );
  }
  return Object.freeze(unique);
}

function exactRecord(records, fieldName, expected, code) {
  const matches = records.filter((record) => (
    String(scalar(record?.fields?.[fieldName]) ?? '') === expected
  ));
  if (matches.length !== 1) {
    throw sourceError(
      `Fresh Weekly 7D source requires one exact ${fieldName}`,
      code,
      { matchCount: matches.length },
    );
  }
  return matches[0];
}
function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}
function requireText(value, label) {
  const normalized = value === null || value === undefined ? '' : String(scalar(value) ?? '').trim();
  if (!normalized) throw new TypeError(`${label} is required`);
  return normalized;
}
function readBoolean(value, label) {
  const item = scalar(value);
  if (item === true || item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === false || item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  throw new TypeError(`${label} must be boolean-like`);
}
function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join('');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) {
      if (value[key] !== undefined) return scalar(value[key]);
    }
  }
  return value;
}
function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
function sourceError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dNotificationSourceSettingsError';
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
