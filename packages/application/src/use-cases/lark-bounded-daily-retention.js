export const LARK_BOUNDED_DAILY_RETENTION_VERSION = 'lark-bounded-daily-retention-v1';
export const LARK_BOUNDED_DAILY_RETENTION_DAYS = 90;
export const LARK_BOUNDED_DAILY_SOFT_LIMIT = 17_000;
export const LARK_BOUNDED_DAILY_TARGET_LIMIT = 15_000;
export const LARK_BOUNDED_DAILY_MAX_DELETE_ROWS = 500;

export const LARK_BOUNDED_DAILY_TABLE_CONTRACTS = Object.freeze([
  contract('mktConversationDaily', 'conversation_daily_key', 'chatwoot_conversation_daily_facts'),
  contract('mktAgentDaily', 'agent_daily_key', 'chatwoot_agent_daily_facts'),
  contract('mktInboxDaily', 'inbox_daily_key', 'chatwoot_inbox_daily_facts'),
  contract('mktConversationAccountDaily', 'account_daily_key', 'chatwoot_account_daily_facts'),
  contract('mktCommerceDaily', 'commerce_daily_key', 'commerce_daily_sales_facts'),
  contract('mktCommerceProductDaily', 'product_daily_key', 'commerce_product_daily_facts'),
]);

/**
 * เก็บ Lark เป็น recent cache โดยใช้ D1 เป็นประวัติเต็ม: ลบแถวเกินอายุ หรือกดจำนวนลงเมื่อใกล้เพดาน
 * ทุกแถวต้องมี Stable key/วันที่ตรงกันและพิสูจน์ตัวตนเดียวกันใน D1 ก่อนลบเสมอ.
 */
export async function runLarkBoundedDailyRetention(input = {}) {
  const client = requireClient(input.client);
  const db = requireDb(input.db);
  const tables = requireObject(input.tables, 'tables');
  const customerKey = requiredText(input.customerKey, 'customerKey');
  const timezone = requiredText(input.timezone ?? 'Asia/Bangkok', 'timezone');
  const nowValue = typeof input.now === 'function' ? input.now() : (input.now ?? Date.now());
  const now = normalizeNow(nowValue);
  const retentionDays = positiveInteger(
    input.retentionDays ?? LARK_BOUNDED_DAILY_RETENTION_DAYS,
    'retentionDays',
  );
  const softLimit = positiveInteger(
    input.softLimit ?? LARK_BOUNDED_DAILY_SOFT_LIMIT,
    'softLimit',
  );
  const targetLimit = positiveInteger(
    input.targetLimit ?? LARK_BOUNDED_DAILY_TARGET_LIMIT,
    'targetLimit',
  );
  const maxDeleteRows = boundedPositiveInteger(
    input.maxDeleteRows ?? LARK_BOUNDED_DAILY_MAX_DELETE_ROWS,
    'maxDeleteRows',
    LARK_BOUNDED_DAILY_MAX_DELETE_ROWS,
  );
  if (targetLimit >= softLimit) throw new TypeError('targetLimit must be lower than softLimit');

  await assertNoActiveSyncLocks(db, now);
  const cutoffDate = retentionCutoffDate(now, timezone, retentionDays);
  const tableStates = [];
  for (const tableContract of LARK_BOUNDED_DAILY_TABLE_CONTRACTS) {
    const tableId = requiredText(tables[tableContract.tableKey], `tables.${tableContract.tableKey}`);
    tableStates.push({
      ...tableContract,
      tableId,
      recordsBefore: await countLarkRecords(client, tableId),
    });
  }
  tableStates.sort((left, right) => {
    const leftPressure = left.recordsBefore >= softLimit ? 1 : 0;
    const rightPressure = right.recordsBefore >= softLimit ? 1 : 0;
    return rightPressure - leftPressure || right.recordsBefore - left.recordsBefore;
  });

  let remainingDeletes = maxDeleteRows;
  const results = [];
  for (const state of tableStates) {
    const result = await retainOneTable({
      client,
      db,
      customerKey,
      timezone,
      now,
      cutoffDate,
      softLimit,
      targetLimit,
      maxDeleteRows: remainingDeletes,
      state,
    });
    remainingDeletes -= result.deleted;
    results.push(result);
  }

  return Object.freeze({
    status: 'completed',
    contractVersion: LARK_BOUNDED_DAILY_RETENTION_VERSION,
    retentionDays,
    cutoffDate,
    softLimit,
    targetLimit,
    maxDeleteRows,
    deleted: results.reduce((sum, row) => sum + row.deleted, 0),
    d1Mutations: 0,
    tables: Object.freeze(results),
  });
}

async function retainOneTable(input) {
  const { state } = input;
  if (state.recordsBefore === 0 || input.maxDeleteRows === 0) {
    return tableResult(
      state,
      state.recordsBefore,
      state.recordsBefore >= input.softLimit,
      0,
      0,
      0,
      0,
    );
  }
  const pressureRequested = state.recordsBefore >= input.softLimit
    ? Math.min(input.maxDeleteRows, Math.max(0, state.recordsBefore - input.targetLimit))
    : 0;
  const oldest = await input.client.searchRecords({
    tableId: state.tableId,
    fieldNames: [state.stableKeyField, 'metric_date'],
    sort: [{ fieldName: 'metric_date', desc: false }],
    pageSize: Math.min(input.maxDeleteRows, 500),
    maxPages: 2,
    stopWhen: ({ totalRows }) => totalRows >= input.maxDeleteRows,
  });
  const normalized = oldest.map((record) => normalizeCandidate(record, state, input.timezone));
  const valid = normalized.filter(Boolean);
  const expired = valid.filter((row) => row.metricDate < input.cutoffDate);
  const candidates = pressureRequested > 0
    ? valid.slice(0, Math.max(pressureRequested, expired.length))
    : expired;
  const boundedCandidates = candidates.slice(0, input.maxDeleteRows);
  const verified = await verifyD1StableKeys({
    db: input.db,
    customerKey: input.customerKey,
    state,
    candidates: boundedCandidates,
  });
  const safeDeletes = boundedCandidates.filter((row) => verified.has(row.stableKey));

  let deleted = 0;
  if (safeDeletes.length > 0) {
    const response = await input.client.batchDeleteRecords({
      tableId: state.tableId,
      recordIds: safeDeletes.map((row) => row.recordId),
      beforeChunk: () => assertNoActiveSyncLocks(input.db, Date.now()),
    });
    deleted = Number(response?.deleted ?? 0);
    if (deleted !== safeDeletes.length) throw retentionError(
      `Bounded Daily retention delete count mismatch for ${state.tableKey}`,
      'LARK_BOUNDED_DAILY_RETENTION_DELETE_COUNT_MISMATCH',
    );
    const surviving = await input.client.searchRecordsByFieldValues({
      tableId: state.tableId,
      fieldName: state.stableKeyField,
      values: safeDeletes.map((row) => row.stableKey),
      includeRecordMetadata: false,
    });
    if (surviving.length > 0) throw retentionError(
      `Bounded Daily retention readback failed for ${state.tableKey}`,
      'LARK_BOUNDED_DAILY_RETENTION_READBACK_FAILED',
    );
  }

  const recordsAfter = deleted > 0
    ? await countLarkRecords(input.client, state.tableId)
    : state.recordsBefore;
  return tableResult(
    state,
    recordsAfter,
    state.recordsBefore >= input.softLimit,
    boundedCandidates.length,
    safeDeletes.length,
    normalized.length - valid.length + boundedCandidates.length - safeDeletes.length,
    deleted,
  );
}

function normalizeCandidate(record, state, timezone) {
  const recordId = optionalText(record?.recordId ?? record?.record_id);
  const fields = record?.fields && typeof record.fields === 'object' ? record.fields : {};
  const stableKey = readText(fields[state.stableKeyField]);
  const stableMetricDate = metricDateFromStableKey(stableKey);
  const visibleMetricDate = readMetricDate(fields.metric_date, timezone);
  if (!recordId || !stableKey || !stableKey.startsWith(`${state.sourcePrefix}:`)
    || !stableMetricDate || visibleMetricDate !== stableMetricDate) return null;
  return Object.freeze({ recordId, stableKey, metricDate: stableMetricDate });
}

async function verifyD1StableKeys({ db, customerKey, state, candidates }) {
  const verified = new Set();
  for (let index = 0; index < candidates.length; index += 40) {
    const keys = candidates.slice(index, index + 40).map((row) => row.stableKey);
    if (keys.length === 0) continue;
    const placeholders = keys.map(() => '?').join(',');
    const response = await db.prepare(
      `SELECT ${state.d1KeyField} AS stable_key FROM ${state.d1Table} WHERE customer_key = ? AND ${state.d1KeyField} IN (${placeholders})`,
    ).bind(customerKey, ...keys).all();
    const rows = Array.isArray(response) ? response : (response?.results ?? []);
    for (const row of rows) {
      const stableKey = optionalText(row?.stable_key);
      if (stableKey) verified.add(stableKey);
    }
  }
  return verified;
}

function tableResult(state, recordsAfter, pressureTriggered, candidates, d1Verified, safetyBlocked, deleted) {
  return Object.freeze({
    tableKey: state.tableKey,
    recordsBefore: state.recordsBefore,
    recordsAfter,
    pressureTriggered,
    candidates,
    d1Verified,
    safetyBlocked,
    deleted,
  });
}

function contract(tableKey, stableKeyField, d1Table) {
  return Object.freeze({
    tableKey,
    stableKeyField,
    d1Table,
    d1KeyField: stableKeyField,
    sourcePrefix: d1Table.startsWith('chatwoot_') ? 'chatwoot' : 'woocommerce',
  });
}

async function countLarkRecords(client, tableId) {
  const response = await client.requestBitableJson(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}/tables/${encodeURIComponent(tableId)}/records?page_size=1`,
    { method: 'GET' },
  );
  const total = Number(response?.data?.total);
  if (!Number.isSafeInteger(total) || total < 0) throw retentionError(
    'Bounded Daily retention could not read a trustworthy Lark record count',
    'LARK_BOUNDED_DAILY_RETENTION_COUNT_UNAVAILABLE',
  );
  return total;
}

async function assertNoActiveSyncLocks(db, now) {
  const result = await db.prepare(
    'SELECT COUNT(*) AS active_locks FROM sync_locks WHERE expires_at > ?',
  ).bind(Number(now)).first();
  if (Number(result?.active_locks ?? 0) > 0) throw retentionError(
    'Bounded Daily retention is blocked by an active sync lock',
    'LARK_BOUNDED_DAILY_RETENTION_ACTIVE_LOCK',
  );
}

function retentionCutoffDate(now, timezone, retentionDays) {
  const current = dateParts(now, timezone);
  const anchor = Date.UTC(current.year, current.month - 1, current.day);
  const cutoff = new Date(anchor - ((retentionDays - 1) * 86_400_000));
  return formatUtcDate(cutoff);
}

function metricDateFromStableKey(stableKey) {
  if (!stableKey) return null;
  const matches = [...stableKey.matchAll(/(?:^|:)(\d{4}-\d{2}-\d{2})(?=:|$)/gu)];
  return matches.length === 1 ? matches[0][1] : null;
}

function readMetricDate(value, timezone) {
  const text = readText(value);
  if (/^\d{4}-\d{2}-\d{2}$/u.test(text ?? '')) return text;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) return null;
  return formatDateInTimeZone(number, timezone);
}

function readText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value) && value.length === 1) return readText(value[0]);
  if (value && typeof value === 'object') return readText(value.text ?? value.name ?? value.value);
  return null;
}

function formatDateInTimeZone(epoch, timezone) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const parts = Object.fromEntries(
    formatter.formatToParts(new Date(epoch)).filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateParts(epoch, timezone) {
  const text = formatDateInTimeZone(epoch, timezone);
  const [year, month, day] = text.split('-').map(Number);
  if (![year, month, day].every(Number.isSafeInteger)) throw new TypeError(`Invalid timezone: ${timezone}`);
  return { year, month, day };
}

function formatUtcDate(value) {
  return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}-${String(value.getUTCDate()).padStart(2, '0')}`;
}

function normalizeNow(value) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError('now must be a valid epoch');
  return number;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requiredText(value, fieldName) {
  const result = optionalText(value);
  if (!result) throw new TypeError(`${fieldName} is required`);
  return result;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}

function boundedPositiveInteger(value, fieldName, maximum) {
  const number = positiveInteger(value, fieldName);
  if (number > maximum) throw new TypeError(`${fieldName} cannot exceed ${maximum}`);
  return number;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
  return value;
}

function requireClient(value) {
  if (!value || typeof value.requestBitableJson !== 'function'
    || typeof value.searchRecords !== 'function'
    || typeof value.searchRecordsByFieldValues !== 'function'
    || typeof value.batchDeleteRecords !== 'function') {
    throw new TypeError('Bounded Daily retention requires a Lark client');
  }
  return value;
}

function requireDb(value) {
  if (!value || typeof value.prepare !== 'function') throw new TypeError('Bounded Daily retention requires D1');
  return value;
}

function retentionError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}
