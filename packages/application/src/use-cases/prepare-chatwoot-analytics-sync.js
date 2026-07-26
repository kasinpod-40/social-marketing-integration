import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';

export const CHATWOOT_LARK_WRITE_TARGETS = Object.freeze([
  target('raw.accounts', 'rawChatwootAccounts', 'account_state_key'),
  target('raw.inboxes', 'rawChatwootInboxes', 'inbox_key'),
  target('raw.contacts', 'rawChatwootContacts', 'contact_key'),
  target('raw.agents', 'rawChatwootAgents', 'agent_key'),
  target('raw.teams', 'rawChatwootTeams', 'team_key'),
  target('raw.labels', 'rawChatwootLabels', 'label_key'),
  target('raw.conversations', 'rawChatwootConversations', 'conversation_key'),
  target('raw.conversationLabels', 'rawChatwootConversationLabels', 'conversation_label_key'),
  target('raw.messages', 'rawChatwootMessageAnalytics', 'message_key'),
  target('raw.reportingEvents', 'rawChatwootReportingEvents', 'reporting_event_key'),
  target('canonical.conversations', 'mktConversations', 'conversation_key'),
  target('canonical.conversationDaily', 'mktConversationDaily', 'conversation_daily_key'),
  target('canonical.agentDaily', 'mktAgentDaily', 'agent_daily_key'),
  target('canonical.inboxDaily', 'mktInboxDaily', 'inbox_daily_key'),
  target('canonical.accountDaily', 'mktConversationAccountDaily', 'account_daily_key'),
]);

/** Build deterministic, PII-minimized D1 and Lark write sets from normalized Chatwoot rows. */
export async function prepareChatwootAnalyticsSync(input = {}) {
  const context = readContext(input);
  const source = readSource(input);
  assertIdentity(context, source);

  const labelIds = new Map(source.labels.map((row) => [row.labelKey, row.externalLabelId]));
  const conversationLabels = buildConversationLabels(source.conversations, labelIds, context);
  const conversationDaily = source.conversations.map((row) => buildConversationDaily(row, context));
  const agentDaily = aggregateDaily(conversationDaily, context, 'agent');
  const inboxDaily = aggregateDaily(conversationDaily, context, 'inbox');
  const accountDaily = aggregateAccountDaily(conversationDaily, source.agents, source.inboxes, context);

  const d1 = Object.freeze({
    account: accountState(source.account, context),
    inboxes: freezeRows(source.inboxes.map((row) => inboxState(row, context))),
    contacts: freezeRows(source.contacts.map((row) => contactState(row, context))),
    agents: freezeRows(source.agents.map((row) => agentState(row, context))),
    teams: freezeRows(source.teams.map((row) => teamState(row, context))),
    labels: freezeRows(source.labels.map((row) => labelState(row, context))),
    conversations: freezeRows(source.conversations.map((row) => conversationState(row, context))),
    conversationLabels: freezeRows(conversationLabels),
    messages: freezeRows(source.messages.map((row) => messageState(row, context))),
    reportingEvents: freezeRows(source.reportingEvents.map((row) => reportingEventFact(row, context))),
    conversationDaily: freezeRows(conversationDaily),
    agentDaily: freezeRows(agentDaily),
    inboxDaily: freezeRows(inboxDaily),
    accountDaily: freezeRows(accountDaily),
    ...buildCoverage(context, {
      accounts: [source.account],
      inboxes: source.inboxes,
      contacts: source.contacts,
      agents: source.agents,
      teams: source.teams,
      labels: source.labels,
      conversations: source.conversations,
      conversationLabels,
      messages: source.messages,
      reportingEvents: source.reportingEvents,
      conversationDaily,
      agentDaily,
      inboxDaily,
      accountDaily,
    }),
  });

  const lark = Object.freeze({
    raw: Object.freeze({
      accounts: freezeRows([d1.account]),
      inboxes: d1.inboxes,
      contacts: d1.contacts,
      agents: d1.agents,
      teams: d1.teams,
      labels: d1.labels,
      conversations: d1.conversations,
      conversationLabels: d1.conversationLabels,
      messages: d1.messages,
      reportingEvents: d1.reportingEvents,
    }),
    canonical: Object.freeze({
      conversations: freezeRows(d1.conversations.map(canonicalConversation)),
      conversationDaily: d1.conversationDaily,
      agentDaily: d1.agentDaily,
      inboxDaily: d1.inboxDaily,
      accountDaily: d1.accountDaily,
    }),
  });

  const sourceRecordStates = await buildSourceRecordStates(source);
  const sourceRows = 1 + source.inboxes.length + source.contacts.length + source.agents.length
    + source.teams.length + source.labels.length + source.conversations.length
    + conversationLabels.length + source.messages.length + source.reportingEvents.length;

  return Object.freeze({
    source: 'chatwoot_application_api',
    d1,
    lark,
    incremental: Object.freeze({
      cursorKey: `chatwoot:${context.accountKey}:analytics`,
      cursorWatermark: maxTimestamp(flattenSource(source)),
      sourceRecordStates,
      fullSnapshot: context.fullSnapshot,
    }),
    reconciliation: Object.freeze({
      datasets: coverageSummary(d1.coverageRuns),
      sourceRows,
      dailyRows: conversationDaily.length + agentDaily.length + inboxDaily.length + accountDaily.length,
      piiPolicy: 'allowlist_no_message_body_or_direct_contact_agent_identity',
      complete: true,
    }),
  });
}

export function readChatwootWriteSetPath(value, path) {
  return path.split('.').reduce((current, segment) => current?.[segment], value) ?? [];
}

function target(path, tableKey, keyField) {
  return Object.freeze({ path, tableKey, keyField });
}

function readContext(input) {
  const observedAt = positiveInteger(input.observedAt, 'observedAt');
  const reportingTimezone = requireText(input.reportingTimezone ?? 'UTC', 'reportingTimezone');
  assertTimeZone(reportingTimezone);
  return Object.freeze({
    customerProfile: requireText(input.customerProfile, 'customerProfile'),
    customerKey: identity(input.customerKey, 'customerKey'),
    accountKey: identity(input.accountKey, 'accountKey'),
    externalAccountId: positiveId(input.externalAccountId, 'externalAccountId'),
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    coverageRunIdPrefix: requireText(input.coverageRunIdPrefix ?? input.syncRunId, 'coverageRunIdPrefix'),
    observedAt,
    reportingTimezone,
    metricDate: dateOnly(observedAt, reportingTimezone),
    fullSnapshot: input.fullSnapshot === true,
  });
}

function readSource(input) {
  return Object.freeze({
    account: requireObject(input.account, 'account'),
    inboxes: requireArray(input.inboxes, 'inboxes'),
    contacts: requireArray(input.contacts, 'contacts'),
    agents: requireArray(input.agents, 'agents'),
    teams: requireArray(input.teams, 'teams'),
    labels: requireArray(input.labels, 'labels'),
    conversations: requireArray(input.conversations, 'conversations'),
    messages: requireArray(input.messages, 'messages'),
    reportingEvents: requireArray(input.reportingEvents, 'reportingEvents'),
  });
}

function assertIdentity(context, source) {
  for (const row of flattenSource(source)) {
    requireObject(row, 'normalized row');
    if (row.customerKey !== context.customerKey
      || row.accountKey !== context.accountKey
      || row.externalAccountId !== context.externalAccountId) {
      throw new TypeError('Chatwoot normalized row identity does not match sync context');
    }
  }
}

function accountState(row, context) {
  return freeze({
    account_state_key: row.accountStateKey,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
    source_updated_at: row.sourceUpdatedAt,
    metadata_hash: row.metadataHash,
    ...lineage(context, 'accounts'),
  });
}

function inboxState(row, context) {
  return freeze({
    inbox_key: row.inboxKey,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_inbox_id: row.externalInboxId,
    channel_type: row.channelType,
    medium: row.medium,
    timezone: row.timezone,
    enable_auto_assignment: boolInt(row.enableAutoAssignment),
    working_hours_enabled: boolInt(row.workingHoursEnabled),
    csat_survey_enabled: boolInt(row.csatSurveyEnabled),
    allow_messages_after_resolved: boolInt(row.allowMessagesAfterResolved),
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
    source_updated_at: row.sourceUpdatedAt,
    metadata_hash: row.metadataHash,
    ...lineage(context, 'inboxes'),
  });
}

function contactState(row, context) {
  return freeze({
    contact_key: row.contactKey,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_contact_id: row.externalContactId,
    blocked: boolInt(row.blocked),
    availability_status: row.availabilityStatus,
    source_availability_status: row.sourceAvailabilityStatus,
    source_created_at: row.sourceCreatedAt,
    last_activity_at: row.lastActivityAt,
    source_updated_at: row.sourceUpdatedAt,
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
    metadata_hash: row.metadataHash,
    ...lineage(context, 'contacts'),
  });
}

function agentState(row, context) {
  return freeze({
    agent_key: row.agentKey,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_agent_id: row.externalAgentId,
    role: row.role,
    availability_status: row.availabilityStatus,
    auto_offline: boolInt(row.autoOffline),
    confirmed: boolInt(row.confirmed),
    custom_role_id: row.customRoleId,
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
    source_updated_at: row.sourceUpdatedAt,
    metadata_hash: row.metadataHash,
    ...lineage(context, 'agents'),
  });
}

function teamState(row, context) {
  return freeze({
    team_key: row.teamKey,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_team_id: row.externalTeamId,
    allow_auto_assign: boolInt(row.allowAutoAssign),
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
    source_updated_at: row.sourceUpdatedAt,
    metadata_hash: row.metadataHash,
    ...lineage(context, 'teams'),
  });
}

function labelState(row, context) {
  return freeze({
    label_key: row.labelKey,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_label_id: row.externalLabelId,
    title: row.title,
    color: row.color,
    show_on_sidebar: boolInt(row.showOnSidebar),
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
    source_updated_at: row.sourceUpdatedAt,
    metadata_hash: row.metadataHash,
    ...lineage(context, 'labels'),
  });
}

function conversationState(row, context) {
  return freeze({
    conversation_key: row.conversationKey,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_conversation_id: row.externalConversationId,
    external_inbox_id: row.externalInboxId,
    external_contact_id: row.externalContactId,
    status: row.status,
    priority: row.priority,
    external_assignee_id: row.externalAssigneeId,
    external_team_id: row.externalTeamId,
    source_created_at: row.sourceCreatedAt,
    source_updated_at: row.sourceUpdatedAt,
    last_activity_at: row.lastActivityAt,
    waiting_since: row.waitingSince,
    source_availability_status: row.sourceAvailabilityStatus,
    message_count: row.messageCount,
    incoming_message_count: row.incomingMessageCount,
    outgoing_message_count: row.outgoingMessageCount,
    private_message_count: row.privateMessageCount,
    attachment_message_count: row.attachmentMessageCount,
    reopen_count_delta: row.reopenCountDelta,
    first_response_seconds: row.firstResponseSeconds,
    first_response_business_seconds: row.firstResponseBusinessSeconds,
    resolution_seconds: row.resolutionSeconds,
    resolution_business_seconds: row.resolutionBusinessSeconds,
    reply_seconds: row.replySeconds,
    reply_business_seconds: row.replyBusinessSeconds,
    metrics_hash: row.metricsHash,
    metadata_hash: row.metadataHash,
    ...lineage(context, 'conversations'),
  });
}

function messageState(row, context) {
  return freeze({
    message_key: row.messageKey,
    conversation_key: row.conversationKey,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_message_id: row.externalMessageId,
    external_conversation_id: row.externalConversationId,
    external_inbox_id: row.externalInboxId,
    message_type: row.messageType,
    direction: row.direction,
    content_type: row.contentType,
    private: boolInt(row.private),
    sender_type: row.senderType,
    external_sender_id: row.externalSenderId,
    attachment_count: row.attachmentCount,
    source_created_at: row.sourceCreatedAt,
    source_updated_at: row.sourceUpdatedAt,
    metadata_hash: row.metadataHash,
    ...lineage(context, 'messages'),
  });
}

function reportingEventFact(row, context) {
  return freeze({
    reporting_event_key: row.reportingEventKey,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_reporting_event_id: row.externalReportingEventId,
    event_name: row.name,
    value_seconds: row.valueSeconds,
    value_business_seconds: row.valueBusinessSeconds,
    external_conversation_id: row.externalConversationId,
    external_inbox_id: row.externalInboxId,
    external_agent_id: row.externalAgentId,
    event_start_at: row.eventStartAt,
    event_end_at: row.eventEndAt,
    source_created_at: row.sourceCreatedAt,
    source_updated_at: row.sourceUpdatedAt,
    source_payload_hash: row.sourcePayloadHash,
    coverage_run_id: coverageId(context, 'reporting_events'),
    sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function buildConversationLabels(conversations, labelIds, context) {
  const rows = [];
  for (const conversation of conversations) {
    for (const labelKey of conversation.labelKeys ?? []) {
      const externalLabelId = labelIds.get(labelKey);
      if (!externalLabelId) throw new TypeError(`Conversation references unknown label key: ${labelKey}`);
      rows.push(freeze({
        conversation_label_key: `${conversation.conversationKey}:label:${externalLabelId}`,
        conversation_key: conversation.conversationKey,
        label_key: labelKey,
        external_conversation_id: conversation.externalConversationId,
        external_label_id: externalLabelId,
        active: 1,
        observed_at: context.observedAt,
        removed_at: null,
        coverage_run_id: coverageId(context, 'conversation_labels'),
        sync_run_id: context.syncRunId,
        created_at: context.observedAt,
        updated_at: context.observedAt,
      }));
    }
  }
  return rows.sort(by('conversation_label_key'));
}

function buildConversationDaily(row, context) {
  const metricDate = dateOnly(row.sourceUpdatedAt, context.reportingTimezone);
  return freeze({
    conversation_daily_key: `${row.conversationKey}:${metricDate}`,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_conversation_id: row.externalConversationId,
    external_inbox_id: row.externalInboxId,
    external_agent_id: row.externalAssigneeId,
    external_team_id: row.externalTeamId,
    metric_date: metricDate,
    reporting_timezone: context.reportingTimezone,
    status: row.status,
    new_conversation_count: dateOnly(row.sourceCreatedAt, context.reportingTimezone) === metricDate ? 1 : 0,
    resolved_count: row.status === 'resolved' ? 1 : 0,
    reopened_count: row.reopenCountDelta,
    incoming_message_count: row.incomingMessageCount,
    outgoing_message_count: row.outgoingMessageCount,
    private_message_count: row.privateMessageCount,
    attachment_message_count: row.attachmentMessageCount,
    first_response_seconds: row.firstResponseSeconds,
    first_response_business_seconds: row.firstResponseBusinessSeconds,
    resolution_seconds: row.resolutionSeconds,
    resolution_business_seconds: row.resolutionBusinessSeconds,
    reply_seconds: row.replySeconds,
    reply_business_seconds: row.replyBusinessSeconds,
    data_status: 'complete',
    coverage_run_id: coverageId(context, 'conversation_daily'),
    source_revision: String(row.sourceUpdatedAt),
    fetched_at: context.observedAt,
    sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function aggregateDaily(rows, context, dimension) {
  const idField = dimension === 'agent' ? 'external_agent_id' : 'external_inbox_id';
  const keyField = dimension === 'agent' ? 'agent_daily_key' : 'inbox_daily_key';
  const groups = group(rows.filter((row) => row[idField]), (row) => `${row[idField]}:${row.metric_date}`);
  return [...groups.values()].map((values) => {
    const first = values[0];
    const common = {
      [keyField]: `chatwoot:${context.accountKey}:${dimension}:${first[idField]}:${first.metric_date}`,
      customer_key: context.customerKey,
      account_key: context.accountKey,
      external_account_id: context.externalAccountId,
      [idField]: first[idField],
      metric_date: first.metric_date,
      reporting_timezone: context.reportingTimezone,
      resolved_count: sum(values, 'resolved_count'),
      reopened_count: sum(values, 'reopened_count'),
      incoming_message_count: sum(values, 'incoming_message_count'),
      outgoing_message_count: sum(values, 'outgoing_message_count'),
      avg_first_response_seconds: avg(values, 'first_response_seconds'),
      avg_resolution_seconds: avg(values, 'resolution_seconds'),
      avg_reply_seconds: avg(values, 'reply_seconds'),
      data_status: 'complete',
      coverage_run_id: coverageId(context, `${dimension}_daily`),
      source_revision: maxRevision(values),
      fetched_at: context.observedAt,
      sync_run_id: context.syncRunId,
      created_at: context.observedAt,
      updated_at: context.observedAt,
    };
    if (dimension === 'agent') common.assigned_conversation_count = values.length;
    else {
      common.conversation_count = values.length;
      common.new_conversation_count = sum(values, 'new_conversation_count');
    }
    return freeze(common);
  }).sort(by(keyField));
}

function aggregateAccountDaily(rows, agents, inboxes, context) {
  const groups = group(rows, (row) => row.metric_date);
  if (groups.size === 0) groups.set(context.metricDate, []);
  return [...groups.entries()].map(([metricDate, values]) => freeze({
    account_daily_key: `chatwoot:${context.accountKey}:account:${metricDate}`,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    metric_date: metricDate,
    reporting_timezone: context.reportingTimezone,
    conversation_count: values.length,
    new_conversation_count: sum(values, 'new_conversation_count'),
    open_conversation_count: count(values, 'status', 'open'),
    resolved_conversation_count: count(values, 'status', 'resolved'),
    pending_conversation_count: count(values, 'status', 'pending'),
    snoozed_conversation_count: count(values, 'status', 'snoozed'),
    reopened_count: sum(values, 'reopened_count'),
    incoming_message_count: sum(values, 'incoming_message_count'),
    outgoing_message_count: sum(values, 'outgoing_message_count'),
    avg_first_response_seconds: avg(values, 'first_response_seconds'),
    avg_resolution_seconds: avg(values, 'resolution_seconds'),
    avg_reply_seconds: avg(values, 'reply_seconds'),
    active_agent_count: agents.filter((row) => row.availabilityStatus !== 'offline').length,
    active_inbox_count: inboxes.length,
    data_status: 'complete',
    coverage_run_id: coverageId(context, 'account_daily'),
    source_revision: maxRevision(values),
    fetched_at: context.observedAt,
    sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  })).sort(by('account_daily_key'));
}

function buildCoverage(context, datasets) {
  const coverageRuns = [];
  const coverageEntities = [];
  for (const [dataset, rows] of Object.entries(datasets)) {
    const entityType = snake(dataset);
    const runId = coverageId(context, dataset);
    const watermark = maxTimestamp(rows);
    coverageRuns.push(freeze({
      coverage_run_id: runId,
      sync_run_id: context.syncRunId,
      customer_key: context.customerKey,
      platform: 'chatwoot',
      account_key: context.accountKey,
      dataset_key: `chatwoot.${entityType}`,
      metric_semantics: entityType.includes('daily') ? 'period' : 'snapshot',
      scope_mode: context.fullSnapshot ? 'full_inventory' : 'recent_window',
      period_start: null,
      period_end: context.metricDate,
      source_timezone: context.reportingTimezone,
      status: 'complete',
      expected_entities: rows.length,
      observed_entities: rows.length,
      expected_rows: rows.length,
      observed_rows: rows.length,
      written_rows: rows.length,
      failed_rows: 0,
      source_watermark: watermark > 0 ? String(watermark) : null,
      revisable_until: null,
      started_at: context.observedAt,
      completed_at: context.observedAt,
      error_code: null,
      created_at: context.observedAt,
      updated_at: context.observedAt,
    }));
    rows.forEach((row, index) => {
      const externalId = stableKey(row) ?? `${entityType}:${index + 1}`;
      coverageEntities.push(freeze({
        coverage_entity_key: `${runId}:${entityType}:${externalId}`,
        coverage_run_id: runId,
        entity_type: entityType,
        external_entity_id: externalId,
        observation_status: 'observed',
        source_revision: null,
        observed_at: context.observedAt,
        created_at: context.observedAt,
      }));
    });
  }
  return Object.freeze({
    coverageRuns: freezeRows(coverageRuns),
    coverageEntities: freezeRows(coverageEntities),
  });
}

async function buildSourceRecordStates(source) {
  const records = [];
  for (const [dataset, values] of Object.entries(source)) {
    const rows = Array.isArray(values) ? values : [values];
    for (const row of rows) {
      records.push(freeze({
        sourceRecordId: `${snake(dataset)}:${externalId(row)}`,
        sourceModifiedAt: sourceUpdatedAt(row),
        sourceHash: await createStableFingerprint(row),
        externalContentId: stableKey(row),
      }));
    }
  }
  return freezeRows(records.sort(by('sourceRecordId')));
}

function canonicalConversation(row) {
  return freeze({
    conversation_key: row.conversation_key,
    account_key: row.account_key,
    external_conversation_id: row.external_conversation_id,
    external_inbox_id: row.external_inbox_id,
    status: row.status,
    priority: row.priority,
    external_assignee_id: row.external_assignee_id,
    external_team_id: row.external_team_id,
    source_created_at: row.source_created_at,
    source_updated_at: row.source_updated_at,
    last_activity_at: row.last_activity_at,
    message_count: row.message_count,
    incoming_message_count: row.incoming_message_count,
    outgoing_message_count: row.outgoing_message_count,
    reopen_count_delta: row.reopen_count_delta,
    first_response_seconds: row.first_response_seconds,
    resolution_seconds: row.resolution_seconds,
    reply_seconds: row.reply_seconds,
    sync_run_id: row.last_sync_run_id,
  });
}

function lineage(context, dataset) {
  return {
    last_coverage_run_id: coverageId(context, dataset),
    last_sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  };
}

function coverageId(context, dataset) {
  return `${context.coverageRunIdPrefix}:chatwoot:${snake(dataset)}`;
}

function coverageSummary(runs) {
  return Object.freeze(Object.fromEntries(runs.map((row) => [
    row.dataset_key.replace(/^chatwoot\./u, ''),
    Object.freeze({
      expected: row.expected_rows,
      observed: row.observed_rows,
      failed: row.failed_rows,
    }),
  ])));
}

function flattenSource(source) {
  return [source.account, ...source.inboxes, ...source.contacts, ...source.agents, ...source.teams,
    ...source.labels, ...source.conversations, ...source.messages, ...source.reportingEvents];
}

function stableKey(row) {
  return row.accountStateKey ?? row.inboxKey ?? row.contactKey ?? row.agentKey ?? row.teamKey
    ?? row.labelKey ?? row.conversationKey ?? row.messageKey ?? row.reportingEventKey
    ?? row.account_state_key ?? row.inbox_key ?? row.contact_key ?? row.agent_key ?? row.team_key
    ?? row.label_key ?? row.conversation_key ?? row.message_key ?? row.reporting_event_key
    ?? row.conversation_label_key ?? row.conversation_daily_key ?? row.agent_daily_key
    ?? row.inbox_daily_key ?? row.account_daily_key ?? null;
}

function externalId(row) {
  return row.externalAccountId ?? row.externalInboxId ?? row.externalContactId ?? row.externalAgentId
    ?? row.externalTeamId ?? row.externalLabelId ?? row.externalConversationId
    ?? row.externalMessageId ?? row.externalReportingEventId ?? stableKey(row);
}

function sourceUpdatedAt(row) {
  return row.sourceUpdatedAt ?? row.lastSeenAt ?? row.observedAt ?? null;
}

function maxTimestamp(rows) {
  let result = 0;
  for (const row of rows) {
    for (const value of [row.sourceUpdatedAt, row.lastActivityAt, row.eventEndAt, row.lastSeenAt,
      row.source_updated_at, row.last_activity_at, row.event_end_at, row.updated_at]) {
      const number = Number(value);
      if (Number.isFinite(number)) result = Math.max(result, number);
    }
  }
  return result;
}

function group(rows, keyFn) {
  const result = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!result.has(key)) result.set(key, []);
    result.get(key).push(row);
  }
  return result;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

function avg(rows, field) {
  const values = rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined)
    .map(Number).filter(Number.isFinite);
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function maxRevision(rows) {
  const values = rows.map((row) => Number(row.source_revision)).filter(Number.isFinite);
  return values.length === 0 ? null : String(Math.max(...values));
}

function count(rows, field, value) {
  return rows.filter((row) => row[field] === value).length;
}

function boolInt(value) {
  if (value === null || value === undefined) return null;
  return value === true ? 1 : 0;
}

function snake(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
}

function by(field) {
  return (left, right) => String(left[field]).localeCompare(String(right[field]));
}

function dateOnly(timestamp, timeZone) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(timestamp));
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function assertTimeZone(value) {
  try { new Intl.DateTimeFormat('en-US', { timeZone: value }).format(); } catch {
    throw new TypeError('reportingTimezone must be a valid IANA timezone');
  }
}

function freeze(value) { return Object.freeze(value); }
function freezeRows(rows) { return Object.freeze(rows.map(freeze)); }
function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} must be a non-empty string`);
  return value.trim();
}
function identity(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.includes(':')) throw new TypeError(`${fieldName} must not contain ":"`);
  return text;
}
function positiveId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive safe integer`);
  return String(number);
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}
