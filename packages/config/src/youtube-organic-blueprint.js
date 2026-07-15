/**
 * YouTube Organic Data Model ก่อน Live implementation
 * type ใช้ Lark Bitable field type: Text=1, Number=2, SingleSelect=3, DateTime=5, Checkbox=7, URL=15
 */
export const YOUTUBE_ORGANIC_BLUEPRINT_VERSION = 'youtube-organic-v1';

export const YOUTUBE_ORGANIC_SOURCE_CONTRACT = deepFreeze({
  authModes: {
    publicData: 'api_key_or_oauth',
    ownerAnalytics: 'oauth_required',
  },
  dataApi: {
    channelParts: ['snippet', 'contentDetails', 'statistics', 'status'],
    uploadsParts: ['contentDetails'],
    videoParts: ['snippet', 'contentDetails', 'statistics', 'status'],
    maxPlaylistPageSize: 50,
    maxVideoBatchSize: 50,
  },
  analyticsApi: {
    storageMode: 'separate_period_metrics',
    reason: 'Owner Analytics rows are period metrics and must not overwrite cumulative Data API snapshots.',
  },
  stableKeys: {
    account: 'youtube:{account_key}',
    content: 'youtube:{account_key}:{video_id}',
    contentDaily: 'youtube:{account_key}:{video_id}:{metric_date}',
    rawVideo: 'youtube:{channel_id}:{video_id}',
    rawAnalyticsDaily: 'youtube:{channel_id}:{video_id}:{metric_date}',
  },
  nullSemantics: {
    unsupported: 'null',
    missing: 'null',
    zero: 'only_when_source_explicitly_returns_zero',
    hiddenSubscriberCount: 'subscriber_count=null',
  },
});

export const YOUTUBE_LARK_BLUEPRINT = deepFreeze([
  {
    key: 'rawYouTubeChannels',
    tableName: 'RAW_YouTube_Channels',
    primaryField: 'raw_channel_key',
    fields: [
      field('raw_channel_key', 1, true), field('channel_id', 1), field('title', 1),
      field('uploads_playlist_id', 1), field('view_count', 2), field('subscriber_count', 2),
      field('video_count', 2), field('fetched_at', 5), field('source_payload_json', 1),
    ],
  },
  {
    key: 'rawYouTubeVideos',
    tableName: 'RAW_YouTube_Videos',
    primaryField: 'raw_video_key',
    fields: [
      field('raw_video_key', 1, true), field('channel_id', 1), field('video_id', 1),
      field('published_at', 5), field('title', 1), field('description', 1), field('video_url', 15),
      field('thumbnail_url', 15), field('duration_seconds', 2), field('view_count', 2),
      field('like_count', 2), field('comment_count', 2), field('privacy_status', 3),
      field('etag', 1), field('fetched_at', 5), field('source_payload_json', 1),
    ],
  },
  {
    key: 'rawYouTubeAnalyticsDaily',
    tableName: 'RAW_YouTube_Analytics_Daily',
    primaryField: 'raw_analytics_daily_key',
    fields: [
      field('raw_analytics_daily_key', 1, true), field('metric_date', 5), field('channel_id', 1),
      field('video_id', 1), field('views', 2), field('likes', 2), field('comments', 2),
      field('shares', 2), field('estimated_minutes_watched', 2), field('average_view_duration_seconds', 2),
      field('average_view_percentage', 2), field('fetched_at', 5), field('source_payload_json', 1),
    ],
  },
]);

export const YOUTUBE_DESTINATION_MAPPING = deepFreeze({
  MKT_Accounts: {
    stableKey: 'youtube:{account_key}',
    source: 'RAW_YouTube_Channels',
  },
  MKT_Content: {
    stableKey: 'youtube:{account_key}:{video_id}',
    source: 'RAW_YouTube_Videos',
    cumulativeMetrics: ['latest_views', 'latest_likes', 'latest_comments'],
    unsupportedAsNull: ['latest_shares', 'latest_unique_viewers', 'avg_watch_time_seconds', 'completion_rate'],
  },
  MKT_Content_Daily: {
    stableKey: 'youtube:{account_key}:{video_id}:{metric_date}',
    source: 'RAW_YouTube_Videos',
    semantics: 'cumulative_snapshot',
  },
});

function field(fieldName, type, primary = false) {
  return { fieldName, type, primary };
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
