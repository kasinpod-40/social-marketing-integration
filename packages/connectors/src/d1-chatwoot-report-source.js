import { permanentError, transientError } from '../../shared/src/errors/runtime-error.js';

const DEFAULT_MAX_FACT_ROWS = 10_000;
const MAX_FACT_ROWS = 50_000;
const REQUIRED_COVERAGE_DATASETS = Object.freeze([
  'chatwoot.conversation_daily',
  'chatwoot.account_daily',
]);
const PRIMARY_COVERAGE_DATASET = REQUIRED_COVERAGE_DATASETS[0];
const ACCEPTED_DATA_STATUS = new Set(['complete', 'completed', 'no_data_confirmed', 'partial']);
const ACCEPTED_COVERAGE_STATUS = new Set(['complete', 'no_data_confirmed', 'revisable']);

/** Bounded PII-minimized D1 source for the generic Chatwoot Customer Service Report. */
export class D1ChatwootReportSource {
  constructor(input = {}) {
    this.db = requireD1(input.db);
  }

  async load(input = {}) {
    const customerKey = requireText(input.customerKey, 'customerKey');
    const accountKey = requireText(input.accountKey, 'accountKey');
    const periodStart = requireDate(input.periodStart, 'periodStart');
    const periodEnd = requireDate(input.periodEnd, 'periodEnd');
    if (periodStart > periodEnd) throw invalidQuery('periodStart cannot be after periodEnd');
    const limit = boundedPositiveInteger(
      input.maxFactRows ?? DEFAULT_MAX_FACT_ROWS,
      'maxFactRows',
      MAX_FACT_ROWS,
    );

    const [facts, snapshot, coverageRows] = await Promise.all([
      this.#all(`
        SELECT
          metric_date, reporting_timezone, external_conversation_id,
          external_inbox_id, external_agent_id, data_status,
          new_conversation_count, resolved_count, reopened_count,
          incoming_message_count, outgoing_message_count,
          private_message_count, attachment_message_count,
          first_response_seconds, resolution_seconds, reply_seconds,
          coverage_run_id, source_revision, fetched_at
        FROM chatwoot_conversation_daily_facts
        WHERE customer_key = ? AND account_key = ?
          AND metric_date BETWEEN ? AND ?
        ORDER BY metric_date ASC, external_conversation_id ASC
        LIMIT ?
      `, [customerKey, accountKey, periodStart, periodEnd, limit + 1]),
      this.#first(`
        SELECT
          metric_date, reporting_timezone, data_status,
          conversation_count, open_conversation_count,
          pending_conversation_count, snoozed_conversation_count,
          active_agent_count, active_inbox_count,
          coverage_run_id, source_revision, fetched_at
        FROM chatwoot_account_daily_facts
        WHERE customer_key = ? AND account_key = ?
          AND metric_date BETWEEN ? AND ?
        ORDER BY metric_date DESC, updated_at DESC, account_daily_key ASC
        LIMIT 1
      `, [customerKey, accountKey, periodStart, periodEnd]),
      this.#all(`
        SELECT * FROM (
          SELECT *, ROW_NUMBER() OVER (
            PARTITION BY dataset_key
            ORDER BY completed_at DESC, updated_at DESC, coverage_run_id ASC
          ) AS dataset_rank
          FROM data_coverage_runs
          WHERE customer_key = ? AND platform = 'chatwoot' AND account_key = ?
            AND dataset_key IN (?, ?)
            AND completed_at IS NOT NULL
            AND period_start <= ? AND period_end >= ?
        ) ranked
        WHERE dataset_rank = 1
        ORDER BY dataset_key ASC
      `, [
        customerKey,
        accountKey,
        ...REQUIRED_COVERAGE_DATASETS,
        periodStart,
        periodEnd,
      ]),
    ]);

    if (facts.length > limit) throw permanentError('Chatwoot D1 Report facts exceeded limit', {
      code: 'CHATWOOT_REPORT_D1_FACT_LIMIT_EXCEEDED',
      details: { observed: facts.length, limit },
    });

    const coverageByDataset = new Map(coverageRows.map((row) => [row.dataset_key, row]));
    const primaryCoverage = coverageByDataset.get(PRIMARY_COVERAGE_DATASET) ?? null;
    const requiredCoveragePresent = REQUIRED_COVERAGE_DATASETS.every((key) => coverageByDataset.has(key));
    const coverageWatermarksPresent = REQUIRED_COVERAGE_DATASETS.every((key) => (
      optionalText(coverageByDataset.get(key)?.source_watermark) !== null
    ));
    const reportingTimezones = new Set([
      ...facts.map((row) => optionalText(row.reporting_timezone)),
      optionalText(snapshot?.reporting_timezone),
    ].filter(Boolean));
    if (reportingTimezones.size > 1) throw permanentError('Chatwoot Report timezone drifted inside one period', {
      code: 'CHATWOOT_REPORT_TIMEZONE_DRIFT',
      details: { timezoneCount: reportingTimezones.size },
    });

    const rowsComplete = facts.every((row) => ACCEPTED_DATA_STATUS.has(String(row.data_status ?? '').trim()));
    const snapshotComplete = !snapshot
      || ACCEPTED_DATA_STATUS.has(String(snapshot.data_status ?? '').trim());
    const coverageStatus = normalizeCoverageStatus(primaryCoverage?.status);
    const coverageComplete = requiredCoveragePresent
      && coverageWatermarksPresent
      && REQUIRED_COVERAGE_DATASETS.every((key) => {
        const coverage = coverageByDataset.get(key);
        return ACCEPTED_COVERAGE_STATUS.has(normalizeCoverageStatus(coverage?.status))
          && Number(coverage?.failed_rows ?? 0) === 0;
      });
    const watermark = optionalText(primaryCoverage?.source_watermark)
      ?? optionalText(snapshot?.source_revision)
      ?? optionalText(facts.at(-1)?.source_revision);

    return Object.freeze({
      facts: Object.freeze(facts),
      periodEndSnapshot: snapshot ? Object.freeze({ ...snapshot }) : null,
      coverage: Object.freeze({
        status: coverageStatus,
        complete: coverageComplete && rowsComplete && snapshotComplete,
        failedRows: REQUIRED_COVERAGE_DATASETS.reduce(
          (total, key) => total + nonNegativeIntegerOrZero(coverageByDataset.get(key)?.failed_rows),
          0,
        ),
        expectedEntities: nullableInteger(primaryCoverage?.expected_entities),
        observedEntities: nullableInteger(primaryCoverage?.observed_entities),
        coverageRunId: optionalText(primaryCoverage?.coverage_run_id),
        sourceWatermark: watermark,
        requiredDatasetCount: REQUIRED_COVERAGE_DATASETS.length,
        selectedDatasetCount: coverageRows.length,
        watermarkDatasetCount: REQUIRED_COVERAGE_DATASETS.filter((key) => (
          optionalText(coverageByDataset.get(key)?.source_watermark) !== null
        )).length,
      }),
      readSummary: Object.freeze({
        strategy: 'd1_chatwoot_customer_service_period',
        bounded: true,
        factRows: facts.length,
        snapshotRows: snapshot ? 1 : 0,
        coverageStatus,
        coverageComplete: coverageComplete && rowsComplete && snapshotComplete,
        coverageDatasetKeys: REQUIRED_COVERAGE_DATASETS,
        selectedCoverageDatasetCount: coverageRows.length,
        sourceWatermark: watermark,
        reportingTimezone: [...reportingTimezones][0] ?? null,
      }),
    });
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

  async #first(sql, bindings) {
    try {
      const row = await this.db.prepare(sql).bind(...bindings).first();
      return row ? Object.freeze({ ...row }) : null;
    } catch (cause) {
      throw readError(cause);
    }
  }
}

function normalizeCoverageStatus(value) {
  const status = String(value ?? '').trim().toLowerCase();
  if (status === 'completed') return 'complete';
  return status || 'not_observed';
}
function requireD1(value) {
  if (typeof value?.prepare !== 'function') throw new TypeError('D1ChatwootReportSource requires a D1 binding');
  return value;
}
function requireDate(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00Z`))) {
    throw invalidQuery(`${fieldName} must be YYYY-MM-DD`);
  }
  return text;
}
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
function nonNegativeIntegerOrZero(value) {
  const number = Number(value ?? 0);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}
function boundedPositiveInteger(value, fieldName, maximum) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw invalidQuery(`${fieldName} must be from 1 to ${maximum}`);
  }
  return number;
}
function invalidQuery(message) {
  return permanentError(message, { code: 'CHATWOOT_REPORT_D1_SOURCE_INVALID' });
}
function readError(cause) {
  return transientError('Failed to read Chatwoot Customer Service report source from D1', {
    code: 'D1_CHATWOOT_REPORT_READ_FAILED',
    cause,
    details: { causeMessage: cause instanceof Error ? cause.message : String(cause ?? '') },
  });
}
