-- ผู้ใช้อนุมัติให้เก็บ Instagram token ใน D1 แบบ AES-256-GCM; คีย์ถอดรหัสอยู่ใน Worker Secret เท่านั้น
CREATE TABLE IF NOT EXISTS instagram_token_credentials (
  customer_profile TEXT PRIMARY KEY,
  algorithm TEXT NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  key_version TEXT NOT NULL,
  iv TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  token_expires_at INTEGER NOT NULL,
  data_access_expires_at INTEGER,
  last_refresh_at INTEGER,
  last_attempt_at INTEGER,
  status TEXT NOT NULL CHECK (status IN ('active', 'refresh_failed')),
  last_error_code TEXT,
  updated_at INTEGER NOT NULL
);
