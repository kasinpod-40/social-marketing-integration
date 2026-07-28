import { calculateRate } from '../../../domain/src/value-objects/metric-value.js';
import { requireDateOnly } from '../../../shared/src/date/date-only.js';

const DELTA_FIELDS = Object.freeze([
  ['views', 'periodViews'],
  ['likes', 'periodLikes'],
  ['comments', 'periodComments'],
  ['shares', 'periodShares'],
  ['uniqueViewers', 'periodUniqueViewers'],
  ['totalWatchTimeSeconds', 'periodTotalWatchTimeSeconds'],
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
      subtractKnown(current[sourceField], baseline.snapshot[sourceField]),
    ]));
    const periodEngagement = sumKnown([
      deltas.periodLikes,
      deltas.periodComments,
      deltas.periodShares,
    ]);
    const latestEngagement = sumKnown([current.likes, current.comments, current.shares]);
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
  const coverageRate = trackedContentCount === 0 ? null : coveredContentCount / trackedContentCount;
  const dataStatus = trackedContentCount === 0
    ? (input.coverageStatus === 'complete' ? 'no_data_confirmed' : normalizeCoverageStatus(input.coverageStatus))
    : (coveredContentCount === trackedContentCount ? normalizeCompleteStatus(input.coverageStatus) : 'partial');
  const metrics = Object.freeze({
    period_views: sumField(rows, 'periodViews'),
    period_likes: sumField(rows, 'periodLikes'),
    period_comments: sumField(rows, 'periodComments'),
    period_shares: sumField(rows, 'periodShares'),
    period_engagement: sumField(rows, 'periodEngagement'),
    period_engagement_rate: calculateRate(sumField(rows, 'periodEngagement'), sumField(rows, 'periodViews')),
    new_content_count: rows.filter((row) => row.baselineMode === 'new_content').length,
    tracked_content_count: trackedContentCount,
    baseline_coverage_rate: coverageRate,
    latest_total_views: sumCurrentField(rows, 'views'),
    latest_total_engagement: sumField(rows, 'latestEngagement'),
    latest_weighted_avg_watch_time_seconds: weightedAverage(rows, 'avgWatchTimeSeconds', 'views'),
    latest_weighted_completion_rate: weightedAverage(rows, 'completionRate', 'views'),
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
    metrics,
    contentRows: Object.freeze(sortTopContentRows(rows)),
  });
}

export function buildOrganicMetricPayload(input = {}) {
  const platform = requireText(input.platform, 'platform');
  const formulaVersion = requireText(input.formulaVersion, 'formulaVersion');
  const current = requireObject(input.current, 'current');
  const compare = input.compare == null ? null : requireObject(input.compare, 'compare');
  const definitions = [
    ['period_views', 'Views', 'count'],
    ['period_likes', 'Likes', 'count'],
    ['period_comments', 'Comments', 'count'],
    ['period_shares', 'Shares', 'count'],
    ['period_engagement', 'Engagement', 'count'],
    ['period_engagement_rate', 'Engagement rate', 'ratio'],
    ['new_content_count', 'New content', 'count'],
    ['tracked_content_count', 'Tracked content', 'count'],
    ['baseline_coverage_rate', 'Baseline coverage', 'ratio'],
    ['latest_total_views', 'Latest total views', 'count'],
  ];
  return Object.freeze(Object.fromEntries(definitions.map(([key, displayName, unit], index) => {
    const currentValue = normalizeMetric(current.metrics?.[key]);
    const compareValue = compare ? normalizeMetric(compare.metrics?.[key]) : null;
    const change = currentValue === null || compareValue === null ? null : currentValue - compareValue;
    return [`${platform}:${key}`, Object.freeze({
      metricKey: `${platform}:${key}`,
      displayName,
      unit,
      current: currentValue,
      compare: compareValue,
      change,
      changePercent: change === null || compareValue === 0 ? null : change / Math.abs(compareValue),
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

function sumField(rows, fieldName) { return sumKnown(rows.map((row) => row[fieldName])); }
function sumCurrentField(rows, fieldName) { return sumKnown(rows.map((row) => row.current?.[fieldName])); }
function sumKnown(values) {
  const known = values.map(normalizeMetric).filter((value) => value !== null);
  return known.length === 0 ? null : known.reduce((sum, value) => sum + value, 0);
}

function weightedAverage(rows, metricField, weightField) {
  let numerator = 0;
  let denominator = 0;
  for (const row of rows) {
    const metric = normalizeMetric(row.current?.[metricField]);
    const weight = normalizeMetric(row.current?.[weightField]);
    if (metric === null || weight === null || weight <= 0) continue;
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
function normalizeCoverageStatus(value) {
  if (value === 'source_unavailable' || value === 'not_observed' || value === 'revisable') return value;
  if (value === 'no_data_confirmed') return value;
  return 'partial';
}
function normalizeCompleteStatus(value) { return value === 'revisable' ? 'revisable' : 'complete'; }
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
