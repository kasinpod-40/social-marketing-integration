import { dateOnlyInTimeZoneToEpochMilliseconds } from '../../../shared/src/date/date-time.js';
import {
  createAccountDailyKey,
  validateStorageRow,
} from '../storage/marketing-history-contract.js';

/** Project an exact D1 Organic account fact to the shared Lark Account×Date contract. */
export function projectOrganicAccountDailyFactToLark(input = {}) {
  const fact = validateStorageRow('organic_account_daily_facts', input.fact);
  const canonicalAccountKey = requireText(input.canonicalAccountKey, 'canonicalAccountKey');
  return Object.freeze(compact({
    account_daily_key: `${canonicalAccountKey}:${fact.metric_date}`,
    metric_date: dateOnlyInTimeZoneToEpochMilliseconds(
      fact.metric_date,
      fact.account_timezone,
      { label: 'Organic account daily metric_date' },
    ),
    platform: fact.platform,
    account_key: canonicalAccountKey,
    account_id: fact.source_account_id ?? fact.account_key,
    followers: fact.followers,
    follows: fact.follows,
    profile_views: fact.profile_views,
    views: fact.views,
    reach: fact.reach,
    accounts_engaged: fact.accounts_engaged,
    total_interactions: fact.total_interactions,
    net_follows: fact.net_follows,
    fetched_at: fact.fetched_at,
    sync_run_id: fact.sync_run_id,
  }));
}

/** Build one TikTok portfolio snapshot from the full exact D1 current-state partition. */
export function buildTikTokPortfolioAccountDailyFact(input = {}) {
  const aggregate = requireAggregate(input.aggregate);
  const rowCount = readCount(aggregate.row_count, 'row_count');
  const viewsPresent = readCount(aggregate.views_present, 'views_present');
  const interactionsPresent = readCount(
    aggregate.interactions_present,
    'interactions_present',
  );
  const accountKey = requireText(input.accountKey, 'accountKey');
  const metricDate = requireText(input.metricDate, 'metricDate');
  const observedAt = readTimestamp(input.observedAt, 'observedAt');

  return validateStorageRow('organic_account_daily_facts', {
    account_daily_key: createAccountDailyKey({
      platform: 'tiktok',
      account_key: accountKey,
      metric_date: metricDate,
    }),
    customer_key: requireText(input.customerKey, 'customerKey'),
    platform: 'tiktok',
    account_key: accountKey,
    source_account_id: input.sourceAccountId ?? accountKey,
    metric_date: metricDate,
    account_timezone: requireText(input.sourceTimezone, 'sourceTimezone'),
    followers: null,
    follows: null,
    profile_views: null,
    views: rowCount > 0 && viewsPresent === rowCount
      ? readMetric(aggregate.views_total, 'views_total')
      : null,
    reach: null,
    accounts_engaged: null,
    total_interactions: rowCount > 0 && interactionsPresent === rowCount
      ? readMetric(aggregate.interactions_total, 'interactions_total')
      : null,
    net_follows: null,
    data_status: rowCount === 0
      ? 'no_data_confirmed'
      : viewsPresent === rowCount && interactionsPresent === rowCount
        ? 'complete'
        : 'partial',
    coverage_run_id: requireText(input.coverageRunId, 'coverageRunId'),
    source_revision: requireText(input.sourceRevision, 'sourceRevision'),
    fetched_at: readTimestamp(input.fetchedAt, 'fetchedAt'),
    sync_run_id: requireText(input.syncRunId, 'syncRunId'),
    created_at: observedAt,
    updated_at: observedAt,
  });
}

function requireAggregate(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('TikTok account daily aggregate is required');
  }
  return value;
}

function readCount(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  }
  return number;
}

function readMetric(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe integer`);
  }
  return number;
}

function readTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw new TypeError(`${fieldName} must be a non-negative safe timestamp`);
  }
  return number;
}

function compact(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined),
  );
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${fieldName} is required`);
  }
  return value.trim();
}
