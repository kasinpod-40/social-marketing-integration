-- Generation fence, durable completion/warning outbox และ terminal lifecycle
-- เป็น additive migration เพื่อไม่เปลี่ยน Contract เดิมของ TikTok/Core

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

UPDATE sync_work_runs
SET generation = created_at,
    requested_at = created_at
WHERE generation = 0 OR requested_at = 0;

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
