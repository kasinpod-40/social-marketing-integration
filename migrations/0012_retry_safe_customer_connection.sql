-- Retry-safe invitation lifecycle.
-- Existing invitations keep max_attempts=1; new v2 invitations write their explicit bounded limit.

ALTER TABLE connection_invitations
  ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0
  CHECK (attempt_count >= 0);

ALTER TABLE connection_invitations
  ADD COLUMN max_attempts INTEGER NOT NULL DEFAULT 1
  CHECK (max_attempts BETWEEN 1 AND 5);

ALTER TABLE connection_invitations
  ADD COLUMN active_attempt_id TEXT;

ALTER TABLE connection_invitations
  ADD COLUMN active_attempt_expires_at INTEGER;

CREATE UNIQUE INDEX IF NOT EXISTS idx_connection_invitations_active_attempt
  ON connection_invitations(active_attempt_id)
  WHERE active_attempt_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_connection_invitations_retryable
  ON connection_invitations(
    connector_key,
    customer_key,
    consumed_at,
    expires_at,
    attempt_count,
    active_attempt_expires_at
  );
