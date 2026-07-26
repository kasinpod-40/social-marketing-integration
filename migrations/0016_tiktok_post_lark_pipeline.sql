-- TikTok Organic post-Lark watermark admission and report orchestration.
-- Additive only: no existing Business facts, Queue state or Lark data are modified.

CREATE TABLE IF NOT EXISTS tiktok_source_admissions (
  admission_key TEXT PRIMARY KEY,
  customer_profile TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  source_handle TEXT NOT NULL,
  source_watermark TEXT NOT NULL,
  metric_date TEXT NOT NULL CHECK (metric_date GLOB '????-??-??'),
  source_record_count INTEGER NOT NULL CHECK (source_record_count >= 0),
  source_max_modified_at INTEGER,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  work_key TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN ('pending', 'queued', 'processing', 'completed', 'failed_retryable', 'failed_permanent')),
  sync_run_id TEXT,
  report_request_id TEXT,
  error_code TEXT,
  requested_at INTEGER NOT NULL,
  queued_at INTEGER,
  started_at INTEGER,
  completed_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(customer_key, account_key, source_watermark, metric_date),
  UNIQUE(work_key),
  CHECK (status <> 'queued' OR queued_at IS NOT NULL),
  CHECK (status <> 'processing' OR (queued_at IS NOT NULL AND started_at IS NOT NULL)),
  CHECK (status <> 'completed' OR (sync_run_id IS NOT NULL AND completed_at IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS idx_tiktok_source_admissions_account_status
ON tiktok_source_admissions(customer_key, account_key, status, requested_at);

CREATE INDEX IF NOT EXISTS idx_tiktok_source_admissions_watermark
ON tiktok_source_admissions(customer_key, account_key, source_watermark, metric_date);

CREATE INDEX IF NOT EXISTS idx_tiktok_source_admissions_completed
ON tiktok_source_admissions(customer_key, account_key, completed_at);
