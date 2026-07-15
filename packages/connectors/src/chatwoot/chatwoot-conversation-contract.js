const STATUSES = new Set(['open', 'resolved', 'pending', 'snoozed']);

/** Validate Chatwoot Application API conversation โดยไม่เก็บข้อความหรือข้อมูล Contact PII */
export function mapChatwootConversationContract(conversation, input = {}) {
  requireObject(conversation, 'Chatwoot conversation');
  const accountKey = requireIdentityText(input.accountKey, 'accountKey');
  const conversationId = readSafeId(conversation.id, 'conversation.id');
  const accountId = readSafeId(conversation.account_id, 'conversation.account_id');
  const status = requireText(conversation.status, 'conversation.status').toLowerCase();
  if (!STATUSES.has(status)) throw new TypeError(`Unsupported Chatwoot conversation status: ${status}`);

  return Object.freeze({
    source: 'chatwoot_application_api',
    accountKey,
    externalAccountId: accountId,
    externalConversationId: conversationId,
    conversationKey: `chatwoot:${accountKey}:${conversationId}`,
    inboxId: readSafeId(conversation.inbox_id, 'conversation.inbox_id'),
    status,
    createdAt: readEpochSeconds(conversation.created_at, 'conversation.created_at'),
    updatedAt: readEpochSeconds(conversation.updated_at, 'conversation.updated_at'),
    assigneeId: readNullableSafeId(conversation?.meta?.assignee?.id, 'conversation.meta.assignee.id'),
    teamId: readNullableSafeId(conversation?.meta?.team?.id, 'conversation.meta.team.id'),
    messageCount: Array.isArray(conversation.messages) ? conversation.messages.length : null,
  });
}

function readSafeId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive safe integer`);
  return String(number);
}

function readNullableSafeId(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return readSafeId(value, fieldName);
}

function readEpochSeconds(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be positive epoch seconds`);
  return number * 1000;
}

function requireIdentityText(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.includes(':')) throw new TypeError(`${fieldName} must not contain ":"`);
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`Chatwoot contract requires ${fieldName}`);
  return value.trim();
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}
