import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  JOB_TRIGGERS,
  JOB_TYPES,
  assertJobImplemented,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { syncYouTubeOrganicEndToEnd } from '../../../packages/application/src/use-cases/sync-youtube-organic-end-to-end.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import {
  readYouTubeChannelIdFromEnv,
  readYouTubeEndToEndRuntimeConfig,
  readYouTubeLarkTableIdsFromEnv,
} from '../../../packages/config/src/youtube-organic-runtime-config.js';
import { readStorageRuntimeConfig } from '../../../packages/config/src/storage-runtime-config.js';
import {
  drainPendingSyncWarnings,
  runReliableSync,
} from '../../../packages/reliability/src/reliable-sync-runner.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { resolveYouTubeAnalyticsEnabled } from './scheduled-jobs.js';
import { createYouTubeRuntimeClients } from './youtube-runtime-clients.js';
import {
  DEFAULT_LOCK_LEASE_MS,
  DEFAULT_LOCK_RENEW_INTERVAL_MS,
  DEFAULT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS,
  logQueueResult,
  readAttempts,
  readBoolean,
  readMetricDate,
  readPositiveInteger,
  readSyncJobGeneration,
  requireJobText,
  sanitizeReliabilityEvent,
} from './worker-runtime-support.js';
import { enqueueYouTubeSyncContinuation } from './youtube-sync-continuation.js';

/** Dedicated YouTube route for the Integration Workspace shared Worker. */
export async function processYouTubeOrganicEndToEndJob(input) {
  if (input.job?.body?.type !== JOB_TYPES.YOUTUBE_ORGANIC_SYNC) {
    throw permanentError('Dedicated YouTube router received an unsupported job type', {
      code: 'YOUTUBE_END_TO_END_JOB_TYPE_INVALID',
    });
  }

  const definition = assertJobImplemented(getJobDefinition(input.job.body.type));
  const youtubeConfig = readYouTubeEndToEndRuntimeConfig(input.env);
  const storage = readStorageRuntimeConfig(input.env);
  const d1WriteEnabled = storage.timeSeriesD1WriteEnabled;
  const larkWriteEnabled = youtubeConfig.larkWriteEnabled;
  const dryRun = input.job.body?.dryRun === true;
  const operatorDryRun = input.job.body?.trigger === JOB_TRIGGERS.YOUTUBE_WORKER_DRY_RUN;
  const operatorLarkUat = input.job.body?.trigger === JOB_TRIGGERS.YOUTUBE_LARK_FULL_SYNC_UAT;

  if (!youtubeConfig.endToEndEnabled) {
    throw permanentError('YouTube end-to-end route is disabled for this environment', {
      code: 'YOUTUBE_END_TO_END_DISABLED',
    });
  }

  const operatorIdentity = operatorDryRun
    ? assertYouTubeWorkerDryRunOperation({
      body: input.job.body,
      operation: input.operation,
      env: input.env,
      d1WriteEnabled,
      larkWriteEnabled,
    })
    : operatorLarkUat
      ? assertYouTubeLarkFullSyncUatOperation({
        body: input.job.body,
        operation: input.operation,
        env: input.env,
        d1WriteEnabled,
        larkWriteEnabled,
      })
      : null;

  if (!dryRun && !d1WriteEnabled) {
    throw permanentError('YouTube end-to-end D1 writing is disabled', {
      code: 'YOUTUBE_END_TO_END_D1_WRITE_DISABLED',
    });
  }
  if (!dryRun && !larkWriteEnabled) {
    throw permanentError('YouTube end-to-end Lark delivery is disabled', {
      code: 'YOUTUBE_END_TO_END_LARK_WRITE_DISABLED',
    });
  }

  const runtimeConfig = input.getRuntimeConfig();
  const connectorConfig = assertConnectorRunnable(runtimeConfig, definition.connectorKey);
  if (operatorDryRun || operatorLarkUat) {
    assertYouTubeOperatorRuntime(runtimeConfig, connectorConfig, {
      code: operatorDryRun ? 'YOUTUBE_DRY_RUN_RUNTIME_INVALID' : 'YOUTUBE_LARK_UAT_RUNTIME_INVALID',
      label: operatorDryRun ? 'Worker dry-run' : 'Lark full-sync UAT',
    });
  }

  const infrastructure = input.getInfrastructure();
  const youtubeTableIds = readYouTubeLarkTableIdsFromEnv(input.env);
  const operationalTableIds = readLarkTableIdsFromEnv(input.env, [
    'mktSyncLog',
    'mktSystemAlerts',
  ]);
  const tableIds = Object.freeze({ ...youtubeTableIds, ...operationalTableIds });
  const reliability = infrastructure.getReliability(tableIds);
  const resumableWorkStore = infrastructure.getResumableWorkStore();
  const dependencies = input.dependencies ?? {};
  const publicApiKeyOnly = operatorDryRun || operatorLarkUat;
  const analyticsEnabled = publicApiKeyOnly
    ? false
    : resolveYouTubeAnalyticsEnabled({
      configured: input.env?.MKT_YOUTUBE_ANALYTICS_ENABLED,
      requested: input.job.body?.analyticsEnabled,
    });
  const channelId = readYouTubeChannelIdFromEnv(input.env);
  const clients = await (dependencies.createYouTubeRuntimeClients
    ?? createYouTubeRuntimeClients)(input.env, {
    publicApiKeyOnly,
    analyticsEnabled,
    customerKey: runtimeConfig.customerKey,
    channelId,
  });
  const durableIdentity = operatorIdentity ?? (input.operation?.stable === true
    ? input.operation
    : null);
  const boundedQueueIdentity = input.job.body?.trigger === 'scheduled'
    || input.job.body?.trigger === JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT
    ? durableIdentity
    : null;
  const requestedAt = durableIdentity?.originalRequestedAt
    ?? readSyncJobGeneration(input.job, 'YouTube');

  if (!operatorDryRun) {
    await drainPendingSyncWarnings({
      store: reliability.store,
      warningOutboxStore: resumableWorkStore,
      platform: 'youtube',
      limit: 25,
      onReliabilityError: (event) => logQueueResult({
        ok: false,
        scope: 'warning_outbox',
        ...sanitizeReliabilityEvent(event),
      }),
    });
  }

  const result = await (dependencies.runReliableSync ?? runReliableSync)({
    ...(operatorIdentity ? { syncRunId: operatorIdentity.syncRunId } : {}),
    store: reliability.store,
    lockManager: reliability.lockManager,
    customerProfile: runtimeConfig.profileKey,
    accountKey: connectorConfig.accountKey,
    platform: 'youtube',
    source: 'youtube_data_api',
    syncType: 'organic_end_to_end',
    retryCount: Math.max(0, readAttempts(input.message) - 1),
    leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
    renewIntervalMs: readPositiveInteger(
      input.env?.MKT_SYNC_LOCK_RENEW_INTERVAL_MS,
      DEFAULT_LOCK_RENEW_INTERVAL_MS,
    ),
    alertOnRetryableFailure: false,
    alertOnResultWarnings: true,
    warningOutboxStore: resumableWorkStore,
    onReliabilityError: (event) => logQueueResult({
      ok: false,
      scope: 'reliability',
      ...sanitizeReliabilityEvent(event),
    }),
    execute: async ({ syncRunId, lockKey, assertLockActive }) => {
      const historyGateway = infrastructure.getOrganicHistoryGateway();
      await historyGateway.assertSchemaReady();
      const syncResult = await (dependencies.syncYouTubeOrganicEndToEnd
        ?? syncYouTubeOrganicEndToEnd)({
        syncRunId,
        assertLockActive,
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        incrementalStateStore: infrastructure.getIncrementalStateStore(),
        resumableWorkStore,
        historyGateway,
        historyStore: historyGateway.store,
        analyticsStore: infrastructure.getYouTubeAnalyticsDailyStore(),
        publicClient: clients.publicClient,
        ownerClient: clients.ownerClient,
        channelId,
        accountKey: connectorConfig.accountKey,
        customerProfile: runtimeConfig.profileKey,
        customerKey: requireJobText(runtimeConfig.customerKey, 'runtimeConfig.customerKey'),
        cursorKey: lockKey,
        workKey: durableIdentity?.workKey
          ?? `youtube:${requireJobText(input.message?.id, 'message.id')}`,
        requestedAt,
        generation: requestedAt,
        syncType: 'organic_end_to_end',
        metricDate: readMetricDate(input.job.body?.metricDate, input.env),
        reportingTimezone: input.env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
        sourceTimezone: input.env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
        syncMode: input.job.body?.syncMode,
        recentVideoLimit: readPositiveInteger(input.env?.MKT_YOUTUBE_RECENT_VIDEO_LIMIT, 100),
        contentMaxPages: readPositiveInteger(input.env?.YOUTUBE_MAX_PAGES, 100),
        fullSyncIntervalMs: readPositiveInteger(
          input.env?.MKT_YOUTUBE_FULL_RECONCILIATION_INTERVAL_MS,
          DEFAULT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS,
        ),
        analyticsEnabled,
        analyticsStartDate: input.job.body?.analyticsStartDate,
        analyticsEndDate: input.job.body?.analyticsEndDate,
        analyticsMaxPages: readPositiveInteger(
          input.env?.MKT_YOUTUBE_ANALYTICS_MAX_PAGES,
          1000,
        ),
        maxSourceUnitsPerInvocation: boundedQueueIdentity
          ? readPositiveInteger(input.env?.MKT_YOUTUBE_SOURCE_UNITS_PER_INVOCATION, 1)
          : null,
        maxDestinationRowsPerInvocation: boundedQueueIdentity
          ? readPositiveInteger(input.env?.MKT_YOUTUBE_DESTINATION_ROWS_PER_INVOCATION, 100)
          : null,
        maxStorageRowsPerInvocation: boundedQueueIdentity
          ? readPositiveInteger(input.env?.MKT_YOUTUBE_D1_ROWS_PER_INVOCATION, 5)
          : null,
        d1WriteEnabled,
        larkWriteEnabled,
        dryRun,
        tables: {
          mktAccounts: tableIds.mktAccounts,
          mktContent: tableIds.mktContent,
          mktContentDaily: tableIds.mktContentDaily,
        },
      });

      if (!publicApiKeyOnly) return syncResult;
      return Object.freeze({
        ...syncResult,
        providerRequestCount: Number(clients.requestMetrics?.publicRequests ?? 0),
        analyticsRequestCount: 0,
        oauthRefreshCount: 0,
        ...(operatorDryRun ? { larkWriteCount: 0 } : {}),
      });
    },
  });

  if (result.continuationRequired === true) {
    await enqueueYouTubeSyncContinuation({
      env: input.env,
      originalBody: input.job.body,
      operation: input.operation,
      result,
    });
  }

  if (!operatorDryRun) {
    await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
    return result;
  }

  return Object.freeze({
    ...result,
    operation: operatorIdentity,
    writeOutcomes: Object.freeze({
      businessD1: 'not_started',
      coverage: 'not_started',
      incrementalCheckpoint: 'not_started',
      lark: 'not_started',
      analytics: 'not_started',
      oauthRefresh: 'not_started',
    }),
    operationalMutations: Object.freeze({
      syncRuns: true,
      syncLocks: true,
      queueOperationAttempts: true,
      resumableWork: true,
      generationFence: true,
      reliabilityMirror: true,
      warningDrain: false,
      expiredWorkCleanup: false,
    }),
  });
}

export function assertYouTubeWorkerDryRunOperation(input = {}) {
  const body = input.body ?? {};
  const operation = input.operation;
  const invalid = [];
  if (body.trigger !== JOB_TRIGGERS.YOUTUBE_WORKER_DRY_RUN) invalid.push('trigger');
  if (body.dryRun !== true) invalid.push('dryRun');
  if (body.analyticsEnabled !== false) invalid.push('analyticsEnabled');
  const operationId = validateStableYouTubeOperationIdentity({ body, operation, invalid });
  if (input.d1WriteEnabled === true) invalid.push('d1BusinessWrite');
  if (input.larkWriteEnabled === true) invalid.push('larkWrite');
  if (readBoolean(input.env?.MKT_YOUTUBE_ANALYTICS_ENABLED, false)) invalid.push('analyticsRuntime');
  if (readBoolean(input.env?.MKT_SCHEDULE_YOUTUBE_ENABLED, false)) invalid.push('youtubeSchedule');
  if (invalid.length > 0) {
    throw permanentError('YouTube Worker dry-run operation failed its safety contract', {
      code: 'YOUTUBE_DRY_RUN_OPERATION_INVALID',
      details: { invalid: [...new Set(invalid)].sort() },
    });
  }
  return Object.freeze({
    operationId,
    workKey: `youtube:${operationId}`,
    syncRunId: `youtube-dry-run:${operationId}`,
    generation: operation.generation,
    originalRequestedAt: operation.originalRequestedAt,
    stable: true,
  });
}

export function assertYouTubeLarkFullSyncUatOperation(input = {}) {
  const body = input.body ?? {};
  const operation = input.operation;
  const invalid = [];
  if (body.trigger !== JOB_TRIGGERS.YOUTUBE_LARK_FULL_SYNC_UAT) invalid.push('trigger');
  if (body.dryRun !== false) invalid.push('dryRun');
  if (body.syncMode !== 'full') invalid.push('syncMode');
  if (body.analyticsEnabled !== false) invalid.push('analyticsEnabled');
  const operationId = validateStableYouTubeOperationIdentity({ body, operation, invalid });
  if (input.d1WriteEnabled !== true) invalid.push('d1BusinessWrite');
  if (input.larkWriteEnabled !== true) invalid.push('larkWrite');
  if (readBoolean(input.env?.MKT_YOUTUBE_ANALYTICS_ENABLED, false)) invalid.push('analyticsRuntime');
  if (readBoolean(input.env?.MKT_SCHEDULE_YOUTUBE_ENABLED, false)) invalid.push('youtubeSchedule');
  if (invalid.length > 0) {
    throw permanentError('YouTube Lark full-sync UAT operation failed its safety contract', {
      code: 'YOUTUBE_LARK_UAT_OPERATION_INVALID',
      details: { invalid: [...new Set(invalid)].sort() },
    });
  }
  return Object.freeze({
    operationId,
    workKey: `youtube:${operationId}`,
    syncRunId: `youtube-lark-uat:${operationId}`,
    generation: operation.generation,
    originalRequestedAt: operation.originalRequestedAt,
    stable: true,
  });
}

function validateStableYouTubeOperationIdentity(input) {
  const body = input.body ?? {};
  const operation = input.operation;
  const invalid = input.invalid;
  if (!operation || operation.stable !== true) invalid.push('stableOperation');
  const operationId = optionalSafeOperationId(operation?.operationId);
  if (!operationId) invalid.push('operationId');
  const expectedWorkKey = operationId ? `youtube:${operationId}` : null;
  if (operation?.workKey !== expectedWorkKey) invalid.push('workKey');
  if (!Number.isSafeInteger(operation?.generation)
    || operation.generation !== operation.originalRequestedAt) {
    invalid.push('generation');
  }
  if (body.workKey !== expectedWorkKey
    || body.operationId !== operationId
    || Number(body.generation) !== operation?.generation
    || Number(body.originalRequestedAt) !== operation?.originalRequestedAt) {
    invalid.push('payloadIdentity');
  }
  return operationId;
}

function assertYouTubeOperatorRuntime(runtimeConfig, connectorConfig, input = {}) {
  const valid = runtimeConfig?.environment === 'development'
    && runtimeConfig?.profileKey === 'integration_workspace'
    && runtimeConfig?.customerKey === 'chemistry_k'
    && connectorConfig?.accountKey === 'chemistry_k';
  if (!valid) {
    throw permanentError(
      `YouTube ${input.label ?? 'operator'} requires the approved Integration Workspace identity`,
      { code: input.code ?? 'YOUTUBE_OPERATOR_RUNTIME_INVALID' },
    );
  }
}

function optionalSafeOperationId(value) {
  if (typeof value !== 'string') return null;
  const text = value.trim().toLowerCase();
  return /^[a-z0-9][a-z0-9_-]{0,95}$/u.test(text) ? text : null;
}
