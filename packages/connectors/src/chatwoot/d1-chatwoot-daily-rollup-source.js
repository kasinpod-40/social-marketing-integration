import { transientError } from '../../../shared/src/errors/runtime-error.js';
import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';

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
    const reportingTimezone = requireText(input.reportingTimezone, 'reportingTimezone');
    const afterKey = optionalText(input.afterKey);
    const limit = boundedInteger(input.limit ?? this.pageSize, 'limit', 1, 500);
    const periodStart = dateOnlyInTimeZoneToEpochMilliseconds(metricDate, reportingTimezone, {
      label: 'metricDate',
    });
    const periodEnd = nextLocalDateStart(metricDate, reportingTimezone);
    try {
      const result = await this.db.prepare(`
        WITH reporting AS (
          SELECT
            external_conversation_id,
            MAX(customer_key) AS customer_key,
            MAX(account_key) AS account_key,
            MAX(external_account_id) AS external_account_id,
            MAX(external_inbox_id) AS external_inbox_id,
            MAX(external_agent_id) AS external_agent_id,
            MAX(source_updated_at) AS source_updated_at,
            MAX(coverage_run_id) AS coverage_run_id,
            SUM(CASE WHEN event_name = 'first_response' AND value_seconds IS NOT NULL
              THEN value_seconds ELSE 0 END) AS first_response_sum,
            SUM(CASE WHEN event_name = 'first_response' AND value_seconds IS NOT NULL
              THEN 1 ELSE 0 END) AS first_response_count,
            SUM(CASE WHEN event_name = 'first_response' AND value_business_seconds IS NOT NULL
              THEN value_business_seconds ELSE 0 END) AS first_response_business_sum,
            SUM(CASE WHEN event_name = 'first_response' AND value_business_seconds IS NOT NULL
              THEN 1 ELSE 0 END) AS first_response_business_count,
            MAX(CASE WHEN event_name IN ('resolution', 'conversation_resolved')
              THEN 1 ELSE 0 END) AS resolved_count,
            SUM(CASE WHEN event_name IN ('resolution', 'conversation_resolved')
                AND value_seconds IS NOT NULL THEN value_seconds ELSE 0 END) AS resolution_sum,
            SUM(CASE WHEN event_name IN ('resolution', 'conversation_resolved')
                AND value_seconds IS NOT NULL THEN 1 ELSE 0 END) AS resolution_count,
            SUM(CASE WHEN event_name IN ('resolution', 'conversation_resolved')
                AND value_business_seconds IS NOT NULL THEN value_business_seconds ELSE 0 END)
              AS resolution_business_sum,
            SUM(CASE WHEN event_name IN ('resolution', 'conversation_resolved')
                AND value_business_seconds IS NOT NULL THEN 1 ELSE 0 END)
              AS resolution_business_count,
            SUM(CASE WHEN event_name = 'reply_time' AND value_seconds IS NOT NULL
              THEN value_seconds ELSE 0 END) AS reply_sum,
            SUM(CASE WHEN event_name = 'reply_time' AND value_seconds IS NOT NULL
              THEN 1 ELSE 0 END) AS reply_count,
            SUM(CASE WHEN event_name = 'reply_time' AND value_business_seconds IS NOT NULL
              THEN value_business_seconds ELSE 0 END) AS reply_business_sum,
            SUM(CASE WHEN event_name = 'reply_time' AND value_business_seconds IS NOT NULL
              THEN 1 ELSE 0 END) AS reply_business_count
          FROM chatwoot_reporting_event_facts
          WHERE account_key = ?
            AND event_end_at >= ? AND event_end_at < ?
            AND external_conversation_id IS NOT NULL
            AND event_name IN ('first_response', 'resolution', 'conversation_resolved', 'reply_time')
          GROUP BY external_conversation_id
        ), keys AS (
          SELECT conversation_daily_key, external_conversation_id
          FROM chatwoot_conversation_daily_facts
          WHERE account_key = ? AND metric_date = ?
          UNION
          SELECT
            'chatwoot:' || ? || ':conversation:' || external_conversation_id || ':' || ?,
            external_conversation_id
          FROM reporting
        )
        SELECT
          keys.conversation_daily_key,
          COALESCE(d.customer_key, r.customer_key, s.customer_key) AS customer_key,
          COALESCE(d.account_key, r.account_key, s.account_key) AS account_key,
          COALESCE(d.external_account_id, r.external_account_id, s.external_account_id)
            AS external_account_id,
          keys.external_conversation_id,
          COALESCE(r.external_inbox_id, d.external_inbox_id, s.external_inbox_id)
            AS external_inbox_id,
          COALESCE(r.external_agent_id, d.external_agent_id, s.external_assignee_id)
            AS external_agent_id,
          COALESCE(d.external_team_id, s.external_team_id) AS external_team_id,
          ? AS metric_date,
          COALESCE(d.reporting_timezone, ?) AS reporting_timezone,
          d.status,
          COALESCE(d.new_conversation_count, 0) AS new_conversation_count,
          COALESCE(r.resolved_count, 0) AS resolved_count,
          COALESCE(d.reopened_count, 0) AS reopened_count,
          COALESCE(d.incoming_message_count, 0) AS incoming_message_count,
          COALESCE(d.outgoing_message_count, 0) AS outgoing_message_count,
          COALESCE(d.private_message_count, 0) AS private_message_count,
          COALESCE(d.attachment_message_count, 0) AS attachment_message_count,
          COALESCE(r.first_response_sum, 0) AS first_response_sum,
          COALESCE(r.first_response_count, 0) AS first_response_count,
          COALESCE(r.first_response_business_sum, 0) AS first_response_business_sum,
          COALESCE(r.first_response_business_count, 0) AS first_response_business_count,
          COALESCE(r.resolution_sum, 0) AS resolution_sum,
          COALESCE(r.resolution_count, 0) AS resolution_count,
          COALESCE(r.resolution_business_sum, 0) AS resolution_business_sum,
          COALESCE(r.resolution_business_count, 0) AS resolution_business_count,
          COALESCE(r.reply_sum, 0) AS reply_sum,
          COALESCE(r.reply_count, 0) AS reply_count,
          COALESCE(r.reply_business_sum, 0) AS reply_business_sum,
          COALESCE(r.reply_business_count, 0) AS reply_business_count,
          COALESCE(d.coverage_run_id, r.coverage_run_id) AS coverage_run_id,
          d.created_at AS created_at,
          CAST(MAX(COALESCE(CAST(d.source_revision AS INTEGER), 0),
              COALESCE(r.source_updated_at, 0), COALESCE(s.source_updated_at, 0)) AS TEXT)
            AS source_revision
        FROM keys
        LEFT JOIN chatwoot_conversation_daily_facts d
          ON d.conversation_daily_key = keys.conversation_daily_key
        LEFT JOIN reporting r
          ON r.external_conversation_id = keys.external_conversation_id
        LEFT JOIN chatwoot_conversation_state s
          ON s.account_key = ? AND s.external_conversation_id = keys.external_conversation_id
        WHERE (? IS NULL OR keys.conversation_daily_key > ?)
        ORDER BY keys.conversation_daily_key ASC
        LIMIT ?
      `).bind(
        accountKey,
        periodStart,
        periodEnd,
        accountKey,
        metricDate,
        accountKey,
        metricDate,
        metricDate,
        reportingTimezone,
        accountKey,
        afterKey,
        afterKey,
        limit,
      ).all();
      const rows = readRows(result).map((row) => Object.freeze({
        conversationDailyKey: requireText(row.conversation_daily_key, 'conversation_daily_key'),
        customerKey: requireText(row.customer_key, 'customer_key'),
        accountKey: requireText(row.account_key, 'account_key'),
        externalAccountId: positiveInteger(row.external_account_id, 'external_account_id'),
        externalConversationId: positiveInteger(row.external_conversation_id, 'external_conversation_id'),
        externalInboxId: nullablePositiveInteger(row.external_inbox_id, 'external_inbox_id'),
        externalAgentId: nullablePositiveInteger(row.external_agent_id, 'external_agent_id'),
        externalTeamId: nullablePositiveInteger(row.external_team_id, 'external_team_id'),
        metricDate: requireDate(row.metric_date, 'metric_date'),
        reportingTimezone: requireText(row.reporting_timezone, 'reporting_timezone'),
        status: optionalText(row.status),
        newConversationCount: nonNegativeInteger(row.new_conversation_count, 'new_conversation_count'),
        resolvedCount: nonNegativeInteger(row.resolved_count, 'resolved_count'),
        reopenedCount: nonNegativeInteger(row.reopened_count, 'reopened_count'),
        incomingMessageCount: nonNegativeInteger(row.incoming_message_count, 'incoming_message_count'),
        outgoingMessageCount: nonNegativeInteger(row.outgoing_message_count, 'outgoing_message_count'),
        privateMessageCount: nonNegativeInteger(row.private_message_count, 'private_message_count'),
        attachmentMessageCount: nonNegativeInteger(
          row.attachment_message_count,
          'attachment_message_count',
        ),
        firstResponse: accumulator(row, 'first_response'),
        firstResponseBusiness: accumulator(row, 'first_response_business'),
        resolution: accumulator(row, 'resolution'),
        resolutionBusiness: accumulator(row, 'resolution_business'),
        reply: accumulator(row, 'reply'),
        replyBusiness: accumulator(row, 'reply_business'),
        coverageRunId: optionalText(row.coverage_run_id),
        createdAt: nullablePositiveInteger(row.created_at, 'created_at'),
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

function nextLocalDateStart(metricDate, timeZone) {
  const date = new Date(`${metricDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return dateOnlyInTimeZoneToEpochMilliseconds(date.toISOString().slice(0, 10), timeZone, {
    label: 'metricDate end',
  });
}

function accumulator(row, prefix) {
  const sum = finiteNumber(row[`${prefix}_sum`], `${prefix}_sum`);
  const count = nonNegativeInteger(row[`${prefix}_count`], `${prefix}_count`);
  return Object.freeze({ sum, count });
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
function finiteNumber(value, fieldName) {
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${fieldName} must be numeric`);
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
