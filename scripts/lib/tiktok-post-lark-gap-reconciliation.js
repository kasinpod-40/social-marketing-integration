import { JOB_TYPES } from '../../packages/application/src/jobs/job-catalog.js';
import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

export const TIKTOK_GAP_RECONCILIATION_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_TIKTOK_POST_LARK_RECONCILIATION',
  value: 'EXECUTE_TIKTOK_POST_LARK_RECONCILIATION',
});

export const TIKTOK_GAP_RECONCILIATION_TRIGGER = 'manual_reconciliation';
export const TIKTOK_GAP_RECONCILIATION_TIMEZONE = 'Asia/Bangkok';

const ADDITIVE_GAP_NAMES = Object.freeze([
  'rawMissingInD1',
  'rawMissingInContent',
  'd1MissingInContent',
  'contentMissingInDaily',
]);
const ALL_GAP_NAMES = Object.freeze([...ADDITIVE_GAP_NAMES, 'contentNotInRaw']);
const SOURCE_WATERMARK_PATTERN = /^[0-9a-f]{64}$/iu;
const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/u;
const WORKER_VERSION_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const ADMISSION_STATUSES = new Set([
  'pending',
  'queued',
  'processing',
  'completed',
  'failed_retryable',
  'failed_permanent',
]);

const ACTIVE_TRUE_FLAGS = Object.freeze([
  'MKT_CONNECTOR_TIKTOK_ENABLED',
  'MKT_TIKTOK_WATERMARK_ADMISSION_ENABLED',
  'MKT_TIME_SERIES_D1_WRITE_ENABLED',
]);

const ALWAYS_FALSE_FLAGS = Object.freeze([
  'MKT_TIKTOK_POST_PROCESS_REPORT_ENABLED',
  'MKT_TIME_SERIES_D1_BACKFILL_ENABLED',
  'MKT_REPORT_D1_SHADOW_READ_ENABLED',
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
  'MKT_LARK_DAILY_RETENTION_ENABLED',
  'MKT_NOTIFICATION_RUNTIME_ENABLED',
  'MKT_DLQ_REDRIVE_ENABLED',
  'MKT_TIKTOK_INCREMENTAL_ENABLED',
  'MKT_CONNECTOR_FACEBOOK_ENABLED',
  'MKT_CONNECTOR_INSTAGRAM_ENABLED',
  'MKT_CONNECTOR_META_ADS_ENABLED',
  'MKT_CONNECTOR_GOOGLE_ADS_ENABLED',
  'MKT_CONNECTOR_YOUTUBE_ENABLED',
  'MKT_YOUTUBE_ANALYTICS_ENABLED',
  'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
  'MKT_CONNECTOR_CHATWOOT_ENABLED',
  'MKT_GOOGLE_ADS_SIGNED_INGRESS_ENABLED',
  'MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED',
  'MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED',
  'MKT_GOOGLE_ADS_LARK_WRITE_ENABLED',
  'MKT_META_SOURCE_READ_ENABLED',
  'MKT_META_D1_WRITE_ENABLED',
  'MKT_META_LARK_WRITE_ENABLED',
  'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
  'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  'MKT_CHATWOOT_D1_WRITE_ENABLED',
  'MKT_CHATWOOT_LARK_WRITE_ENABLED',
  'MKT_CHATWOOT_WEBHOOK_ENABLED',
  'MKT_SCHEDULE_TIKTOK_ENABLED',
  'MKT_SCHEDULE_YOUTUBE_ENABLED',
  'MKT_SCHEDULE_GOOGLE_ADS_ENABLED',
  'MKT_SCHEDULE_WOOCOMMERCE_ENABLED',
  'MKT_SCHEDULE_CHATWOOT_ENABLED',
  'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
  'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
]);

/**
 * Classify one sanitized read-only audit into either already-ready, additive reconciliation,
 * or fail-closed integrity conflict. Business payloads and captions are never accepted here.
 */
export function classifyTikTokPostLarkAuditForReconciliation(audit = {}, expected = {}) {
  assertAuditIdentity(audit, expected);
  const raw = requireObject(audit.raw, 'audit.raw');
  const d1 = requireObject(audit.d1, 'audit.d1');
  const canonical = requireObject(audit.canonical, 'audit.canonical');
  const gaps = requireObject(audit.gaps, 'audit.gaps');
  const issues = requireArray(audit.issues, 'audit.issues');
  const sourceWatermark = requireSourceWatermark(raw.sourceWatermark);
  const rawRecordCount = nonNegativeInteger(raw.recordCount, 'audit.raw.recordCount');

  requireObject(d1.state, 'audit.d1.state');
  requireObject(d1.observations, 'audit.d1.observations');
  requireObject(canonical.content, 'audit.canonical.content');
  requireObject(canonical.daily, 'audit.canonical.daily');

  const gapSummary = Object.freeze(Object.fromEntries(ALL_GAP_NAMES.map((name) => {
    const value = normalizeGap(gaps[name], `audit.gaps.${name}`);
    return [name, value];
  })));
  const additiveGaps = Object.freeze(ADDITIVE_GAP_NAMES
    .map((name) => Object.freeze({ name, ...gapSummary[name] }))
    .filter((item) => item.count > 0));
  const contentNotInRaw = gapSummary.contentNotInRaw;

  const integrityIssues = issues
    .filter((issue) => issue?.code !== 'TIKTOK_CROSS_LAYER_GAP')
    .map((issue) => normalizeIssue(issue));
  const crossLayerIssues = issues
    .filter((issue) => issue?.code === 'TIKTOK_CROSS_LAYER_GAP')
    .map((issue) => normalizeCrossLayerIssue(issue));
  const expectedCrossLayerNames = additiveGaps.map((item) => item.name).sort();
  const observedCrossLayerNames = crossLayerIssues.map((item) => item.gap).sort();
  if (JSON.stringify(expectedCrossLayerNames) !== JSON.stringify(observedCrossLayerNames)) {
    throw reconciliationError(
      'TikTok audit cross-layer issue list does not match the gap evidence',
      'TIKTOK_GAP_RECONCILIATION_AUDIT_INCONSISTENT',
      { expectedCrossLayerNames, observedCrossLayerNames },
    );
  }

  const blockers = [];
  if (integrityIssues.length > 0) {
    blockers.push(Object.freeze({
      code: 'NON_ADDITIVE_AUDIT_ISSUE',
      issueCodes: Object.freeze(integrityIssues.map((issue) => issue.code).sort()),
    }));
  }
  if (contentNotInRaw.count > 0) {
    blockers.push(Object.freeze({
      code: 'CANONICAL_CONTENT_NOT_IN_RAW',
      count: contentNotInRaw.count,
    }));
  }

  const ready = issues.length === 0
    && additiveGaps.length === 0
    && contentNotInRaw.count === 0
    && audit.readyForManualProcessing === true;
  if (audit.readyForManualProcessing === true && !ready) {
    throw reconciliationError(
      'TikTok audit readiness flag conflicts with compact gap evidence',
      'TIKTOK_GAP_RECONCILIATION_AUDIT_INCONSISTENT',
    );
  }

  return Object.freeze({
    mode: ready ? 'already_ready' : blockers.length > 0 ? 'blocked' : 'additive_full_reconciliation',
    ready,
    blocked: blockers.length > 0,
    requiresFullReconciliation: !ready && blockers.length === 0 && additiveGaps.length > 0,
    sourceWatermark,
    rawRecordCount,
    issueCount: issues.length,
    additiveGapCount: additiveGaps.length,
    additiveMissingEntityTotal: additiveGaps.reduce((sum, item) => sum + item.count, 0),
    additiveGaps,
    contentNotInRaw,
    blockers: Object.freeze(blockers),
  });
}

export function validateTikTokPostLarkReconciledAudit(before, after, expected = {}) {
  const initial = classifyTikTokPostLarkAuditForReconciliation(before, expected);
  const final = classifyTikTokPostLarkAuditForReconciliation(after, expected);
  if (final.sourceWatermark !== initial.sourceWatermark) {
    throw reconciliationError(
      'TikTok RAW source changed during reconciliation',
      'TIKTOK_GAP_RECONCILIATION_SOURCE_CHANGED',
      {
        initialSourceWatermark: initial.sourceWatermark,
        finalSourceWatermark: final.sourceWatermark,
      },
    );
  }
  if (!final.ready) {
    throw reconciliationError(
      'TikTok cross-layer reconciliation did not reach exact parity',
      'TIKTOK_GAP_RECONCILIATION_PARITY_NOT_REACHED',
      {
        issueCount: final.issueCount,
        additiveGapCount: final.additiveGapCount,
        blockerCount: final.blockers.length,
      },
    );
  }
  return Object.freeze({ initial, final });
}

export function buildTikTokPostLarkReconciliationJob(input = {}) {
  const requestedAt = safeTimestamp(input.requestedAt ?? Date.now(), 'requestedAt');
  const metricDate = requireDate(input.metricDate, 'metricDate');
  return Object.freeze({
    schemaVersion: 1,
    type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_PROBE,
    trigger: TIKTOK_GAP_RECONCILIATION_TRIGGER,
    requestedAt: new Date(requestedAt).toISOString(),
    metricDate,
  });
}

export function buildTikTokPostLarkReconciliationEnvelope(input = {}) {
  return Object.freeze({
    body: buildTikTokPostLarkReconciliationJob(input),
    content_type: 'json',
  });
}

export function readPreviousCompletedBangkokDate(value = new Date()) {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) {
    throw reconciliationError(
      'Reconciliation clock must be a valid instant',
      'TIKTOK_GAP_RECONCILIATION_TIME_INVALID',
    );
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TIKTOK_GAP_RECONCILIATION_TIMEZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const localDate = `${values.year}-${values.month}-${values.day}`;
  const anchor = new Date(`${localDate}T00:00:00Z`);
  anchor.setUTCDate(anchor.getUTCDate() - 1);
  return anchor.toISOString().slice(0, 10);
}

/** Build temporary ignored Wrangler JSON only; the reviewed source config is never modified. */
export function buildTikTokPostLarkReconciliationWranglerConfig(configText, options = {}) {
  const mode = requireChoice(options.mode, 'mode', ['safe', 'reconcile']);
  const config = parseJsoncObject(requireText(configText, 'configText'));
  if (config.name !== 'social-mkt-sync-worker') {
    throw reconciliationError(
      'TikTok reconciliation requires the Integration Workspace Worker',
      'TIKTOK_GAP_RECONCILIATION_CONFIG_INVALID',
      { fieldName: 'name' },
    );
  }
  const d1 = Array.isArray(config.d1_databases)
    ? config.d1_databases.filter((item) => item?.binding === 'MKT_STATE_DB')
    : [];
  const queues = Array.isArray(config.queues?.producers)
    ? config.queues.producers.filter((item) => item?.binding === 'MKT_SYNC_QUEUE')
    : [];
  if (d1.length !== 1 || d1[0]?.database_name !== 'social-mkt-state-dev' || queues.length !== 1
    || queues[0]?.queue !== 'social-mkt-sync-jobs') {
    throw reconciliationError(
      'TikTok reconciliation config does not target the exact Integration Workspace D1 and Queue',
      'TIKTOK_GAP_RECONCILIATION_CONFIG_INVALID',
      { d1BindingCount: d1.length, queueBindingCount: queues.length },
    );
  }

  config.version_metadata = { binding: 'CF_VERSION_METADATA' };
  config.vars = { ...(config.vars ?? {}) };
  Object.assign(config.vars, {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    TIKTOK_SOURCE_HANDLE: 'chemistry_k',
    MKT_TIKTOK_AUDIT_HTTP_ENABLED: mode === 'reconcile' ? 'true' : 'false',
  });
  for (const name of ACTIVE_TRUE_FLAGS) {
    config.vars[name] = mode === 'reconcile' ? 'true' : 'false';
  }
  for (const name of ALWAYS_FALSE_FLAGS) config.vars[name] = 'false';

  return `${JSON.stringify(config, null, 2)}\n`;
}

export function buildTikTokAdmissionStatusSql(input = {}) {
  const sourceWatermark = requireSourceWatermark(input.sourceWatermark);
  const metricDate = requireDate(input.metricDate, 'metricDate');
  return compactSql(`
    SELECT
      admission_key,
      status,
      source_watermark,
      metric_date,
      source_record_count,
      sync_run_id,
      error_code,
      requested_at,
      completed_at,
      updated_at
    FROM tiktok_source_admissions
    WHERE customer_key = 'chemistry_k'
      AND account_key = 'chemistry_k'
      AND source_watermark = '${sourceWatermark}'
      AND metric_date = '${metricDate}'
    ORDER BY requested_at DESC
    LIMIT 1;
  `);
}

export function normalizeTikTokAdmissionStatusRow(row, expected = {}) {
  if (row === null || row === undefined) return null;
  const value = requireObject(row, 'admissionRow');
  const status = requireText(value.status, 'admissionRow.status');
  if (!ADMISSION_STATUSES.has(status)) {
    throw reconciliationError(
      'TikTok admission returned an unsupported status',
      'TIKTOK_GAP_RECONCILIATION_ADMISSION_INVALID',
      { status },
    );
  }
  const sourceWatermark = requireSourceWatermark(value.source_watermark);
  const metricDate = requireDate(value.metric_date, 'admissionRow.metric_date');
  if (expected.sourceWatermark && sourceWatermark !== expected.sourceWatermark) {
    throw reconciliationError(
      'TikTok admission source watermark mismatch',
      'TIKTOK_GAP_RECONCILIATION_ADMISSION_INVALID',
    );
  }
  if (expected.metricDate && metricDate !== expected.metricDate) {
    throw reconciliationError(
      'TikTok admission metric date mismatch',
      'TIKTOK_GAP_RECONCILIATION_ADMISSION_INVALID',
    );
  }
  const normalized = Object.freeze({
    admissionKey: requireText(value.admission_key, 'admissionRow.admission_key'),
    status,
    sourceWatermark,
    metricDate,
    sourceRecordCount: nonNegativeInteger(value.source_record_count, 'admissionRow.source_record_count'),
    syncRunId: optionalText(value.sync_run_id),
    errorCode: optionalText(value.error_code),
    requestedAt: safeTimestamp(value.requested_at, 'admissionRow.requested_at'),
    completedAt: optionalTimestamp(value.completed_at, 'admissionRow.completed_at'),
    updatedAt: safeTimestamp(value.updated_at, 'admissionRow.updated_at'),
  });
  if (status === 'failed_permanent') {
    throw reconciliationError(
      'TikTok reconciliation admission failed permanently',
      'TIKTOK_GAP_RECONCILIATION_ADMISSION_FAILED',
      { errorCode: normalized.errorCode },
    );
  }
  if (status === 'completed' && (!normalized.syncRunId || normalized.completedAt === null)) {
    throw reconciliationError(
      'Completed TikTok admission lacks completion evidence',
      'TIKTOK_GAP_RECONCILIATION_ADMISSION_INVALID',
    );
  }
  return normalized;
}

export function validateTikTokAdmissionIdempotentReplay(before, after) {
  const first = normalizeTikTokAdmissionStatusRow(before);
  const second = normalizeTikTokAdmissionStatusRow(after);
  if (!first || !second || first.status !== 'completed' || second.status !== 'completed') {
    throw reconciliationError(
      'TikTok admission replay requires two completed snapshots',
      'TIKTOK_GAP_RECONCILIATION_REPLAY_INVALID',
    );
  }
  const stable = [
    'admissionKey',
    'sourceWatermark',
    'metricDate',
    'sourceRecordCount',
    'syncRunId',
    'completedAt',
    'updatedAt',
  ].every((field) => first[field] === second[field]);
  if (!stable) {
    throw reconciliationError(
      'Same-operation TikTok replay changed durable admission evidence',
      'TIKTOK_GAP_RECONCILIATION_REPLAY_DRIFT',
    );
  }
  return Object.freeze({ first, second, idempotent: true });
}

export function requireWorkerVersionId(value, fieldName = 'workerVersionId') {
  const text = requireText(value, fieldName);
  if (!WORKER_VERSION_PATTERN.test(text)) {
    throw reconciliationError(
      `${fieldName} must be a Cloudflare Worker version UUID`,
      'TIKTOK_GAP_RECONCILIATION_WORKER_VERSION_INVALID',
      { fieldName },
    );
  }
  return text;
}

function assertAuditIdentity(audit, expected) {
  const value = requireObject(audit, 'audit');
  const sourceHandle = requireText(value.sourceHandle, 'audit.sourceHandle')
    .replace(/^@/u, '')
    .toLowerCase();
  const valid = value.mode === 'read_only'
    && value.platform === 'tiktok'
    && value.customerKey === (expected.customerKey ?? 'chemistry_k')
    && value.accountKey === (expected.accountKey ?? 'chemistry_k')
    && sourceHandle === (expected.sourceHandle ?? 'chemistry_k');
  if (!valid) {
    throw reconciliationError(
      'TikTok audit identity does not match the Integration Workspace source',
      'TIKTOK_GAP_RECONCILIATION_IDENTITY_MISMATCH',
    );
  }
}

function normalizeGap(value, fieldName) {
  const gap = requireObject(value, fieldName);
  const examples = requireArray(gap.externalContentIds, `${fieldName}.externalContentIds`)
    .map((item) => requireText(item, `${fieldName}.externalContentId`));
  const count = nonNegativeInteger(gap.count, `${fieldName}.count`);
  const truncated = gap.truncated === true;
  if (examples.length > count || (truncated && count <= examples.length)) {
    throw reconciliationError(
      `${fieldName} examples conflict with the reported count`,
      'TIKTOK_GAP_RECONCILIATION_AUDIT_INCONSISTENT',
      { fieldName, count, exampleCount: examples.length },
    );
  }
  return Object.freeze({
    count,
    truncated,
    externalContentIds: Object.freeze(examples),
  });
}

function normalizeIssue(issue) {
  const value = requireObject(issue, 'audit.issue');
  return Object.freeze({ code: requireText(value.code, 'audit.issue.code') });
}

function normalizeCrossLayerIssue(issue) {
  const value = requireObject(issue, 'audit.crossLayerIssue');
  const gap = requireChoice(value.gap, 'audit.crossLayerIssue.gap', ADDITIVE_GAP_NAMES);
  const count = nonNegativeInteger(value.count, 'audit.crossLayerIssue.count');
  if (count <= 0) {
    throw reconciliationError(
      'TikTok cross-layer issue count must be positive',
      'TIKTOK_GAP_RECONCILIATION_AUDIT_INCONSISTENT',
    );
  }
  return Object.freeze({ code: 'TIKTOK_CROSS_LAYER_GAP', gap, count });
}

function requireSourceWatermark(value) {
  const text = requireText(value, 'sourceWatermark');
  if (!SOURCE_WATERMARK_PATTERN.test(text)) {
    throw reconciliationError(
      'TikTok source watermark must be a SHA-256 hex digest',
      'TIKTOK_GAP_RECONCILIATION_WATERMARK_INVALID',
    );
  }
  return text.toLowerCase();
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!DATE_PATTERN.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw reconciliationError(
      `${fieldName} must be YYYY-MM-DD`,
      'TIKTOK_GAP_RECONCILIATION_DATE_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw reconciliationError(
      `${fieldName} must be an object`,
      'TIKTOK_GAP_RECONCILIATION_VALUE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) {
    throw reconciliationError(
      `${fieldName} must be an array`,
      'TIKTOK_GAP_RECONCILIATION_VALUE_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireChoice(value, fieldName, choices) {
  const text = requireText(value, fieldName);
  if (!choices.includes(text)) {
    throw reconciliationError(
      `${fieldName} is unsupported`,
      'TIKTOK_GAP_RECONCILIATION_VALUE_INVALID',
      { fieldName, choices },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw reconciliationError(
      `${fieldName} is required`,
      'TIKTOK_GAP_RECONCILIATION_VALUE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw reconciliationError(
      `${fieldName} must be a non-negative integer`,
      'TIKTOK_GAP_RECONCILIATION_VALUE_INVALID',
      { fieldName },
    );
  }
  return number;
}

function safeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2000, 0, 1)) {
    throw reconciliationError(
      `${fieldName} must be a safe timestamp`,
      'TIKTOK_GAP_RECONCILIATION_VALUE_INVALID',
      { fieldName },
    );
  }
  return number;
}

function optionalTimestamp(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return safeTimestamp(value, fieldName);
}

function compactSql(value) {
  return value.replace(/\s+/gu, ' ').trim();
}

function reconciliationError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'TikTokPostLarkGapReconciliationError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
