import { resolveMetricDate } from '../../../packages/config/src/metric-date-config.js';
import {
  permanentError,
  sanitizeOperationalText,
  sanitizeOperationalValue,
} from '../../../packages/shared/src/errors/runtime-error.js';

export const DEFAULT_LOCK_LEASE_MS = 10 * 60 * 1000;
export const DEFAULT_LOCK_RENEW_INTERVAL_MS = 2 * 60 * 1000;
export const DEFAULT_RETRY_DELAY_SECONDS = 30;
export const DEFAULT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const DEFAULT_TIKTOK_SOURCE_PAGE_SIZE = 500;
export const DEFAULT_TIKTOK_PROBE_PAGE_SIZE = 500;
export const DEFAULT_TIKTOK_SOURCE_MAX_PAGES = 1_000;
export const DEFAULT_TIKTOK_SOURCE_PAGES_PER_INVOCATION = 1;
export const DEFAULT_TIKTOK_BUSINESS_UNITS_PER_INVOCATION = 1;

export function requireJobText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Missing required job/config value ${fieldName}`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}

export function readMetricDate(jobValue, env) {
  return resolveMetricDate({ env, override: jobValue });
}

export function readAttempts(message) {
  const attempts = Number(message?.attempts ?? 1);
  return Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 1;
}

/**
 * Normal retry remains bounded linear backoff. A busy distributed lock must wait until after the
 * persisted lease expiry so all Queue retries cannot be exhausted while the stale owner is valid.
 */
export function readRetryDelaySeconds(env, message, error = null, now = Date.now()) {
  const configured = Number(env?.MKT_QUEUE_RETRY_DELAY_SECONDS);
  const base = Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_RETRY_DELAY_SECONDS;
  const backoff = base * Math.min(readAttempts(message), 10);
  const expiresAt = error?.code === 'SYNC_LOCK_BUSY'
    ? Number(error?.details?.expiresAt)
    : null;
  const remainingLeaseSeconds = Number.isSafeInteger(expiresAt) && expiresAt > now
    ? Math.ceil((expiresAt - now) / 1000) + 5
    : 0;
  return Math.min(43_200, Math.max(backoff, remainingLeaseSeconds));
}

export function readSyncJobGeneration(job, connectorName, fallbackTimestamp = null) {
  const value = job?.requestedAt ?? fallbackTimestamp;
  const instant = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(value ?? '');
  if (!Number.isSafeInteger(instant) || instant < 0) {
    throw permanentError(`${connectorName} sync job requires a valid requestedAt generation`, {
      code: 'INVALID_SYNC_JOB_GENERATION',
      details: { fieldName: 'requestedAt', connectorName },
    });
  }
  return instant;
}

export function readPositiveInteger(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw permanentError('Reliability numeric environment value must be a positive integer', {
      code: 'MKT_RELIABILITY_CONFIG_INVALID',
    });
  }
  return number;
}

export function readBoolean(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw permanentError('Boolean environment value must be true or false', {
    code: 'MKT_RUNTIME_CONFIG_INVALID',
  });
}

export function requireQueueName(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Missing queue routing value ${fieldName}`, {
      code: 'MKT_QUEUE_ROUTING_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}

export function sanitizeReliabilityEvent(event) {
  return {
    stage: event?.stage ?? null,
    error: event?.error instanceof Error ? event.error.message : String(event?.error ?? ''),
    code: event?.error?.code ?? null,
  };
}

export function logQueueResult(payload) {
  const normalized = {
    timestamp: new Date().toISOString(),
    scope: payload.scope ?? 'sync_worker_queue',
    ...payload,
  };
  if (Object.hasOwn(normalized, 'error')) {
    normalized.error = sanitizeOperationalText(normalized.error, { code: normalized.code });
  }
  console.log(JSON.stringify(sanitizeOperationalValue(normalized)));
}

export function summarizeJobResult(result) {
  if (result === null || typeof result !== 'object') return result;
  return Object.freeze({
    syncRunId: result.syncRunId ?? null,
    platform: result.platform ?? null,
    source: result.source ?? null,
    mode: result.mode ?? null,
    readyToWrite: result.readyToWrite ?? result.ok ?? null,
    rawRecords: result.rawRecords ?? null,
    processedRawRecords: result.processedRawRecords ?? null,
    incremental: result.incremental ?? null,
    classificationRules: result.classificationRules ?? null,
    invalidClassificationRuleCount: Array.isArray(result.classificationDictionary?.invalidRows)
      ? result.classificationDictionary.invalidRows.length
      : 0,
    rawChannels: summarizeWriteResult(result.rawChannels),
    rawVideos: summarizeWriteResult(result.rawVideos),
    rawAnalytics: summarizeWriteResult(result.rawAnalytics),
    content: summarizeWriteResult(result.content ?? result.syncPlan?.content),
    dailySnapshots: summarizeWriteResult(result.dailySnapshots ?? result.syncPlan?.dailySnapshots),
    accounts: summarizeWriteResult(result.accounts),
    sourceSummary: result.sourceSummary ?? null,
    sourcePagination: result.sourcePagination ?? null,
    resumableWork: result.resumableWork ?? null,
    continuationRequired: result.continuationRequired ?? null,
    operationId: result.operationId ?? null,
    workKey: result.workKey ?? null,
    checkpointSaved: result.checkpointSaved ?? null,
    reportType: result.reportType ?? null,
    reportSettingKey: result.reportSettingKey ?? null,
    reportId: result.reportId ?? null,
    period: result.period ?? null,
    dataStatus: result.dataStatus ?? null,
    baselineCoverageRate: result.baselineCoverageRate ?? null,
    sourceSnapshotCount: result.sourceSnapshotCount ?? null,
    trackedContentCount: result.trackedContentCount ?? null,
    sourceRead: summarizeSourceRead(result.sourceRead),
    reliabilityMirror: summarizeReliabilityMirror(result),
    metricCount: result.metricCount ?? null,
    topContentLimit: result.topContentLimit ?? null,
    topContentSlotCount: result.topContentSlotCount ?? null,
    topContentCount: result.topContentCount ?? null,
    reportSnapshot: summarizeWriteResult(result.reportSnapshot),
    reportMetricValues: summarizeWriteResult(result.reportMetricValues),
    reportTopContent: summarizeWriteResult(result.reportTopContent),
    reconciliation: result.reconciliation ?? null,
    issueCount: Array.isArray(result.issues) ? result.issues.length : 0,
    warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
    skippedRowCount: Array.isArray(result.skippedRows) ? result.skippedRows.length : 0,
    accountConflictCount: Array.isArray(result.accountConflicts) ? result.accountConflicts.length : 0,
  });
}

function summarizeSourceRead(value) {
  if (value === null || typeof value !== 'object') return null;
  return Object.freeze({
    strategy: value.strategy ?? null,
    bounded: value.bounded === true,
    contentRecords: value.contentRecords ?? null,
    dailySnapshotRecords: value.dailySnapshotRecords ?? null,
    externalContentIds: value.externalContentIds ?? null,
    contentQueries: value.contentQueries ?? null,
    dailyQueries: value.dailyQueries ?? null,
    rowsFetched: value.rowsFetched ?? null,
    fallbackRowsScanned: value.fallbackRowsScanned ?? null,
  });
}

function summarizeReliabilityMirror(value) {
  if (value === null || typeof value !== 'object' || value.pendingRead === undefined) return null;
  return Object.freeze({
    status: value.status ?? null,
    pendingRead: value.pendingRead ?? null,
    delivered: value.delivered ?? null,
    failedPermanent: value.failedPermanent ?? null,
    superseded: value.superseded ?? null,
    remainingUnknown: value.remainingUnknown === true,
    deferred: value.deferred === true,
    errorCode: value.errorCode ?? null,
  });
}

function summarizeWriteResult(value) {
  if (value === null || typeof value !== 'object') return null;
  return Object.freeze({
    created: value.created ?? value.createRows ?? null,
    updated: value.updated ?? value.updateRows ?? null,
    skipped: value.skipped ?? null,
    duplicateInputRows: value.duplicateInputRows ?? null,
    writeOutcome: value.writeOutcome ?? null,
  });
}
