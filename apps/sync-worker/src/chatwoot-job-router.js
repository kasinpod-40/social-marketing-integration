import {
  JOB_IMPLEMENTATION_STATUS,
  JOB_SCHEMA_VERSIONS,
  JOB_TRIGGERS,
  JOB_TYPES,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import { withQueueOperation } from '../../../packages/application/src/jobs/queue-operation.js';
import {
  CHATWOOT_RUNTIME_CONTRACT_VERSION,
  assertLockedChatwootRuntimeConfig,
  readChatwootContinuationSequence,
  resolveChatwootRuntimeMode,
  resolveChatwootRuntimeWindow,
} from '../../../packages/application/src/use-cases/chatwoot-runtime-contract.js';
import { syncChatwootDurableRuntime } from '../../../packages/application/src/use-cases/sync-chatwoot-durable-runtime.js';
import {
  CHATWOOT_LARK_TABLE_KEYS,
  readChatwootRuntimeConfig,
} from '../../../packages/config/src/chatwoot-runtime-config.js';
import { isReviewedConnectorRuntime } from '../../../packages/config/src/customer-profiles.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { ChatwootDurableApiClient } from '../../../packages/connectors/src/chatwoot/chatwoot-durable-api.client.js';
import { runReliableSync } from '../../../packages/reliability/src/reliable-sync-runner.js';
import { permanentError, transientError } from '../../../packages/shared/src/errors/runtime-error.js';
import {
  DEFAULT_LOCK_LEASE_MS,
  DEFAULT_LOCK_RENEW_INTERVAL_MS,
  logQueueResult,
  readAttempts,
  readPositiveInteger,
  requireJobText,
  sanitizeReliabilityEvent,
} from './worker-runtime-support.js';

/**
 * Chatwoot route. Every delivery processes one bounded durable unit and continuation messages
 * preserve the original Stable Queue identity for both manual and scheduled admission.
 */
export async function processChatwootAnalyticsJob(input = {}) {
  if (input.job?.body?.type !== JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC) {
    throw permanentError('Dedicated Chatwoot router received an unsupported job type', {
      code: 'CHATWOOT_JOB_TYPE_INVALID',
    });
  }

  const definition = getJobDefinition(input.job.body.type);
  const normalizedTrigger = normalizeChatwootTrigger(input.job.body.trigger);
  assertChatwootJobDefinition(definition, input.job, normalizedTrigger);
  const mode = resolveChatwootRuntimeMode(normalizedTrigger);
  const chatwootConfig = readChatwootRuntimeConfig(input.env);
  assertLockedChatwootRuntimeConfig(chatwootConfig.contract);
  const runtimeConfig = input.getRuntimeConfig();
  const connector = assertChatwootManualRuntime(runtimeConfig, chatwootConfig, normalizedTrigger);
  const operation = requireStableOperation(input.operation);
  if (input.job.body.accountKey !== connector.accountKey) {
    throw permanentError('Chatwoot Queue accountKey does not match the protected connector target', {
      code: 'CHATWOOT_QUEUE_ACCOUNT_MISMATCH',
    });
  }

  const continuationSequence = readChatwootContinuationSequence(
    input.job.body.continuationSequence,
  );
  const infrastructure = input.getInfrastructure();
  const resumableWorkStore = infrastructure.getResumableWorkStore();
  const cursorKey = `chatwoot:${connector.accountKey}:analytics`;
  const window = resolveChatwootRuntimeWindow({
    mode,
    requestedAt: operation.originalRequestedAt,
  });
  const work = await resumableWorkStore.beginWork({
    workKey: operation.workKey,
    cursorKey,
    workType: JOB_TYPES.CHATWOOT_CONVERSATIONS_SYNC,
    operationFingerprint: [
      CHATWOOT_RUNTIME_CONTRACT_VERSION,
      connector.accountKey,
      mode,
      window.startAt,
      window.endAt,
      chatwootConfig.flags.reportWrite ? 'report' : 'state',
      chatwootConfig.flags.larkWrite ? 'lark' : 'd1',
      chatwootConfig.limits.conversationPagesPerInvocation,
      chatwootConfig.limits.reportingPagesPerInvocation,
      chatwootConfig.limits.maxReportingPages,
      chatwootConfig.limits.maxMessagePagesPerConversation,
      chatwootConfig.limits.maxMessagesPerConversation,
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
  const client = new ChatwootDurableApiClient({
    baseUrl: chatwootConfig.source.baseUrl,
    accountId: chatwootConfig.source.externalAccountId,
    accessToken: chatwootConfig.source.accessToken,
    timeoutMs: chatwootConfig.source.timeoutMs,
    maxAttempts: chatwootConfig.source.maxAttempts,
    maxPages: chatwootConfig.source.maxPages,
    maxRows: chatwootConfig.source.maxRows,
    maxResponseBytes: chatwootConfig.source.maxResponseBytes,
    maxReportingPages: chatwootConfig.limits.maxReportingPages,
  });
  const reliability = infrastructure.getReliability();
  const deterministicSyncRunId = `chatwoot:${connector.accountKey}:${operation.operationId}`;
  const unitSyncRunId = `${deterministicSyncRunId}:unit:${continuationSequence}`;

  const syncResult = await runReliableSync({
    syncRunId: unitSyncRunId,
    store: reliability.store,
    lockManager: reliability.lockManager,
    customerProfile: runtimeConfig.profileKey,
    accountKey: connector.accountKey,
    platform: 'chatwoot',
    source: 'chatwoot_application_api',
    syncType: `${mode}_unit`,
    // Each continuation is a new Queue delivery; retry count must not grow with completed units.
    retryCount: Math.max(0, readAttempts(input.message) - 1),
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
    execute: async ({ assertLockActive }) => {
      const assertCurrent = async () => {
        await assertLockActive();
        await resumableWorkStore.assertCurrentGeneration({
          workKey: operation.workKey,
          cursorKey,
          generation: operation.generation,
        });
      };
      return syncChatwootDurableRuntime({
        mode,
        continuationSequence,
        requestedAt: operation.originalRequestedAt,
        generation: operation.generation,
        workKey: operation.workKey,
        cursorKey,
        syncRunId: deterministicSyncRunId,
        customerProfile: runtimeConfig.profileKey,
        customerKey: requireJobText(runtimeConfig.customerKey, 'runtimeConfig.customerKey'),
        accountKey: connector.accountKey,
        externalAccountId: chatwootConfig.source.externalAccountId,
        reportingTimezone: chatwootConfig.reportingTimezone,
        limits: resolveChatwootExecutionLimits(chatwootConfig.limits, input.env),
        flags: {
          reportWrite: chatwootConfig.flags.reportWrite,
          larkWrite: chatwootConfig.flags.larkWrite,
        },
        client,
        chatwootStore: infrastructure.getChatwootAnalyticsStore(),
        coverageStore: infrastructure.getMarketingHistoryStore(),
        incrementalStateStore: infrastructure.getIncrementalStateStore(),
        workStore: resumableWorkStore,
        ...(chatwootConfig.flags.reportWrite
          ? { rollupSource: infrastructure.getChatwootDailyRollupSource() }
          : {}),
        ...(chatwootConfig.flags.larkWrite ? {
          repository: infrastructure.repository,
          syncEngine: infrastructure.syncEngine,
          tables: tableIds,
        } : {}),
        assertCurrent,
      });
    },
  });
  const result = Object.freeze({
    ...syncResult,
    syncRunId: deterministicSyncRunId,
  });

  if (result.complete === true) {
    await resumableWorkStore.completeWork({
      workKey: operation.workKey,
      completion: {
        status: result.status,
        syncRunId: result.syncRunId,
        accountKey: connector.accountKey,
        reconciliation: result.reconciliation,
      },
    });
    await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
    return result;
  }

  if (result.needsContinuation === true) {
    await enqueueChatwootContinuation({
      env: input.env,
      body: input.job.body,
      operation,
      trigger: normalizedTrigger,
      nextSequence: result.nextSequence,
    });
    return Object.freeze({ ...result, continuationEnqueued: true });
  }
  return result;
}

export function assertChatwootManualRuntime(runtimeConfig, chatwootConfig, trigger = null) {
  if (!isReviewedConnectorRuntime(runtimeConfig)) {
    throw permanentError('Chatwoot runtime requires the reviewed Integration or customer Production ownership tuple', {
      code: 'CHATWOOT_MANUAL_UAT_TARGET_INVALID',
    });
  }
  const connector = assertConnectorRunnable(runtimeConfig, 'chatwoot');
  if (!connector
    || connector.accountKey !== 'chemistry_k'
    || connector.enabled !== true) {
    throw permanentError('Chatwoot connector is disabled or outside the Integration runtime', {
      code: 'CHATWOOT_MANUAL_UAT_CONNECTOR_INVALID',
    });
  }
  const scheduled = trigger === JOB_TRIGGERS.CHATWOOT_SCHEDULED_DAILY;
  const missingFlags = [];
  if (chatwootConfig?.flags?.connector !== true) missingFlags.push('MKT_CONNECTOR_CHATWOOT_ENABLED');
  if (chatwootConfig?.flags?.d1Write !== true) missingFlags.push('MKT_CHATWOOT_D1_WRITE_ENABLED');
  if (scheduled && chatwootConfig?.flags?.schedule !== true) missingFlags.push('MKT_SCHEDULE_CHATWOOT_ENABLED');
  if (!scheduled && chatwootConfig?.flags?.schedule === true) missingFlags.push('MKT_SCHEDULE_CHATWOOT_ENABLED=false');
  if (chatwootConfig?.flags?.webhook === true) missingFlags.push('MKT_CHATWOOT_WEBHOOK_ENABLED=false');
  if (missingFlags.length > 0) {
    throw permanentError('Chatwoot manual UAT gates are disabled or unsafe', {
      code: 'CHATWOOT_PROCESSING_GATES_DISABLED',
      details: { missingFlags },
    });
  }
  return connector;
}

/**
 * Apply a deploy-specific execution cap without changing the durable operation fingerprint.
 * This lets an existing same-generation Work use smaller Free-plan units while the reviewed
 * contract limits retained in D1 remain unchanged.
 */
export function resolveChatwootExecutionLimits(limits = {}, env = {}) {
  const configuredRows = readPositiveInteger(limits.conversationRowsPerInvocation, 1);
  const configuredReportingPages = readPositiveInteger(limits.reportingPagesPerInvocation, 1);
  return Object.freeze({
    ...limits,
    conversationRowsPerInvocation: Math.min(
      configuredRows,
      readPositiveInteger(
        env.MKT_CHATWOOT_EXECUTION_CONVERSATION_ROWS_PER_INVOCATION,
        configuredRows,
      ),
    ),
    reportingPagesPerInvocation: Math.min(
      configuredReportingPages,
      readPositiveInteger(
        env.MKT_CHATWOOT_EXECUTION_REPORTING_PAGES_PER_INVOCATION,
        configuredReportingPages,
      ),
    ),
  });
}

function assertChatwootJobDefinition(definition, job, trigger) {
  const body = job?.body;
  if (definition?.connectorKey !== 'chatwoot'
    || definition?.implementationStatus !== JOB_IMPLEMENTATION_STATUS.ACTIVE
    || definition?.manualOnly === true) {
    throw permanentError('Chatwoot Queue job is not registered as active', {
      code: 'CHATWOOT_JOB_UNSUPPORTED',
    });
  }
  if (Number(job?.schemaVersion ?? body?.schemaVersion ?? 1) !== JOB_SCHEMA_VERSIONS.CHATWOOT_RUNTIME) {
    throw permanentError('Chatwoot Queue schema version is unsupported', {
      code: 'INVALID_SYNC_JOB_SCHEMA_VERSION',
    });
  }
  if (!definition.allowedTriggers.includes(trigger)) {
    throw permanentError('Chatwoot job trigger is outside the locked runtime contract', {
      code: 'CHATWOOT_MANUAL_ONLY',
      details: { trigger: body?.trigger ?? null },
    });
  }
  if (body?.dryRun === true) {
    throw permanentError('Chatwoot Provider preflight remains a separate operator gate', {
      code: 'CHATWOOT_DRY_RUN_UNSUPPORTED',
    });
  }
  requireJobText(body?.accountKey, 'job.body.accountKey');
}

function normalizeChatwootTrigger(trigger) {
  // Backward-compatible repository tests/manual payloads map to the locked 30-day mode.
  if (trigger === JOB_TRIGGERS.CHATWOOT_LEGACY_MANUAL_UAT) {
    return JOB_TRIGGERS.CHATWOOT_INITIAL_30_DAY_UAT;
  }
  return trigger;
}

async function enqueueChatwootContinuation(input) {
  const queue = input.env?.MKT_SYNC_QUEUE;
  if (typeof queue?.send !== 'function') {
    throw transientError('Chatwoot continuation requires Queue producer binding', {
      code: 'CHATWOOT_CONTINUATION_QUEUE_UNAVAILABLE',
    });
  }
  const body = withQueueOperation({
    ...input.body,
    schemaVersion: JOB_SCHEMA_VERSIONS.CHATWOOT_RUNTIME,
    trigger: input.trigger,
    continuationSequence: input.nextSequence,
  }, input.operation);
  await queue.send(body);
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
