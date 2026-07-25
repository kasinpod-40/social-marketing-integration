-- Google Ads LIVE admission and processing lifecycle.
-- Additive only: no Queue send, business write or schedule is activated by this migration.

CREATE TABLE IF NOT EXISTS google_ads_live_admissions (
  run_id TEXT PRIMARY KEY
    CHECK (
      run_id GLOB '????????-????-4???-[89ab]???-????????????'
      AND length(run_id) = 36
    ),
  operation_id TEXT NOT NULL UNIQUE
    CHECK (
      operation_id GLOB '????????-????-4???-[89ab]???-????????????'
      AND length(operation_id) = 36
    ),
  work_key TEXT NOT NULL UNIQUE,
  generation INTEGER NOT NULL CHECK (generation >= 0),
  original_requested_at INTEGER NOT NULL CHECK (original_requested_at >= 0),
  queue_body_digest TEXT NOT NULL CHECK (length(queue_body_digest) = 64),
  status TEXT NOT NULL CHECK (
    status IN (
      'live_validated',
      'send_pending',
      'queued',
      'processing',
      'completed',
      'failed_retryable',
      'failed_permanent'
    )
  ),
  send_attempts INTEGER NOT NULL DEFAULT 0 CHECK (send_attempts >= 0),
  last_queue_message_id TEXT,
  last_error_code TEXT,
  reconciliation_json TEXT CHECK (
    reconciliation_json IS NULL
    OR (
      json_valid(reconciliation_json)
      AND length(CAST(reconciliation_json AS BLOB)) <= 262144
    )
  ),
  queued_at INTEGER,
  processing_at INTEGER,
  completed_at INTEGER,
  payload_redacted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (run_id) REFERENCES google_ads_delivery_runs(run_id) ON DELETE CASCADE,
  CHECK (operation_id = run_id),
  CHECK (work_key = 'google_ads:' || operation_id),
  CHECK (generation = original_requested_at),
  CHECK (status <> 'queued' OR queued_at IS NOT NULL),
  CHECK (status <> 'processing' OR processing_at IS NOT NULL),
  CHECK (status <> 'completed' OR completed_at IS NOT NULL),
  CHECK (payload_redacted_at IS NULL OR completed_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_live_admissions_status_updated
ON google_ads_live_admissions(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_google_ads_live_admissions_operation
ON google_ads_live_admissions(operation_id, generation);
