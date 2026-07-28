import { calculateAdsPeriodMetrics } from '../../application/src/reports/calculate-ads-period-metrics.js';
import { permanentError, transientError } from '../../shared/src/errors/runtime-error.js';

const DEFAULT_MAX_FACTS = 10_000;
const MAX_FACTS = 50_000;
const DEFAULT_TOP_ADS_LIMIT = 5;

/** D1 Ads reader with explicit report-level and no-breakdown fences to prevent double counting. */
export class D1AdsReportSource {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.platform = requireText(input.platform, 'platform');
    this.datasetKey = requireText(input.datasetKey ?? 'ads_daily_facts', 'datasetKey');
    this.summaryReportLevel = requireText(input.summaryReportLevel ?? 'account', 'summaryReportLevel');
    this.rankingReportLevel = requireText(input.rankingReportLevel ?? 'ad', 'rankingReportLevel');
    this.breakdownKey = requireText(input.breakdownKey ?? 'none', 'breakdownKey');
    this.segmentKey = requireText(input.segmentKey ?? 'none', 'segmentKey');
  }

  async load(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const periodStart = requireDate(input.periodStart, 'periodStart');
    const periodEnd = requireDate(input.periodEnd, 'periodEnd');
    if (periodStart > periodEnd) throw invalidQuery('periodStart cannot be after periodEnd');
    const factLimit = boundedPositiveInteger(input.maxFactRows ?? DEFAULT_MAX_FACTS, 'maxFactRows', MAX_FACTS);
    const topAdsLimit = boundedPositiveInteger(input.topAdsLimit ?? DEFAULT_TOP_ADS_LIMIT, 'topAdsLimit', 100);

    const [summaryRows, rankingRows, coverage] = await Promise.all([
      this.#all(factSql(), [
        customerKey, this.platform, accountKey, this.summaryReportLevel,
        this.breakdownKey, this.segmentKey, periodStart, periodEnd, factLimit + 1,
      ]),
      this.#all(factSql(), [
        customerKey, this.platform, accountKey, this.rankingReportLevel,
        this.breakdownKey, this.segmentKey, periodStart, periodEnd, factLimit + 1,
      ]),
      this.#first(`
        SELECT * FROM data_coverage_runs
        WHERE customer_key = ? AND platform = ? AND account_key = ?
          AND dataset_key = ? AND completed_at IS NOT NULL
        ORDER BY completed_at DESC, coverage_run_id ASC LIMIT 1
      `, [customerKey, this.platform, accountKey, this.datasetKey]),
    ]);
    assertWithinLimit(summaryRows.length, factLimit, 'summary facts', this.platform);
    assertWithinLimit(rankingRows.length, factLimit, 'ranking facts', this.platform);

    const entityIds = [...new Set(rankingRows.map(entityIdentity).filter(Boolean))].sort();
    const entityRows = entityIds.length === 0 ? [] : await this.#all(
      `SELECT * FROM ads_entity_state
       WHERE customer_key = ? AND platform = ? AND account_key = ?
         AND entity_type = 'ad' AND external_entity_id IN (${placeholders(entityIds.length)})
       ORDER BY external_entity_id ASC`,
      [customerKey, this.platform, accountKey, ...entityIds],
    );
    const entityById = new Map(entityRows.map((row) => [row.external_entity_id, row]));
    const coverageStatus = coverage?.status ?? 'not_observed';
    const coverageRate = calculateCoverageRate(coverage);
    const metrics = calculateAdsPeriodMetrics({
      rows: summaryRows,
      reportLevel: this.summaryReportLevel,
      coverageStatus,
      coverageRate,
    });
    const topAds = buildTopAds({
      rows: rankingRows,
      entityById,
      platform: this.platform,
      reportLevel: this.rankingReportLevel,
      coverageStatus,
      coverageRate,
      limit: topAdsLimit,
    });

    return Object.freeze({
      platform: this.platform,
      metrics,
      topAds,
      readSummary: Object.freeze({
        strategy: 'd1_ads_daily_facts',
        bounded: true,
        summaryReportLevel: this.summaryReportLevel,
        rankingReportLevel: this.rankingReportLevel,
        breakdownKey: this.breakdownKey,
        segmentKey: this.segmentKey,
        summaryFactRows: summaryRows.length,
        rankingFactRows: rankingRows.length,
        entityRows: entityRows.length,
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

function factSql() {
  return `
    SELECT * FROM ads_daily_facts
    WHERE customer_key = ? AND platform = ? AND account_key = ?
      AND report_level = ? AND breakdown_key = ? AND segment_key = ?
      AND metric_date >= ? AND metric_date <= ?
    ORDER BY metric_date ASC, ads_fact_key ASC LIMIT ?
  `;
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
