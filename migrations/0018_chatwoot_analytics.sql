-- Chatwoot analytics storage foundation.
-- Additive, replay-safe and PII-minimized. Source-only until a separate Remote approval.

CREATE TABLE IF NOT EXISTS chatwoot_account_state (
  account_state_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  source_updated_at INTEGER,
  metadata_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_account_id)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_account_state_customer
  ON chatwoot_account_state(customer_key, account_key);

CREATE TABLE IF NOT EXISTS chatwoot_inbox_state (
  inbox_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_inbox_id INTEGER NOT NULL,
  channel_type TEXT,
  medium TEXT,
  timezone TEXT,
  enable_auto_assignment INTEGER CHECK(enable_auto_assignment IN (0, 1) OR enable_auto_assignment IS NULL),
  working_hours_enabled INTEGER CHECK(working_hours_enabled IN (0, 1) OR working_hours_enabled IS NULL),
  csat_survey_enabled INTEGER CHECK(csat_survey_enabled IN (0, 1) OR csat_survey_enabled IS NULL),
  allow_messages_after_resolved INTEGER CHECK(allow_messages_after_resolved IN (0, 1) OR allow_messages_after_resolved IS NULL),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  source_updated_at INTEGER,
  metadata_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_inbox_id)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_inbox_state_account
  ON chatwoot_inbox_state(account_key, external_account_id);

CREATE TABLE IF NOT EXISTS chatwoot_contact_state (
  contact_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_contact_id INTEGER NOT NULL,
  blocked INTEGER CHECK(blocked IN (0, 1) OR blocked IS NULL),
  availability_status TEXT,
  source_availability_status TEXT,
  source_created_at INTEGER,
  last_activity_at INTEGER,
  source_updated_at INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  metadata_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_contact_id)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_contact_state_account_activity
  ON chatwoot_contact_state(account_key, last_activity_at);

CREATE TABLE IF NOT EXISTS chatwoot_agent_state (
  agent_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_agent_id INTEGER NOT NULL,
  role TEXT,
  availability_status TEXT,
  auto_offline INTEGER CHECK(auto_offline IN (0, 1) OR auto_offline IS NULL),
  confirmed INTEGER CHECK(confirmed IN (0, 1) OR confirmed IS NULL),
  custom_role_id INTEGER,
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  source_updated_at INTEGER,
  metadata_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_agent_id)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_agent_state_account
  ON chatwoot_agent_state(account_key, external_account_id);

CREATE TABLE IF NOT EXISTS chatwoot_team_state (
  team_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_team_id INTEGER NOT NULL,
  allow_auto_assign INTEGER CHECK(allow_auto_assign IN (0, 1) OR allow_auto_assign IS NULL),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  source_updated_at INTEGER,
  metadata_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_team_id)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_team_state_account
  ON chatwoot_team_state(account_key, external_account_id);

CREATE TABLE IF NOT EXISTS chatwoot_label_state (
  label_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_label_id INTEGER NOT NULL,
  title_hash TEXT NOT NULL,
  color TEXT,
  show_on_sidebar INTEGER CHECK(show_on_sidebar IN (0, 1) OR show_on_sidebar IS NULL),
  first_seen_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  source_updated_at INTEGER,
  metadata_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_label_id)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_label_state_account_hash
  ON chatwoot_label_state(account_key, title_hash);

CREATE TABLE IF NOT EXISTS chatwoot_conversation_state (
  conversation_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_conversation_id INTEGER NOT NULL,
  external_inbox_id INTEGER,
  external_contact_id INTEGER,
  status TEXT,
  priority TEXT,
  external_assignee_id INTEGER,
  external_team_id INTEGER,
  source_created_at INTEGER,
  source_updated_at INTEGER NOT NULL,
  last_activity_at INTEGER,
  waiting_since INTEGER,
  source_availability_status TEXT,
  message_count INTEGER NOT NULL DEFAULT 0 CHECK(message_count >= 0),
  incoming_message_count INTEGER NOT NULL DEFAULT 0 CHECK(incoming_message_count >= 0),
  outgoing_message_count INTEGER NOT NULL DEFAULT 0 CHECK(outgoing_message_count >= 0),
  private_message_count INTEGER NOT NULL DEFAULT 0 CHECK(private_message_count >= 0),
  attachment_message_count INTEGER NOT NULL DEFAULT 0 CHECK(attachment_message_count >= 0),
  reopen_count INTEGER NOT NULL DEFAULT 0 CHECK(reopen_count >= 0),
  first_response_seconds REAL,
  first_response_business_seconds REAL,
  resolution_seconds REAL,
  resolution_business_seconds REAL,
  reply_seconds REAL,
  reply_business_seconds REAL,
  metrics_hash TEXT NOT NULL,
  metadata_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_conversation_id)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_conversation_state_account_updated
  ON chatwoot_conversation_state(account_key, source_updated_at);
CREATE INDEX IF NOT EXISTS idx_chatwoot_conversation_state_inbox_status
  ON chatwoot_conversation_state(account_key, external_inbox_id, status);

CREATE TABLE IF NOT EXISTS chatwoot_conversation_label_state (
  conversation_label_key TEXT PRIMARY KEY,
  conversation_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  label_key TEXT NOT NULL,
  external_conversation_id INTEGER NOT NULL,
  external_label_id INTEGER NOT NULL,
  active INTEGER NOT NULL CHECK(active IN (0, 1)),
  observed_at INTEGER NOT NULL,
  removed_at INTEGER,
  coverage_run_id TEXT NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_conversation_id, external_label_id)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_conversation_label_active
  ON chatwoot_conversation_label_state(account_key, external_conversation_id, active);

CREATE TABLE IF NOT EXISTS chatwoot_message_analytics_state (
  message_key TEXT PRIMARY KEY,
  conversation_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_message_id INTEGER NOT NULL,
  external_conversation_id INTEGER NOT NULL,
  external_inbox_id INTEGER,
  message_type TEXT,
  direction TEXT,
  content_type TEXT,
  private INTEGER CHECK(private IN (0, 1) OR private IS NULL),
  sender_type TEXT,
  external_sender_id INTEGER,
  attachment_count INTEGER NOT NULL DEFAULT 0 CHECK(attachment_count >= 0),
  source_created_at INTEGER NOT NULL,
  source_updated_at INTEGER,
  metadata_hash TEXT NOT NULL,
  last_coverage_run_id TEXT NOT NULL,
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_message_id)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_message_conversation_created
  ON chatwoot_message_analytics_state(account_key, external_conversation_id, source_created_at);

CREATE TABLE IF NOT EXISTS chatwoot_reporting_event_facts (
  reporting_event_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_reporting_event_id INTEGER NOT NULL,
  event_name TEXT NOT NULL,
  value_seconds REAL,
  value_business_seconds REAL,
  external_conversation_id INTEGER,
  external_inbox_id INTEGER,
  external_agent_id INTEGER,
  event_start_at INTEGER,
  event_end_at INTEGER,
  source_created_at INTEGER,
  source_updated_at INTEGER,
  source_payload_hash TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_reporting_event_id)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_reporting_event_date
  ON chatwoot_reporting_event_facts(account_key, event_name, event_end_at);

CREATE TABLE IF NOT EXISTS chatwoot_conversation_daily_facts (
  conversation_daily_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_conversation_id INTEGER NOT NULL,
  external_inbox_id INTEGER,
  external_agent_id INTEGER,
  external_team_id INTEGER,
  metric_date TEXT NOT NULL,
  reporting_timezone TEXT NOT NULL,
  status TEXT,
  new_conversation_count INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  incoming_message_count INTEGER NOT NULL DEFAULT 0,
  outgoing_message_count INTEGER NOT NULL DEFAULT 0,
  private_message_count INTEGER NOT NULL DEFAULT 0,
  attachment_message_count INTEGER NOT NULL DEFAULT 0,
  first_response_seconds REAL,
  first_response_business_seconds REAL,
  resolution_seconds REAL,
  resolution_business_seconds REAL,
  reply_seconds REAL,
  reply_business_seconds REAL,
  data_status TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_conversation_id, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_conversation_daily_date
  ON chatwoot_conversation_daily_facts(account_key, metric_date);

CREATE TABLE IF NOT EXISTS chatwoot_agent_daily_facts (
  agent_daily_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_agent_id INTEGER NOT NULL,
  metric_date TEXT NOT NULL,
  reporting_timezone TEXT NOT NULL,
  assigned_conversation_count INTEGER,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  incoming_message_count INTEGER NOT NULL DEFAULT 0,
  outgoing_message_count INTEGER NOT NULL DEFAULT 0,
  avg_first_response_seconds REAL,
  avg_resolution_seconds REAL,
  avg_reply_seconds REAL,
  data_status TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_agent_id, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_agent_daily_date
  ON chatwoot_agent_daily_facts(account_key, metric_date);

CREATE TABLE IF NOT EXISTS chatwoot_inbox_daily_facts (
  inbox_daily_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  external_inbox_id INTEGER NOT NULL,
  metric_date TEXT NOT NULL,
  reporting_timezone TEXT NOT NULL,
  conversation_count INTEGER,
  new_conversation_count INTEGER NOT NULL DEFAULT 0,
  resolved_count INTEGER NOT NULL DEFAULT 0,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  incoming_message_count INTEGER NOT NULL DEFAULT 0,
  outgoing_message_count INTEGER NOT NULL DEFAULT 0,
  avg_first_response_seconds REAL,
  avg_resolution_seconds REAL,
  avg_reply_seconds REAL,
  data_status TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_inbox_id, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_inbox_daily_date
  ON chatwoot_inbox_daily_facts(account_key, metric_date);

CREATE TABLE IF NOT EXISTS chatwoot_account_daily_facts (
  account_daily_key TEXT PRIMARY KEY,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  external_account_id INTEGER NOT NULL,
  metric_date TEXT NOT NULL,
  reporting_timezone TEXT NOT NULL,
  conversation_count INTEGER,
  new_conversation_count INTEGER NOT NULL DEFAULT 0,
  open_conversation_count INTEGER,
  resolved_conversation_count INTEGER,
  pending_conversation_count INTEGER,
  snoozed_conversation_count INTEGER,
  reopened_count INTEGER NOT NULL DEFAULT 0,
  incoming_message_count INTEGER NOT NULL DEFAULT 0,
  outgoing_message_count INTEGER NOT NULL DEFAULT 0,
  avg_first_response_seconds REAL,
  avg_resolution_seconds REAL,
  avg_reply_seconds REAL,
  active_agent_count INTEGER,
  active_inbox_count INTEGER,
  data_status TEXT NOT NULL,
  coverage_run_id TEXT NOT NULL,
  source_revision TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(account_key, external_account_id, metric_date)
);
CREATE INDEX IF NOT EXISTS idx_chatwoot_account_daily_date
  ON chatwoot_account_daily_facts(account_key, metric_date);
