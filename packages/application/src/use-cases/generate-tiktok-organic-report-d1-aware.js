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
import { hydrateTikTokReportContentMetadata } from '../reports/hydrate-tiktok-report-content-metadata.js';
import { saveDashboardReportMaterialization } from '../reports/report-materialization.js';
import { generateTikTokOrganicReport } from './generate-tiktok-organic-report.js';
import { createStableFingerprint } from '../../../shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../shared/src/errors/runtime-error.js';

const FORMULA_VERSION = 'tiktok-organic-v1';
const MATERIALIZATION_SCHEMA_VERSION = 'tiktok-organic-materialization-v1';
const MAX_METADATA_RECORDS = 100;

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
    periodKind: input.periodKind,
    windowDays: input.windowDays,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    maxCustomRangeDays: input.maxCustomRangeDays,
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
  const d1Calculations = calculateReportWindows({
    contents: d1Source.contents,
    dailySnapshots: d1Source.dailySnapshots,
    period,
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
    const larkCalculations = calculateReportWindows({
      contents: normalizeTikTokContentRecords(larkSource.contentRecords, {
        accountId,
        timeZone: setting.timeZone,
      }),
      dailySnapshots: normalizeTikTokDailySnapshotRecords(larkSource.dailyRecords, {
        accountId,
        timeZone: setting.timeZone,
      }),
      period,
    });
    parity = await compareReportWindows({
      primary: storage.reportD1ReadEnabled ? d1Calculations : larkCalculations,
      shadow: storage.reportD1ReadEnabled ? larkCalculations : d1Calculations,
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

  let d1Contents = d1Source.contents;
  if (storage.reportD1ReadEnabled) {
    const metadataLimit = resolveMetadataLimit(input.topContentLimit, setting.topContentLimit);
    const metadataIds = d1Calculations.current.contentRows
      .slice(0, metadataLimit)
      .map((row) => row.content.externalContentId);
    d1Contents = await hydrateTikTokReportContentMetadata({
      repository,
      tableId: tables.mktContent,
      contents: d1Contents,
      externalContentIds: metadataIds,
    });
  }

  const reportRepository = storage.reportD1ReadEnabled
    ? createTikTokReportSourceOverrideRepository({
      repository,
      tables,
      timeZone: setting.timeZone,
      contents: d1Contents,
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
    materialization = await saveDashboardReportMaterialization({
      store: requireMaterializationStore(input.materializationStore),
      result,
      customerKey: input.customerKey,
      accountKey: accountId,
      platformScope: 'tiktok',
      formulaVersion: FORMULA_VERSION,
      schemaVersion: MATERIALIZATION_SCHEMA_VERSION,
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

function calculateReportWindows(input) {
  const current = calculateTikTokOrganicPeriodMetrics({
    contents: input.contents,
    dailySnapshots: input.dailySnapshots,
    periodStart: input.period.periodStart,
    periodEnd: input.period.periodEnd,
  });
  const compare = input.period.comparisonMode === 'none'
    ? null
    : calculateTikTokOrganicPeriodMetrics({
      contents: input.contents,
      dailySnapshots: input.dailySnapshots,
      periodStart: input.period.compareStart,
      periodEnd: input.period.compareEnd,
    });
  return Object.freeze({ current, compare });
}

async function compareReportWindows(input) {
  const current = await compareTikTokOrganicReportResults({
    primary: input.primary.current,
    shadow: input.shadow.current,
    floatTolerance: input.floatTolerance,
  });
  const compare = input.primary.compare && input.shadow.compare
    ? await compareTikTokOrganicReportResults({
      primary: input.primary.compare,
      shadow: input.shadow.compare,
      floatTolerance: input.floatTolerance,
    })
    : null;
  const mismatches = [
    ...prefixMismatches(current.mismatches, 'current'),
    ...prefixMismatches(compare?.mismatches ?? [], 'compare'),
  ];
  return Object.freeze({
    ok: current.ok && (compare?.ok ?? true),
    mismatchCount: current.mismatchCount + (compare?.mismatchCount ?? 0),
    mismatches: Object.freeze(mismatches),
    truncated: current.truncated || (compare?.truncated ?? false),
    floatTolerance: current.floatTolerance,
    primaryDigest: await createStableFingerprint({
      current: current.primaryDigest,
      compare: compare?.primaryDigest ?? null,
    }),
    shadowDigest: await createStableFingerprint({
      current: current.shadowDigest,
      compare: compare?.shadowDigest ?? null,
    }),
    current,
    compare,
  });
}

function prefixMismatches(values, windowName) {
  return values.map((value) => Object.freeze({
    ...value,
    path: `$.${windowName}${String(value.path ?? '$').slice(1)}`,
  }));
}

function resolveMetadataLimit(override, configured) {
  const value = override === null || override === undefined || override === ''
    ? configured
    : override;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > MAX_METADATA_RECORDS) {
    throw new TypeError(`topContentLimit must be an integer between 1 and ${MAX_METADATA_RECORDS}`);
  }
  return number;
}

function assertD1CoverageReady(summary, primary) {
  if (!primary) return;
  const failedRows = Number(summary.failedRows ?? 0);
  const uncoveredContentCount = Number(summary.uncoveredContentCount ?? 0);
  if (summary.coverageStatus !== 'complete'
    || failedRows !== 0
    || uncoveredContentCount !== 0) {
    throw permanentError('TikTok D1-primary report requires complete Coverage', {
      code: 'REPORT_D1_COVERAGE_INCOMPLETE',
      details: {
        coverageStatus: summary.coverageStatus,
        failedRows,
        uncoveredContentCount,
        uncoveredContentIds: summary.uncoveredContentIds ?? [],
        coverageRunId: summary.coverageRunId,
      },
    });
  }
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
