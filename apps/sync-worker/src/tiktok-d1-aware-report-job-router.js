import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  JOB_TYPES,
  assertJobImplemented,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import {
  DEFAULT_REPORT_MAX_CONTENT_RECORDS,
  DEFAULT_REPORT_MAX_FALLBACK_SCAN_RECORDS,
  DEFAULT_REPORT_MAX_PAGES_PER_QUERY,
  DEFAULT_REPORT_MAX_SNAPSHOT_RECORDS,
  DEFAULT_REPORT_SOURCE_PAGE_SIZE,
} from '../../../packages/application/src/reports/load-tiktok-organic-report-source.js';
import { generateTikTokOrganicReportD1Aware } from '../../../packages/application/src/use-cases/generate-tiktok-organic-report-d1-aware.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { readStorageRuntimeConfig } from '../../../packages/config/src/storage-runtime-config.js';
import { readTikTokPostLarkRuntimeConfig } from '../../../packages/config/src/tiktok-post-lark-runtime-config.js';
import { D1MarketingHistoryStore } from '../../../packages/connectors/src/d1-marketing-history-store.js';
import { D1TikTokOrganicReportSource } from '../../../packages/connectors/src/tiktok/d1-tiktok-organic-report-source.js';
import { D1ReportRequestStore } from '../../../packages/connectors/src/d1-report-request-store.js';
import { runReliableSync } from '../../../packages/reliability/src/reliable-sync-runner.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { processJobWithTikTokPostLark } from './tiktok-post-lark-job-router.js';
import {
  DEFAULT_LOCK_LEASE_MS,
  DEFAULT_LOCK_RENEW_INTERVAL_MS,
  logQueueResult,
  readAttempts,
  readPositiveInteger,
  requireJobText,
  sanitizeReliabilityEvent,
} from './worker-runtime-support.js';

const REPORT_TYPES = new Set([
  JOB_TYPES.DAILY_REPORT_GENERATE,
  JOB_TYPES.WEEKLY_REPORT_GENERATE,
  JOB_TYPES.REPORT_MATERIALIZATION_GENERATE,
]);

export async function processJobWithTikTokD1AwareReport(input) {
  if (!REPORT_TYPES.has(input.job?.body?.type)) {
    return processJobWithTikTokPostLark(input);
  }
  return processReportJob(input);
}

async function processReportJob(input) {
  const definition = assertJobImplemented(getJobDefinition(input.job.body.type));
  const platformScope = definition.type === JOB_TYPES.REPORT_MATERIALIZATION_GENERATE
    ? requireJobText(input.job.body?.platformScope, 'platformScope')
    : 'tiktok';
  if (platformScope !== 'tiktok') {
    throw permanentError('Dashboard report platform adapter is not implemented', {
      code: 'DASHBOARD_REPORT_PLATFORM_NOT_IMPLEMENTED',
      details: { platformScope },
    });
  }
  const runtimeConfig = input.getRuntimeConfig();
  const connectorConfig = assertConnectorRunnable(runtimeConfig, platformScope);
  const infrastructure = input.getInfrastructure();
  const storageConfig = readStorageRuntimeConfig(input.env);
  const postLarkConfig = readTikTokPostLarkRuntimeConfig(input.env);
  const tableIds = readLarkTableIdsFromEnv(input.env, [
    'mktContent',
    'mktContentDaily',
    'mktMetricDefinitions',
    'mktReportSettings',
    'mktReportSnapshots',
    'mktReportMetricValues',
    'mktReportTopContent',
    'mktSyncLog',
    'mktSystemAlerts',
  ]);
  const reliability = infrastructure.getReliability(tableIds);
  const reportType = definition.type === JOB_TYPES.WEEKLY_REPORT_GENERATE
    ? 'weekly_organic_report'
    : 'daily_organic_report';
  const defaultSettingKey = definition.type === JOB_TYPES.WEEKLY_REPORT_GENERATE
    ? input.env?.MKT_WEEKLY_REPORT_SETTING_KEY
    : input.env?.MKT_DAILY_REPORT_SETTING_KEY;
  const reportSettingKey = requireJobText(
    input.job.body?.reportSettingKey ?? defaultSettingKey,
    'reportSettingKey',
  );
  const requestId = optionalText(input.job.body?.reportRequestId);
  const requestStore = requestId
    ? new D1ReportRequestStore({
      db: input.env?.MKT_STATE_DB,
      defaultPlatformScope: platformScope,
    })
    : null;
  const requestTrigger = input.job.body?.trigger;
  const isPostProcessRequest = requestTrigger === 'post_tiktok_processing';
  const isDashboardJob = definition.type === JOB_TYPES.REPORT_MATERIALIZATION_GENERATE;
  const isDashboardCustomRequest = requestTrigger === 'dashboard_custom_range';
  const isDashboardPreset = requestTrigger === 'dashboard_preset';
  if (isDashboardJob) {
    const validShape = (isDashboardCustomRequest
      && input.job.body?.periodKind === 'custom_range'
      && requestId)
      || (isDashboardPreset
        && input.job.body?.periodKind === 'rolling_days'
        && !requestId);
    if (!validShape || storageConfig.reportD1ReadEnabled !== true) {
      throw permanentError('Dashboard report requires a reviewed D1-primary job contract', {
        code: 'DASHBOARD_REPORT_CONFIGURATION_INVALID',
      });
    }
  }
  if (isPostProcessRequest || isDashboardCustomRequest) {
    if ((isPostProcessRequest && !postLarkConfig.postProcessReportEnabled) || !requestId) {
      throw permanentError('Post-processing report admission is disabled or incomplete', {
        code: 'TIKTOK_POST_PROCESS_REPORT_DISABLED',
      });
    }
    const existing = await requestStore.read(requestId);
    if (!existing) {
      throw permanentError('Post-processing report request does not exist', {
        code: 'TIKTOK_REPORT_REQUEST_NOT_FOUND',
      });
    }
    if (existing.status === 'completed') {
      return Object.freeze({
        mode: 'already_completed',
        reportRequestId: requestId,
        reportId: existing.resultReportId,
        warnings: Object.freeze([]),
      });
    }
    await requestStore.markProcessing({ requestId });
  }

  try {
    const result = await runReliableSync({
      store: reliability.store,
      lockManager: reliability.lockManager,
      customerProfile: runtimeConfig.profileKey,
      accountKey: connectorConfig.accountKey,
      platform: platformScope,
      source: storageConfig.reportD1ReadEnabled
        ? 'd1_organic_observations'
        : 'mkt_content_daily',
      syncType: reportType,
      retryCount: Math.max(0, readAttempts(input.message) - 1),
      leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
      renewIntervalMs: readPositiveInteger(
        input.env?.MKT_SYNC_LOCK_RENEW_INTERVAL_MS,
        DEFAULT_LOCK_RENEW_INTERVAL_MS,
      ),
      alertOnRetryableFailure: false,
      alertOnResultWarnings: true,
      onReliabilityError: reliabilityLogger,
      execute: ({ assertLockActive }) => generateTikTokOrganicReportD1Aware({
        assertLockActive,
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        d1Source: new D1TikTokOrganicReportSource({ db: input.env?.MKT_STATE_DB }),
        materializationStore: new D1MarketingHistoryStore({ db: input.env?.MKT_STATE_DB }),
        storageConfig: isDashboardJob
          ? { ...storageConfig, reportPresetMaterializationEnabled: true }
          : storageConfig,
        customerKey: runtimeConfig.customerKey,
        customerProfile: runtimeConfig.profileKey,
        accountId: connectorConfig.accountKey,
        reportType,
        reportSettingKey,
        periodKind: input.job.body?.periodKind,
        windowDays: input.job.body?.windowDays,
        periodStart: input.job.body?.periodStart,
        periodEnd: input.job.body?.periodEnd,
        comparisonMode: input.job.body?.comparisonMode,
        topContentLimit: input.job.body?.topContentLimit,
        maxContentRecords: readPositiveInteger(
          input.env?.MKT_REPORT_MAX_CONTENT_RECORDS,
          DEFAULT_REPORT_MAX_CONTENT_RECORDS,
        ),
        d1MaxContentRecords: postLarkConfig.d1ReportMaxContentRecords,
        shadowMaxContentRecords: postLarkConfig.d1ReportMaxContentRecords,
        floatTolerance: postLarkConfig.reportFloatTolerance,
        maxSnapshotRecords: readPositiveInteger(
          input.env?.MKT_REPORT_MAX_SNAPSHOT_RECORDS,
          DEFAULT_REPORT_MAX_SNAPSHOT_RECORDS,
        ),
        maxFallbackScanRecords: readPositiveInteger(
          input.env?.MKT_REPORT_MAX_FALLBACK_SCAN_RECORDS,
          DEFAULT_REPORT_MAX_FALLBACK_SCAN_RECORDS,
        ),
        maxPagesPerQuery: readPositiveInteger(
          input.env?.MKT_REPORT_MAX_PAGES_PER_QUERY,
          DEFAULT_REPORT_MAX_PAGES_PER_QUERY,
        ),
        sourcePageSize: readPositiveInteger(
          input.env?.MKT_REPORT_SOURCE_PAGE_SIZE,
          DEFAULT_REPORT_SOURCE_PAGE_SIZE,
        ),
        tables: {
          mktContent: tableIds.mktContent,
          mktContentDaily: tableIds.mktContentDaily,
          mktMetricDefinitions: tableIds.mktMetricDefinitions,
          mktReportSettings: tableIds.mktReportSettings,
          mktReportSnapshots: tableIds.mktReportSnapshots,
          mktReportMetricValues: tableIds.mktReportMetricValues,
          mktReportTopContent: tableIds.mktReportTopContent,
        },
      }),
    });
    if (requestStore) {
      await requestStore.markCompleted({
        requestId,
        reportId: requireJobText(result.reportId, 'result.reportId'),
      });
    }
    return Object.freeze({ ...result, reportRequestId: requestId });
  } catch (error) {
    if (requestStore) {
      await requestStore.markFailed({
        requestId,
        retryable: error?.retryable === true,
        errorCode: error?.code ?? 'TIKTOK_REPORT_FAILED',
      });
    }
    throw error;
  }
}

function reliabilityLogger(event) {
  logQueueResult({
    ok: false,
    scope: 'reliability',
    ...sanitizeReliabilityEvent(event),
  });
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
