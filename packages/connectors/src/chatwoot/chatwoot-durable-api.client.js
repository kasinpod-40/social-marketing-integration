import { ChatwootApiClient } from './chatwoot-api.client.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_MAX_REPORTING_PAGES = 5_000;

/**
 * Extends the reviewed GET-only transport only where Account Reporting Events exceed the generic
 * 1,000-page client bound. The transport, retry and secret handling remain in ChatwootApiClient.
 */
export class ChatwootDurableApiClient extends ChatwootApiClient {
  constructor(config = {}) {
    super(config);
    this.maxReportingPages = boundedInteger(
      config.maxReportingPages ?? DEFAULT_MAX_REPORTING_PAGES,
      'maxReportingPages',
      1,
      10_000,
    );
  }

  async listAccountReportingEventsPage(input = {}) {
    const page = boundedInteger(input.page ?? 1, 'page', 1, this.maxReportingPages);
    const payload = await this.get(`api/v1/accounts/${this.accountId}/reporting_events`, {
      page,
      ...(input.since !== null && input.since !== undefined
        ? { since: timestampSeconds(input.since, 'since') }
        : {}),
      ...(input.until !== null && input.until !== undefined
        ? { until: timestampSeconds(input.until, 'until') }
        : {}),
      ...(input.inboxId ? { inbox_id: positiveId(input.inboxId, 'inboxId') } : {}),
      ...(input.userId ? { user_id: positiveId(input.userId, 'userId') } : {}),
      ...(input.name ? { name: requireText(input.name, 'name') } : {}),
    }, { operationName: 'list_reporting_events' });
    const rows = requireArray(payload?.payload, 'list_reporting_events.payload');
    const totalPages = nullablePositiveInteger(
      payload?.meta?.total_pages,
      'list_reporting_events.meta.total_pages',
    );
    const currentPage = nullablePositiveInteger(
      payload?.meta?.current_page,
      'list_reporting_events.meta.current_page',
    );
    const totalCount = nullableNonNegativeInteger(
      payload?.meta?.count,
      'list_reporting_events.meta.count',
    );
    if (currentPage !== null && currentPage !== page) {
      throw pageContractError('mismatched current page', { page, currentPage });
    }
    if (totalPages !== null && totalPages > this.maxReportingPages) {
      throw permanentError('Chatwoot reporting events exceed the durable configured page bound', {
        code: 'CHATWOOT_REPORTING_PAGE_LIMIT',
        details: { totalPages, maxReportingPages: this.maxReportingPages },
      });
    }
    if (totalPages !== null && page > totalPages) {
      throw pageContractError('page exceeds declared total', { page, totalPages });
    }
    return Object.freeze({
      page,
      rows: Object.freeze(rows.map((row) => Object.freeze({ ...row }))),
      totalCount,
      totalPages,
      hasMore: totalPages === null ? rows.length > 0 : page < totalPages,
    });
  }
}

function pageContractError(message, details) {
  return permanentError(`Chatwoot reporting events returned ${message}`, {
    code: 'CHATWOOT_PAGE_CONTRACT_INVALID',
    details: { operation: 'list_reporting_events', ...details },
  });
}

function timestampSeconds(value, fieldName) {
  const source = value instanceof Date ? value.getTime() : Number(value);
  if (!Number.isFinite(source) || source <= 0) {
    throw new TypeError(`${fieldName} must be a positive timestamp`);
  }
  return Math.floor(source > 100_000_000_000 ? source / 1_000 : source);
}

function positiveId(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new TypeError(`${fieldName} must be a positive safe integer`);
  }
  return String(number);
}

function boundedInteger(value, fieldName, min, max) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) {
    throw new TypeError(`${fieldName} must be an integer from ${min} to ${max}`);
  }
  return number;
}

function nullablePositiveInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return boundedInteger(value, fieldName, 1, Number.MAX_SAFE_INTEGER);
}

function nullableNonNegativeInteger(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative integer`);
  }
  return number;
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
