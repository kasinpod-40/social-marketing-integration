import {
  JOB_IMPLEMENTATION_STATUS,
  JOB_TYPES,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { syncChatwootAnalytics } from '../../../packages/application/src/use-cases/sync-chatwoot-analytics.js';
import {
  CHATWOOT_LARK_TABLE_KEYS,
  readChatwootRuntimeConfig,
} from '../../../packages/config/src/chatwoot-runtime-config.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { ChatwootApiClient } from '../../../packages/connectors/src/chatwoot/chatwoot-api.client.js';
import { runReliableSync } from '../../../packages/reliability/src/reliable-sync-runner.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import {
  DEFAULT_LOCK_LEASE_MS,
  DEFAULT_LOCK_RENEW_INTERVAL_MS,
  logQueueResult,
  readAttempts,
  readPositiveInteger,
  requireJobText,
  sanitizeReliabilityEvent,
} from './worker-runtime-support.js';

/** Protected, manual-only Chatwoot route. No producer, schedule or webhook path is added. */
export async function processChatwootAnalyticsJob(input = {}) {
  if (input.job?.body?.type !== JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC) {
    throw permanentError('Dedicated Chatwoot router received an unsupported job type', {
      code: 'CHATWOOT_JOB_TYPE_INVALID',
    });
  }

  const definition = getJobDefinition(input.job.body.type);
  assertChatwootJobDefinition(definition, input.job.body);
  const chatwootConfig = readChatwootRuntimeConfig(input.env);
  const runtimeConfig = input.getRuntimeConfig();
  const connector = assertChatwootManualRuntime(runtimeConfig, chatwootConfig);
  const operation = requireStableOperation(input.operation);
  if (input.job.body.accountKey !== connector.accountKey) {
    throw permanentError('Chatwoot Queue accountKey does not match the protected connector target', {
      code: 'CHATWOOT_QUEUE_ACCOUNT_MISMATCH',
    });
  }

  const fullSnapshot = input.job.body.fullSnapshot === true;
  if (chatwootConfig.flags.reportWrite && !fullSnapshot) {
    throw permanentError('Chatwoot report writes require fullSnapshot=true', {
      code: 'CHATWOOT_REPORT_REQUIRES_FULL_SNAPSHOT',
    });
  }

  const infrastructure = input.getInfrastructure();
  const resumableWorkStore = infrastructure.getResumableWorkStore();
  const cursorKey = `chatwoot:${connector.accountKey}:analytics`;
  const work = await resumableWorkStore.beginWork({
    workKey: operation.workKey,
    cursorKey,
    workType: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC,
    operationFingerprint: [
      'chatwoot_analytics_v1',
      connector.accountKey,
      fullSnapshot ? 'full' : 'incremental',
      chatwootConfig.flags.reportWrite ? 'report' : 'state',
      chatwootConfig.flags.larkWrite ? 'lark' : 'd1',
    ].join(':'),
    generation: operation.generation,
    requestedAt: operation.originalRequestedAt,
  });
  if (work.completed) return work.completion;
  if (work.superseded) {
    throw permanentError('Chatwoot work was superseded before Provider access', {
      code: 'SYNC_WORK_SUPERSEDED',
      details: { generation: operation.generation },
    });
  }

  const tableIds = chatwootConfig.flags.larkWrite
    ? readLarkTableIdsFromEnv(input.env, CHATWOOT_LARK_TABLE_KEYS)
    : null;
  const client = new ChatwootApiClient({
    baseUrl: chatwootConfig.source.baseUrl,
    accountId: chatwootConfig.source.externalAccountId,
    accessToken: chatwootConfig.source.accessToken,
    timeoutMs: chatwootConfig.source.timeoutMs,
    maxAttempts: chatwootConfig.source.maxAttempts,
    maxPages: chatwootConfig.source.maxPages,
    maxRows: chatwootConfig.source.maxRows,
    maxResponseBytes: chatwootConfig.source.maxResponseBytes,
  });
  const reliability = infrastructure.getReliability();
  const deterministicSyncRunId = `chatwoot:${connector.accountKey}:${operation.operationId}`;

  const result = await runReliableSync({
    syncRunId: deterministicSyncRunId,
    store: reliability.store,
    lockManager: reliability.lockManager,
    customerProfile: runtimeConfig.profileKey,
    accountKey: connector.accountKey,
    platform: 'chatwoot',
    source: 'chatwoot_application_api',
    syncType: fullSnapshot ? 'conversations_full_snapshot' : 'conversations_incremental',
    retryCount: Math.max(0, Number(input.mainQueueAttempts ?? readAttempts(input.message)) - 1),
    leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
    renewIntervalMs: readPositiveInteger(
      input.env?.MKT_SYNC_LOCK_RENEW_INTERVAL_MS,
      DEFAULT_LOCK_RENEW_INTERVAL_MS,
    ),
    alertOnRetryableFailure: false,
    onReliabilityError: (event) => logQueueResult({
      ok: false,
      scope: 'chatwoot_reliability',
      ...sanitizeReliabilityEvent(event),
    }),
    execute: async ({ syncRunId, assertLockActive }) => {
      const assertCurrent = async () => {
        await assertLockActive();
        await resumableWorkStore.assertCurrentGeneration({
          workKey: operation.workKey,
          cursorKey,
          generation: operation.generation,
        });
      };
      const syncResult = await syncChatwootAnalytics({
        customerProfile: runtimeConfig.profileKey,
        customerKey: requireJobText(runtimeConfig.customerKey, 'runtimeConfig.customerKey'),
        accountKey: connector.accountKey,
        externalAccountId: chatwootConfig.source.externalAccountId,
        reportingTimezone: chatwootConfig.reportingTimezone,
        syncRunId,
        coverageRunIdPrefix: syncRunId,
        observedAt: operation.originalRequestedAt,
        cursorKey,
        fullSnapshot,
        connectorEnabled: chatwootConfig.flags.connector,
        d1WriteEnabled: chatwootConfig.flags.d1Write,
        larkWriteEnabled: chatwootConfig.flags.larkWrite,
        reportWriteEnabled: chatwootConfig.flags.reportWrite,
        checkpointWriteEnabled: true,
        webhookEnabled: chatwootConfig.flags.webhook,
        incrementalOverlapHours: chatwootConfig.limits.incrementalOverlapHours,
        maxConversations: chatwootConfig.limits.maxConversations,
        maxContacts: chatwootConfig.limits.maxContacts,
        maxReportingEvents: chatwootConfig.limits.maxReportingEvents,
        maxMessagePagesPerConversation: chatwootConfig.limits.maxMessagePagesPerConversation,
        maxMessagesPerConversation: chatwootConfig.limits.maxMessagesPerConversation,
        client,
        chatwootStore: infrastructure.getChatwootAnalyticsStore(),
        coverageStore: infrastructure.getMarketingHistoryStore(),
        incrementalStateStore: infrastructure.getIncrementalStateStore(),
        ...(chatwootConfig.flags.larkWrite ? {
          repository: infrastructure.repository,
          syncEngine: infrastructure.syncEngine,
          tables: tableIds,
        } : {}),
        generationGuard: {
          cursorKey,
          generation: operation.generation,
          workKey: operation.workKey,
          requestedAt: operation.originalRequestedAt,
        },
        assertLockActive: assertCurrent,
      });
      await resumableWorkStore.completeWork({
        workKey: operation.workKey,
        completion: {
          status: syncResult.status,
          syncRunId,
          accountKey: connector.accountKey,
          reconciliation: syncResult.reconciliation,
        },
      });
      return syncResult;
    },
  });

  await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
  return result;
}

export function assertChatwootManualRuntime(runtimeConfig, chatwootConfig) {
  if (runtimeConfig?.environment !== 'development'
    || runtimeConfig?.profileKey !== 'integration_workspace'
    || runtimeConfig?.infrastructureOwner !== 'developer'
    || runtimeConfig?.customerKey !== 'chemistry_k') {
    throw permanentError('Chatwoot manual UAT requires the developer-owned Integration Workspace', {
      code: 'CHATWOOT_MANUAL_UAT_TARGET_INVALID',
    });
  }
  const connector = runtimeConfig?.connectors?.chatwoot;
  if (!connector
    || connector.accountKey !== 'chemistry_k'
    || connector.enabled !== true
    || connector.protectedUatRuntime !== true) {
    throw permanentError('Chatwoot connector is disabled or outside the protected UAT runtime', {
      code: 'CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID',
    });
  }
  const missingFlags = [];
  if (chatwootConfig?.flags?.connector !== true) missingFlags.push('MKT_CONNECTOR_CHATWOOT_ENABLED');
  if (chatwootConfig?.flags?.d1Write !== true) missingFlags.push('MKT_CHATWOOT_D1_WRITE_ENABLED');
  if (chatwootConfig?.flags?.schedule === true) missingFlags.push('MKT_SCHEDULE_CHATWOOT_ENABLED=false');
  if (chatwootConfig?.flags?.webhook === true) missingFlags.push('MKT_CHATWOOT_WEBHOOK_ENABLED=false');
  if (missingFlags.length > 0) {
    throw permanentError('Chatwoot manual UAT gates are disabled or unsafe', {
      code: 'CHATWOOT_PROCESSING_GATES_DISABLED',
      details: { missingFlags },
    });
  }
  return connector;
}

function assertChatwootJobDefinition(definition, body) {
  if (definition?.connectorKey !== 'chatwoot'
    || definition?.implementationStatus !== JOB_IMPLEMENTATION_STATUS.UAT_PENDING
    || definition?.manualOnly !== true) {
    throw permanentError('Chatwoot Queue job is not registered as protected manual UAT', {
      code: 'CHATWOOT_JOB_UNSUPPORTED',
    });
  }
  if (body?.trigger !== 'manual_uat') {
    throw permanentError('Chatwoot jobs accept manual_uat trigger only', {
      code: 'CHATWOOT_MANUAL_ONLY',
    });
  }
  if (body?.dryRun === true) {
    throw permanentError('Chatwoot credential preflight is a separate operator gate', {
      code: 'CHATWOOT_DRY_RUN_UNSUPPORTED',
    });
  }
  requireJobText(body?.accountKey, 'job.body.accountKey');
}

function requireStableOperation(value) {
  if (!value?.stable
    || typeof value.operationId !== 'string'
    || typeof value.workKey !== 'string'
    || !Number.isSafeInteger(value.generation)
    || !Number.isSafeInteger(value.originalRequestedAt)) {
    throw permanentError('Chatwoot manual UAT requires stable Queue operation metadata', {
      code: 'CHATWOOT_QUEUE_OPERATION_REQUIRED',
    });
  }
  return value;
}
