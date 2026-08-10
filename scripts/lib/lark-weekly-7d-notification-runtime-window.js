import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';
import {
  LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS,
  LARK_NOTIFICATION_CONTROLLED_UAT_MAPPINGS,
} from './lark-notification-controlled-uat.js';

const RUNTIME_MODE_ENV = 'MKT_NOTIFICATION_RUNTIME_MODE';

/**
 * Build a bounded one-time Notification Runtime window without disabling any existing
 * source/report execution flags or changing Worker triggers. The restore config is the
 * exact source config; the active config differs only by the reviewed notification flags,
 * runtime mode and exact notification Lark table mappings.
 */
export function buildLarkWeekly7dNotificationRuntimeWindow(sourceText, tableIds) {
  const source = parseConfig(sourceText);
  const restore = structuredClone(source);
  const active = structuredClone(source);
  const sourceBlocks = collectVars(source);
  const activeBlocks = collectVars(active);
  const restoreBlocks = collectVars(restore);
  if (sourceBlocks.length !== activeBlocks.length || sourceBlocks.length !== restoreBlocks.length) {
    throw windowError('Weekly Notification runtime vars topology drifted');
  }

  for (let index = 0; index < sourceBlocks.length; index += 1) {
    const sourceVars = sourceBlocks[index];
    const activeVars = activeBlocks[index];
    for (const flag of LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS) {
      if (readOptionalBoolean(sourceVars[flag]) === true) {
        throw windowError(
          'Weekly Notification bounded window requires notification flags initially false',
          { flag },
        );
      }
      activeVars[flag] = 'true';
    }
    const sourceMode = optionalText(sourceVars[RUNTIME_MODE_ENV]);
    if (sourceMode && sourceMode !== 'disabled') {
      throw windowError(
        'Weekly Notification bounded window requires runtime mode disabled at baseline',
        { runtimeMode: sourceMode },
      );
    }
    activeVars[RUNTIME_MODE_ENV] = 'runtime';

    for (const [role, envName] of Object.entries(LARK_NOTIFICATION_CONTROLLED_UAT_MAPPINGS)) {
      const exact = requireText(tableIds?.[role], `tableIds.${role}`);
      const current = optionalText(sourceVars[envName]);
      if (current && current !== exact) {
        throw windowError(
          'Weekly Notification Lark table mapping conflicts with the reviewed exact table',
          { envName },
        );
      }
      activeVars[envName] = exact;
    }
  }

  const sourceTrueFlags = readTrueFlags(source);
  const activeTrueFlags = readTrueFlags(active);
  const expectedActive = [...new Set([
    ...sourceTrueFlags,
    ...LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS,
  ])].sort();
  if (JSON.stringify(activeTrueFlags) !== JSON.stringify(expectedActive)) {
    throw windowError(
      'Weekly Notification active window changed non-notification execution flags',
      { sourceTrueFlagCount: sourceTrueFlags.length, activeTrueFlagCount: activeTrueFlags.length },
    );
  }
  if (JSON.stringify(readTrueFlags(restore)) !== JSON.stringify(sourceTrueFlags)) {
    throw windowError('Weekly Notification restore window differs from the current execution baseline');
  }
  if (JSON.stringify(source.triggers ?? null) !== JSON.stringify(active.triggers ?? null)
      || JSON.stringify(source.triggers ?? null) !== JSON.stringify(restore.triggers ?? null)) {
    throw windowError('Weekly Notification bounded window changed Worker trigger configuration');
  }

  return deepFreeze({
    activeText: `${JSON.stringify(active, null, 2)}\n`,
    restoreText: `${JSON.stringify(restore, null, 2)}\n`,
    sourceTrueFlags,
    activeTrueFlags,
    notificationFlags: Object.freeze([...LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS]),
    scheduleConfigPreserved: true,
    baselineNotificationOff: true,
  });
}

function parseConfig(value) {
  let parsed;
  try {
    parsed = parseJsoncObject(requireText(value, 'sourceText'));
  } catch (cause) {
    throw windowError('Weekly Notification source Wrangler config is invalid', {
      cause: cause?.code ?? cause?.message ?? 'JSONC_PARSE_FAILED',
    });
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw windowError('Weekly Notification source Wrangler config must be an object');
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
function readTrueFlags(config) {
  return [...new Set(collectVars(structuredClone(config)).flatMap((vars) => (
    Object.entries(vars)
      .filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && readOptionalBoolean(value) === true)
      .map(([name]) => name)
  )))].sort();
}
function readOptionalBoolean(value) {
  if (value === undefined || value === null || String(value).trim() === '') return false;
  if (value === true || value === 1 || value === '1' || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || value === 0 || value === '0' || String(value).trim().toLowerCase() === 'false') return false;
  return false;
}
function optionalText(value) {
  if (value === undefined || value === null) return null;
  const normalized = String(value).trim();
  return normalized || null;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw windowError(`${fieldName} is required`, { fieldName });
  }
  return value.trim();
}
function windowError(message, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dNotificationRuntimeWindowError';
  error.code = 'LARK_WEEKLY_7D_NOTIFICATION_RUNTIME_WINDOW_INVALID';
  error.details = Object.freeze({ ...details });
  return error;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
