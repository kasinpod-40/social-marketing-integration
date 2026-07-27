import { permanentError } from '../../shared/src/errors/runtime-error.js';

const DEFAULT_REPORTING_TIMEZONE = 'Asia/Bangkok';
const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 5;
const DEFAULT_MAX_PAGES = 100;
const DEFAULT_MAX_ROWS = 5_000;
const DEFAULT_MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const DEFAULT_INCREMENTAL_OVERLAP_HOURS = 48;
const DEFAULT_MAX_REPORTING_EVENTS = 10_000;
const DEFAULT_MAX_MESSAGE_PAGES = 50;
const DEFAULT_MAX_MESSAGES_PER_CONVERSATION = 1_000;

export const CHATWOOT_LARK_TABLE_KEYS = Object.freeze([
  'rawChatwootAccounts',
  'rawChatwootInboxes',
  'rawChatwootContacts',
  'rawChatwootAgents',
  'rawChatwootTeams',
  'rawChatwootLabels',
  'rawChatwootConversations',
  'rawChatwootConversationLabels',
  'rawChatwootMessageAnalytics',
  'rawChatwootReportingEvents',
  'mktConversations',
  'mktConversationDaily',
  'mktAgentDaily',
  'mktInboxDaily',
  'mktConversationAccountDaily',
]);

/** Fail-closed config; Provider identity and Secret are read only after Connector enablement. */
export function readChatwootRuntimeConfig(env = {}) {
  const flags = Object.freeze({
    connector: readBoolean(env.MKT_CONNECTOR_CHATWOOT_ENABLED, 'MKT_CONNECTOR_CHATWOOT_ENABLED', false),
    d1Write: readBoolean(env.MKT_CHATWOOT_D1_WRITE_ENABLED, 'MKT_CHATWOOT_D1_WRITE_ENABLED', false),
    larkWrite: readBoolean(env.MKT_CHATWOOT_LARK_WRITE_ENABLED, 'MKT_CHATWOOT_LARK_WRITE_ENABLED', false),
    reportWrite: readBoolean(env.MKT_CHATWOOT_REPORT_WRITE_ENABLED, 'MKT_CHATWOOT_REPORT_WRITE_ENABLED', false),
    schedule: readBoolean(env.MKT_SCHEDULE_CHATWOOT_ENABLED, 'MKT_SCHEDULE_CHATWOOT_ENABLED', false),
    webhook: readBoolean(env.MKT_CHATWOOT_WEBHOOK_ENABLED, 'MKT_CHATWOOT_WEBHOOK_ENABLED', false),
  });

  const source = flags.connector
    ? Object.freeze({
      baseUrl: requireHttpsOrigin(env.CHATWOOT_BASE_URL, 'CHATWOOT_BASE_URL'),
      externalAccountId: requirePositiveInteger(env.CHATWOOT_ACCOUNT_ID, 'CHATWOOT_ACCOUNT_ID'),
      accessToken: requireText(env.CHATWOOT_API_ACCESS_TOKEN, 'CHATWOOT_API_ACCESS_TOKEN'),
      timeoutMs: readInteger(env.CHATWOOT_API_TIMEOUT_MS, 'CHATWOOT_API_TIMEOUT_MS', 1_000, 120_000, DEFAULT_TIMEOUT_MS),
      maxAttempts: readInteger(env.CHATWOOT_API_MAX_ATTEMPTS, 'CHATWOOT_API_MAX_ATTEMPTS', 1, 10, DEFAULT_MAX_ATTEMPTS),
      maxPages: readInteger(env.CHATWOOT_API_MAX_PAGES, 'CHATWOOT_API_MAX_PAGES', 1, 1_000, DEFAULT_MAX_PAGES),
      maxRows: readInteger(env.CHATWOOT_API_MAX_ROWS, 'CHATWOOT_API_MAX_ROWS', 1, 100_000, DEFAULT_MAX_ROWS),
      maxResponseBytes: readInteger(
        env.CHATWOOT_API_MAX_RESPONSE_BYTES,
        'CHATWOOT_API_MAX_RESPONSE_BYTES',
        1_024,
        32 * 1024 * 1024,
        DEFAULT_MAX_RESPONSE_BYTES,
      ),
    })
    : null;

  return Object.freeze({
    flags,
    source,
    reportingTimezone: optionalText(env.DEFAULT_TIMEZONE) ?? DEFAULT_REPORTING_TIMEZONE,
    limits: Object.freeze({
      incrementalOverlapHours: readInteger(
        env.CHATWOOT_INCREMENTAL_OVERLAP_HOURS,
        'CHATWOOT_INCREMENTAL_OVERLAP_HOURS',
        1,
        24 * 30,
        DEFAULT_INCREMENTAL_OVERLAP_HOURS,
      ),
      maxConversations: readInteger(
        env.CHATWOOT_MAX_CONVERSATIONS,
        'CHATWOOT_MAX_CONVERSATIONS',
        1,
        50_000,
        DEFAULT_MAX_ROWS,
      ),
      maxContacts: readInteger(env.CHATWOOT_MAX_CONTACTS, 'CHATWOOT_MAX_CONTACTS', 1, 50_000, DEFAULT_MAX_ROWS),
      maxReportingEvents: readInteger(
        env.CHATWOOT_MAX_REPORTING_EVENTS,
        'CHATWOOT_MAX_REPORTING_EVENTS',
        1,
        100_000,
        DEFAULT_MAX_REPORTING_EVENTS,
      ),
      maxMessagePagesPerConversation: readInteger(
        env.CHATWOOT_MAX_MESSAGE_PAGES_PER_CONVERSATION,
        'CHATWOOT_MAX_MESSAGE_PAGES_PER_CONVERSATION',
        1,
        1_000,
        DEFAULT_MAX_MESSAGE_PAGES,
      ),
      maxMessagesPerConversation: readInteger(
        env.CHATWOOT_MAX_MESSAGES_PER_CONVERSATION,
        'CHATWOOT_MAX_MESSAGES_PER_CONVERSATION',
        1,
        100_000,
        DEFAULT_MAX_MESSAGES_PER_CONVERSATION,
      ),
    }),
  });
}

function readBoolean(value, fieldName, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (value === true || value === false) return value;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') return true;
    if (normalized === 'false') return false;
  }
  throw configError(`${fieldName} must be true or false`, fieldName);
}

function readInteger(value, fieldName, minimum, maximum, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = typeof value === 'number' ? value : Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw configError(`${fieldName} must be an integer from ${minimum} to ${maximum}`, fieldName);
  }
  return number;
}

function requirePositiveInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') {
    throw configError(`${fieldName} is required`, fieldName);
  }
  return readInteger(value, fieldName, 1, Number.MAX_SAFE_INTEGER, null);
}

function requireHttpsOrigin(value, fieldName) {
  const text = requireText(value, fieldName);
  let url;
  try {
    url = new URL(text);
  } catch (cause) {
    throw permanentError(`${fieldName} must be a valid HTTPS URL`, {
      code: 'CHATWOOT_RUNTIME_CONFIG_INVALID',
      cause,
      details: { fieldName },
    });
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash) {
    throw configError(`${fieldName} must be a credential-free HTTPS origin`, fieldName);
  }
  return url.toString().replace(/\/+$/u, '');
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw configError(`${fieldName} is required`, fieldName);
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function configError(message, fieldName) {
  return permanentError(message, {
    code: 'CHATWOOT_RUNTIME_CONFIG_INVALID',
    details: { fieldName },
  });
}
