-- Google Ads Manager Script signed-delivery transport state.
-- Additive only: this schema stages authenticated chunks and does not authorize Queue or Business writes.

CREATE TABLE IF NOT EXISTS google_ads_delivery_nonces (
  nonce_fingerprint TEXT PRIMARY KEY
    CHECK (length(nonce_fingerprint) = 43),
  request_timestamp_seconds INTEGER NOT NULL
    CHECK (request_timestamp_seconds >= 0),
  received_at INTEGER NOT NULL
    CHECK (received_at >= 0),
  expires_at INTEGER NOT NULL
    CHECK (expires_at >= received_at + 900000)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_delivery_nonces_expiry
ON google_ads_delivery_nonces(expires_at);

CREATE TABLE IF NOT EXISTS google_ads_delivery_runs (
  run_id TEXT PRIMARY KEY
    CHECK (
      run_id GLOB '????????-????-4???-[89ab]???-????????????'
      AND length(run_id) = 36
    ),
  run_fingerprint TEXT NOT NULL UNIQUE
    CHECK (length(run_fingerprint) = 43),
  schema_version TEXT NOT NULL
    CHECK (schema_version = 'google_ads_manager_script_signed_delivery_v1'),
  mode TEXT NOT NULL
    CHECK (mode IN ('PREVIEW', 'LIVE')),
  run_started_at INTEGER NOT NULL
    CHECK (run_started_at >= 0),
  identity_fingerprint TEXT NOT NULL
    CHECK (length(identity_fingerprint) = 64),
  source_timezone TEXT NOT NULL,
  manifest_json TEXT NOT NULL
    CHECK (
      json_valid(manifest_json)
      AND length(CAST(manifest_json AS BLOB)) <= 4096
    ),
  manifest_digest TEXT NOT NULL
    CHECK (length(manifest_digest) = 64),
  expected_chunk_count INTEGER NOT NULL
    CHECK (expected_chunk_count BETWEEN 1 AND 64),
  expected_row_count INTEGER NOT NULL
    CHECK (expected_row_count >= 1),
  received_chunk_count INTEGER NOT NULL DEFAULT 0
    CHECK (
      received_chunk_count >= 0
      AND received_chunk_count <= expected_chunk_count
    ),
  received_row_count INTEGER NOT NULL DEFAULT 0
    CHECK (received_row_count >= 0),
  status TEXT NOT NULL
    CHECK (status IN ('assembling', 'preview_validated', 'invalid', 'expired')),
  error_code TEXT,
  expires_at INTEGER NOT NULL
    CHECK (expires_at > run_started_at),
  payload_retention_until INTEGER NOT NULL
    CHECK (payload_retention_until >= expires_at),
  audit_expires_at INTEGER NOT NULL
    CHECK (audit_expires_at >= payload_retention_until),
  completed_at INTEGER,
  payload_redacted_at INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (status <> 'preview_validated' OR completed_at IS NOT NULL),
  CHECK (payload_redacted_at IS NULL OR payload_redacted_at >= created_at)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_delivery_runs_status_expiry
ON google_ads_delivery_runs(status, expires_at);

CREATE INDEX IF NOT EXISTS idx_google_ads_delivery_runs_audit_expiry
ON google_ads_delivery_runs(audit_expires_at);

CREATE TABLE IF NOT EXISTS google_ads_delivery_chunks (
  idempotency_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  dataset_key TEXT NOT NULL
    CHECK (
      dataset_key IN (
        'account',
        'campaigns',
        'adGroups',
        'ads',
        'youtubeAssets',
        'campaignDailyMetrics'
      )
    ),
  chunk_index INTEGER NOT NULL
    CHECK (chunk_index BETWEEN 0 AND 63),
  chunk_count INTEGER NOT NULL
    CHECK (chunk_count BETWEEN 1 AND 64),
  total_rows INTEGER NOT NULL
    CHECK (total_rows >= 1),
  row_count INTEGER NOT NULL
    CHECK (row_count BETWEEN 1 AND 500),
  body_digest TEXT NOT NULL
    CHECK (length(body_digest) = 64),
  payload_json TEXT
    CHECK (
      payload_json IS NULL
      OR (
        json_valid(payload_json)
        AND length(CAST(payload_json AS BLOB)) <= 524288
      )
    ),
  payload_bytes INTEGER NOT NULL
    CHECK (payload_bytes BETWEEN 1 AND 524288),
  reservation_id TEXT NOT NULL UNIQUE,
  received_at INTEGER NOT NULL,
  redacted_at INTEGER,
  UNIQUE(run_id, dataset_key, chunk_index),
  FOREIGN KEY (run_id) REFERENCES google_ads_delivery_runs(run_id) ON DELETE CASCADE,
  CHECK (chunk_index < chunk_count),
  CHECK (redacted_at IS NULL OR payload_json IS NULL)
);

CREATE INDEX IF NOT EXISTS idx_google_ads_delivery_chunks_run_dataset
ON google_ads_delivery_chunks(run_id, dataset_key, chunk_index);
