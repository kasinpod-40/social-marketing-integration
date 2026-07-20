-- ขยาย Dead-letter lifecycle ให้รองรับ durable Redrive state
-- SQLite เปลี่ยน CHECK constraint เดิมด้วย ALTER TABLE ไม่ได้ จึง rebuild ตารางและรักษา rows เดิมทั้งหมด

DROP TABLE IF EXISTS _mkt_dead_letter_jobs_0006;

CREATE TABLE _mkt_dead_letter_jobs_0006 (
  dlq_id TEXT PRIMARY KEY,
  message_id TEXT,
  queue_name TEXT,
  job_type TEXT,
  schema_version INTEGER,
  payload_json TEXT NOT NULL DEFAULT '{}',
  replay_payload_json TEXT,
  error_code TEXT,
  error_message TEXT,
  retry_count INTEGER NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN (
      'open', 'replayed', 'resolved', 'discarded',
      'redrive_pending', 'redriven'
    )),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  redrive_requested_at INTEGER,
  redrive_reference TEXT,
  redriven_at INTEGER
);

INSERT INTO _mkt_dead_letter_jobs_0006 (
  dlq_id, message_id, queue_name, job_type, schema_version,
  payload_json, replay_payload_json,
  error_code, error_message, retry_count, status,
  created_at, updated_at,
  redrive_requested_at, redrive_reference, redriven_at
)
SELECT
  dlq_id, message_id, queue_name, job_type, schema_version,
  payload_json, replay_payload_json,
  error_code, error_message, retry_count, status,
  created_at, updated_at,
  redrive_requested_at, redrive_reference, redriven_at
FROM dead_letter_jobs;

DROP TABLE IF EXISTS _mkt_migration_0006_guard;
CREATE TABLE _mkt_migration_0006_guard (
  original_count INTEGER NOT NULL,
  copied_count INTEGER NOT NULL,
  CHECK (original_count = copied_count)
);

INSERT INTO _mkt_migration_0006_guard (original_count, copied_count)
SELECT
  (SELECT COUNT(*) FROM dead_letter_jobs),
  (SELECT COUNT(*) FROM _mkt_dead_letter_jobs_0006);

DROP TABLE _mkt_migration_0006_guard;
DROP TABLE dead_letter_jobs;
ALTER TABLE _mkt_dead_letter_jobs_0006 RENAME TO dead_letter_jobs;

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_status_created
ON dead_letter_jobs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_redrive_status
ON dead_letter_jobs(status, redrive_requested_at DESC);
