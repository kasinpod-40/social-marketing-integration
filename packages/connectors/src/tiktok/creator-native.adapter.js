export function mapTikTokCreatorVideoRow(row) {
  return {
    platform: 'tiktok',
    externalContentId: row?.video_id ?? row?.['Unique identifier of the video'] ?? null,
    publishedAt: row?.published_at ?? row?.['Date and time the video was published'] ?? null,
    description: row?.description ?? row?.['Video description'] ?? null,
    shareableUrl: row?.share_url ?? row?.['Shareable URL for this TikTok video'] ?? null,
    metrics: {
      views: toNullableNumber(row?.views ?? row?.['Total video views']),
      likes: toNullableNumber(row?.likes ?? row?.['Total number of likes the video received']),
      comments: toNullableNumber(row?.comments ?? row?.['Total number of comments the video received']),
      shares: toNullableNumber(row?.shares ?? row?.['Total number of times the video was shared']),
      averagePlayDuration: toNullableNumber(row?.average_play_duration ?? row?.['Average video play duration based on all views']),
      totalPlayDuration: toNullableNumber(row?.total_play_duration ?? row?.['Total video play duration based on all views']),
      completionRate: toNullableNumber(row?.completion_rate ?? row?.['Percentage of video watched completely']),
      uniqueViewers: toNullableNumber(row?.unique_viewers ?? row?.['Total number of viewers who watched the video (deduplicated)']),
    },
  };
}

function toNullableNumber(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const numericValue = Number(value);
  return Number.isFinite(numericValue) ? numericValue : null;
}
