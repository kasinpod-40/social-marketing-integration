-- Durable outbox สำหรับ Mirror operational records จาก D1 ไป Lark แบบ non-blocking
-- D1 persistence เป็น Primary; Queue delivery สามารถ Retry/Replay ได้โดยไม่ทำให้ Primary write ย้อนกลับ

CREATE TABLE IF NOT EXISTS reliability_mirror_outbox (
  outbox_id TEXT PRIMARY KEY,
  mirror_method TEXT NOT NULL
    CHECK (mirror_method IN ('saveSyncRun', 'saveSystemAlert')),
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'delivered', 'failed_permanent')),
  revision INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  delivery_attempts INTEGER NOT NULL DEFAULT 0 CHECK (delivery_attempts >= 0),
  last_error_code TEXT,
  last_error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  delivered_at INTEGER
);

CREATE INDEX IF NOT EXISTS idx_reliability_mirror_outbox_status_updated
ON reliability_mirror_outbox(status, updated_at, outbox_id);
