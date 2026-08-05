import { calculateAdsPeriodMetrics } from '../../application/src/reports/calculate-ads-period-metrics.js';
import { getReportPlatformContract } from '../../application/src/reports/report-platform-adapter-registry.js';
import { permanentError, transientError } from '../../shared/src/errors/runtime-error.js';

const DEFAULT_MAX_FACTS = 10_000;
const MAX_FACTS = 50_000;
const DEFAULT_TOP_ADS_LIMIT = 5;

/**
 * Bounded D1 Ads reader that selects one reviewed source grain and aggregates its partitions.
 * It never combines unrelated breakdown families, so detailed Provider rows cannot be double counted.
 */
export class D1AdsReportSource {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.platform = requireText(input.platform, 'platform');
    const contract = getReportPlatformContract(this.platform);
    if (contract.capability !== 'paid_ads') {
      throw invalidQuery(`${this.platform} is not a Paid Ads Report platform`);
    }
    this.coverageDatasetKeys = requireTextList(
      input.coverageDatasetKeys ?? contract.coverageDatasetKeys,
      'coverageDatasetKeys',
      { allowEmpty: false },
    );
    this.summaryReportLevels = requireTextList(
      input.summaryReportLevels
        ?? (input.summaryReportLevel ? [input.summaryReportLevel] : contract.summaryReportLevels),
      'summaryReportLevels',
      { allowEmpty: false },
    );
    this.rankingReportLevels = requireTextList(
      input.rankingReportLevels
        ?? (input.rankingReportLevel ? [input.rankingReportLevel] : contract.rankingReportLevels),
      'rankingReportLevels',
      { allowEmpty: true },
    );
    this.summaryBreakdownFamily = requireText(
      input.summaryBreakdownFamily ?? input.breakdownKey ?? contract.summaryBreakdownFamily,
      'summaryBreakdownFamily',
    );
    this.summarySegmentFamily = requireText(
      input.summarySegmentFamily ?? input.segmentKey ?? contract.summarySegmentFamily,
      'summarySegmentFamily',
    );
    this.rankingBreakdownFamily = this.rankingReportLevels.length === 0
      ? null
      : requireText(
        input.rankingBreakdownFamily ?? contract.rankingBreakdownFamily,
        'rankingBreakdownFamily',
      );
    this.rankingSegmentFamily = this.rankingReportLevels.length === 0
      ? null
      : requireText(
        input.rankingSegmentFamily ?? contract.rankingSegmentFamily,
        'rankingSegmentFamily',
      );
  }

  async load(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const periodStart = requireDate(input.periodStart, 'periodStart');
    const periodEnd = requireDate(input.periodEnd, 'periodEnd');
    if (periodStart > periodEnd) throw invalidQuery('periodStart cannot be after periodEnd');
    const factLimit = boundedPositiveInteger(input.maxFactRows ?? DEFAULT_MAX_FACTS, 'maxFactRows', MAX_FACTS);
    const topAdsLimit = boundedPositiveInteger(input.topAdsLimit ?? DEFAULT_TOP_ADS_LIMIT, 'topAdsLimit', 100);
    const queryLevels = [...new Set([...this.summaryReportLevels, ...this.rankingReportLevels])];

    const [factRows, coverage] = await Promise.all([
      queryLevels.length === 0 ? Promise.resolve([]) : this.#all(
        factSql(queryLevels.length),
        [customerKey, this.platform, accountKey, ...queryLevels, periodStart, periodEnd, factLimit + 1],
      ),
      this.#first(
        coverageSql(this.coverageDatasetKeys.length),
        [customerKey, this.platform, accountKey, ...this.coverageDatasetKeys],
      ),
    ]);
    assertWithinLimit(factRows.length, factLimit, 'facts', this.platform);
    assertUniqueFacts(factRows, this.platform);

    const summarySelection = selectAggregationRows({
      rows: factRows,
      reportLevels: this.summaryReportLevels,
      breakdownFamily: this.summaryBreakdownFamily,
      segmentFamily: this.summarySegmentFamily,
    });
    const rankingSelection = this.rankingReportLevels.length === 0
      ? emptySelection()
      : selectAggregationRows({
        rows: factRows,
        reportLevels: this.rankingReportLevels,
        breakdownFamily: this.rankingBreakdownFamily,
        segmentFamily: this.rankingSegmentFamily,
      });
    const summaryRows = summarySelection.rows;
    const rankingRows = rankingSelection.rows;

    const entityIds = [...new Set(rankingRows.map(entityIdentity).filter(Boolean))].sort();
    const entityRows = entityIds.length === 0 ? [] : await this.#all(
      `SELECT external_entity_id, external_creative_id, entity_name, currency
       FROM ads_entity_state
       WHERE customer_key = ? AND platform = ? AND account_key = ?
         AND entity_type = 'ad' AND external_entity_id IN (${placeholders(entityIds.length)})
       ORDER BY external_entity_id ASC`,
      [customerKey, this.platform, accountKey, ...entityIds],
    );
    const entityById = new Map(entityRows.map((row) => [row.external_entity_id, row]));
    const coverageStatus = normalizeCoverageStatus(coverage?.status);
    const coverageRate = calculateCoverageRate(coverage);
    const summaryReportLevel = summarySelection.reportLevel ?? this.summaryReportLevels[0];
    const metrics = calculateAdsPeriodMetrics({
      rows: summaryRows,
      reportLevel: summaryReportLevel,
      coverageStatus,
      coverageRate,
    });
    const topAds = this.rankingReportLevels.length === 0
      ? Object.freeze([])
      : buildTopAds({
        rows: rankingRows,
        entityById,
        platform: this.platform,
        reportLevel: rankingSelection.reportLevel ?? this.rankingReportLevels[0],
        coverageStatus,
        coverageRate,
        limit: topAdsLimit,
      });

    return Object.freeze({
      platform: this.platform,
      metrics,
      topAds,
      readSummary: Object.freeze({
        strategy: 'd1_ads_daily_facts_reviewed_grain',
        bounded: true,
        coverageDatasetKey: coverage?.dataset_key ?? null,
        summaryReportLevel,
        rankingReportLevel: rankingSelection.reportLevel ?? null,
        summaryBreakdownFamily: this.summaryBreakdownFamily,
        summarySegmentFamily: this.summarySegmentFamily,
        rankingBreakdownFamily: this.rankingBreakdownFamily,
        rankingSegmentFamily: this.rankingSegmentFamily,
        summaryFactRows: summaryRows.length,
        rankingFactRows: rankingRows.length,
        discardedFactRows: factRows.length - new Set([...summaryRows, ...rankingRows]).size,
        entityRows: entityRows.length,
        topAdsAvailability: this.rankingReportLevels.length === 0 ? 'not_observed' : 'available',
        coverageStatus,
        coverageRate,
        coverageRunId: coverage?.coverage_run_id ?? null,
        sourceWatermark: coverage?.source_watermark ?? latestRevision([...summaryRows, ...rankingRows]),
        revisableUntil: nullableInteger(coverage?.revisable_until),
        failedRows: nullableInteger(coverage?.failed_rows) ?? 0,
      }),
    });
  }

  async #all(sql, bindings) {
    try {
      const result = await this.db.prepare(sql).bind(...bindings).all();
      const rows = Array.isArray(result) ? result : (result?.results ?? []);
      return rows.map((row) => Object.freeze({ ...row }));
    } catch (cause) {
      throw readError(this.platform, cause);
    }
  }

  async #first(sql, bindings) {
    try {
      const row = await this.db.prepare(sql).bind(...bindings).first();
      return row ? Object.freeze({ ...row }) : null;
    } catch (cause) {
      throw readError(this.platform, cause);
    }
  }
}

function factSql(levelCount) {
  return `
    SELECT
      ads_fact_key,
      report_level,
      external_entity_id,
      external_campaign_id,
      external_ad_group_id,
      external_ad_id,
      external_creative_id,
      metric_date,
      breakdown_key,
      segment_key,
      currency,
      spend_micros,
      impressions,
      reach,
      clicks,
      conversions,
      conversion_value_micros,
      video_views,
      data_status,
      source_revision
    FROM ads_daily_facts
    WHERE customer_key = ? AND platform = ? AND account_key = ?
      AND report_level IN (${placeholders(levelCount)})
      AND metric_date >= ? AND metric_date <= ?
    ORDER BY metric_date ASC, report_level ASC, ads_fact_key ASC LIMIT ?
  `;
}

function coverageSql(datasetCount) {
  return `
    SELECT
      coverage_run_id,
      dataset_key,
      status,
      expected_entities,
      observed_entities,
      expected_rows,
      observed_rows,
      failed_rows,
      source_watermark,
      revisable_until
    FROM data_coverage_runs
    WHERE customer_key = ? AND platform = ? AND account_key = ?
      AND dataset_key IN (${placeholders(datasetCount)}) AND completed_at IS NOT NULL
    ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
  `;
}

function selectAggregationRows(input) {
  for (const reportLevel of input.reportLevels) {
    const rows = input.rows.filter((row) => (
      optionalText(row.report_level) === reportLevel
      && factFamily(row.breakdown_key) === input.breakdownFamily
      && factFamily(row.segment_key) === input.segmentFamily
    ));
    if (rows.length > 0) return Object.freeze({ reportLevel, rows: Object.freeze(rows) });
  }
  return Object.freeze({ reportLevel: input.reportLevels[0] ?? null, rows: Object.freeze([]) });
}

function emptySelection() {
  return Object.freeze({ reportLevel: null, rows: Object.freeze([]) });
}

function factFamily(value) {
  const text = optionalText(value) ?? 'none';
  const separator = text.indexOf('=');
  return separator > 0 ? text.slice(0, separator) : text;
}

function assertUniqueFacts(rows, platform) {
  const identities = new Set();
  for (const row of rows) {
    const identity = optionalText(row.ads_fact_key) ?? [
      row.report_level,
      row.external_entity_id,
      row.metric_date,
      row.breakdown_key,
      row.segment_key,
    ].join(':');
    if (identities.has(identity)) throw permanentError(`${platform} D1 Ads facts contain duplicate identity`, {
      code: 'REPORT_D1_ADS_FACT_DUPLICATE',
      details: { platform },
    });
    identities.add(identity);
  }
}

function buildTopAds(input) {
  const byEntity = new Map();
  for (const row of input.rows) {
    const id = entityIdentity(row);
    if (!id) continue;
    const group = byEntity.get(id) ?? [];
    group.push(row);
    byEntity.set(id, group);
  }
  return Object.freeze([...byEntity.entries()].map(([externalAdId, rows]) => {
    const metrics = calculateAdsPeriodMetrics({
      rows,
      reportLevel: input.reportLevel,
      coverageStatus: input.coverageStatus,
      coverageRate: input.coverageRate,
    });
    const entity = input.entityById.get(externalAdId) ?? null;
    return Object.freeze({
      platform: input.platform,
      external_ad_id: externalAdId,
      external_campaign_id: firstKnown(rows, 'external_campaign_id'),
      external_ad_group_id: firstKnown(rows, 'external_ad_group_id'),
      external_creative_id: firstKnown(rows, 'external_creative_id') ?? entity?.external_creative_id ?? null,
      ad_name: entity?.entity_name ?? null,
      currency: firstKnown(rows, 'currency') ?? entity?.currency ?? null,
      ...metrics,
    });
  }).sort((left, right) => compareDesc(left.spend_micros, right.spend_micros)
    || compareDesc(left.impressions, right.impressions)
    || left.external_ad_id.localeCompare(right.external_ad_id))
    .slice(0, input.limit)
    .map((row, index) => Object.freeze({ rank: index + 1, ...row })));
}

function entityIdentity(row) { return optionalText(row?.external_ad_id) ?? optionalText(row?.external_entity_id); }
function firstKnown(rows, field) { return rows.find((row) => row?.[field] !== null && row?.[field] !== undefined)?.[field] ?? null; }
function compareDesc(left, right) { return (normalizeNumber(right) ?? -Infinity) - (normalizeNumber(left) ?? -Infinity); }
function normalizeNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function calculateCoverageRate(row) {
  const expected = nullableInteger(row?.expected_rows) ?? nullableInteger(row?.expected_entities);
  const observed = nullableInteger(row?.observed_rows) ?? nullableInteger(row?.observed_entities);
  if (expected === null || observed === null || expected <= 0) return null;
  return Math.min(1, observed / expected);
}
function normalizeCoverageStatus(value) {
  const status = optionalText(value)?.toLowerCase() ?? 'not_observed';
  return status === 'completed' ? 'complete' : status;
}
function latestRevision(rows) {
  const values = rows.map((row) => optionalText(row.source_revision)).filter(Boolean).sort();
  return values.at(-1) ?? null;
}
function placeholders(count) { return Array.from({ length: count }, () => '?').join(', '); }
function assertWithinLimit(observed, limit, label, platform) {
  if (observed > limit) throw permanentError(`${platform} D1 Ads ${label} exceeded limit`, {
    code: 'REPORT_D1_ADS_FACT_LIMIT_EXCEEDED', details: { platform, observed, limit },
  });
}
function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw invalidQuery(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}
function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw invalidQuery(`${fieldName} must be from 1 to ${maximum}`);
  }
  return number;
}
function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw invalidQuery(`${fieldName} is required`);
  return value.trim();
}
function requireTextList(value, fieldName, options = {}) {
  if (!Array.isArray(value) || (!options.allowEmpty && value.length === 0)) {
    throw invalidQuery(`${fieldName} must be ${options.allowEmpty ? 'an array' : 'a non-empty array'}`);
  }
  const normalized = value.map((item) => requireText(item, fieldName));
  if (new Set(normalized).size !== normalized.length) throw invalidQuery(`${fieldName} contains duplicates`);
  return Object.freeze(normalized);
}
function requireD1(value) {
  if (typeof value?.prepare !== 'function') throw new TypeError('D1AdsReportSource requires a D1 binding');
  return value;
}
function invalidQuery(message) { return permanentError(message, { code: 'REPORT_D1_ADS_SOURCE_INVALID' }); }
function readError(platform, cause) {
  return transientError(`Failed to read ${platform} Ads report source from D1`, {
    code: 'D1_ADS_REPORT_READ_FAILED', cause,
    details: { platform, causeMessage: cause instanceof Error ? cause.message : String(cause ?? '') },
  });
}
