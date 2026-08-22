-- Expand the signed Google Ads transport dataset constraint to include Asset Groups.
-- This rebuild preserves every existing staged chunk row and changes only the dataset_key CHECK list.

CREATE TABLE google_ads_delivery_chunks_next (
  idempotency_key TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  dataset_key TEXT NOT NULL
    CHECK (
      dataset_key IN (
        'account',
        'campaigns',
        'assetGroups',
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

INSERT INTO google_ads_delivery_chunks_next (
  idempotency_key,
  run_id,
  dataset_key,
  chunk_index,
  chunk_count,
  total_rows,
  row_count,
  body_digest,
  payload_json,
  payload_bytes,
  reservation_id,
  received_at,
  redacted_at
)
SELECT
  idempotency_key,
  run_id,
  dataset_key,
  chunk_index,
  chunk_count,
  total_rows,
  row_count,
  body_digest,
  payload_json,
  payload_bytes,
  reservation_id,
  received_at,
  redacted_at
FROM google_ads_delivery_chunks;

DROP TABLE google_ads_delivery_chunks;
ALTER TABLE google_ads_delivery_chunks_next RENAME TO google_ads_delivery_chunks;

CREATE INDEX idx_google_ads_delivery_chunks_run_dataset
ON google_ads_delivery_chunks(run_id, dataset_key, chunk_index);
