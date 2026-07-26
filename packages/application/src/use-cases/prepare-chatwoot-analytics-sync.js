import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';

export const CHATWOOT_LARK_WRITE_TARGETS = Object.freeze([
  Object.freeze({ path: 'raw.accounts', tableKey: 'rawChatwootAccounts', keyField: 'account_state_key' }),
  Object.freeze({ path: 'raw.inboxes', tableKey: 'rawChatwootInboxes', keyField: 'inbox_key' }),
  Object.freeze({ path: 'raw.contacts', tableKey: 'rawChatwootContacts', keyField: 'contact_key' }),
  Object.freeze({ path: 'raw.agents', tableKey: 'rawChatwootAgents', keyField: 'agent_key' }),
  Object.freeze({ path: 'raw.teams', tableKey: 'rawChatwootTeams', keyField: 'team_key' }),
  Object.freeze({ path: 'raw.labels', tableKey: 'rawChatwootLabels', keyField: 'label_key' }),
  Object.freeze({ path: 'raw.conversations', tableKey: 'rawChatwootConversations', keyField: 'conversation_key' }),
  Object.freeze({
    path: 'raw.conversationLabels',
    tableKey: 'rawChatwootConversationLabels',
    keyField: 'conversation_label_key',
  }),
  Object.freeze({ path: 'raw.messages', tableKey: 'rawChatwootMessageAnalytics', keyField: 'message_key' }),
  Object.freeze({
    path: 'raw.reportingEvents',
    tableKey: 'rawChatwootReportingEvents',
    keyField: 'reporting_event_key',
  }),
  Object.freeze({ path: 'canonical.conversations', tableKey: 'mktConversations', keyField: 'conversation_key' }),
  Object.freeze({
    path: 'canonical.conversationDaily',
    tableKey: 'mktConversationDaily',
    keyField: 'conversation_daily_key',
  }),
  Object.freeze({ path: 'canonical.agentDaily', tableKey: 'mktAgentDaily', keyField: 'agent_daily_key' }),
  Object.freeze({ path: 'canonical.inboxDaily', tableKey: 'mktInboxDaily', keyField: 'inbox_daily_key' }),
  Object.freeze({
    path: 'canonical.accountDaily',
    tableKey: 'mktConversationAccountDaily',
    keyField: 'account_daily_key',
  }),
]);

/**
 * Convert one fully normalized Chatwoot source snapshot into D1 and Lark write sets.
 * This function is deterministic and performs no I/O.
 */
export async function prepareChatwootAnalyticsSync(input = {}) {
  const context = readContext(input);
  const account = requireObject(input.account, 'account');
  const inboxes = requireArray(input.inboxes, 'inboxes');
  const contacts = requireArray(input.contacts, 'contacts');
  const agents = requireArray(input.agents, 'agents');
  const teams = requireArray(input.teams, 'teams');
  const labels = requireArray(input.labels, 'labels');
  const conversations = requireArray(input.conversations, 'conversations');
  const messages = requireArray(input.messages, 'messages');
  const reportingEvents = requireArray(input.reportingEvents, 'reportingEvents');
  assertSharedIdentity(context, [account, ...inboxes, ...contacts, ...agents, ...teams, ...labels,
    ...conversations, ...messages, ...reportingEvents]);

  const labelIdByKey = new Map(labels.map((row) => [row.labelKey, row.externalLabelId]));
  const conversationLabels = buildConversationLabels(conversations, labelIdByKey, context);
  const conversationDaily = conversations.map((row) => buildConversationDaily(row, context));
  const agentDaily = buildAgentDaily(conversationDaily, context);
  const inboxDaily = buildInboxDaily(conversationDaily, context);
  const accountDaily = buildAccountDaily(conversationDaily, agents, inboxes, context);
  const coverage = buildCoverage({
    context,
    datasets: {
      accounts: [account],
      inboxes,
      contacts,
      agents,
      teams,
      labels,
      conversations,
      conversationLabels,
      messages,
      reportingEvents,
      conversationDaily,
      agentDaily,
      inboxDaily,
      accountDaily,
    },
  });
  const sourceRecordStates = await buildSourceRecordStates({
    account, inboxes, contacts, agents, teams, labels, conversations, messages, reportingEvents,
  });
  const cursorWatermark = findMaxTimestamp([
    account, ...inboxes, ...contacts, ...agents, ...teams, ...labels,
    ...conversations, ...messages, ...reportingEvents,
  ]);

  const d1 = Object.freeze({
    account: toAccountState(account, context),
    inboxes: Object.freeze(inboxes.map((row) => toInboxState(row, context))),
    contacts: Object.freeze(contacts.map((row) => toContactState(row, context))),
    agents: Object.freeze(agents.map((row) => toAgentState(row, context))),
    teams: Object.freeze(teams.map((row) => toTeamState(row, context))),
    labels: Object.freeze(labels.map((row) => toLabelState(row, context))),
    conversations: Object.freeze(conversations.map((row) => toConversationState(row, context))),
    conversationLabels: Object.freeze(conversationLabels),
    messages: Object.freeze(messages.map((row) => toMessageState(row, context))),
    reportingEvents: Object.freeze(reportingEvents.map((row) => toReportingEventFact(row, context))),
    conversationDaily: Object.freeze(conversationDaily),
    agentDaily: Object.freeze(agentDaily),
    inboxDaily: Object.freeze(inboxDaily),
    accountDaily: Object.freeze(accountDaily),
    coverageRuns: coverage.runs,
    coverageEntities: coverage.entities,
  });

  const lark = Object.freeze({
    raw: Object.freeze({
      accounts: Object.freeze([toLarkAccount(d1.account)]),
      inboxes: Object.freeze(d1.inboxes.map(toLarkInbox)),
      contacts: Object.freeze(d1.contacts.map(toLarkContact)),
      agents: Object.freeze(d1.agents.map(toLarkAgent)),
      teams: Object.freeze(d1.teams.map(toLarkTeam)),
      labels: Object.freeze(d1.labels.map(toLarkLabel)),
      conversations: Object.freeze(d1.conversations.map(toLarkConversation)),
      conversationLabels: Object.freeze(d1.conversationLabels.map(toLarkConversationLabel)),
      messages: Object.freeze(d1.messages.map(toLarkMessage)),
      reportingEvents: Object.freeze(d1.reportingEvents.map(toLarkReportingEvent)),
    }),
    canonical: Object.freeze({
      conversations: Object.freeze(d1.conversations.map(toCanonicalConversation)),
      conversationDaily: d1.conversationDaily,
      agentDaily: d1.agentDaily,
      inboxDaily: d1.inboxDaily,
      accountDaily: d1.accountDaily,
    }),
  });

  return Object.freeze({
    source: 'chatwoot_application_api',
    d1,
    lark,
    incremental: Object.freeze({
      cursorKey: `chatwoot:${context.accountKey}:analytics`,
      cursorWatermark,
      sourceRecordStates,
      fullSnapshot: input.fullSnapshot === true,
    }),
    reconciliation: Object.freeze({
      datasets: coverage.summary,
      sourceRows: countSourceRows({
        account, inboxes, contacts, agents, teams, labels, conversations, conversationLabels,
        messages, reportingEvents,
      }),
      dailyRows: conversationDaily.length + agentDaily.length + inboxDaily.length + accountDaily.length,
      piiPolicy: 'allowlist_no_message_body_or_direct_contact_agent_identity',
      complete: true,
    }),
  });
}

export function readChatwootWriteSetPath(value, path) {
  return path.split('.').reduce((current, segment) => current?.[segment], value) ?? [];
}

function readContext(input) {
  const observedAt = positiveInteger(input.observedAt, 'observedAt');
  const reportingTimezone = requireText(input.reportingTimezone ?? 'UTC', 'reportingTimezone');
  assertTimeZone(reportingTimezone);
  return Object.freeze({
    customerProfile: requireText(input.customerProfile, 'customerProfile'),
    customerKey: requireIdentity(input.customerKey, 'customerKey'),
    accountKey: requireIdentity(input.accountKey, 'accountKey'),
    externalAccountId: requirePositiveId(input.externalAccountId, 'externalAccountId'),
    syncRunId: requireText(input.syncRunId, 'syncRunId'),
    coverageRunIdPrefix: requireText(input.coverageRunIdPrefix ?? input.syncRunId, 'coverageRunIdPrefix'),
    observedAt,
    reportingTimezone,
    metricDate: formatDate(observedAt, reportingTimezone),
  });
}

function assertSharedIdentity(context, rows) {
  for (const row of rows) {
    requireObject(row, 'normalized row');
    if (row.customerKey !== context.customerKey
      || row.accountKey !== context.accountKey
      || row.externalAccountId !== context.externalAccountId) {
      throw new TypeError('Chatwoot normalized row identity does not match sync context');
    }
  }
}

function buildConversationLabels(conversations, labelIdByKey, context) {
  const rows = [];
  for (const conversation of conversations) {
    for (const labelKey of conversation.labelKeys ?? []) {
      const externalLabelId = labelIdByKey.get(labelKey);
      if (!externalLabelId) throw new TypeError(`Conversation references unknown label key: ${labelKey}`);
      rows.push(Object.freeze({
        conversation_label_key: `${conversation.conversationKey}:label:${externalLabelId}`,
        conversation_key: conversation.conversationKey,
        label_key: labelKey,
        external_conversation_id: conversation.externalConversationId,
        external_label_id: externalLabelId,
        active: 1,
        observed_at: context.observedAt,
        removed_at: null,
        coverage_run_id: coverageRunId(context, 'conversation_labels'),
        sync_run_id: context.syncRunId,
        created_at: context.observedAt,
        updated_at: context.observedAt,
      }));
    }
  }
  return rows.sort(compareKey('conversation_label_key'));
}

function buildConversationDaily(conversation, context) {
  const metricDate = formatDate(conversation.sourceUpdatedAt, context.reportingTimezone);
  return Object.freeze({
    conversation_daily_key: `${conversation.conversationKey}:${metricDate}`,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_conversation_id: conversation.externalConversationId,
    external_inbox_id: conversation.externalInboxId,
    external_agent_id: conversation.externalAssigneeId,
    external_team_id: conversation.externalTeamId,
    metric_date: metricDate,
    reporting_timezone: context.reportingTimezone,
    status: conversation.status,
    new_conversation_count: formatDate(conversation.sourceCreatedAt, context.reportingTimezone) === metricDate ? 1 : 0,
    resolved_count: conversation.status === 'resolved' ? 1 : 0,
    reopened_count: conversation.reopenCountDelta,
    incoming_message_count: conversation.incomingMessageCount,
    outgoing_message_count: conversation.outgoingMessageCount,
    private_message_count: conversation.privateMessageCount,
    attachment_message_count: conversation.attachmentMessageCount,
    first_response_seconds: conversation.firstResponseSeconds,
    first_response_business_seconds: conversation.firstResponseBusinessSeconds,
    resolution_seconds: conversation.resolutionSeconds,
    resolution_business_seconds: conversation.resolutionBusinessSeconds,
    reply_seconds: conversation.replySeconds,
    reply_business_seconds: conversation.replyBusinessSeconds,
    data_status: 'complete_for_observed_scope',
    coverage_run_id: coverageRunId(context, 'conversation_daily'),
    source_revision: String(conversation.sourceUpdatedAt),
    fetched_at: context.observedAt,
    sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function buildAgentDaily(rows, context) {
  const groups = groupBy(rows.filter((row) => row.external_agent_id), (row) => (
    `${row.external_agent_id}:${row.metric_date}`
  ));
  return [...groups.values()].map((values) => {
    const first = values[0];
    return Object.freeze({
      agent_daily_key: `chatwoot:${context.accountKey}:agent:${first.external_agent_id}:${first.metric_date}`,
      customer_key: context.customerKey,
      account_key: context.accountKey,
      external_account_id: context.externalAccountId,
      external_agent_id: first.external_agent_id,
      metric_date: first.metric_date,
      reporting_timezone: context.reportingTimezone,
      assigned_conversation_count: values.length,
      resolved_count: sum(values, 'resolved_count'),
      reopened_count: sum(values, 'reopened_count'),
      incoming_message_count: sum(values, 'incoming_message_count'),
      outgoing_message_count: sum(values, 'outgoing_message_count'),
      avg_first_response_seconds: average(values, 'first_response_seconds'),
      avg_resolution_seconds: average(values, 'resolution_seconds'),
      avg_reply_seconds: average(values, 'reply_seconds'),
      data_status: 'complete_for_observed_scope',
      coverage_run_id: coverageRunId(context, 'agent_daily'),
      source_revision: maxText(values.map((row) => row.source_revision)),
      fetched_at: context.observedAt,
      sync_run_id: context.syncRunId,
      created_at: context.observedAt,
      updated_at: context.observedAt,
    });
  }).sort(compareKey('agent_daily_key'));
}

function buildInboxDaily(rows, context) {
  const groups = groupBy(rows, (row) => `${row.external_inbox_id}:${row.metric_date}`);
  return [...groups.values()].map((values) => {
    const first = values[0];
    return Object.freeze({
      inbox_daily_key: `chatwoot:${context.accountKey}:inbox:${first.external_inbox_id}:${first.metric_date}`,
      customer_key: context.customerKey,
      account_key: context.accountKey,
      external_account_id: context.externalAccountId,
      external_inbox_id: first.external_inbox_id,
      metric_date: first.metric_date,
      reporting_timezone: context.reportingTimezone,
      conversation_count: values.length,
      new_conversation_count: sum(values, 'new_conversation_count'),
      resolved_count: sum(values, 'resolved_count'),
      reopened_count: sum(values, 'reopened_count'),
      incoming_message_count: sum(values, 'incoming_message_count'),
      outgoing_message_count: sum(values, 'outgoing_message_count'),
      avg_first_response_seconds: average(values, 'first_response_seconds'),
      avg_resolution_seconds: average(values, 'resolution_seconds'),
      avg_reply_seconds: average(values, 'reply_seconds'),
      data_status: 'complete_for_observed_scope',
      coverage_run_id: coverageRunId(context, 'inbox_daily'),
      source_revision: maxText(values.map((row) => row.source_revision)),
      fetched_at: context.observedAt,
      sync_run_id: context.syncRunId,
      created_at: context.observedAt,
      updated_at: context.observedAt,
    });
  }).sort(compareKey('inbox_daily_key'));
}

function buildAccountDaily(rows, agents, inboxes, context) {
  const groups = groupBy(rows, (row) => row.metric_date);
  if (groups.size === 0) groups.set(context.metricDate, []);
  return [...groups.entries()].map(([metricDate, values]) => Object.freeze({
    account_daily_key: `chatwoot:${context.accountKey}:account:${metricDate}`,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    metric_date: metricDate,
    reporting_timezone: context.reportingTimezone,
    conversation_count: values.length,
    new_conversation_count: sum(values, 'new_conversation_count'),
    open_conversation_count: values.filter((row) => row.status === 'open').length,
    resolved_conversation_count: values.filter((row) => row.status === 'resolved').length,
    pending_conversation_count: values.filter((row) => row.status === 'pending').length,
    snoozed_conversation_count: values.filter((row) => row.status === 'snoozed').length,
    reopened_count: sum(values, 'reopened_count'),
    incoming_message_count: sum(values, 'incoming_message_count'),
    outgoing_message_count: sum(values, 'outgoing_message_count'),
    avg_first_response_seconds: average(values, 'first_response_seconds'),
    avg_resolution_seconds: average(values, 'resolution_seconds'),
    avg_reply_seconds: average(values, 'reply_seconds'),
    active_agent_count: agents.filter((row) => row.availabilityStatus !== 'offline').length,
    active_inbox_count: inboxes.length,
    data_status: 'complete_for_observed_scope',
    coverage_run_id: coverageRunId(context, 'account_daily'),
    source_revision: maxText(values.map((row) => row.source_revision)),
    fetched_at: context.observedAt,
    sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  })).sort(compareKey('account_daily_key'));
}

function buildCoverage({ context, datasets }) {
  const runs = [];
  const entities = [];
  const summary = {};
  for (const [dataset, rows] of Object.entries(datasets)) {
    const runId = coverageRunId(context, dataset);
    const stableIds = rows.map((row, index) => readStableKey(row) ?? `${dataset}:${index + 1}`);
    runs.push(Object.freeze({
      coverage_run_id: runId,
      sync_run_id: context.syncRunId,
      customer_key: context.customerKey,
      platform: 'chatwoot',
      account_key: context.accountKey,
      dataset_key: `chatwoot.${toSnake(dataset)}`,
      metric_semantics: dataset.toLowerCase().includes('daily') ? 'period' : 'snapshot',
      scope_mode: 'bounded_poll',
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
      source_watermark: String(findMaxTimestamp(rows)),
      revisable_until: null,
      started_at: context.observedAt,
      completed_at: context.observedAt,
      error_code: null,
      created_at: context.observedAt,
      updated_at: context.observedAt,
    }));
    for (const stableId of stableIds) {
      entities.push(Object.freeze({
        coverage_entity_key: `${runId}:${stableId}`,
        coverage_run_id: runId,
        entity_type: toSnake(dataset),
        external_entity_id: stableId,
        observation_status: 'observed',
        source_revision: null,
        observed_at: context.observedAt,
        created_at: context.observedAt,
      }));
    }
    summary[dataset] = Object.freeze({ expected: rows.length, observed: rows.length, failed: 0 });
  }
  return Object.freeze({
    runs: Object.freeze(runs),
    entities: Object.freeze(entities),
    summary: Object.freeze(summary),
  });
}

async function buildSourceRecordStates(datasets) {
  const rows = [];
  for (const [dataset, values] of Object.entries(datasets)) {
    const list = Array.isArray(values) ? values : [values];
    for (const value of list) {
      const sourceRecordId = `${toSnake(dataset)}:${readExternalId(value)}`;
      rows.push(Object.freeze({
        sourceRecordId,
        sourceModifiedAt: readSourceUpdatedAt(value),
        sourceHash: await createStableFingerprint(value),
        externalContentId: readStableKey(value),
      }));
    }
  }
  return Object.freeze(rows.sort((a, b) => a.sourceRecordId.localeCompare(b.sourceRecordId)));
}

function toAccountState(row, context) {
  return Object.freeze({
    account_state_key: row.accountStateKey,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    first_seen_at: row.firstSeenAt,
    last_seen_at: row.lastSeenAt,
    source_updated_at: row.sourceUpdatedAt,
    metadata_hash: row.metadataHash,
    last_coverage_run_id: coverageRunId(context, 'accounts'),
    last_sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function toInboxState(row, context) {
  return Object.freeze({
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
    last_coverage_run_id: coverageRunId(context, 'inboxes'),
    last_sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function toContactState(row, context) {
  return Object.freeze({
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
    last_coverage_run_id: coverageRunId(context, 'contacts'),
    last_sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function toAgentState(row, context) {
  return Object.freeze({
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
    last_coverage_run_id: coverageRunId(context, 'agents'),
    last_sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function toTeamState(row, context) {
  return Object.freeze({
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
    last_coverage_run_id: coverageRunId(context, 'teams'),
    last_sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function toLabelState(row, context) {
  return Object.freeze({
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
    last_coverage_run_id: coverageRunId(context, 'labels'),
    last_sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function toConversationState(row, context) {
  return Object.freeze({
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
    last_coverage_run_id: coverageRunId(context, 'conversations'),
    last_sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function toMessageState(row, context) {
  return Object.freeze({
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
    last_coverage_run_id: coverageRunId(context, 'messages'),
    last_sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function toReportingEventFact(row, context) {
  return Object.freeze({
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
    coverage_run_id: coverageRunId(context, 'reporting_events'),
    sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  });
}

function toLarkAccount(row) { return row; }
function toLarkInbox(row) { return row; }
function toLarkContact(row) { return row; }
function toLarkAgent(row) { return row; }
function toLarkTeam(row) { return row; }
function toLarkLabel(row) { return row; }
function toLarkConversation(row) { return row; }
function toLarkConversationLabel(row) { return row; }
function toLarkMessage(row) { return row; }
function toLarkReportingEvent(row) { return row; }
function toCanonicalConversation(row) {
  return Object.freeze({
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

function countSourceRows(value) {
  return 1 + value.inboxes.length + value.contacts.length + value.agents.length
    + value.teams.length + value.labels.length + value.conversations.length
    + value.conversationLabels.length + value.messages.length + value.reportingEvents.length;
}

function coverageRunId(context, dataset) {
  return `${context.coverageRunIdPrefix}:chatwoot:${toSnake(dataset)}`;
}

function readStableKey(value) {
  return value.accountStateKey ?? value.inboxKey ?? value.contactKey ?? value.agentKey
    ?? value.teamKey ?? value.labelKey ?? value.conversationKey ?? value.messageKey
    ?? value.reportingEventKey ?? value.account_state_key ?? value.inbox_key ?? value.contact_key
    ?? value.agent_key ?? value.team_key ?? value.label_key ?? value.conversation_key
    ?? value.message_key ?? value.reporting_event_key ?? value.conversation_label_key
    ?? value.conversation_daily_key ?? value.agent_daily_key ?? value.inbox_daily_key
    ?? value.account_daily_key ?? null;
}

function readExternalId(value) {
  return value.externalAccountId ?? value.externalInboxId ?? value.externalContactId
    ?? value.externalAgentId ?? value.externalTeamId ?? value.externalLabelId
    ?? value.externalConversationId ?? value.externalMessageId ?? value.externalReportingEventId
    ?? readStableKey(value);
}

function readSourceUpdatedAt(value) {
  return value.sourceUpdatedAt ?? value.lastSeenAt ?? value.observedAt ?? null;
}

function findMaxTimestamp(rows) {
  let max = 0;
  for (const row of rows) {
    const candidates = [row.sourceUpdatedAt, row.lastActivityAt, row.eventEndAt, row.lastSeenAt,
      row.source_updated_at, row.last_activity_at, row.event_end_at, row.updated_at];
    for (const value of candidates) if (Number.isFinite(Number(value))) max = Math.max(max, Number(value));
  }
  return max;
}

function groupBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows) {
    const key = keyFn(row);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

function sum(rows, field) {
  return rows.reduce((total, row) => total + Number(row[field] ?? 0), 0);
}

function average(rows, field) {
  const values = rows.map((row) => row[field]).filter((value) => value !== null && value !== undefined)
    .map(Number).filter(Number.isFinite);
  return values.length === 0 ? null : values.reduce((total, value) => total + value, 0) / values.length;
}

function maxText(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length === 0 ? null : String(Math.max(...numbers));
}

function boolInt(value) {
  if (value === null || value === undefined) return null;
  return value === true ? 1 : 0;
}

function compareKey(field) {
  return (left, right) => String(left[field]).localeCompare(String(right[field]));
}

function toSnake(value) {
  return String(value).replace(/([a-z0-9])([A-Z])/gu, '$1_$2').toLowerCase();
}

function formatDate(timestamp, timeZone) {
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

function requireIdentity(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.includes(':')) throw new TypeError(`${fieldName} must not contain ":"`);
  return text;
}

function requirePositiveId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive safe integer`);
  return String(number);
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} must be a non-empty string`);
  return value.trim();
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
