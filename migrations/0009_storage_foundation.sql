-- Storage Foundation v1: additive Marketing current state, historical facts, Coverage and Report state
-- Phase 1B creates schema only. No connector is wired to these tables and every related Feature flag remains false.

CREATE TABLE IF NOT EXISTS organic_content_state (
  content_key TEXT PRIMARY KEY,
  customer_profile TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_key TEXT NOT NULL,
  source_account_id TEXT,
  external_content_id TEXT NOT NULL,
  content_type TEXT,
  published_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_observed_at INTEGER NOT NULL,
  last_changed_at INTEGER,
  source_availability_status TEXT NOT NULL
    CHECK (source_availability_status IN ('available', 'missing', 'private', 'deleted', 'expired', 'unknown')),
  views INTEGER CHECK (views IS NULL OR views >= 0),
  likes INTEGER CHECK (likes IS NULL OR likes >= 0),
  comments INTEGER CHECK (comments IS NULL OR comments >= 0),
  shares INTEGER CHECK (shares IS NULL OR shares >= 0),
  unique_viewers INTEGER CHECK (unique_viewers IS NULL OR unique_viewers >= 0),
  avg_watch_time_seconds REAL CHECK (avg_watch_time_seconds IS NULL OR avg_watch_time_seconds >= 0),
  total_watch_time_seconds REAL CHECK (total_watch_time_seconds IS NULL OR total_watch_time_seconds >= 0),
  completion_rate REAL CHECK (completion_rate IS NULL OR (completion_rate >= 0 AND completion_rate <= 1)),
  metrics_hash TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(platform, account_key, external_content_id)
);

CREATE INDEX IF NOT EXISTS idx_organic_content_state_account_observed
ON organic_content_state(customer_key, platform, account_key, last_observed_at);

CREATE INDEX IF NOT EXISTS idx_organic_content_state_account_published
ON organic_content_state(customer_key, platform, account_key, published_at);

CREATE INDEX IF NOT EXISTS idx_organic_content_state_availability_observed
ON organic_content_state(source_availability_status, last_observed_at);

CREATE TABLE IF NOT EXISTS organic_content_observations (
  observation_key TEXT PRIMARY KEY,
  content_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_content_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  metric_date TEXT NOT NULL CHECK (metric_date GLOB '????-??-??'),
  source_timezone TEXT NOT NULL,
  observation_kind TEXT NOT NULL
    CHECK (observation_kind IN ('initial', 'changed', 'checkpoint', 'correction', 'backfill')),
  metric_semantics TEXT NOT NULL CHECK (metric_semantics = 'cumulative'),
  views INTEGER CHECK (views IS NULL OR views >= 0),
  likes INTEGER CHECK (likes IS NULL OR likes >= 0),
  comments INTEGER CHECK (comments IS NULL OR comments >= 0),
  shares INTEGER CHECK (shares IS NULL OR shares >= 0),
  unique_viewers INTEGER CHECK (unique_viewers IS NULL OR unique_viewers >= 0),
  avg_watch_time_seconds REAL CHECK (avg_watch_time_seconds IS NULL OR avg_watch_time_seconds >= 0),
  total_watch_time_seconds REAL CHECK (total_watch_time_seconds IS NULL OR total_watch_time_seconds >= 0),
  completion_rate REAL CHECK (completion_rate IS NULL OR (completion_rate >= 0 AND completion_rate <= 1)),
  metrics_hash TEXT NOT NULL,
  source_revision TEXT,
  coverage_run_id TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(content_key, observed_at, observation_kind)
);

CREATE INDEX IF NOT EXISTS idx_organic_content_observations_content_observed
ON organic_content_observations(content_key, observed_at DESC);

CREATE INDEX IF NOT EXISTS idx_organic_content_observations_account_date
ON organic_content_observations(customer_key, platform, account_key, metric_date);

CREATE INDEX IF NOT EXISTS idx_organic_content_observations_coverage_content
ON organic_content_observations(coverage_run_id, content_key);

CREATE TABLE IF NOT EXISTS organic_account_daily_facts (
  account_daily_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_key TEXT NOT NULL,
  source_account_id TEXT,
  metric_date TEXT NOT NULL CHECK (metric_date GLOB '????-??-??'),
  account_timezone TEXT NOT NULL,
  followers INTEGER CHECK (followers IS NULL OR followers >= 0),
  follows INTEGER CHECK (follows IS NULL OR follows >= 0),
  profile_views INTEGER CHECK (profile_views IS NULL OR profile_views >= 0),
  views INTEGER CHECK (views IS NULL OR views >= 0),
  reach INTEGER CHECK (reach IS NULL OR reach >= 0),
  accounts_engaged INTEGER CHECK (accounts_engaged IS NULL OR accounts_engaged >= 0),
  total_interactions INTEGER CHECK (total_interactions IS NULL OR total_interactions >= 0),
  net_follows INTEGER,
  data_status TEXT NOT NULL
    CHECK (data_status IN ('complete', 'partial', 'no_data_confirmed', 'source_unavailable', 'not_observed', 'revisable')),
  coverage_run_id TEXT NOT NULL,
  source_revision TEXT,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(platform, account_key, metric_date)
);

CREATE INDEX IF NOT EXISTS idx_organic_account_daily_account_date
ON organic_account_daily_facts(customer_key, platform, account_key, metric_date);

CREATE INDEX IF NOT EXISTS idx_organic_account_daily_status_date
ON organic_account_daily_facts(data_status, metric_date);

CREATE TABLE IF NOT EXISTS ads_entity_state (
  entity_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_key TEXT NOT NULL,
  source_account_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  external_entity_id TEXT NOT NULL,
  parent_campaign_id TEXT,
  parent_ad_group_id TEXT,
  parent_ad_id TEXT,
  external_creative_id TEXT,
  entity_name TEXT,
  status TEXT,
  objective TEXT,
  currency TEXT,
  timezone TEXT,
  source_updated_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  source_availability_status TEXT NOT NULL
    CHECK (source_availability_status IN ('available', 'missing', 'deleted', 'unknown')),
  metadata_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(platform, account_key, entity_type, external_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_ads_entity_state_account_type_seen
ON ads_entity_state(customer_key, platform, account_key, entity_type, last_seen_at);

CREATE INDEX IF NOT EXISTS idx_ads_entity_state_campaign
ON ads_entity_state(platform, account_key, parent_campaign_id);

CREATE INDEX IF NOT EXISTS idx_ads_entity_state_ad_group
ON ads_entity_state(platform, account_key, parent_ad_group_id);

CREATE TABLE IF NOT EXISTS ads_daily_facts (
  ads_fact_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_key TEXT NOT NULL,
  source_account_id TEXT NOT NULL,
  report_level TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  external_entity_id TEXT NOT NULL,
  external_campaign_id TEXT,
  external_ad_group_id TEXT,
  external_ad_id TEXT,
  external_creative_id TEXT,
  metric_date TEXT NOT NULL CHECK (metric_date GLOB '????-??-??'),
  account_timezone TEXT NOT NULL,
  breakdown_key TEXT NOT NULL,
  segment_key TEXT NOT NULL,
  ad_channel TEXT,
  currency TEXT NOT NULL,
  spend_micros INTEGER CHECK (spend_micros IS NULL OR spend_micros >= 0),
  impressions INTEGER CHECK (impressions IS NULL OR impressions >= 0),
  reach INTEGER CHECK (reach IS NULL OR reach >= 0),
  clicks INTEGER CHECK (clicks IS NULL OR clicks >= 0),
  conversions REAL CHECK (conversions IS NULL OR conversions >= 0),
  conversion_value_micros INTEGER CHECK (conversion_value_micros IS NULL OR conversion_value_micros >= 0),
  video_views INTEGER CHECK (video_views IS NULL OR video_views >= 0),
  video_view_rate REAL CHECK (video_view_rate IS NULL OR (video_view_rate >= 0 AND video_view_rate <= 1)),
  average_cpv_micros INTEGER CHECK (average_cpv_micros IS NULL OR average_cpv_micros >= 0),
  actions_json TEXT CHECK (actions_json IS NULL OR length(CAST(actions_json AS BLOB)) <= 65536),
  breakdown_json TEXT CHECK (breakdown_json IS NULL OR length(CAST(breakdown_json AS BLOB)) <= 65536),
  data_status TEXT NOT NULL
    CHECK (data_status IN ('complete', 'partial', 'no_data_confirmed', 'source_unavailable', 'not_observed', 'revisable')),
  coverage_run_id TEXT NOT NULL,
  source_revision TEXT,
  source_payload_hash TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(platform, account_key, report_level, external_entity_id, metric_date, breakdown_key, segment_key)
);

CREATE INDEX IF NOT EXISTS idx_ads_daily_facts_account_date
ON ads_daily_facts(customer_key, platform, account_key, metric_date);

CREATE INDEX IF NOT EXISTS idx_ads_daily_facts_entity_date
ON ads_daily_facts(platform, account_key, report_level, external_entity_id, metric_date);

CREATE INDEX IF NOT EXISTS idx_ads_daily_facts_campaign_date
ON ads_daily_facts(platform, account_key, external_campaign_id, metric_date);

CREATE INDEX IF NOT EXISTS idx_ads_daily_facts_coverage_date
ON ads_daily_facts(coverage_run_id, metric_date);

CREATE TABLE IF NOT EXISTS ads_conversion_daily_facts (
  conversion_fact_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_key TEXT NOT NULL,
  source_account_id TEXT NOT NULL,
  report_level TEXT NOT NULL,
  external_entity_id TEXT NOT NULL,
  external_campaign_id TEXT,
  external_ad_group_id TEXT,
  external_ad_id TEXT,
  metric_date TEXT NOT NULL CHECK (metric_date GLOB '????-??-??'),
  account_timezone TEXT NOT NULL,
  conversion_action_key TEXT NOT NULL,
  conversion_action_name TEXT,
  conversion_category TEXT NOT NULL,
  segment_key TEXT NOT NULL,
  currency TEXT NOT NULL,
  conversions REAL CHECK (conversions IS NULL OR conversions >= 0),
  all_conversions REAL CHECK (all_conversions IS NULL OR all_conversions >= 0),
  conversion_value_micros INTEGER CHECK (conversion_value_micros IS NULL OR conversion_value_micros >= 0),
  all_conversion_value_micros INTEGER CHECK (all_conversion_value_micros IS NULL OR all_conversion_value_micros >= 0),
  data_status TEXT NOT NULL
    CHECK (data_status IN ('complete', 'partial', 'no_data_confirmed', 'source_unavailable', 'not_observed', 'revisable')),
  coverage_run_id TEXT NOT NULL,
  source_revision TEXT,
  source_payload_hash TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(platform, account_key, report_level, external_entity_id, metric_date, conversion_action_key, conversion_category, segment_key)
);

CREATE INDEX IF NOT EXISTS idx_ads_conversion_daily_account_date
ON ads_conversion_daily_facts(customer_key, platform, account_key, metric_date);

CREATE INDEX IF NOT EXISTS idx_ads_conversion_daily_action_date
ON ads_conversion_daily_facts(platform, account_key, conversion_action_key, metric_date);

CREATE INDEX IF NOT EXISTS idx_ads_conversion_daily_campaign_date
ON ads_conversion_daily_facts(platform, account_key, external_campaign_id, metric_date);

CREATE TABLE IF NOT EXISTS data_coverage_runs (
  coverage_run_id TEXT PRIMARY KEY,
  sync_run_id TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_key TEXT NOT NULL,
  dataset_key TEXT NOT NULL,
  metric_semantics TEXT NOT NULL CHECK (metric_semantics IN ('cumulative', 'period', 'snapshot')),
  scope_mode TEXT NOT NULL CHECK (scope_mode IN ('full_inventory', 'recent_window', 'exact_entities', 'report_range')),
  period_start TEXT CHECK (period_start IS NULL OR period_start GLOB '????-??-??'),
  period_end TEXT CHECK (period_end IS NULL OR period_end GLOB '????-??-??'),
  source_timezone TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('complete', 'partial', 'no_data_confirmed', 'source_unavailable', 'not_observed', 'revisable')),
  expected_entities INTEGER CHECK (expected_entities IS NULL OR expected_entities >= 0),
  observed_entities INTEGER CHECK (observed_entities IS NULL OR observed_entities >= 0),
  expected_rows INTEGER CHECK (expected_rows IS NULL OR expected_rows >= 0),
  observed_rows INTEGER CHECK (observed_rows IS NULL OR observed_rows >= 0),
  written_rows INTEGER CHECK (written_rows IS NULL OR written_rows >= 0),
  failed_rows INTEGER NOT NULL DEFAULT 0 CHECK (failed_rows >= 0),
  source_watermark TEXT,
  revisable_until INTEGER,
  started_at INTEGER NOT NULL,
  completed_at INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (period_start IS NULL OR period_end IS NULL OR period_start <= period_end),
  CHECK (status <> 'complete' OR completed_at IS NOT NULL),
  CHECK (scope_mode = 'full_inventory' OR status <> 'complete' OR observed_entities IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_data_coverage_runs_account_dataset_completed
ON data_coverage_runs(customer_key, platform, account_key, dataset_key, completed_at);

CREATE INDEX IF NOT EXISTS idx_data_coverage_runs_status_revisable
ON data_coverage_runs(status, revisable_until);

CREATE INDEX IF NOT EXISTS idx_data_coverage_runs_sync_dataset
ON data_coverage_runs(sync_run_id, dataset_key);

CREATE TABLE IF NOT EXISTS data_coverage_entities (
  coverage_entity_key TEXT PRIMARY KEY,
  coverage_run_id TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  external_entity_id TEXT NOT NULL,
  observation_status TEXT NOT NULL
    CHECK (observation_status IN ('observed', 'missing', 'failed', 'not_observed')),
  source_revision TEXT,
  observed_at INTEGER,
  created_at INTEGER NOT NULL,
  UNIQUE(coverage_run_id, entity_type, external_entity_id)
);

CREATE INDEX IF NOT EXISTS idx_data_coverage_entities_run_status
ON data_coverage_entities(coverage_run_id, observation_status);

CREATE TABLE IF NOT EXISTS report_materializations (
  report_id TEXT PRIMARY KEY,
  report_setting_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  platform_scope TEXT NOT NULL,
  account_key TEXT NOT NULL,
  report_type TEXT NOT NULL,
  period_kind TEXT NOT NULL,
  window_days INTEGER CHECK (window_days IS NULL OR window_days > 0),
  period_start TEXT NOT NULL CHECK (period_start GLOB '????-??-??'),
  period_end TEXT NOT NULL CHECK (period_end GLOB '????-??-??'),
  compare_start TEXT CHECK (compare_start IS NULL OR compare_start GLOB '????-??-??'),
  compare_end TEXT CHECK (compare_end IS NULL OR compare_end GLOB '????-??-??'),
  data_status TEXT NOT NULL
    CHECK (data_status IN ('complete', 'partial', 'no_data_confirmed', 'source_unavailable', 'not_observed', 'revisable')),
  coverage_rate REAL CHECK (coverage_rate IS NULL OR (coverage_rate >= 0 AND coverage_rate <= 1)),
  formula_version TEXT NOT NULL,
  source_watermark TEXT,
  payload_json TEXT NOT NULL CHECK (length(CAST(payload_json AS BLOB)) <= 262144),
  payload_checksum TEXT NOT NULL,
  generated_at INTEGER NOT NULL,
  expires_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (period_start <= period_end),
  CHECK (compare_start IS NULL OR compare_end IS NULL OR compare_start <= compare_end)
);

CREATE INDEX IF NOT EXISTS idx_report_materializations_setting_period
ON report_materializations(report_setting_key, account_key, period_start, period_end);

CREATE INDEX IF NOT EXISTS idx_report_materializations_account_generated
ON report_materializations(customer_key, platform_scope, account_key, generated_at);

CREATE INDEX IF NOT EXISTS idx_report_materializations_expiry
ON report_materializations(expires_at);

CREATE TABLE IF NOT EXISTS report_requests (
  request_id TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  platform_scope TEXT NOT NULL,
  period_start TEXT NOT NULL CHECK (period_start GLOB '????-??-??'),
  period_end TEXT NOT NULL CHECK (period_end GLOB '????-??-??'),
  comparison_mode TEXT NOT NULL
    CHECK (comparison_mode IN ('none', 'previous_period', 'previous_year', 'custom')),
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'processing', 'completed', 'failed_retryable', 'failed_permanent', 'cancelled')),
  result_report_id TEXT,
  requested_at INTEGER NOT NULL,
  started_at INTEGER,
  finished_at INTEGER,
  error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (period_start <= period_end),
  CHECK (status <> 'completed' OR (result_report_id IS NOT NULL AND finished_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_report_requests_status_requested
ON report_requests(status, requested_at);

CREATE INDEX IF NOT EXISTS idx_report_requests_account_period
ON report_requests(customer_key, platform_scope, account_key, period_start, period_end);
