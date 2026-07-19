-- Durable staging สำหรับ Page/Chunk work ที่ต้อง Resume ข้าม Queue retry
-- ตารางนี้ไม่ใช่ Business checkpoint: source_record_states/sync_cursors ยัง Commit หลัง Lark writes สำเร็จเท่านั้น

CREATE TABLE IF NOT EXISTS sync_work_runs (
  work_key TEXT PRIMARY KEY,
  cursor_key TEXT NOT NULL,
  work_type TEXT NOT NULL,
  operation_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_work_runs_cursor_updated
ON sync_work_runs(cursor_key, updated_at DESC);

CREATE TABLE IF NOT EXISTS sync_work_phases (
  work_key TEXT NOT NULL,
  phase TEXT NOT NULL,
  state_json TEXT NOT NULL DEFAULT '{}',
  expected_items INTEGER NOT NULL DEFAULT 0 CHECK (expected_items >= 0),
  processed_items INTEGER NOT NULL DEFAULT 0 CHECK (processed_items >= 0),
  pages_processed INTEGER NOT NULL DEFAULT 0 CHECK (pages_processed >= 0),
  chunks_processed INTEGER NOT NULL DEFAULT 0 CHECK (chunks_processed >= 0),
  complete INTEGER NOT NULL DEFAULT 0 CHECK (complete IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(work_key, phase)
);

CREATE INDEX IF NOT EXISTS idx_sync_work_phases_work_complete
ON sync_work_phases(work_key, complete, updated_at DESC);

CREATE TABLE IF NOT EXISTS sync_work_units (
  work_key TEXT NOT NULL,
  phase TEXT NOT NULL,
  unit_key TEXT NOT NULL,
  sequence INTEGER NOT NULL CHECK (sequence >= 0),
  payload_json TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY(work_key, phase, unit_key),
  UNIQUE(work_key, phase, sequence)
);

CREATE INDEX IF NOT EXISTS idx_sync_work_units_phase_sequence
ON sync_work_units(work_key, phase, sequence);
