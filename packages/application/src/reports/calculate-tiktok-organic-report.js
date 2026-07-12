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

/**
 * คำนวณ Metric ช่วงเวลาจาก cumulative snapshots ต่อคลิป
 * รองรับ New content baseline=0, Partial baseline และค่าที่ Platform แก้ย้อนหลังจน Delta ติดลบ
 */
export function calculateTikTokOrganicPeriodMetrics(input = {}) {
  const contents = requireArray(input.contents, 'contents');
  const dailySnapshots = requireArray(input.dailySnapshots, 'dailySnapshots');
  const periodStart = requireDateOnly(input.periodStart, { label: 'periodStart' });
  const periodEnd = requireDateOnly(input.periodEnd, { label: 'periodEnd' });
  if (periodStart > periodEnd) throw new RangeError('periodStart must not be after periodEnd');

  const contentById = new Map();
  for (const content of contents) {
    const externalContentId = requireText(content.externalContentId, 'externalContentId');
    if (contentById.has(externalContentId)) {
      throw new Error(`Duplicate TikTok content identity in report source: ${externalContentId}`);
    }
    contentById.set(externalContentId, content);
  }
  const snapshotsByContent = groupSnapshots(dailySnapshots);
  const rows = [];
  const usedSnapshotIds = new Set();

  for (const [externalContentId, snapshots] of snapshotsByContent) {
    const current = latestSnapshot(snapshots, (row) => row.metricDate <= periodEnd);
    if (!current) continue;

    const content = contentById.get(externalContentId) ?? createMissingContent(externalContentId, current);
    const actualBaseline = latestSnapshot(snapshots, (row) => row.metricDate < periodStart);
    const baselineResolution = resolveBaseline({
      content,
      snapshots,
      actualBaseline,
      periodStart,
      periodEnd,
    });

    const deltas = Object.fromEntries(DELTA_FIELDS.map(([sourceField, outputField]) => [
      outputField,
      subtractMetrics(current[sourceField], baselineResolution.snapshot[sourceField]),
    ]));
    const periodEngagement = sumKnown([
      deltas.periodLikes,
      deltas.periodComments,
      deltas.periodShares,
    ]);
    const latestEngagement = sumKnown([current.likes, current.comments, current.shares]);
    const periodEngagementRate = calculateRate(periodEngagement, deltas.periodViews);

    usedSnapshotIds.add(snapshotIdentity(current));
    if (baselineResolution.sourceSnapshot) {
      usedSnapshotIds.add(snapshotIdentity(baselineResolution.sourceSnapshot));
    }

    rows.push(Object.freeze({
      content,
      current,
      baseline: baselineResolution.snapshot,
      baselineMode: baselineResolution.mode,
      baselineCovered: baselineResolution.covered,
      dataStatus: baselineResolution.covered ? 'complete' : 'partial',
      ...deltas,
      periodEngagement,
      periodEngagementRate,
      latestEngagement,
      performanceStatus: classifyPerformance({
        baselineMode: baselineResolution.mode,
        periodViews: deltas.periodViews,
      }),
    }));
  }

  const trackedContentCount = rows.length;
  const coveredContentCount = rows.filter((row) => row.baselineCovered).length;
  const baselineCoverageRate = trackedContentCount === 0
    ? null
    : coveredContentCount / trackedContentCount;
  const dataStatus = trackedContentCount === 0
    ? 'no_data'
    : (coveredContentCount === trackedContentCount ? 'complete' : 'partial');

  const metrics = Object.freeze({
    period_views: sumField(rows, 'periodViews'),
    period_likes: sumField(rows, 'periodLikes'),
    period_comments: sumField(rows, 'periodComments'),
    period_shares: sumField(rows, 'periodShares'),
    period_engagement: sumField(rows, 'periodEngagement'),
    period_engagement_rate: calculateRate(
      sumField(rows, 'periodEngagement'),
      sumField(rows, 'periodViews'),
    ),
    new_content_count: rows.filter((row) => row.baselineMode === 'new_content').length,
    tracked_content_count: trackedContentCount,
    baseline_coverage_rate: baselineCoverageRate,
    latest_total_views: sumCurrentField(rows, 'views'),
    latest_total_engagement: sumField(rows, 'latestEngagement'),
    latest_weighted_avg_watch_time_seconds: weightedAverage(rows, 'avgWatchTimeSeconds', 'views'),
    latest_weighted_completion_rate: weightedAverage(rows, 'completionRate', 'views'),
  });

  return Object.freeze({
    periodStart,
    periodEnd,
    dataStatus,
    baselineCoverageRate,
    sourceSnapshotCount: usedSnapshotIds.size,
    trackedContentCount,
    coveredContentCount,
    metrics,
    contentRows: Object.freeze(sortTopContentRows(rows)),
  });
}

/** สร้าง Current/Compare/Change payload สำหรับทุก Metric */
export function compareTikTokOrganicMetrics(input = {}) {
  const current = requireObject(input.current, 'current');
  const compare = input.compare === null || input.compare === undefined
    ? null
    : requireObject(input.compare, 'compare');
  const definitions = requireArray(input.metricDefinitions, 'metricDefinitions');

  return Object.freeze(Object.fromEntries(definitions.map((definition) => {
    const metricKey = requireText(definition.metric_key, 'metric_key');
    const shortKey = metricKey.startsWith('tiktok:') ? metricKey.slice('tiktok:'.length) : metricKey;
    const currentValue = normalizeMetricValue(current.metrics?.[shortKey]);
    const compareValue = compare ? normalizeMetricValue(compare.metrics?.[shortKey]) : null;
    const changeValue = currentValue === null || compareValue === null
      ? null
      : currentValue - compareValue;
    const changePercent = changeValue === null || compareValue === 0
      ? null
      : changeValue / Math.abs(compareValue);

    return [metricKey, Object.freeze({
      metricKey,
      displayName: requireText(definition.display_name, 'display_name'),
      unit: requireText(definition.unit, 'unit'),
      current: currentValue,
      compare: compareValue,
      change: changeValue,
      changePercent,
      clientVisible: definition.client_visible === true,
      sortOrder: Number(definition.sort_order ?? 1_000),
      formulaVersion: requireText(definition.formula_version, 'formula_version'),
    })];
  })));
}

function resolveBaseline(input) {
  if (input.actualBaseline) {
    return Object.freeze({
      snapshot: input.actualBaseline,
      sourceSnapshot: input.actualBaseline,
      mode: 'actual',
      covered: true,
    });
  }

  if (input.content.publishedDate
    && input.content.publishedDate >= input.periodStart
    && input.content.publishedDate <= input.periodEnd) {
    return Object.freeze({
      snapshot: zeroSnapshot(input.content.externalContentId),
      sourceSnapshot: null,
      mode: 'new_content',
      covered: true,
    });
  }

  const firstInPeriod = input.snapshots.find((row) => (
    row.metricDate >= input.periodStart && row.metricDate <= input.periodEnd
  ));
  if (firstInPeriod) {
    return Object.freeze({
      snapshot: firstInPeriod,
      sourceSnapshot: firstInPeriod,
      mode: 'partial_first_snapshot',
      covered: false,
    });
  }

  return Object.freeze({
    snapshot: zeroSnapshot(input.content.externalContentId),
    sourceSnapshot: null,
    mode: 'missing_baseline',
    covered: false,
  });
}

function groupSnapshots(rows) {
  const result = new Map();
  for (const row of rows) {
    const key = requireText(row.externalContentId, 'externalContentId');
    const group = result.get(key) ?? [];
    group.push(row);
    result.set(key, group);
  }
  for (const [externalContentId, group] of result) {
    group.sort((left, right) => left.metricDate.localeCompare(right.metricDate));
    const dates = new Set();
    for (const row of group) {
      const metricDate = requireDateOnly(row.metricDate, { label: 'metricDate' });
      if (dates.has(metricDate)) {
        throw new Error(`Duplicate TikTok daily snapshot for ${externalContentId} on ${metricDate}`);
      }
      dates.add(metricDate);
    }
  }
  return result;
}

function latestSnapshot(rows, predicate) {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    if (predicate(rows[index])) return rows[index];
  }
  return null;
}

function subtractMetrics(current, baseline) {
  const left = normalizeMetricValue(current);
  const right = normalizeMetricValue(baseline);
  if (left === null || right === null) return null;
  return left - right;
}

function sumField(rows, fieldName) {
  return sumKnown(rows.map((row) => row[fieldName]));
}

function sumCurrentField(rows, fieldName) {
  return sumKnown(rows.map((row) => row.current?.[fieldName]));
}

function sumKnown(values) {
  const known = values.map(normalizeMetricValue).filter((value) => value !== null);
  if (known.length === 0) return null;
  return known.reduce((sum, value) => sum + value, 0);
}

function weightedAverage(rows, metricField, weightField) {
  let numerator = 0;
  let denominator = 0;
  for (const row of rows) {
    const metric = normalizeMetricValue(row.current?.[metricField]);
    const weight = normalizeMetricValue(row.current?.[weightField]);
    if (metric === null || weight === null || weight <= 0) continue;
    numerator += metric * weight;
    denominator += weight;
  }
  return denominator > 0 ? numerator / denominator : null;
}

function sortTopContentRows(rows) {
  return [...rows].sort((left, right) => (
    compareNumbersDesc(left.periodViews, right.periodViews)
    || compareNumbersDesc(left.periodEngagement, right.periodEngagement)
    || left.content.contentKey.localeCompare(right.content.contentKey)
  ));
}

function compareNumbersDesc(left, right) {
  return (normalizeMetricValue(right) ?? Number.NEGATIVE_INFINITY)
    - (normalizeMetricValue(left) ?? Number.NEGATIVE_INFINITY);
}

function classifyPerformance(input) {
  if (input.baselineMode === 'new_content') return 'new';
  if (input.baselineMode !== 'actual') return 'partial';
  const views = normalizeMetricValue(input.periodViews);
  if (views === null) return 'partial';
  if (views > 0) return 'growing';
  if (views < 0) return 'corrected_down';
  return 'stable';
}

function zeroSnapshot(externalContentId) {
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

function createMissingContent(externalContentId, snapshot) {
  return Object.freeze({
    contentKey: `tiktok:${snapshot.accountId}:${externalContentId}`,
    externalContentId,
    accountId: snapshot.accountId,
    platform: 'tiktok',
    caption: null,
    contentUrl: null,
    thumbnailUrl: null,
    publishedAt: null,
    publishedDate: null,
  });
}

function snapshotIdentity(snapshot) {
  return snapshot.recordId ?? snapshot.contentDailyKey ?? `${snapshot.externalContentId}:${snapshot.metricDate}`;
}

function normalizeMetricValue(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`TikTok report calculation requires ${fieldName}`);
  return value;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`TikTok report calculation requires ${fieldName}`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok report calculation requires ${fieldName}`);
  }
  return value.trim();
}
