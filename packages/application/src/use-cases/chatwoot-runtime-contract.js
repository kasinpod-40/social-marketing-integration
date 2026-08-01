import { JOB_SCHEMA_VERSIONS, JOB_TRIGGERS } from '../jobs/job-catalog.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const CHATWOOT_RUNTIME_CONTRACT_VERSION = 'chatwoot_runtime_30d_daily_v1';
export const CHATWOOT_RUNTIME_JOB_SCHEMA_VERSION = JOB_SCHEMA_VERSIONS.CHATWOOT_RUNTIME;

export const CHATWOOT_RUNTIME_MODES = Object.freeze({
  INITIAL_30_DAY_UAT: 'initial_30_day_uat',
  DAILY_INCREMENTAL: 'daily_incremental',
});

export const CHATWOOT_RUNTIME_CONTRACT = Object.freeze({
  initialBackfillDays: 30,
  incrementalOverlapDays: 3,
  syncFrequency: 'daily',
  autoExpandBackfill: false,
  includeUpdatedOlderConversations: true,
});

export const CHATWOOT_RUNTIME_PHASE = 'chatwoot_runtime_30d_daily_v1';

const DAY_MS = 86_400_000;
const SAFE_SEQUENCE_MAX = 1_000_000;

export function resolveChatwootRuntimeMode(trigger) {
  if (trigger === JOB_TRIGGERS.CHATWOOT_INITIAL_30_DAY_UAT) {
    return CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT;
  }
  if (trigger === JOB_TRIGGERS.CHATWOOT_DAILY_INCREMENTAL) {
    return CHATWOOT_RUNTIME_MODES.DAILY_INCREMENTAL;
  }
  throw permanentError('Chatwoot runtime received an unsupported trigger', {
    code: 'CHATWOOT_TRIGGER_INVALID',
    details: { trigger: trigger ?? null },
  });
}

/**
 * Both windows are immutable relative to the stable Queue requestedAt. The initial mode never
 * expands beyond 30 days; every daily run deliberately rereads exactly three days.
 */
export function resolveChatwootRuntimeWindow(input = {}) {
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const mode = requireMode(input.mode);
  const days = mode === CHATWOOT_RUNTIME_MODES.INITIAL_30_DAY_UAT
    ? CHATWOOT_RUNTIME_CONTRACT.initialBackfillDays
    : CHATWOOT_RUNTIME_CONTRACT.incrementalOverlapDays;
  return Object.freeze({
    mode,
    startAt: requestedAt - days * DAY_MS,
    endAt: requestedAt,
    days,
    autoExpanded: false,
    includeUpdatedOlderConversations: true,
  });
}

/** Include an old-created Conversation when update/activity intersects the immutable window. */
export function isConversationInChatwootWindow(row, window) {
  const startAt = requireTimestamp(window?.startAt, 'window.startAt');
  const endAt = requireTimestamp(window?.endAt, 'window.endAt');
  const timestamps = [row?.updated_at, row?.last_activity_at, row?.created_at]
    .map(readTimestamp)
    .filter((value) => value !== null);
  if (timestamps.length === 0) return false;
  return timestamps.some((value) => value >= startAt && value <= endAt);
}

/** Event time, creation or later correction can independently make the row relevant. */
export function isChatwootEventInWindow(row, window) {
  const startAt = requireTimestamp(window?.startAt, 'window.startAt');
  const endAt = requireTimestamp(window?.endAt, 'window.endAt');
  const timestamps = [
    row?.event_end_at,
    row?.eventEndAt,
    row?.event_end_time,
    row?.eventEndTime,
    row?.created_at,
    row?.source_created_at,
    row?.updated_at,
    row?.source_updated_at,
  ].map(readTimestamp).filter((value) => value !== null);
  return timestamps.some((value) => value >= startAt && value <= endAt);
}

export function readChatwootContinuationSequence(value) {
  if (value === null || value === undefined || value === '') return 0;
  const sequence = Number(value);
  if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > SAFE_SEQUENCE_MAX) {
    throw permanentError('Chatwoot continuationSequence is invalid', {
      code: 'CHATWOOT_CONTINUATION_SEQUENCE_INVALID',
      details: { continuationSequence: value },
    });
  }
  return sequence;
}

export function createInitialChatwootDurableState(input = {}) {
  const mode = requireMode(input.mode);
  const window = resolveChatwootRuntimeWindow({ mode, requestedAt: input.requestedAt });
  return Object.freeze({
    contractVersion: CHATWOOT_RUNTIME_CONTRACT_VERSION,
    schemaVersion: CHATWOOT_RUNTIME_JOB_SCHEMA_VERSION,
    mode,
    windowStartAt: window.startAt,
    windowEndAt: window.endAt,
    nextSequence: 0,
    stage: 'masters',
    mastersComplete: false,
    conversationPage: 1,
    conversationRowOffset: 0,
    conversationPageFingerprint: null,
    conversationPagesProcessed: 0,
    conversationRowsScanned: 0,
    conversationsSelected: 0,
    messagesSelected: 0,
    conversationReportingEventsSelected: 0,
    conversationsComplete: false,
    reportingPage: 1,
    reportingTotalPages: null,
    reportingPagesProcessed: 0,
    reportingEventsSelected: 0,
    reportingComplete: false,
    rollupComplete: false,
    checkpointComplete: false,
    complete: false,
  });
}

export function assertChatwootDurableState(value, expected = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw permanentError('Chatwoot durable phase state is missing', {
      code: 'CHATWOOT_DURABLE_STATE_INVALID',
    });
  }
  const mode = requireMode(value.mode);
  const requestedAt = requireTimestamp(expected.requestedAt, 'expected.requestedAt');
  const window = resolveChatwootRuntimeWindow({ mode, requestedAt });
  if (value.contractVersion !== CHATWOOT_RUNTIME_CONTRACT_VERSION
    || Number(value.schemaVersion) !== CHATWOOT_RUNTIME_JOB_SCHEMA_VERSION
    || value.windowStartAt !== window.startAt
    || value.windowEndAt !== window.endAt
    || (expected.mode && mode !== expected.mode)) {
    throw permanentError('Chatwoot durable phase contract drifted', {
      code: 'CHATWOOT_DURABLE_STATE_MISMATCH',
    });
  }
  readChatwootContinuationSequence(value.nextSequence);
  const conversationRowOffset = nonNegativeInteger(
    value.conversationRowOffset ?? 0,
    'conversationRowOffset',
  );
  const conversationPageFingerprint = value.conversationPageFingerprint ?? null;
  if (conversationPageFingerprint !== null
      && !/^[0-9a-f]{64}$/u.test(conversationPageFingerprint)) {
    throw permanentError('Chatwoot durable Conversation page fingerprint is invalid', {
      code: 'CHATWOOT_DURABLE_STATE_INVALID',
    });
  }
  return Object.freeze({
    ...value,
    conversationRowOffset,
    conversationPageFingerprint,
  });
}

export function buildChatwootRuntimePlan(input = {}) {
  const mode = requireMode(input.mode);
  const requestedAt = requireTimestamp(input.requestedAt, 'requestedAt');
  const conversationPages = nonNegativeInteger(input.conversationPages ?? 0, 'conversationPages');
  const reportingPages = nonNegativeInteger(input.reportingPages ?? 0, 'reportingPages');
  const rollupPages = nonNegativeInteger(input.rollupPages ?? 0, 'rollupPages');
  const conversationPagesPerInvocation = positiveInteger(
    input.conversationPagesPerInvocation ?? 1,
    'conversationPagesPerInvocation',
  );
  const conversationRows = nonNegativeInteger(input.conversationRows ?? 0, 'conversationRows');
  const conversationRowsPerInvocation = positiveInteger(
    input.conversationRowsPerInvocation ?? 1,
    'conversationRowsPerInvocation',
  );
  const reportingPagesPerInvocation = positiveInteger(
    input.reportingPagesPerInvocation ?? 5,
    'reportingPagesPerInvocation',
  );
  const window = resolveChatwootRuntimeWindow({ mode, requestedAt });
  const conversationUnits = conversationRows > 0
    ? Math.ceil(conversationRows / conversationRowsPerInvocation)
    : Math.ceil(conversationPages / conversationPagesPerInvocation);
  const reportingUnits = Math.ceil(reportingPages / reportingPagesPerInvocation);
  // Runtime processes one bounded 500-row D1 rollup page per continuation.
  const rollupUnits = rollupPages;
  return Object.freeze({
    contractVersion: CHATWOOT_RUNTIME_CONTRACT_VERSION,
    schemaVersion: CHATWOOT_RUNTIME_JOB_SCHEMA_VERSION,
    mode,
    windowStartAt: window.startAt,
    windowEndAt: window.endAt,
    windowDays: window.days,
    syncFrequency: CHATWOOT_RUNTIME_CONTRACT.syncFrequency,
    automaticBackfillExpansion: false,
    includeUpdatedOlderConversations: true,
    mastersUnits: 1,
    conversationUnits,
    reportingUnits,
    rollupUnits,
    finalizationUnits: 1,
    totalUnits: 2 + conversationUnits + reportingUnits + rollupUnits,
    conversationPagesPerInvocation,
    conversationRowsPerInvocation,
    reportingPagesPerInvocation,
    rollupPagesPerInvocation: 1,
    queueMessagesSent: 0,
    remoteD1Mutations: 0,
    remoteLarkMutations: 0,
    deploymentActions: 0,
    scheduleActions: 0,
  });
}

export function assertLockedChatwootRuntimeConfig(config = {}) {
  const expected = CHATWOOT_RUNTIME_CONTRACT;
  if (config.initialBackfillDays !== expected.initialBackfillDays
    || config.incrementalOverlapDays !== expected.incrementalOverlapDays
    || config.syncFrequency !== expected.syncFrequency
    || config.autoExpandBackfill !== expected.autoExpandBackfill
    || config.includeUpdatedOlderConversations !== expected.includeUpdatedOlderConversations) {
    throw permanentError('Chatwoot runtime window contract must remain exactly 30d/3d/daily', {
      code: 'CHATWOOT_RUNTIME_CONTRACT_INVALID',
    });
  }
  return config;
}

function requireMode(value) {
  if (!Object.values(CHATWOOT_RUNTIME_MODES).includes(value)) {
    throw permanentError('Chatwoot runtime mode is invalid', {
      code: 'CHATWOOT_RUNTIME_MODE_INVALID',
      details: { mode: value ?? null },
    });
  }
  return value;
}

function readTimestamp(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value === 'number' || /^\d+$/u.test(String(value))) {
    const number = Number(value);
    if (!Number.isFinite(number) || number <= 0) return null;
    return number < 100_000_000_000 ? number * 1_000 : number;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function requireTimestamp(value, fieldName) {
  const timestamp = readTimestamp(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < Date.UTC(2000, 0, 1)) {
    throw permanentError(`Chatwoot runtime requires valid ${fieldName}`, {
      code: 'CHATWOOT_RUNTIME_TIMESTAMP_INVALID',
      details: { fieldName },
    });
  }
  return timestamp;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }
  return number;
}
