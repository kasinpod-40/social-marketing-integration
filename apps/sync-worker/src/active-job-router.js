import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  JOB_TRIGGERS,
  JOB_TYPES,
  assertJobImplemented,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { generateTikTokOrganicReport } from '../../../packages/application/src/use-cases/generate-tiktok-organic-report.js';
import {
  DEFAULT_REPORT_MAX_CONTENT_RECORDS,
  DEFAULT_REPORT_MAX_FALLBACK_SCAN_RECORDS,
  DEFAULT_REPORT_MAX_PAGES_PER_QUERY,
  DEFAULT_REPORT_MAX_SNAPSHOT_RECORDS,
  DEFAULT_REPORT_SOURCE_PAGE_SIZE,
} from '../../../packages/application/src/reports/load-tiktok-organic-report-source.js';
import { deliverReliabilityMirror } from '../../../packages/application/src/use-cases/deliver-reliability-mirror.js';
import { redriveDeadLetterJob } from '../../../packages/application/src/use-cases/redrive-dead-letter-job.js';
import { seedMetricDefinitions } from '../../../packages/application/src/use-cases/seed-metric-definitions.js';
import {
  CUSTOMER_WEEKLY_NOTIFICATION_SETTINGS_ACTIVATION_VERSION,
  seedCustomerWeeklyNotificationReportSettings,
  seedReportSettings,
} from '../../../packages/application/src/use-cases/seed-report-settings.js';
import { runMktContentDailyRetention } from '../../../packages/application/src/use-cases/mkt-content-daily-retention.js';
import {
  applyCustomerLarkViewFieldOrder,
  applyCustomerLarkViewHygiene,
} from '../../../packages/application/src/use-cases/apply-customer-lark-view-hygiene.js';
import { syncTikTokCreatorNativeToLark } from '../../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { syncYouTubeOrganicEndToEnd } from '../../../packages/application/src/use-cases/sync-youtube-organic-end-to-end.js';
import { validateLarkLiveSync } from '../../../packages/application/src/use-cases/validate-lark-live-sync.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { readStorageRuntimeConfig } from '../../../packages/config/src/storage-runtime-config.js';
import { readLarkNotificationRuntimeConfig } from '../../../packages/config/src/lark-notification-runtime-config.js';
import {
  readYouTubeChannelIdFromEnv,
  readYouTubeLarkTableIdsFromEnv,
} from '../../../packages/config/src/youtube-organic-runtime-config.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';
import {
  drainPendingSyncWarnings,
  runReliableSync,
} from '../../../packages/reliability/src/reliable-sync-runner.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { resolveYouTubeAnalyticsEnabled } from './scheduled-jobs.js';
import { resolveConnectorRunMode } from './connector-run-mode.js';
import { createYouTubeRuntimeClients } from './youtube-runtime-clients.js';
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
import {
  enqueueTikTokSyncContinuation,
  resolveTikTokSyncInvocation,
} from './tiktok-sync-continuation.js';

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

  if (definition.type === JOB_TYPES.RELIABILITY_MIRROR_DELIVER) {
    const infrastructure = input.getInfrastructure();
    return deliverReliabilityMirror({
      outbox: infrastructure.getReliabilityMirrorOutbox(),
      getMirror: () => {
        const tableIds = readLarkTableIdsFromEnv(input.env, ['mktSyncLog', 'mktSystemAlerts']);
        return infrastructure.getLarkReliabilityStore(tableIds);
      },
      limit: readPositiveInteger(input.env?.MKT_RELIABILITY_MIRROR_BATCH_SIZE, 25),
    });
  }

  if (definition.type === JOB_TYPES.MKT_CONTENT_DAILY_RETENTION) {
    const storage = readStorageRuntimeConfig(input.env);
    if (!storage.larkDailyRetentionEnabled) {
      throw permanentError('MKT_Content_Daily retention is disabled', {
        code: 'MKT_CONTENT_DAILY_RETENTION_DISABLED',
      });
    }
    const infrastructure = input.getInfrastructure();
    const tableIds = readLarkTableIdsFromEnv(input.env, ['mktContentDaily']);
    return runMktContentDailyRetention({
      client: infrastructure.getLarkBitableClient(),
      db: infrastructure.getStateDb(),
      tableId: tableIds.mktContentDaily,
      deferredPlatforms: input.job.body?.deferredPlatforms ?? [],
    });
  }

  if ([JOB_TYPES.LARK_BASE_VIEW_HYGIENE, JOB_TYPES.LARK_BASE_VIEW_FIELD_ORDER].includes(definition.type)) {
    const runtimeConfig = input.getRuntimeConfig();
    const exactCustomerRuntime = runtimeConfig.environment === 'production'
      && runtimeConfig.profileKey === 'chemistry_k'
      && runtimeConfig.customerKey === 'chemistry_k'
      && runtimeConfig.infrastructureOwner === 'customer';
    if (!exactCustomerRuntime) {
      throw permanentError('Customer Lark View hygiene is Production-customer only', {
        code: 'CUSTOMER_LARK_VIEW_HYGIENE_FORBIDDEN',
      });
    }
    if (definition.type === JOB_TYPES.LARK_BASE_VIEW_FIELD_ORDER) {
      if (!readBoolean(input.env?.MKT_CUSTOMER_LARK_VIEW_FIELD_ORDER_ENABLED, false)
        || input.job.body?.trigger !== JOB_TRIGGERS.CUSTOMER_LARK_FIELD_ORDER) {
        throw permanentError('Customer Lark View field order is disabled', {
          code: 'CUSTOMER_LARK_VIEW_FIELD_ORDER_DISABLED',
        });
      }
      return applyCustomerLarkViewFieldOrder({
        client: input.getInfrastructure().getLarkBitableClient(),
        scope: input.job.body?.scope,
        allowedScopeHashes: input.env?.MKT_CUSTOMER_LARK_VIEW_FIELD_ORDER_SCOPE_SHA256S,
      });
    }
    if (!readBoolean(input.env?.MKT_CUSTOMER_LARK_VIEW_HYGIENE_ENABLED, false)
      || input.job.body?.trigger !== JOB_TRIGGERS.CUSTOMER_LARK_EMPTY_FIELDS) {
      throw permanentError('Customer Lark View hygiene is disabled', {
        code: 'CUSTOMER_LARK_VIEW_HYGIENE_DISABLED',
      });
    }
    return applyCustomerLarkViewHygiene({
      client: input.getInfrastructure().getLarkBitableClient(),
      scope: input.job.body?.scope,
      allowedScopeHashes: input.env?.MKT_CUSTOMER_LARK_VIEW_HYGIENE_SCOPE_SHA256S,
    });
  }

  const runtimeConfig = input.getRuntimeConfig();
  const connectorConfig = definition.connectorKey
    ? assertConnectorRunnable(runtimeConfig, definition.connectorKey, {
      runMode: resolveConnectorRunMode({
        runtimeConfig,
        connectorKey: definition.connectorKey,
        trigger: input.job?.body?.trigger,
        env: input.env,
      }),
    })
    : null;
  const infrastructure = input.getInfrastructure();

  if (definition.type === JOB_TYPES.YOUTUBE_ORGANIC_SYNC) {
    // ต้องตรวจ Schema/Table IDs ก่อนสร้าง YouTube client เพื่อไม่เสีย Quota โดยไม่จำเป็น
    const youtubeTableIds = readYouTubeLarkTableIdsFromEnv(input.env);
    const operationalTableIds = readLarkTableIdsFromEnv(input.env, ['mktSyncLog', 'mktSystemAlerts']);
    const tableIds = Object.freeze({ ...youtubeTableIds, ...operationalTableIds });
    const reliability = infrastructure.getReliability(tableIds);
    const analyticsEnabled = resolveYouTubeAnalyticsEnabled({
      configured: input.env?.MKT_YOUTUBE_ANALYTICS_ENABLED,
      requested: input.job.body?.analyticsEnabled,
    });
    const channelId = readYouTubeChannelIdFromEnv(input.env);
    const clients = await (input.dependencies?.createYouTubeRuntimeClients
      ?? createYouTubeRuntimeClients)(input.env, {
      publicApiKeyOnly: false,
      analyticsEnabled,
      customerKey: runtimeConfig.customerKey,
      channelId,
    });
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
      execute: ({ syncRunId, lockKey, assertLockActive }) => {
        const historyGateway = infrastructure.getOrganicHistoryGateway();
        return syncYouTubeOrganicEndToEnd({
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
        customerKey: runtimeConfig.customerKey,
        cursorKey: lockKey,
        // Production UAT ต้อง Resume ข้าม delivery/message ใหม่ได้ ส่วน Scheduled ปกติยังคง
        // message-scoped identity เพื่อไม่เปลี่ยนพฤติกรรม Production ที่ผ่านการตรวจแล้ว.
        workKey: resolveYouTubeActiveWorkKey(input),
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
        d1WriteEnabled: readBoolean(input.env?.MKT_TIME_SERIES_D1_WRITE_ENABLED, false),
        larkWriteEnabled: readBoolean(input.env?.MKT_YOUTUBE_LARK_WRITE_ENABLED, false),
        dryRun: input.job.body?.dryRun === true,
        tables: {
          mktAccounts: tableIds.mktAccounts,
          mktContent: tableIds.mktContent,
          mktContentDaily: tableIds.mktContentDaily,
        },
      });
      },
    });
    // Cleanup หลัง Reliability runner ปล่อย distributed lock แล้วเท่านั้น
    // เพื่อไม่ให้ retention sweep แข่งกับ active/retryable work ของ cursor เดียวกัน
    await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
    return result;
  }

  if (definition.type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC) {
    const tableIds = readLarkTableIdsFromEnv(input.env, [
      'rawTikTokCreatorVideos',
      'mktAccounts',
      'mktContent',
      'mktContentDaily',
      'mktClassificationDictionary',
      'mktSyncLog',
      'mktSystemAlerts',
    ]);
    const reliability = infrastructure.getReliability(tableIds);
    const resumableWorkStore = infrastructure.getResumableWorkStore();
    const invocation = resolveTikTokSyncInvocation(input);
    const requestedAt = invocation.requestedAt;
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
        workKey: invocation.workKey,
        requestedAt,
        generation: invocation.generation,
        continuationSequence: invocation.continuationSequence,
        resumableWorkStore,
        sourcePageSize: readPositiveInteger(
          input.env?.MKT_TIKTOK_SOURCE_PAGE_SIZE,
          DEFAULT_TIKTOK_SOURCE_PAGE_SIZE,
        ),
        sourceMaxPages: readPositiveInteger(
          input.env?.MKT_TIKTOK_SOURCE_MAX_PAGES ?? input.env?.LARK_MAX_PAGES,
          DEFAULT_TIKTOK_SOURCE_MAX_PAGES,
        ),
        ...(invocation.operation ? {
          maxSourcePagesPerInvocation: invocation.maxSourcePagesPerInvocation,
          maxBusinessUnitsPerInvocation: invocation.maxBusinessUnitsPerInvocation,
        } : {}),
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
          mktAccounts: tableIds.mktAccounts,
          mktContent: tableIds.mktContent,
          mktContentDaily: tableIds.mktContentDaily,
          mktClassificationDictionary: tableIds.mktClassificationDictionary,
        },
      }),
    });
    if (result.continuationRequired === true) {
      await enqueueTikTokSyncContinuation({
        env: input.env,
        originalBody: input.job.body,
        operation: invocation.operation,
        result,
      });
    }
    await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
    return result;
  }

  if (definition.type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_VALIDATE) {
    const tableIds = readLarkTableIdsFromEnv(input.env, [
      'rawTikTokCreatorVideos',
      'mktAccounts',
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
        mktAccounts: tableIds.mktAccounts,
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
    if (input.job.body?.notificationRuntimeActivation === true) {
      assertCustomerWeeklyNotificationSettingsActivation(input, runtimeConfig);
      return seedCustomerWeeklyNotificationReportSettings({
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        tableId: tableIds.mktReportSettings,
        profileKey: runtimeConfig.profileKey,
      });
    }
    return seedReportSettings({
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      tableId: tableIds.mktReportSettings,
      profileKey: runtimeConfig.profileKey,
    });
  }

  if (definition.type === JOB_TYPES.DAILY_REPORT_GENERATE
    || definition.type === JOB_TYPES.WEEKLY_REPORT_GENERATE
    || definition.type === JOB_TYPES.REPORT_MATERIALIZATION_GENERATE) {
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
    const reportType = definition.type === JOB_TYPES.REPORT_MATERIALIZATION_GENERATE
      ? 'dashboard_performance_report'
      : definition.type === JOB_TYPES.WEEKLY_REPORT_GENERATE
        ? 'weekly_organic_report'
        : 'daily_organic_report';
    const defaultSettingKey = definition.type === JOB_TYPES.WEEKLY_REPORT_GENERATE
      ? input.env?.MKT_WEEKLY_REPORT_SETTING_KEY
      : input.env?.MKT_DAILY_REPORT_SETTING_KEY;
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
  }

  throw permanentError(`Active sync job has no runtime handler: ${definition.type}`, {
    code: 'SYNC_JOB_HANDLER_MISSING',
    details: { type: definition.type },
  });
}

function assertCustomerWeeklyNotificationSettingsActivation(input, runtimeConfig) {
  const body = input.job?.body ?? {};
  const exactCustomerRuntime = runtimeConfig.environment === 'production'
    && runtimeConfig.profileKey === 'chemistry_k'
    && runtimeConfig.customerKey === 'chemistry_k'
    && runtimeConfig.infrastructureOwner === 'customer';
  if (!exactCustomerRuntime) {
    throw permanentError('Customer Weekly Notification settings activation is Production-customer only', {
      code: 'CUSTOMER_NOTIFICATION_SETTINGS_ACTIVATION_FORBIDDEN',
    });
  }
  if (body.trigger !== JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME
    || body.activationVersion !== CUSTOMER_WEEKLY_NOTIFICATION_SETTINGS_ACTIVATION_VERSION) {
    throw permanentError('Customer Weekly Notification settings activation identity is invalid', {
      code: 'CUSTOMER_NOTIFICATION_SETTINGS_ACTIVATION_INVALID',
    });
  }
  for (const fieldName of [
    'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
    'MKT_SCHEDULE_WEEKLY_NOTIFICATION_ENABLED',
    'MKT_REPORT_D1_READ_ENABLED',
    'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
    'MKT_NOTIFICATION_RUNTIME_ENABLED',
    'MKT_NOTIFICATION_LARK_SEND_ENABLED',
    'MKT_NOTIFICATION_LARK_MIRROR_ENABLED',
  ]) {
    if (!readBoolean(input.env?.[fieldName], false)) {
      throw permanentError('Customer Weekly Notification settings activation runtime is not ready', {
        code: 'CUSTOMER_NOTIFICATION_SETTINGS_ACTIVATION_DISABLED',
        details: { fieldName },
      });
    }
  }
  const notification = readLarkNotificationRuntimeConfig(input.env);
  if (notification.mode !== 'runtime' || notification.customerProfile !== 'chemistry_k') {
    throw permanentError('Customer Weekly Notification runtime authority is invalid', {
      code: 'CUSTOMER_NOTIFICATION_SETTINGS_ACTIVATION_INVALID',
    });
  }
}

export { resolveConnectorRunMode } from './connector-run-mode.js';

export function resolveYouTubeActiveWorkKey(input = {}) {
  if (input.job?.body?.trigger !== JOB_TRIGGERS.PRODUCTION_CONNECTOR_UAT) {
    return `youtube:${requireJobText(input.message?.id, 'message.id')}`;
  }

  const operationId = requireJobText(input.operation?.operationId, 'operation.operationId');
  const expectedWorkKey = `youtube:${operationId}`;
  if (input.operation?.stable !== true || input.operation?.workKey !== expectedWorkKey) {
    throw permanentError('Controlled YouTube Production UAT requires stable Queue identity', {
      code: 'YOUTUBE_PRODUCTION_UAT_OPERATION_INVALID',
      details: { operationId },
    });
  }
  return expectedWorkKey;
}
