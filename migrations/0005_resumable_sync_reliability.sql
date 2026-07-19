-- Generation fence, durable completion/warning outbox และ terminal lifecycle
-- Migration นี้ต้อง Apply ตอน YouTube producer ถูกปิด, Queue drain แล้ว และไม่มี Active lock/work
-- Guard ด้านล่างทำให้ Apply ล้มแบบ fail-closed หากยังมีงานเก่าระหว่างทำงาน

DROP TABLE IF EXISTS _mkt_migration_0005_guard;
CREATE TABLE _mkt_migration_0005_guard (
  active_work_count INTEGER NOT NULL CHECK (active_work_count = 0),
  active_lock_count INTEGER NOT NULL CHECK (active_lock_count = 0)
);

INSERT INTO _mkt_migration_0005_guard (active_work_count, active_lock_count)
SELECT
  (SELECT COUNT(*) FROM sync_work_runs),
  (SELECT COUNT(*) FROM sync_locks
   WHERE expires_at > CAST(strftime('%s', 'now') AS INTEGER) * 1000);

DROP TABLE _mkt_migration_0005_guard;

ALTER TABLE sync_work_runs ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_work_runs ADD COLUMN requested_at INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_work_runs ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'active'
  CHECK (lifecycle_status IN ('active', 'completed', 'terminal', 'superseded'));
ALTER TABLE sync_work_runs ADD COLUMN terminal_reason TEXT;
ALTER TABLE sync_work_runs ADD COLUMN abandoned_at INTEGER;
ALTER TABLE sync_work_runs ADD COLUMN completed_at INTEGER;
ALTER TABLE sync_work_runs ADD COLUMN expires_at INTEGER;
ALTER TABLE sync_work_runs ADD COLUMN audit_reference TEXT;
ALTER TABLE sync_work_runs ADD COLUMN completion_json TEXT;

CREATE INDEX IF NOT EXISTS idx_sync_work_runs_cursor_generation
ON sync_work_runs(cursor_key, generation DESC);

CREATE INDEX IF NOT EXISTS idx_sync_work_runs_lifecycle_expires
ON sync_work_runs(lifecycle_status, expires_at);

CREATE TABLE IF NOT EXISTS sync_generation_fences (
  cursor_key TEXT PRIMARY KEY,
  generation INTEGER NOT NULL,
  requested_at INTEGER NOT NULL,
  work_key TEXT NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_generation_fences_generation
ON sync_generation_fences(generation DESC, updated_at DESC);

ALTER TABLE sync_cursors ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
ALTER TABLE sync_cursors ADD COLUMN generation_work_key TEXT;
ALTER TABLE sync_cursors ADD COLUMN requested_at INTEGER NOT NULL DEFAULT 0;

-- Bootstrap จาก Business checkpoint ที่สำเร็จล่าสุด เพื่อกัน Queue retry รุ่นเก่า
-- หลัง Deploy source ใหม่ Job ต้องมี requestedAt ใหม่กว่า checkpoint นี้จึง Claim fence ได้
UPDATE sync_cursors
SET generation = last_successful_sync_at,
    requested_at = last_successful_sync_at,
    generation_work_key = 'legacy-checkpoint:' || cursor_key
WHERE generation = 0;

INSERT INTO sync_generation_fences (
  cursor_key, generation, requested_at, work_key, updated_at
)
SELECT
  cursor_key,
  generation,
  requested_at,
  generation_work_key,
  updated_at
FROM sync_cursors
WHERE generation > 0
ON CONFLICT(cursor_key) DO UPDATE SET
  generation = excluded.generation,
  requested_at = excluded.requested_at,
  work_key = excluded.work_key,
  updated_at = excluded.updated_at
WHERE excluded.generation > sync_generation_fences.generation;

CREATE INDEX IF NOT EXISTS idx_sync_cursors_generation
ON sync_cursors(cursor_key, generation DESC);

CREATE TABLE IF NOT EXISTS sync_warning_outbox (
  outbox_id TEXT PRIMARY KEY,
  work_key TEXT NOT NULL,
  sync_run_id TEXT NOT NULL,
  warning_type TEXT NOT NULL,
  source_key TEXT NOT NULL,
  payload_json TEXT NOT NULL DEFAULT '{}',
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered')),
  delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  delivered_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_sync_warning_outbox_status_updated
ON sync_warning_outbox(status, updated_at);

CREATE INDEX IF NOT EXISTS idx_sync_warning_outbox_work_status
ON sync_warning_outbox(work_key, status);


ALTER TABLE dead_letter_jobs ADD COLUMN replay_payload_json TEXT;
ALTER TABLE dead_letter_jobs ADD COLUMN redrive_requested_at INTEGER;
ALTER TABLE dead_letter_jobs ADD COLUMN redrive_reference TEXT;
ALTER TABLE dead_letter_jobs ADD COLUMN redriven_at INTEGER;

CREATE INDEX IF NOT EXISTS idx_dead_letter_jobs_redrive_status
ON dead_letter_jobs(status, redrive_requested_at DESC);
