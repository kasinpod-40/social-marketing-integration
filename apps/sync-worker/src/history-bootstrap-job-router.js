import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  JOB_TYPES,
  assertJobImplemented,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { bootstrapTikTokOrganicHistory } from '../../../packages/application/src/use-cases/bootstrap-tiktok-organic-history.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { readStorageRuntimeConfig } from '../../../packages/config/src/storage-runtime-config.js';
import { runReliableSync } from '../../../packages/reliability/src/reliable-sync-runner.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { processJob as processActiveJob } from './active-job-router.js';
import {
  DEFAULT_LOCK_LEASE_MS,
  DEFAULT_LOCK_RENEW_INTERVAL_MS,
  DEFAULT_TIKTOK_SOURCE_MAX_PAGES,
  DEFAULT_TIKTOK_SOURCE_PAGE_SIZE,
  logQueueResult,
  readAttempts,
  readPositiveInteger,
  readSyncJobGeneration,
  requireJobText,
  sanitizeReliabilityEvent,
} from './worker-runtime-support.js';

/** แยก Manual bootstrap route ออกจาก Active router เดิมเพื่อลดผลกระทบ Connector/Report paths */
export async function processJobWithHistoryBootstrap(input) {
  if (input.job?.body?.type !== JOB_TYPES.TIKTOK_CREATOR_NATIVE_HISTORY_BOOTSTRAP) {
    return processActiveJob(input);
  }

  const definition = assertJobImplemented(getJobDefinition(input.job.body.type));
  if (definition.manualOnly !== true || input.job.body?.trigger !== 'manual') {
    throw permanentError('TikTok history bootstrap accepts manual Queue jobs only', {
      code: 'TIKTOK_HISTORY_BOOTSTRAP_MANUAL_ONLY',
    });
  }

  const runtimeConfig = input.getRuntimeConfig();
  if (runtimeConfig.environment !== 'development'
    || runtimeConfig.profileKey !== 'integration_workspace') {
    throw permanentError('TikTok history bootstrap is restricted to the Integration Workspace', {
      code: 'TIKTOK_HISTORY_BOOTSTRAP_ENVIRONMENT_BLOCKED',
    });
  }
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
    onReliabilityError: (event) => logQueueResult({
      ok: false,
      scope: 'reliability',
      ...sanitizeReliabilityEvent(event),
    }),
    execute: ({ syncRunId, lockKey, assertLockActive }) => bootstrapTikTokOrganicHistory({
      syncRunId,
      assertLockActive,
      repository: infrastructure.repository,
      gateway: infrastructure.getOrganicHistoryGateway(),
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
    }),
  });

  await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
  return result;
}
