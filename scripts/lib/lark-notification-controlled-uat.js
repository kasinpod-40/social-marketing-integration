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
const READINESS = new Set(['report_available', 'report_partial']);
const UAT_TEMPLATE = 'executive_notification_controlled_uat_v1';

export function assertLarkNotificationControlledUatConfirmation(env = {}) {
  const { envName, value } = LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION;
  if (env?.[envName] !== value) {
    throw error(
      `Controlled notification UAT requires ${envName}=${value}`,
      'LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION_REQUIRED',
      { envName },
    );
  }
  return true;
}

export function selectLarkNotificationExecutivePreview(records = [], options = {}) {
  if (!Array.isArray(records)) throw inputError('Executive Preview inventory must be an array');
  const windowDays = Number(options.windowDays ?? 1);
  if (!WINDOWS.has(windowDays)) throw inputError('Controlled UAT window is unsupported');
  const matches = records
    .map(normalizeRecord)
    .filter(({ fields }) => (
      scalar(fields.scope_type) === 'executive'
      && Number(scalar(fields.window_days)) === windowDays
      && bool(fields.preview_mode, 'preview_mode')
      && !bool(fields.sent_to_group, 'sent_to_group')
      && READINESS.has(String(scalar(fields.readiness_status) ?? ''))
      && ['completed', 'generated'].includes(String(scalar(fields.generation_status) ?? ''))
    ))
    .map((record) => Object.freeze({
      ...record,
      generatedAt: positiveNumber(scalar(record.fields.generated_at), 'generated_at'),
    }))
    .sort((a, b) => b.generatedAt - a.generatedAt || a.recordId.localeCompare(b.recordId));
  if (matches.length === 0) {
    throw error(
      'No sendable Executive Preview row is available',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_MISSING',
      { windowDays },
    );
  }
  if (matches.length > 1 && matches[0].generatedAt === matches[1].generatedAt) {
    throw error(
      'Latest Executive Preview identity is ambiguous',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_AMBIGUOUS',
      { latestGeneratedAt: matches[0].generatedAt },
    );
  }
  validatePreview(matches[0].fields);
  return matches[0];
}

export function buildLarkNotificationControlledUatRow(sourceRecord) {
  const source = normalizeRecord(sourceRecord);
  validatePreview(source.fields);
  const sourceAiRunKey = text(scalar(source.fields.ai_run_key), 'source.ai_run_key');
  const sourceDedupeKey = hash(scalar(source.fields.dedupe_key), 'source.dedupe_key');
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
    sourceReportIds,
    fields: freeze(fields),
  });
}

export function resolveLarkNotificationControlledUatTables(tables = []) {
  if (!Array.isArray(tables)) throw inputError('Lark Table inventory must be an array');
  const resolved = {};
  for (const [role, exactName] of Object.entries(LARK_NOTIFICATION_CONTROLLED_UAT_TABLES)) {
    const matches = tables.filter((table) => (
      optionalText(table?.name ?? table?.tableName ?? table?.table_name) === exactName
    ));
    if (matches.length !== 1) {
      throw error(
        'Controlled UAT requires one exact Lark Table per role',
        'LARK_NOTIFICATION_CONTROLLED_UAT_TABLE_INVENTORY_INVALID',
        { tableRole: role, matchCount: matches.length },
      );
    }
    resolved[role] = text(
      matches[0].tableId ?? matches[0].table_id ?? matches[0].id,
      `table.${role}`,
    );
  }
  return Object.freeze(resolved);
}

export function buildLarkNotificationControlledUatWranglerConfig(
  configText,
  tableIds,
  options = {},
) {
  let config;
  try { config = parseJsoncObject(text(configText, 'configText')); } catch (cause) {
    throw error(
      'Controlled UAT could not parse Wrangler config',
      'LARK_NOTIFICATION_CONTROLLED_UAT_CONFIG_INVALID',
      { cause: cause?.code ?? cause?.message ?? 'JSONC_PARSE_FAILED' },
    );
  }
  if (!config || typeof config !== 'object' || Array.isArray(config)) {
    throw error(
      'Controlled UAT Wrangler config must be an object',
      'LARK_NOTIFICATION_CONTROLLED_UAT_CONFIG_INVALID',
    );
  }
  const output = structuredClone(config);
  const varsBlocks = collectVars(output);
  if (varsBlocks.length === 0) {
    output.vars = {};
    varsBlocks.push(output.vars);
  }
  const active = options.active === true;
  for (const vars of varsBlocks) {
    for (const key of Object.keys(vars)) {
      if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) vars[key] = 'false';
    }
    for (const flag of LARK_NOTIFICATION_CONTROLLED_UAT_FLAGS) {
      vars[flag] = active ? 'true' : 'false';
    }
    for (const [role, envName] of Object.entries(LARK_NOTIFICATION_CONTROLLED_UAT_MAPPINGS)) {
      vars[envName] = text(tableIds?.[role], `tableIds.${role}`);
    }
  }
  return Object.freeze({
    config: freeze(output),
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
  const key = String(text(aiRunKey, 'aiRunKey')).replaceAll("'", "''");
  return compact(`
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
      (SELECT lark_message_id_hash FROM lark_notification_deliveries
        WHERE ai_run_key = '${key}' LIMIT 1) AS message_id_hash;
  `);
}

export function normalizeLarkNotificationControlledUatReadback(row = {}) {
  const value = Object.freeze({
    notificationTableCount: count(row.notification_table_count),
    notificationIndexCount: count(row.notification_index_count),
    activeLocks: count(row.active_locks),
    deliveryRows: count(row.delivery_rows),
    deliveryStatus: optionalText(row.delivery_status),
    mirrorStatus: optionalText(row.mirror_status),
    sentAt: row.sent_at === null || row.sent_at === undefined ? null : Number(row.sent_at),
    messageIdHash: optionalText(row.message_id_hash),
  });
  if (value.notificationTableCount !== 1
      || value.notificationIndexCount !== 3
      || value.activeLocks !== 0) {
    throw error(
      'Controlled UAT requires the applied notification schema and no active lock',
      'LARK_NOTIFICATION_CONTROLLED_UAT_REMOTE_STATE_INVALID',
      {
        notificationTableCount: value.notificationTableCount,
        notificationIndexCount: value.notificationIndexCount,
        activeLocks: value.activeLocks,
      },
    );
  }
  return value;
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
    throw error(
      'Controlled UAT delivery is not confirmed and mirrored',
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
  if (first.deliveryRows !== replay.deliveryRows
      || first.sentAt !== replay.sentAt
      || first.messageIdHash !== replay.messageIdHash) {
    throw error(
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
  const raw = text(scalar(value), 'source_report_ids_json');
  let parsed;
  try { parsed = JSON.parse(raw); } catch {
    throw inputError('Executive Preview source_report_ids_json is invalid');
  }
  if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 32) {
    throw inputError('Executive Preview requires a bounded source Report list');
  }
  const values = parsed.map((item) => text(item, 'source_report_id'));
  if (new Set(values).size !== values.length) {
    throw inputError('Executive Preview source Report identities must be unique');
  }
  return Object.freeze([...values].sort());
}

function validatePreview(fields) {
  for (const field of [
    'ai_run_key', 'report_id', 'dedupe_key', 'source_report_ids_json',
    'insight_summary', 'strengths', 'weaknesses', 'recommendations',
  ]) text(scalar(fields[field]), field);
  hash(scalar(fields.dedupe_key), 'dedupe_key');
  parseSourceReportIds(fields.source_report_ids_json);
  if (!WINDOWS.has(Number(scalar(fields.window_days)))) {
    throw inputError('Executive Preview window is unsupported');
  }
}

function normalizeRecord(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw inputError('Lark record must be an object');
  }
  if (!value.fields || typeof value.fields !== 'object' || Array.isArray(value.fields)) {
    throw inputError('Lark record fields are required');
  }
  return Object.freeze({
    recordId: text(value.recordId ?? value.record_id, 'recordId'),
    fields: freeze(structuredClone(value.fields)),
  });
}

function collectVars(config) {
  const blocks = [];
  if (config.vars && typeof config.vars === 'object' && !Array.isArray(config.vars)) {
    blocks.push(config.vars);
  }
  for (const environment of Object.values(config.env ?? {})) {
    if (environment?.vars && typeof environment.vars === 'object'
        && !Array.isArray(environment.vars)) blocks.push(environment.vars);
  }
  return blocks;
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
function bool(value, fieldName) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  throw inputError(`${fieldName} must be Boolean`, { fieldName });
}
function count(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw error(
      'Controlled UAT D1 count is invalid',
      'LARK_NOTIFICATION_CONTROLLED_UAT_D1_RESPONSE_INVALID',
    );
  }
  return number;
}
function positiveNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number <= 0) throw inputError(`${fieldName} is invalid`);
  return number;
}
function hash(value, fieldName) {
  const item = text(value, fieldName);
  if (!HASH.test(item)) throw inputError(`${fieldName} must be lowercase SHA-256`);
  return item;
}
function text(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw error(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_CONTROLLED_UAT_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const item = String(value).trim();
  return item || null;
}
function compact(value) {
  return value.replaceAll(/\s+/gu, ' ').trim();
}
function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
function freeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) freeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}
function inputError(message, details = {}) {
  return error(message, 'LARK_NOTIFICATION_CONTROLLED_UAT_SOURCE_INVALID', details);
}
function error(message, code, details = {}) {
  const value = new Error(message);
  value.name = 'LarkNotificationControlledUatError';
  value.code = code;
  value.details = Object.freeze({ ...details });
  return value;
}
