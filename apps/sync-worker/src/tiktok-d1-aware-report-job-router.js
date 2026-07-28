import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import { JOB_TYPES, assertJobImplemented, getJobDefinition } from '../../../packages/application/src/jobs/job-catalog.js';
import {
  REPORT_PLATFORM_CAPABILITY,
  createReportPlatformAdapterRegistry,
  getReportPlatformContract,
} from '../../../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  DEFAULT_REPORT_MAX_CONTENT_RECORDS,
  DEFAULT_REPORT_MAX_FALLBACK_SCAN_RECORDS,
  DEFAULT_REPORT_MAX_PAGES_PER_QUERY,
  DEFAULT_REPORT_MAX_SNAPSHOT_RECORDS,
  DEFAULT_REPORT_SOURCE_PAGE_SIZE,
} from '../../../packages/application/src/reports/load-tiktok-organic-report-source.js';
import { generateDashboardReportMaterialization } from '../../../packages/application/src/use-cases/generate-dashboard-report-materialization.js';
import { generateReportAiSummary } from '../../../packages/application/src/use-cases/generate-report-ai-summary.js';
import { generateTikTokOrganicReportD1Aware } from '../../../packages/application/src/use-cases/generate-tiktok-organic-report-d1-aware.js';
import { writeDashboardMaterializationToLark } from '../../../packages/application/src/use-cases/write-dashboard-materialization-to-lark.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { readStorageRuntimeConfig } from '../../../packages/config/src/storage-runtime-config.js';
import { readTikTokPostLarkRuntimeConfig } from '../../../packages/config/src/tiktok-post-lark-runtime-config.js';
import { DASHBOARD_REPORT_TYPE } from '../../../packages/config/src/report-settings.seed.js';
import { D1AdsReportSource } from '../../../packages/connectors/src/d1-ads-report-source.js';
import { D1MarketingHistoryStore } from '../../../packages/connectors/src/d1-marketing-history-store.js';
import { D1OrganicReportSource } from '../../../packages/connectors/src/d1-organic-report-source.js';
import { D1ReportMaterializationReader } from '../../../packages/connectors/src/d1-report-materialization-reader.js';
import { D1ReportRequestStore } from '../../../packages/connectors/src/d1-report-request-store.js';
import { D1TikTokOrganicReportSource } from '../../../packages/connectors/src/tiktok/d1-tiktok-organic-report-source.js';
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

const LEGACY_REPORT_TYPES = new Set([JOB_TYPES.DAILY_REPORT_GENERATE, JOB_TYPES.WEEKLY_REPORT_GENERATE]);

export async function processJobWithTikTokD1AwareReport(input) {
  const type = input.job?.body?.type;
  if (type === JOB_TYPES.REPORT_MATERIALIZATION_GENERATE) return processDashboardReportJob(input);
  if (LEGACY_REPORT_TYPES.has(type)) return processLegacyTikTokReportJob(input);
  return processJobWithTikTokPostLark(input);
}

async function processDashboardReportJob(input) {
  const definition = assertJobImplemented(getJobDefinition(input.job.body.type));
  const body = input.job.body;
  const platformScope = requireJobText(body.platformScope, 'platformScope');
  const contract = getReportPlatformContract(platformScope);
  const requestId = optionalText(body.reportRequestId);
  const customRequest = body.trigger === 'dashboard_custom_range';
  const presetRequest = body.trigger === 'dashboard_preset';
  const validShape = (customRequest && body.periodKind === 'custom_range' && requestId)
    || (presetRequest && body.periodKind === 'rolling_days' && !requestId);
  const storageConfig = readStorageRuntimeConfig(input.env);
  if (definition.type !== JOB_TYPES.REPORT_MATERIALIZATION_GENERATE
    || !validShape
    || storageConfig.reportD1ReadEnabled !== true) {
    throw permanentError('Dashboard report requires a reviewed D1-primary job contract', {
      code: 'DASHBOARD_REPORT_CONFIGURATION_INVALID',
    });
  }

  const runtimeConfig = input.getRuntimeConfig();
  const infrastructure = input.getInfrastructure();
  const requiredTables = [
    'mktReportSnapshots', 'mktReportMetricValues',
    contract.capability === REPORT_PLATFORM_CAPABILITY.ORGANIC ? 'mktReportTopContent' : 'mktReportTopAds',
    'mktSyncLog', 'mktSystemAlerts',
  ];
  const tableIds = readLarkTableIdsFromEnv(input.env, requiredTables);
  const requestStore = requestId ? new D1ReportRequestStore({
    db: input.env?.MKT_STATE_DB,
    defaultPlatformScope: platformScope,
  }) : null;
  let accountKey = resolveReportAccountKey(runtimeConfig, platformScope);
  if (requestStore) {
    const existing = await requestStore.read(requestId);
    if (!existing) throw permanentError('Dashboard report request does not exist', {
      code: 'DASHBOARD_REPORT_REQUEST_NOT_FOUND', details: { requestId },
    });
    accountKey = assertDashboardRequestIdentity({ existing, body, runtimeConfig, platformScope });
    if (existing.status === 'completed') return Object.freeze({
      mode: 'already_completed', reportRequestId: requestId, reportId: existing.resultReportId, warnings: Object.freeze([]),
    });
    await requestStore.markProcessing({ requestId });
  }
  const reliability = infrastructure.getReliability(tableIds);

  try {
    const result = await runReliableSync({
      store: reliability.store,
      lockManager: reliability.lockManager,
      customerProfile: runtimeConfig.profileKey,
      accountKey,
      platform: platformScope,
      source: 'd1_historical_facts',
      syncType: DASHBOARD_REPORT_TYPE,
      retryCount: Math.max(0, readAttempts(input.message) - 1),
      leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
      renewIntervalMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_RENEW_INTERVAL_MS, DEFAULT_LOCK_RENEW_INTERVAL_MS),
      alertOnRetryableFailure: false,
      alertOnResultWarnings: true,
      onReliabilityError: reliabilityLogger,
      execute: async ({ assertLockActive }) => {
        const registry = createD1ReportRegistry(input.env?.MKT_STATE_DB);
        const generated = await generateDashboardReportMaterialization({
          registry,
          materializationStore: new D1MarketingHistoryStore({ db: input.env?.MKT_STATE_DB }),
          customerKey: runtimeConfig.customerKey,
          accountKey,
          platformScope,
          reportSettingKey: requireJobText(body.reportSettingKey, 'reportSettingKey'),
          periodKind: body.periodKind,
          windowDays: body.windowDays,
          periodStart: body.periodStart,
          periodEnd: body.periodEnd,
          comparisonMode: body.comparisonMode,
          timeZone: input.env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
          sourceWatermark: body.sourceWatermark,
          topContentLimit: body.topContentLimit,
          topAdsLimit: body.topAdsLimit,
          generatedAt: Date.parse(body.requestedAt),
          maxContentRecords: readPositiveInteger(input.env?.MKT_REPORT_D1_MAX_CONTENT_RECORDS, 10_000),
          maxFactRows: readPositiveInteger(input.env?.MKT_REPORT_D1_MAX_FACT_ROWS, 10_000),
        });
        const ai = await generateReportAiSummary({
          enabled: storageConfig.reportAiSummaryEnabled,
          provider: resolveInjectedAiProvider(input),
          materializationPayload: generated.materialization.payload,
          language: body.language ?? 'th',
        });
        await assertLockActive();
        const lark = await writeDashboardMaterializationToLark({
          reader: new D1ReportMaterializationReader({ db: input.env?.MKT_STATE_DB }),
          repository: infrastructure.repository,
          syncEngine: infrastructure.syncEngine,
          reportId: generated.reportId,
          customerProfile: runtimeConfig.profileKey,
          utcOffset: input.env?.DEFAULT_UTC_OFFSET ?? '+07:00',
          topContentLimit: body.topContentLimit,
          topAdsLimit: body.topAdsLimit,
          assertLockActive,
          tables: tableIds,
        });
        return Object.freeze({
          ...generated,
          lark,
          ai,
          aiBindingStatus: storageConfig.reportAiSummaryEnabled
            ? (ai.status === 'completed' ? 'available' : ai.status)
            : 'injectable_provider_not_configured_default_off',
        });
      },
    });
    if (requestStore) await requestStore.markCompleted({ requestId, reportId: requireJobText(result.reportId, 'result.reportId') });
    return Object.freeze({ ...result, reportRequestId: requestId });
  } catch (error) {
    if (requestStore) await requestStore.markFailed({
      requestId,
      retryable: error?.retryable === true,
      errorCode: error?.code ?? 'DASHBOARD_REPORT_FAILED',
    });
    throw error;
  }
}

async function processLegacyTikTokReportJob(input) {
  const definition = assertJobImplemented(getJobDefinition(input.job.body.type));
  const runtimeConfig = input.getRuntimeConfig();
  const connectorConfig = assertConnectorRunnable(runtimeConfig, 'tiktok');
  const infrastructure = input.getInfrastructure();
  const storageConfig = readStorageRuntimeConfig(input.env);
  const postLarkConfig = readTikTokPostLarkRuntimeConfig(input.env);
  const tableIds = readLarkTableIdsFromEnv(input.env, [
    'mktContent', 'mktContentDaily', 'mktMetricDefinitions', 'mktReportSettings',
    'mktReportSnapshots', 'mktReportMetricValues', 'mktReportTopContent',
    'mktSyncLog', 'mktSystemAlerts',
  ]);
  const reliability = infrastructure.getReliability(tableIds);
  const reportType = definition.type === JOB_TYPES.WEEKLY_REPORT_GENERATE
    ? 'weekly_organic_report'
    : 'daily_organic_report';
  const defaultSettingKey = definition.type === JOB_TYPES.WEEKLY_REPORT_GENERATE
    ? input.env?.MKT_WEEKLY_REPORT_SETTING_KEY
    : input.env?.MKT_DAILY_REPORT_SETTING_KEY;
  const reportSettingKey = requireJobText(input.job.body?.reportSettingKey ?? defaultSettingKey, 'reportSettingKey');
  const requestId = optionalText(input.job.body?.reportRequestId);
  const isPostProcessRequest = input.job.body?.trigger === 'post_tiktok_processing';
  if (isPostProcessRequest && (!postLarkConfig.postProcessReportEnabled || !requestId)) {
    throw permanentError('Post-processing report admission is disabled or incomplete', {
      code: 'TIKTOK_POST_PROCESS_REPORT_DISABLED',
    });
  }
  const requestStore = requestId ? new D1ReportRequestStore({
    db: input.env?.MKT_STATE_DB, defaultPlatformScope: 'tiktok',
  }) : null;
  if (requestStore) {
    const existing = await requestStore.read(requestId);
    if (!existing) throw permanentError('Post-processing report request does not exist', {
      code: 'TIKTOK_REPORT_REQUEST_NOT_FOUND',
    });
    if (existing.status === 'completed') return Object.freeze({
      mode: 'already_completed', reportRequestId: requestId, reportId: existing.resultReportId, warnings: Object.freeze([]),
    });
    await requestStore.markProcessing({ requestId });
  }
  try {
    const result = await runReliableSync({
      store: reliability.store,
      lockManager: reliability.lockManager,
      customerProfile: runtimeConfig.profileKey,
      accountKey: connectorConfig.accountKey,
      platform: 'tiktok',
      source: storageConfig.reportD1ReadEnabled ? 'd1_organic_observations' : 'mkt_content_daily',
      syncType: reportType,
      retryCount: Math.max(0, readAttempts(input.message) - 1),
      leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
      renewIntervalMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_RENEW_INTERVAL_MS, DEFAULT_LOCK_RENEW_INTERVAL_MS),
      alertOnRetryableFailure: false,
      alertOnResultWarnings: true,
      onReliabilityError: reliabilityLogger,
      execute: ({ assertLockActive }) => generateTikTokOrganicReportD1Aware({
        assertLockActive,
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        d1Source: new D1TikTokOrganicReportSource({ db: input.env?.MKT_STATE_DB }),
        materializationStore: new D1MarketingHistoryStore({ db: input.env?.MKT_STATE_DB }),
        storageConfig,
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
        maxContentRecords: readPositiveInteger(input.env?.MKT_REPORT_MAX_CONTENT_RECORDS, DEFAULT_REPORT_MAX_CONTENT_RECORDS),
        d1MaxContentRecords: postLarkConfig.d1ReportMaxContentRecords,
        shadowMaxContentRecords: postLarkConfig.d1ReportMaxContentRecords,
        floatTolerance: postLarkConfig.reportFloatTolerance,
        maxSnapshotRecords: readPositiveInteger(input.env?.MKT_REPORT_MAX_SNAPSHOT_RECORDS, DEFAULT_REPORT_MAX_SNAPSHOT_RECORDS),
        maxFallbackScanRecords: readPositiveInteger(input.env?.MKT_REPORT_MAX_FALLBACK_SCAN_RECORDS, DEFAULT_REPORT_MAX_FALLBACK_SCAN_RECORDS),
        maxPagesPerQuery: readPositiveInteger(input.env?.MKT_REPORT_MAX_PAGES_PER_QUERY, DEFAULT_REPORT_MAX_PAGES_PER_QUERY),
        sourcePageSize: readPositiveInteger(input.env?.MKT_REPORT_SOURCE_PAGE_SIZE, DEFAULT_REPORT_SOURCE_PAGE_SIZE),
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
    if (requestStore) await requestStore.markCompleted({ requestId, reportId: requireJobText(result.reportId, 'result.reportId') });
    return Object.freeze({ ...result, reportRequestId: requestId });
  } catch (error) {
    if (requestStore) await requestStore.markFailed({
      requestId, retryable: error?.retryable === true, errorCode: error?.code ?? 'TIKTOK_REPORT_FAILED',
    });
    throw error;
  }
}

function createD1ReportRegistry(db) {
  return createReportPlatformAdapterRegistry({
    adapters: {
      facebook: new D1OrganicReportSource({ db, platform: 'facebook' }),
      instagram: new D1OrganicReportSource({ db, platform: 'instagram' }),
      tiktok: new D1OrganicReportSource({ db, platform: 'tiktok' }),
      youtube: new D1OrganicReportSource({ db, platform: 'youtube' }),
      meta_ads: new D1AdsReportSource({ db, platform: 'meta_ads' }),
      google_ads: new D1AdsReportSource({ db, platform: 'google_ads' }),
      tiktok_ads: new D1AdsReportSource({ db, platform: 'tiktok_ads' }),
    },
  });
}
function assertDashboardRequestIdentity(input) {
  const mismatches = [
    ['customerKey', input.runtimeConfig.customerKey],
    ['platformScope', input.platformScope],
    ['periodStart', input.body.periodStart],
    ['periodEnd', input.body.periodEnd],
    ['comparisonMode', input.body.comparisonMode ?? 'previous_period'],
  ].filter(([field, expected]) => input.existing[field] !== expected);
  if (mismatches.length > 0) {
    throw permanentError('Dashboard report job does not match durable request identity', {
      code: 'DASHBOARD_REPORT_REQUEST_IDENTITY_CONFLICT',
      details: {
        requestId: input.existing.requestId,
        fields: mismatches.map(([field]) => field),
      },
    });
  }
  return requireJobText(input.existing.accountKey, 'request.accountKey');
}
function resolveReportAccountKey(runtimeConfig, platformScope) {
  const configured = runtimeConfig?.connectors?.[platformScope]?.accountKey;
  if (typeof configured === 'string' && configured.trim()) return configured.trim();
  if (platformScope === 'tiktok_ads') return requireJobText(runtimeConfig?.customerKey, 'runtime.customerKey');
  throw permanentError('Runtime profile does not contain report account identity', {
    code: 'MKT_RUNTIME_CONFIG_INVALID', details: { platformScope },
  });
}
function resolveInjectedAiProvider(input) {
  if (typeof input.getReportAiProvider === 'function') return input.getReportAiProvider();
  return input.reportAiProvider ?? null;
}
function reliabilityLogger(event) {
  logQueueResult({ ok: false, scope: 'reliability', ...sanitizeReliabilityEvent(event) });
}
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
