-- Shared Customer Connection/OAuth foundation.
-- Existing connections rows are preserved; legacy encrypted token columns remain unused.

ALTER TABLE connections ADD COLUMN customer_key TEXT;
ALTER TABLE connections ADD COLUMN connector_key TEXT;
ALTER TABLE connections ADD COLUMN provider TEXT;
ALTER TABLE connections ADD COLUMN external_account_id TEXT;
ALTER TABLE connections ADD COLUMN external_account_name TEXT;
ALTER TABLE connections ADD COLUMN credential_reference TEXT;
ALTER TABLE connections ADD COLUMN granted_scopes_json TEXT;
ALTER TABLE connections ADD COLUMN token_type TEXT;
ALTER TABLE connections ADD COLUMN last_refresh_at INTEGER;
ALTER TABLE connections ADD COLUMN last_validated_at INTEGER;
ALTER TABLE connections ADD COLUMN connection_status TEXT;
ALTER TABLE connections ADD COLUMN access_status TEXT;
ALTER TABLE connections ADD COLUMN last_error_code TEXT;
ALTER TABLE connections ADD COLUMN disconnected_at INTEGER;
ALTER TABLE connections ADD COLUMN provider_metadata_json TEXT;

CREATE INDEX IF NOT EXISTS idx_connections_customer_connector_status
  ON connections(customer_key, connector_key, connection_status, updated_at);

CREATE TABLE IF NOT EXISTS connection_invitations (
  invitation_id TEXT PRIMARY KEY,
  connector_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  environment TEXT NOT NULL,
  nonce_hash TEXT NOT NULL UNIQUE,
  redirect_uri TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  connection_id TEXT,
  created_at INTEGER NOT NULL,
  CHECK (expires_at > issued_at),
  CHECK (consumed_at IS NULL OR consumed_at >= issued_at),
  FOREIGN KEY (connection_id) REFERENCES connections(id)
);

CREATE INDEX IF NOT EXISTS idx_connection_invitations_expiry
  ON connection_invitations(connector_key, customer_key, expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS encrypted_credentials (
  credential_reference TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  credential_kind TEXT NOT NULL
    CHECK (credential_kind IN ('refresh_token', 'pkce_verifier')),
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
  FOREIGN KEY (replaced_by) REFERENCES encrypted_credentials(credential_reference),
  CHECK (revoked_at IS NULL OR status = 'revoked')
);

CREATE INDEX IF NOT EXISTS idx_encrypted_credentials_connection_status
  ON encrypted_credentials(connection_id, credential_kind, status, updated_at);

CREATE UNIQUE INDEX IF NOT EXISTS idx_encrypted_credentials_one_active
  ON encrypted_credentials(connection_id, credential_kind)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS oauth_state_attempts (
  attempt_id TEXT PRIMARY KEY,
  invitation_id TEXT NOT NULL,
  connection_id TEXT NOT NULL,
  connector_key TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  redirect_uri TEXT NOT NULL,
  nonce_hash TEXT NOT NULL UNIQUE,
  pkce_credential_reference TEXT,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  callback_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (expires_at > issued_at),
  CHECK (consumed_at IS NULL OR consumed_at >= issued_at),
  FOREIGN KEY (invitation_id) REFERENCES connection_invitations(invitation_id),
  FOREIGN KEY (connection_id) REFERENCES connections(id),
  FOREIGN KEY (pkce_credential_reference) REFERENCES encrypted_credentials(credential_reference)
);

CREATE INDEX IF NOT EXISTS idx_oauth_state_attempts_expiry
  ON oauth_state_attempts(connector_key, customer_key, expires_at, consumed_at);

CREATE TABLE IF NOT EXISTS connection_identity_selections (
  selection_id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL,
  connector_key TEXT NOT NULL CHECK (connector_key = 'youtube'),
  customer_key TEXT NOT NULL,
  nonce_hash TEXT NOT NULL UNIQUE,
  candidates_json TEXT NOT NULL CHECK (json_valid(candidates_json)),
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  consumed_at INTEGER,
  selected_external_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (expires_at > issued_at),
  CHECK (consumed_at IS NULL OR consumed_at >= issued_at),
  CHECK (selected_external_id IS NULL OR consumed_at IS NOT NULL),
  FOREIGN KEY (connection_id) REFERENCES connections(id)
);

CREATE INDEX IF NOT EXISTS idx_connection_identity_selections_expiry
  ON connection_identity_selections(connection_id, expires_at, consumed_at);
