import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';
import { toEpochMilliseconds } from '../../../shared/src/date/date-time.js';

const CONVERSATION_STATUSES = new Set(['open', 'resolved', 'pending', 'snoozed']);
const AGENT_AVAILABILITY = new Set(['available', 'busy', 'offline']);
const CONTACT_AVAILABILITY = new Set(['online', 'offline', 'busy', 'unknown']);
const AGENT_ROLES = new Set(['agent', 'administrator']);
const REPORTING_EVENT_NAMES = new Set(['first_response', 'resolution', 'reply_time']);
const MESSAGE_TYPES = Object.freeze({
  0: 'incoming',
  1: 'outgoing',
  2: 'activity',
  3: 'template',
  incoming: 'incoming',
  outgoing: 'outgoing',
  activity: 'activity',
  template: 'template',
});

export async function normalizeChatwootAccount(value, context = {}) {
  const accountKey = requireIdentity(context.accountKey, 'accountKey');
  const customerKey = requireIdentity(context.customerKey, 'customerKey');
  const externalAccountId = requirePositiveId(value?.id ?? context.externalAccountId, 'account.id');
  const observedAt = requireTimestampMs(context.observedAt, 'observedAt');
  return freezeWithHash({
    source: 'chatwoot_application_api',
    customerKey,
    accountKey,
    externalAccountId,
    accountStateKey: `chatwoot:${accountKey}:account:${externalAccountId}`,
    firstSeenAt: observedAt,
    lastSeenAt: observedAt,
    sourceUpdatedAt: optionalTimestampMs(value?.updated_at, 'account.updated_at'),
  }, ['accountStateKey', 'externalAccountId', 'sourceUpdatedAt']);
}

export async function normalizeChatwootInbox(value, context = {}) {
  requireObject(value, 'inbox');
  const base = baseContext(context);
  const externalInboxId = requirePositiveId(value.id, 'inbox.id');
  return freezeWithHash({
    ...base,
    inboxKey: `chatwoot:${base.accountKey}:inbox:${externalInboxId}`,
    externalInboxId,
    channelType: optionalEnumText(value.channel_type, 'inbox.channel_type'),
    medium: optionalEnumText(value.medium, 'inbox.medium'),
    timezone: optionalEnumText(value.timezone, 'inbox.timezone'),
    enableAutoAssignment: optionalBoolean(value.enable_auto_assignment, 'inbox.enable_auto_assignment'),
    workingHoursEnabled: optionalBoolean(value.working_hours_enabled, 'inbox.working_hours_enabled'),
    csatSurveyEnabled: optionalBoolean(value.csat_survey_enabled, 'inbox.csat_survey_enabled'),
    allowMessagesAfterResolved: optionalBoolean(
      value.allow_messages_after_resolved,
      'inbox.allow_messages_after_resolved',
    ),
    firstSeenAt: base.observedAt,
    lastSeenAt: base.observedAt,
    sourceUpdatedAt: optionalTimestampMs(value.updated_at, 'inbox.updated_at'),
  }, [
    'inboxKey', 'externalInboxId', 'channelType', 'medium', 'timezone',
    'enableAutoAssignment', 'workingHoursEnabled', 'csatSurveyEnabled',
    'allowMessagesAfterResolved', 'sourceUpdatedAt',
  ]);
}

export async function normalizeChatwootContact(value, context = {}) {
  requireObject(value, 'contact');
  const base = baseContext(context);
  const externalContactId = requirePositiveId(value.id, 'contact.id');
  return freezeWithHash({
    ...base,
    contactKey: `chatwoot:${base.accountKey}:contact:${externalContactId}`,
    externalContactId,
    blocked: optionalBoolean(value.blocked, 'contact.blocked'),
    availabilityStatus: normalizeAvailability(value.availability_status, CONTACT_AVAILABILITY, 'unknown'),
    sourceAvailabilityStatus: normalizeContactSourceStatus(context.sourceAvailabilityStatus),
    sourceCreatedAt: optionalTimestampMs(value.created_at, 'contact.created_at'),
    lastActivityAt: optionalTimestampMs(value.last_activity_at, 'contact.last_activity_at'),
    sourceUpdatedAt: optionalTimestampMs(value.updated_at, 'contact.updated_at')
      ?? optionalTimestampMs(value.last_activity_at, 'contact.last_activity_at'),
    firstSeenAt: base.observedAt,
    lastSeenAt: base.observedAt,
  }, [
    'contactKey', 'externalContactId', 'blocked', 'availabilityStatus',
    'sourceAvailabilityStatus', 'sourceCreatedAt', 'lastActivityAt', 'sourceUpdatedAt',
  ]);
}

export async function normalizeChatwootAgent(value, context = {}) {
  requireObject(value, 'agent');
  const base = baseContext(context);
  const externalAgentId = requirePositiveId(value.id, 'agent.id');
  const externalAccountId = requirePositiveId(value.account_id ?? base.externalAccountId, 'agent.account_id');
  assertExternalAccount(base.externalAccountId, externalAccountId, 'agent');
  return freezeWithHash({
    ...base,
    agentKey: `chatwoot:${base.accountKey}:agent:${externalAgentId}`,
    externalAgentId,
    role: optionalSetValue(value.role, AGENT_ROLES, 'agent.role'),
    availabilityStatus: normalizeAvailability(value.availability_status, AGENT_AVAILABILITY, 'offline'),
    autoOffline: optionalBoolean(value.auto_offline, 'agent.auto_offline'),
    confirmed: optionalBoolean(value.confirmed, 'agent.confirmed'),
    customRoleId: optionalPositiveId(value.custom_role_id, 'agent.custom_role_id'),
    firstSeenAt: base.observedAt,
    lastSeenAt: base.observedAt,
    sourceUpdatedAt: optionalTimestampMs(value.updated_at, 'agent.updated_at'),
  }, [
    'agentKey', 'externalAgentId', 'role', 'availabilityStatus', 'autoOffline',
    'confirmed', 'customRoleId', 'sourceUpdatedAt',
  ]);
}

export async function normalizeChatwootTeam(value, context = {}) {
  requireObject(value, 'team');
  const base = baseContext(context);
  const externalTeamId = requirePositiveId(value.id, 'team.id');
  const externalAccountId = requirePositiveId(value.account_id ?? base.externalAccountId, 'team.account_id');
  assertExternalAccount(base.externalAccountId, externalAccountId, 'team');
  return freezeWithHash({
    ...base,
    teamKey: `chatwoot:${base.accountKey}:team:${externalTeamId}`,
    externalTeamId,
    allowAutoAssign: optionalBoolean(value.allow_auto_assign, 'team.allow_auto_assign'),
    firstSeenAt: base.observedAt,
    lastSeenAt: base.observedAt,
    sourceUpdatedAt: optionalTimestampMs(value.updated_at, 'team.updated_at'),
  }, ['teamKey', 'externalTeamId', 'allowAutoAssign', 'sourceUpdatedAt']);
}

export async function hashChatwootLabelTitle(value) {
  const normalized = normalizeLabelTitle(value);
  return fingerprint({ normalizedLabelTitle: normalized });
}

export async function normalizeChatwootLabel(value, context = {}) {
  requireObject(value, 'label');
  const base = baseContext(context);
  const externalLabelId = requirePositiveId(value.id, 'label.id');
  const titleHash = await hashChatwootLabelTitle(value.title);
  return freezeWithHash({
    ...base,
    labelKey: `chatwoot:${base.accountKey}:label:${externalLabelId}`,
    externalLabelId,
    titleHash,
    color: optionalColor(value.color),
    showOnSidebar: optionalBoolean(value.show_on_sidebar, 'label.show_on_sidebar'),
    firstSeenAt: base.observedAt,
    lastSeenAt: base.observedAt,
    sourceUpdatedAt: optionalTimestampMs(value.updated_at, 'label.updated_at'),
  }, ['labelKey', 'externalLabelId', 'titleHash', 'color', 'showOnSidebar', 'sourceUpdatedAt']);
}

export async function normalizeChatwootMessage(value, context = {}) {
  requireObject(value, 'message');
  const base = baseContext(context);
  const externalMessageId = requirePositiveId(value.id, 'message.id');
  const externalConversationId = requirePositiveId(
    value.conversation_id ?? context.externalConversationId,
    'message.conversation_id',
  );
  const externalInboxId = optionalPositiveId(value.inbox_id ?? context.externalInboxId, 'message.inbox_id');
  const externalAccountId = optionalPositiveId(value.account_id, 'message.account_id');
  if (externalAccountId) assertExternalAccount(base.externalAccountId, externalAccountId, 'message');
  const messageType = normalizeMessageType(value.message_type);
  const sourceCreatedAt = requireTimestampMs(value.created_at, 'message.created_at');
  return freezeWithHash({
    ...base,
    messageKey: `chatwoot:${base.accountKey}:message:${externalMessageId}`,
    conversationKey: `chatwoot:${base.accountKey}:conversation:${externalConversationId}`,
    externalMessageId,
    externalConversationId,
    externalInboxId,
    messageType,
    direction: messageType === 'incoming' || messageType === 'outgoing' ? messageType : 'system',
    contentType: optionalEnumText(value.content_type, 'message.content_type'),
    private: optionalBoolean(value.private, 'message.private') ?? false,
    senderType: normalizeSenderType(value.sender_type ?? value?.sender?.type),
    externalSenderId: optionalPositiveId(value.sender_id ?? value?.sender?.id, 'message.sender_id'),
    attachmentCount: readAttachmentCount(value),
    sourceCreatedAt,
    sourceUpdatedAt: optionalTimestampMs(value.updated_at, 'message.updated_at') ?? sourceCreatedAt,
  }, [
    'messageKey', 'conversationKey', 'externalMessageId', 'externalConversationId',
    'externalInboxId', 'messageType', 'direction', 'contentType', 'private',
    'senderType', 'externalSenderId', 'attachmentCount', 'sourceCreatedAt', 'sourceUpdatedAt',
  ]);
}

export async function normalizeChatwootReportingEvent(value, context = {}) {
  requireObject(value, 'reporting event');
  const base = baseContext(context);
  const externalReportingEventId = requirePositiveId(value.id, 'reporting_event.id');
  const name = requireSetValue(value.name, REPORTING_EVENT_NAMES, 'reporting_event.name');
  const externalAccountId = requirePositiveId(value.account_id ?? base.externalAccountId, 'reporting_event.account_id');
  assertExternalAccount(base.externalAccountId, externalAccountId, 'reporting event');
  return freezeWithHash({
    ...base,
    reportingEventKey: `chatwoot:${base.accountKey}:reporting_event:${externalReportingEventId}`,
    externalReportingEventId,
    name,
    valueSeconds: nonNegativeNumber(value.value, 'reporting_event.value'),
    valueBusinessSeconds: nullableNonNegativeNumber(
      value.value_in_business_hours,
      'reporting_event.value_in_business_hours',
    ),
    externalConversationId: optionalPositiveId(value.conversation_id, 'reporting_event.conversation_id'),
    externalInboxId: optionalPositiveId(value.inbox_id, 'reporting_event.inbox_id'),
    externalAgentId: optionalPositiveId(value.user_id, 'reporting_event.user_id'),
    eventStartAt: requireTimestampMs(value.event_start_time, 'reporting_event.event_start_time'),
    eventEndAt: requireTimestampMs(value.event_end_time, 'reporting_event.event_end_time'),
    sourceCreatedAt: requireTimestampMs(value.created_at, 'reporting_event.created_at'),
    sourceUpdatedAt: requireTimestampMs(value.updated_at, 'reporting_event.updated_at'),
  }, [
    'reportingEventKey', 'externalReportingEventId', 'name', 'valueSeconds',
    'valueBusinessSeconds', 'externalConversationId', 'externalInboxId', 'externalAgentId',
    'eventStartAt', 'eventEndAt', 'sourceCreatedAt', 'sourceUpdatedAt',
  ], 'sourcePayloadHash');
}

export async function normalizeChatwootConversation(value, context = {}) {
  requireObject(value, 'conversation');
  const base = baseContext(context);
  const externalConversationId = requirePositiveId(value.id, 'conversation.id');
  const externalAccountId = requirePositiveId(value.account_id ?? base.externalAccountId, 'conversation.account_id');
  assertExternalAccount(base.externalAccountId, externalAccountId, 'conversation');
  const status = requireSetValue(String(value.status ?? '').toLowerCase(), CONVERSATION_STATUSES, 'conversation.status');
  const sourceCreatedAt = requireTimestampMs(value.created_at, 'conversation.created_at');
  const sourceUpdatedAt = requireTimestampMs(value.updated_at, 'conversation.updated_at');
  const messages = Array.isArray(context.messages) ? context.messages : [];
  const reportingEvents = Array.isArray(context.reportingEvents) ? context.reportingEvents : [];
  const messageMetrics = summarizeMessages(messages);
  const eventMetrics = summarizeReportingEvents(reportingEvents);
  const previousStatus = optionalSetValue(context.previousStatus, CONVERSATION_STATUSES, 'previousStatus');
  const previousSourceUpdatedAt = optionalTimestampMs(context.previousSourceUpdatedAt, 'previousSourceUpdatedAt');
  const confirmedNewerRevision = previousSourceUpdatedAt === null || sourceUpdatedAt > previousSourceUpdatedAt;
  const reopened = previousStatus === 'resolved' && status !== 'resolved' && confirmedNewerRevision;

  const normalized = {
    ...base,
    conversationKey: `chatwoot:${base.accountKey}:conversation:${externalConversationId}`,
    externalConversationId,
    externalInboxId: requirePositiveId(value.inbox_id, 'conversation.inbox_id'),
    externalContactId: optionalPositiveId(value?.meta?.sender?.id ?? value?.contact_id, 'conversation.contact_id'),
    status,
    priority: optionalEnumText(value.priority, 'conversation.priority'),
    externalAssigneeId: optionalPositiveId(value?.meta?.assignee?.id, 'conversation.meta.assignee.id'),
    externalTeamId: optionalPositiveId(value?.meta?.team?.id, 'conversation.meta.team.id'),
    sourceCreatedAt,
    sourceUpdatedAt,
    lastActivityAt: optionalTimestampMs(value.last_activity_at, 'conversation.last_activity_at') ?? sourceUpdatedAt,
    waitingSince: optionalSentinelTimestampMs(value.waiting_since, 'conversation.waiting_since'),
    sourceAvailabilityStatus: normalizeConversationSourceStatus(context.sourceAvailabilityStatus),
    messageCount: messageMetrics.messageCount,
    incomingMessageCount: messageMetrics.incomingMessageCount,
    outgoingMessageCount: messageMetrics.outgoingMessageCount,
    privateMessageCount: messageMetrics.privateMessageCount,
    attachmentMessageCount: messageMetrics.attachmentMessageCount,
    reopenCountDelta: reopened ? 1 : 0,
    firstResponseSeconds: eventMetrics.firstResponseSeconds,
    firstResponseBusinessSeconds: eventMetrics.firstResponseBusinessSeconds,
    resolutionSeconds: eventMetrics.resolutionSeconds,
    resolutionBusinessSeconds: eventMetrics.resolutionBusinessSeconds,
    replySeconds: eventMetrics.replySeconds,
    replyBusinessSeconds: eventMetrics.replyBusinessSeconds,
    labelKeys: normalizeLabelKeys(context.labelIds ?? [], base.accountKey),
    firstSeenAt: base.observedAt,
    lastSeenAt: base.observedAt,
  };
  const metadataHash = await fingerprint(select(normalized, [
    'conversationKey', 'externalConversationId', 'externalInboxId', 'externalContactId',
    'status', 'priority', 'externalAssigneeId', 'externalTeamId', 'sourceCreatedAt',
    'sourceUpdatedAt', 'lastActivityAt', 'waitingSince', 'sourceAvailabilityStatus', 'labelKeys',
  ]));
  const metricsHash = await fingerprint(select(normalized, [
    'messageCount', 'incomingMessageCount', 'outgoingMessageCount', 'privateMessageCount',
    'attachmentMessageCount', 'reopenCountDelta', 'firstResponseSeconds',
    'firstResponseBusinessSeconds', 'resolutionSeconds', 'resolutionBusinessSeconds',
    'replySeconds', 'replyBusinessSeconds',
  ]));
  return Object.freeze({ ...normalized, metadataHash, metricsHash });
}

export function summarizeMessages(messages) {
  const summary = {
    messageCount: 0,
    incomingMessageCount: 0,
    outgoingMessageCount: 0,
    privateMessageCount: 0,
    attachmentMessageCount: 0,
  };
  for (const message of requireArray(messages, 'messages')) {
    requireObject(message, 'normalized message');
    summary.messageCount += 1;
    if (message.direction === 'incoming') summary.incomingMessageCount += 1;
    if (message.direction === 'outgoing') summary.outgoingMessageCount += 1;
    if (message.private === true) summary.privateMessageCount += 1;
    if (Number(message.attachmentCount ?? 0) > 0) summary.attachmentMessageCount += 1;
  }
  return Object.freeze(summary);
}

export function summarizeReportingEvents(events) {
  const metrics = {
    firstResponseSeconds: null,
    firstResponseBusinessSeconds: null,
    resolutionSeconds: null,
    resolutionBusinessSeconds: null,
    replySeconds: null,
    replyBusinessSeconds: null,
  };
  const sorted = [...requireArray(events, 'reportingEvents')].sort(
    (a, b) => Number(a.sourceUpdatedAt ?? 0) - Number(b.sourceUpdatedAt ?? 0),
  );
  for (const event of sorted) {
    if (event.name === 'first_response') {
      metrics.firstResponseSeconds = event.valueSeconds;
      metrics.firstResponseBusinessSeconds = event.valueBusinessSeconds;
    } else if (event.name === 'resolution') {
      metrics.resolutionSeconds = event.valueSeconds;
      metrics.resolutionBusinessSeconds = event.valueBusinessSeconds;
    } else if (event.name === 'reply_time') {
      metrics.replySeconds = event.valueSeconds;
      metrics.replyBusinessSeconds = event.valueBusinessSeconds;
    }
  }
  return Object.freeze(metrics);
}

async function freezeWithHash(value, fields, hashField = 'metadataHash') {
  const hash = await fingerprint(select(value, fields));
  return Object.freeze({ ...value, [hashField]: hash });
}

async function fingerprint(value) {
  return createStableFingerprint(value, {
    digestImpl: globalThis.crypto?.subtle?.digest?.bind(globalThis.crypto.subtle),
  });
}

function baseContext(context) {
  return Object.freeze({
    source: 'chatwoot_application_api',
    customerKey: requireIdentity(context.customerKey, 'customerKey'),
    accountKey: requireIdentity(context.accountKey, 'accountKey'),
    externalAccountId: requirePositiveId(context.externalAccountId, 'externalAccountId'),
    observedAt: requireTimestampMs(context.observedAt, 'observedAt'),
  });
}

function select(value, fields) {
  return Object.fromEntries(fields.map((field) => [field, value[field]]));
}

function normalizeLabelKeys(values, accountKey) {
  const keys = new Set();
  for (const value of requireArray(values, 'labelIds')) {
    const id = requirePositiveId(value, 'labelId');
    keys.add(`chatwoot:${accountKey}:label:${id}`);
  }
  return Object.freeze([...keys].sort());
}

function normalizeMessageType(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase() : value;
  const normalized = MESSAGE_TYPES[key];
  if (!normalized) {
    throw permanentError(`Unsupported Chatwoot message type: ${String(value)}`, {
      code: 'CHATWOOT_MESSAGE_TYPE_UNSUPPORTED',
    });
  }
  return normalized;
}

function normalizeSenderType(value) {
  const text = optionalEnumText(value, 'message.sender_type');
  if (!text) return null;
  const normalized = text.toLowerCase();
  if (normalized.includes('contact')) return 'contact';
  if (normalized.includes('user') || normalized.includes('agent')) return 'agent';
  if (normalized.includes('bot')) return 'bot';
  return 'system';
}

function readAttachmentCount(value) {
  if (Array.isArray(value.attachments)) return value.attachments.length;
  if (Array.isArray(value.attachment)) return value.attachment.length;
  if (value.attachment && typeof value.attachment === 'object') return 1;
  return 0;
}

function normalizeAvailability(value, allowed, fallback) {
  const text = optionalText(value)?.toLowerCase();
  if (!text) return fallback;
  return allowed.has(text) ? text : fallback;
}

function normalizeContactSourceStatus(value) {
  const text = optionalText(value)?.toLowerCase() ?? 'resolved_list_observed';
  if (!['resolved_list_observed', 'merged', 'deleted', 'unknown'].includes(text)) {
    throw new TypeError('sourceAvailabilityStatus is invalid');
  }
  return text;
}

function normalizeConversationSourceStatus(value) {
  const text = optionalText(value)?.toLowerCase() ?? 'available';
  if (!['available', 'deleted', 'unknown'].includes(text)) {
    throw new TypeError('conversation sourceAvailabilityStatus is invalid');
  }
  return text;
}

function assertExternalAccount(expected, actual, scope) {
  if (expected !== actual) {
    throw permanentError(`Chatwoot ${scope} account identity mismatch`, {
      code: 'CHATWOOT_ACCOUNT_IDENTITY_MISMATCH',
    });
  }
}

function requireIdentity(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.includes(':')) throw new TypeError(`${fieldName} must not contain ":"`);
  return text;
}

function normalizeLabelTitle(value) {
  const text = requireText(value, 'label.title').normalize('NFKC').trim().toLowerCase();
  if (text.length > 100) throw new TypeError('label.title must not exceed 100 characters');
  return text;
}

function optionalColor(value) {
  const text = optionalText(value);
  if (!text) return null;
  if (!/^#[0-9a-f]{6}$/iu.test(text)) throw new TypeError('label.color must be a six-digit hex color');
  return text.toLowerCase();
}

function optionalSetValue(value, allowed, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requireSetValue(String(value).toLowerCase(), allowed, fieldName);
}

function requireSetValue(value, allowed, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!allowed.has(text)) throw new TypeError(`${fieldName} is unsupported: ${text}`);
  return text;
}

function optionalEnumText(value, fieldName) {
  const text = optionalText(value);
  if (text === null) return null;
  if (!/^[a-z0-9_.:/+-]{1,100}$/iu.test(text)) {
    throw new TypeError(`${fieldName} contains unsupported characters`);
  }
  return text.toLowerCase();
}

function requirePositiveId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
  return String(number);
}

function optionalPositiveId(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requirePositiveId(value, fieldName);
}

function requireTimestampMs(value, fieldName) {
  const result = optionalTimestampMs(value, fieldName);
  if (result === null) throw new TypeError(`${fieldName} is required`);
  return result;
}

function optionalTimestampMs(value, fieldName) {
  return toEpochMilliseconds(value, { allowNull: true, label: fieldName });
}

function optionalSentinelTimestampMs(value, fieldName) {
  try {
    return optionalTimestampMs(value, fieldName);
  } catch (cause) {
    // Chatwoot may expose zero/out-of-range sentinels for an optional waiting timestamp.
    if (cause instanceof RangeError) return null;
    throw cause;
  }
}

function optionalBoolean(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (value !== true && value !== false) throw new TypeError(`${fieldName} must be boolean`);
  return value;
}

function nonNegativeNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative number`);
  }
  return number;
}

function nullableNonNegativeNumber(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return nonNegativeNumber(value, fieldName);
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string') throw new TypeError('optional text value must be a string');
  return value.trim() || null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} must be a non-empty string`);
  }
  return value.trim();
}

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
