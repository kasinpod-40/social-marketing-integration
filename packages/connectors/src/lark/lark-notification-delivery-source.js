import { permanentError } from '../../../shared/src/errors/runtime-error.js';

/** Loads one exact AI Run → Snapshot → Settings chain without persisting raw destination identity. */
export async function loadLarkNotificationDeliveryRequest(input = {}) {
  const repository = requireRepository(input.repository);
  const tables = requireTables(input.tables);
  const aiRunKey = requireText(input.aiRunKey, 'aiRunKey');
  const expectedDestinationKeyHash = requireHash(
    input.expectedDestinationKeyHash,
    'expectedDestinationKeyHash',
  );

  const aiRecord = await findExact(repository, tables.aiRuns, 'ai_run_key', aiRunKey, [
    'ai_run_key', 'report_id', 'scope_type', 'generation_status', 'notification_eligible',
    'preview_mode', 'sent_to_group', 'dedupe_key', 'window_days', 'readiness_status',
    'severity', 'insight_summary', 'strengths', 'weaknesses', 'recommendations',
  ]);
  const ai = aiRecord.fields;
  const reportId = requireText(readScalar(ai.report_id), 'report_id');

  const snapshotRecord = await findExact(
    repository,
    tables.reportSnapshots,
    'report_id',
    reportId,
    ['report_id', 'report_setting_key', 'customer_profile', 'period_start', 'period_end'],
  );
  const snapshot = snapshotRecord.fields;
  const reportSettingKey = requireText(readScalar(snapshot.report_setting_key), 'report_setting_key');
  const customerProfile = requireText(readScalar(snapshot.customer_profile), 'customer_profile');

  const settingCandidates = await repository.listByFieldValues(
    tables.reportSettings,
    'report_setting_key',
    [reportSettingKey],
  );
  const settingsMatches = settingCandidates.filter((record) => (
    String(readScalar(record?.fields?.report_setting_key) ?? '') === reportSettingKey
      && String(readScalar(record?.fields?.customer_profile) ?? '') === customerProfile
  ));
  if (settingsMatches.length !== 1) {
    throw permanentError('Notification Settings identity must resolve to exactly one record', {
      code: 'LARK_NOTIFICATION_SETTINGS_EXACT_MATCH_REQUIRED',
      details: { matchCount: settingsMatches.length },
    });
  }
  const settings = settingsMatches[0].fields;
  const groupId = requireText(readScalar(settings.group_id), 'group_id');
  const observedDestinationKeyHash = await sha256Hex(groupId);
  if (observedDestinationKeyHash !== expectedDestinationKeyHash) {
    throw permanentError('Notification destination does not match the reviewed executive group', {
      code: 'LARK_NOTIFICATION_DESTINATION_MISMATCH',
      details: { destinationRedacted: true },
    });
  }

  return Object.freeze({
    aiRun: Object.freeze({
      aiRunKey,
      reportId,
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
      reportId,
      reportSettingKey,
      customerProfile,
      periodStart: normalizeDateOnly(snapshot.period_start, 'period_start'),
      periodEnd: normalizeDateOnly(snapshot.period_end, 'period_end'),
    }),
    settings: Object.freeze({
      enabled: readBoolean(settings.enabled, 'enabled'),
      aiEnabled: readBoolean(settings.ai_enabled, 'ai_enabled'),
      notificationEnabled: readBoolean(settings.notification_enabled, 'notification_enabled'),
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
    if (Number.isFinite(date.getTime())) return date.toISOString().slice(0, 10);
  }
  const text = requireText(String(scalar ?? ''), fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new TypeError(`${fieldName} must be date-only`);
  return text;
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
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
