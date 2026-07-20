import { createSystemAlert } from '../../../packages/domain/src/entities/system-alert.js';
import { syncTikTokCreatorNativeToLark } from '../../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { syncYouTubeOrganicToLark } from '../../../packages/application/src/use-cases/sync-youtube-organic-to-lark.js';
import { redriveDeadLetterJob } from '../../../packages/application/src/use-cases/redrive-dead-letter-job.js';
import { createLarkBitableClientFromEnv } from '../../../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../../../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../../../packages/sync-engine/src/table-sync-engine.js';
import { seedMetricDefinitions } from '../../../packages/application/src/use-cases/seed-metric-definitions.js';
import { seedReportSettings } from '../../../packages/application/src/use-cases/seed-report-settings.js';
import { generateTikTokOrganicReport } from '../../../packages/application/src/use-cases/generate-tiktok-organic-report.js';
import { addDaysDateOnly } from '../../../packages/application/src/reports/report-period.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import {
  readYouTubeChannelIdFromEnv,
  readYouTubeLarkTableIdsFromEnv,
} from '../../../packages/config/src/youtube-organic-runtime-config.js';
import { validateLarkLiveSync } from '../../../packages/application/src/use-cases/validate-lark-live-sync.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { resolveMetricDate } from '../../../packages/config/src/metric-date-config.js';
import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  JOB_TYPES,
  assertJobImplemented,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { normalizeQueueJobMessage } from '../../../packages/application/src/jobs/queue-job.js';
import {
  isRetryableError,
  permanentError,
  sanitizeOperationalText,
  sanitizeOperationalValue,
} from '../../../packages/shared/src/errors/runtime-error.js';
import {
  drainPendingSyncWarnings,
  runReliableSync,
} from '../../../packages/reliability/src/reliable-sync-runner.js';
import { createCloudflareReliabilityRuntime } from '../../../packages/reliability/src/runtime-factory.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';
import { CompositeReliabilityStore } from '../../../packages/reliability/src/composite-reliability-store.js';
import { LarkReliabilityStore } from '../../../packages/reliability/src/lark-reliability-store.js';
import { D1IncrementalStateStore } from '../../../packages/sync-engine/src/d1-incremental-state-store.js';
import { D1ResumableWorkStore } from '../../../packages/sync-engine/src/d1-resumable-work-store.js';
import { createYouTubeClientsFromEnv } from '../../../packages/connectors/src/youtube/youtube-runtime-factory.js';

const DEFAULT_LOCK_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_LOCK_RENEW_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_RETRY_DELAY_SECONDS = 30;
const DEFAULT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS = 24 * 60 * 60 * 1000;
const DEFAULT_TIKTOK_SOURCE_PAGE_SIZE = 500;
const DEFAULT_TIKTOK_SOURCE_MAX_PAGES = 1_000;
const DEFAULT_DAILY_REPORT_TIME = '08:10';
const DEFAULT_WEEKLY_REPORT_TIME = '08:15';
const DEFAULT_WEEKLY_REPORT_WEEKDAY = 'monday';
const DEFAULT_YOUTUBE_ANALYTICS_TIME = '07:50';
const DEFAULT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS = 7;
const YOUTUBE_ANALYTICS_TIMEZONE = 'America/Los_Angeles';
const SCHEDULE_WEEKDAYS = new Set(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']);
const YOUTUBE_SCHEDULE_MINUTE_UTC = 50;
const YOUTUBE_SCHEDULE_HOURS_UTC = Object.freeze([0, 6, 12, 18]);

export const PRIMARY_SCHEDULE_CRON = '*/5 * * * *';
export const YOUTUBE_SCHEDULE_CRON = `${YOUTUBE_SCHEDULE_MINUTE_UTC} ${YOUTUBE_SCHEDULE_HOURS_UTC.join(',')} * * *`;

export const QUEUE_ROLES = Object.freeze({
  MAIN: 'main',
  DLQ: 'dlq',
  UNKNOWN: 'unknown',
});

/** สร้าง Worker instance เพื่อให้ Worker-runtime tests inject use case ได้โดยไม่เปลี่ยน Production default */
export function createSyncWorker(dependencies = {}) {
  const processJobImpl = dependencies.processJob ?? processJob;
  const infrastructureFactory = dependencies.createInfrastructure ?? createInfrastructure;
  const operationalStoreFactory = dependencies.createOperationalStore ?? createOperationalStore;

  return Object.freeze({
    /** Cron ทำหน้าที่เป็น Producer เท่านั้น เพื่อให้ Retry/Lock/DLQ อยู่ใน Queue flow เดียวกัน */
    async scheduled(event, env) {
      const scheduledAt = new Date(event.scheduledTime).toISOString();
      const jobs = buildScheduledJobs({ event, env, scheduledAt });

      if (jobs.length === 0) {
        logQueueResult({
          ok: true,
          scope: 'scheduler',
          status: 'skipped',
          reason: 'no_scheduled_jobs_due',
          requestedAt: scheduledAt,
        });
        return;
      }

      const runtimeConfig = loadCustomerRuntimeConfig(env);
      for (const connectorKey of new Set(jobs
        .map((job) => assertJobImplemented(getJobDefinition(job.type)).connectorKey)
        .filter(Boolean))) {
        assertConnectorRunnable(runtimeConfig, connectorKey);
      }
      const queue = env?.MKT_SYNC_QUEUE;
      if (typeof queue?.send !== 'function') {
        throw permanentError('Missing Queue producer binding MKT_SYNC_QUEUE', {
          code: 'MKT_SYNC_QUEUE_BINDING_REQUIRED',
        });
      }

      for (const job of jobs) {
        await queue.send(job);
        logQueueResult({
          ok: true,
          scope: 'scheduler',
          status: 'enqueued',
          type: job.type,
          requestedAt: scheduledAt,
          reportSettingKey: job.reportSettingKey ?? null,
          metricDate: job.metricDate ?? null,
          periodEnd: job.periodEnd ?? null,
        });
      }
    },

    /** Queue routing เป็น whitelist และ fail-closed: Main, DLQ หรือ Unknown เท่านั้น */
    async queue(batch, env) {
      const role = classifyQueueBatch(batch, env);
      if (role === QUEUE_ROLES.DLQ) {
        await processDeadLetterBatch(batch, env, operationalStoreFactory);
        return;
      }
      if (role === QUEUE_ROLES.UNKNOWN) {
        await processUnknownQueueBatch(batch, env, operationalStoreFactory);
        return;
      }

      let runtimeConfig = null;
      let infrastructure = null;
      const getRuntimeConfig = () => {
        runtimeConfig ??= loadCustomerRuntimeConfig(env);
        return runtimeConfig;
      };
      const getInfrastructure = () => {
        infrastructure ??= infrastructureFactory(env);
        return infrastructure;
      };

      for (const message of batch.messages) {
        let job = null;
        try {
          job = normalizeQueueJobMessage(message);
          const result = await processJobImpl({
            job,
            message,
            env,
            getRuntimeConfig,
            getInfrastructure,
          });
          logQueueResult({
            ok: true,
            messageId: message.id,
            attempts: readAttempts(message),
            schemaVersion: job.schemaVersion,
            type: job.body?.type,
            result: summarizeJobResult(result),
          });
          message.ack();
        } catch (error) {
          const retryable = isRetryableError(error);
          logQueueResult({
            ok: false,
            messageId: message.id,
            attempts: readAttempts(message),
            schemaVersion: job?.schemaVersion ?? null,
            type: job?.body?.type ?? null,
            syncRunId: error?.syncRunId ?? null,
            reliabilityHandled: error?.reliabilityHandled === true,
            retryable,
            error: error instanceof Error ? error.message : String(error),
            code: error?.code ?? null,
          });

          if (retryable) {
            message.retry({ delaySeconds: readRetryDelaySeconds(env, message) });
            continue;
          }

          try {
            // Permanent ทุกเส้นทางต้องมี Dead-letter payload สำหรับ Redrive
            // แม้ Reliability runner จะบันทึก Sync failure/alert ไปแล้วก็ตาม.
            await recordPermanentQueueFailure({
              env, batch, message, job, error, operationalStoreFactory,
            });
          } catch (persistenceError) {
            logQueueResult({
              ok: false,
              scope: 'terminal_failure_persistence',
              messageId: message.id,
              error: persistenceError instanceof Error ? persistenceError.message : String(persistenceError),
              code: persistenceError?.code ?? null,
            });
            // D1 เป็น source of truth จึงห้าม Ack เมื่อบันทึก terminal state ไม่สำเร็จ
            message.retry({ delaySeconds: readRetryDelaySeconds(env, message) });
            continue;
          }
          message.ack();
        }
      }
    },
  });
}

const syncWorker = createSyncWorker();
export default syncWorker;

/** Route Job type ไปยัง Use case จริง โดยตรวจ Implementation/Profile/Feature flag ตามลำดับ */
export async function processJob(input) {
  const definition = assertJobImplemented(getJobDefinition(input.job?.body?.type));

  if (definition.type === JOB_TYPES.DEAD_LETTER_REDRIVE) {
    if (!readBoolean(input.env?.MKT_DLQ_REDRIVE_ENABLED, false)) {
      throw permanentError('Dead-letter redrive is disabled for this environment', {
        code: 'MKT_DLQ_REDRIVE_DISABLED',
      });
    }
    return redriveDeadLetterJob({
      store: new D1ReliabilityStore({ db: input.env?.MKT_STATE_DB }),
      queue: input.env?.MKT_SYNC_QUEUE,
      dlqId: requireJobText(input.job.body?.dlqId, 'dlqId'),
    });
  }

  const runtimeConfig = input.getRuntimeConfig();
  const connectorConfig = definition.connectorKey
    ? assertConnectorRunnable(runtimeConfig, definition.connectorKey)
    : null;
  const infrastructure = input.getInfrastructure();

  if (definition.type === JOB_TYPES.YOUTUBE_ORGANIC_SYNC) {
    // ต้องตรวจ Schema/Table IDs ก่อนสร้าง YouTube client เพื่อไม่เสีย Quota โดยไม่จำเป็น
    const youtubeTableIds = readYouTubeLarkTableIdsFromEnv(input.env);
    const operationalTableIds = readLarkTableIdsFromEnv(input.env, ['mktSyncLog', 'mktSystemAlerts']);
    const tableIds = Object.freeze({ ...youtubeTableIds, ...operationalTableIds });
    const reliability = infrastructure.getReliability(tableIds);
    const clients = createYouTubeClientsFromEnv(input.env);
    const analyticsEnabled = resolveYouTubeAnalyticsEnabled({
      configured: input.env?.MKT_YOUTUBE_ANALYTICS_ENABLED,
      requested: input.job.body?.analyticsEnabled,
    });
    const channelId = readYouTubeChannelIdFromEnv(input.env);
    const requestedAt = readSyncJobGeneration(input.job, 'YouTube');
    const resumableWorkStore = infrastructure.getResumableWorkStore();

    // Drain Warning เก่าก่อน Claim generation ใหม่ เพื่อไม่ให้ Completed incident
    // สูญหายเมื่อ Cron/Manual job ใหม่มาถึงก่อน Retry เดิม.
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
      syncType: 'organic_sync',
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
      execute: ({ syncRunId, lockKey, assertLockActive }) => syncYouTubeOrganicToLark({
        syncRunId,
        assertLockActive,
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        incrementalStateStore: infrastructure.getIncrementalStateStore(),
        resumableWorkStore,
        publicClient: clients.publicClient,
        ownerClient: clients.ownerClient,
        channelId,
        accountKey: connectorConfig.accountKey,
        customerProfile: runtimeConfig.profileKey,
        cursorKey: lockKey,
        // Queue retry คง message.id เดิม จึง Resume page/chunk ได้แม้ syncRunId ของแต่ละ attempt เปลี่ยน
        workKey: `youtube:${requireJobText(input.message?.id, 'message.id')}`,
        requestedAt,
        generation: requestedAt,
        syncType: 'organic_sync',
        metricDate: readMetricDate(input.job.body?.metricDate, input.env),
        reportingTimezone: input.env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
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
        dryRun: input.job.body?.dryRun === true,
        tables: {
          mktAccounts: tableIds.mktAccounts,
          rawYouTubeChannels: tableIds.rawYouTubeChannels,
          rawYouTubeVideos: tableIds.rawYouTubeVideos,
          rawYouTubeAnalyticsDaily: tableIds.rawYouTubeAnalyticsDaily,
          mktContent: tableIds.mktContent,
          mktContentDaily: tableIds.mktContentDaily,
        },
      }),
    });
    // Cleanup หลัง Reliability runner ปล่อย distributed lock แล้วเท่านั้น
    // เพื่อไม่ให้ retention sweep แข่งกับ active/retryable work ของ cursor เดียวกัน
    await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
    return result;
  }

  if (definition.type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC) {
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
      onReliabilityError: (event) => logQueueResult({
        ok: false,
        scope: 'reliability',
        ...sanitizeReliabilityEvent(event),
      }),
      execute: ({ syncRunId, lockKey, assertLockActive }) => syncTikTokCreatorNativeToLark({
        syncRunId,
        assertLockActive,
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        accountId: connectorConfig.accountKey,
        sourceHandle: connectorConfig.sourceHandle,
        metricDate: readMetricDate(input.job.body?.metricDate, input.env),
        customerProfile: runtimeConfig.profileKey,
        cursorKey: lockKey,
        workKey: `tiktok:${requireJobText(input.message?.id, 'message.id')}`,
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
        tables: {
          rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
          mktContent: tableIds.mktContent,
          mktContentDaily: tableIds.mktContentDaily,
          mktClassificationDictionary: tableIds.mktClassificationDictionary,
        },
      }),
    });
    await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
    return result;
  }

  if (definition.type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_VALIDATE) {
    const tableIds = readLarkTableIdsFromEnv(input.env, [
      'rawTikTokCreatorVideos',
      'mktClassificationDictionary',
      'mktContent',
      'mktContentDaily',
    ]);
    return validateLarkLiveSync({
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      accountId: connectorConfig.accountKey,
      sourceHandle: connectorConfig.sourceHandle,
      metricDate: readMetricDate(input.job.body?.metricDate, input.env),
      sampleLimit: input.job.body?.sampleLimit,
      tables: {
        rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
        mktClassificationDictionary: tableIds.mktClassificationDictionary,
        mktContent: tableIds.mktContent,
        mktContentDaily: tableIds.mktContentDaily,
      },
    });
  }

  if (definition.type === JOB_TYPES.METRIC_DEFINITIONS_SEED) {
    const tableIds = readLarkTableIdsFromEnv(input.env, ['mktMetricDefinitions']);
    return seedMetricDefinitions({
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      tableId: tableIds.mktMetricDefinitions,
    });
  }

  if (definition.type === JOB_TYPES.REPORT_SETTINGS_SEED) {
    const tableIds = readLarkTableIdsFromEnv(input.env, ['mktReportSettings']);
    return seedReportSettings({
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      tableId: tableIds.mktReportSettings,
      profileKey: runtimeConfig.profileKey,
    });
  }

  if (definition.type === JOB_TYPES.DAILY_REPORT_GENERATE
    || definition.type === JOB_TYPES.WEEKLY_REPORT_GENERATE) {
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
    const reportType = definition.type === JOB_TYPES.DAILY_REPORT_GENERATE
      ? 'daily_organic_report'
      : 'weekly_organic_report';
    const defaultSettingKey = definition.type === JOB_TYPES.DAILY_REPORT_GENERATE
      ? input.env?.MKT_DAILY_REPORT_SETTING_KEY
      : input.env?.MKT_WEEKLY_REPORT_SETTING_KEY;
    const reportSettingKey = requireJobText(
      input.job.body?.reportSettingKey ?? defaultSettingKey,
      'reportSettingKey',
    );

    return runReliableSync({
      store: reliability.store,
      lockManager: reliability.lockManager,
      customerProfile: runtimeConfig.profileKey,
      accountKey: connectorConfig.accountKey,
      platform: 'tiktok',
      source: 'mkt_content_daily',
      syncType: reportType,
      retryCount: Math.max(0, readAttempts(input.message) - 1),
      leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
      renewIntervalMs: readPositiveInteger(
        input.env?.MKT_SYNC_LOCK_RENEW_INTERVAL_MS,
        DEFAULT_LOCK_RENEW_INTERVAL_MS,
      ),
      alertOnRetryableFailure: false,
      onReliabilityError: (event) => logQueueResult({
        ok: false,
        scope: 'reliability',
        ...sanitizeReliabilityEvent(event),
      }),
      execute: ({ assertLockActive }) => generateTikTokOrganicReport({
        assertLockActive,
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        customerProfile: runtimeConfig.profileKey,
        accountId: connectorConfig.accountKey,
        reportType,
        reportSettingKey,
        periodEnd: input.job.body?.periodEnd,
        comparisonMode: input.job.body?.comparisonMode,
        topContentLimit: input.job.body?.topContentLimit,
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
  }

  throw permanentError(`Active sync job has no runtime handler: ${definition.type}`, {
    code: 'SYNC_JOB_HANDLER_MISSING',
    details: { type: definition.type },
  });
}

/** สร้าง Infrastructure หนึ่งชุดต่อ Queue event เพื่อแชร์ Token, Schema cache และ D1 store */
export function createInfrastructure(env) {
  const client = createLarkBitableClientFromEnv(env);
  const repository = new LarkRecordRepository({ client });
  const syncEngine = new TableSyncEngine();
  let reliability = null;
  let incrementalStateStore = null;
  let resumableWorkStore = null;

  return Object.freeze({
    repository,
    syncEngine,
    getIncrementalStateStore() {
      incrementalStateStore ??= new D1IncrementalStateStore({ db: env?.MKT_STATE_DB });
      return incrementalStateStore;
    },
    getResumableWorkStore() {
      resumableWorkStore ??= new D1ResumableWorkStore({ db: env?.MKT_STATE_DB });
      return resumableWorkStore;
    },
    getReliability(tableIds) {
      reliability ??= createCloudflareReliabilityRuntime({
        env,
        repository,
        syncEngine,
        tables: tableIds,
        onStoreError: ({ method, store, error }) => logQueueResult({
          ok: false,
          scope: 'reliability_store_mirror',
          method,
          store,
          error: error instanceof Error ? error.message : String(error),
          code: error?.code ?? null,
        }),
      });
      return reliability;
    },
  });
}

/** อ่านชื่อ Queue ทั้งสองแบบบังคับ และปฏิเสธ Config ที่หายหรือซ้ำกัน */
export function classifyQueueBatch(batch, env) {
  const mainQueue = requireQueueName(env?.MKT_MAIN_QUEUE_NAME, 'MKT_MAIN_QUEUE_NAME');
  const dlqQueue = requireQueueName(env?.MKT_DLQ_QUEUE_NAME, 'MKT_DLQ_QUEUE_NAME');
  if (mainQueue === dlqQueue) {
    throw permanentError('Main queue and DLQ must use different names', {
      code: 'MKT_QUEUE_ROUTING_CONFIG_INVALID',
    });
  }
  const actual = requireQueueName(batch?.queue, 'batch.queue');
  if (actual === mainQueue) return QUEUE_ROLES.MAIN;
  if (actual === dlqQueue) return QUEUE_ROLES.DLQ;
  return QUEUE_ROLES.UNKNOWN;
}

async function processDeadLetterBatch(batch, env, storeFactory) {
  const store = storeFactory(env);
  for (const message of batch.messages) {
    let job = null;
    try { job = normalizeQueueJobMessage(message); } catch { /* เก็บ Raw body ต่อได้ */ }
    const dlqId = `dlq:${message.id}`;
    try {
      await markQueueWorkTerminal({
        env,
        message,
        jobType: job?.body?.type,
        reason: 'QUEUE_RETRY_EXHAUSTED',
        auditReference: dlqId,
      });
      await store.saveDeadLetter({
        dlqId,
        messageId: message.id,
        queueName: batch.queue,
        jobType: job?.body?.type ?? null,
        schemaVersion: job?.schemaVersion ?? null,
        payload: job?.body ?? message.body,
        errorCode: 'QUEUE_RETRY_EXHAUSTED',
        errorMessage: 'Cloudflare Queue moved this message to the dead-letter queue after retry exhaustion',
        retryCount: readAttempts(message),
        status: 'open',
      });
      await store.saveSystemAlert(createSystemAlert({
        alertId: `alert:${dlqId}`,
        alertType: 'queue_dead_letter',
        severity: 'critical',
        platform: platformFromJobType(job?.body?.type),
        status: 'open',
        errorCode: 'QUEUE_RETRY_EXHAUSTED',
        message: `Queue job ไปถึง DLQ หลัง Retry ครบ\nmessage_id=${message.id}\njob_type=${job?.body?.type ?? 'unknown'}`,
        details: { queueName: batch.queue, attempts: readAttempts(message) },
      }));
      logQueueResult({ ok: false, scope: 'dead_letter', messageId: message.id, dlqId, persisted: true });
      message.ack();
    } catch (error) {
      logQueueResult({
        ok: false,
        scope: 'dead_letter',
        messageId: message.id,
        dlqId,
        persisted: false,
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? null,
      });
      message.retry({ delaySeconds: readRetryDelaySeconds(env, message) });
    }
  }
}

/** Queue ที่ไม่อยู่ใน whitelist ถูก Quarantine ลง D1 และห้ามส่งเข้า normal job routing */
async function processUnknownQueueBatch(batch, env, storeFactory) {
  const store = storeFactory(env);
  for (const message of batch.messages) {
    const dlqId = `unknown-queue:${batch.queue}:${message.id}`;
    try {
      await store.saveDeadLetter({
        dlqId,
        messageId: message.id,
        queueName: batch.queue,
        jobType: null,
        schemaVersion: null,
        payload: message.body,
        errorCode: 'UNKNOWN_QUEUE_ROUTING',
        errorMessage: `Queue ${batch.queue} is not configured as main or DLQ`,
        retryCount: readAttempts(message),
        status: 'open',
      });
      await store.saveSystemAlert(createSystemAlert({
        alertId: `alert:${dlqId}`,
        alertType: 'unknown_queue_routing',
        severity: 'critical',
        platform: 'system',
        status: 'open',
        errorCode: 'UNKNOWN_QUEUE_ROUTING',
        message: `ปฏิเสธ Queue ที่ไม่รู้จักโดยไม่ Execute งาน\nqueue=${batch.queue}\nmessage_id=${message.id}`,
        details: { queueName: batch.queue },
      }));
      message.ack();
    } catch (error) {
      logQueueResult({
        ok: false,
        scope: 'unknown_queue_quarantine',
        messageId: message.id,
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? null,
      });
      message.retry({ delaySeconds: readRetryDelaySeconds(env, message) });
    }
  }
}

async function recordPermanentQueueFailure(input) {
  const store = input.operationalStoreFactory(input.env);
  const dlqId = `terminal:${input.message.id}`;
  await markQueueWorkTerminal({
    env: input.env,
    message: input.message,
    jobType: input.job?.body?.type,
    reason: 'QUEUE_PERMANENT_FAILURE',
    auditReference: dlqId,
  });
  await store.saveDeadLetter({
    dlqId,
    messageId: input.message.id,
    queueName: input.batch?.queue ?? null,
    jobType: input.job?.body?.type ?? null,
    schemaVersion: input.job?.schemaVersion ?? null,
    payload: input.job?.body ?? input.message.body,
    errorCode: input.error?.code ?? 'PERMANENT_QUEUE_FAILURE',
    errorMessage: input.error instanceof Error ? input.error.message : String(input.error),
    retryCount: Math.max(0, readAttempts(input.message) - 1),
    status: 'open',
  });
  await store.saveSystemAlert(createSystemAlert({
    alertId: `alert:${dlqId}`,
    alertType: 'queue_permanent_failure',
    severity: 'critical',
    platform: platformFromJobType(input.job?.body?.type),
    errorCode: input.error?.code ?? 'PERMANENT_QUEUE_FAILURE',
    message: `Queue job หยุดแบบ Permanent\nmessage_id=${input.message.id}\njob_type=${input.job?.body?.type ?? 'unknown'}\nerror=${input.error instanceof Error ? input.error.message : String(input.error)}`,
    details: { attempts: readAttempts(input.message) },
  }));
}

async function markQueueWorkTerminal(input) {
  const platform = platformFromJobType(input.jobType);
  if (!new Set(['youtube', 'tiktok']).has(platform)) return false;
  // Dependency-injected/non-production route อาจไม่มี D1 binding;
  // Production path ยัง fail-closed ที่ createOperationalStore เมื่อ binding หาย
  if (!input.env?.MKT_STATE_DB) return false;
  const workStore = new D1ResumableWorkStore({ db: input.env?.MKT_STATE_DB });
  const result = await workStore.abandonWork({
    workKey: `${platform}:${requireJobText(input.message?.id, 'message.id')}`,
    reason: input.reason,
    auditReference: input.auditReference,
  });
  await workStore.cleanupExpiredWork({ limit: 25 });
  return result;
}

/** D1 เป็น Primary เสมอ ส่วน Lark เป็น Mirror เมื่อ Config ครบ */
export function createOperationalStore(env) {
  const d1Store = new D1ReliabilityStore({ db: env?.MKT_STATE_DB });
  const mirrors = [];
  try {
    const infrastructure = createInfrastructure(env);
    const tableIds = readLarkTableIdsFromEnv(env, ['mktSyncLog', 'mktSystemAlerts']);
    mirrors.push(new LarkReliabilityStore({
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      tables: { syncLog: tableIds.mktSyncLog, systemAlerts: tableIds.mktSystemAlerts },
    }));
  } catch (error) {
    logQueueResult({
      ok: false,
      scope: 'reliability_store_mirror_unavailable',
      store: 'LarkReliabilityStore',
      error: error instanceof Error ? error.message : String(error),
      code: error?.code ?? null,
    });
  }
  return new CompositeReliabilityStore({
    primary: d1Store,
    mirrors,
    onStoreError: ({ method, store, error }) => logQueueResult({
      ok: false,
      scope: 'reliability_store_mirror',
      method,
      store,
      error: error instanceof Error ? error.message : String(error),
      code: error?.code ?? null,
    }),
  });
}

function platformFromJobType(type) {
  if (typeof type !== 'string') return 'system';
  if (type.startsWith('report.')) return 'tiktok';
  const prefix = type.split('.')[0];
  return new Set(['facebook', 'instagram', 'tiktok', 'youtube']).has(prefix) ? prefix : 'system';
}

/** สร้างรายการ Job ที่ถึงรอบตามเวลาท้องถิ่น โดย Sync มาก่อน Report เพื่อให้รายงานอ่าน Snapshot ล่าสุด */
export function buildScheduledJobs(input = {}) {
  const env = input.env ?? {};
  const requestedAt = normalizeScheduledAt(input.scheduledAt ?? input.event?.scheduledTime);
  const cron = optionalJobText(input.event?.cron);
  const includePrimaryJobs = cron === PRIMARY_SCHEDULE_CRON;
  const includeYouTubeJobs = cron === YOUTUBE_SCHEDULE_CRON;
  if (!includePrimaryJobs && !includeYouTubeJobs) return Object.freeze([]);

  const tiktokEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_TIKTOK_ENABLED, false)
    : false;
  const dailyEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_DAILY_REPORT_ENABLED, false)
    : false;
  const weeklyEnabled = includePrimaryJobs
    ? readBoolean(env.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED, false)
    : false;
  const youtubeEnabled = includeYouTubeJobs
    ? readBoolean(env.MKT_SCHEDULE_YOUTUBE_ENABLED, false)
    : false;
  if ((!includePrimaryJobs || (!tiktokEnabled && !dailyEnabled && !weeklyEnabled))
    && (!includeYouTubeJobs || !youtubeEnabled)) {
    return Object.freeze([]);
  }

  const timeZone = requireJobText(env.DEFAULT_TIMEZONE ?? 'Asia/Bangkok', 'DEFAULT_TIMEZONE');
  const local = readZonedScheduleParts(requestedAt, timeZone);
  const completedPeriodEnd = addDaysDateOnly(local.date, -1);
  const jobs = [];

  if (includePrimaryJobs && tiktokEnabled) {
    jobs.push(Object.freeze({
      schemaVersion: 1,
      type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
      trigger: 'scheduled',
      syncMode: 'auto',
      requestedAt,
      // ล็อกวันที่จาก scheduledTime เพื่อให้ Queue delay/retry ข้ามวันยังเขียน Snapshot วันเดิม
      metricDate: local.date,
    }));
  }

  if (includePrimaryJobs && dailyEnabled) {
    const dailyTime = readScheduleTime(env.MKT_DAILY_REPORT_TIME ?? DEFAULT_DAILY_REPORT_TIME, 'MKT_DAILY_REPORT_TIME');
    if (local.time === dailyTime) {
      jobs.push(Object.freeze({
        schemaVersion: 1,
        type: JOB_TYPES.DAILY_REPORT_GENERATE,
        trigger: 'scheduled',
        requestedAt,
        // รายงานใช้วันสมบูรณ์ล่าสุด และล็อก Identity ตั้งแต่ Producer ไม่ให้ Queue delay เปลี่ยนช่วง
        periodEnd: completedPeriodEnd,
        reportSettingKey: requireJobText(env.MKT_DAILY_REPORT_SETTING_KEY, 'MKT_DAILY_REPORT_SETTING_KEY'),
      }));
    }
  }

  if (includePrimaryJobs && weeklyEnabled) {
    const weeklyTime = readScheduleTime(env.MKT_WEEKLY_REPORT_TIME ?? DEFAULT_WEEKLY_REPORT_TIME, 'MKT_WEEKLY_REPORT_TIME');
    const weeklyWeekday = readScheduleWeekday(
      env.MKT_WEEKLY_REPORT_WEEKDAY ?? DEFAULT_WEEKLY_REPORT_WEEKDAY,
      'MKT_WEEKLY_REPORT_WEEKDAY',
    );
    if (local.time === weeklyTime && local.weekday === weeklyWeekday) {
      jobs.push(Object.freeze({
        schemaVersion: 1,
        type: JOB_TYPES.WEEKLY_REPORT_GENERATE,
        trigger: 'scheduled',
        requestedAt,
        periodEnd: completedPeriodEnd,
        reportSettingKey: requireJobText(env.MKT_WEEKLY_REPORT_SETTING_KEY, 'MKT_WEEKLY_REPORT_SETTING_KEY'),
      }));
    }
  }

  if (includeYouTubeJobs && youtubeEnabled) {
    const analyticsConfigured = readBoolean(env.MKT_YOUTUBE_ANALYTICS_ENABLED, false);
    const analyticsTime = analyticsConfigured
      ? readSupportedYouTubeAnalyticsTime({
        value: env.MKT_YOUTUBE_ANALYTICS_TIME ?? DEFAULT_YOUTUBE_ANALYTICS_TIME,
        requestedAt,
        timeZone,
      })
      : null;
    const analyticsEnabled = analyticsConfigured && local.time === analyticsTime;
    const job = {
      schemaVersion: 1,
      type: JOB_TYPES.YOUTUBE_ORGANIC_SYNC,
      trigger: 'scheduled',
      syncMode: 'auto',
      requestedAt,
      metricDate: local.date,
      analyticsEnabled,
    };
    if (analyticsEnabled) {
      const sourceLocal = readZonedScheduleParts(requestedAt, YOUTUBE_ANALYTICS_TIMEZONE);
      const endDate = addDaysDateOnly(sourceLocal.date, -1);
      const lookbackDays = readBoundedPositiveInteger(
        env.MKT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS,
        DEFAULT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS,
        31,
        'MKT_YOUTUBE_ANALYTICS_LOOKBACK_DAYS',
      );
      job.analyticsStartDate = addDaysDateOnly(endDate, -(lookbackDays - 1));
      job.analyticsEndDate = endDate;
    }
    jobs.push(Object.freeze(job));
  }

  return Object.freeze(jobs);
}

/** อ่านเวลาและวันตาม Timezone จาก scheduledTime ของ Cloudflare โดยไม่พึ่ง Timezone เครื่อง */
export function readZonedScheduleParts(value, timeZone) {
  const requestedAt = normalizeScheduledAt(value);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: requireJobText(timeZone, 'timeZone'),
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(requestedAt));
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return Object.freeze({
    date: [
      requireJobText(byType.year, 'scheduled year'),
      requireJobText(byType.month, 'scheduled month'),
      requireJobText(byType.day, 'scheduled day'),
    ].join('-'),
    weekday: requireJobText(byType.weekday, 'scheduled weekday').toLowerCase(),
    time: `${requireJobText(byType.hour, 'scheduled hour')}:${requireJobText(byType.minute, 'scheduled minute')}`,
  });
}

function normalizeScheduledAt(value) {
  const date = value instanceof Date
    ? value
    : new Date(typeof value === 'number' ? value : requireJobText(value, 'scheduledAt'));
  if (Number.isNaN(date.getTime())) {
    throw permanentError('Scheduled time must be a valid instant', {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
    });
  }
  return date.toISOString();
}

function readScheduleTime(value, fieldName) {
  const text = requireJobText(value, fieldName);
  const match = /^(?:[01]\d|2[0-3]):([0-5]\d)$/u.exec(text);
  if (!match || Number(match[1]) % 5 !== 0) {
    throw permanentError(`${fieldName} must use HH:mm and a 5-minute boundary`, {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
      details: { fieldName, value: text },
    });
  }
  return text;
}

/**
 * Analytics ใช้เวลา Local แบบคงที่ จึงต้องตรงกับอย่างน้อยหนึ่ง instant ที่ Dedicated YouTube Cron ยิงจริง
 * การตรวจนี้ทำก่อนสร้าง Job เพื่อไม่ให้ Config ผ่านแต่ Analytics ไม่เคยถูก enqueue.
 */
function readSupportedYouTubeAnalyticsTime(input) {
  const fieldName = 'MKT_YOUTUBE_ANALYTICS_TIME';
  const configuredTime = readScheduleTime(input.value, fieldName);
  const supportedTimes = listYouTubeCronLocalTimes(input.requestedAt, input.timeZone);
  if (!supportedTimes.includes(configuredTime)) {
    throw permanentError(`${fieldName} must match a local time reached by YOUTUBE_SCHEDULE_CRON`, {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
      details: { fieldName, supportedTimes },
    });
  }
  return configuredTime;
}

function listYouTubeCronLocalTimes(requestedAt, timeZone) {
  const anchor = new Date(normalizeScheduledAt(requestedAt));
  const year = anchor.getUTCFullYear();
  const month = anchor.getUTCMonth();
  const day = anchor.getUTCDate();
  return Object.freeze([...new Set(YOUTUBE_SCHEDULE_HOURS_UTC.map((hour) => (
    readZonedScheduleParts(
      new Date(Date.UTC(year, month, day, hour, YOUTUBE_SCHEDULE_MINUTE_UTC)),
      timeZone,
    ).time
  )))].sort());
}

function readScheduleWeekday(value, fieldName) {
  const text = requireJobText(value, fieldName).toLowerCase();
  if (!SCHEDULE_WEEKDAYS.has(text)) {
    throw permanentError(`${fieldName} must be an English weekday`, {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
      details: { fieldName, value: text },
    });
  }
  return text;
}

function requireJobText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Missing required job/config value ${fieldName}`, {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}

function optionalJobText(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireJobText(value, 'event.cron');
}

function readBoundedPositiveInteger(value, fallback, maximum, fieldName) {
  const number = value === null || value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isSafeInteger(number) || number <= 0 || number > maximum) {
    throw permanentError(`${fieldName} must be an integer from 1 to ${maximum}`, {
      code: 'MKT_SCHEDULE_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return number;
}

function readMetricDate(jobValue, env) {
  return resolveMetricDate({ env, override: jobValue });
}

/** Queue payload ลดสิทธิ์ Analytics ได้ แต่ห้ามยกระดับเหนือ Runtime feature flag */
export function resolveYouTubeAnalyticsEnabled(input = {}) {
  const configured = readBoolean(input.configured, false);
  const requested = readBoolean(input.requested, configured);
  if (requested && !configured) {
    throw permanentError('YouTube job cannot enable Analytics while the runtime feature is disabled', {
      code: 'YOUTUBE_ANALYTICS_DISABLED',
    });
  }
  return configured && requested;
}

function readAttempts(message) {
  const attempts = Number(message?.attempts ?? 1);
  return Number.isSafeInteger(attempts) && attempts > 0 ? attempts : 1;
}

function readRetryDelaySeconds(env, message) {
  const configured = Number(env?.MKT_QUEUE_RETRY_DELAY_SECONDS);
  const base = Number.isSafeInteger(configured) && configured > 0
    ? configured
    : DEFAULT_RETRY_DELAY_SECONDS;
  return Math.min(43_200, base * Math.min(readAttempts(message), 10));
}

function readSyncJobGeneration(job, connectorName, fallbackTimestamp = null) {
  const value = job?.requestedAt ?? fallbackTimestamp;
  const instant = value instanceof Date
    ? value.getTime()
    : typeof value === 'number'
      ? value
      : Date.parse(value ?? '');
  if (!Number.isSafeInteger(instant) || instant < 0) {
    throw permanentError(`${connectorName} sync job requires a valid requestedAt generation`, {
      code: 'INVALID_SYNC_JOB_GENERATION',
      details: { fieldName: 'requestedAt', connectorName },
    });
  }
  return instant;
}

function readPositiveInteger(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw permanentError('Reliability numeric environment value must be a positive integer', {
      code: 'MKT_RELIABILITY_CONFIG_INVALID',
    });
  }
  return number;
}

function readBoolean(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw permanentError('Boolean environment value must be true or false', {
    code: 'MKT_RUNTIME_CONFIG_INVALID',
  });
}

function requireQueueName(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError(`Missing queue routing value ${fieldName}`, {
      code: 'MKT_QUEUE_ROUTING_CONFIG_INVALID',
      details: { fieldName },
    });
  }
  return value.trim();
}

function sanitizeReliabilityEvent(event) {
  return {
    stage: event?.stage ?? null,
    error: event?.error instanceof Error ? event.error.message : String(event?.error ?? ''),
    code: event?.error?.code ?? null,
  };
}

function logQueueResult(payload) {
  const normalized = {
    timestamp: new Date().toISOString(),
    scope: payload.scope ?? 'sync_worker_queue',
    ...payload,
  };
  if (Object.hasOwn(normalized, 'error')) {
    normalized.error = sanitizeOperationalText(normalized.error, { code: normalized.code });
  }
  console.log(JSON.stringify(sanitizeOperationalValue(normalized)));
}

function summarizeJobResult(result) {
  if (result === null || typeof result !== 'object') return result;
  return Object.freeze({
    syncRunId: result.syncRunId ?? null,
    platform: result.platform ?? null,
    source: result.source ?? null,
    mode: result.mode ?? null,
    readyToWrite: result.readyToWrite ?? result.ok ?? null,
    rawRecords: result.rawRecords ?? null,
    processedRawRecords: result.processedRawRecords ?? null,
    incremental: result.incremental ?? null,
    classificationRules: result.classificationRules ?? null,
    invalidClassificationRuleCount: Array.isArray(result.classificationDictionary?.invalidRows)
      ? result.classificationDictionary.invalidRows.length
      : 0,
    rawChannels: summarizeWriteResult(result.rawChannels),
    rawVideos: summarizeWriteResult(result.rawVideos),
    rawAnalytics: summarizeWriteResult(result.rawAnalytics),
    content: summarizeWriteResult(result.content ?? result.syncPlan?.content),
    dailySnapshots: summarizeWriteResult(result.dailySnapshots ?? result.syncPlan?.dailySnapshots),
    accounts: summarizeWriteResult(result.accounts),
    sourceSummary: result.sourceSummary ?? null,
    checkpointSaved: result.checkpointSaved ?? null,
    reportType: result.reportType ?? null,
    reportSettingKey: result.reportSettingKey ?? null,
    reportId: result.reportId ?? null,
    period: result.period ?? null,
    dataStatus: result.dataStatus ?? null,
    baselineCoverageRate: result.baselineCoverageRate ?? null,
    sourceSnapshotCount: result.sourceSnapshotCount ?? null,
    trackedContentCount: result.trackedContentCount ?? null,
    metricCount: result.metricCount ?? null,
    topContentLimit: result.topContentLimit ?? null,
    topContentSlotCount: result.topContentSlotCount ?? null,
    topContentCount: result.topContentCount ?? null,
    reportSnapshot: summarizeWriteResult(result.reportSnapshot),
    reportMetricValues: summarizeWriteResult(result.reportMetricValues),
    reportTopContent: summarizeWriteResult(result.reportTopContent),
    reconciliation: result.reconciliation ?? null,
    issueCount: Array.isArray(result.issues) ? result.issues.length : 0,
    warningCount: Array.isArray(result.warnings) ? result.warnings.length : 0,
    skippedRowCount: Array.isArray(result.skippedRows) ? result.skippedRows.length : 0,
    accountConflictCount: Array.isArray(result.accountConflicts) ? result.accountConflicts.length : 0,
  });
}

function summarizeWriteResult(value) {
  if (value === null || typeof value !== 'object') return null;
  return Object.freeze({
    created: value.created ?? value.createRows ?? null,
    updated: value.updated ?? value.updateRows ?? null,
    skipped: value.skipped ?? null,
    duplicateInputRows: value.duplicateInputRows ?? null,
    writeOutcome: value.writeOutcome ?? null,
  });
}
