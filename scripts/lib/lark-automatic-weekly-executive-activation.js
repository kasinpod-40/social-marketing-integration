import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';
import {
  LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS,
  LARK_NOTIFICATION_CONTROLLED_UAT_MAPPINGS,
} from './lark-notification-controlled-uat.js';

export const LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_VERSION =
  'lark_automatic_weekly_executive_activation_v1';
export const LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION',
  value: 'ENABLE_AUTOMATIC_WEEKLY_EXECUTIVE_NOTIFICATION_V1',
});
export const LARK_AUTOMATIC_WEEKLY_EXECUTIVE_DEFAULT_TIME = '09:30';
export const LARK_AUTOMATIC_WEEKLY_EXECUTIVE_DEFAULT_MAX_QUEUE_ATTEMPTS = 5;

const SCHEDULE_FLAG = 'MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED';
const SCHEDULE_TIME = 'MKT_WEEKLY_NOTIFICATION_TIME';
const MAX_ATTEMPTS = 'MKT_WEEKLY_NOTIFICATION_MAX_QUEUE_ATTEMPTS';
const RUNTIME_MODE = 'MKT_NOTIFICATION_RUNTIME_MODE';
const REQUIRED_EXISTING_TRUE = Object.freeze([
  'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
]);

/**
 * Promote only the reviewed Notification runtime + automatic Weekly producer while preserving every
 * current Source/Report execution gate and the exact Worker trigger topology.
 */
export function buildAutomaticWeeklyExecutiveActivationConfig(sourceText, tableIds, options = {}) {
  const source = parseConfig(sourceText);
  const target = structuredClone(source);
  const sourceBlocks = collectVars(source);
  const targetBlocks = collectVars(target);
  if (sourceBlocks.length !== targetBlocks.length) {
    throw activationError('Automatic Weekly activation vars topology drifted');
  }

  const notificationTime = readScheduleTime(
    options.notificationTime ?? LARK_AUTOMATIC_WEEKLY_EXECUTIVE_DEFAULT_TIME,
    SCHEDULE_TIME,
  );
  const maximumAttempts = readBoundedInteger(
    options.maximumAttempts ?? LARK_AUTOMATIC_WEEKLY_EXECUTIVE_DEFAULT_MAX_QUEUE_ATTEMPTS,
    MAX_ATTEMPTS,
    2,
    10,
  );

  for (let index = 0; index < sourceBlocks.length; index += 1) {
    const before = sourceBlocks[index];
    const after = targetBlocks[index];
    for (const flag of REQUIRED_EXISTING_TRUE) {
      if (readOptionalBoolean(before[flag]) !== true) {
        throw activationError('Automatic Weekly activation requires the existing Weekly Report runtime', {
          fieldName: flag,
        });
      }
    }
    for (const flag of LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS) after[flag] = 'true';
    after[RUNTIME_MODE] = 'runtime';
    after[SCHEDULE_FLAG] = 'true';
    after[SCHEDULE_TIME] = notificationTime;
    after[MAX_ATTEMPTS] = String(maximumAttempts);

    for (const [role, envName] of Object.entries(LARK_NOTIFICATION_CONTROLLED_UAT_MAPPINGS)) {
      const exact = requireText(tableIds?.[role], `tableIds.${role}`);
      const current = optionalText(before[envName]);
      if (current && current !== exact) {
        throw activationError('Automatic Weekly activation Lark table mapping drifted', {
          fieldName: envName,
        });
      }
      after[envName] = exact;
    }
  }

  if (JSON.stringify(source.triggers ?? null) !== JSON.stringify(target.triggers ?? null)) {
    throw activationError('Automatic Weekly activation changed Worker trigger topology');
  }

  const changedEnabledFlags = diffTrueEnabledFlags(source, target);
  const allowedEnabledChanges = new Set([
    ...LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS,
    SCHEDULE_FLAG,
  ]);
  const unexpectedEnabledChanges = changedEnabledFlags.filter((name) => !allowedEnabledChanges.has(name));
  if (unexpectedEnabledChanges.length > 0) {
    throw activationError('Automatic Weekly activation changed unrelated execution flags', {
      unexpectedEnabledChanges,
    });
  }

  return deepFreeze({
    targetText: `${JSON.stringify(target, null, 2)}\n`,
    sourceTrueFlags: readTrueEnabledFlags(source),
    targetTrueFlags: readTrueEnabledFlags(target),
    changedEnabledFlags,
    notificationRuntimeEnabled: true,
    automaticWeeklyEnabled: true,
    notificationTime,
    maximumAttempts,
    scheduleConfigPreserved: true,
  });
}

export function buildAutomaticWeeklyExecutiveSettingRows(authority) {
  const baseline = authority?.baseline;
  if (!Array.isArray(baseline) || baseline.length === 0) {
    throw activationError('Automatic Weekly activation requires a non-empty source Settings baseline');
  }
  return deepFreeze(baseline
    .filter((row) => row?.aiEnabled !== true || row?.notificationEnabled !== true)
    .map((row) => ({
      report_setting_key: requireText(row.reportSettingKey, 'reportSettingKey'),
      ai_enabled: true,
      notification_enabled: true,
    })));
}

export function buildAutomaticWeeklyExecutiveActiveBaseline(authority) {
  const baseline = authority?.baseline;
  if (!Array.isArray(baseline) || baseline.length === 0) {
    throw activationError('Automatic Weekly activation requires a non-empty source Settings baseline');
  }
  return deepFreeze(baseline.map((row) => ({
    reportSettingKey: requireText(row.reportSettingKey, 'reportSettingKey'),
    aiEnabled: true,
    notificationEnabled: true,
  })));
}

export async function readAutomaticWeeklyExecutiveSourceSettingRecords(input = {}) {
  const repository = input.repository;
  if (!repository || typeof repository.listByFieldValues !== 'function') {
    throw activationError('Automatic Weekly activation requires the existing Lark Record repository');
  }
  const tableId = requireText(input.tableId, 'tableId');
  const sourceAuthorities = input.sourceAuthorities;
  if (!Array.isArray(sourceAuthorities) || sourceAuthorities.length === 0) {
    throw activationError('Automatic Weekly activation requires canonical source authorities');
  }
  const settingKeys = sourceAuthorities
    .map((authority) => requireText(authority?.reportSettingKey, 'sourceAuthority.reportSettingKey'))
    .sort();
  if (new Set(settingKeys).size !== settingKeys.length) {
    throw activationError('Automatic Weekly activation source Settings must be one-to-one');
  }
  const records = await repository.listByFieldValues(
    tableId,
    'report_setting_key',
    settingKeys,
  );
  if (!Array.isArray(records)) {
    throw activationError('Automatic Weekly activation source Settings readback is invalid');
  }
  return records;
}

function parseConfig(value) {
  let parsed;
  try {
    parsed = parseJsoncObject(requireText(value, 'sourceText'));
  } catch (cause) {
    throw activationError('Automatic Weekly source Wrangler config is invalid', {
      causeCode: cause?.code ?? null,
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw activationError('Automatic Weekly source Wrangler config must be an object');
  }
  return parsed;
}

function collectVars(config) {
  const blocks = [];
  if (!config.vars || typeof config.vars !== 'object' || Array.isArray(config.vars)) config.vars = {};
  blocks.push(config.vars);
  for (const envConfig of Object.values(config.env ?? {})) {
    if (!envConfig || typeof envConfig !== 'object' || Array.isArray(envConfig)) continue;
    if (!envConfig.vars || typeof envConfig.vars !== 'object' || Array.isArray(envConfig.vars)) {
      envConfig.vars = {};
    }
    blocks.push(envConfig.vars);
  }
  return blocks;
}

function readTrueEnabledFlags(config) {
  return [...new Set(collectVars(structuredClone(config)).flatMap((vars) => (
    Object.entries(vars)
      .filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name)
        && readOptionalBoolean(value) === true)
      .map(([name]) => name)
  )))].sort();
}

function diffTrueEnabledFlags(source, target) {
  const before = new Set(readTrueEnabledFlags(source));
  return readTrueEnabledFlags(target).filter((name) => !before.has(name));
}

function readOptionalBoolean(value) {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  if (value === true || value === 1 || value === '1'
      || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || value === 0 || value === '0'
      || String(value).trim().toLowerCase() === 'false') return false;
  return false;
}

function readScheduleTime(value, fieldName) {
  const text = requireText(value, fieldName);
  const match = /^(?:[01]\d|2[0-3]):([0-5]\d)$/u.exec(text);
  if (!match || Number(match[1]) % 5 !== 0) {
    throw activationError(`${fieldName} must be HH:mm on a 5-minute boundary`, { fieldName });
  }
  return text;
}

function readBoundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw activationError(`${fieldName} must be an integer from ${minimum} to ${maximum}`, {
      fieldName,
    });
  }
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw activationError(`${fieldName} is required`, { fieldName });
  }
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function activationError(message, details = {}) {
  const error = new Error(message);
  error.name = 'LarkAutomaticWeeklyExecutiveActivationError';
  error.code = 'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_INVALID';
  error.details = Object.freeze({ ...details });
  return error;
}

function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
