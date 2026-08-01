import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';

export const CHATWOOT_LARK_WRITE_TARGETS = Object.freeze([
  target('raw.accounts', 'rawChatwootAccounts', 'account_state_key'),
  target('raw.inboxes', 'rawChatwootInboxes', 'inbox_key'),
  target('raw.resolvedContacts', 'rawChatwootContacts', 'contact_key'),
  target('raw.agents', 'rawChatwootAgents', 'agent_key'),
  target('raw.teams', 'rawChatwootTeams', 'team_key'),
  target('raw.labels', 'rawChatwootLabels', 'label_key'),
  target('raw.conversations', 'rawChatwootConversations', 'conversation_key'),
  target('raw.conversationLabels', 'rawChatwootConversationLabels', 'conversation_label_key'),
  target('raw.messages', 'rawChatwootMessageAnalytics', 'message_key'),
  target('raw.reportingEvents', 'rawChatwootReportingEvents', 'reporting_event_key'),
  target('canonical.conversations', 'mktConversations', 'conversation_key'),
  target('canonical.conversationDaily', 'mktConversationDaily', 'conversation_daily_key', true),
  target('canonical.agentDaily', 'mktAgentDaily', 'agent_daily_key', true),
  target('canonical.inboxDaily', 'mktInboxDaily', 'inbox_daily_key', true),
  target('canonical.accountDaily', 'mktConversationAccountDaily', 'account_daily_key', true),
]);

/** Build deterministic, PII-minimized D1 and optional report/Lark write sets. */
export async function prepareChatwootAnalyticsSync(input = {}) {
  const context = readContext(input);
  const source = readSource(input);
  assertIdentity(context, source);

  const labelIds = new Map(source.labels.map((row) => [row.labelKey, row.externalLabelId]));
  const conversationLabels = buildConversationLabels(
    source.conversations,
    labelIds,
    source.previousConversationLabels,
    context,
  );
  const daily = context.includeReports
    ? buildDailyFacts(source.conversations, source.messages, source.reportingEvents, context)
    : emptyDailyFacts();

  const d1 = Object.freeze({
    account: accountState(source.account, context),
    inboxes: freezeRows(source.inboxes.map((row) => inboxState(row, context))),
    resolvedContacts: freezeRows(source.contacts.map((row) => contactState(row, context))),
    contacts: freezeRows(source.contacts.map((row) => contactState(row, context))),
    agents: freezeRows(source.agents.map((row) => agentState(row, context))),
    teams: freezeRows(source.teams.map((row) => teamState(row, context))),
    labels: freezeRows(source.labels.map((row) => labelState(row, context))),
    conversations: freezeRows(source.conversations.map((row) => conversationState(row, context))),
    conversationLabels: freezeRows(conversationLabels),
    messages: freezeRows(source.messages.map((row) => messageState(row, context))),
    reportingEvents: freezeRows(source.reportingEvents.map((row) => reportingEventFact(row, context))),
    conversationDaily: daily.conversationDaily,
    agentDaily: daily.agentDaily,
    inboxDaily: daily.inboxDaily,
    accountDaily: daily.accountDaily,
    ...buildCoverage(context, {
      accounts: [source.account],
      inboxes: source.inboxes,
      resolvedContacts: source.contacts,
      agents: source.agents,
      teams: source.teams,
      labels: source.labels,
      conversations: source.conversations,
      conversationLabels,
      messages: source.messages,
      reportingEvents: source.reportingEvents,
      ...(context.includeReports ? {
        conversationDaily: daily.conversationDaily,
        agentDaily: daily.agentDaily,
        inboxDaily: daily.inboxDaily,
        accountDaily: daily.accountDaily,
      } : {}),
    }),
  });

  const lark = Object.freeze({
    raw: Object.freeze({
      accounts: freezeRows([d1.account]),
      inboxes: d1.inboxes,
      resolvedContacts: d1.resolvedContacts,
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
      dailyRows: daily.conversationDaily.length + daily.agentDaily.length
        + daily.inboxDaily.length + daily.accountDaily.length,
      piiPolicy: 'allowlist_no_message_body_direct_identity_or_label_text',
      sourceComplete: true,
      sinksComplete: false,
    }),
  });
}

export function finalizeChatwootCoverageRuns(runs, completedAt) {
  const timestamp = positiveInteger(completedAt, 'completedAt');
  return freezeRows(requireArray(runs, 'coverage runs').map((row) => freeze({
    ...row,
    status: 'complete',
    written_rows: row.observed_rows,
    failed_rows: 0,
    completed_at: timestamp,
    updated_at: timestamp,
  })));
}

export function readChatwootWriteSetPath(value, path) {
  return path.split('.').reduce((current, segment) => current?.[segment], value) ?? [];
}

function target(path, tableKey, keyField, requiresReport = false) {
  return Object.freeze({ path, tableKey, keyField, requiresReport });
}

function readContext(input) {
  const observedAt = positiveInteger(input.observedAt, 'observedAt');
  const reportingTimezone = requireText(input.reportingTimezone ?? 'UTC', 'reportingTimezone');
  assertTimeZone(reportingTimezone);
  const fullSnapshot = input.fullSnapshot === true;
  const includeReports = input.includeReports === true;
  if (includeReports && !fullSnapshot) {
    throw new TypeError('Chatwoot report preparation requires fullSnapshot=true');
  }
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
    fullSnapshot,
    includeReports,
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
    previousConversationLabels: requireArray(
      input.previousConversationLabels ?? [],
      'previousConversationLabels',
    ),
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
    ...lineage(context, 'resolved_contacts'),
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
    title_hash: row.titleHash,
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

function buildConversationLabels(conversations, labelIds, previousRows, context) {
  const rows = [];
  const currentKeys = new Set();
  const selectedConversationIds = new Set(conversations.map((row) => row.externalConversationId));
  for (const conversation of conversations) {
    for (const labelKey of conversation.labelKeys ?? []) {
      const externalLabelId = labelIds.get(labelKey);
      if (!externalLabelId) throw new TypeError(`Conversation references unknown label key: ${labelKey}`);
      const key = `${conversation.conversationKey}:label:${externalLabelId}`;
      currentKeys.add(key);
      rows.push(conversationLabelRow({
        key,
        conversationKey: conversation.conversationKey,
        externalConversationId: conversation.externalConversationId,
        labelKey,
        externalLabelId,
        active: 1,
        removedAt: null,
        context,
      }));
    }
  }
  for (const previous of previousRows) {
    const externalConversationId = positiveId(
      previous.externalConversationId,
      'previousConversationLabels.externalConversationId',
    );
    if (!selectedConversationIds.has(externalConversationId)) continue;
    const externalLabelId = positiveId(
      previous.externalLabelId,
      'previousConversationLabels.externalLabelId',
    );
    const conversationKey = `chatwoot:${context.accountKey}:conversation:${externalConversationId}`;
    const key = `${conversationKey}:label:${externalLabelId}`;
    if (currentKeys.has(key)) continue;
    rows.push(conversationLabelRow({
      key,
      conversationKey,
      externalConversationId,
      labelKey: `chatwoot:${context.accountKey}:label:${externalLabelId}`,
      externalLabelId,
      active: 0,
      removedAt: context.observedAt,
      context,
    }));
  }
  return rows.sort(by('conversation_label_key'));
}

function conversationLabelRow(input) {
  return freeze({
    conversation_label_key: input.key,
    conversation_key: input.conversationKey,
    customer_key: input.context.customerKey,
    account_key: input.context.accountKey,
    external_account_id: input.context.externalAccountId,
    label_key: input.labelKey,
    external_conversation_id: input.externalConversationId,
    external_label_id: input.externalLabelId,
    active: input.active,
    observed_at: input.context.observedAt,
    removed_at: input.removedAt,
    coverage_run_id: coverageId(input.context, 'conversation_labels'),
    sync_run_id: input.context.syncRunId,
    created_at: input.context.observedAt,
    updated_at: input.context.observedAt,
  });
}

function buildDailyFacts(conversations, messages, reportingEvents, context) {
  const conversationsById = new Map(conversations.map((row) => [row.externalConversationId, row]));
  const groups = new Map();
  const ensure = (conversation, metricDate) => {
    const key = `${conversation.conversationKey}:${metricDate}`;
    if (!groups.has(key)) {
      groups.set(key, {
        conversation,
        metricDate,
        newConversationCount: 0,
        resolvedCount: 0,
        reopenedCount: 0,
        incomingMessageCount: 0,
        outgoingMessageCount: 0,
        privateMessageCount: 0,
        attachmentMessageCount: 0,
        firstResponse: [],
        firstResponseBusiness: [],
        resolution: [],
        resolutionBusiness: [],
        reply: [],
        replyBusiness: [],
      });
    }
    return groups.get(key);
  };

  for (const conversation of conversations) {
    ensure(conversation, dateOnly(conversation.sourceCreatedAt, context.reportingTimezone))
      .newConversationCount += 1;
    if (conversation.reopenCountDelta > 0) {
      ensure(conversation, dateOnly(conversation.sourceUpdatedAt, context.reportingTimezone))
        .reopenedCount += conversation.reopenCountDelta;
    }
  }
  for (const message of messages) {
    const conversation = conversationsById.get(message.externalConversationId);
    if (!conversation) continue;
    const row = ensure(conversation, dateOnly(message.sourceCreatedAt, context.reportingTimezone));
    if (message.direction === 'incoming') row.incomingMessageCount += 1;
    if (message.direction === 'outgoing') row.outgoingMessageCount += 1;
    if (message.private === true) row.privateMessageCount += 1;
    if (Number(message.attachmentCount ?? 0) > 0) row.attachmentMessageCount += 1;
  }
  for (const event of reportingEvents) {
    const conversation = conversationsById.get(event.externalConversationId);
    if (!conversation) continue;
    const row = ensure(conversation, dateOnly(event.eventEndAt, context.reportingTimezone));
    if (event.name === 'first_response') {
      row.firstResponse.push(event.valueSeconds);
      pushNullable(row.firstResponseBusiness, event.valueBusinessSeconds);
    } else if (event.name === 'resolution' || event.name === 'conversation_resolved') {
      row.resolvedCount += 1;
      row.resolution.push(event.valueSeconds);
      pushNullable(row.resolutionBusiness, event.valueBusinessSeconds);
    } else if (event.name === 'reply_time') {
      row.reply.push(event.valueSeconds);
      pushNullable(row.replyBusiness, event.valueBusinessSeconds);
    }
  }

  const conversationDaily = [...groups.values()].map((group) => buildConversationDailyRow(group, context))
    .sort(by('conversation_daily_key'));
  return Object.freeze({
    conversationDaily: freezeRows(conversationDaily),
    agentDaily: freezeRows(aggregateDaily(conversationDaily, context, 'agent')),
    inboxDaily: freezeRows(aggregateDaily(conversationDaily, context, 'inbox')),
    accountDaily: freezeRows(aggregateAccountDaily(conversationDaily, context)),
  });
}

function buildConversationDailyRow(group, context) {
  const row = group.conversation;
  return freeze({
    conversation_daily_key: `${row.conversationKey}:${group.metricDate}`,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    external_conversation_id: row.externalConversationId,
    external_inbox_id: row.externalInboxId,
    external_agent_id: row.externalAssigneeId,
    external_team_id: row.externalTeamId,
    metric_date: group.metricDate,
    reporting_timezone: context.reportingTimezone,
    status: dateOnly(row.sourceUpdatedAt, context.reportingTimezone) === group.metricDate ? row.status : null,
    new_conversation_count: group.newConversationCount,
    resolved_count: group.resolvedCount,
    reopened_count: group.reopenedCount,
    incoming_message_count: group.incomingMessageCount,
    outgoing_message_count: group.outgoingMessageCount,
    private_message_count: group.privateMessageCount,
    attachment_message_count: group.attachmentMessageCount,
    first_response_seconds: avgNumbers(group.firstResponse),
    first_response_business_seconds: avgNumbers(group.firstResponseBusiness),
    resolution_seconds: avgNumbers(group.resolution),
    resolution_business_seconds: avgNumbers(group.resolutionBusiness),
    reply_seconds: avgNumbers(group.reply),
    reply_business_seconds: avgNumbers(group.replyBusiness),
    data_status: 'partial',
    coverage_run_id: coverageId(context, 'conversation_daily'),
    source_revision: String(maxNumber([
      row.sourceUpdatedAt,
      ...group.firstResponse,
      ...group.resolution,
      ...group.reply,
    ])),
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
      data_status: 'partial',
      coverage_run_id: coverageId(context, `${dimension}_daily`),
      source_revision: maxRevision(values),
      fetched_at: context.observedAt,
      sync_run_id: context.syncRunId,
      created_at: context.observedAt,
      updated_at: context.observedAt,
    };
    if (dimension === 'agent') common.assigned_conversation_count = null;
    else {
      common.conversation_count = new Set(values.map((row) => row.external_conversation_id)).size;
      common.new_conversation_count = sum(values, 'new_conversation_count');
    }
    return freeze(common);
  }).sort(by(keyField));
}

function aggregateAccountDaily(rows, context) {
  const groups = group(rows, (row) => row.metric_date);
  return [...groups.entries()].map(([metricDate, values]) => freeze({
    account_daily_key: `chatwoot:${context.accountKey}:account:${metricDate}`,
    customer_key: context.customerKey,
    account_key: context.accountKey,
    external_account_id: context.externalAccountId,
    metric_date: metricDate,
    reporting_timezone: context.reportingTimezone,
    conversation_count: new Set(values.map((row) => row.external_conversation_id)).size,
    new_conversation_count: sum(values, 'new_conversation_count'),
    open_conversation_count: null,
    resolved_conversation_count: sum(values, 'resolved_count'),
    pending_conversation_count: null,
    snoozed_conversation_count: null,
    reopened_count: sum(values, 'reopened_count'),
    incoming_message_count: sum(values, 'incoming_message_count'),
    outgoing_message_count: sum(values, 'outgoing_message_count'),
    avg_first_response_seconds: avg(values, 'first_response_seconds'),
    avg_resolution_seconds: avg(values, 'resolution_seconds'),
    avg_reply_seconds: avg(values, 'reply_seconds'),
    active_agent_count: null,
    active_inbox_count: null,
    data_status: 'partial',
    coverage_run_id: coverageId(context, 'account_daily'),
    source_revision: maxRevision(values),
    fetched_at: context.observedAt,
    sync_run_id: context.syncRunId,
    created_at: context.observedAt,
    updated_at: context.observedAt,
  })).sort(by('account_daily_key'));
}

function emptyDailyFacts() {
  return Object.freeze({
    conversationDaily: Object.freeze([]),
    agentDaily: Object.freeze([]),
    inboxDaily: Object.freeze([]),
    accountDaily: Object.freeze([]),
  });
}

function buildCoverage(context, datasets) {
  const coverageRuns = [];
  const coverageEntities = [];
  for (const [dataset, rows] of Object.entries(datasets)) {
    const entityType = snake(dataset);
    const runId = coverageId(context, dataset);
    const watermark = maxTimestamp(rows);
    const scopeMode = coverageScope(context, entityType);
    coverageRuns.push(freeze({
      coverage_run_id: runId,
      sync_run_id: context.syncRunId,
      customer_key: context.customerKey,
      platform: 'chatwoot',
      account_key: context.accountKey,
      dataset_key: `chatwoot.${entityType}`,
      metric_semantics: entityType.includes('daily') ? 'period' : 'snapshot',
      scope_mode: scopeMode,
      period_start: entityType.includes('daily') ? minDate(rows) : null,
      period_end: entityType.includes('daily') ? maxDate(rows) : context.metricDate,
      source_timezone: context.reportingTimezone,
      status: 'partial',
      expected_entities: rows.length,
      observed_entities: rows.length,
      expected_rows: rows.length,
      observed_rows: rows.length,
      written_rows: 0,
      failed_rows: 0,
      source_watermark: watermark > 0 ? String(watermark) : null,
      revisable_until: null,
      started_at: context.observedAt,
      completed_at: null,
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
        source_revision: sourceRevision(row),
        observed_at: context.observedAt,
        created_at: context.observedAt,
      }));
    });
  }
  return Object.freeze({ coverageRuns: freezeRows(coverageRuns), coverageEntities: freezeRows(coverageEntities) });
}

function coverageScope(context, entityType) {
  if (entityType === 'resolved_contacts') return 'exact_entities';
  if (entityType.includes('daily')) return 'report_range';
  return context.fullSnapshot ? 'full_inventory' : 'recent_window';
}

async function buildSourceRecordStates(source) {
  const records = [];
  for (const [dataset, values] of Object.entries(source)) {
    if (dataset === 'previousConversationLabels') continue;
    const rows = Array.isArray(values) ? values : [values];
    for (const row of rows) {
      records.push(freeze({
        sourceRecordId: `${snake(dataset)}:${externalId(row)}`,
        sourceModifiedAt: sourceUpdatedAt(row),
        sourceHash: await deterministicSourceHash(row),
        externalContentId: stableKey(row),
      }));
    }
  }
  return freezeRows(records.sort(by('sourceRecordId')));
}

async function deterministicSourceHash(row) {
  return createStableFingerprint({
    stableKey: stableKey(row),
    sourceUpdatedAt: sourceUpdatedAt(row),
    metadataHash: row.metadataHash ?? null,
    metricsHash: row.metricsHash ?? null,
    sourcePayloadHash: row.sourcePayloadHash ?? null,
  });
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
    Object.freeze({ expected: row.expected_rows, observed: row.observed_rows, failed: row.failed_rows }),
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
  return row.sourceUpdatedAt ?? row.lastActivityAt ?? row.eventEndAt ?? row.sourceCreatedAt ?? null;
}

function sourceRevision(row) {
  const value = sourceUpdatedAt(row) ?? row.source_revision ?? null;
  return value === null || value === undefined ? null : String(value);
}

function maxTimestamp(rows) {
  let result = 0;
  for (const row of rows) {
    for (const value of [row.sourceUpdatedAt, row.lastActivityAt, row.eventEndAt, row.sourceCreatedAt,
      row.source_updated_at, row.last_activity_at, row.event_end_at, row.source_created_at,
      row.updated_at]) {
      const number = Number(value);
      if (Number.isFinite(number)) result = Math.max(result, number);
    }
  }
  return result;
}

function minDate(rows) {
  const values = rows.map((row) => row.metric_date).filter(Boolean).sort();
  return values[0] ?? null;
}

function maxDate(rows) {
  const values = rows.map((row) => row.metric_date).filter(Boolean).sort();
  return values.at(-1) ?? null;
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
  return avgNumbers(rows.map((row) => row[field]));
}

function avgNumbers(values) {
  const numbers = values.filter((value) => value !== null && value !== undefined)
    .map(Number).filter(Number.isFinite);
  return numbers.length === 0 ? null : numbers.reduce((total, value) => total + value, 0) / numbers.length;
}

function maxRevision(rows) {
  const values = rows.map((row) => Number(row.source_revision)).filter(Number.isFinite);
  return values.length === 0 ? null : String(Math.max(...values));
}

function maxNumber(values) {
  const numbers = values.map(Number).filter(Number.isFinite);
  return numbers.length === 0 ? 0 : Math.max(...numbers);
}

function pushNullable(values, value) {
  if (value !== null && value !== undefined && Number.isFinite(Number(value))) values.push(Number(value));
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
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}
function identity(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.includes(':')) throw new TypeError(`${fieldName} must not contain ":"`);
  return text;
}
function positiveId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
  return String(number);
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive integer`);
  }
  return number;
}
