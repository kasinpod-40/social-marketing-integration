import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  JOB_TYPES,
  assertJobImplemented,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { createTikTokOrganicHistoryHooks } from '../../../packages/application/src/storage/tiktok-organic-history-hooks.js';
import { bootstrapTikTokOrganicHistory } from '../../../packages/application/src/use-cases/bootstrap-tiktok-organic-history.js';
import { syncTikTokCreatorNativeToLark } from '../../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { readStorageRuntimeConfig } from '../../../packages/config/src/storage-runtime-config.js';
import { runReliableSync } from '../../../packages/reliability/src/reliable-sync-runner.js';
import { createStableFingerprint } from '../../../packages/shared/src/hash/stable-fingerprint.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { processJob as processActiveJob } from './active-job-router.js';
import {
  DEFAULT_LOCK_LEASE_MS,
  DEFAULT_LOCK_RENEW_INTERVAL_MS,
  DEFAULT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS,
  DEFAULT_TIKTOK_SOURCE_MAX_PAGES,
  DEFAULT_TIKTOK_SOURCE_PAGE_SIZE,
  logQueueResult,
  readAttempts,
  readBoolean,
  readMetricDate,
  readPositiveInteger,
  readSyncJobGeneration,
  requireJobText,
  sanitizeReliabilityEvent,
} from './worker-runtime-support.js';

/** แยก Manual bootstrap และ Flagged D1-first TikTok route ออกจาก Active router เดิม */
export async function processJobWithHistoryBootstrap(input) {
  const type = input.job?.body?.type;
  if (type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP) {
    return processBootstrapJob(input);
  }
  if (type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC) {
    const storage = readStorageRuntimeConfig(input.env);
    if (storage.timeSeriesD1WriteEnabled) {
      return processD1FirstTikTokSync(input);
    }
  }
  return processActiveJob(input);
}

async function processBootstrapJob(input) {
  const definition = assertJobImplemented(getJobDefinition(input.job.body.type));
  if (definition.manualOnly !== true || input.job.body?.trigger !== 'manual') {
    throw permanentError('TikTok history bootstrap accepts manual Queue jobs only', {
      code: 'TIKTOK_HISTORY_BOOTSTRAP_MANUAL_ONLY',
    });
  }

  const runtimeConfig = input.getRuntimeConfig();
  assertIntegrationWorkspace(runtimeConfig);
  const connectorConfig = assertConnectorRunnable(runtimeConfig, definition.connectorKey);
  const storage = readStorageRuntimeConfig(input.env);
  if (!storage.timeSeriesD1WriteEnabled || !storage.timeSeriesD1BackfillEnabled) {
    throw permanentError('TikTok history bootstrap Storage flags are disabled', {
      code: 'TIKTOK_HISTORY_BOOTSTRAP_DISABLED',
      details: {
        writeEnabled: storage.timeSeriesD1WriteEnabled,
        backfillEnabled: storage.timeSeriesD1BackfillEnabled,
      },
    });
  }

  const infrastructure = input.getInfrastructure();
  const tableIds = readLarkTableIdsFromEnv(input.env, [
    'rawTikTokCreatorVideos',
    'mktSyncLog',
    'mktSystemAlerts',
  ]);
  const reliability = infrastructure.getReliability(tableIds);
  const resumableWorkStore = infrastructure.getResumableWorkStore();
  const requestedAt = readSyncJobGeneration(input.job, 'TikTok history', input.message?.timestamp);

  const result = await runReliableSync({
    store: reliability.store,
    lockManager: reliability.lockManager,
    customerProfile: runtimeConfig.profileKey,
    accountKey: connectorConfig.accountKey,
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    syncType: 'organic_history_bootstrap',
    retryCount: Math.max(0, readAttempts(input.message) - 1),
    leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
    renewIntervalMs: readPositiveInteger(
      input.env?.MKT_SYNC_LOCK_RENEW_INTERVAL_MS,
      DEFAULT_LOCK_RENEW_INTERVAL_MS,
    ),
    alertOnRetryableFailure: false,
    alertOnResultWarnings: true,
    warningOutboxStore: resumableWorkStore,
    onReliabilityError: reliabilityLogger,
    execute: async ({ syncRunId, lockKey, assertLockActive }) => {
      const gateway = infrastructure.getOrganicHistoryGateway();
      await gateway.assertSchemaReady();
      const bootstrapResult = await bootstrapTikTokOrganicHistory({
        syncRunId,
        assertLockActive,
        repository: infrastructure.repository,
        gateway,
        resumableWorkStore,
        customerProfile: runtimeConfig.profileKey,
        customerKey: requireJobText(runtimeConfig.customerKey, 'runtimeConfig.customerKey'),
        accountKey: connectorConfig.accountKey,
        sourceHandle: connectorConfig.sourceHandle,
        sourceTimezone: input.env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
        requestedAt,
        cursorKey: lockKey,
        workKey: `tiktok:${requireJobText(input.message?.id, 'message.id')}`,
        rawTableId: tableIds.rawTikTokCreatorVideos,
        sourcePageSize: readPositiveInteger(
          input.env?.MKT_TIKTOK_SOURCE_PAGE_SIZE,
          DEFAULT_TIKTOK_SOURCE_PAGE_SIZE,
        ),
        sourceMaxPages: readPositiveInteger(
          input.env?.MKT_TIKTOK_SOURCE_MAX_PAGES ?? input.env?.LARK_MAX_PAGES,
          DEFAULT_TIKTOK_SOURCE_MAX_PAGES,
        ),
        dryRun: input.job.body?.dryRun === true,
        onProgress: (event) => logQueueResult({
          ok: true,
          scope: 'tiktok_history_bootstrap',
          syncRunId,
          ...event,
        }),
      });
      return enrichBootstrapOperationalResult(bootstrapResult);
    },
  });

  await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
  return result;
}

async function processD1FirstTikTokSync(input) {
  const definition = assertJobImplemented(getJobDefinition(input.job.body.type));
  const runtimeConfig = input.getRuntimeConfig();
  assertIntegrationWorkspace(runtimeConfig);
  const connectorConfig = assertConnectorRunnable(runtimeConfig, definition.connectorKey);
  const infrastructure = input.getInfrastructure();
  const tableIds = readLarkTableIdsFromEnv(input.env, [
    'rawTikTokCreatorVideos',
    'mktContent',
    'mktContentDaily',
    'mktClassificationDictionary',
    'mktSyncLog',
    'mktSystemAlerts',
  ]);
  const reliability = infrastructure.getReliability(tableIds);
  const resumableWorkStore = infrastructure.getResumableWorkStore();
  const requestedAt = readSyncJobGeneration(input.job, 'TikTok', input.message?.timestamp);
  const incrementalEnabled = readBoolean(input.env?.MKT_TIKTOK_INCREMENTAL_ENABLED, false);
  const metricDate = readMetricDate(input.job.body?.metricDate, input.env);
  const workKey = `tiktok:${requireJobText(input.message?.id, 'message.id')}`;
  const sourceWatermark = await createStableFingerprint({
    contract: 'tiktok-d1-first-source-v1',
    workKey,
    generation: requestedAt,
    accountKey: connectorConfig.accountKey,
    sourceHandle: connectorConfig.sourceHandle,
    metricDate,
  });
  const coverageDigest = await createStableFingerprint({
    contract: 'tiktok-d1-first-coverage-v1',
    workKey,
    generation: requestedAt,
    datasetKey: 'organic_content_cumulative',
  });
  const coverageRunId = `coverage:tiktok:${coverageDigest}`;

  const result = await runReliableSync({
    store: reliability.store,
    lockManager: reliability.lockManager,
    customerProfile: runtimeConfig.profileKey,
    accountKey: connectorConfig.accountKey,
    platform: 'tiktok',
    source: 'lark_native_tiktok_for_creator',
    syncType: 'native_import',
    retryCount: Math.max(0, readAttempts(input.message) - 1),
    leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
    renewIntervalMs: readPositiveInteger(
      input.env?.MKT_SYNC_LOCK_RENEW_INTERVAL_MS,
      DEFAULT_LOCK_RENEW_INTERVAL_MS,
    ),
    alertOnRetryableFailure: false,
    onReliabilityError: reliabilityLogger,
    execute: async ({ syncRunId, lockKey, assertLockActive }) => {
      const gateway = infrastructure.getOrganicHistoryGateway();
      await gateway.assertSchemaReady();
      const historyHooks = createTikTokOrganicHistoryHooks({
        gateway,
        customerProfile: runtimeConfig.profileKey,
        customerKey: requireJobText(runtimeConfig.customerKey, 'runtimeConfig.customerKey'),
        platform: 'tiktok',
        accountKey: connectorConfig.accountKey,
        sourceAccountId: null,
        sourceTimezone: input.env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
        observedAt: requestedAt,
        fetchedAt: requestedAt,
        historySyncRunId: `history:tiktok:${coverageDigest}`,
        coverageRunId,
        sourceRevision: sourceWatermark,
        sourceWatermark,
        scopeMode: incrementalEnabled ? 'exact_entities' : 'full_inventory',
        datasetKey: 'organic_content_cumulative',
      });
      const syncResult = await syncTikTokCreatorNativeToLark({
        syncRunId,
        assertLockActive,
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        accountId: connectorConfig.accountKey,
        sourceHandle: connectorConfig.sourceHandle,
        metricDate,
        customerProfile: runtimeConfig.profileKey,
        cursorKey: lockKey,
        workKey,
        requestedAt,
        generation: requestedAt,
        resumableWorkStore,
        sourcePageSize: readPositiveInteger(
          input.env?.MKT_TIKTOK_SOURCE_PAGE_SIZE,
          DEFAULT_TIKTOK_SOURCE_PAGE_SIZE,
        ),
        sourceMaxPages: readPositiveInteger(
          input.env?.MKT_TIKTOK_SOURCE_MAX_PAGES ?? input.env?.LARK_MAX_PAGES,
          DEFAULT_TIKTOK_SOURCE_MAX_PAGES,
        ),
        syncMode: input.job.body?.syncMode,
        incrementalEnabled,
        incrementalStateStore: incrementalEnabled
          ? infrastructure.getIncrementalStateStore()
          : null,
        fullSyncIntervalMs: readPositiveInteger(
          input.env?.MKT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS,
          DEFAULT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS,
        ),
        historyHooks,
        tables: {
          rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
          mktContent: tableIds.mktContent,
          mktContentDaily: tableIds.mktContentDaily,
          mktClassificationDictionary: tableIds.mktClassificationDictionary,
        },
      });
      return enrichD1FirstOperationalResult(syncResult, {
        coverageRunId,
        sourceWatermark,
      });
    },
  });
  await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
  return result;
}

/** ทำให้ Coverage proof อยู่ใน Sync Log details โดยไม่แปลงเป็น Lark write counters */
function enrichBootstrapOperationalResult(result) {
  const d1 = isObject(result?.d1) ? result.d1 : {};
  const baseReconciliation = isObject(result?.reconciliation) ? result.reconciliation : {};
  const coverageStatus = d1.coverageStatus ?? baseReconciliation.status ?? 'not_observed';
  const warnings = coverageStatus === 'complete'
    ? Object.freeze([])
    : Object.freeze([Object.freeze({
      code: 'TIKTOK_HISTORY_COVERAGE_INCOMPLETE',
      coverageStatus,
      coverageRunId: d1.coverageRunId ?? null,
      expectedRows: baseReconciliation.expectedRows ?? 0,
      observedRows: baseReconciliation.observedRows ?? 0,
      skippedRows: baseReconciliation.skippedRows ?? 0,
      duplicateRows: baseReconciliation.duplicateRows ?? 0,
    })]);

  return Object.freeze({
    ...result,
    dryRun: result?.mode === 'dry_run',
    sourceSummary: result?.sourcePagination ?? null,
    warnings,
    reconciliation: Object.freeze({
      ...baseReconciliation,
      coverageStatus,
      coverageRunId: d1.coverageRunId ?? null,
      sourceWatermark: d1.sourceWatermark ?? null,
      plannedStateRows: d1.plannedStateRows ?? 0,
      plannedObservationRows: d1.plannedObservationRows ?? 0,
      contentRowsDurable: d1.contentRowsDurable ?? 0,
      observationRowsDurable: d1.observationRowsDurable ?? 0,
      stateWritten: d1.stateWritten ?? 0,
      stateSkipped: d1.stateSkipped ?? 0,
      observationsCreated: d1.observationsCreated ?? 0,
      observationsSkipped: d1.observationsSkipped ?? 0,
      observationsNotRequired: d1.observationsNotRequired ?? 0,
      coverageEntitiesWritten: d1.coverageEntitiesWritten ?? 0,
      coverageEntitiesSkipped: d1.coverageEntitiesSkipped ?? 0,
    }),
  });
}

function enrichD1FirstOperationalResult(result, input) {
  const d1History = isObject(result?.d1History) ? result.d1History : {};
  const baseReconciliation = isObject(result?.reconciliation) ? result.reconciliation : {};
  return Object.freeze({
    ...result,
    reconciliation: Object.freeze({
      ...baseReconciliation,
      coverageRunId: input.coverageRunId,
      sourceWatermark: input.sourceWatermark,
      d1History: Object.freeze({ ...d1History }),
    }),
  });
}

function assertIntegrationWorkspace(runtimeConfig) {
  if (runtimeConfig.environment !== 'development'
    || runtimeConfig.profileKey !== 'integration_workspace') {
    throw permanentError('TikTok history storage is restricted to the Integration Workspace', {
      code: 'TIKTOK_HISTORY_BOOTSTRAP_ENVIRONMENT_BLOCKED',
    });
  }
}

function reliabilityLogger(event) {
  logQueueResult({
    ok: false,
    scope: 'reliability',
    ...sanitizeReliabilityEvent(event),
  });
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
