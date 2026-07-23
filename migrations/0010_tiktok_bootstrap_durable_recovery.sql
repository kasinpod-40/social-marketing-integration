-- TikTok Organic bootstrap durable recovery hotfix
-- Additive only: no existing business or operational facts are deleted or rewritten.

CREATE TABLE IF NOT EXISTS queue_operation_attempts (
  operation_id TEXT PRIMARY KEY,
  work_key TEXT NOT NULL,
  generation INTEGER,
  original_requested_at INTEGER,
  main_queue_attempts INTEGER NOT NULL DEFAULT 0 CHECK (main_queue_attempts >= 0),
  last_main_message_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_queue_operation_attempts_work_key
  ON queue_operation_attempts(work_key);

CREATE TABLE IF NOT EXISTS dead_letter_operation_metadata (
  dlq_id TEXT PRIMARY KEY,
  operation_id TEXT,
  original_work_key TEXT,
  generation INTEGER,
  original_requested_at INTEGER,
  main_queue_attempts INTEGER NOT NULL DEFAULT 0 CHECK (main_queue_attempts >= 0),
  dlq_delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (dlq_delivery_attempts >= 0),
  recovery_status TEXT CHECK (recovery_status IN ('not_started', 'in_progress', 'completed')),
  recovery_reference TEXT,
  recovery_started_at INTEGER,
  recovery_completed_at INTEGER,
  audit_reference TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (dlq_id) REFERENCES dead_letter_jobs(dlq_id)
);

CREATE INDEX IF NOT EXISTS idx_dead_letter_operation_work
  ON dead_letter_operation_metadata(original_work_key, recovery_status);
