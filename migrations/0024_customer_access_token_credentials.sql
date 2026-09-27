-- TikTok Ads ใช้ long-term access token; ขยายชนิดใน Shared encrypted repository เดิม
-- D1 รัน migration ใน transaction; copy ciphertext/reference เดิมโดยไม่ถอดรหัสหรือเปลี่ยน AAD
PRAGMA defer_foreign_keys = ON;

CREATE TABLE encrypted_credentials_access_token_new (
  credential_reference TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  credential_kind TEXT NOT NULL
    CHECK (credential_kind IN ('refresh_token', 'pkce_verifier', 'access_token')),
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  algorithm TEXT NOT NULL CHECK (algorithm = 'AES-256-GCM'),
  key_version TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'replaced', 'revoked')),
  replaced_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revoked_at INTEGER,
  FOREIGN KEY (connection_id) REFERENCES connections(id),
  FOREIGN KEY (replaced_by) REFERENCES encrypted_credentials_access_token_new(credential_reference),
  CHECK (revoked_at IS NULL OR status = 'revoked')
);

INSERT INTO encrypted_credentials_access_token_new
SELECT * FROM encrypted_credentials;
DROP TABLE encrypted_credentials;
ALTER TABLE encrypted_credentials_access_token_new RENAME TO encrypted_credentials;

CREATE INDEX IF NOT EXISTS idx_encrypted_credentials_connection_status
  ON encrypted_credentials(connection_id, credential_kind, status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_encrypted_credentials_one_active
  ON encrypted_credentials(connection_id, credential_kind)
  WHERE status = 'active';

PRAGMA defer_foreign_keys = OFF;
