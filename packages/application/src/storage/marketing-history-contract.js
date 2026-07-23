import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

export const STORAGE_DATA_STATUSES = Object.freeze([
  'complete',
  'partial',
  'no_data_confirmed',
  'source_unavailable',
  'not_observed',
  'revisable',
]);

export const COVERAGE_SCOPE_MODES = Object.freeze([
  'full_inventory',
  'recent_window',
  'exact_entities',
  'report_range',
]);

export const METRIC_SEMANTICS = Object.freeze(['cumulative', 'period', 'snapshot']);
export const OBSERVATION_KINDS = Object.freeze(['initial', 'changed', 'checkpoint', 'correction', 'backfill']);
export const COVERAGE_ENTITY_STATUSES = Object.freeze(['observed', 'missing', 'failed', 'not_observed']);
export const REPORT_REQUEST_STATUSES = Object.freeze([
  'pending',
  'processing',
  'completed',
  'failed_retryable',
  'failed_permanent',
  'cancelled',
]);
export const REPORT_COMPARISON_MODES = Object.freeze(['none', 'previous_period', 'previous_year', 'custom']);

export const STORAGE_JSON_LIMITS = Object.freeze({
  reportPayloadBytes: 262_144,
  actionsBytes: 65_536,
  breakdownBytes: 65_536,
});

const SOURCE_AVAILABILITY = Object.freeze(['available', 'missing', 'private', 'deleted', 'expired', 'unknown']);
const ADS_SOURCE_AVAILABILITY = Object.freeze(['available', 'missing', 'deleted', 'unknown']);

const TABLE_FIELDS = Object.freeze({
  organic_content_state: Object.freeze([
    'content_key', 'customer_profile', 'customer_key', 'platform', 'account_key',
    'source_account_id', 'external_content_id', 'content_type', 'published_at',
    'first_seen_at', 'last_observed_at', 'last_changed_at', 'source_availability_status',
    'views', 'likes', 'comments', 'shares', 'unique_viewers',
    'avg_watch_time_seconds', 'total_watch_time_seconds', 'completion_rate',
    'metrics_hash', 'metadata_hash', 'last_coverage_run_id', 'last_sync_run_id',
    'created_at', 'updated_at',
  ]),
  organic_content_observations: Object.freeze([
    'observation_key', 'content_key', 'customer_key', 'platform', 'account_key',
    'external_content_id', 'observed_at', 'metric_date', 'source_timezone',
    'observation_kind', 'metric_semantics', 'views', 'likes', 'comments', 'shares',
    'unique_viewers', 'avg_watch_time_seconds', 'total_watch_time_seconds',
    'completion_rate', 'metrics_hash', 'source_revision', 'coverage_run_id',
    'fetched_at', 'sync_run_id', 'created_at',
  ]),
  organic_account_daily_facts: Object.freeze([
    'account_daily_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
    'metric_date', 'account_timezone', 'followers', 'follows', 'profile_views', 'views',
    'reach', 'accounts_engaged', 'total_interactions', 'net_follows', 'data_status',
    'coverage_run_id', 'source_revision', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
  ]),
  ads_entity_state: Object.freeze([
    'entity_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
    'entity_type', 'external_entity_id', 'parent_campaign_id', 'parent_ad_group_id',
    'parent_ad_id', 'external_creative_id', 'entity_name', 'status', 'objective',
    'currency', 'timezone', 'source_updated_at', 'first_seen_at', 'last_seen_at',
    'source_availability_status', 'metadata_hash', 'last_coverage_run_id',
    'last_sync_run_id', 'created_at', 'updated_at',
  ]),
  ads_daily_facts: Object.freeze([
    'ads_fact_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
    'report_level', 'entity_type', 'external_entity_id', 'external_campaign_id',
    'external_ad_group_id', 'external_ad_id', 'external_creative_id', 'metric_date',
    'account_timezone', 'breakdown_key', 'segment_key', 'ad_channel', 'currency',
    'spend_micros', 'impressions', 'reach', 'clicks', 'conversions',
    'conversion_value_micros', 'video_views', 'video_view_rate', 'average_cpv_micros',
    'actions_json', 'breakdown_json', 'data_status', 'coverage_run_id', 'source_revision',
    'source_payload_hash', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
  ]),
  ads_conversion_daily_facts: Object.freeze([
    'conversion_fact_key', 'customer_key', 'platform', 'account_key', 'source_account_id',
    'report_level', 'external_entity_id', 'external_campaign_id', 'external_ad_group_id',
    'external_ad_id', 'metric_date', 'account_timezone', 'conversion_action_key',
    'conversion_action_name', 'conversion_category', 'segment_key', 'currency',
    'conversions', 'all_conversions', 'conversion_value_micros',
    'all_conversion_value_micros', 'data_status', 'coverage_run_id', 'source_revision',
    'source_payload_hash', 'fetched_at', 'sync_run_id', 'created_at', 'updated_at',
  ]),
  data_coverage_runs: Object.freeze([
    'coverage_run_id', 'sync_run_id', 'customer_key', 'platform', 'account_key',
    'dataset_key', 'metric_semantics', 'scope_mode', 'period_start', 'period_end',
    'source_timezone', 'status', 'expected_entities', 'observed_entities',
    'expected_rows', 'observed_rows', 'written_rows', 'failed_rows', 'source_watermark',
    'revisable_until', 'started_at', 'completed_at', 'error_code', 'created_at', 'updated_at',
  ]),
  data_coverage_entities: Object.freeze([
    'coverage_entity_key', 'coverage_run_id', 'entity_type', 'external_entity_id',
    'observation_status', 'source_revision', 'observed_at', 'created_at',
  ]),
  report_materializations: Object.freeze([
    'report_id', 'report_setting_key', 'customer_key', 'platform_scope', 'account_key',
    'report_type', 'period_kind', 'window_days', 'period_start', 'period_end',
    'compare_start', 'compare_end', 'data_status', 'coverage_rate', 'formula_version',
    'source_watermark', 'payload_json', 'payload_checksum', 'generated_at', 'expires_at',
    'created_at', 'updated_at',
  ]),
  report_requests: Object.freeze([
    'request_id', 'customer_key', 'account_key', 'platform_scope', 'period_start',
    'period_end', 'comparison_mode', 'status', 'result_report_id', 'requested_at',
    'started_at', 'finished_at', 'error_code', 'created_at', 'updated_at',
  ]),
});

export function createContentKey(input = {}) {
  return [
    requiredText(input.platform, 'platform'),
    requiredText(input.account_key, 'account_key'),
    requiredText(input.external_content_id, 'external_content_id'),
  ].join(':');
}

export function createObservationKey(input = {}) {
  return [
    requiredText(input.content_key, 'content_key'),
    requiredInteger(input.observed_at, 'observed_at'),
    requiredChoice(input.observation_kind, 'observation_kind', OBSERVATION_KINDS),
    'v1',
  ].join(':');
}

export function createAccountDailyKey(input = {}) {
  return [
    requiredText(input.platform, 'platform'),
    requiredText(input.account_key, 'account_key'),
    requiredDate(input.metric_date, 'metric_date'),
  ].join(':');
}

export function createAdsEntityKey(input = {}) {
  return [
    requiredText(input.platform, 'platform'),
    requiredText(input.account_key, 'account_key'),
    requiredText(input.entity_type, 'entity_type'),
    requiredText(input.external_entity_id, 'external_entity_id'),
  ].join(':');
}

export function createAdsFactKey(input = {}) {
  return [
    requiredText(input.platform, 'platform'),
    requiredText(input.account_key, 'account_key'),
    requiredText(input.report_level, 'report_level'),
    requiredText(input.external_entity_id, 'external_entity_id'),
    requiredDate(input.metric_date, 'metric_date'),
    requiredIdentityPart(input.breakdown_key, 'breakdown_key'),
    requiredIdentityPart(input.segment_key, 'segment_key'),
  ].join(':');
}

export function createConversionFactKey(input = {}) {
  return [
    requiredText(input.platform, 'platform'),
    requiredText(input.account_key, 'account_key'),
    requiredText(input.report_level, 'report_level'),
    requiredText(input.external_entity_id, 'external_entity_id'),
    requiredDate(input.metric_date, 'metric_date'),
    requiredText(input.conversion_action_key, 'conversion_action_key'),
    requiredText(input.conversion_category, 'conversion_category'),
    requiredIdentityPart(input.segment_key, 'segment_key'),
  ].join(':');
}

export function createCoverageEntityKey(input = {}) {
  return [
    requiredText(input.coverage_run_id, 'coverage_run_id'),
    requiredText(input.entity_type, 'entity_type'),
    requiredText(input.external_entity_id, 'external_entity_id'),
  ].join(':');
}

export function createReportId(input = {}) {
  return [
    requiredText(input.report_setting_key, 'report_setting_key'),
    requiredText(input.account_key, 'account_key'),
    requiredText(input.period_kind, 'period_kind'),
    requiredDate(input.period_start, 'period_start'),
    requiredDate(input.period_end, 'period_end'),
    requiredText(input.formula_version, 'formula_version'),
  ].join(':');
}

export function validateStorageRow(tableName, value) {
  const row = exactRow(tableName, value);
  switch (tableName) {
    case 'organic_content_state': return validateOrganicContentState(row);
    case 'organic_content_observations': return validateOrganicObservation(row);
    case 'organic_account_daily_facts': return validateOrganicAccountDaily(row);
    case 'ads_entity_state': return validateAdsEntityState(row);
    case 'ads_daily_facts': return validateAdsDailyFact(row);
    case 'ads_conversion_daily_facts': return validateConversionFact(row);
    case 'data_coverage_runs': return validateCoverageRun(row);
    case 'data_coverage_entities': return validateCoverageEntity(row);
    case 'report_materializations': return validateReportMaterialization(row);
    case 'report_requests': return validateReportRequest(row);
    default: throw contractError(`Unknown storage table: ${tableName}`, { tableName });
  }
}

function validateOrganicContentState(row) {
  requireKey(row.content_key, createContentKey(row), 'content_key');
  requiredText(row.customer_profile, 'customer_profile');
  commonContentIdentity(row);
  optionalText(row.source_account_id, 'source_account_id');
  optionalText(row.content_type, 'content_type');
  optionalInteger(row.published_at, 'published_at');
  requiredInteger(row.first_seen_at, 'first_seen_at');
  requiredInteger(row.last_observed_at, 'last_observed_at');
  optionalInteger(row.last_changed_at, 'last_changed_at');
  requiredChoice(row.source_availability_status, 'source_availability_status', SOURCE_AVAILABILITY);
  cumulativeMetrics(row);
  requiredText(row.metrics_hash, 'metrics_hash');
  requiredText(row.metadata_hash, 'metadata_hash');
  requiredText(row.last_coverage_run_id, 'last_coverage_run_id');
  requiredText(row.last_sync_run_id, 'last_sync_run_id');
  auditTimes(row, true);
  if (row.first_seen_at > row.last_observed_at) {
    throw contractError('first_seen_at cannot be after last_observed_at');
  }
  return freeze(row);
}

function validateOrganicObservation(row) {
  requiredText(row.content_key, 'content_key');
  commonContentIdentity(row);
  requiredInteger(row.observed_at, 'observed_at');
  requiredDate(row.metric_date, 'metric_date');
  requiredText(row.source_timezone, 'source_timezone');
  requiredChoice(row.observation_kind, 'observation_kind', OBSERVATION_KINDS);
  if (row.metric_semantics !== 'cumulative') {
    throw contractError('organic_content_observations.metric_semantics must be cumulative');
  }
  requireKey(row.observation_key, createObservationKey(row), 'observation_key');
  cumulativeMetrics(row);
  requiredText(row.metrics_hash, 'metrics_hash');
  optionalText(row.source_revision, 'source_revision');
  requiredText(row.coverage_run_id, 'coverage_run_id');
  requiredInteger(row.fetched_at, 'fetched_at');
  requiredText(row.sync_run_id, 'sync_run_id');
  requiredInteger(row.created_at, 'created_at');
  return freeze(row);
}

function validateOrganicAccountDaily(row) {
  requiredText(row.customer_key, 'customer_key');
  requiredText(row.platform, 'platform');
  requiredText(row.account_key, 'account_key');
  requiredDate(row.metric_date, 'metric_date');
  requireKey(row.account_daily_key, createAccountDailyKey(row), 'account_daily_key');
  optionalText(row.source_account_id, 'source_account_id');
  requiredText(row.account_timezone, 'account_timezone');
  validateIntegerFields(row, [
    'followers', 'follows', 'profile_views', 'views', 'reach',
    'accounts_engaged', 'total_interactions',
  ]);
  optionalInteger(row.net_follows, 'net_follows');
  dataEvidence(row);
  auditTimes(row, true);
  return freeze(row);
}

function validateAdsEntityState(row) {
  requiredText(row.customer_key, 'customer_key');
  requiredText(row.platform, 'platform');
  requiredText(row.account_key, 'account_key');
  requiredText(row.entity_type, 'entity_type');
  requiredText(row.external_entity_id, 'external_entity_id');
  requireKey(row.entity_key, createAdsEntityKey(row), 'entity_key');
  requiredText(row.source_account_id, 'source_account_id');
  validateOptionalTextFields(row, [
    'parent_campaign_id', 'parent_ad_group_id', 'parent_ad_id', 'external_creative_id',
    'entity_name', 'status', 'objective', 'currency', 'timezone',
  ]);
  optionalInteger(row.source_updated_at, 'source_updated_at');
  requiredInteger(row.first_seen_at, 'first_seen_at');
  requiredInteger(row.last_seen_at, 'last_seen_at');
  requiredChoice(row.source_availability_status, 'source_availability_status', ADS_SOURCE_AVAILABILITY);
  requiredText(row.metadata_hash, 'metadata_hash');
  requiredText(row.last_coverage_run_id, 'last_coverage_run_id');
  requiredText(row.last_sync_run_id, 'last_sync_run_id');
  auditTimes(row, true);
  if (row.first_seen_at > row.last_seen_at) {
    throw contractError('first_seen_at cannot be after last_seen_at');
  }
  return freeze(row);
}

function validateAdsDailyFact(row) {
  adsIdentity(row, { requireBreakdown: true });
  requireKey(row.ads_fact_key, createAdsFactKey(row), 'ads_fact_key');
  requiredText(row.entity_type, 'entity_type');
  validateOptionalTextFields(row, [
    'external_campaign_id', 'external_ad_group_id', 'external_ad_id',
    'external_creative_id', 'ad_channel',
  ]);
  requiredText(row.currency, 'currency');
  validateIntegerFields(row, [
    'spend_micros', 'impressions', 'reach', 'clicks', 'conversion_value_micros',
    'video_views', 'average_cpv_micros',
  ]);
  optionalNonNegativeNumber(row.conversions, 'conversions');
  optionalRatio(row.video_view_rate, 'video_view_rate');
  optionalJson(row.actions_json, 'actions_json', STORAGE_JSON_LIMITS.actionsBytes);
  optionalJson(row.breakdown_json, 'breakdown_json', STORAGE_JSON_LIMITS.breakdownBytes);
  dataEvidence(row);
  requiredText(row.source_payload_hash, 'source_payload_hash');
  auditTimes(row, true);
  return freeze(row);
}

function validateConversionFact(row) {
  adsIdentity(row);
  requireKey(row.conversion_fact_key, createConversionFactKey(row), 'conversion_fact_key');
  validateOptionalTextFields(row, [
    'external_campaign_id', 'external_ad_group_id', 'external_ad_id', 'conversion_action_name',
  ]);
  requiredText(row.conversion_action_key, 'conversion_action_key');
  requiredText(row.conversion_category, 'conversion_category');
  requiredText(row.currency, 'currency');
  optionalNonNegativeNumber(row.conversions, 'conversions');
  optionalNonNegativeNumber(row.all_conversions, 'all_conversions');
  optionalNonNegativeInteger(row.conversion_value_micros, 'conversion_value_micros');
  optionalNonNegativeInteger(row.all_conversion_value_micros, 'all_conversion_value_micros');
  dataEvidence(row);
  requiredText(row.source_payload_hash, 'source_payload_hash');
  auditTimes(row, true);
  return freeze(row);
}

function validateCoverageRun(row) {
  validateRequiredTextFields(row, [
    'coverage_run_id', 'sync_run_id', 'customer_key', 'platform',
    'account_key', 'dataset_key', 'source_timezone',
  ]);
  requiredChoice(row.metric_semantics, 'metric_semantics', METRIC_SEMANTICS);
  requiredChoice(row.scope_mode, 'scope_mode', COVERAGE_SCOPE_MODES);
  optionalDate(row.period_start, 'period_start');
  optionalDate(row.period_end, 'period_end');
  dateOrder(row.period_start, row.period_end, 'coverage period');
  requiredChoice(row.status, 'status', STORAGE_DATA_STATUSES);
  validateIntegerFields(row, [
    'expected_entities', 'observed_entities', 'expected_rows',
    'observed_rows', 'written_rows', 'failed_rows',
  ]);
  optionalText(row.source_watermark, 'source_watermark');
  optionalInteger(row.revisable_until, 'revisable_until');
  requiredInteger(row.started_at, 'started_at');
  optionalInteger(row.completed_at, 'completed_at');
  optionalText(row.error_code, 'error_code');
  auditTimes(row, true);

  if (row.status === 'complete') {
    requiredInteger(row.completed_at, 'completed_at');
    if ((row.failed_rows ?? 0) !== 0) {
      throw contractError('complete coverage cannot contain failed_rows');
    }
    assertExpectedObserved(row.expected_entities, row.observed_entities, 'entities');
    assertExpectedObserved(row.expected_rows, row.observed_rows, 'rows');
    if (row.scope_mode === 'full_inventory') {
      requiredInteger(row.expected_entities, 'expected_entities');
      requiredInteger(row.observed_entities, 'observed_entities');
    }
  }
  return freeze({ ...row, failed_rows: row.failed_rows ?? 0 });
}

function validateCoverageEntity(row) {
  validateRequiredTextFields(row, ['coverage_run_id', 'entity_type', 'external_entity_id']);
  requireKey(row.coverage_entity_key, createCoverageEntityKey(row), 'coverage_entity_key');
  requiredChoice(row.observation_status, 'observation_status', COVERAGE_ENTITY_STATUSES);
  optionalText(row.source_revision, 'source_revision');
  optionalInteger(row.observed_at, 'observed_at');
  requiredInteger(row.created_at, 'created_at');
  return freeze(row);
}

function validateReportMaterialization(row) {
  validateRequiredTextFields(row, [
    'report_setting_key', 'customer_key', 'platform_scope', 'account_key',
    'report_type', 'period_kind', 'formula_version', 'payload_checksum',
  ]);
  requireKey(row.report_id, createReportId(row), 'report_id');
  optionalPositiveInteger(row.window_days, 'window_days');
  requiredDate(row.period_start, 'period_start');
  requiredDate(row.period_end, 'period_end');
  dateOrder(row.period_start, row.period_end, 'report period');
  optionalDate(row.compare_start, 'compare_start');
  optionalDate(row.compare_end, 'compare_end');
  dateOrder(row.compare_start, row.compare_end, 'comparison period');
  requiredChoice(row.data_status, 'data_status', STORAGE_DATA_STATUSES);
  optionalRatio(row.coverage_rate, 'coverage_rate');
  optionalText(row.source_watermark, 'source_watermark');
  const parsed = requiredJson(row.payload_json, 'payload_json', STORAGE_JSON_LIMITS.reportPayloadBytes);
  const version = parsed && typeof parsed === 'object' && !Array.isArray(parsed)
    ? parsed.schemaVersion ?? parsed.version
    : null;
  if (!version || typeof version !== 'string' || version.trim() === '') {
    throw contractError('payload_json must be an object with schemaVersion or version');
  }
  requiredInteger(row.generated_at, 'generated_at');
  optionalInteger(row.expires_at, 'expires_at');
  auditTimes(row, true);
  return freeze(row);
}

function validateReportRequest(row) {
  validateRequiredTextFields(row, ['request_id', 'customer_key', 'account_key', 'platform_scope']);
  requiredDate(row.period_start, 'period_start');
  requiredDate(row.period_end, 'period_end');
  dateOrder(row.period_start, row.period_end, 'request period');
  requiredChoice(row.comparison_mode, 'comparison_mode', REPORT_COMPARISON_MODES);
  requiredChoice(row.status, 'status', REPORT_REQUEST_STATUSES);
  optionalText(row.result_report_id, 'result_report_id');
  requiredInteger(row.requested_at, 'requested_at');
  optionalInteger(row.started_at, 'started_at');
  optionalInteger(row.finished_at, 'finished_at');
  optionalText(row.error_code, 'error_code');
  auditTimes(row, true);
  if (row.status === 'completed') {
    requiredText(row.result_report_id, 'result_report_id');
    requiredInteger(row.finished_at, 'finished_at');
  }
  return freeze(row);
}

function commonContentIdentity(row) {
  validateRequiredTextFields(row, [
    'customer_key', 'platform', 'account_key', 'external_content_id',
  ]);
}

function adsIdentity(row, options = {}) {
  validateRequiredTextFields(row, [
    'customer_key', 'platform', 'account_key', 'source_account_id',
    'report_level', 'external_entity_id', 'account_timezone',
  ]);
  requiredDate(row.metric_date, 'metric_date');
  requiredIdentityPart(row.segment_key, 'segment_key');
  if (options.requireBreakdown) requiredIdentityPart(row.breakdown_key, 'breakdown_key');
}

function dataEvidence(row) {
  requiredChoice(row.data_status, 'data_status', STORAGE_DATA_STATUSES);
  requiredText(row.coverage_run_id, 'coverage_run_id');
  optionalText(row.source_revision, 'source_revision');
  requiredInteger(row.fetched_at, 'fetched_at');
  requiredText(row.sync_run_id, 'sync_run_id');
}

function cumulativeMetrics(row) {
  validateIntegerFields(row, ['views', 'likes', 'comments', 'shares', 'unique_viewers']);
  optionalNonNegativeNumber(row.avg_watch_time_seconds, 'avg_watch_time_seconds');
  optionalNonNegativeNumber(row.total_watch_time_seconds, 'total_watch_time_seconds');
  optionalRatio(row.completion_rate, 'completion_rate');
}

function validateRequiredTextFields(row, fields) {
  for (const field of fields) requiredText(row[field], field);
}

function validateOptionalTextFields(row, fields) {
  for (const field of fields) optionalText(row[field], field);
}

function validateIntegerFields(row, fields) {
  for (const field of fields) optionalNonNegativeInteger(row[field], field);
}

function auditTimes(row, updatedRequired) {
  requiredInteger(row.created_at, 'created_at');
  if (updatedRequired) requiredInteger(row.updated_at, 'updated_at');
}

function exactRow(tableName, value) {
  const fields = TABLE_FIELDS[tableName];
  if (!fields) throw contractError(`Unknown storage table: ${tableName}`, { tableName });
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw contractError(`${tableName} row must be an object`);
  }
  const allowed = new Set(fields);
  const unknown = Object.keys(value).filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw contractError(`${tableName} contains unknown fields`, { unknown });
  }
  return { ...value };
}

function requireKey(actual, expected, fieldName) {
  if (requiredText(actual, fieldName) !== expected) {
    throw contractError(`${fieldName} does not match the approved Stable key`, {
      fieldName,
      expected,
    });
  }
}

function assertExpectedObserved(expected, observed, label) {
  if (expected !== null && expected !== undefined && expected !== observed) {
    throw contractError(`complete coverage ${label} must reconcile`, { expected, observed });
  }
}

function dateOrder(start, end, label) {
  if (start && end && start > end) {
    throw contractError(`${label} start cannot be after end`);
  }
}

/** Stable-key dimensions must contain an explicit value; callers use the literal `none` when absent. */
function requiredIdentityPart(value, fieldName) {
  return requiredText(value, fieldName);
}

function requiredText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw contractError(`${fieldName} is required`, { fieldName });
  }
  return value.trim();
}

function optionalText(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string' || value.trim() === '') {
    throw contractError(`${fieldName} must be a non-empty string or null`, { fieldName });
  }
  return value.trim();
}

function requiredChoice(value, fieldName, choices) {
  const text = requiredText(value, fieldName);
  if (!choices.includes(text)) {
    throw contractError(`${fieldName} must be one of: ${choices.join(', ')}`, { fieldName });
  }
  return text;
}

function requiredInteger(value, fieldName) {
  if (!Number.isSafeInteger(value)) {
    throw contractError(`${fieldName} must be a safe integer`, { fieldName });
  }
  return value;
}

function optionalInteger(value, fieldName) {
  if (value === undefined || value === null) return null;
  return requiredInteger(value, fieldName);
}

function optionalNonNegativeInteger(value, fieldName) {
  const number = optionalInteger(value, fieldName);
  if (number !== null && number < 0) {
    throw contractError(`${fieldName} must be non-negative`, { fieldName });
  }
  return number;
}

function optionalPositiveInteger(value, fieldName) {
  const number = optionalInteger(value, fieldName);
  if (number !== null && number <= 0) {
    throw contractError(`${fieldName} must be positive`, { fieldName });
  }
  return number;
}

function optionalNonNegativeNumber(value, fieldName) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    throw contractError(`${fieldName} must be a non-negative finite number`, { fieldName });
  }
  return value;
}

function optionalRatio(value, fieldName) {
  const number = optionalNonNegativeNumber(value, fieldName);
  if (number !== null && number > 1) {
    throw contractError(`${fieldName} must be between 0 and 1`, { fieldName });
  }
  return number;
}

function requiredDate(value, fieldName) {
  try {
    return requireDateOnly(value, { label: fieldName });
  } catch (cause) {
    throw contractError(cause instanceof Error ? cause.message : `${fieldName} must be YYYY-MM-DD`, {
      fieldName,
    });
  }
}

function optionalDate(value, fieldName) {
  if (value === undefined || value === null) return null;
  return requiredDate(value, fieldName);
}

function optionalJson(value, fieldName, maxBytes) {
  if (value === undefined || value === null) return null;
  return requiredJson(value, fieldName, maxBytes);
}

function requiredJson(value, fieldName, maxBytes) {
  const text = requiredText(value, fieldName);
  const bytes = new TextEncoder().encode(text).byteLength;
  if (bytes > maxBytes) {
    throw contractError(`${fieldName} exceeds ${maxBytes} bytes`, {
      fieldName,
      bytes,
      maxBytes,
    });
  }
  try {
    return JSON.parse(text);
  } catch {
    throw contractError(`${fieldName} must contain valid JSON`, { fieldName });
  }
}

function freeze(row) {
  return Object.freeze({ ...row });
}

function contractError(message, details = {}) {
  return permanentError(message, {
    code: 'MKT_STORAGE_CONTRACT_INVALID',
    details,
  });
}
