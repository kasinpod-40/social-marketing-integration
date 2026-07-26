import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const MAX_READ_IDS = 500;
const FORBIDDEN_FIELDS = new Set([
  'content',
  'processed_message_content',
  'message_content',
  'email',
  'phone',
  'phone_number',
  'identifier',
  'name',
  'available_name',
  'avatar',
  'avatar_url',
  'thumbnail',
  'url',
  'website_url',
  'callback_webhook_url',
  'website_token',
  'access_token',
  'authorization',
  'secret',
  'token',
  'attachments',
  'attachment_json',
  'custom_attributes',
  'additional_attributes',
]);

const TABLES = Object.freeze({
  account: spec('chatwoot_account_state', 'account_state_key', [
    'account_state_key', 'customer_key', 'account_key', 'external_account_id',
    'first_seen_at', 'last_seen_at', 'source_updated_at', 'metadata_hash',
    'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'source_updated_at' }),
  inboxes: spec('chatwoot_inbox_state', 'inbox_key', [
    'inbox_key', 'customer_key', 'account_key', 'external_account_id', 'external_inbox_id',
    'channel_type', 'medium', 'timezone', 'enable_auto_assignment', 'working_hours_enabled',
    'csat_survey_enabled', 'allow_messages_after_resolved', 'first_seen_at', 'last_seen_at',
    'source_updated_at', 'metadata_hash', 'last_coverage_run_id', 'last_sync_run_id',
    'created_at', 'updated_at',
  ], { revisionField: 'source_updated_at' }),
  contacts: spec('chatwoot_contact_state', 'contact_key', [
    'contact_key', 'customer_key', 'account_key', 'external_account_id', 'external_contact_id',
    'blocked', 'availability_status', 'source_availability_status', 'source_created_at',
    'last_activity_at', 'source_updated_at', 'first_seen_at', 'last_seen_at', 'metadata_hash',
    'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'source_updated_at' }),
  agents: spec('chatwoot_agent_state', 'agent_key', [
    'agent_key', 'customer_key', 'account_key', 'external_account_id', 'external_agent_id',
    'role', 'availability_status', 'auto_offline', 'confirmed', 'custom_role_id',
    'first_seen_at', 'last_seen_at', 'source_updated_at', 'metadata_hash',
    'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'source_updated_at' }),
  teams: spec('chatwoot_team_state', 'team_key', [
    'team_key', 'customer_key', 'account_key', 'external_account_id', 'external_team_id',
    'allow_auto_assign', 'first_seen_at', 'last_seen_at', 'source_updated_at', 'metadata_hash',
    'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'source_updated_at' }),
  labels: spec('chatwoot_label_state', 'label_key', [
    'label_key', 'customer_key', 'account_key', 'external_account_id', 'external_label_id',
    'title', 'color', 'show_on_sidebar', 'first_seen_at', 'last_seen_at', 'source_updated_at',
    'metadata_hash', 'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'source_updated_at', allowDisplayFields: new Set(['title']) }),
  conversationLabels: spec('chatwoot_conversation_label_state', 'conversation_label_key', [
    'conversation_label_key', 'conversation_key', 'label_key', 'external_conversation_id',
    'external_label_id', 'active', 'observed_at', 'removed_at', 'coverage_run_id',
    'sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'observed_at' }),
  messages: spec('chatwoot_message_analytics_state', 'message_key', [
    'message_key', 'conversation_key', 'customer_key', 'account_key', 'external_account_id',
    'external_message_id', 'external_conversation_id', 'external_inbox_id', 'message_type',
    'direction', 'content_type', 'private', 'sender_type', 'external_sender_id',
    'attachment_count', 'source_created_at', 'source_updated_at', 'metadata_hash',
    'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'source_updated_at' }),
  reportingEvents: spec('chatwoot_reporting_event_facts', 'reporting_event_key', [
    'reporting_event_key', 'customer_key', 'account_key', 'external_account_id',
    'external_reporting_event_id', 'event_name', 'value_seconds', 'value_business_seconds',
    'external_conversation_id', 'external_inbox_id', 'external_agent_id', 'event_start_at',
    'event_end_at', 'source_created_at', 'source_updated_at', 'source_payload_hash',
    'coverage_run_id', 'sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'source_updated_at' }),
  conversationDaily: spec('chatwoot_conversation_daily_facts', 'conversation_daily_key', [
    'conversation_daily_key', 'customer_key', 'account_key', 'external_account_id',
    'external_conversation_id', 'external_inbox_id', 'external_agent_id', 'external_team_id',
    'metric_date', 'reporting_timezone', 'status', 'new_conversation_count', 'resolved_count',
    'reopened_count', 'incoming_message_count', 'outgoing_message_count', 'private_message_count',
    'attachment_message_count', 'first_response_seconds', 'first_response_business_seconds',
    'resolution_seconds', 'resolution_business_seconds', 'reply_seconds', 'reply_business_seconds',
    'data_status', 'coverage_run_id', 'source_revision', 'fetched_at', 'sync_run_id',
    'created_at', 'updated_at',
  ], { revisionField: 'fetched_at' }),
  agentDaily: spec('chatwoot_agent_daily_facts', 'agent_daily_key', [
    'agent_daily_key', 'customer_key', 'account_key', 'external_account_id', 'external_agent_id',
    'metric_date', 'reporting_timezone', 'assigned_conversation_count', 'resolved_count',
    'reopened_count', 'incoming_message_count', 'outgoing_message_count',
    'avg_first_response_seconds', 'avg_resolution_seconds', 'avg_reply_seconds', 'data_status',
    'coverage_run_id', 'source_revision', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'fetched_at' }),
  inboxDaily: spec('chatwoot_inbox_daily_facts', 'inbox_daily_key', [
    'inbox_daily_key', 'customer_key', 'account_key', 'external_account_id', 'external_inbox_id',
    'metric_date', 'reporting_timezone', 'conversation_count', 'new_conversation_count',
    'resolved_count', 'reopened_count', 'incoming_message_count', 'outgoing_message_count',
    'avg_first_response_seconds', 'avg_resolution_seconds', 'avg_reply_seconds', 'data_status',
    'coverage_run_id', 'source_revision', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'fetched_at' }),
  accountDaily: spec('chatwoot_account_daily_facts', 'account_daily_key', [
    'account_daily_key', 'customer_key', 'account_key', 'external_account_id', 'metric_date',
    'reporting_timezone', 'conversation_count', 'new_conversation_count',
    'open_conversation_count', 'resolved_conversation_count', 'pending_conversation_count',
    'snoozed_conversation_count', 'reopened_count', 'incoming_message_count',
    'outgoing_message_count', 'avg_first_response_seconds', 'avg_resolution_seconds',
    'avg_reply_seconds', 'active_agent_count', 'active_inbox_count', 'data_status',
    'coverage_run_id', 'source_revision', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
  ], { revisionField: 'fetched_at' }),
});

/** Domain-specific Chatwoot D1 adapter; no Queue, lock or Reliability behavior is implemented here. */
export class D1ChatwootAnalyticsStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async upsertAccountState(row) { return this.#upsert(TABLES.account, row); }
  async upsertInboxState(row) { return this.#upsert(TABLES.inboxes, row); }
  async upsertContactState(row) { return this.#upsert(TABLES.contacts, row); }
  async upsertAgentState(row) { return this.#upsert(TABLES.agents, row); }
  async upsertTeamState(row) { return this.#upsert(TABLES.teams, row); }
  async upsertLabelState(row) { return this.#upsert(TABLES.labels, row); }
  async upsertConversationLabelState(row) { return this.#upsert(TABLES.conversationLabels, row); }
  async upsertMessageAnalyticsState(row) { return this.#upsert(TABLES.messages, row); }
  async upsertReportingEventFact(row) { return this.#upsert(TABLES.reportingEvents, row); }
  async upsertConversationDailyFact(row) { return this.#upsert(TABLES.conversationDaily, row); }
  async upsertAgentDailyFact(row) { return this.#upsert(TABLES.agentDaily, row); }
  async upsertInboxDailyFact(row) { return this.#upsert(TABLES.inboxDaily, row); }
  async upsertAccountDailyFact(row) { return this.#upsert(TABLES.accountDaily, row); }

  async upsertConversationState(row) {
    assertSafeRow(row, new Set());
    const columns = [
      'conversation_key', 'customer_key', 'account_key', 'external_account_id',
      'external_conversation_id', 'external_inbox_id', 'external_contact_id', 'status', 'priority',
      'external_assignee_id', 'external_team_id', 'source_created_at', 'source_updated_at',
      'last_activity_at', 'waiting_since', 'source_availability_status', 'message_count',
      'incoming_message_count', 'outgoing_message_count', 'private_message_count',
      'attachment_message_count', 'reopen_count', 'first_response_seconds',
      'first_response_business_seconds', 'resolution_seconds', 'resolution_business_seconds',
      'reply_seconds', 'reply_business_seconds', 'metrics_hash', 'metadata_hash',
      'last_coverage_run_id', 'last_sync_run_id', 'created_at', 'updated_at',
    ];
    const insertRow = { ...row, reopen_count: nonNegativeInteger(row.reopen_count_delta ?? 0, 'reopen_count_delta') };
    delete insertRow.reopen_count_delta;
    requireColumns(insertRow, columns);
    const updateColumns = columns.filter((field) => !['conversation_key', 'created_at', 'reopen_count'].includes(field));
    const assignments = [
      ...updateColumns.map((field) => `${field} = excluded.${field}`),
      `reopen_count = CASE
        WHEN excluded.source_updated_at > chatwoot_conversation_state.source_updated_at
        THEN chatwoot_conversation_state.reopen_count + excluded.reopen_count
        ELSE chatwoot_conversation_state.reopen_count
      END`,
    ];
    const sql = `
      INSERT INTO chatwoot_conversation_state (${columns.join(', ')})
      VALUES (${placeholders(columns.length)})
      ON CONFLICT(conversation_key) DO UPDATE SET
        ${assignments.join(',\n        ')}
      WHERE excluded.account_key = chatwoot_conversation_state.account_key
        AND excluded.external_conversation_id = chatwoot_conversation_state.external_conversation_id
        AND excluded.source_updated_at >= chatwoot_conversation_state.source_updated_at
    `;
    return this.#run('chatwoot_conversation_state', insertRow.conversation_key, sql, bind(insertRow, columns));
  }

  async readConversationStates(input = {}) {
    const accountKey = requireText(input.accountKey, 'accountKey');
    const externalIds = uniqueIds(input.externalConversationIds ?? []);
    if (externalIds.length === 0) return Object.freeze([]);
    if (externalIds.length > MAX_READ_IDS) {
      throw permanentError('Chatwoot conversation state read exceeds ID limit', {
        code: 'CHATWOOT_D1_READ_LIMIT',
        details: { rows: externalIds.length, maxRows: MAX_READ_IDS },
      });
    }
    try {
      const result = await this.db.prepare(`
        SELECT external_conversation_id, status, source_updated_at, reopen_count
        FROM chatwoot_conversation_state
        WHERE account_key = ?
          AND external_conversation_id IN (${placeholders(externalIds.length)})
      `).bind(accountKey, ...externalIds).all();
      return Object.freeze(readRows(result).map((row) => Object.freeze({
        externalConversationId: String(row.external_conversation_id),
        status: row.status,
        sourceUpdatedAt: nullableInteger(row.source_updated_at),
        reopenCount: nonNegativeInteger(row.reopen_count ?? 0, 'reopen_count'),
      })));
    } catch (cause) {
      throw transientError('Failed to read Chatwoot conversation states', {
        code: 'CHATWOOT_D1_READ_FAILED',
        cause,
      });
    }
  }

  async readMessageCursors(input = {}) {
    const accountKey = requireText(input.accountKey, 'accountKey');
    const externalIds = uniqueIds(input.externalConversationIds ?? []);
    if (externalIds.length === 0) return Object.freeze([]);
    if (externalIds.length > MAX_READ_IDS) {
      throw permanentError('Chatwoot message cursor read exceeds ID limit', {
        code: 'CHATWOOT_D1_READ_LIMIT',
        details: { rows: externalIds.length, maxRows: MAX_READ_IDS },
      });
    }
    try {
      const result = await this.db.prepare(`
        SELECT external_conversation_id,
               MAX(CAST(external_message_id AS INTEGER)) AS last_message_id
        FROM chatwoot_message_analytics_state
        WHERE account_key = ?
          AND external_conversation_id IN (${placeholders(externalIds.length)})
        GROUP BY external_conversation_id
      `).bind(accountKey, ...externalIds).all();
      return Object.freeze(readRows(result).map((row) => Object.freeze({
        externalConversationId: String(row.external_conversation_id),
        lastMessageId: row.last_message_id === null || row.last_message_id === undefined
          ? null
          : requirePositiveId(row.last_message_id, 'last_message_id'),
      })));
    } catch (cause) {
      throw transientError('Failed to read Chatwoot message cursors', {
        code: 'CHATWOOT_D1_READ_FAILED',
        cause,
      });
    }
  }

  async #upsert(table, row) {
    assertSafeRow(row, table.allowDisplayFields);
    requireColumns(row, table.columns);
    const updateColumns = table.columns.filter((field) => field !== table.keyField && field !== 'created_at');
    const assignments = updateColumns.map((field) => `${field} = excluded.${field}`);
    const where = table.revisionField
      ? `WHERE excluded.${table.revisionField} IS NULL
          OR ${table.table}.${table.revisionField} IS NULL
          OR excluded.${table.revisionField} >= ${table.table}.${table.revisionField}`
      : '';
    const sql = `
      INSERT INTO ${table.table} (${table.columns.join(', ')})
      VALUES (${placeholders(table.columns.length)})
      ON CONFLICT(${table.keyField}) DO UPDATE SET
        ${assignments.join(',\n        ')}
      ${where}
    `;
    return this.#run(table.table, row[table.keyField], sql, bind(row, table.columns));
  }

  async #run(table, key, sql, values) {
    try {
      const result = await this.db.prepare(sql).bind(...values).run();
      const changes = readChanges(result);
      return Object.freeze({
        table,
        key: requireText(key, 'row key'),
        outcome: changes > 0 ? 'written' : 'skipped',
        rows: changes > 0 ? 1 : 0,
      });
    } catch (cause) {
      throw transientError(`Failed to write Chatwoot D1 table ${table}`, {
        code: 'CHATWOOT_D1_WRITE_FAILED',
        cause,
        details: { table },
      });
    }
  }
}

function spec(table, keyField, columns, options = {}) {
  return Object.freeze({
    table,
    keyField,
    columns: Object.freeze(columns),
    revisionField: options.revisionField ?? null,
    allowDisplayFields: options.allowDisplayFields ?? new Set(),
  });
}

function assertSafeRow(row, allowDisplayFields) {
  requireObject(row, 'row');
  for (const [key, value] of Object.entries(row)) {
    if (isForbiddenField(key) && !allowDisplayFields.has(key)) {
      throw permanentError(`Forbidden Chatwoot PII field reached D1 adapter: ${key}`, {
        code: 'CHATWOOT_PII_POLICY_VIOLATION',
      });
    }
    if (value !== null && value !== undefined
      && !['string', 'number', 'boolean'].includes(typeof value)) {
      throw new TypeError(`Chatwoot D1 row field ${key} must be a scalar`);
    }
  }
}

function isForbiddenField(key) {
  const normalized = String(key).trim().toLowerCase();
  return FORBIDDEN_FIELDS.has(normalized)
    || /(?:^|_)(?:email|phone|phone_number|identifier|avatar|avatar_url|thumbnail|website_token|access_token|secret|token)$/u.test(normalized);
}

function requireColumns(row, columns) {
  const allowed = new Set(columns);
  for (const field of columns) {
    if (!(field in row)) throw new TypeError(`Chatwoot D1 row is missing field ${field}`);
  }
  for (const field of Object.keys(row)) {
    if (!allowed.has(field)) throw new TypeError(`Chatwoot D1 row contains unknown field ${field}`);
  }
}

function bind(row, columns) {
  return columns.map((field) => row[field] ?? null);
}

function placeholders(count) {
  return Array.from({ length: count }, () => '?').join(', ');
}

function uniqueIds(values) {
  if (!Array.isArray(values)) throw new TypeError('externalConversationIds must be an array');
  return [...new Set(values.map((value) => requirePositiveId(value, 'externalConversationId')))];
}

function readRows(result) {
  if (Array.isArray(result?.results)) return result.results;
  if (Array.isArray(result)) return result;
  return [];
}

function readChanges(result) {
  const changes = Number(result?.meta?.changes ?? result?.changes ?? 0);
  return Number.isSafeInteger(changes) && changes >= 0 ? changes : 0;
}

function requireD1(value) {
  if (!value || typeof value.prepare !== 'function') throw new TypeError('D1ChatwootAnalyticsStore requires D1 database');
  return value;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} must be non-empty text`);
  return value.trim();
}

function requirePositiveId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive safe integer`);
  return String(number);
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a non-negative integer`);
  return number;
}

function nullableInteger(value) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
