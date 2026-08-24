import {
  normalizeMetaOrganicAccountFixture,
  normalizeMetaOrganicContentFixture,
  normalizeMetaOrganicInsightsFixture,
} from './normalize-meta-organic-source.js';
import { createOrganicContentRows } from '../../../domain/src/entities/organic-content.js';
import {
  createAccountDailyKey,
  createCoverageEntityKey,
  validateStorageRow,
} from '../storage/marketing-history-contract.js';

const CONNECTORS = Object.freeze({ facebook: 'facebook', instagram: 'instagram' });
const CONTENT_SCOPE_MODES = new Set(['full_inventory', 'report_range']);

/**
 * Build Shared RAW, Canonical Lark rows and D1-ready account/history inputs from one
 * complete Organic source snapshot. This function is pure and performs no writes.
 */
export function buildMetaOrganicWriteSet(input = {}) {
  const connectorKey = requireConnector(input.connectorKey);
  const platform = connectorKey;
  const accountId = requireText(input.accountId, 'accountId');
  const accountKey = requireText(input.accountKey, 'accountKey');
  const canonicalAccountKey = optionalText(input.canonicalAccountKey) ?? `${platform}:${accountId}`;
  const customerProfile = requireText(input.customerProfile, 'customerProfile');
  const customerKey = requireText(input.customerKey, 'customerKey');
  const syncRunId = requireText(input.syncRunId, 'syncRunId');
  const operationId = requireText(input.operationId, 'operationId');
  const fetchedAt = requireTimestamp(input.fetchedAt, 'fetchedAt');
  const completedAt = requireTimestamp(input.completedAt ?? fetchedAt, 'completedAt');
  const sourceRevision = optionalText(input.sourceRevision) ?? operationId;
  const contentScopeMode = requireContentScopeMode(input.contentScopeMode ?? 'full_inventory');
  const sourceTimezone = requireText(input.sourceTimezone ?? 'Asia/Bangkok', 'sourceTimezone');
  if (sourceTimezone !== 'Asia/Bangkok') {
    throw new TypeError('Meta Organic canonical reporting timezone must be Asia/Bangkok');
  }
  const observationDate = normalizeObservationDate(input.observationDate)
    ?? dateOnlyInTimeZone(fetchedAt, sourceTimezone);
  const observationAt = dateOnlyToEpoch(observationDate, sourceTimezone);

  const accountNormalized = normalizeMetaOrganicAccountFixture({
    platform,
    expectedAccountId: accountId,
    resource: requireObject(input.accountResource, 'accountResource'),
    fetchedAt,
    syncRunId,
  });
  const contentResources = requireArray(input.contentResources ?? [], 'contentResources');
  const contentInsights = normalizeInsightEntries(input.contentInsights ?? [], 'contentInsights');
  const accountInsights = requireArray(input.accountInsights ?? [], 'accountInsights');

  const rawContent = [];
  const rawMetrics = [];
  const canonicalContent = [];
  const canonicalContentDaily = [];
  const historyContent = [];
  const historyDaily = [];
  const insightByContentId = new Map(contentInsights.map((entry) => [entry.contentId, entry.insights]));

  for (const resource of contentResources) {
    const normalized = normalizeMetaOrganicContentFixture({
      platform,
      sourceAccountId: accountId,
      resource,
      fetchedAt,
      syncRunId,
    });
    rawContent.push(normalized.rawRow);
    const insights = mergeContentInsights(
      insightByContentId.get(normalized.contentCandidate.externalContentId) ?? [],
      contentResourceInsights(connectorKey, resource),
    );
    const normalizedInsights = normalizeMetaOrganicInsightsFixture({
      platform,
      entityType: 'content',
      sourceAccountId: accountId,
      sourceEntityId: normalized.contentCandidate.externalContentId,
      insights,
      fetchedAt,
      observationAt,
      syncRunId,
      reportingTimezone: sourceTimezone,
    });
    rawMetrics.push(...normalizedInsights.rawRows.map(
      (row) => larkRawMetricRow(row, sourceTimezone),
    ));
    const metrics = contentMetricSnapshot(normalizedInsights.metricCandidates);
    const hasObservedMetric = Object.values(metrics).some((value) => value !== null);
    const metricDate = latestMetricDate(normalizedInsights.metricCandidates)
      ?? dateOnlyInTimeZone(fetchedAt, sourceTimezone);
    const rowInput = {
      platform,
      accountId,
      externalContentId: normalized.contentCandidate.externalContentId,
      metricDate,
      sourceTimezone,
      contentType: normalized.contentCandidate.contentType,
      publishedAt: normalized.contentCandidate.publishedAt,
      caption: normalized.contentCandidate.caption,
      contentUrl: normalized.contentCandidate.contentUrl,
      thumbnailUrl: normalized.contentCandidate.thumbnailUrl,
      durationSeconds: null,
      classification: {},
      metrics,
    };
    const rows = createOrganicContentRows(rowInput);
    canonicalContent.push(compact({
      ...rows.content,
      content_type: canonicalContentType(rows.content.content_type),
    }, hasObservedMetric ? [] : LATEST_METRIC_FIELDS));
    if (hasObservedMetric) {
      canonicalContentDaily.push(rows.dailySnapshot);
      // Canonical Lark rows retain the approved Provider account identity, while
      // D1 history is keyed by the configured account_key and keeps the Provider
      // identity separately as source_account_id in OrganicHistoryWriter.
      const historyRows = createOrganicContentRows({ ...rowInput, accountId: accountKey });
      historyContent.push(historyRows.content);
      historyDaily.push(historyRows.dailySnapshot);
    }
  }

  const normalizedAccountInsights = normalizeMetaOrganicInsightsFixture({
    platform,
    entityType: 'account',
    sourceAccountId: accountId,
    sourceEntityId: accountId,
    insights: accountInsights,
    fetchedAt,
    observationAt,
    syncRunId,
    reportingTimezone: sourceTimezone,
  });
  rawMetrics.push(...normalizedAccountInsights.rawRows.map(
    (row) => larkRawMetricRow(row, sourceTimezone),
  ));

  const accountDaily = buildAccountDailyRows({
    platform,
    accountId,
    accountKey,
    canonicalAccountKey,
    customerKey,
    syncRunId,
    operationId,
    sourceRevision,
    sourceTimezone,
    fetchedAt,
    completedAt,
    observationDate,
    accountCandidate: accountNormalized.accountCandidate,
    metricCandidates: normalizedAccountInsights.metricCandidates,
    sourceWatermark: optionalText(input.sourceWatermark),
  });

  // เก็บ Provider metadata ที่ยังไม่มีใน Canonical contract ไว้ใน Shared RAW/D1
  // เพื่อไม่ให้ Lark preflight เขียน field นอก approved MKT_Accounts schema.
  const accountRow = compact({
    account_key: canonicalAccountKey,
    platform,
    account_id: accountId,
    account_name: accountNormalized.accountCandidate.accountName,
    account_type: canonicalAccountType(platform, accountNormalized.accountCandidate.accountType),
    last_sync_at: completedAt,
  });

  return deepFreeze({
    schemaVersion: 'meta_organic_write_set_v1',
    connectorKey,
    operationId,
    context: {
      customerProfile,
      customerKey,
      platform,
      accountKey,
      sourceAccountId: accountId,
      sourceTimezone,
      observedAt: fetchedAt,
      metricDate: observationDate,
      fetchedAt,
      historySyncRunId: syncRunId,
      coverageRunId: `${operationId}:${connectorKey}:content`,
      sourceRevision,
      scopeMode: contentScopeMode,
      datasetKey: `${connectorKey}.content.cumulative`,
    },
    raw: {
      organicAccounts: [accountNormalized.rawRow],
      organicContent: rawContent,
      organicMetrics: rawMetrics,
      adsEntities: [],
      adsDaily: [],
    },
    canonical: {
      accounts: [accountRow],
      accountDaily: accountDaily.larkRows,
      content: canonicalContent,
      contentDaily: canonicalContentDaily,
      adsAccounts: [],
      adsCampaigns: [],
      adsAdGroups: [],
      adsAds: [],
      adsCreatives: [],
      adsDaily: [],
    },
    d1: {
      organicHistoryBatch: {
        contentRows: historyContent,
        dailySnapshotRows: historyDaily,
      },
      accountDailyFacts: accountDaily.facts,
      adsEntities: [],
      adsDailyFacts: [],
      coverageRuns: accountDaily.coverageRuns,
      coverageEntities: accountDaily.coverageEntities,
    },
    reconciliation: {
      sourceContentRows: contentResources.length,
      rawContentRows: rawContent.length,
      contentInsightEntities: contentInsights.length,
      contentDailyRows: canonicalContentDaily.length,
      accountDailyRows: accountDaily.larkRows.length,
      missingContentInsightRows: contentResources.length - canonicalContentDaily.length,
      sourceStatus: contentResources.length === 0 ? 'no_data_confirmed' : 'complete',
    },
  });
}

function requireContentScopeMode(value) {
  const mode = requireText(value, 'contentScopeMode');
  if (!CONTENT_SCOPE_MODES.has(mode)) {
    throw new TypeError('contentScopeMode must be full_inventory or report_range');
  }
  return mode;
}

function buildAccountDailyRows(input) {
  const byDate = new Map();
  for (const metric of input.metricCandidates) {
    if (metric.valueNumber === null) continue;
    const date = metric.metricDate;
    const current = byDate.get(date) ?? emptyAccountMetrics();
    applyAccountMetric(current, metric.metricName, metric.valueNumber);
    byDate.set(date, current);
  }

  const latest = byDate.get(input.observationDate) ?? emptyAccountMetrics();
  if (latest.followers === null) latest.followers = input.accountCandidate.followers;
  if (latest.follows === null) latest.follows = input.accountCandidate.follows;
  if (Object.values(latest).some((value) => value !== null)) {
    byDate.set(input.observationDate, latest);
  }

  const facts = [];
  const larkRows = [];
  const coverageEntities = [];
  for (const [metricDate, metrics] of [...byDate.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const coverageRunId = `${input.operationId}:${input.platform}:account_daily`;
    const dataStatus = Object.values(metrics).some((value) => value !== null) ? 'complete' : 'no_data_confirmed';
    facts.push(validateStorageRow('organic_account_daily_facts', {
      account_daily_key: createAccountDailyKey({
        platform: input.platform,
        account_key: input.accountKey,
        metric_date: metricDate,
      }),
      customer_key: input.customerKey,
      platform: input.platform,
      account_key: input.accountKey,
      source_account_id: input.accountId,
      metric_date: metricDate,
      account_timezone: input.sourceTimezone,
      ...metrics,
      data_status: dataStatus,
      coverage_run_id: coverageRunId,
      source_revision: input.sourceRevision,
      fetched_at: input.fetchedAt,
      sync_run_id: input.syncRunId,
      created_at: input.completedAt,
      updated_at: input.completedAt,
    }));
    larkRows.push(compact({
      account_daily_key: `${input.canonicalAccountKey}:${metricDate}`,
      metric_date: dateOnlyToEpoch(metricDate, input.sourceTimezone),
      platform: input.platform,
      account_key: input.canonicalAccountKey,
      account_id: input.accountId,
      ...metrics,
      fetched_at: input.fetchedAt,
      sync_run_id: input.syncRunId,
    }));
    coverageEntities.push(validateStorageRow('data_coverage_entities', {
      coverage_entity_key: createCoverageEntityKey({
        coverage_run_id: coverageRunId,
        entity_type: 'account_daily',
        external_entity_id: `${input.accountId}:${metricDate}`,
      }),
      coverage_run_id: coverageRunId,
      entity_type: 'account_daily',
      external_entity_id: `${input.accountId}:${metricDate}`,
      observation_status: 'observed',
      source_revision: input.sourceRevision,
      observed_at: input.fetchedAt,
      created_at: input.completedAt,
    }));
  }

  const dates = [...byDate.keys()].sort();
  const status = dates.length === 0 ? 'no_data_confirmed' : 'complete';
  const coverageRunId = `${input.operationId}:${input.platform}:account_daily`;
  const coverageRuns = [validateStorageRow('data_coverage_runs', {
    coverage_run_id: coverageRunId,
    sync_run_id: input.syncRunId,
    customer_key: input.customerKey,
    platform: input.platform,
    account_key: input.accountKey,
    dataset_key: `${input.platform}.account.daily`,
    metric_semantics: 'snapshot',
    scope_mode: 'report_range',
    period_start: dates[0] ?? null,
    period_end: dates.at(-1) ?? null,
    source_timezone: input.sourceTimezone,
    status,
    expected_entities: dates.length,
    observed_entities: dates.length,
    expected_rows: dates.length,
    observed_rows: dates.length,
    written_rows: dates.length,
    failed_rows: 0,
    source_watermark: input.sourceWatermark,
    revisable_until: null,
    started_at: input.fetchedAt,
    completed_at: input.completedAt,
    error_code: null,
    created_at: input.completedAt,
    updated_at: input.completedAt,
  })];

  return deepFreeze({ facts, larkRows, coverageRuns, coverageEntities });
}

function contentMetricSnapshot(candidates) {
  const result = {
    views: null,
    likes: null,
    comments: null,
    shares: null,
    uniqueViewers: null,
    averageWatchTimeSeconds: null,
    totalWatchTimeSeconds: null,
    completionRate: null,
    trafficSources: null,
    countryRegionBreakdown: null,
  };
  for (const candidate of candidates) {
    if (candidate.valueNumber === null) continue;
    const field = contentMetricField(candidate.metricName);
    if (field) result[field] = candidate.valueNumber;
  }
  return Object.freeze(result);
}

function contentMetricField(metricName) {
  const normalized = String(metricName).toLowerCase();
  if (['views', 'video_views', 'post_media_view', 'post_video_views'].includes(normalized)) return 'views';
  if (['likes', 'reactions', 'reactions_count', 'post_reactions_like_total'].includes(normalized)) return 'likes';
  if (['comments', 'comments_count', 'post_comments'].includes(normalized)) return 'comments';
  if (['shares', 'shares_count', 'post_shares'].includes(normalized)) return 'shares';
  // Meta reach is not semantically interchangeable with Canonical unique_viewers.
  if (['unique_viewers', 'post_total_media_view_unique'].includes(normalized)) return 'uniqueViewers';
  if (['avg_watch_time_seconds', 'average_watch_time'].includes(normalized)) return 'averageWatchTimeSeconds';
  if (['total_watch_time_seconds', 'total_watch_time'].includes(normalized)) return 'totalWatchTimeSeconds';
  if (['completion_rate', 'video_completion_rate'].includes(normalized)) return 'completionRate';
  return null;
}

function applyAccountMetric(target, metricName, value) {
  const normalized = String(metricName).toLowerCase();
  if (['followers', 'followers_count', 'fan_count'].includes(normalized)) target.followers = integerOrNull(value);
  else if (['follows', 'follows_count'].includes(normalized)) target.follows = integerOrNull(value);
  else if (['profile_views', 'page_views_total'].includes(normalized)) target.profile_views = integerOrNull(value);
  else if (['views', 'page_media_view', 'post_media_view'].includes(normalized)) target.views = integerOrNull(value);
  else if (['reach', 'page_total_media_view_unique'].includes(normalized)) target.reach = integerOrNull(value);
  else if (normalized === 'accounts_engaged') target.accounts_engaged = integerOrNull(value);
  else if (['total_interactions', 'page_post_engagements'].includes(normalized)) target.total_interactions = integerOrNull(value);
  else if (['net_follows', 'follows_and_unfollows'].includes(normalized)) target.net_follows = finiteOrNull(value);
}

function emptyAccountMetrics() {
  return {
    followers: null,
    follows: null,
    profile_views: null,
    views: null,
    reach: null,
    accounts_engaged: null,
    total_interactions: null,
    net_follows: null,
  };
}

function normalizeInsightEntries(values, fieldName) {
  return requireArray(values, fieldName).map((entry) => {
    const object = requireObject(entry, `${fieldName} entry`);
    return Object.freeze({
      contentId: requireText(object.contentId, `${fieldName}.contentId`),
      insights: requireArray(object.insights ?? [], `${fieldName}.insights`),
    });
  });
}

function contentResourceInsights(connectorKey, resource) {
  if (connectorKey !== 'facebook') return Object.freeze([]);
  const metrics = [];
  appendFacebookSharesCount(metrics, resource);
  appendFacebookCount(metrics, {
    value: resource.reactions,
    sourceName: 'reactions',
    countPath: ['summary', 'total_count'],
    metricName: 'reactions_count',
  });
  appendFacebookCount(metrics, {
    value: resource.comments,
    sourceName: 'comments',
    countPath: ['summary', 'total_count'],
    metricName: 'comments_count',
  });
  return Object.freeze(metrics);
}

/**
 * A successful Page Posts inventory request explicitly asks Meta for `shares`. In the observed
 * Graph response contract, posts with a positive count include `{ shares: { count } }`, while a
 * post with no shares omits the `shares` object. Only that omitted-property shape is observed zero;
 * an explicit null remains unavailable so a permission/shape regression cannot become a fake zero.
 */
function appendFacebookSharesCount(target, resource) {
  if (!Object.hasOwn(resource, 'shares')) {
    target.push(Object.freeze({
      name: 'shares_count',
      period: 'lifetime',
      value: 0,
    }));
    return;
  }
  appendFacebookCount(target, {
    value: resource.shares,
    sourceName: 'shares',
    countPath: ['count'],
    metricName: 'shares_count',
  });
}

function appendFacebookCount(target, input) {
  if (input.value === null || input.value === undefined) return;
  const source = requireObject(input.value, `Facebook content ${input.sourceName}`);
  let value = source;
  for (const field of input.countPath) value = value?.[field];
  const count = integerOrNull(value);
  if (count === null) {
    throw new TypeError(
      `Facebook content ${input.sourceName}.${input.countPath.join('.')} must be a non-negative integer`,
    );
  }
  target.push(Object.freeze({
    name: input.metricName,
    period: 'lifetime',
    value: count,
  }));
}

function mergeContentInsights(providerInsights, resourceInsights) {
  const provider = requireArray(providerInsights, 'providerInsights');
  const names = new Set(provider.map((row) => optionalText(row?.name)).filter(Boolean));
  return Object.freeze([
    ...provider,
    ...resourceInsights.filter((row) => !names.has(row.name)),
  ]);
}

function normalizeObservationDate(value) {
  if (value === null || value === undefined || value === '') return null;
  const text = requireText(value, 'observationDate');
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    throw new TypeError('observationDate must use YYYY-MM-DD');
  }
  const instant = Date.parse(`${text}T00:00:00Z`);
  if (!Number.isFinite(instant) || new Date(instant).toISOString().slice(0, 10) !== text) {
    throw new TypeError('observationDate must be a valid date');
  }
  return text;
}

function latestMetricDate(candidates) {
  const dates = candidates.map((candidate) => candidate.metricDate).filter(Boolean).sort();
  return dates.at(-1) ?? null;
}

function larkRawMetricRow(row, sourceTimezone) {
  return Object.freeze({
    ...row,
    // Provider descriptors without values are an explicit internal "unavailable"
    // shape. The approved Shared RAW Lark select contract represents every
    // non-values/total_value/scalar shape as "other" while the null value and
    // original descriptor remain preserved in source_payload_json.
    response_shape: row.response_shape === 'unavailable' ? 'other' : row.response_shape,
    metric_date: dateOnlyToEpoch(row.metric_date, sourceTimezone),
  });
}

function canonicalAccountType(platform, sourceAccountType) {
  if (platform === 'facebook') return 'page';
  if (sourceAccountType === 'business') return 'business_account';
  if (sourceAccountType === 'creator') return 'profile';
  return null;
}

function canonicalContentType(sourceContentType) {
  if (['post', 'image', 'carousel', 'status', 'link'].includes(sourceContentType)) return 'post';
  if (['video', 'reel', 'story', 'live'].includes(sourceContentType)) return sourceContentType;
  return null;
}

function dateOnlyInTimeZone(epochMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(epochMs));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function dateOnlyToEpoch(value, timeZone) {
  const [year, month, day] = value.split('-').map(Number);
  const probe = Date.UTC(year, month - 1, day, 12);
  const parts = new Intl.DateTimeFormat('en-US-u-ca-gregory-nu-latn', {
    timeZone,
    timeZoneName: 'longOffset',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(probe));
  const offset = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00';
  const match = /GMT([+-])(\d{2}):(\d{2})/u.exec(offset);
  const minutes = match ? (Number(match[2]) * 60 + Number(match[3])) * (match[1] === '+' ? 1 : -1) : 0;
  return Date.UTC(year, month - 1, day) - (minutes * 60_000);
}

function compact(value, omitFields = []) {
  const omitted = new Set(omitFields);
  return Object.freeze(Object.fromEntries(Object.entries(value).filter(
    ([key, nested]) => !omitted.has(key) && nested !== undefined && nested !== null,
  )));
}

function integerOrNull(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function finiteOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireConnector(value) {
  const text = requireText(value, 'connectorKey');
  if (!Object.hasOwn(CONNECTORS, text)) throw new TypeError(`Unsupported Meta Organic connector: ${text}`);
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) throw new TypeError(`${fieldName} must be a timestamp`);
  return number;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return value;
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} must be an object`);
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  if (typeof value !== 'string' && typeof value !== 'number') return null;
  return String(value).trim() || null;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const nested of Object.values(value)) deepFreeze(nested);
  return Object.freeze(value);
}

const LATEST_METRIC_FIELDS = Object.freeze([
  'latest_views',
  'latest_likes',
  'latest_comments',
  'latest_shares',
  'latest_unique_viewers',
  'avg_watch_time_seconds',
  'completion_rate',
]);
