-- Lark executive notification delivery runtime state.
-- Additive and replay-safe. D1 is the delivery authority; Lark Notification Log is a customer-facing mirror.

CREATE TABLE IF NOT EXISTS lark_notification_deliveries (
  notification_attempt_key TEXT PRIMARY KEY,
  ai_run_key TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  report_id TEXT NOT NULL,
  report_setting_key TEXT NOT NULL,
  customer_profile TEXT NOT NULL,
  destination_key_hash TEXT NOT NULL,
  template_version TEXT NOT NULL,
  payload_checksum TEXT NOT NULL,
  status TEXT NOT NULL
    CHECK (status IN (
      'claimed',
      'sending',
      'sent',
      'deduped',
      'blocked',
      'blocked_unknown'
    )),
  claim_owner TEXT,
  lease_expires_at INTEGER,
  claim_count INTEGER NOT NULL DEFAULT 1 CHECK (claim_count >= 1),
  attempted_at INTEGER,
  sent_at INTEGER,
  lark_message_id_hash TEXT,
  mirror_status TEXT NOT NULL DEFAULT 'pending'
    CHECK (mirror_status IN ('pending', 'mirrored', 'failed')),
  mirrored_at INTEGER,
  error_code TEXT,
  redacted_error_message TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE(ai_run_key, dedupe_key, destination_key_hash),
  CHECK (length(payload_checksum) = 64),
  CHECK (length(destination_key_hash) = 64),
  CHECK (status <> 'sent' OR sent_at IS NOT NULL),
  CHECK (status <> 'sending' OR attempted_at IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_lark_notification_delivery_status_lease
  ON lark_notification_deliveries(status, lease_expires_at);

CREATE INDEX IF NOT EXISTS idx_lark_notification_delivery_ai_run
  ON lark_notification_deliveries(ai_run_key, updated_at);

CREATE INDEX IF NOT EXISTS idx_lark_notification_delivery_mirror
  ON lark_notification_deliveries(mirror_status, updated_at);
