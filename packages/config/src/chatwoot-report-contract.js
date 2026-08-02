export const CHATWOOT_REPORT_CAPABILITY = 'customer_service';
export const CHATWOOT_REPORT_PLATFORM_SCOPE = 'chatwoot';
export const CHATWOOT_REPORT_WINDOWS = Object.freeze([1, 3, 7, 30]);
export const CHATWOOT_REPORT_TOP_DIMENSION_LIMIT = 20;

const SUMMARY = Object.freeze([
  sumMetric('chatwoot:new_conversations', 'New conversations', 'new_conversation_count'),
  sumMetric('chatwoot:resolved_conversations', 'Resolved conversations', 'resolved_count'),
  sumMetric('chatwoot:reopened_conversations', 'Reopened conversations', 'reopened_count'),
  sumMetric('chatwoot:incoming_messages', 'Incoming messages', 'incoming_message_count'),
  sumMetric('chatwoot:outgoing_messages', 'Outgoing messages', 'outgoing_message_count'),
  sumMetric('chatwoot:private_messages', 'Private messages', 'private_message_count'),
  sumMetric('chatwoot:attachment_messages', 'Attachment messages', 'attachment_message_count'),
  eligibleMetric('chatwoot:first_response_eligible_count', 'First response samples', 'first_response_seconds'),
  averageMetric('chatwoot:average_first_response_seconds', 'Average first response', 'first_response_seconds'),
  eligibleMetric('chatwoot:resolution_eligible_count', 'Resolution samples', 'resolution_seconds'),
  averageMetric('chatwoot:average_resolution_seconds', 'Average resolution time', 'resolution_seconds'),
  eligibleMetric('chatwoot:reply_eligible_count', 'Reply samples', 'reply_seconds'),
  averageMetric('chatwoot:average_reply_seconds', 'Average reply time', 'reply_seconds'),
  latestMetric('chatwoot:conversation_count_end', 'Conversations at period end', 'conversation_count'),
  latestMetric('chatwoot:open_conversations_end', 'Open conversations at period end', 'open_conversation_count'),
  latestMetric('chatwoot:pending_conversations_end', 'Pending conversations at period end', 'pending_conversation_count'),
  latestMetric('chatwoot:snoozed_conversations_end', 'Snoozed conversations at period end', 'snoozed_conversation_count'),
  latestMetric('chatwoot:active_agents_end', 'Active agents at period end', 'active_agent_count'),
  latestMetric('chatwoot:active_inboxes_end', 'Active inboxes at period end', 'active_inbox_count'),
]);

const DIMENSIONS = Object.freeze([
  dimension({
    dimensionType: 'inbox',
    sourceTable: 'chatwoot_conversation_daily_facts',
    entityField: 'external_inbox_id',
    rankings: [
      ranking('chatwoot:inbox:new_conversations', 'Inbox new conversations', 'new_conversation_count'),
      ranking('chatwoot:inbox:resolved_conversations', 'Inbox resolved conversations', 'resolved_count'),
      ranking('chatwoot:inbox:incoming_messages', 'Inbox incoming messages', 'incoming_message_count'),
      ranking('chatwoot:inbox:outgoing_messages', 'Inbox outgoing messages', 'outgoing_message_count'),
    ],
  }),
  dimension({
    dimensionType: 'agent',
    sourceTable: 'chatwoot_conversation_daily_facts',
    entityField: 'external_agent_id',
    rankings: [
      ranking('chatwoot:agent:resolved_conversations', 'Agent resolved conversations', 'resolved_count'),
      ranking('chatwoot:agent:outgoing_messages', 'Agent outgoing messages', 'outgoing_message_count'),
    ],
  }),
]);

const REJECTED = Object.freeze([
  rejected('resolution_rate', 'Resolved events may belong to conversations opened before the period; resolved/new is not a valid cohort rate.'),
  rejected('sla_compliance_rate', 'The current D1 schema contains no approved SLA target or breach fact.'),
  rejected('csat_score', 'The current D1 schema contains no approved CSAT response fact.'),
  rejected('unique_contacts', 'Contact-level reporting is not required for the first contract and risks exposing or encouraging PII-derived analysis.'),
  rejected('label_rankings', 'Only title_hash is retained; raw label titles are intentionally excluded and are not client-displayable dimensions.'),
  rejected('average_of_daily_averages', 'Daily average fields cannot be averaged across days without eligible sample counts.'),
  rejected('team_rankings', 'The first contract does not have enough approved aggregation evidence to rank teams without overlap ambiguity.'),
  rejected('message_content_metrics', 'Message body/content and raw payload are forbidden by the PII-minimized source contract.'),
]);

export const CHATWOOT_REPORT_CONTRACT = Object.freeze({
  contractVersion: 'chatwoot_generic_report_contract_v1',
  platformScope: CHATWOOT_REPORT_PLATFORM_SCOPE,
  capability: CHATWOOT_REPORT_CAPABILITY,
  periods: CHATWOOT_REPORT_WINDOWS,
  timezone: 'Asia/Bangkok',
  summaryMetrics: SUMMARY,
  dimensions: DIMENSIONS,
  rejectedMetrics: REJECTED,
  sourceAuthority: Object.freeze({
    eventGrainTable: 'chatwoot_conversation_daily_facts',
    periodEndSnapshotTable: 'chatwoot_account_daily_facts',
    coverageRequired: true,
    acceptedDataStatus: Object.freeze(['complete', 'no_data_confirmed']),
  }),
  nullZeroSemantics: Object.freeze({
    missingOrIncomplete: 'null',
    observedZero: 0,
    emptyEligibleSampleAverage: 'null',
    absentPreviousBaseline: 'null',
    dimensionComparison: 'null',
  }),
  piiBoundary: Object.freeze({
    messageBody: 'forbidden',
    contactName: 'forbidden',
    email: 'forbidden',
    phone: 'forbidden',
    address: 'forbidden',
    freeFormLabelTitle: 'forbidden',
    opaqueInboxId: 'allowed',
    opaqueAgentId: 'allowed',
  }),
});

export function getChatwootReportMetric(metricKey) {
  const normalized = requireText(metricKey, 'metricKey');
  return SUMMARY.find((metric) => metric.metricKey === normalized) ?? null;
}

export function assertChatwootReportContract() {
  assertUnique(SUMMARY.map((metric) => metric.metricKey), 'summary metric key');
  assertUnique(DIMENSIONS.map((entry) => entry.dimensionType), 'dimension type');
  assertUnique(
    DIMENSIONS.flatMap((entry) => entry.rankings.map((item) => item.metricKey)),
    'dimension metric key',
  );
  if (SUMMARY.some((metric) => metric.currentOnIncomplete !== null)) {
    throw new Error('Chatwoot report metrics must remain null when Coverage is incomplete');
  }
  if (DIMENSIONS.some((entry) => entry.rankLimit !== CHATWOOT_REPORT_TOP_DIMENSION_LIMIT)) {
    throw new Error('Chatwoot dimension rank limit drifted');
  }
  return true;
}

function sumMetric(metricKey, displayName, field) {
  return metric({
    metricKey,
    displayName,
    sourceTable: 'chatwoot_conversation_daily_facts',
    sourceField: field,
    aggregation: 'sum',
    valueType: 'count',
  });
}

function eligibleMetric(metricKey, displayName, field) {
  return metric({
    metricKey,
    displayName,
    sourceTable: 'chatwoot_conversation_daily_facts',
    sourceField: field,
    aggregation: 'count_non_null',
    valueType: 'count',
  });
}

function averageMetric(metricKey, displayName, field) {
  return metric({
    metricKey,
    displayName,
    sourceTable: 'chatwoot_conversation_daily_facts',
    sourceField: field,
    aggregation: 'sum_non_null_divide_count_non_null',
    valueType: 'duration_seconds',
  });
}

function latestMetric(metricKey, displayName, field) {
  return metric({
    metricKey,
    displayName,
    sourceTable: 'chatwoot_account_daily_facts',
    sourceField: field,
    aggregation: 'latest_completed_day_value',
    valueType: 'count',
    comparisonEligible: true,
  });
}

function metric(input) {
  return Object.freeze({
    metricKey: requireText(input.metricKey, 'metricKey'),
    displayName: requireText(input.displayName, 'displayName'),
    sourceTable: requireAllowedSourceTable(input.sourceTable),
    sourceField: requireText(input.sourceField, 'sourceField'),
    aggregation: requireText(input.aggregation, 'aggregation'),
    valueType: requireText(input.valueType, 'valueType'),
    comparisonEligible: input.comparisonEligible !== false,
    currentOnIncomplete: null,
    observedZero: 0,
  });
}

function dimension(input) {
  return Object.freeze({
    dimensionType: requireText(input.dimensionType, 'dimensionType'),
    sourceTable: requireAllowedSourceTable(input.sourceTable),
    entityField: requireText(input.entityField, 'entityField'),
    rankLimit: CHATWOOT_REPORT_TOP_DIMENSION_LIMIT,
    fixedRankPlaceholders: true,
    comparisonEligible: false,
    rankings: Object.freeze(input.rankings),
  });
}

function ranking(metricKey, displayName, sourceField) {
  return Object.freeze({
    metricKey: requireText(metricKey, 'metricKey'),
    displayName: requireText(displayName, 'displayName'),
    sourceField: requireText(sourceField, 'sourceField'),
    aggregation: 'sum',
    order: 'descending',
    comparisonEligible: false,
    emptyRankValue: null,
  });
}

function rejected(metricName, reason) {
  return Object.freeze({
    metricName: requireText(metricName, 'metricName'),
    reason: requireText(reason, 'reason'),
  });
}

function requireAllowedSourceTable(value) {
  const normalized = requireText(value, 'sourceTable');
  if (!['chatwoot_conversation_daily_facts', 'chatwoot_account_daily_facts'].includes(normalized)) {
    throw new Error(`Unsupported Chatwoot Report source table: ${normalized}`);
  }
  return normalized;
}

function assertUnique(values, label) {
  if (new Set(values).size !== values.length) throw new Error(`Duplicate Chatwoot Report ${label}`);
}

function requireText(value, field) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Chatwoot Report contract requires ${field}`);
  return value.trim();
}
