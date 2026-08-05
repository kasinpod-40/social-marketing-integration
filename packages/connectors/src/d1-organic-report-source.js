import {
  ORGANIC_READINESS_MODE,
  getReportPlatformContract,
} from '../../application/src/reports/report-platform-adapter-registry.js';
import { permanentError, transientError } from '../../shared/src/errors/runtime-error.js';

const DEFAULT_MAX_CONTENT = 10_000;
const MAX_CONTENT = 50_000;

/** Generic D1 historical Organic reader for Facebook, Instagram, TikTok and YouTube. */
export class D1OrganicReportSource {
  constructor(input = {}) {
    this.db = requireD1(input.db);
    this.platform = requireText(input.platform, 'platform');
    const contract = getReportPlatformContract(this.platform);
    if (contract.capability !== 'organic') {
      throw invalidQuery(`${this.platform} is not an Organic Report platform`);
    }
    this.datasetKey = requireText(
      input.datasetKey ?? contract.coverageDatasetKeys[0],
      'datasetKey',
    );
    this.accountDailyDatasetKey = optionalText(
      input.accountDailyDatasetKey ?? contract.accountDailyDatasetKey,
    );
    this.allowAccountFallback = input.allowAccountFallback === true
      || contract.organicReadinessMode === ORGANIC_READINESS_MODE.ACCOUNT_OR_CONTENT;
  }

  async load(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const timeZone = requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone');
    const periodStart = requireDate(input.periodStart, 'periodStart');
    const periodEnd = requireDate(input.periodEnd, 'periodEnd');
    const compareStart = optionalDate(input.compareStart, 'compareStart');
    const compareEnd = optionalDate(input.compareEnd, 'compareEnd');
    if (periodStart > periodEnd) throw invalidQuery('periodStart cannot be after periodEnd');
    if ((compareStart === null) !== (compareEnd === null)) {
      throw invalidQuery('compareStart and compareEnd must be provided together');
    }
    const earliestStart = compareStart ?? periodStart;
    const limit = boundedPositiveInteger(input.maxContentRecords ?? DEFAULT_MAX_CONTENT, 'maxContentRecords', MAX_CONTENT);
    const comparePromise = compareEnd
      ? this.#all(latestObservationSql('<='), [customerKey, this.platform, accountKey, compareEnd, limit + 1])
      : Promise.resolve([]);
    const accountCoveragePromise = this.accountDailyDatasetKey
      ? this.#first(`
        SELECT * FROM data_coverage_runs
        WHERE customer_key = ? AND platform = ? AND account_key = ?
          AND dataset_key = ? AND completed_at IS NOT NULL
        ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
      `, [customerKey, this.platform, accountKey, this.accountDailyDatasetKey])
      : Promise.resolve(null);
    const [
      states,
      currentRows,
      compareRows,
      baselineRows,
      contentCoverage,
      accountDailyFacts,
      accountCoverage,
    ] = await Promise.all([
      this.#all(`
        SELECT s.* FROM organic_content_state s
        WHERE s.customer_key = ? AND s.platform = ? AND s.account_key = ?
          AND EXISTS (
            SELECT 1 FROM organic_content_observations o
            WHERE o.content_key = s.content_key AND o.metric_date <= ?
          )
        ORDER BY s.content_key ASC LIMIT ?
      `, [customerKey, this.platform, accountKey, periodEnd, limit + 1]),
      this.#all(latestObservationSql('<='), [customerKey, this.platform, accountKey, periodEnd, limit + 1]),
      comparePromise,
      this.#all(latestObservationSql('<'), [customerKey, this.platform, accountKey, earliestStart, limit + 1]),
      this.#first(`
        SELECT * FROM data_coverage_runs
        WHERE customer_key = ? AND platform = ? AND account_key = ?
          AND dataset_key = ? AND completed_at IS NOT NULL
        ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC LIMIT 1
      `, [customerKey, this.platform, accountKey, this.datasetKey]),
      this.#all(`
        SELECT * FROM organic_account_daily_facts
        WHERE customer_key = ? AND platform = ? AND account_key = ?
          AND metric_date >= ? AND metric_date <= ?
        ORDER BY metric_date ASC, account_daily_key ASC LIMIT ?
      `, [customerKey, this.platform, accountKey, earliestStart, periodEnd, limit + 1]),
      accountCoveragePromise,
    ]);
    for (const [count, label] of [
      [states.length, 'content state rows'],
      [currentRows.length, 'current observation rows'],
      [compareRows.length, 'comparison observation rows'],
      [baselineRows.length, 'baseline observation rows'],
      [accountDailyFacts.length, 'account daily fact rows'],
    ]) assertWithinLimit(count, limit, label, this.platform);

    const sourceScope = currentRows.length > 0
      ? 'content'
      : (this.allowAccountFallback && accountDailyFacts.length > 0 ? 'account' : 'content');
    const selectedCoverage = sourceScope === 'account' ? accountCoverage : contentCoverage;
    const coverageEntities = sourceScope === 'content' && contentCoverage
      ? await this.#all(`
        SELECT external_entity_id, observation_status, source_revision, observed_at
        FROM data_coverage_entities
        WHERE coverage_run_id = ? AND entity_type = 'content'
        ORDER BY external_entity_id ASC LIMIT ?
      `, [contentCoverage.coverage_run_id, limit + 1])
      : [];
    assertWithinLimit(coverageEntities.length, limit, 'coverage entity rows', this.platform);

    const stateByKey = new Map(states.map((row) => [row.content_key, row]));
    const contents = currentRows.map((row) => buildContent(
      stateByKey.get(row.content_key), row, accountKey, this.platform, timeZone,
    ));
    const uniqueObservations = new Map();
    for (const row of [...currentRows, ...compareRows, ...baselineRows]) {
      uniqueObservations.set(row.observation_key, buildObservation(row, accountKey, this.platform));
    }
    const observations = [...uniqueObservations.values()].sort((left, right) => (
      left.externalContentId.localeCompare(right.externalContentId)
      || left.metricDate.localeCompare(right.metricDate)
      || String(left.recordId).localeCompare(String(right.recordId))
    ));
    const coverageById = new Map(coverageEntities.map((row) => [
      String(row.external_entity_id), row.observation_status,
    ]));
    const uncoveredContentIds = contents
      .map((content) => content.externalContentId)
      .filter((externalContentId) => coverageById.get(externalContentId) !== 'observed')
      .sort();

    return Object.freeze({
      platform: this.platform,
      contents: Object.freeze(contents),
      observations: Object.freeze(observations),
      dailySnapshots: Object.freeze(observations),
      accountDailyFacts: Object.freeze(accountDailyFacts),
      readSummary: Object.freeze({
        strategy: sourceScope === 'account'
          ? 'd1_organic_account_daily_range'
          : 'd1_organic_observation_range',
        bounded: true,
        sourceScope,
        contentRecords: contents.length,
        observationRecords: observations.length,
        accountFactRecords: accountDailyFacts.length,
        coverageDatasetKey: selectedCoverage?.dataset_key ?? null,
        coverageStatus: normalizeCoverageStatus(selectedCoverage?.status),
        contentCoverageStatus: normalizeCoverageStatus(contentCoverage?.status),
        accountCoverageStatus: normalizeCoverageStatus(accountCoverage?.status),
        coverageRunId: selectedCoverage?.coverage_run_id ?? null,
        expectedEntities: nullableInteger(selectedCoverage?.expected_entities),
        observedEntities: nullableInteger(selectedCoverage?.observed_entities),
        failedRows: nullableInteger(selectedCoverage?.failed_rows) ?? 0,
        coverageEntities: coverageEntities.length,
        uncoveredContentCount: uncoveredContentIds.length,
        uncoveredContentIds: Object.freeze(uncoveredContentIds.slice(0, 100)),
        sourceWatermark: selectedCoverage?.source_watermark ?? latestRevision(accountDailyFacts),
        coverageCompletedAt: nullableInteger(selectedCoverage?.completed_at),
        rowsFetched: states.length + currentRows.length + compareRows.length
          + baselineRows.length + accountDailyFacts.length + coverageEntities.length
          + (contentCoverage ? 1 : 0) + (accountCoverage ? 1 : 0),
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

function latestObservationSql(operator) {
  return `
    SELECT * FROM (
      SELECT o.*, ROW_NUMBER() OVER (
        PARTITION BY o.content_key ORDER BY o.observed_at DESC, o.observation_key DESC
      ) AS report_rank
      FROM organic_content_observations o
      WHERE o.customer_key = ? AND o.platform = ? AND o.account_key = ?
        AND o.metric_date ${operator} ?
    ) ranked
    WHERE report_rank = 1 ORDER BY content_key ASC LIMIT ?
  `;
}

function buildContent(state, observation, accountKey, platform, timeZone) {
  const publishedAt = nullableInteger(state?.published_at);
  return Object.freeze({
    recordId: state?.content_key ?? observation.content_key,
    contentKey: requireText(state?.content_key ?? observation.content_key, 'contentKey'),
    externalContentId: requireText(observation.external_content_id, 'externalContentId'),
    accountId: accountKey,
    platform,
    caption: null,
    contentUrl: null,
    thumbnailUrl: null,
    publishedAt,
    publishedDate: publishedAt === null ? null : dateInTimeZone(publishedAt, timeZone),
  });
}

function buildObservation(row, accountKey, platform) {
  return Object.freeze({
    recordId: requireText(row.observation_key, 'observationKey'),
    contentDailyKey: requireText(row.observation_key, 'observationKey'),
    externalContentId: requireText(row.external_content_id, 'externalContentId'),
    accountId: accountKey,
    platform,
    metricDateEpoch: Number(row.observed_at),
    metricDate: requireDate(row.metric_date, 'metricDate'),
    views: nullableNumber(row.views),
    likes: nullableNumber(row.likes),
    comments: nullableNumber(row.comments),
    shares: nullableNumber(row.shares),
    uniqueViewers: nullableNumber(row.unique_viewers),
    avgWatchTimeSeconds: nullableNumber(row.avg_watch_time_seconds),
    totalWatchTimeSeconds: nullableNumber(row.total_watch_time_seconds),
    completionRate: nullableNumber(row.completion_rate),
    coverageRunId: row.coverage_run_id ?? null,
    sourceRevision: row.source_revision ?? null,
  });
}

function dateInTimeZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
function assertWithinLimit(observed, limit, label, platform) {
  if (observed > limit) throw permanentError(`${platform} D1 report ${label} exceeded limit`, {
    code: 'REPORT_D1_SOURCE_CONTENT_LIMIT_EXCEEDED', details: { platform, observed, limit },
  });
}
function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw invalidQuery(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}
function optionalDate(value, fieldName) { return value == null || value === '' ? null : requireDate(value, fieldName); }
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw invalidQuery(`${fieldName} is required`);
  return value.trim();
}
function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}
function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw invalidQuery(`${fieldName} must be from 1 to ${maximum}`);
  }
  return number;
}
function normalizeCoverageStatus(value) {
  const status = optionalText(value)?.toLowerCase() ?? 'not_observed';
  return status === 'completed' ? 'complete' : status;
}
function latestRevision(rows) {
  const values = rows.map((row) => optionalText(row.source_revision)).filter(Boolean).sort();
  return values.at(-1) ?? null;
}
function requireD1(value) {
  if (typeof value?.prepare !== 'function') throw new TypeError('D1OrganicReportSource requires a D1 binding');
  return value;
}
function invalidQuery(message) { return permanentError(message, { code: 'REPORT_D1_SOURCE_INVALID' }); }
function readError(platform, cause) {
  return transientError(`Failed to read ${platform} Organic report source from D1`, {
    code: 'D1_ORGANIC_REPORT_READ_FAILED', cause,
    details: { platform, causeMessage: cause instanceof Error ? cause.message : String(cause ?? '') },
  });
}
