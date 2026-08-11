import { createHash } from 'node:crypto';

import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../../packages/config/src/lark-notification-runtime-config.js';

const SOURCE_PROFILE = 'integration_workspace';
const HASH = /^[a-f0-9]{64}$/u;

/**
 * Resolve the exact current Report Settings for one accepted Fresh Weekly 7D source.
 *
 * Historical Report Snapshot rows are not identity authority here. The caller supplies exact
 * reportId → reportSettingKey bindings regenerated through the shared Report materialization
 * contracts. Each exact Setting must remain enabled and internally consistent
 * (`ai_enabled === notification_enabled`), but different source Settings may legitimately retain
 * different active/inactive states. Controlled admission must activate only the inactive rows and
 * restore every row to this exact observed baseline afterwards.
 */
export function resolveLarkWeekly7dNotificationSourceSettings(input = {}) {
  const sourceReportIds = normalizeSourceReportIds(input.sourceReportIds);
  const sourceAuthorities = normalizeSourceAuthorities(input.sourceAuthorities);
  const settings = requireArray(input.settings, 'settings');
  const expectedDestinationKeyHash = input.expectedDestinationKeyHash
    ?? LARK_EXECUTIVE_DESTINATION_KEY_HASH;
  if (!HASH.test(expectedDestinationKeyHash)) {
    throw new TypeError('expectedDestinationKeyHash must be SHA-256 hex');
  }

  const authorityReportIds = sourceAuthorities.map(({ reportId }) => reportId).sort();
  if (JSON.stringify(authorityReportIds) !== JSON.stringify(sourceReportIds)) {
    throw sourceError(
      'Fresh Weekly 7D source Report identities do not match canonical Report authority',
      'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_REPORT_INVALID',
      {
        sourceReportCount: sourceReportIds.length,
        authorityReportCount: authorityReportIds.length,
      },
    );
  }
  const settingKeys = [...new Set(sourceAuthorities.map(({ reportSettingKey }) => reportSettingKey))].sort();
  if (settingKeys.length !== sourceAuthorities.length) {
    throw sourceError(
      'Fresh Weekly 7D source Reports must map one-to-one to Report Settings',
      'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_REPORT_INVALID',
      { sourceReportCount: sourceAuthorities.length, sourceSettingCount: settingKeys.length },
    );
  }

  const configuredGroupIds = [];
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
    const notificationEnabled = readBoolean(fields.notification_enabled, 'notification_enabled');
    if (!enabled || aiEnabled !== notificationEnabled) {
      throw sourceError(
        'Fresh Weekly 7D source Settings must be enabled with matching AI/notification flags',
        'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID',
        { enabled, aiEnabled, notificationEnabled },
      );
    }
    const groupId = optionalText(scalar(fields.group_id));
    if (groupId) configuredGroupIds.push(groupId);
    return Object.freeze({
      recordId: requireText(record.recordId ?? record.record_id, 'recordId'),
      reportSettingKey: settingKey,
      customerProfile: SOURCE_PROFILE,
      enabled,
      aiEnabled,
      notificationEnabled,
      groupId,
    });
  });

  const activeSettingCount = baseline.filter(({ aiEnabled }) => aiEnabled).length;
  const inactiveSettingCount = baseline.length - activeSettingCount;
  const state = activeSettingCount === 0
    ? 'inactive'
    : inactiveSettingCount === 0
      ? 'active'
      : 'mixed';

  const uniqueConfiguredGroups = [...new Set(configuredGroupIds)];
  const mixedDestinationState = configuredGroupIds.length > 0
    && configuredGroupIds.length !== baseline.length;
  if (mixedDestinationState
      || uniqueConfiguredGroups.length > 1
      || (uniqueConfiguredGroups.length === 1
        && sha256(uniqueConfiguredGroups[0]) !== expectedDestinationKeyHash)) {
    throw sourceError(
      'Fresh Weekly 7D source Settings contain an ambiguous or non-reviewed destination',
      'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_DESTINATION_INVALID',
      {
        destinationRedacted: true,
        destinationCount: uniqueConfiguredGroups.length,
        configuredDestinationRows: configuredGroupIds.length,
        sourceSettingCount: baseline.length,
      },
    );
  }

  return deepFreeze({
    state,
    activeSettingCount,
    inactiveSettingCount,
    sourceReportIds,
    sourceAuthorities,
    settingKeys,
    customerProfile: SOURCE_PROFILE,
    destinationKeyHash: expectedDestinationKeyHash,
    destinationBaseline: uniqueConfiguredGroups.length === 0 ? 'unset' : 'reviewed',
    baseline,
    restorableBaseline: baseline.map(({ reportSettingKey, aiEnabled, notificationEnabled }) => Object.freeze({
      reportSettingKey,
      aiEnabled,
      notificationEnabled,
    })),
  });
}

export function assertLarkWeekly7dNotificationSourceSettingsBaseline(
  records,
  authority,
  baselineInput = authority?.baseline,
) {
  const rows = requireArray(records, 'records');
  const baseline = normalizeRestorableBaseline(baselineInput);
  const expectedKeys = [...(authority?.settingKeys ?? [])].sort();
  const baselineKeys = baseline.map(({ reportSettingKey }) => reportSettingKey).sort();
  if (JSON.stringify(expectedKeys) !== JSON.stringify(baselineKeys)) {
    throw sourceError(
      'Weekly Notification Settings baseline identities differ from canonical source authority',
      'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_READBACK_FAILED',
      { sourceSettingCount: expectedKeys.length, baselineSettingCount: baselineKeys.length },
    );
  }

  for (const expected of baseline) {
    const matches = rows.filter((record) => (
      String(scalar(record?.fields?.report_setting_key) ?? '') === expected.reportSettingKey
      && String(scalar(record?.fields?.customer_profile) ?? '') === SOURCE_PROFILE
    ));
    if (matches.length !== 1) {
      throw sourceError(
        'Weekly Notification Settings readback requires one exact baseline row',
        'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_READBACK_FAILED',
        { matchCount: matches.length },
      );
    }
    const fields = matches[0].fields ?? {};
    const enabled = readBoolean(fields.enabled, 'enabled');
    const aiEnabled = readBoolean(fields.ai_enabled, 'ai_enabled');
    const notificationEnabled = readBoolean(fields.notification_enabled, 'notification_enabled');
    if (!enabled
        || aiEnabled !== expected.aiEnabled
        || notificationEnabled !== expected.notificationEnabled) {
      throw sourceError(
        'Weekly Notification Settings readback differs from the exact per-row baseline',
        'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_READBACK_FAILED',
        {
          reportSettingKey: expected.reportSettingKey,
          expectedAiEnabled: expected.aiEnabled,
          expectedNotificationEnabled: expected.notificationEnabled,
          observedAiEnabled: aiEnabled,
          observedNotificationEnabled: notificationEnabled,
        },
      );
    }
  }
  return true;
}

export function normalizeLarkWeekly7dNotificationRestorableBaseline(value) {
  return deepFreeze(normalizeRestorableBaseline(value));
}

export function summarizeLarkWeekly7dNotificationSettingsBaseline(value) {
  const baseline = normalizeRestorableBaseline(value);
  const activeSettingCount = baseline.filter(({ aiEnabled }) => aiEnabled).length;
  const inactiveSettingCount = baseline.length - activeSettingCount;
  return Object.freeze({
    state: activeSettingCount === 0
      ? 'inactive'
      : inactiveSettingCount === 0
        ? 'active'
        : 'mixed',
    activeSettingCount,
    inactiveSettingCount,
    sourceSettingCount: baseline.length,
  });
}

function normalizeRestorableBaseline(value) {
  const rows = requireArray(value, 'baseline').map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('baseline row must be an object');
    }
    const aiEnabled = readBoolean(item.aiEnabled, 'baseline.aiEnabled');
    const notificationEnabled = readBoolean(
      item.notificationEnabled,
      'baseline.notificationEnabled',
    );
    if (aiEnabled !== notificationEnabled) {
      throw sourceError(
        'Weekly Notification retained Settings baseline contains partial activation',
        'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID',
      );
    }
    return Object.freeze({
      reportSettingKey: requireText(item.reportSettingKey, 'baseline.reportSettingKey'),
      aiEnabled,
      notificationEnabled,
    });
  });
  if (rows.length === 0
      || new Set(rows.map(({ reportSettingKey }) => reportSettingKey)).size !== rows.length) {
    throw sourceError(
      'Weekly Notification retained Settings baseline must be non-empty and unique',
      'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_INVALID',
      { sourceSettingCount: rows.length },
    );
  }
  return Object.freeze(rows.sort((left, right) => (
    left.reportSettingKey.localeCompare(right.reportSettingKey)
  )));
}

function normalizeSourceReportIds(value) {
  const rows = requireArray(value, 'sourceReportIds').map((item) => requireText(item, 'sourceReportId'));
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
function normalizeSourceAuthorities(value) {
  const rows = requireArray(value, 'sourceAuthorities').map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      throw new TypeError('sourceAuthority must be an object');
    }
    return Object.freeze({
      reportId: requireText(item.reportId, 'sourceAuthority.reportId'),
      reportSettingKey: requireText(item.reportSettingKey, 'sourceAuthority.reportSettingKey'),
    });
  });
  if (rows.length === 0
      || new Set(rows.map(({ reportId }) => reportId)).size !== rows.length) {
    throw sourceError(
      'Fresh Weekly 7D canonical Report authority must be non-empty and unique',
      'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_REPORT_INVALID',
    );
  }
  return Object.freeze(rows.sort((left, right) => left.reportId.localeCompare(right.reportId)));
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
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
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
    for (const key of ['text', 'name', 'value']) if (value[key] !== undefined) return scalar(value[key]);
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
