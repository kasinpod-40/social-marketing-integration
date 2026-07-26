import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const PLATFORM = 'youtube';
const CONTENT_DATASET_KEY = 'organic_content_cumulative';
const ACCOUNT_DATASET_KEY = 'organic_account_snapshot';
const DEFAULT_MAX_CONTENT = 10_000;
const MAX_CONTENT = 50_000;
const DEFAULT_MAX_ACCOUNT = 1_000;
const MAX_ACCOUNT = 10_000;

/**
 * Bounded D1 historical reader for YouTube Organic reports.
 * Returns normalized Report-engine rows and Coverage evidence, not Lark records.
 */
export class D1YouTubeOrganicReportSource {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async load(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const timeZone = requireText(input.timeZone ?? 'Asia/Bangkok', 'timeZone');
    const periodStart = requireDate(input.periodStart, 'periodStart');
    const periodEnd = requireDate(input.periodEnd, 'periodEnd');
    const compareStart = optionalDate(input.compareStart, 'compareStart');
    const compareEnd = optionalDate(input.compareEnd, 'compareEnd');
    const earliestStart = compareStart ?? periodStart;
    if (periodStart > periodEnd) throw invalidQuery('periodStart cannot be after periodEnd');
    if ((compareStart === null) !== (compareEnd === null)) {
      throw invalidQuery('compareStart and compareEnd must be provided together');
    }
    if (compareStart && compareStart > compareEnd) {
      throw invalidQuery('compareStart cannot be after compareEnd');
    }
    const maxContentRecords = boundedPositiveInteger(
      input.maxContentRecords ?? DEFAULT_MAX_CONTENT,
      'maxContentRecords',
      MAX_CONTENT,
    );
    const maxAccountRecords = boundedPositiveInteger(
      input.maxAccountRecords ?? DEFAULT_MAX_ACCOUNT,
      'maxAccountRecords',
      MAX_ACCOUNT,
    );

    const compareObservationPromise = compareEnd
      ? this.#all(latestObservationSql('<='), [
        customerKey, PLATFORM, accountKey, compareEnd, maxContentRecords + 1,
      ], 'D1_YOUTUBE_REPORT_OBSERVATION_READ_FAILED')
      : Promise.resolve([]);
    const compareAccountPromise = compareEnd
      ? this.#all(latestAccountSql('<='), [
        customerKey, PLATFORM, accountKey, compareEnd, maxAccountRecords + 1,
      ], 'D1_YOUTUBE_REPORT_ACCOUNT_READ_FAILED')
      : Promise.resolve([]);

    const [
      states,
      currentObservations,
      compareObservations,
      baselineObservations,
      currentAccounts,
      compareAccounts,
      baselineAccounts,
      coverageRows,
    ] = await Promise.all([
      this.#all(`
        SELECT s.*
        FROM organic_content_state s
        WHERE s.customer_key = ? AND s.platform = ? AND s.account_key = ?
          AND EXISTS (
            SELECT 1 FROM organic_content_observations o
            WHERE o.content_key = s.content_key AND o.metric_date <= ?
          )
        ORDER BY s.content_key ASC
        LIMIT ?
      `, [customerKey, PLATFORM, accountKey, periodEnd, maxContentRecords + 1], 'D1_YOUTUBE_REPORT_STATE_READ_FAILED'),
      this.#all(latestObservationSql('<='), [
        customerKey, PLATFORM, accountKey, periodEnd, maxContentRecords + 1,
      ], 'D1_YOUTUBE_REPORT_OBSERVATION_READ_FAILED'),
      compareObservationPromise,
      this.#all(latestObservationSql('<'), [
        customerKey, PLATFORM, accountKey, earliestStart, maxContentRecords + 1,
      ], 'D1_YOUTUBE_REPORT_OBSERVATION_READ_FAILED'),
      this.#all(latestAccountSql('<='), [
        customerKey, PLATFORM, accountKey, periodEnd, maxAccountRecords + 1,
      ], 'D1_YOUTUBE_REPORT_ACCOUNT_READ_FAILED'),
      compareAccountPromise,
      this.#all(latestAccountSql('<'), [
        customerKey, PLATFORM, accountKey, earliestStart, maxAccountRecords + 1,
      ], 'D1_YOUTUBE_REPORT_ACCOUNT_READ_FAILED'),
      this.#all(`
        SELECT * FROM (
          SELECT r.*,
            ROW_NUMBER() OVER (
              PARTITION BY r.dataset_key
              ORDER BY r.completed_at DESC, r.coverage_run_id ASC
            ) AS report_rank
          FROM data_coverage_runs r
          WHERE r.customer_key = ? AND r.platform = ? AND r.account_key = ?
            AND r.dataset_key IN (?, ?) AND r.completed_at IS NOT NULL
        ) ranked
        WHERE report_rank = 1
        ORDER BY dataset_key ASC
        LIMIT 2
      `, [customerKey, PLATFORM, accountKey, CONTENT_DATASET_KEY, ACCOUNT_DATASET_KEY], 'D1_YOUTUBE_REPORT_COVERAGE_READ_FAILED'),
    ]);

    assertWithinLimit(states.length, maxContentRecords, 'content state rows');
    assertWithinLimit(currentObservations.length, maxContentRecords, 'current observation rows');
    assertWithinLimit(compareObservations.length, maxContentRecords, 'comparison observation rows');
    assertWithinLimit(baselineObservations.length, maxContentRecords, 'baseline observation rows');
    assertWithinLimit(currentAccounts.length, maxAccountRecords, 'current account rows');
    assertWithinLimit(compareAccounts.length, maxAccountRecords, 'comparison account rows');
    assertWithinLimit(baselineAccounts.length, maxAccountRecords, 'baseline account rows');

    const coverageByDataset = new Map(coverageRows.map((row) => [row.dataset_key, row]));
    const contentCoverage = coverageByDataset.get(CONTENT_DATASET_KEY) ?? null;
    const accountCoverage = coverageByDataset.get(ACCOUNT_DATASET_KEY) ?? null;
    const coverageEntities = contentCoverage
      ? await this.#all(`
        SELECT external_entity_id, observation_status, source_revision, observed_at
        FROM data_coverage_entities
        WHERE coverage_run_id = ? AND entity_type = 'content'
        ORDER BY external_entity_id ASC
        LIMIT ?
      `, [contentCoverage.coverage_run_id, maxContentRecords + 1], 'D1_YOUTUBE_REPORT_COVERAGE_READ_FAILED')
      : [];
    assertWithinLimit(coverageEntities.length, maxContentRecords, 'coverage entity rows');

    const stateByKey = new Map(states.map((row) => [row.content_key, row]));
    const contents = currentObservations.map((row) => buildContent(
      stateByKey.get(row.content_key),
      row,
      accountKey,
      timeZone,
    ));
    const observations = new Map();
    for (const row of [...currentObservations, ...compareObservations, ...baselineObservations]) {
      observations.set(row.observation_key, buildSnapshot(row, accountKey));
    }
    const dailySnapshots = [...observations.values()].sort((left, right) => (
      left.externalContentId.localeCompare(right.externalContentId)
      || left.metricDate.localeCompare(right.metricDate)
      || String(left.recordId).localeCompare(String(right.recordId))
    ));
    const accounts = new Map();
    for (const row of [...currentAccounts, ...compareAccounts, ...baselineAccounts]) {
      accounts.set(row.account_daily_key, buildAccountSnapshot(row, accountKey));
    }
    const accountDailySnapshots = [...accounts.values()].sort((left, right) => (
      left.metricDate.localeCompare(right.metricDate)
      || String(left.recordId).localeCompare(String(right.recordId))
    ));
    const coverageById = new Map(coverageEntities.map((row) => [
      String(row.external_entity_id),
      row.observation_status,
    ]));
    const uncoveredContentIds = contents
      .map((content) => content.externalContentId)
      .filter((externalContentId) => coverageById.get(externalContentId) !== 'observed')
      .sort();
    const dataStatus = deriveDataStatus(contentCoverage, uncoveredContentIds.length);

    return Object.freeze({
      contents: Object.freeze(contents),
      dailySnapshots: Object.freeze(dailySnapshots),
      accountDailySnapshots: Object.freeze(accountDailySnapshots),
      dataStatus,
      readSummary: Object.freeze({
        strategy: 'd1_youtube_observation_range',
        bounded: true,
        contentRecords: contents.length,
        dailySnapshotRecords: dailySnapshots.length,
        accountDailySnapshotRecords: accountDailySnapshots.length,
        externalContentIds: contents.length,
        contentQueries: 4,
        accountQueries: compareEnd ? 3 : 2,
        coverageQueries: contentCoverage ? 2 : 1,
        rowsFetched: states.length
          + currentObservations.length
          + compareObservations.length
          + baselineObservations.length
          + currentAccounts.length
          + compareAccounts.length
          + baselineAccounts.length
          + coverageRows.length
          + coverageEntities.length,
        fallbackRowsScanned: 0,
        baselinePolicy: 'latest_observation_before_earliest_period_per_content',
        metricPolicy: 'cumulative_end_minus_pre_period_baseline',
        coverageStatus: contentCoverage?.status ?? 'not_observed',
        coverageRunId: contentCoverage?.coverage_run_id ?? null,
        expectedEntities: nullableInteger(contentCoverage?.expected_entities),
        observedEntities: nullableInteger(contentCoverage?.observed_entities),
        failedRows: nullableInteger(contentCoverage?.failed_rows) ?? 0,
        coverageEntities: coverageEntities.length,
        uncoveredContentCount: uncoveredContentIds.length,
        uncoveredContentIds: Object.freeze(uncoveredContentIds.slice(0, 100)),
        sourceWatermark: contentCoverage?.source_watermark ?? null,
        coverageCompletedAt: nullableInteger(contentCoverage?.completed_at),
        accountCoverageStatus: accountCoverage?.status ?? 'not_observed',
        accountCoverageRunId: accountCoverage?.coverage_run_id ?? null,
      }),
    });
  }

  async #all(sql, bindings, code) {
    try {
      const result = await this.db.prepare(sql).bind(...bindings).all();
      const rows = Array.isArray(result) ? result : (result?.results ?? []);
      return rows.map((row) => Object.freeze({ ...row }));
    } catch (cause) {
      throw readError(code, cause);
    }
  }
}

function latestObservationSql(operator) {
  return `
    SELECT * FROM (
      SELECT o.*,
        ROW_NUMBER() OVER (
          PARTITION BY o.content_key
          ORDER BY o.observed_at DESC, o.observation_key DESC
        ) AS report_rank
      FROM organic_content_observations o
      WHERE o.customer_key = ? AND o.platform = ? AND o.account_key = ?
        AND o.metric_date ${operator} ?
    ) ranked
    WHERE report_rank = 1
    ORDER BY content_key ASC
    LIMIT ?
  `;
}

function latestAccountSql(operator) {
  return `
    SELECT * FROM (
      SELECT a.*,
        ROW_NUMBER() OVER (
          PARTITION BY a.account_key
          ORDER BY a.metric_date DESC, a.account_daily_key DESC
        ) AS report_rank
      FROM organic_account_daily_facts a
      WHERE a.customer_key = ? AND a.platform = ? AND a.account_key = ?
        AND a.metric_date ${operator} ?
    ) ranked
    WHERE report_rank = 1
    ORDER BY account_key ASC
    LIMIT ?
  `;
}

function buildContent(state, observation, accountKey, timeZone) {
  const publishedAt = nullableInteger(state?.published_at);
  return Object.freeze({
    recordId: state?.content_key ?? observation.content_key,
    contentKey: requireText(state?.content_key ?? observation.content_key, 'contentKey'),
    externalContentId: requireText(observation.external_content_id, 'externalContentId'),
    accountId: accountKey,
    platform: PLATFORM,
    caption: null,
    contentUrl: null,
    thumbnailUrl: null,
    publishedAt,
    publishedDate: publishedAt === null ? null : dateInTimeZone(publishedAt, timeZone),
    sourceAvailabilityStatus: state?.source_availability_status ?? 'unknown',
  });
}

function buildSnapshot(row, accountKey) {
  return Object.freeze({
    recordId: requireText(row.observation_key, 'observationKey'),
    contentDailyKey: requireText(row.observation_key, 'observationKey'),
    externalContentId: requireText(row.external_content_id, 'externalContentId'),
    accountId: accountKey,
    platform: PLATFORM,
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
    observationKind: row.observation_kind ?? null,
    coverageRunId: row.coverage_run_id ?? null,
    sourceRevision: row.source_revision ?? null,
  });
}

function buildAccountSnapshot(row, accountKey) {
  return Object.freeze({
    recordId: requireText(row.account_daily_key, 'accountDailyKey'),
    accountDailyKey: requireText(row.account_daily_key, 'accountDailyKey'),
    accountId: accountKey,
    sourceAccountId: row.source_account_id ?? null,
    platform: PLATFORM,
    metricDate: requireDate(row.metric_date, 'metricDate'),
    followers: nullableNumber(row.followers),
    views: nullableNumber(row.views),
    dataStatus: row.data_status ?? 'not_observed',
    coverageRunId: row.coverage_run_id ?? null,
    sourceRevision: row.source_revision ?? null,
  });
}

function deriveDataStatus(coverage, uncoveredContentCount) {
  if (!coverage) return 'not_observed';
  if (coverage.status === 'source_unavailable') return 'source_unavailable';
  if (coverage.status !== 'complete'
    || Number(coverage.failed_rows ?? 0) > 0
    || uncoveredContentCount > 0) return 'partial';
  return 'complete';
}

function dateInTimeZone(value, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date(value));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function assertWithinLimit(observed, limit, label) {
  if (observed > limit) {
    throw permanentError(`YouTube D1 report ${label} exceeded the configured limit`, {
      code: 'REPORT_D1_SOURCE_CONTENT_LIMIT_EXCEEDED',
      details: { observed, limit },
    });
  }
}

function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw invalidQuery(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}

function optionalDate(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requireDate(value, fieldName);
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw invalidQuery(`${fieldName} is required`);
  return value.trim();
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

function requireD1(value) {
  if (typeof value?.prepare !== 'function') {
    throw new TypeError('D1YouTubeOrganicReportSource requires a D1 binding');
  }
  return value;
}

function invalidQuery(message) {
  return permanentError(message, { code: 'REPORT_D1_SOURCE_INVALID' });
}

function readError(code, cause) {
  return transientError('Failed to read YouTube Organic report source from D1', {
    code,
    cause,
    details: { causeMessage: cause instanceof Error ? cause.message : String(cause ?? '') },
  });
}
