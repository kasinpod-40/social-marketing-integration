import { createHash } from 'node:crypto';

import { parseJsoncObject } from './chatwoot-safe-wrangler-config.js';

export const LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION =
  'lark_notification_controlled_uat_v1';
export const LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_NOTIFICATION_CONTROLLED_UAT',
  value: 'SEND_ONE_EXECUTIVE_NOTIFICATION_AND_VERIFY_REPLAY',
});
export const LARK_NOTIFICATION_CONTROLLED_UAT_TABLES = Object.freeze({
  aiRuns: '🧠 MKT_AI_Report_Runs',
  reportSnapshots: '🧾 MKT_Report_Snapshots',
  reportSettings: '⚙️ MKT_Report_Settings',
  notificationLog: '🔔 MKT_Notification_Log',
});
export const LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS = Object.freeze([
  'MKT_NOTIFICATION_RUNTIME_ENABLED',
  'MKT_NOTIFICATION_LARK_SEND_ENABLED',
  'MKT_NOTIFICATION_LARK_MIRROR_ENABLED',
]);
export const LARK_NOTIFICATION_CONTROLLED_UAT_MAPPINGS = Object.freeze({
  aiRuns: 'LARK_TABLE_MKT_AI_REPORT_RUNS',
  reportSnapshots: 'LARK_TABLE_MKT_REPORT_SNAPSHOTS',
  reportSettings: 'LARK_TABLE_MKT_REPORT_SETTINGS',
  notificationLog: 'LARK_TABLE_MKT_NOTIFICATION_LOG',
});

const HASH = /^[a-f0-9]{64}$/u;
const WINDOWS = new Set([1, 3, 7, 30]);
const SENDABLE_READINESS = new Set(['report_available', 'report_partial']);
const UAT_TEMPLATE = 'executive_notification_controlled_uat_v1';

export function assertLarkNotificationControlledUatConfirmation(env = {}) {
  const confirmation = LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION;
  if (env?.[confirmation.envName] !== confirmation.value) {
    throw uatError(
      `Controlled notification UAT requires ${confirmation.envName}=${confirmation.value}`,
      'LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION_REQUIRED',
      { envName: confirmation.envName },
    );
  }
  return true;
}

export function selectLarkNotificationExecutivePreview(records = [], options = {}) {
  if (!Array.isArray(records)) {
    throw uatError(
      'Executive Preview inventory must be an array',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
    );
  }
  const windowDays = Number(options.windowDays ?? 1);
  if (!WINDOWS.has(windowDays)) {
    throw uatError(
      'Controlled notification UAT window must be 1, 3, 7 or 30',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
    );
  }
  const candidates = records
    .map(normalizeLarkRecord)
    .filter(({ fields }) => (
      scalar(fields.scope_type) === 'executive'
      && Number(scalar(fields.window_days)) === windowDays
      && readBoolean(fields.preview_mode, 'preview_mode') === true
      && readBoolean(fields.sent_to_group, 'sent_to_group') === false
      && SENDABLE_READINESS.has(String(scalar(fields.readiness_status) ?? ''))
      && ['completed', 'generated'].includes(String(scalar(fields.generation_status) ?? ''))
    ))
    .map((record) => Object.freeze({
      ...record,
      generatedAt: timestamp(record.fields.generated_at),
    }))
    .sort((left, right) => right.generatedAt - left.generatedAt
      || left.recordId.localeCompare(right.recordId));
  if (candidates.length === 0) {
    throw uatError(
      'No sendable Executive Preview row is available',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_MISSING',
      { windowDays },
    );
  }
  if (candidates.length > 1 && candidates[0].generatedAt === candidates[1].generatedAt) {
    throw uatError(
      'Latest Executive Preview identity is ambiguous',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_AMBIGUOUS',
      { latestGeneratedAt: candidates[0].generatedAt },
    );
  }
  validateExecutivePreviewFields(candidates[0].fields);
  return candidates[0];
}

export function buildLarkNotificationControlledUatRow(sourceRecord) {
  const source = normalizeLarkRecord(sourceRecord);
  validateExecutivePreviewFields(source.fields);
  const sourceAiRunKey = requireText(scalar(source.fields.ai_run_key), 'source.ai_run_key');
  const sourceDedupeKey = requireHash(scalar(source.fields.dedupe_key), 'source.dedupe_key');
  const sourceReportIds = parseSourceReportIds(source.fields.source_report_ids_json);
  const identity = sha256(JSON.stringify({
    contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    template: UAT_TEMPLATE,
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds,
  }));
  const fields = structuredClone(source.fields);
  Object.assign(fields, {
    ai_run_key: `notification-uat:${identity}`,
    report_id: `notification-uat:${identity}`,
    scope_type: 'executive',
    channel_key: 'executive',
    capability: 'cross_channel',
    notification_eligible: true,
    notification_reason: 'controlled_uat',
    preview_mode: false,
    generation_status: 'generated',
    sent_to_group: false,
    sent_at: null,
    cooldown_until: null,
    failure_code: null,
    dedupe_key: sha256(`${sourceDedupeKey}:${UAT_TEMPLATE}`),
    source_report_ids_json: JSON.stringify(sourceReportIds),
  });
  return Object.freeze({
    sourceRecordId: source.recordId,
    sourceAiRunKey,
    aiRunKey: fields.ai_run_key,
    reportId: fields.report_id,
    sourceReportIds: Object.freeze(sourceReportIds),
    fields: deepFreeze(fields),
  });
}

export function resolveLarkNotificationControlledUatTables(tables = []) {
  if (!Array.isArray(tables)) {
    throw uatError(
      'Lark Table inventory must be an array',
      'LARK_NOTIFICATION_CONTROLLED_UAT_TABLE_INVENTORY_INVALID',
    );
  }
  const result = {};
  for (const [key, exactName] of Object.entries(LARK_NOTIFICATION_CONTROLLED_UAT_TABLES)) {
    const matches = tables.filter((table) => tableName(table) === exactName);
    if (matches.length !== 1) {
      throw uatError(
        'Controlled notification UAT requires one exact Lark Table per role',
        'LARK_NOTIFICATION_CONTROLLED_UAT_TABLE_INVENTORY_INVALID',
        { tableRole: key, matchCount: matches.length },
      );
    }
    result[key] = requireText(
      matches[0].tableId ?? matches[0].table_id ?? matches[0].id,
      `table.${key}`,
    );
  }
  return Object.freeze(result);
}

export function buildLarkNotificationControlledUatWranglerConfig(
  configText,
  tableIds,
  options = {},
) {
  let config;
  try {
    config = parseJsoncObject(requireText(configText, 'configText'));
  } catch (cause) {
    throw uatError(
      'Controlled notification UAT could not parse Wrangler config',
      'LARK_NOTIFICATION_CONTROLLED_UAT_CONFIG_INVALID',
      { cause: cause?.code ?? cause?.message ?? 'JSONC_PARSE_FAILED' },
    );
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw uatError(
      'Controlled notification UAT Wrangler config must be an object',
      'LARK_NOTIFICATION_CONTROLLED_UAT_CONFIG_INVALID',
    );
  }
  const active = options.active === true;
  const output = structuredClone(config);
  const varsBlocks = collectVarsBlocks(output);
  if (varsBlocks.length === 0) {
    output.vars = {};
    varsBlocks.push(output.vars);
  }
  for (const vars of varsBlocks) {
    for (const key of Object.keys(vars)) {
      if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) vars[key] = 'false';
    }
    for (const flag of LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS) {
      vars[flag] = active ? 'true' : 'false';
    }
    for (const [role, envName] of Object.entries(LARK_NOTIFICATION_CONTROLLED_UAT_MAPPINGS)) {
      vars[envName] = requireText(tableIds?.[role], `tableIds.${role}`);
    }
  }
  return Object.freeze({
    config: deepFreeze(output),
    text: `${JSON.stringify(output, null, 2)}\n`,
    active,
    notificationFlags: Object.freeze(Object.fromEntries(
      LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS.map((flag) => [flag, active]),
    )),
    scheduleConfigPreserved: JSON.stringify(config.triggers ?? null)
      === JSON.stringify(output.triggers ?? null),
  });
}

export function buildLarkNotificationControlledUatReadbackSql(aiRunKey) {
  const key = sqlText(requireText(aiRunKey, 'aiRunKey'));
  return compactSql(`
    SELECT
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'table' AND name = 'lark_notification_deliveries')
        AS notification_table_count,
      (SELECT COUNT(*) FROM sqlite_master
        WHERE type = 'index' AND name LIKE 'idx_lark_notification_delivery_%')
        AS notification_index_count,
      (SELECT COUNT(*) FROM sync_locks WHERE expires_at > unixepoch('now') * 1000)
        AS active_locks,
      (SELECT COUNT(*) FROM lark_notification_deliveries WHERE ai_run_key = '${key}')
        AS delivery_rows,
      (SELECT status FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS delivery_status,
      (SELECT mirror_status FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS mirror_status,
      (SELECT sent_at FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS sent_at,
      (SELECT message_id_hash FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS message_id_hash;
  `);
}

export function normalizeLarkNotificationControlledUatReadback(row = {}) {
  const normalized = Object.freeze({
    notificationTableCount: nonNegativeInteger(row.notification_table_count),
    notificationIndexCount: nonNegativeInteger(row.notification_index_count),
    activeLocks: nonNegativeInteger(row.active_locks),
    deliveryRows: nonNegativeInteger(row.delivery_rows),
    deliveryStatus: optionalText(row.delivery_status),
    mirrorStatus: optionalText(row.mirror_status),
    sentAt: row.sent_at === null || row.sent_at === undefined ? null : Number(row.sent_at),
    messageIdHash: optionalText(row.message_id_hash),
  });
  if (normalized.notificationTableCount !== 1
      || normalized.notificationIndexCount !== 3
      || normalized.activeLocks !== 0) {
    throw uatError(
      'Controlled notification UAT requires the applied schema and no active lock',
      'LARK_NOTIFICATION_CONTROLLED_UAT_REMOTE_STATE_INVALID',
      {
        notificationTableCount: normalized.notificationTableCount,
        notificationIndexCount: normalized.notificationIndexCount,
        activeLocks: normalized.activeLocks,
      },
    );
  }
  return normalized;
}

export function assertLarkNotificationControlledUatDelivered(readback = {}) {
  const value = normalizeLarkNotificationControlledUatReadback({
    notification_table_count: readback.notificationTableCount,
    notification_index_count: readback.notificationIndexCount,
    active_locks: readback.activeLocks,
    delivery_rows: readback.deliveryRows,
    delivery_status: readback.deliveryStatus,
    mirror_status: readback.mirrorStatus,
    sent_at: readback.sentAt,
    message_id_hash: readback.messageIdHash,
  });
  if (value.deliveryRows !== 1
      || value.deliveryStatus !== 'sent'
      || value.mirrorStatus !== 'mirrored'
      || !Number.isFinite(value.sentAt)
      || !HASH.test(value.messageIdHash ?? '')) {
    throw uatError(
      'Controlled notification UAT delivery is not confirmed and mirrored',
      'LARK_NOTIFICATION_CONTROLLED_UAT_DELIVERY_NOT_CONFIRMED',
      {
        deliveryRows: value.deliveryRows,
        deliveryStatus: value.deliveryStatus,
        mirrorStatus: value.mirrorStatus,
      },
    );
  }
  return value;
}

export function assertLarkNotificationControlledUatReplayStable(before, after) {
  const first = assertLarkNotificationControlledUatDelivered(before);
  const replay = assertLarkNotificationControlledUatDelivered(after);
  const stable = first.deliveryRows === replay.deliveryRows
    && first.sentAt === replay.sentAt
    && first.messageIdHash === replay.messageIdHash;
  if (!stable) {
    throw uatError(
      'Controlled notification replay changed the authoritative sent delivery',
      'LARK_NOTIFICATION_CONTROLLED_UAT_REPLAY_INVALID',
    );
  }
  return Object.freeze({
    deliveryRows: replay.deliveryRows,
    deliveryStatus: replay.deliveryStatus,
    mirrorStatus: replay.mirrorStatus,
    sentAtStable: true,
    messageIdHashStable: true,
    secondMessageSendBlockedByAtomicClaim: true,
  });
}

export function parseSourceReportIds(value) {
  const raw = requireText(scalar(value), 'source_report_ids_json');
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    throw uatError(
      'Executive Preview source_report_ids_json is invalid',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 32) {
    throw uatError(
      'Executive Preview requires a bounded source Report list',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
    );
  }
  const values = parsed.map((item) => requireText(item, 'source_report_id'));
  if (new Set(values).size !== values.length) {
    throw uatError(
      'Executive Preview source Report identities must be unique',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
    );
  }
  return Object.freeze([...values].sort());
}

function validateExecutivePreviewFields(fields) {
  for (const field of [
    'ai_run_key', 'report_id', 'dedupe_key', 'source_report_ids_json',
    'insight_summary', 'strengths', 'weaknesses', 'recommendations',
  ]) requireText(scalar(fields[field]), field);
  requireHash(scalar(fields.dedupe_key), 'dedupe_key');
  parseSourceReportIds(fields.source_report_ids_json);
  const windowDays = Number(scalar(fields.window_days));
  if (!WINDOWS.has(windowDays)) {
    throw uatError(
      'Executive Preview window is unsupported',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
    );
  }
}

function normalizeLarkRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw uatError(
      'Lark record must be an object',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
    );
  }
  const recordId = requireText(value.recordId ?? value.record_id, 'recordId');
  if (!value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) {
    throw uatError(
      'Lark record fields are required',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
    );
  }
  return Object.freeze({ recordId, fields: deepFreeze(structuredClone(value.fields)) });
}

function collectVarsBlocks(config) {
  const blocks = [];
  if (config.vars && typeof config.vars === 'object' && !Array.isArray(config.vars)) {
    blocks.push(config.vars);
  }
  if (config.env && typeof config.env === 'object' && !Array.isArray(config.env)) {
    for (const environment of Object.values(config.env)) {
      if (environment?.vars && typeof environment.vars === 'object' && !Array.isArray(environment.vars)) {
        blocks.push(environment.vars);
      }
    }
  }
  return blocks;
}

function tableName(table) {
  return optionalText(table?.name ?? table?.tableName ?? table?.table_name);
}
function timestamp(value) {
  const number = Number(scalar(value));
  if (!Number.isFinite(number) || number <= 0) {
    throw uatError(
      'Executive Preview generated_at is invalid',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
    );
  }
  return number;
}
function readBoolean(value, fieldName) {
  const resolved = scalar(value);
  if (resolved === true || resolved === false) return resolved;
  if (resolved === 1 || resolved === '1' || String(resolved).toLowerCase() === 'true') return true;
  if (resolved === 0 || resolved === '0' || String(resolved).toLowerCase() === 'false') return false;
  throw uatError(
    `${fieldName} must be Boolean`,
    'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
    { fieldName },
  );
}
function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join(',');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) {
      if (value[key] !== undefined) return scalar(value[key]);
    }
  }
  return value;
}
function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw uatError(
      'Controlled notification D1 count is invalid',
      'LARK_NOTIFICATION_CONTROLLED_UAT_D1_RESPONSE_INVALID',
    );
  }
  return number;
}
function sqlText(value) {
  return String(value).replaceAll("'", "''");
}
function compactSql(value) {
  return value.replaceAll(/\s+/gu, ' ').trim();
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function requireHash(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!HASH.test(text)) {
    throw uatError(
      `${fieldName} must be lowercase SHA-256`,
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID',
      { fieldName },
    );
  }
  return text;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw uatError(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_CONTROLLED_UAT_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}
function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}
function uatError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationControlledUatError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
