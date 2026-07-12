-- Incremental checkpoint สำหรับ TikTok Creator และ Connector อื่นในอนาคต
-- D1 เก็บ Cursor/Record fingerprint เพื่อประมวลผลเฉพาะแถวที่เปลี่ยน

CREATE TABLE IF NOT EXISTS sync_cursors (
  cursor_key TEXT PRIMARY KEY,
  customer_profile TEXT NOT NULL,
  platform TEXT NOT NULL,
  account_key TEXT NOT NULL,
  source TEXT NOT NULL,
  sync_type TEXT NOT NULL,
  last_metric_date TEXT,
  dictionary_hash TEXT,
  last_full_sync_at INTEGER,
  last_successful_sync_at INTEGER NOT NULL,
  incremental_run_count INTEGER NOT NULL DEFAULT 0 CHECK (incremental_run_count >= 0),
  last_sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_cursors_profile_platform_account
ON sync_cursors(customer_profile, platform, account_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS source_record_states (
  cursor_key TEXT NOT NULL,
  source_record_id TEXT NOT NULL,
  source_modified_at INTEGER,
  source_hash TEXT NOT NULL,
  external_content_id TEXT,
  last_seen_sync_run_id TEXT NOT NULL,
  last_seen_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(cursor_key, source_record_id)
);

CREATE INDEX IF NOT EXISTS idx_source_record_states_cursor_modified
ON source_record_states(cursor_key, source_modified_at DESC);

CREATE INDEX IF NOT EXISTS idx_source_record_states_external_content
ON source_record_states(cursor_key, external_content_id);
