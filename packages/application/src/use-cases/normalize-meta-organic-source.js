import {
  assertMetaIdentity,
  requireMetaExternalId,
} from '../../../connectors/src/meta/meta-business-source.helpers.js';
import {
  dateOnlyForMetaInstant,
  deepFreezeMeta,
  normalizeMetaMetricValue,
  optionalMetaCount,
  optionalMetaText,
  optionalMetaTimestamp,
  optionalMetaUrl,
  requireMetaObject,
  requireMetaText,
  requireMetaTimestamp,
  safeMetaSourceJson,
} from '../../../connectors/src/meta/meta-business-normalization.helpers.js';

const ORGANIC_PLATFORMS = new Set(['facebook', 'instagram']);

/** แปลง Facebook Page/Instagram `/me` เป็น Shared Raw account row + pure candidate */
export function normalizeMetaOrganicAccountFixture(input = {}) {
  const platform = requirePlatform(input.platform);
  const resource = requireMetaObject(input.resource, 'account resource');
  const expectedAccountId = requireMetaExternalId(input.expectedAccountId, 'expectedAccountId');
  const sourceAccountId = platform === 'instagram'
    ? resource.user_id ?? resource.id
    : resource.id;
  assertMetaIdentity(
    sourceAccountId,
    expectedAccountId,
    platform === 'facebook'
      ? 'META_FACEBOOK_PAGE_IDENTITY_MISMATCH'
      : 'META_INSTAGRAM_ACCOUNT_IDENTITY_MISMATCH',
  );
  const fetchedAt = requireMetaTimestamp(input.fetchedAt, 'fetchedAt');
  const syncRunId = requireMetaText(input.syncRunId, 'syncRunId');
  const accountName = optionalMetaText(resource.name, 'name')
    ?? optionalMetaText(resource.username, 'username');
  if (!accountName) throw new TypeError('Meta account requires name or username');
  const accountType = normalizeAccountType(platform, resource.account_type);

  const rawRow = {
    raw_account_key: `${platform}:${expectedAccountId}`,
    platform,
    source_account_id: expectedAccountId,
    account_name: accountName,
    username: optionalMetaText(resource.username, 'username'),
    account_type: accountType,
    category: optionalMetaText(resource.category, 'category'),
    followers_count: optionalMetaCount(resource.followers_count, 'followers_count'),
    follows_count: optionalMetaCount(resource.follows_count, 'follows_count'),
    fan_count: optionalMetaCount(resource.fan_count, 'fan_count'),
    media_count: optionalMetaCount(resource.media_count, 'media_count'),
    profile_url: optionalMetaUrl(resource.link, 'link'),
    insight_resource_alias: null,
    fetched_at: fetchedAt,
    source_payload_json: safeMetaSourceJson(resource),
    sync_run_id: syncRunId,
  };

  return deepFreezeMeta({
    rawRow,
    accountCandidate: {
      platform,
      sourceAccountId: expectedAccountId,
      accountName,
      username: rawRow.username,
      accountType,
      followers: rawRow.followers_count ?? rawRow.fan_count,
      follows: rawRow.follows_count,
      mediaCount: rawRow.media_count,
      fetchedAt,
    },
  });
}

/** แปลง Page Post/Instagram Media เป็น Shared Raw content row + D1 candidate */
export function normalizeMetaOrganicContentFixture(input = {}) {
  const platform = requirePlatform(input.platform);
  const resource = requireMetaObject(input.resource, 'content resource');
  const sourceAccountId = requireMetaExternalId(input.sourceAccountId, 'sourceAccountId');
  const sourceContentId = requireMetaExternalId(resource.id, 'resource.id');
  const fetchedAt = requireMetaTimestamp(input.fetchedAt, 'fetchedAt');
  const syncRunId = requireMetaText(input.syncRunId, 'syncRunId');
  const publishedAt = requireMetaTimestamp(
    platform === 'facebook' ? resource.created_time : resource.timestamp,
    platform === 'facebook' ? 'created_time' : 'timestamp',
  );
  const updatedAt = optionalMetaTimestamp(resource.updated_time, 'updated_time');
  const contentType = normalizeContentType(platform, resource);
  const caption = optionalMetaText(
    platform === 'facebook' ? resource.message : resource.caption,
    'caption',
  );
  const permalink = optionalMetaUrl(
    platform === 'facebook' ? resource.permalink_url : resource.permalink,
    'permalink',
  );

  const rawRow = {
    raw_content_key: `${platform}:${sourceAccountId}:${sourceContentId}`,
    platform,
    source_account_id: sourceAccountId,
    source_content_id: sourceContentId,
    content_type: contentType,
    message_or_caption: caption,
    title: optionalMetaText(resource.title, 'title'),
    permalink_url: permalink,
    media_url: optionalMetaUrl(resource.media_url, 'media_url'),
    thumbnail_url: optionalMetaUrl(resource.thumbnail_url, 'thumbnail_url'),
    published_at: publishedAt,
    updated_at: updatedAt,
    is_published: optionalBoolean(resource.is_published, 'is_published'),
    source_availability_status: 'available',
    last_seen_at: fetchedAt,
    missing_since: null,
    fetched_at: fetchedAt,
    source_payload_json: safeMetaSourceJson(resource),
    sync_run_id: syncRunId,
  };

  return deepFreezeMeta({
    rawRow,
    contentCandidate: {
      platform,
      sourceAccountId,
      externalContentId: sourceContentId,
      contentType,
      publishedAt,
      updatedAt,
      caption,
      contentUrl: permalink,
      mediaUrl: rawRow.media_url,
      thumbnailUrl: rawRow.thumbnail_url,
      sourceAvailabilityStatus: 'available',
      fetchedAt,
    },
  });
}

/** แปลง Insight response shapes เป็น Entity×Metric×Source-time โดยไม่รวม Metric ต่างชนิด */
export function normalizeMetaOrganicInsightsFixture(input = {}) {
  const platform = requirePlatform(input.platform);
  const entityType = requireChoice(input.entityType, 'entityType', new Set(['account', 'content']));
  const sourceAccountId = requireMetaExternalId(input.sourceAccountId, 'sourceAccountId');
  const sourceEntityId = requireMetaExternalId(input.sourceEntityId, 'sourceEntityId');
  const fetchedAt = requireMetaTimestamp(input.fetchedAt, 'fetchedAt');
  const observationAt = requireMetaTimestamp(input.observationAt ?? fetchedAt, 'observationAt');
  const syncRunId = requireMetaText(input.syncRunId, 'syncRunId');
  const reportingTimezone = requireMetaText(
    input.reportingTimezone ?? 'Asia/Bangkok',
    'reportingTimezone',
  );
  if (reportingTimezone !== 'Asia/Bangkok') {
    throw new TypeError('Meta organic reportingTimezone must be Asia/Bangkok');
  }
  if (!Array.isArray(input.insights)) throw new TypeError('Meta insights must be an array');
  const rawRows = [];
  const keys = new Set();

  for (const insight of input.insights) {
    const resource = requireMetaObject(insight, 'insight resource');
    const metricName = requireMetricToken(resource.name, 'name');
    const period = requireMetricToken(resource.period ?? 'lifetime', 'period');
    const observations = readInsightObservations(resource, observationAt);
    for (const observation of observations) {
      const metricDate = dateOnlyForMetaInstant(observation.instant, reportingTimezone);
      const sourceTimeKey = String(observation.instant);
      const rawMetricKey = [
        platform,
        entityType,
        sourceEntityId,
        metricName,
        period,
        sourceTimeKey,
      ].join(':');
      if (keys.has(rawMetricKey)) {
        throw new TypeError('Meta insights contain a duplicate metric Stable key');
      }
      keys.add(rawMetricKey);
      const metricValue = normalizeMetaMetricValue(
        observation.value,
        `${metricName}.value`,
      );
      rawRows.push({
        raw_metric_key: rawMetricKey,
        platform,
        entity_type: entityType,
        source_account_id: sourceAccountId,
        source_entity_id: sourceEntityId,
        metric_name: metricName,
        period,
        value_number: metricValue.valueNumber,
        value_json: metricValue.valueJson,
        response_shape: observation.responseShape,
        end_time_raw: observation.sourceTimeRaw,
        source_snapshot_at: observation.instant,
        metric_date: metricDate,
        timezone_basis: 'asia_bangkok',
        fetched_at: fetchedAt,
        source_payload_json: safeMetaSourceJson(resource),
        sync_run_id: syncRunId,
      });
    }
  }

  return deepFreezeMeta({
    rawRows,
    metricCandidates: rawRows.map((row) => ({
      platform: row.platform,
      entityType: row.entity_type,
      sourceAccountId: row.source_account_id,
      sourceEntityId: row.source_entity_id,
      metricName: row.metric_name,
      period: row.period,
      valueNumber: row.value_number,
      valueJson: row.value_json,
      metricDate: row.metric_date,
      sourceSnapshotAt: row.source_snapshot_at,
      fetchedAt: row.fetched_at,
    })),
  });
}

function readInsightObservations(resource, fetchedAt) {
  if (Array.isArray(resource.values)) {
    return resource.values.map((entry) => {
      const value = requireMetaObject(entry, 'insight values entry');
      const instant = value.end_time
        ? requireMetaTimestamp(value.end_time, 'end_time')
        : fetchedAt;
      return {
        value: value.value,
        sourceTimeRaw: optionalMetaText(value.end_time, 'end_time'),
        instant,
        responseShape: 'values',
      };
    });
  }
  if (resource.total_value !== null
    && resource.total_value !== undefined
    && typeof resource.total_value === 'object') {
    if (!Object.hasOwn(resource.total_value, 'value')) {
      throw new TypeError('Meta insight total_value requires value');
    }
    return [{
      value: resource.total_value.value,
      sourceTimeRaw: null,
      instant: fetchedAt,
      responseShape: 'total_value',
    }];
  }
  if (Object.hasOwn(resource, 'value')) {
    return [{
      value: resource.value,
      sourceTimeRaw: null,
      instant: fetchedAt,
      responseShape: 'scalar',
    }];
  }
  const unavailableDescriptor = ['name', 'period', 'id', 'title', 'description']
    .every((field) => typeof resource[field] === 'string' && resource[field].trim() !== '');
  if (unavailableDescriptor) {
    return [{
      value: null,
      sourceTimeRaw: null,
      instant: fetchedAt,
      responseShape: 'unavailable',
    }];
  }
  throw new TypeError('Meta insight response shape is unsupported');
}

function normalizeAccountType(platform, value) {
  if (platform === 'facebook') return 'page';
  const text = optionalMetaText(value, 'account_type')?.toUpperCase();
  if (text === 'BUSINESS') return 'business';
  if (text === 'MEDIA_CREATOR' || text === 'CREATOR') return 'creator';
  return 'unknown';
}

function normalizeContentType(platform, resource) {
  if (platform === 'facebook') return 'post';
  const product = optionalMetaText(resource.media_product_type, 'media_product_type')
    ?.toUpperCase();
  const type = optionalMetaText(resource.media_type, 'media_type')?.toUpperCase();
  if (product === 'REELS' || product === 'REEL') return 'reel';
  if (product === 'STORY') return 'story';
  if (type === 'IMAGE') return 'image';
  if (type === 'VIDEO') return 'video';
  if (type === 'CAROUSEL_ALBUM') return 'carousel';
  return 'other';
}

function requirePlatform(value) {
  return requireChoice(value, 'platform', ORGANIC_PLATFORMS);
}

function requireChoice(value, fieldName, choices) {
  const text = requireMetaText(value, fieldName);
  if (!choices.has(text)) throw new TypeError(`Meta ${fieldName} is unsupported`);
  return text;
}

function requireMetricToken(value, fieldName) {
  const text = requireMetaText(value, fieldName);
  if (!/^[a-z][a-z0-9_.]*$/u.test(text)) {
    throw new TypeError(`Meta insight ${fieldName} is invalid`);
  }
  return text;
}

function optionalBoolean(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'boolean') throw new TypeError(`Meta ${fieldName} must be boolean`);
  return value;
}
