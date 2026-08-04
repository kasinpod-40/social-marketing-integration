import { permanentError } from '../../shared/src/errors/runtime-error.js';

export const LARK_EXECUTIVE_DESTINATION_KEY_HASH =
  '7e69a1721915dfc52b4a3ed1ecf2569cdac63ffa63f6419959c35562ef5219b9';

/** Notification claim, remote send and Lark log mirror are independent all-false gates. */
export function readLarkNotificationRuntimeConfig(env = {}) {
  const runtimeEnabled = readBoolean(
    env.MKT_NOTIFICATION_RUNTIME_ENABLED,
    'MKT_NOTIFICATION_RUNTIME_ENABLED',
    false,
  );
  const sendEnabled = readBoolean(
    env.MKT_NOTIFICATION_LARK_SEND_ENABLED,
    'MKT_NOTIFICATION_LARK_SEND_ENABLED',
    false,
  );
  const mirrorEnabled = readBoolean(
    env.MKT_NOTIFICATION_LARK_MIRROR_ENABLED,
    'MKT_NOTIFICATION_LARK_MIRROR_ENABLED',
    false,
  );
  if (sendEnabled && !runtimeEnabled) fail('MKT_NOTIFICATION_LARK_SEND_ENABLED requires runtime');
  if (mirrorEnabled && !runtimeEnabled) fail('MKT_NOTIFICATION_LARK_MIRROR_ENABLED requires runtime');

  const tables = runtimeEnabled
    ? Object.freeze({
      aiRuns: requireText(env.LARK_TABLE_MKT_AI_REPORT_RUNS, 'LARK_TABLE_MKT_AI_REPORT_RUNS'),
      reportSnapshots: requireText(
        env.LARK_TABLE_MKT_REPORT_SNAPSHOTS,
        'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
      ),
      reportSettings: requireText(
        env.LARK_TABLE_MKT_REPORT_SETTINGS,
        'LARK_TABLE_MKT_REPORT_SETTINGS',
      ),
      notificationLog: mirrorEnabled
        ? requireText(env.LARK_TABLE_MKT_NOTIFICATION_LOG, 'LARK_TABLE_MKT_NOTIFICATION_LOG')
        : null,
    })
    : null;

  return Object.freeze({
    flags: Object.freeze({ runtimeEnabled, sendEnabled, mirrorEnabled }),
    tables,
    destinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
    claimLeaseMs: readInteger(
      env.MKT_NOTIFICATION_CLAIM_LEASE_MS,
      'MKT_NOTIFICATION_CLAIM_LEASE_MS',
      10_000,
      300_000,
      60_000,
    ),
    safety: Object.freeze({
      scheduleEnabled: false,
      production: 'BLOCKED',
      baseAutomationNotificationEnabled: false,
    }),
  });
}

function readBoolean(value, name, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  fail(`${name} must be true or false`, name);
}
function readInteger(value, name, minimum, maximum, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    fail(`${name} must be an integer from ${minimum} to ${maximum}`, name);
  }
  return number;
}
function requireText(value, name) {
  if (typeof value !== 'string' || value.trim() === '') fail(`${name} is required`, name);
  return value.trim();
}
function fail(message, fieldName = null) {
  throw permanentError(message, {
    code: 'LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID',
    details: { fieldName },
  });
}
