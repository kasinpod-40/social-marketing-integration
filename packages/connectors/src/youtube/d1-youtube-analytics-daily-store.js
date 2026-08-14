import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const TABLE_NAME = 'youtube_analytics_daily_facts';
const DEFAULT_BATCH_SIZE = 50;
const MAX_BATCH_SIZE = 100;
const DEFAULT_READ_LIMIT = 50_000;
const MAX_READ_LIMIT = 100_000;

/** Durable authority for YouTube Owner Analytics period facts. */
export class D1YouTubeAnalyticsDailyStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async assertSchemaReady() {
    try {
      const row = await this.db.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?",
      ).bind(TABLE_NAME).first();
      if (row?.name !== TABLE_NAME) {
        throw permanentError('YouTube Analytics D1 storage schema is not ready', {
          code: 'D1_YOUTUBE_ANALYTICS_SCHEMA_NOT_READY',
          details: { missingTables: [TABLE_NAME] },
        });
      }
      return Object.freeze({ ready: true, tables: Object.freeze([TABLE_NAME]) });
    } catch (cause) {
      if (cause?.code === 'D1_YOUTUBE_ANALYTICS_SCHEMA_NOT_READY') throw cause;
      throw transientError('Failed to inspect YouTube Analytics D1 schema', {
        code: 'D1_YOUTUBE_ANALYTICS_SCHEMA_CHECK_FAILED',
        cause,
      });
    }
  }

  async upsertMany(values, context = {}) {
    const rows = requireArray(values, 'values').map((value) => normalizeRow(value, context));
    const batchSize = boundedInteger(context.batchSize ?? DEFAULT_BATCH_SIZE, 'batchSize', 1, MAX_BATCH_SIZE);
    let written = 0;
    let skipped = 0;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      let results;
      try {
        results = await this.db.batch(batch.map((row) => this.db.prepare(`
          INSERT INTO youtube_analytics_daily_facts (
            analytics_daily_key, customer_profile, customer_key, account_key, channel_id,
            video_id, source_metric_date, views, likes, comments, shares,
            estimated_minutes_watched, average_view_duration_seconds, average_view_percentage,
            fetched_at, source_payload_json, sync_run_id, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(analytics_daily_key) DO UPDATE SET
            customer_profile = excluded.customer_profile,
            customer_key = excluded.customer_key,
            account_key = excluded.account_key,
            channel_id = excluded.channel_id,
            video_id = excluded.video_id,
            source_metric_date = excluded.source_metric_date,
            views = excluded.views,
            likes = excluded.likes,
            comments = excluded.comments,
            shares = excluded.shares,
            estimated_minutes_watched = excluded.estimated_minutes_watched,
            average_view_duration_seconds = excluded.average_view_duration_seconds,
            average_view_percentage = excluded.average_view_percentage,
            fetched_at = excluded.fetched_at,
            source_payload_json = excluded.source_payload_json,
            sync_run_id = excluded.sync_run_id,
            updated_at = excluded.updated_at
          WHERE excluded.fetched_at > youtube_analytics_daily_facts.fetched_at
            OR (
              excluded.fetched_at = youtube_analytics_daily_facts.fetched_at
              AND (
                excluded.customer_profile IS NOT youtube_analytics_daily_facts.customer_profile
                OR excluded.customer_key IS NOT youtube_analytics_daily_facts.customer_key
                OR excluded.account_key IS NOT youtube_analytics_daily_facts.account_key
                OR excluded.channel_id IS NOT youtube_analytics_daily_facts.channel_id
                OR excluded.video_id IS NOT youtube_analytics_daily_facts.video_id
                OR excluded.source_metric_date IS NOT youtube_analytics_daily_facts.source_metric_date
                OR excluded.views IS NOT youtube_analytics_daily_facts.views
                OR excluded.likes IS NOT youtube_analytics_daily_facts.likes
                OR excluded.comments IS NOT youtube_analytics_daily_facts.comments
                OR excluded.shares IS NOT youtube_analytics_daily_facts.shares
                OR excluded.estimated_minutes_watched IS NOT youtube_analytics_daily_facts.estimated_minutes_watched
                OR excluded.average_view_duration_seconds IS NOT youtube_analytics_daily_facts.average_view_duration_seconds
                OR excluded.average_view_percentage IS NOT youtube_analytics_daily_facts.average_view_percentage
                OR excluded.source_payload_json IS NOT youtube_analytics_daily_facts.source_payload_json
              )
            )
        `).bind(...rowBindings(row))));
      } catch (cause) {
        throw transientError('Failed to write YouTube Analytics D1 facts', {
          code: 'D1_YOUTUBE_ANALYTICS_WRITE_FAILED',
          cause,
        });
      }
      for (const result of results) {
        if (Number(result?.meta?.changes ?? 0) > 0) written += 1;
        else skipped += 1;
      }
    }
    return Object.freeze({ rows: rows.length, written, skipped });
  }

  async listStableKeysByScope(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const channelId = requireText(input.channelId, 'channelId');
    const startDate = requireDate(input.startDate, 'startDate');
    const endDate = requireDate(input.endDate, 'endDate');
    if (endDate < startDate) throw invalid('endDate cannot be before startDate', 'endDate');
    const videoIds = new Set(requireArray(input.videoIds, 'videoIds').map((value) => requireText(value, 'videoId')));
    const limit = boundedInteger(input.limit ?? DEFAULT_READ_LIMIT, 'limit', 1, MAX_READ_LIMIT);
    let result;
    try {
      result = await this.db.prepare(`
        SELECT analytics_daily_key, video_id
        FROM youtube_analytics_daily_facts
        WHERE customer_key = ? AND account_key = ? AND channel_id = ?
          AND source_metric_date >= ? AND source_metric_date <= ?
        ORDER BY analytics_daily_key ASC
        LIMIT ?
      `).bind(customerKey, accountKey, channelId, startDate, endDate, limit + 1).all();
    } catch (cause) {
      throw transientError('Failed to read YouTube Analytics D1 facts', {
        code: 'D1_YOUTUBE_ANALYTICS_READ_FAILED',
        cause,
      });
    }
    const rows = Array.isArray(result) ? result : (result?.results ?? []);
    if (rows.length > limit) {
      throw permanentError('YouTube Analytics D1 reconciliation exceeded its bound', {
        code: 'D1_YOUTUBE_ANALYTICS_READ_LIMIT_EXCEEDED',
        details: { limit },
      });
    }
    return Object.freeze(rows
      .filter((row) => videoIds.has(String(row.video_id)))
      .map((row) => requireText(row.analytics_daily_key, 'analytics_daily_key')));
  }
}

function normalizeRow(value, context) {
  const row = requireObject(value, 'value');
  const fetchedAt = safeTimestamp(row.fetched_at, 'fetched_at');
  return Object.freeze({
    analytics_daily_key: requireText(row.raw_analytics_daily_key, 'raw_analytics_daily_key'),
    customer_profile: requireText(context.customerProfile, 'customerProfile'),
    customer_key: requireText(context.customerKey, 'customerKey'),
    account_key: requireText(context.accountKey, 'accountKey'),
    channel_id: requireText(row.channel_id, 'channel_id'),
    video_id: requireText(row.video_id, 'video_id'),
    source_metric_date: requireDate(row.source_metric_date, 'source_metric_date'),
    views: nullableSafeInteger(row.views, 'views'),
    likes: nullableSafeInteger(row.likes, 'likes'),
    comments: nullableSafeInteger(row.comments, 'comments'),
    shares: nullableSafeInteger(row.shares, 'shares'),
    estimated_minutes_watched: nullableNonNegative(row.estimated_minutes_watched, 'estimated_minutes_watched'),
    average_view_duration_seconds: nullableNonNegative(row.average_view_duration_seconds, 'average_view_duration_seconds'),
    average_view_percentage: nullableNonNegative(row.average_view_percentage, 'average_view_percentage'),
    fetched_at: fetchedAt,
    source_payload_json: requireJson(row.source_payload_json, 'source_payload_json'),
    sync_run_id: requireText(context.syncRunId, 'syncRunId'),
    created_at: fetchedAt,
    updated_at: fetchedAt,
  });
}

function rowBindings(row) {
  return [
    row.analytics_daily_key, row.customer_profile, row.customer_key, row.account_key,
    row.channel_id, row.video_id, row.source_metric_date, row.views, row.likes,
    row.comments, row.shares, row.estimated_minutes_watched,
    row.average_view_duration_seconds, row.average_view_percentage, row.fetched_at,
    row.source_payload_json, row.sync_run_id, row.created_at, row.updated_at,
  ];
}

function requireD1(value) {
  if (!value || typeof value.prepare !== 'function' || typeof value.batch !== 'function') {
    throw new TypeError('D1YouTubeAnalyticsDailyStore requires a D1 binding');
  }
  return value;
}
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw invalid(`${fieldName} must be an array`, fieldName);
  return value;
}
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw invalid(`${fieldName} must be an object`, fieldName);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw invalid(`${fieldName} is required`, fieldName);
  return value.trim();
}
function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw invalid(`${fieldName} must be YYYY-MM-DD`, fieldName);
  }
  return text;
}
function requireJson(value, fieldName) {
  const text = requireText(value, fieldName);
  try { JSON.parse(text); } catch { throw invalid(`${fieldName} must contain valid JSON`, fieldName); }
  return text;
}
function safeTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw invalid(`${fieldName} must be a non-negative safe timestamp`, fieldName);
  return number;
}
function nullableSafeInteger(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (!Number.isSafeInteger(value)) throw invalid(`${fieldName} must be a safe integer or null`, fieldName);
  return value;
}
function nullableNonNegative(value, fieldName) {
  if (value === null || value === undefined) return null;
  if (!Number.isFinite(value) || value < 0) throw invalid(`${fieldName} must be finite, non-negative or null`, fieldName);
  return value;
}
function boundedInteger(value, fieldName, minimum, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < minimum || number > maximum) {
    throw invalid(`${fieldName} must be an integer from ${minimum} to ${maximum}`, fieldName);
  }
  return number;
}
function invalid(message, fieldName) {
  return permanentError(message, {
    code: 'D1_YOUTUBE_ANALYTICS_INPUT_INVALID',
    details: { fieldName },
  });
}
