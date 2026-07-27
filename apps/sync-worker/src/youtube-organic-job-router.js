import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
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
import { createYouTubeClientsFromEnv } from '../../../packages/connectors/src/youtube/youtube-runtime-factory.js';
import { readStorageRuntimeConfig } from '../../../packages/config/src/storage-runtime-config.js';
import {
  drainPendingSyncWarnings,
  runReliableSync,
} from '../../../packages/reliability/src/reliable-sync-runner.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { resolveYouTubeAnalyticsEnabled } from './scheduled-jobs.js';
import {
  DEFAULT_LOCK_LEASE_MS,
  DEFAULT_LOCK_RENEW_INTERVAL_MS,
  DEFAULT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS,
  logQueueResult,
  readAttempts,
  readMetricDate,
  readPositiveInteger,
  readSyncJobGeneration,
  requireJobText,
  sanitizeReliabilityEvent,
} from './worker-runtime-support.js';

/**
 * Dedicated YouTube route สำหรับ Integration Chat นำไปประกอบกับ Shared entrypoint ภายหลัง.
 * ไฟล์นี้ไม่ส่ง Queue, ไม่เปิด Schedule และทุก Execution flag เป็น false เมื่อ Env ไม่ระบุ.
 */
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
  if (!youtubeConfig.endToEndEnabled) {
    throw permanentError('YouTube end-to-end route is disabled for this environment', {
      code: 'YOUTUBE_END_TO_END_DISABLED',
    });
  }
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
  const infrastructure = input.getInfrastructure();
  const youtubeTableIds = readYouTubeLarkTableIdsFromEnv(input.env);
  const operationalTableIds = readLarkTableIdsFromEnv(input.env, ['mktSyncLog', 'mktSystemAlerts']);
  const tableIds = Object.freeze({ ...youtubeTableIds, ...operationalTableIds });
  const reliability = infrastructure.getReliability(tableIds);
  const resumableWorkStore = infrastructure.getResumableWorkStore();
  const clients = createYouTubeClientsFromEnv(input.env);
  const analyticsEnabled = resolveYouTubeAnalyticsEnabled({
    configured: input.env?.MKT_YOUTUBE_ANALYTICS_ENABLED,
    requested: input.job.body?.analyticsEnabled,
  });
  const channelId = readYouTubeChannelIdFromEnv(input.env);
  const requestedAt = readSyncJobGeneration(input.job, 'YouTube');

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

  const result = await runReliableSync({
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
      return syncYouTubeOrganicEndToEnd({
        syncRunId,
        assertLockActive,
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        incrementalStateStore: infrastructure.getIncrementalStateStore(),
        resumableWorkStore,
        historyGateway,
        historyStore: historyGateway.store,
        publicClient: clients.publicClient,
        ownerClient: clients.ownerClient,
        channelId,
        accountKey: connectorConfig.accountKey,
        customerProfile: runtimeConfig.profileKey,
        customerKey: requireJobText(runtimeConfig.customerKey, 'runtimeConfig.customerKey'),
        cursorKey: lockKey,
        workKey: `youtube:${requireJobText(input.message?.id, 'message.id')}`,
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
        analyticsMaxPages: readPositiveInteger(input.env?.MKT_YOUTUBE_ANALYTICS_MAX_PAGES, 1000),
        d1WriteEnabled,
        larkWriteEnabled,
        dryRun,
        tables: {
          mktAccounts: tableIds.mktAccounts,
          rawYouTubeChannels: tableIds.rawYouTubeChannels,
          rawYouTubeVideos: tableIds.rawYouTubeVideos,
          rawYouTubeAnalyticsDaily: tableIds.rawYouTubeAnalyticsDaily,
          mktContent: tableIds.mktContent,
          mktContentDaily: tableIds.mktContentDaily,
        },
      });
    },
  });

  await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
  return result;
}
