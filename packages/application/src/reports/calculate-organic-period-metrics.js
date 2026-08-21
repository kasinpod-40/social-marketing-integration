import { calculateRate } from '../../../domain/src/value-objects/metric-value.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';
import {
  dashboardMetricAvailabilityMessage,
  normalizeDashboardMetricAvailability,
  normalizeDashboardMetricScope,
} from '../../../config/src/dashboard-metric-readiness.js';

const DELTA_FIELDS = Object.freeze([
  ['views', 'periodViews'],
  ['likes', 'periodLikes'],
  ['comments', 'periodComments'],
  ['shares', 'periodShares'],
  ['uniqueViewers', 'periodUniqueViewers'],
  ['totalWatchTimeSeconds', 'periodTotalWatchTimeSeconds'],
]);

const ORGANIC_METRIC_DEFINITIONS = Object.freeze([
  metricDefinition('period_views', 'Views gained', 'count', 'period_delta'),
  metricDefinition('period_likes', 'Likes gained', 'count', 'period_delta'),
  metricDefinition('period_comments', 'Comments gained', 'count', 'period_delta'),
  metricDefinition('period_shares', 'Shares gained', 'count', 'period_delta'),
  metricDefinition('period_engagement', 'Engagement gained', 'count', 'period_delta'),
  metricDefinition('period_engagement_rate', 'Engagement rate (period)', 'ratio', 'period_delta'),
  metricDefinition('latest_total_views', 'Total views', 'count', 'current_total'),
  metricDefinition('latest_total_likes', 'Total likes', 'count', 'current_total'),
  metricDefinition('latest_total_comments', 'Total comments', 'count', 'current_total'),
  metricDefinition('latest_total_shares', 'Total shares', 'count', 'current_total'),
  metricDefinition('latest_total_engagement', 'Total engagement', 'count', 'current_total'),
  metricDefinition('latest_engagement_rate', 'Engagement rate (total)', 'ratio', 'current_total'),
  metricDefinition('new_content_count', 'New content', 'count', 'data_quality'),
  metricDefinition('tracked_content_count', 'Tracked content', 'count', 'data_quality'),
  metricDefinition('baseline_covered_content_count', 'Baseline covered content', 'count', 'data_quality'),
  metricDefinition('baseline_missing_content_count', 'Baseline missing content', 'count', 'data_quality'),
  metricDefinition('baseline_coverage_rate', 'Baseline coverage', 'ratio', 'data_quality'),
]);

/** Platform-neutral cumulative Organic calculation with explicit baseline and null semantics. */
export function calculateOrganicPeriodMetrics(input = {}) {
  const platform = requireText(input.platform, 'platform');
  const contents = requireArray(input.contents, 'contents');
  const observations = requireArray(input.observations ?? input.dailySnapshots, 'observations');
  const periodStart = requireDateOnly(input.periodStart, { label: 'periodStart' });
  const periodEnd = requireDateOnly(input.periodEnd, { label: 'periodEnd' });
  if (periodStart > periodEnd) throw new RangeError('periodStart must not be after periodEnd');

  const contentById = new Map();
  for (const content of contents) {
    const externalContentId = requireText(content.externalContentId, 'externalContentId');
    if (contentById.has(externalContentId)) {
      throw new Error(`Duplicate ${platform} content identity in report source: ${externalContentId}`);
    }
    contentById.set(externalContentId, content);
  }

  const observationsByContent = groupObservations(observations, platform);
  const rows = [];
  const usedObservationIds = new Set();
  for (const [externalContentId, rowsForContent] of observationsByContent) {
    const current = latestObservation(rowsForContent, (row) => row.metricDate <= periodEnd);
    if (!current) continue;
    const content = contentById.get(externalContentId)
      ?? createMissingContent(platform, externalContentId, current);
    const actualBaseline = latestObservation(rowsForContent, (row) => row.metricDate < periodStart);
    const baseline = resolveBaseline({
      content,
      observations: rowsForContent,
      actualBaseline,
      periodStart,
      periodEnd,
    });
    const deltas = Object.fromEntries(DELTA_FIELDS.map(([sourceField, outputField]) => [
      outputField,
      baseline.covered ? subtractKnown(current[sourceField], baseline.snapshot[sourceField]) : null,
    ]));
    const periodEngagement = sumStrict([
      deltas.periodLikes,
      deltas.periodComments,
      deltas.periodShares,
    ]);
    const latestEngagement = sumStrict([current.likes, current.comments, current.shares]);
    usedObservationIds.add(observationIdentity(current));
    if (baseline.sourceObservation) usedObservationIds.add(observationIdentity(baseline.sourceObservation));
    rows.push(Object.freeze({
      content,
      current,
      baseline: baseline.snapshot,
      baselineMode: baseline.mode,
      baselineCovered: baseline.covered,
      dataStatus: baseline.covered ? 'complete' : 'partial',
      ...deltas,
      periodEngagement,
      periodEngagementRate: calculateRate(periodEngagement, deltas.periodViews),
      latestEngagement,
      performanceStatus: classifyPerformance(baseline.mode, deltas.periodViews),
    }));
  }

  const trackedContentCount = rows.length;
  const coveredContentCount = rows.filter((row) => row.baselineCovered).length;
  const missingBaselineContentCount = trackedContentCount - coveredContentCount;
  const coverageRate = trackedContentCount === 0 ? null : coveredContentCount / trackedContentCount;
  const dataStatus = trackedContentCount === 0
    ? (input.coverageStatus === 'complete' ? 'no_data_confirmed' : normalizeCoverageStatus(input.coverageStatus))
    : (coveredContentCount === trackedContentCount ? normalizeCompleteStatus(input.coverageStatus) : 'partial');
  const sourceCoverageComplete = isCompleteObservationCoverage(input.coverageStatus);
  const periodCoverageComplete = sourceCoverageComplete && coveredContentCount === trackedContentCount;
  const periodViews = sumField(rows, 'periodViews', periodCoverageComplete);
  const periodLikes = sumField(rows, 'periodLikes', periodCoverageComplete);
  const periodComments = sumField(rows, 'periodComments', periodCoverageComplete);
  const periodShares = sumField(rows, 'periodShares', periodCoverageComplete);
  const periodEngagement = sumComponents(
    [periodLikes, periodComments, periodShares],
    periodCoverageComplete,
  );
  const latestTotalViews = sumCurrentField(rows, 'views', sourceCoverageComplete);
  const latestTotalLikes = sumCurrentField(rows, 'likes', sourceCoverageComplete);
  const latestTotalComments = sumCurrentField(rows, 'comments', sourceCoverageComplete);
  const latestTotalShares = sumCurrentField(rows, 'shares', sourceCoverageComplete);
  const latestTotalEngagement = sumComponents(
    [latestTotalLikes, latestTotalComments, latestTotalShares],
    sourceCoverageComplete,
  );
  const metrics = Object.freeze({
    period_views: periodViews,
    period_likes: periodLikes,
    period_comments: periodComments,
    period_shares: periodShares,
    period_engagement: periodEngagement,
    period_engagement_rate: calculateRate(periodEngagement, periodViews),
    latest_total_views: latestTotalViews,
    latest_total_likes: latestTotalLikes,
    latest_total_comments: latestTotalComments,
    latest_total_shares: latestTotalShares,
    latest_total_engagement: latestTotalEngagement,
    latest_engagement_rate: calculateRate(latestTotalEngagement, latestTotalViews),
    new_content_count: rows.filter((row) => row.baselineMode === 'new_content').length,
    tracked_content_count: trackedContentCount,
    baseline_covered_content_count: coveredContentCount,
    baseline_missing_content_count: missingBaselineContentCount,
    baseline_coverage_rate: coverageRate,
    latest_weighted_avg_watch_time_seconds: weightedAverageStrict(rows, 'avgWatchTimeSeconds', 'views'),
    latest_weighted_completion_rate: weightedAverageStrict(rows, 'completionRate', 'views'),
  });
  return Object.freeze({
    platform,
    periodStart,
    periodEnd,
    dataStatus,
    baselineCoverageRate: coverageRate,
    sourceSnapshotCount: usedObservationIds.size,
    trackedContentCount,
    coveredContentCount,
    missingBaselineContentCount,
    baselineModeCounts: summarizeBaselineModes(rows),
    metrics,
    contentRows: Object.freeze(sortTopContentRows(rows)),
  });
}

export function buildOrganicMetricPayload(input = {}) {
  const platform = requireText(input.platform, 'platform');
  const formulaVersion = requireText(input.formulaVersion, 'formulaVersion');
  const current = requireObject(input.current, 'current');
  const compare = input.compare == null ? null : requireObject(input.compare, 'compare');
  return Object.freeze(Object.fromEntries(ORGANIC_METRIC_DEFINITIONS.map((definition, index) => {
    const currentValue = normalizeMetric(current.metrics?.[definition.key]);
    const compareValue = compare ? normalizeMetric(compare.metrics?.[definition.key]) : null;
    const change = currentValue === null || compareValue === null ? null : currentValue - compareValue;
    const availabilityStatus = resolveMetricAvailability({
      definition,
      currentValue,
      current,
    });
    return [`${platform}:${definition.key}`, Object.freeze({
      metricKey: `${platform}:${definition.key}`,
      displayName: definition.displayName,
      unit: definition.unit,
      current: currentValue,
      compare: compareValue,
      change,
      changePercent: change === null || compareValue === 0 ? null : change / Math.abs(compareValue),
      metricScope: definition.metricScope,
      availabilityStatus,
      availabilityMessage: dashboardMetricAvailabilityMessage(availabilityStatus),
      clientVisible: true,
      sortOrder: index + 1,
      formulaVersion,
    })];
  })));
}

export function buildOrganicTopContentPayload(rows, limit = 5) {
  const maximum = positiveInteger(limit, 'limit');
  return Object.freeze(rows.slice(0, maximum).map((row, index) => Object.freeze({
    rank: index + 1,
    platform: row.content.platform,
    content_key: row.content.contentKey,
    external_content_id: row.content.externalContentId,
    caption: row.content.caption ?? null,
    content_url: row.content.contentUrl ?? null,
    thumbnail_url: row.content.thumbnailUrl ?? null,
    published_at: row.content.publishedAt ?? null,
    period_views: row.periodViews,
    period_likes: row.periodLikes,
    period_comments: row.periodComments,
    period_shares: row.periodShares,
    period_engagement: row.periodEngagement,
    period_engagement_rate: row.periodEngagementRate,
    latest_total_views: row.current?.views ?? null,
    performance_status: row.performanceStatus,
    data_status: row.dataStatus,
  })));
}

function resolveMetricAvailability(input) {
  if (input.currentValue !== null) {
    return normalizeDashboardMetricAvailability({ status: 'available' });
  }
  if (input.current.dataStatus === 'source_unavailable') {
    return normalizeDashboardMetricAvailability({ status: 'source_unavailable' });
  }
  if (input.definition.metricScope === 'period_delta'
    && input.current.trackedContentCount > 0
    && input.current.coveredContentCount < input.current.trackedContentCount) {
    return normalizeDashboardMetricAvailability({ status: 'baseline_incomplete' });
  }
  return normalizeDashboardMetricAvailability({ status: 'not_observed' });
}

function metricDefinition(key, displayName, unit, metricScope) {
  return Object.freeze({
    key,
    displayName,
    unit,
    metricScope: normalizeDashboardMetricScope(metricScope),
  });
}

function summarizeBaselineModes(rows) {
  const counts = {
    actual: 0,
    new_content: 0,
    partial_first_snapshot: 0,
    missing_baseline: 0,
  };
  for (const row of rows) counts[row.baselineMode] += 1;
  return Object.freeze(counts);
}

function resolveBaseline(input) {
  if (input.actualBaseline) return Object.freeze({
    snapshot: input.actualBaseline,
    sourceObservation: input.actualBaseline,
    mode: 'actual',
    covered: true,
  });
  if (input.content.publishedDate
    && input.content.publishedDate >= input.periodStart
    && input.content.publishedDate <= input.periodEnd) {
    return Object.freeze({
      snapshot: zeroObservation(input.content.externalContentId),
      sourceObservation: null,
      mode: 'new_content',
      covered: true,
    });
  }
  const firstInPeriod = input.observations.find((row) => row.metricDate >= input.periodStart && row.metricDate <= input.periodEnd);
  if (firstInPeriod) return Object.freeze({
    snapshot: firstInPeriod,
    sourceObservation: firstInPeriod,
    mode: 'partial_first_snapshot',
    covered: false,
  });
  return Object.freeze({
    snapshot: zeroObservation(input.content.externalContentId),
    sourceObservation: null,
    mode: 'missing_baseline',
    covered: false,
  });
}

function groupObservations(rows, platform) {
  const result = new Map();
  for (const row of rows) {
    const key = requireText(row.externalContentId, 'externalContentId');
    const group = result.get(key) ?? [];
    group.push(row);
    result.set(key, group);
  }
  for (const [externalContentId, group] of result) {
    group.sort((left, right) => left.metricDate.localeCompare(right.metricDate)
      || String(left.recordId ?? '').localeCompare(String(right.recordId ?? '')));
    const identities = new Set();
    for (const row of group) {
      requireDateOnly(row.metricDate, { label: 'metricDate' });
      const identity = `${row.metricDate}:${row.recordId ?? row.contentDailyKey ?? ''}`;
      if (identities.has(identity)) throw new Error(`Duplicate ${platform} observation for ${externalContentId}: ${identity}`);
      identities.add(identity);
    }
  }
  return result;
}

function latestObservation(rows, predicate) {
  for (let index = rows.length - 1; index >= 0; index -= 1) if (predicate(rows[index])) return rows[index];
  return null;
}

function subtractKnown(current, baseline) {
  const left = normalizeMetric(current);
  const right = normalizeMetric(baseline);
  return left === null || right === null ? null : left - right;
}

function sumField(rows, fieldName, allowObservedSubtotal) {
  return sumAggregate(rows.map((row) => row[fieldName]), allowObservedSubtotal);
}
function sumCurrentField(rows, fieldName, allowObservedSubtotal) {
  return sumAggregate(rows.map((row) => row.current?.[fieldName]), allowObservedSubtotal);
}
function sumComponents(values, allowObservedSubtotal) {
  return sumAggregate(values, allowObservedSubtotal);
}
function sumAggregate(values, allowObservedSubtotal) {
  return allowObservedSubtotal ? sumObserved(values) : sumStrict(values);
}
function sumObserved(values) {
  const observed = values.map(normalizeMetric).filter((value) => value !== null);
  if (observed.length === 0) return null;
  return observed.reduce((sum, value) => sum + value, 0);
}
function sumStrict(values) {
  if (values.length === 0) return null;
  const normalized = values.map(normalizeMetric);
  if (normalized.some((value) => value === null)) return null;
  return normalized.reduce((sum, value) => sum + value, 0);
}

function weightedAverageStrict(rows, metricField, weightField) {
  let numerator = 0;
  let denominator = 0;
  for (const row of rows) {
    const metric = normalizeMetric(row.current?.[metricField]);
    const weight = normalizeMetric(row.current?.[weightField]);
    if (weight === 0) continue;
    if (metric === null || weight === null) return null;
    if (weight < 0) return null;
    numerator += metric * weight;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function sortTopContentRows(rows) {
  return [...rows].sort((left, right) => compareDesc(left.periodViews, right.periodViews)
    || compareDesc(left.periodEngagement, right.periodEngagement)
    || left.content.contentKey.localeCompare(right.content.contentKey));
}
function compareDesc(left, right) { return (normalizeMetric(right) ?? -Infinity) - (normalizeMetric(left) ?? -Infinity); }
function classifyPerformance(mode, value) {
  if (mode === 'new_content') return 'new';
  if (mode !== 'actual') return 'partial';
  const views = normalizeMetric(value);
  if (views === null) return 'partial';
  if (views > 0) return 'growing';
  if (views < 0) return 'corrected_down';
  return 'stable';
}

function zeroObservation(externalContentId) {
  return Object.freeze({
    externalContentId,
    metricDate: null,
    views: 0,
    likes: 0,
    comments: 0,
    shares: 0,
    uniqueViewers: 0,
    avgWatchTimeSeconds: null,
    totalWatchTimeSeconds: 0,
    completionRate: null,
  });
}
function createMissingContent(platform, externalContentId, observation) {
  return Object.freeze({
    contentKey: `${platform}:${observation.accountId}:${externalContentId}`,
    externalContentId,
    accountId: observation.accountId,
    platform,
    caption: null,
    contentUrl: null,
    thumbnailUrl: null,
    publishedAt: null,
    publishedDate: null,
  });
}
function observationIdentity(row) { return row.recordId ?? row.contentDailyKey ?? `${row.externalContentId}:${row.metricDate}`; }
function normalizeMetric(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function isCompleteObservationCoverage(value) {
  return value === 'complete' || value === 'revisable';
}
function normalizeCoverageStatus(value) {
  if (value === 'source_unavailable' || value === 'not_observed' || value === 'revisable') return value;
  if (value === 'no_data_confirmed') return value;
  return 'partial';
}
function normalizeCompleteStatus(value) {
  if (value === 'complete') return 'complete';
  if (value === 'revisable') return 'revisable';
  return 'partial';
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > 100) throw new TypeError(`${fieldName} must be 1..100`);
  return number;
}
function requireArray(value, fieldName) { if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`); return value; }
function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${fieldName} is required`);
  return value;
}
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
