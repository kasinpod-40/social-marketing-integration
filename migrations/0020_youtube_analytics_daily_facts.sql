-- YouTube Owner Analytics period facts move from customer-visible Lark RAW into D1.
-- Source dates are Pacific calendar dates supplied by YouTube Analytics and must not be
-- converted into cumulative Organic observations.
CREATE TABLE IF NOT EXISTS youtube_analytics_daily_facts (
  analytics_daily_key TEXT PRIMARY KEY,
  customer_profile TEXT NOT NULL,
  customer_key TEXT NOT NULL,
  account_key TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  video_id TEXT NOT NULL,
  source_metric_date TEXT NOT NULL,
  views INTEGER,
  likes INTEGER,
  comments INTEGER,
  shares INTEGER,
  estimated_minutes_watched REAL,
  average_view_duration_seconds REAL,
  average_view_percentage REAL,
  fetched_at INTEGER NOT NULL,
  source_payload_json TEXT NOT NULL,
  sync_run_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  CHECK (source_metric_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'),
  CHECK (estimated_minutes_watched IS NULL OR estimated_minutes_watched >= 0),
  CHECK (average_view_duration_seconds IS NULL OR average_view_duration_seconds >= 0),
  CHECK (average_view_percentage IS NULL OR average_view_percentage >= 0)
);

CREATE INDEX IF NOT EXISTS idx_youtube_analytics_daily_account_date
  ON youtube_analytics_daily_facts(customer_key, account_key, source_metric_date);

CREATE INDEX IF NOT EXISTS idx_youtube_analytics_daily_video_date
  ON youtube_analytics_daily_facts(channel_id, video_id, source_metric_date);
