/** Compact, PII-free aggregate state persisted between bounded rollup pages. */
export function mergeChatwootDailyRollupState(previous, rows = []) {
  const state = normalizeState(previous);
  for (const row of rows) {
    assertIdentity(state, row);
    state.rowCount += 1;
    state.sourceRevision = maxRevision(state.sourceRevision, row.sourceRevision);
    mergeAggregate(state.account, row, true);
    if (row.externalAgentId !== null) {
      const key = String(row.externalAgentId);
      state.agents[key] ??= emptyAggregate();
      mergeAggregate(state.agents[key], row, false);
    }
    if (row.externalInboxId !== null) {
      const key = String(row.externalInboxId);
      state.inboxes[key] ??= emptyAggregate();
      mergeAggregate(state.inboxes[key], row, true);
    }
  }
  return Object.freeze(structuredClone(state));
}

export function createChatwootDailyRollupState(input = {}) {
  return Object.freeze({
    customerKey: requireText(input.customerKey, 'customerKey'),
    accountKey: requireText(input.accountKey, 'accountKey'),
    externalAccountId: positiveInteger(input.externalAccountId, 'externalAccountId'),
    metricDate: requireDate(input.metricDate, 'metricDate'),
    rowCount: 0,
    sourceRevision: '0',
    agents: Object.freeze({}),
    inboxes: Object.freeze({}),
    account: Object.freeze(emptyAggregate()),
  });
}

/** Rebuild Conversation Daily metric columns from authoritative D1 Reporting events. */
export function buildChatwootConversationDailyProjectionRows(input = {}) {
  const rows = requireRows(input.rows, 'rows');
  const reportingTimezone = requireText(input.reportingTimezone, 'reportingTimezone');
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const coverageRunId = requireText(input.coverageRunId, 'coverageRunId');
  const fetchedAt = positiveInteger(input.fetchedAt, 'fetchedAt');
  return Object.freeze(rows.map((row) => Object.freeze({
    conversation_daily_key: requireText(row.conversationDailyKey, 'conversationDailyKey'),
    customer_key: requireText(row.customerKey, 'customerKey'),
    account_key: requireText(row.accountKey, 'accountKey'),
    external_account_id: positiveInteger(row.externalAccountId, 'externalAccountId'),
    external_conversation_id: positiveInteger(
      row.externalConversationId,
      'externalConversationId',
    ),
    external_inbox_id: nullablePositiveInteger(row.externalInboxId, 'externalInboxId'),
    external_agent_id: nullablePositiveInteger(row.externalAgentId, 'externalAgentId'),
    external_team_id: nullablePositiveInteger(row.externalTeamId, 'externalTeamId'),
    metric_date: requireDate(row.metricDate, 'metricDate'),
    reporting_timezone: reportingTimezone,
    status: optionalText(row.status),
    new_conversation_count: nonNegativeInteger(
      row.newConversationCount,
      'newConversationCount',
    ),
    resolved_count: nonNegativeInteger(row.resolvedCount, 'resolvedCount'),
    reopened_count: nonNegativeInteger(row.reopenedCount, 'reopenedCount'),
    incoming_message_count: nonNegativeInteger(
      row.incomingMessageCount,
      'incomingMessageCount',
    ),
    outgoing_message_count: nonNegativeInteger(
      row.outgoingMessageCount,
      'outgoingMessageCount',
    ),
    private_message_count: nonNegativeInteger(
      row.privateMessageCount ?? 0,
      'privateMessageCount',
    ),
    attachment_message_count: nonNegativeInteger(
      row.attachmentMessageCount ?? 0,
      'attachmentMessageCount',
    ),
    first_response_seconds: average(normalizeMetricAccumulator(
      row.firstResponse,
      row.firstResponseSeconds,
    )),
    first_response_business_seconds: average(normalizeMetricAccumulator(
      row.firstResponseBusiness,
      row.firstResponseBusinessSeconds,
    )),
    resolution_seconds: average(normalizeMetricAccumulator(
      row.resolution,
      row.resolutionSeconds,
    )),
    resolution_business_seconds: average(normalizeMetricAccumulator(
      row.resolutionBusiness,
      row.resolutionBusinessSeconds,
    )),
    reply_seconds: average(normalizeMetricAccumulator(row.reply, row.replySeconds)),
    reply_business_seconds: average(normalizeMetricAccumulator(
      row.replyBusiness,
      row.replyBusinessSeconds,
    )),
    data_status: 'partial',
    coverage_run_id: optionalText(row.coverageRunId) ?? coverageRunId,
    source_revision: requireText(row.sourceRevision, 'sourceRevision'),
    fetched_at: fetchedAt,
    sync_run_id: syncRunId,
    created_at: nullablePositiveInteger(row.createdAt, 'createdAt') ?? fetchedAt,
    updated_at: fetchedAt,
  })));
}

export function buildChatwootDailyRollupRows(input = {}) {
  const state = normalizeState(input.state);
  const reportingTimezone = requireText(input.reportingTimezone, 'reportingTimezone');
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const coverageRunIdPrefix = requireText(input.coverageRunIdPrefix, 'coverageRunIdPrefix');
  const fetchedAt = positiveInteger(input.fetchedAt, 'fetchedAt');
  const common = {
    customer_key: state.customerKey,
    account_key: state.accountKey,
    external_account_id: state.externalAccountId,
    metric_date: state.metricDate,
    reporting_timezone: reportingTimezone,
    data_status: 'partial',
    source_revision: state.sourceRevision,
    fetched_at: fetchedAt,
    sync_run_id: syncRunId,
    created_at: fetchedAt,
    updated_at: fetchedAt,
  };
  const agents = Object.entries(state.agents).map(([id, value]) => Object.freeze({
    agent_daily_key: `chatwoot:${state.accountKey}:agent:${id}:${state.metricDate}`,
    ...common,
    external_agent_id: Number(id),
    assigned_conversation_count: null,
    resolved_count: value.resolvedCount,
    reopened_count: value.reopenedCount,
    incoming_message_count: value.incomingMessageCount,
    outgoing_message_count: value.outgoingMessageCount,
    avg_first_response_seconds: average(value.firstResponse),
    avg_resolution_seconds: average(value.resolution),
    avg_reply_seconds: average(value.reply),
    coverage_run_id: coverageId(coverageRunIdPrefix, 'agent_daily'),
  })).sort(by('agent_daily_key'));
  const inboxes = Object.entries(state.inboxes).map(([id, value]) => Object.freeze({
    inbox_daily_key: `chatwoot:${state.accountKey}:inbox:${id}:${state.metricDate}`,
    ...common,
    external_inbox_id: Number(id),
    conversation_count: value.conversationCount,
    new_conversation_count: value.newConversationCount,
    resolved_count: value.resolvedCount,
    reopened_count: value.reopenedCount,
    incoming_message_count: value.incomingMessageCount,
    outgoing_message_count: value.outgoingMessageCount,
    avg_first_response_seconds: average(value.firstResponse),
    avg_resolution_seconds: average(value.resolution),
    avg_reply_seconds: average(value.reply),
    coverage_run_id: coverageId(coverageRunIdPrefix, 'inbox_daily'),
  })).sort(by('inbox_daily_key'));
  const account = state.rowCount === 0 ? [] : [Object.freeze({
    account_daily_key: `chatwoot:${state.accountKey}:account:${state.metricDate}`,
    ...common,
    conversation_count: state.account.conversationCount,
    new_conversation_count: state.account.newConversationCount,
    open_conversation_count: null,
    resolved_conversation_count: state.account.resolvedCount,
    pending_conversation_count: null,
    snoozed_conversation_count: null,
    reopened_count: state.account.reopenedCount,
    incoming_message_count: state.account.incomingMessageCount,
    outgoing_message_count: state.account.outgoingMessageCount,
    avg_first_response_seconds: average(state.account.firstResponse),
    avg_resolution_seconds: average(state.account.resolution),
    avg_reply_seconds: average(state.account.reply),
    active_agent_count: null,
    active_inbox_count: null,
    coverage_run_id: coverageId(coverageRunIdPrefix, 'account_daily'),
  })];
  const coverage = buildRollupCoverage({
    customerKey: state.customerKey,
    accountKey: state.accountKey,
    reportingTimezone,
    metricDate: state.metricDate,
    syncRunId,
    coverageRunIdPrefix,
    sourceWatermark: state.sourceRevision,
    observedAt: fetchedAt,
    datasets: [
      ['agent_daily', 'agent_daily_key', agents],
      ['inbox_daily', 'inbox_daily_key', inboxes],
      ['account_daily', 'account_daily_key', account],
    ],
  });
  return Object.freeze({
    agents: Object.freeze(agents),
    inboxes: Object.freeze(inboxes),
    account: Object.freeze(account),
    coverageRuns: coverage.runs,
    coverageEntities: coverage.entities,
  });
}

function buildRollupCoverage(input) {
  const runs = [];
  const entities = [];
  for (const [dataset, keyField, rows] of input.datasets) {
    if (rows.length === 0) continue;
    const runId = coverageId(input.coverageRunIdPrefix, dataset);
    runs.push(Object.freeze({
      coverage_run_id: runId,
      sync_run_id: input.syncRunId,
      customer_key: input.customerKey,
      platform: 'chatwoot',
      account_key: input.accountKey,
      dataset_key: `chatwoot.${dataset}`,
      metric_semantics: 'period',
      scope_mode: 'report_range',
      period_start: input.metricDate,
      period_end: input.metricDate,
      source_timezone: input.reportingTimezone,
      status: 'partial',
      expected_entities: rows.length,
      observed_entities: rows.length,
      expected_rows: rows.length,
      observed_rows: rows.length,
      written_rows: 0,
      failed_rows: 0,
      source_watermark: requireText(input.sourceWatermark, 'sourceWatermark'),
      revisable_until: null,
      started_at: input.observedAt,
      completed_at: null,
      error_code: null,
      created_at: input.observedAt,
      updated_at: input.observedAt,
    }));
    for (const row of rows) {
      const stableKey = requireText(row[keyField], keyField);
      entities.push(Object.freeze({
        coverage_entity_key: `${runId}:${dataset}:${stableKey}`,
        coverage_run_id: runId,
        entity_type: dataset,
        external_entity_id: stableKey,
        observation_status: 'observed',
        source_revision: row.source_revision ?? null,
        observed_at: input.observedAt,
        created_at: input.observedAt,
      }));
    }
  }
  return Object.freeze({
    runs: Object.freeze(runs),
    entities: Object.freeze(entities),
  });
}

function coverageId(prefix, dataset) {
  return `${prefix}:chatwoot:${dataset}`;
}

function normalizeState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Chatwoot daily rollup state is required');
  }
  return {
    customerKey: requireText(value.customerKey, 'state.customerKey'),
    accountKey: requireText(value.accountKey, 'state.accountKey'),
    externalAccountId: positiveInteger(value.externalAccountId, 'state.externalAccountId'),
    metricDate: requireDate(value.metricDate, 'state.metricDate'),
    rowCount: nonNegativeInteger(value.rowCount ?? 0, 'state.rowCount'),
    sourceRevision: requireText(value.sourceRevision ?? '0', 'state.sourceRevision'),
    agents: cloneAggregateMap(value.agents),
    inboxes: cloneAggregateMap(value.inboxes),
    account: normalizeAggregate(value.account),
  };
}

function cloneAggregateMap(value) {
  if (value === null || value === undefined) return {};
  if (typeof value !== 'object' || Array.isArray(value)) throw new TypeError('rollup dimension must be an object');
  return Object.fromEntries(Object.entries(value).map(([key, row]) => [key, normalizeAggregate(row)]));
}

function emptyAggregate() {
  return {
    conversationCount: 0,
    newConversationCount: 0,
    resolvedCount: 0,
    reopenedCount: 0,
    incomingMessageCount: 0,
    outgoingMessageCount: 0,
    firstResponse: { sum: 0, count: 0 },
    resolution: { sum: 0, count: 0 },
    reply: { sum: 0, count: 0 },
  };
}

function normalizeAggregate(value) {
  const source = value ?? emptyAggregate();
  return {
    conversationCount: nonNegativeInteger(source.conversationCount ?? 0, 'conversationCount'),
    newConversationCount: nonNegativeInteger(source.newConversationCount ?? 0, 'newConversationCount'),
    resolvedCount: nonNegativeInteger(source.resolvedCount ?? 0, 'resolvedCount'),
    reopenedCount: nonNegativeInteger(source.reopenedCount ?? 0, 'reopenedCount'),
    incomingMessageCount: nonNegativeInteger(source.incomingMessageCount ?? 0, 'incomingMessageCount'),
    outgoingMessageCount: nonNegativeInteger(source.outgoingMessageCount ?? 0, 'outgoingMessageCount'),
    firstResponse: normalizeAccumulator(source.firstResponse),
    resolution: normalizeAccumulator(source.resolution),
    reply: normalizeAccumulator(source.reply),
  };
}

function normalizeAccumulator(value) {
  return {
    sum: finiteNumber(value?.sum ?? 0, 'accumulator.sum'),
    count: nonNegativeInteger(value?.count ?? 0, 'accumulator.count'),
  };
}

function mergeAggregate(target, row, countConversation) {
  if (countConversation) target.conversationCount += 1;
  target.newConversationCount += row.newConversationCount;
  target.resolvedCount += row.resolvedCount;
  target.reopenedCount += row.reopenedCount;
  target.incomingMessageCount += row.incomingMessageCount;
  target.outgoingMessageCount += row.outgoingMessageCount;
  addAccumulator(target.firstResponse, normalizeMetricAccumulator(
    row.firstResponse,
    row.firstResponseSeconds,
  ));
  addAccumulator(target.resolution, normalizeMetricAccumulator(
    row.resolution,
    row.resolutionSeconds,
  ));
  addAccumulator(target.reply, normalizeMetricAccumulator(row.reply, row.replySeconds));
}

function normalizeMetricAccumulator(value, fallback) {
  if (value !== null && value !== undefined) return normalizeAccumulator(value);
  if (fallback === null || fallback === undefined) return { sum: 0, count: 0 };
  return { sum: finiteNumber(fallback, 'metric'), count: 1 };
}

function addAccumulator(target, value) {
  target.sum += value.sum;
  target.count += value.count;
}

function average(value) {
  return value.count === 0 ? null : value.sum / value.count;
}

function assertIdentity(state, row) {
  if (row.customerKey !== state.customerKey
    || row.accountKey !== state.accountKey
    || row.externalAccountId !== state.externalAccountId
    || row.metricDate !== state.metricDate) {
    throw new TypeError('Chatwoot daily rollup row identity mismatch');
  }
}

function maxRevision(left, right) {
  const a = Number(left);
  const b = Number(right);
  if (Number.isFinite(a) && Number.isFinite(b)) return String(Math.max(a, b));
  return String(left) > String(right) ? String(left) : String(right);
}

function by(field) {
  return (left, right) => String(left[field]).localeCompare(String(right[field]));
}
function finiteNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${fieldName} must be finite`);
  return number;
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive`);
  return number;
}
function nonNegativeInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be non-negative`);
  return number;
}
function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new TypeError(`${fieldName} must be YYYY-MM-DD`);
  return text;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function nullablePositiveInteger(value, fieldName) {
  if (value === null || value === undefined) return null;
  return positiveInteger(value, fieldName);
}
function requireRows(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
