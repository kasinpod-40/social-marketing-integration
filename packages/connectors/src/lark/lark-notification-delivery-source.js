import {
  resolveDashboardReportSourceAuthority,
} from '../../../application/src/reports/dashboard-report-source-authority.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import {
  resolveLarkNotificationReviewedDestination,
} from './lark-notification-reviewed-destination.js';

const MAX_EXECUTIVE_SOURCE_REPORTS = 32;
const WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION = 'executive_weekly_7d_notification_v1';
const WEEKLY_7D_PLATFORM_SCOPES = Object.freeze([
  'chatwoot',
  'facebook',
  'google_ads',
  'instagram',
  'meta_ads',
  'tiktok',
  'woocommerce',
  'youtube',
]);
const BANGKOK_DATE_FORMATTER = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Bangkok',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});

/**
 * Loads one exact AI Run → source Settings chain without persisting raw destination identity.
 * Historical notification templates retain their Snapshot-backed authority. The reviewed Weekly
 * 7D dedicated template regenerates its exact Report/Setting identities through the same shared
 * Dashboard Report contracts because rolling historical Snapshots are not durable send evidence.
 */
export async function loadLarkNotificationDeliveryRequest(input = {}) {
  const repository = requireRepository(input.repository);
  const tables = requireTables(input.tables);
  const aiRunKey = requireText(input.aiRunKey, 'aiRunKey');
  const expectedDestinationKeyHash = requireHash(
    input.expectedDestinationKeyHash,
    'expectedDestinationKeyHash',
  );
  const expectedCustomerProfile = optionalText(input.expectedCustomerProfile);
  const expectedDestinationName = optionalText(input.expectedDestinationName);

  const aiRecord = await findExact(repository, tables.aiRuns, 'ai_run_key', aiRunKey, [
    'ai_run_key', 'report_id', 'template_version', 'scope_type', 'generation_status',
    'notification_eligible', 'preview_mode', 'sent_to_group', 'dedupe_key', 'window_days',
    'readiness_status', 'severity', 'insight_summary', 'strengths', 'weaknesses',
    'recommendations', 'source_report_ids_json', 'period_start', 'period_end',
  ]);
  const ai = aiRecord.fields;
  const reportId = requireText(readScalar(ai.report_id), 'report_id');
  const sourceReportIds = parseSourceReportIds(ai.source_report_ids_json, reportId);
  const weekly7d = isSnapshotlessWeekly7d(ai);
  const source = weekly7d
    ? normalizeWeekly7dSourceAuthority(ai, sourceReportIds, expectedCustomerProfile)
    : await loadSnapshotSourceAuthority(repository, tables, sourceReportIds, ai.window_days);
  if (expectedCustomerProfile !== null && source.customerProfile !== expectedCustomerProfile) {
    throw permanentError('Notification source belongs to a different Customer profile', {
      code: 'LARK_NOTIFICATION_SOURCE_REPORTS_MISMATCH',
      details: { expectedCustomerProfile, actualCustomerProfile: source.customerProfile },
    });
  }

  const settingCandidates = await repository.listByFieldValues(
    tables.reportSettings,
    'report_setting_key',
    source.reportSettingKeys,
  );
  const settings = source.reportSettingKeys.map((reportSettingKey) => {
    const matches = settingCandidates.filter((record) => (
      String(readScalar(record?.fields?.report_setting_key) ?? '') === reportSettingKey
        && String(readScalar(record?.fields?.customer_profile) ?? '') === source.customerProfile
    ));
    if (matches.length !== 1) {
      throw permanentError('Notification Settings identity must resolve to exactly one record', {
        code: 'LARK_NOTIFICATION_SETTINGS_EXACT_MATCH_REQUIRED',
        details: { matchCount: matches.length },
      });
    }
    return matches[0].fields;
  });

  const configuredGroupIds = settings.map((row) => optionalText(readScalar(row.group_id)));
  const nonNullGroupIds = [...new Set(configuredGroupIds.filter(Boolean))];
  const nullGroupCount = configuredGroupIds.filter((value) => value === null).length;

  let groupId;
  let observedDestinationKeyHash;
  if (nonNullGroupIds.length === 1 && (nullGroupCount === 0 || weekly7d)) {
    groupId = nonNullGroupIds[0];
    observedDestinationKeyHash = await sha256Hex(groupId);
    if (observedDestinationKeyHash !== expectedDestinationKeyHash) {
      throw permanentError('Notification destination does not match the reviewed executive group', {
        code: 'LARK_NOTIFICATION_DESTINATION_MISMATCH',
        details: { destinationRedacted: true },
      });
    }
  } else if (nonNullGroupIds.length === 0 && nullGroupCount === settings.length) {
    const resolved = await resolveLarkNotificationReviewedDestination({
      repository,
      client: input.client,
      expectedDestinationKeyHash,
      expectedName: expectedDestinationName ?? undefined,
    });
    groupId = resolved.chatId;
    observedDestinationKeyHash = resolved.destinationKeyHash;
  } else {
    throw permanentError('Executive source Settings must resolve to one exact destination state', {
      code: 'LARK_NOTIFICATION_DESTINATION_MISMATCH',
      details: {
        destinationRedacted: true,
        configuredDestinationCount: nonNullGroupIds.length,
        nullDestinationCount: nullGroupCount,
      },
    });
  }

  return Object.freeze({
    aiRun: Object.freeze({
      aiRunKey,
      reportId,
      templateVersion: readScalar(ai.template_version),
      scopeType: readScalar(ai.scope_type),
      generationStatus: readScalar(ai.generation_status),
      notificationEligible: readBoolean(ai.notification_eligible, 'notification_eligible'),
      previewMode: readBoolean(ai.preview_mode, 'preview_mode'),
      sentToGroup: readBoolean(ai.sent_to_group, 'sent_to_group'),
      dedupeKey: readScalar(ai.dedupe_key),
      windowDays: readScalar(ai.window_days),
      readinessStatus: readScalar(ai.readiness_status),
      severity: readScalar(ai.severity),
      insightSummary: readScalar(ai.insight_summary),
      strengths: readScalar(ai.strengths),
      weaknesses: readScalar(ai.weaknesses),
      recommendations: readScalar(ai.recommendations),
    }),
    snapshot: Object.freeze({
      // The AI report keeps its own identity. sourceReportIds are the exact Shared Report evidence.
      reportId,
      reportSettingKey: source.reportSettingKeys[0],
      sourceReportIds: Object.freeze(sourceReportIds),
      sourceReportSettingKeys: Object.freeze(source.reportSettingKeys),
      customerProfile: source.customerProfile,
      periodStart: source.periodStart,
      periodEnd: source.periodEnd,
    }),
    settings: Object.freeze({
      enabled: settings.every((row) => readBoolean(row.enabled, 'enabled')),
      aiEnabled: settings.every((row) => readBoolean(row.ai_enabled, 'ai_enabled')),
      notificationEnabled: settings.every((row) => readBoolean(
        row.notification_enabled,
        'notification_enabled',
      )),
      groupId,
      destinationKeyHash: observedDestinationKeyHash,
    }),
  });
}

/**
 * Mirrors one confirmed D1 `sent` delivery into both customer-facing Lark states.
 * Both plans are built before the first write. A replay repairs either partial mirror without
 * resending the group message because D1 remains authoritative.
 */
export function createLarkNotificationStateMirror(input = {}) {
  const repository = requireRepository(input.repository);
  const syncEngine = input.syncEngine;
  if (typeof syncEngine?.planByKey !== 'function' || typeof syncEngine?.executePlan !== 'function') {
    throw new TypeError('Lark notification mirror requires TableSyncEngine');
  }
  const notificationLogTableId = requireText(
    input.notificationLogTableId,
    'notificationLogTableId',
  );
  const aiRunsTableId = requireText(input.aiRunsTableId, 'aiRunsTableId');

  return async function mirrorNotificationState(row) {
    const notificationLogPlan = await syncEngine.planByKey({
      repository,
      tableId: notificationLogTableId,
      keyField: 'notification_attempt_key',
      rows: [row],
    });
    const aiRunPlan = await syncEngine.planByKey({
      repository,
      tableId: aiRunsTableId,
      keyField: 'ai_run_key',
      rows: [Object.freeze({
        ai_run_key: row.ai_run_key,
        sent_to_group: true,
        sent_at: row.sent_at,
      })],
    });

    const notificationLog = await syncEngine.executePlan(notificationLogPlan);
    assertExactlyOneMirror(notificationLog, 'LARK_NOTIFICATION_LOG_MIRROR_PARITY_FAILED');
    const aiRun = await syncEngine.executePlan(aiRunPlan);
    assertExactlyOneMirror(aiRun, 'LARK_NOTIFICATION_AI_RUN_MIRROR_PARITY_FAILED');
    return Object.freeze({ notificationLog, aiRun });
  };
}

function assertExactlyOneMirror(result, code) {
  if (result.created + result.updated + result.skipped !== 1) {
    throw permanentError('Notification state mirror did not reconcile exactly one row', { code });
  }
}

async function loadSnapshotSourceAuthority(repository, tables, sourceReportIds, windowDays) {
  const snapshots = await findExactMany(
    repository,
    tables.reportSnapshots,
    'report_id',
    sourceReportIds,
    ['report_id', 'report_setting_key', 'customer_profile', 'period_start', 'period_end'],
  );
  return normalizeSnapshotAuthority(snapshots, windowDays);
}

function isSnapshotlessWeekly7d(ai) {
  return readScalar(ai.template_version) === WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION
    && readScalar(ai.scope_type) === 'executive'
    && Number(readScalar(ai.window_days)) === 7;
}

function normalizeWeekly7dSourceAuthority(ai, sourceReportIds, expectedCustomerProfile) {
  const periodStart = normalizeDateOnly(ai.period_start, 'period_start');
  const periodEnd = normalizeDateOnly(ai.period_end, 'period_end');
  if (inclusiveDays(periodStart, periodEnd) !== 7) {
    throw permanentError('Weekly 7D Notification period must contain exactly seven days', {
      code: 'LARK_NOTIFICATION_SOURCE_REPORTS_MISMATCH',
    });
  }
  let authority;
  try {
    const profileKey = expectedCustomerProfile ?? 'integration_workspace';
    authority = resolveDashboardReportSourceAuthority({
      sourceReportIds,
      platformScopes: WEEKLY_7D_PLATFORM_SCOPES,
      profileKey,
      accountKey: 'chemistry_k',
      periodKind: 'rolling_days',
      periodStart,
      periodEnd,
      windowDays: 7,
    });
  } catch (cause) {
    throw permanentError('Weekly 7D Notification source identities do not match canonical Report authority', {
      code: 'LARK_NOTIFICATION_SOURCE_REPORTS_MISMATCH',
      details: {
        causeCode: cause?.code ?? null,
        sourceReportCount: sourceReportIds.length,
      },
    });
  }
  return Object.freeze({
    customerProfile: authority.profileKey,
    periodStart,
    periodEnd,
    reportSettingKeys: authority.reportSettingKeys,
  });
}

async function findExact(repository, tableId, fieldName, value, fieldNames) {
  const records = await repository.listByFieldValues(tableId, fieldName, [value]);
  const matches = records.filter((record) => String(readScalar(record?.fields?.[fieldName]) ?? '') === value);
  if (matches.length !== 1) {
    throw permanentError(`${fieldName} must resolve to exactly one Lark record`, {
      code: 'LARK_NOTIFICATION_EXACT_RECORD_REQUIRED',
      details: { fieldName, matchCount: matches.length },
    });
  }
  const fields = {};
  for (const name of fieldNames) fields[name] = matches[0]?.fields?.[name];
  return Object.freeze({ recordId: matches[0].recordId ?? null, fields: Object.freeze(fields) });
}

async function findExactMany(repository, tableId, fieldName, values, fieldNames) {
  const records = await repository.listByFieldValues(tableId, fieldName, values);
  const byIdentity = new Map();
  for (const record of records) {
    const identity = String(readScalar(record?.fields?.[fieldName]) ?? '');
    if (!values.includes(identity)) continue;
    const matches = byIdentity.get(identity) ?? [];
    matches.push(record);
    byIdentity.set(identity, matches);
  }
  return Object.freeze(values.map((value) => {
    const matches = byIdentity.get(value) ?? [];
    if (matches.length !== 1) {
      throw permanentError(`${fieldName} must resolve to exactly one Lark record`, {
        code: 'LARK_NOTIFICATION_EXACT_RECORD_REQUIRED',
        details: { fieldName, matchCount: matches.length },
      });
    }
    const fields = {};
    for (const name of fieldNames) fields[name] = matches[0]?.fields?.[name];
    return Object.freeze({ recordId: matches[0].recordId ?? null, fields: Object.freeze(fields) });
  }));
}

function parseSourceReportIds(value, fallbackReportId) {
  const scalar = readScalar(value);
  if (scalar === null || scalar === '') return Object.freeze([fallbackReportId]);
  let parsed;
  try {
    parsed = JSON.parse(String(scalar));
  } catch {
    throw permanentError('source_report_ids_json must be valid JSON', {
      code: 'LARK_NOTIFICATION_SOURCE_REPORTS_INVALID',
    });
  }
  if (!Array.isArray(parsed)
      || parsed.length === 0
      || parsed.length > MAX_EXECUTIVE_SOURCE_REPORTS) {
    throw permanentError('Executive notification requires a bounded source Report list', {
      code: 'LARK_NOTIFICATION_SOURCE_REPORTS_INVALID',
      details: { sourceReportCount: Array.isArray(parsed) ? parsed.length : null },
    });
  }
  const normalized = parsed.map((item) => requireText(item, 'source_report_id'));
  if (new Set(normalized).size !== normalized.length) {
    throw permanentError('Executive source Report identities must be unique', {
      code: 'LARK_NOTIFICATION_SOURCE_REPORTS_INVALID',
    });
  }
  return Object.freeze([...normalized].sort());
}

function normalizeSnapshotAuthority(records, windowValue) {
  const rows = records.map(({ fields }) => Object.freeze({
    reportId: requireText(String(readScalar(fields.report_id) ?? ''), 'report_id'),
    reportSettingKey: requireText(
      String(readScalar(fields.report_setting_key) ?? ''),
      'report_setting_key',
    ),
    customerProfile: requireText(
      String(readScalar(fields.customer_profile) ?? ''),
      'customer_profile',
    ),
    periodStart: normalizeDateOnly(fields.period_start, 'period_start'),
    periodEnd: normalizeDateOnly(fields.period_end, 'period_end'),
  }));
  const customerProfiles = [...new Set(rows.map((row) => row.customerProfile))];
  const periodStarts = [...new Set(rows.map((row) => row.periodStart))];
  const periodEnds = [...new Set(rows.map((row) => row.periodEnd))];
  if (customerProfiles.length !== 1 || periodStarts.length !== 1 || periodEnds.length !== 1) {
    throw permanentError('Executive source Reports must share one profile and period', {
      code: 'LARK_NOTIFICATION_SOURCE_REPORTS_MISMATCH',
      details: {
        customerProfileCount: customerProfiles.length,
        periodStartCount: periodStarts.length,
        periodEndCount: periodEnds.length,
      },
    });
  }
  const windowDays = Number(readScalar(windowValue));
  if (!Number.isSafeInteger(windowDays) || inclusiveDays(periodStarts[0], periodEnds[0]) !== windowDays) {
    throw permanentError('Executive source Report period does not match window_days', {
      code: 'LARK_NOTIFICATION_SOURCE_REPORTS_MISMATCH',
    });
  }
  return Object.freeze({
    customerProfile: customerProfiles[0],
    periodStart: periodStarts[0],
    periodEnd: periodEnds[0],
    reportSettingKeys: Object.freeze([...new Set(rows.map((row) => row.reportSettingKey))].sort()),
  });
}

function inclusiveDays(start, end) {
  const startMs = Date.parse(`${start}T00:00:00.000Z`);
  const endMs = Date.parse(`${end}T00:00:00.000Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

function requireRepository(repository) {
  for (const method of ['listByFieldValues', 'prepareRows', 'prepareExistingRecords', 'createMany', 'updateMany']) {
    if (typeof repository?.[method] !== 'function') {
      throw new TypeError(`Lark notification source requires repository.${method}`);
    }
  }
  return repository;
}
function requireTables(tables) {
  if (!tables || typeof tables !== 'object') throw new TypeError('tables are required');
  return Object.freeze({
    aiRuns: requireText(tables.aiRuns, 'tables.aiRuns'),
    reportSnapshots: requireText(tables.reportSnapshots, 'tables.reportSnapshots'),
    reportSettings: requireText(tables.reportSettings, 'tables.reportSettings'),
  });
}
function readScalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return readScalar(value[0]);
    return value.map(readScalar).join(',');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) {
      if (value[key] !== undefined) return readScalar(value[key]);
    }
  }
  return value;
}
function readBoolean(value, fieldName) {
  const scalar = readScalar(value);
  if (scalar === true || scalar === false) return scalar;
  if (scalar === 1 || scalar === '1' || String(scalar).toLowerCase() === 'true') return true;
  if (scalar === 0 || scalar === '0' || String(scalar).toLowerCase() === 'false') return false;
  throw new TypeError(`${fieldName} must be Boolean`);
}
function normalizeDateOnly(value, fieldName) {
  const scalar = readScalar(value);
  if (typeof scalar === 'number' || /^\d+$/u.test(String(scalar ?? ''))) {
    const date = new Date(Number(scalar));
    if (Number.isFinite(date.getTime())) return formatBangkokDateOnly(date);
  }
  const text = requireText(String(scalar ?? ''), fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new TypeError(`${fieldName} must be date-only`);
  return text;
}
function formatBangkokDateOnly(date) {
  const byType = Object.fromEntries(
    BANGKOK_DATE_FORMATTER.formatToParts(date).map(({ type, value }) => [type, value]),
  );
  return `${byType.year}-${byType.month}-${byType.day}`;
}
async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function requireHash(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new TypeError(`${fieldName} must be SHA-256 hex`);
  return text;
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
