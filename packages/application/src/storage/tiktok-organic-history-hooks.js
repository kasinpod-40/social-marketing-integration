import { createOrganicHistoryWriter } from './organic-history-writer.js';
import { validateStorageRow } from './marketing-history-contract.js';
import {
  buildTikTokPortfolioAccountDailyFact,
  projectOrganicAccountDailyFactToLark,
} from '../use-cases/organic-account-daily-projection.js';

/** สร้าง Hooks สำหรับ TikTok staged Canonical path โดยบังคับ D1 ก่อน Lark ทุก Unit */
export function createTikTokOrganicHistoryHooks(input = {}) {
  const writer = createOrganicHistoryWriter({
    ...input,
    // Incremental selected Content เป็น exact entity set ตาม Coverage contract
    scopeMode: input.scopeMode === 'changed_entities' ? 'exact_entities' : input.scopeMode,
  });
  const sourceWatermark = requireText(input.sourceWatermark, 'sourceWatermark');

  return Object.freeze({
    enabled: true,
    destinationMode: 'd1_then_lark',
    coverageRunId: writer.context.coverageRunId,
    async preflightUnit(prepared) {
      const plan = await writer.preflightBatch(readPreparedBatch(prepared));
      return Object.freeze({
        contentRows: plan.contentRows,
        stateRows: plan.stateRows.length,
        observationRows: plan.observationRows.length,
      });
    },
    async begin(summary) {
      return writer.beginCoverage({
        expectedEntities: summary.contentRows,
        expectedRows: summary.contentRows,
        sourceWatermark,
      });
    },
    async writeUnit(prepared) {
      return writer.writeBatch(readPreparedBatch(prepared));
    },
    async materializeAccountDaily() {
      const aggregate = await writer.context.gateway.readOrganicAccountSnapshotAggregate({
        customerKey: writer.context.customerKey,
        platform: 'tiktok',
        accountKey: writer.context.accountKey,
      });
      const accountCoverageRunId = `${writer.context.coverageRunId}:account_daily`;
      const fact = buildTikTokPortfolioAccountDailyFact({
        aggregate,
        customerKey: writer.context.customerKey,
        accountKey: writer.context.accountKey,
        sourceAccountId: writer.context.sourceAccountId ?? writer.context.accountKey,
        metricDate: writer.context.metricDate,
        sourceTimezone: writer.context.sourceTimezone,
        coverageRunId: accountCoverageRunId,
        sourceRevision: writer.context.sourceRevision ?? sourceWatermark,
        fetchedAt: writer.context.fetchedAt,
        observedAt: writer.context.observedAt,
        syncRunId: writer.context.historySyncRunId,
      });
      const write = await writer.context.gateway.upsertOrganicAccountDailyFact(fact);
      await writer.context.gateway.saveCoverageRun(validateStorageRow('data_coverage_runs', {
        coverage_run_id: accountCoverageRunId,
        sync_run_id: writer.context.historySyncRunId,
        customer_key: writer.context.customerKey,
        platform: 'tiktok',
        account_key: writer.context.accountKey,
        dataset_key: 'organic_account_portfolio_snapshot',
        metric_semantics: 'snapshot',
        scope_mode: 'full_inventory',
        period_start: writer.context.metricDate,
        period_end: writer.context.metricDate,
        source_timezone: writer.context.sourceTimezone,
        status: fact.data_status,
        expected_entities: aggregate.row_count,
        observed_entities: aggregate.row_count,
        expected_rows: 1,
        observed_rows: 1,
        written_rows: 1,
        failed_rows: 0,
        source_watermark: sourceWatermark,
        revisable_until: null,
        started_at: writer.context.observedAt,
        completed_at: writer.context.observedAt,
        error_code: null,
        created_at: writer.context.observedAt,
        updated_at: writer.context.observedAt,
      }));
      return Object.freeze({
        fact,
        larkRow: projectOrganicAccountDailyFactToLark({
          fact,
          canonicalAccountKey: `tiktok:${writer.context.accountKey}`,
        }),
        aggregate,
        write,
      });
    },
    async complete(summary, completedAt = Date.now()) {
      return writer.completeCoverage({
        expectedEntities: summary.contentRows,
        observedEntities: summary.contentRowsDurable,
        expectedRows: summary.contentRows,
        observedRows: summary.contentRowsDurable,
        writtenRows: summary.contentRowsDurable + summary.observationRowsDurable,
        sourceWatermark,
        completedAt,
      });
    },
    async fail(summary, error, completedAt = Date.now()) {
      return writer.failCoverage({
        expectedEntities: summary?.contentRows ?? 0,
        observedEntities: summary?.contentRowsDurable ?? 0,
        expectedRows: summary?.contentRows ?? 0,
        observedRows: summary?.contentRowsDurable ?? 0,
        writtenRows: (summary?.contentRowsDurable ?? 0) + (summary?.observationRowsDurable ?? 0),
        failedRows: 1,
        sourceWatermark,
        errorCode: error?.code ?? 'TIKTOK_D1_FIRST_WRITE_FAILED',
        completedAt,
      });
    },
  });
}

function readPreparedBatch(prepared) {
  const contentRows = Array.isArray(prepared?.normalized?.contentRows)
    ? prepared.normalized.contentRows
    : [];
  const dailyRows = Array.isArray(prepared?.normalized?.dailySnapshotRows)
    ? prepared.normalized.dailySnapshotRows
    : [];
  const selectedIds = Array.isArray(prepared?.incremental?.selectedExternalContentIds)
    ? new Set(prepared.incremental.selectedExternalContentIds)
    : null;

  if (!selectedIds) {
    return Object.freeze({ contentRows, dailySnapshotRows: dailyRows });
  }
  return Object.freeze({
    contentRows: Object.freeze(contentRows.filter((row) => selectedIds.has(row.external_content_id))),
    dailySnapshotRows: Object.freeze(dailyRows.filter((row) => selectedIds.has(row.external_content_id))),
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`TikTok Organic history hooks require ${fieldName}`);
  }
  return value.trim();
}
