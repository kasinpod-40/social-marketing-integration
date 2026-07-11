-- Reliability layer สำหรับ Sync run, lease lock, DLQ และ System alerts
-- ใช้ D1 เป็น operational source of truth ส่วน Lark Base เป็น mirror สำหรับผู้ใช้งาน

CREATE TABLE IF NOT EXISTS sync_runs (
  sync_run_id TEXT PRIMARY KEY,
  customer_profile TEXT,
  platform TEXT NOT NULL,
  account_key TEXT,
  source TEXT,
  sync_type TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'success', 'partial_success', 'failed', 'skipped')),
  started_at INTEGER,
  finished_at INTEGER,
  records_pulled INTEGER NOT NULL DEFAULT 0 CHECK (records_pulled >= 0),
  records_created INTEGER NOT NULL DEFAULT 0 CHECK (records_created >= 0),
  records_updated INTEGER NOT NULL DEFAULT 0 CHECK (records_updated >= 0),
  records_skipped INTEGER NOT NULL DEFAULT 0 CHECK (records_skipped >= 0),
  records_written INTEGER NOT NULL DEFAULT 0 CHECK (records_written >= 0),
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  error_code TEXT,
  error_message TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_runs_platform_status_started
ON sync_runs(platform, status, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_runs_profile_account_started
ON sync_runs(customer_profile, account_key, started_at DESC);

CREATE TABLE IF NOT EXISTS sync_locks (
  lock_key TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  acquired_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_locks_expires_at
ON sync_locks(expires_at);

CREATE TABLE IF NOT EXISTS dead_letter_jobs (
  dlq_id TEXT PRIMARY KEY,
  message_id TEXT,
  queue_name TEXT,
  job_type TEXT,
  schema_version INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'replayed', 'resolved', 'discarded')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_status_created
ON dead_letter_jobs(status, created_at DESC);

CREATE TABLE IF NOT EXISTS system_alerts (
  alert_id TEXT PRIMARY KEY,
  sync_run_id TEXT,
  alert_type TEXT NOT NULL,
  severity TEXT NOT NULL CHECK (severity IN ('info', 'warning', 'critical')),
  platform TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('open', 'acknowledged', 'resolved')),
  message TEXT NOT NULL,
  error_code TEXT,
  details_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_system_alerts_status_severity_created
ON system_alerts(status, severity, created_at DESC);
