import { transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_PAGE_SIZE = 500;

/** Read-only bounded source over Migration 0018 Conversation Daily facts. */
export class D1ChatwootDailyRollupSource {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.pageSize = boundedInteger(input.pageSize ?? DEFAULT_PAGE_SIZE, 'pageSize', 1, 500);
  }

  async listConversationDailyPage(input = {}) {
    const accountKey = requireText(input.accountKey, 'accountKey');
    const metricDate = requireDate(input.metricDate, 'metricDate');
    const afterKey = optionalText(input.afterKey);
    const limit = boundedInteger(input.limit ?? this.pageSize, 'limit', 1, 500);
    try {
      const result = await this.db.prepare(`
        SELECT
          conversation_daily_key, customer_key, account_key, external_account_id,
          external_conversation_id, external_inbox_id, external_agent_id, metric_date,
          new_conversation_count, resolved_count, reopened_count,
          incoming_message_count, outgoing_message_count,
          first_response_seconds, resolution_seconds, reply_seconds, source_revision
        FROM chatwoot_conversation_daily_facts
        WHERE account_key = ? AND metric_date = ?
          AND (? IS NULL OR conversation_daily_key > ?)
        ORDER BY conversation_daily_key ASC
        LIMIT ?
      `).bind(accountKey, metricDate, afterKey, afterKey, limit).all();
      const rows = readRows(result).map((row) => Object.freeze({
        conversationDailyKey: requireText(row.conversation_daily_key, 'conversation_daily_key'),
        customerKey: requireText(row.customer_key, 'customer_key'),
        accountKey: requireText(row.account_key, 'account_key'),
        externalAccountId: positiveInteger(row.external_account_id, 'external_account_id'),
        externalConversationId: positiveInteger(row.external_conversation_id, 'external_conversation_id'),
        externalInboxId: nullablePositiveInteger(row.external_inbox_id, 'external_inbox_id'),
        externalAgentId: nullablePositiveInteger(row.external_agent_id, 'external_agent_id'),
        metricDate: requireDate(row.metric_date, 'metric_date'),
        newConversationCount: nonNegativeInteger(row.new_conversation_count, 'new_conversation_count'),
        resolvedCount: nonNegativeInteger(row.resolved_count, 'resolved_count'),
        reopenedCount: nonNegativeInteger(row.reopened_count, 'reopened_count'),
        incomingMessageCount: nonNegativeInteger(row.incoming_message_count, 'incoming_message_count'),
        outgoingMessageCount: nonNegativeInteger(row.outgoing_message_count, 'outgoing_message_count'),
        firstResponseSeconds: nullableNumber(row.first_response_seconds, 'first_response_seconds'),
        resolutionSeconds: nullableNumber(row.resolution_seconds, 'resolution_seconds'),
        replySeconds: nullableNumber(row.reply_seconds, 'reply_seconds'),
        sourceRevision: requireText(row.source_revision, 'source_revision'),
      }));
      return Object.freeze({
        rows: Object.freeze(rows),
        nextAfterKey: rows.length === limit ? rows.at(-1).conversationDailyKey : null,
        complete: rows.length < limit,
      });
    } catch (cause) {
      if (cause?.code) throw cause;
      throw transientError('Failed to read bounded Chatwoot daily rollup page', {
        code: 'CHATWOOT_DAILY_ROLLUP_READ_FAILED',
        cause,
      });
    }
  }
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') throw new TypeError('D1 database binding is required');
  return value;
}
function readRows(result) {
  return Array.isArray(result?.results) ? result.results : [];
}
function boundedInteger(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new TypeError(`${fieldName} must be an integer from ${min} to ${max}`);
  }
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
function nullablePositiveInteger(value, fieldName) {
  if (value === null || value === undefined) return null;
  return positiveInteger(value, fieldName);
}
function nullableNumber(value, fieldName) {
  if (value === null || value === undefined) return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${fieldName} must be numeric or null`);
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
