-- Signed Google Ads Manager Script ingress: replay nonce + bounded durable payload/idempotency.
CREATE TABLE IF NOT EXISTS google_ads_delivery_nonces (
  nonce TEXT PRIMARY KEY,
  key_id TEXT NOT NULL,
  content_sha256 TEXT NOT NULL,
  received_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_google_ads_delivery_nonces_expires
  ON google_ads_delivery_nonces(expires_at);

CREATE TABLE IF NOT EXISTS google_ads_deliveries (
  idempotency_key TEXT PRIMARY KEY,
  delivery_id TEXT NOT NULL UNIQUE,
  content_sha256 TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('PREVIEW', 'LIVE')),
  status TEXT NOT NULL CHECK (status IN (
    'reserved', 'preview_validated', 'queue_failed', 'queued', 'processing',
    'failed_retryable', 'failed_permanent', 'completed'
  )),
  payload_json TEXT NOT NULL,
  payload_expires_at INTEGER NOT NULL,
  queue_attempts INTEGER NOT NULL DEFAULT 0,
  queued_at INTEGER,
  processing_at INTEGER,
  completed_at INTEGER,
  reconciliation_json TEXT,
  last_error_code TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_google_ads_deliveries_status_updated
  ON google_ads_deliveries(status, updated_at);
CREATE INDEX IF NOT EXISTS idx_google_ads_deliveries_payload_expiry
  ON google_ads_deliveries(payload_expires_at);
