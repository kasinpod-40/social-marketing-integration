import { loadReportSetting } from '../reports/load-report-setting.js';
import { resolveOrganicReportPeriod } from '../reports/report-period.js';
import { loadTikTokOrganicReportSource } from '../reports/load-tiktok-organic-report-source.js';
import { loadTikTokOrganicReportSourceFromD1 } from '../reports/load-tiktok-organic-report-source-d1.js';
import {
  normalizeTikTokContentRecords,
  normalizeTikTokDailySnapshotRecords,
} from '../reports/tiktok-organic-report-source.js';
import { calculateTikTokOrganicPeriodMetrics } from '../reports/calculate-tiktok-organic-report.js';
import { compareTikTokOrganicReportResults } from '../reports/compare-tiktok-organic-report-results.js';
import { createTikTokReportSourceOverrideRepository } from '../reports/tiktok-report-source-override-repository.js';
import { createReportId as createStorageReportId } from '../storage/marketing-history-contract.js';
import { generateTikTokOrganicReport } from './generate-tiktok-organic-report.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const FORMULA_VERSION = 'tiktok-organic-v1';
const MATERIALIZATION_SCHEMA_VERSION = 'tiktok-organic-materialization-v1';

/** Reuse the existing calculator/output writer while selecting Lark, D1 or shadow mode. */
export async function generateTikTokOrganicReportD1Aware(input = {}) {
  const storage = requireStorageConfig(input.storageConfig);
  if (!storage.reportD1ReadEnabled && !storage.reportD1ShadowReadEnabled) {
    return generateTikTokOrganicReport(input);
  }
  const repository = requireRepository(input.repository);
  const tables = requireTables(input.tables);
  const setting = await loadReportSetting({
    repository,
    tableId: tables.mktReportSettings,
    reportSettingKey: requireText(input.reportSettingKey, 'reportSettingKey'),
    customerProfile: requireText(input.customerProfile, 'customerProfile'),
  });
  const accountId = requireText(input.accountId ?? setting.accountKeys[0], 'accountId');
  const reportType = requireText(input.reportType, 'reportType');
  const period = resolveOrganicReportPeriod({
    reportType,
    timeZone: setting.timeZone,
    comparisonMode: input.comparisonMode ?? setting.comparisonMode,
    periodEnd: input.periodEnd,
    now: new Date((typeof input.now === 'function' ? input.now() : Date.now())),
  });
  const d1Source = await loadTikTokOrganicReportSourceFromD1({
    source: requireD1Source(input.d1Source),
    customerKey: requireText(input.customerKey, 'customerKey'),
    accountKey: accountId,
    timeZone: setting.timeZone,
    period,
    maxContentRecords: input.d1MaxContentRecords,
  });
  const d1Calculation = calculateTikTokOrganicPeriodMetrics({
    contents: d1Source.contents,
    dailySnapshots: d1Source.dailySnapshots,
    periodStart: period.periodStart,
    periodEnd: period.periodEnd,
  });
  assertD1CoverageReady(d1Source.readSummary, storage.reportD1ReadEnabled);

  let parity = null;
  if (storage.reportD1ShadowReadEnabled) {
    const larkSource = await loadTikTokOrganicReportSource({
      repository,
      tables,
      accountId,
      period,
      utcOffset: setting.utcOffset,
      maxContentRecords: input.shadowMaxContentRecords ?? input.d1MaxContentRecords,
      maxSnapshotRecords: input.maxSnapshotRecords,
      maxFallbackScanRecords: input.maxFallbackScanRecords,
      maxPagesPerQuery: input.maxPagesPerQuery,
      pageSize: input.sourcePageSize,
    });
    const larkCalculation = calculateTikTokOrganicPeriodMetrics({
      contents: normalizeTikTokContentRecords(larkSource.contentRecords, {
        accountId,
        timeZone: setting.timeZone,
      }),
      dailySnapshots: normalizeTikTokDailySnapshotRecords(larkSource.dailyRecords, {
        accountId,
        timeZone: setting.timeZone,
      }),
      periodStart: period.periodStart,
      periodEnd: period.periodEnd,
    });
    parity = await compareTikTokOrganicReportResults({
      primary: storage.reportD1ReadEnabled ? d1Calculation : larkCalculation,
      shadow: storage.reportD1ReadEnabled ? larkCalculation : d1Calculation,
      floatTolerance: input.floatTolerance,
    });
    if (storage.reportD1ReadEnabled && !parity.ok) {
      throw permanentError('TikTok D1-primary report parity check failed', {
        code: 'REPORT_D1_PARITY_MISMATCH',
        details: {
          mismatchCount: parity.mismatchCount,
          primaryDigest: parity.primaryDigest,
          shadowDigest: parity.shadowDigest,
        },
      });
    }
  }

  const reportRepository = storage.reportD1ReadEnabled
    ? createTikTokReportSourceOverrideRepository({
      repository,
      tables,
      timeZone: setting.timeZone,
      contents: d1Source.contents,
      dailySnapshots: d1Source.dailySnapshots,
    })
    : repository;
  const result = await generateTikTokOrganicReport({
    ...input,
    repository: reportRepository,
    maxContentRecords: storage.reportD1ReadEnabled
      ? input.d1MaxContentRecords
      : input.maxContentRecords,
  });
  const warnings = parity && !parity.ok
    ? Object.freeze([Object.freeze({
      code: 'REPORT_D1_SHADOW_PARITY_MISMATCH',
      mismatchCount: parity.mismatchCount,
      primaryDigest: parity.primaryDigest,
      shadowDigest: parity.shadowDigest,
    })])
    : Object.freeze([]);
  let materialization = null;
  if (storage.reportPresetMaterializationEnabled) {
    materialization = await saveMaterialization({
      store: requireMaterializationStore(input.materializationStore),
      result,
      customerKey: input.customerKey,
      accountKey: accountId,
      sourceWatermark: d1Source.readSummary.sourceWatermark,
      generatedAt: typeof input.now === 'function' ? input.now() : Date.now(),
    });
  }
  return Object.freeze({
    ...result,
    source: storage.reportD1ReadEnabled ? 'd1_organic_observations' : result.source,
    sourceRead: storage.reportD1ReadEnabled ? d1Source.readSummary : result.sourceRead,
    d1SourceRead: d1Source.readSummary,
    reportParity: parity,
    warnings,
    materialization,
  });
}

async function saveMaterialization(input) {
  const periodKind = input.result.reportType === 'daily_organic_report'
    ? 'rolling_days'
    : 'weekly';
  const payload = Object.freeze({
    schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
    sourceReportId: input.result.reportId,
    reportType: input.result.reportType,
    period: input.result.period,
    dataStatus: input.result.dataStatus,
    baselineCoverageRate: input.result.baselineCoverageRate,
    metricPayload: input.result.metricPayload,
    topContentCount: input.result.topContentCount,
  });
  const payloadJson = JSON.stringify(payload);
  const payloadChecksum = await createStableFingerprint(payload);
  const windowDays = daysInclusive(
    input.result.period.periodStart,
    input.result.period.periodEnd,
  );
  const materializationId = createStorageReportId({
    report_setting_key: input.result.reportSettingKey,
    account_key: requireText(input.accountKey, 'accountKey'),
    period_kind: periodKind,
    period_start: input.result.period.periodStart,
    period_end: input.result.period.periodEnd,
    formula_version: FORMULA_VERSION,
  });
  const write = await input.store.saveReportMaterialization({
    report_id: materializationId,
    report_setting_key: input.result.reportSettingKey,
    customer_key: requireText(input.customerKey, 'customerKey'),
    platform_scope: 'tiktok',
    account_key: requireText(input.accountKey, 'accountKey'),
    report_type: input.result.reportType,
    period_kind: periodKind,
    window_days: windowDays,
    period_start: input.result.period.periodStart,
    period_end: input.result.period.periodEnd,
    compare_start: input.result.period.compareStart,
    compare_end: input.result.period.compareEnd,
    data_status: normalizeDataStatus(input.result.dataStatus),
    coverage_rate: input.result.baselineCoverageRate,
    formula_version: FORMULA_VERSION,
    source_watermark: input.sourceWatermark,
    payload_json: payloadJson,
    payload_checksum: payloadChecksum,
    generated_at: input.generatedAt,
    expires_at: null,
    created_at: input.generatedAt,
    updated_at: input.generatedAt,
  });
  return Object.freeze({
    ...write,
    reportId: materializationId,
    sourceReportId: input.result.reportId,
    payloadChecksum,
  });
}

function assertD1CoverageReady(summary, primary) {
  if (!primary) return;
  if (summary.coverageStatus !== 'complete' || Number(summary.failedRows ?? 0) !== 0) {
    throw permanentError('TikTok D1-primary report requires complete Coverage', {
      code: 'REPORT_D1_COVERAGE_INCOMPLETE',
      details: {
        coverageStatus: summary.coverageStatus,
        failedRows: summary.failedRows ?? 0,
        coverageRunId: summary.coverageRunId,
      },
    });
  }
}

function daysInclusive(start, end) {
  return Math.floor((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function normalizeDataStatus(value) {
  if (value === 'no_data') return 'no_data_confirmed';
  return value;
}

function requireStorageConfig(value) {
  if (!value || typeof value !== 'object') throw new TypeError('D1-aware report requires storageConfig');
  return value;
}

function requireRepository(value) {
  if (!value || typeof value !== 'object') throw new TypeError('D1-aware report requires repository');
  return value;
}

function requireD1Source(value) {
  if (typeof value?.load !== 'function') throw new TypeError('D1-aware report requires d1Source.load');
  return value;
}

function requireMaterializationStore(value) {
  if (typeof value?.saveReportMaterialization !== 'function') {
    throw new TypeError('D1-aware report requires materializationStore.saveReportMaterialization');
  }
  return value;
}

function requireTables(value) {
  return Object.freeze({
    ...value,
    mktContent: requireText(value?.mktContent, 'tables.mktContent'),
    mktContentDaily: requireText(value?.mktContentDaily, 'tables.mktContentDaily'),
    mktReportSettings: requireText(value?.mktReportSettings, 'tables.mktReportSettings'),
  });
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}
