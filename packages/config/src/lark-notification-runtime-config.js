import { permanentError } from '../../shared/src/errors/runtime-error.js';

export const LARK_EXECUTIVE_DESTINATION_KEY_HASH =
  '7e69a1721915dfc52b4a3ed1ecf2569cdac63ffa63f6419959c35562ef5219b9';
export const LARK_EXECUTIVE_DESTINATION_CHAT_NAME = 'Social MKT Executive Reports';

const DESTINATION_HASH_PATTERN = /^[a-f0-9]{64}$/u;
const CUSTOMER_PROFILES = new Set(['integration_workspace', 'chemistry_k']);

export const LARK_NOTIFICATION_RUNTIME_MODES = Object.freeze({
  DISABLED: 'disabled',
  CONTROLLED_UAT: 'controlled_uat',
  RUNTIME: 'runtime',
});

const ENABLED_RUNTIME_MODES = new Set([
  LARK_NOTIFICATION_RUNTIME_MODES.CONTROLLED_UAT,
  LARK_NOTIFICATION_RUNTIME_MODES.RUNTIME,
]);

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

  const mode = readRuntimeMode(env.MKT_NOTIFICATION_RUNTIME_MODE, runtimeEnabled);
  const customerProfile = readCustomerProfile(env.MKT_CUSTOMER_PROFILE);
  const destination = readDestinationAuthority(env, { customerProfile, runtimeEnabled });
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
    mode,
    tables,
    customerProfile,
    destinationKeyHash: destination.keyHash,
    destinationChatName: destination.chatName,
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

function readCustomerProfile(value) {
  const profile = value === null || value === undefined || value === ''
    ? 'integration_workspace'
    : String(value).trim();
  if (!CUSTOMER_PROFILES.has(profile)) {
    fail('MKT_CUSTOMER_PROFILE is not admitted for Lark Notification runtime',
      'MKT_CUSTOMER_PROFILE');
  }
  return profile;
}

function readDestinationAuthority(env, input) {
  const configuredHash = optionalText(env.MKT_NOTIFICATION_DESTINATION_KEY_HASH);
  const configuredName = optionalText(env.MKT_NOTIFICATION_DESTINATION_CHAT_NAME);
  if (configuredHash !== null && !DESTINATION_HASH_PATTERN.test(configuredHash)) {
    fail('MKT_NOTIFICATION_DESTINATION_KEY_HASH must be SHA-256 hex',
      'MKT_NOTIFICATION_DESTINATION_KEY_HASH');
  }

  if (input.customerProfile === 'integration_workspace') {
    return Object.freeze({
      keyHash: configuredHash ?? LARK_EXECUTIVE_DESTINATION_KEY_HASH,
      chatName: configuredName ?? LARK_EXECUTIVE_DESTINATION_CHAT_NAME,
    });
  }

  if (input.runtimeEnabled && (configuredHash === null || configuredName === null)) {
    fail('Customer Notification runtime requires an exact destination hash and chat name',
      configuredHash === null
        ? 'MKT_NOTIFICATION_DESTINATION_KEY_HASH'
        : 'MKT_NOTIFICATION_DESTINATION_CHAT_NAME');
  }
  return Object.freeze({
    keyHash: configuredHash,
    chatName: configuredName,
  });
}

function readRuntimeMode(value, runtimeEnabled) {
  if (!runtimeEnabled) {
    if (value === null || value === undefined || value === ''
        || value === LARK_NOTIFICATION_RUNTIME_MODES.DISABLED) {
      return LARK_NOTIFICATION_RUNTIME_MODES.DISABLED;
    }
    fail('MKT_NOTIFICATION_RUNTIME_MODE must be disabled while runtime is false',
      'MKT_NOTIFICATION_RUNTIME_MODE');
  }

  const mode = value === null || value === undefined || value === ''
    ? LARK_NOTIFICATION_RUNTIME_MODES.CONTROLLED_UAT
    : String(value).trim().toLowerCase();
  if (!ENABLED_RUNTIME_MODES.has(mode)) {
    fail('MKT_NOTIFICATION_RUNTIME_MODE must be controlled_uat or runtime',
      'MKT_NOTIFICATION_RUNTIME_MODE');
  }
  return mode;
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
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function fail(message, fieldName = null) {
  throw permanentError(message, {
    code: 'LARK_NOTIFICATION_RUNTIME_CONFIG_INVALID',
    details: { fieldName },
  });
}
