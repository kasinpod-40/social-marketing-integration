import { permanentError, transientError } from '../../../shared/src/errors/runtime-error.js';

const DEFAULT_MAX_CONTENT = 10_000;
const MAX_CONTENT = 50_000;

/** Read-only aggregate audit. No method in this adapter mutates D1. */
export class D1TikTokPostLarkAuditStore {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async audit(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const platform = 'tiktok';
    const maxContentRecords = boundedPositiveInteger(
      input.maxContentRecords ?? DEFAULT_MAX_CONTENT,
      'maxContentRecords',
      MAX_CONTENT,
    );
    const [state, observations, coverage, contentIdentities] = await Promise.all([
      this.#first(`
        SELECT
          COUNT(*) AS total_rows,
          COUNT(DISTINCT content_key) AS distinct_keys,
          COUNT(*) - COUNT(DISTINCT content_key) AS duplicate_keys,
          MAX(last_observed_at) AS latest_observed_at,
          SUM(CASE WHEN content_key IS NULL OR TRIM(content_key) = '' THEN 1 ELSE 0 END) AS missing_keys
        FROM organic_content_state
        WHERE customer_key = ? AND platform = ? AND account_key = ?
      `, [customerKey, platform, accountKey]),
      this.#first(`
        SELECT
          COUNT(*) AS total_rows,
          COUNT(DISTINCT observation_key) AS distinct_keys,
          COUNT(*) - COUNT(DISTINCT observation_key) AS duplicate_keys,
          MAX(observed_at) AS latest_observed_at,
          SUM(CASE WHEN observation_key IS NULL OR TRIM(observation_key) = '' THEN 1 ELSE 0 END) AS missing_keys
        FROM organic_content_observations
        WHERE customer_key = ? AND platform = ? AND account_key = ?
      `, [customerKey, platform, accountKey]),
      this.#first(`
        SELECT *
        FROM data_coverage_runs
        WHERE customer_key = ? AND platform = ? AND account_key = ?
          AND dataset_key = 'organic_content_cumulative'
        ORDER BY completed_at DESC, started_at DESC, coverage_run_id ASC
        LIMIT 1
      `, [customerKey, platform, accountKey]),
      this.#all(`
        SELECT content_key, external_content_id
        FROM organic_content_state
        WHERE customer_key = ? AND platform = ? AND account_key = ?
        ORDER BY content_key ASC
        LIMIT ?
      `, [customerKey, platform, accountKey, maxContentRecords + 1]),
    ]);
    assertWithinLimit(contentIdentities.length, maxContentRecords, 'content identities');

    const coverageRunId = optionalText(coverage?.coverage_run_id);
    const [coverageEntities, missingObservation, missingCoverage] = await Promise.all([
      coverageRunId
        ? this.#first(`
          SELECT
            COUNT(*) AS total_rows,
            COUNT(DISTINCT coverage_entity_key) AS distinct_keys,
            COUNT(*) - COUNT(DISTINCT coverage_entity_key) AS duplicate_keys,
            SUM(CASE WHEN observation_status = 'observed' THEN 1 ELSE 0 END) AS observed_rows,
            SUM(CASE WHEN observation_status <> 'observed' THEN 1 ELSE 0 END) AS non_observed_rows
          FROM data_coverage_entities
          WHERE coverage_run_id = ? AND entity_type = 'content'
        `, [coverageRunId])
        : Promise.resolve(null),
      this.#first(`
        SELECT COUNT(*) AS missing_rows
        FROM organic_content_state s
        WHERE s.customer_key = ? AND s.platform = ? AND s.account_key = ?
          AND NOT EXISTS (
            SELECT 1 FROM organic_content_observations o
            WHERE o.content_key = s.content_key
          )
      `, [customerKey, platform, accountKey]),
      coverageRunId
        ? this.#first(`
          SELECT COUNT(*) AS missing_rows
          FROM organic_content_state s
          WHERE s.customer_key = ? AND s.platform = ? AND s.account_key = ?
            AND NOT EXISTS (
              SELECT 1 FROM data_coverage_entities e
              WHERE e.coverage_run_id = ?
                AND e.entity_type = 'content'
                AND e.external_entity_id = s.external_content_id
                AND e.observation_status = 'observed'
            )
        `, [customerKey, platform, accountKey, coverageRunId])
        : Promise.resolve(null),
    ]);

    return Object.freeze({
      customerKey,
      accountKey,
      platform,
      state: freezeCounts(state),
      observations: freezeCounts(observations),
      contentIdentities: Object.freeze(contentIdentities.map((row) => Object.freeze({
        contentKey: requireText(row.content_key, 'contentKey'),
        externalContentId: requireText(row.external_content_id, 'externalContentId'),
      }))),
      coverage: coverage ? Object.freeze({
        coverageRunId,
        status: coverage.status ?? null,
        expectedEntities: nullableInteger(coverage.expected_entities),
        observedEntities: nullableInteger(coverage.observed_entities),
        expectedRows: nullableInteger(coverage.expected_rows),
        observedRows: nullableInteger(coverage.observed_rows),
        failedRows: nullableInteger(coverage.failed_rows) ?? 0,
        sourceWatermark: coverage.source_watermark ?? null,
        completedAt: nullableInteger(coverage.completed_at),
      }) : null,
      coverageEntities: coverageEntities ? Object.freeze({
        ...freezeCounts(coverageEntities),
        observedRows: nullableInteger(coverageEntities.observed_rows) ?? 0,
        nonObservedRows: nullableInteger(coverageEntities.non_observed_rows) ?? 0,
      }) : null,
      missingObservationRows: nullableInteger(missingObservation?.missing_rows) ?? 0,
      missingCoverageRows: nullableInteger(missingCoverage?.missing_rows),
    });
  }

  async #first(sql, bindings) {
    try {
      const row = await this.db.prepare(sql).bind(...bindings).first();
      return row ? Object.freeze({ ...row }) : null;
    } catch (cause) {
      throw readError(cause);
    }
  }

  async #all(sql, bindings) {
    try {
      const result = await this.db.prepare(sql).bind(...bindings).all();
      const rows = Array.isArray(result) ? result : (result?.results ?? []);
      return rows.map((row) => Object.freeze({ ...row }));
    } catch (cause) {
      throw readError(cause);
    }
  }
}

function freezeCounts(row) {
  return Object.freeze({
    totalRows: nullableInteger(row?.total_rows) ?? 0,
    distinctKeys: nullableInteger(row?.distinct_keys) ?? 0,
    duplicateKeys: nullableInteger(row?.duplicate_keys) ?? 0,
    missingKeys: nullableInteger(row?.missing_keys) ?? 0,
    latestObservedAt: nullableInteger(row?.latest_observed_at),
  });
}

function assertWithinLimit(observed, limit, label) {
  if (observed > limit) {
    throw permanentError(`TikTok D1 audit ${label} exceeded the configured limit`, {
      code: 'TIKTOK_POST_LARK_AUDIT_LIMIT_EXCEEDED',
      details: { observed, limit },
    });
  }
}

function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw new TypeError(`${fieldName} must be from 1 to ${maximum}`);
  }
  return number;
}

function nullableInteger(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isSafeInteger(number) ? number : null;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function requireD1(value) {
  if (typeof value?.prepare !== 'function') {
    throw new TypeError('D1TikTokPostLarkAuditStore requires a D1 binding');
  }
  return value;
}

function readError(cause) {
  return transientError('Failed to read TikTok post-Lark D1 audit', {
    code: 'D1_TIKTOK_POST_LARK_AUDIT_FAILED',
    cause,
    details: { causeMessage: cause instanceof Error ? cause.message : String(cause ?? '') },
  });
}
