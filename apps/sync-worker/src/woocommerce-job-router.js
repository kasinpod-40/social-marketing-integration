import {
  JOB_IMPLEMENTATION_STATUS,
  JOB_TYPES,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { withQueueOperation } from '../../../packages/application/src/jobs/queue-operation.js';
import { syncWooCommerceCommerce } from '../../../packages/application/src/use-cases/sync-woocommerce-commerce.js';
import {
  WOOCOMMERCE_LARK_TABLE_KEYS,
  readWooCommerceRuntimeConfig,
} from '../../../packages/config/src/woocommerce-runtime-config.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { WooCommerceRestClient } from '../../../packages/connectors/src/woocommerce/woocommerce-rest-client.js';
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
 * Protected manual Integration Workspace route.
 * การ Wiring นี้ไม่สร้าง Producer หรือ Schedule และจะ Fail ก่อน Provider เมื่อ Gate ใดปิด.
 */
export async function processWooCommerceCommerceJob(input = {}) {
  if (input.job?.body?.type !== JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC) {
    throw permanentError('Dedicated WooCommerce router received an unsupported job type', {
      code: 'WOOCOMMERCE_JOB_TYPE_INVALID',
    });
  }

  const definition = getJobDefinition(input.job.body.type);
  assertWooCommerceJobDefinition(definition, input.job.body);
  const wooConfig = readWooCommerceRuntimeConfig(input.env);
  const runtimeConfig = input.getRuntimeConfig();
  const connector = assertWooCommerceManualRuntime(runtimeConfig, wooConfig);
  const operation = requireStableOperation(input.operation);
  const fullReconciliation = input.job.body?.fullReconciliation === true;
  if (fullReconciliation && !wooConfig.flags.fullReconciliation) {
    throw permanentError('WooCommerce full reconciliation gate is disabled', {
      code: 'WOOCOMMERCE_FULL_RECONCILIATION_DISABLED',
    });
  }

  const infrastructure = input.getInfrastructure();
  const tableIds = readLarkTableIdsFromEnv(input.env, WOOCOMMERCE_LARK_TABLE_KEYS);
  const client = new WooCommerceRestClient({
    baseUrl: wooConfig.source.baseUrl,
    consumerKey: wooConfig.source.consumerKey,
    consumerSecret: wooConfig.source.consumerSecret,
    apiVersion: wooConfig.source.apiVersion,
    pageSize: wooConfig.limits.pageSize,
    timeoutMs: wooConfig.source.timeoutMs,
  });
  const reliability = infrastructure.getReliability();
  const resumableWorkStore = infrastructure.getResumableWorkStore();
  const deterministicSyncRunId = `woocommerce:${operation.operationId}`;

  const result = await runReliableSync({
    syncRunId: deterministicSyncRunId,
    store: reliability.store,
    lockManager: reliability.lockManager,
    customerProfile: runtimeConfig.profileKey,
    accountKey: connector.accountKey,
    platform: 'woocommerce',
    source: 'woocommerce_rest_api',
    syncType: fullReconciliation ? 'commerce_full_reconciliation' : 'commerce_incremental',
    retryCount: Math.max(0, Number(input.mainQueueAttempts ?? readAttempts(input.message)) - 1),
    leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
    renewIntervalMs: readPositiveInteger(
      input.env?.MKT_SYNC_LOCK_RENEW_INTERVAL_MS,
      DEFAULT_LOCK_RENEW_INTERVAL_MS,
    ),
    alertOnRetryableFailure: false,
    onReliabilityError: (event) => logQueueResult({
      ok: false,
      scope: 'woocommerce_reliability',
      ...sanitizeReliabilityEvent(event),
    }),
    execute: ({ syncRunId, lockKey, assertLockActive }) => syncWooCommerceCommerce({
      type: definition.type,
      workKey: operation.workKey,
      cursorKey: lockKey,
      syncRunId,
      generation: operation.generation,
      originalRequestedAt: operation.originalRequestedAt,
      customerKey: requireJobText(runtimeConfig.customerKey, 'runtimeConfig.customerKey'),
      accountKey: connector.accountKey,
      reportingTimezone: wooConfig.reportingTimezone,
      defaultCurrency: wooConfig.defaultCurrency,
      connectorEnabled: wooConfig.flags.connector,
      d1WriteEnabled: wooConfig.flags.d1Write,
      larkWriteEnabled: wooConfig.flags.larkWrite,
      fullReconciliation,
      modifiedAfter: input.job.body?.modifiedAfter ?? null,
      overlapSeconds: wooConfig.limits.overlapSeconds,
      pageSize: wooConfig.limits.pageSize,
      maxPagesPerInvocation: wooConfig.limits.maxPagesPerInvocation,
      maxNestedPages: wooConfig.limits.maxNestedPages,
      nestedConcurrency: wooConfig.limits.nestedConcurrency,
      revisionLookbackMs: wooConfig.limits.revisionLookbackDays * 86_400_000,
      client,
      commerceStore: infrastructure.getWooCommerceCommerceStore(),
      coverageStore: infrastructure.getMarketingHistoryStore(),
      resumableWorkStore,
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      tables: tableIds,
      continuationQueue: createWooCommerceContinuationQueue(input, operation),
      assertLockActive,
    }),
  });

  await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
  return result;
}

export function assertWooCommerceManualRuntime(runtimeConfig, wooConfig) {
  if (runtimeConfig?.environment !== 'development'
    || runtimeConfig?.profileKey !== 'integration_workspace'
    || runtimeConfig?.infrastructureOwner !== 'developer'
    || runtimeConfig?.customerKey !== 'chemistry_k') {
    throw permanentError('WooCommerce manual UAT requires the developer-owned Integration Workspace', {
      code: 'WOOCOMMERCE_MANUAL_UAT_TARGET_INVALID',
    });
  }
  const connector = runtimeConfig?.connectors?.woocommerce;
  if (!connector
    || connector.accountKey !== 'chemistry_k'
    || connector.enabled !== true
    || connector.protectedUatRuntime !== true) {
    throw permanentError('WooCommerce connector is disabled or outside the protected UAT runtime', {
      code: 'WOOCOMMERCE_MANUAL_UAT_CONNECTOR_INVALID',
    });
  }
  const missingFlags = [];
  if (wooConfig?.flags?.connector !== true) missingFlags.push('MKT_CONNECTOR_WOOCOMMERCE_ENABLED');
  if (wooConfig?.flags?.d1Write !== true) missingFlags.push('MKT_WOOCOMMERCE_D1_WRITE_ENABLED');
  if (wooConfig?.flags?.larkWrite !== true) missingFlags.push('MKT_WOOCOMMERCE_LARK_WRITE_ENABLED');
  if (wooConfig?.flags?.schedule === true) missingFlags.push('MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false');
  if (missingFlags.length > 0) {
    throw permanentError('WooCommerce manual UAT gates are disabled or unsafe', {
      code: 'WOOCOMMERCE_PROCESSING_GATES_DISABLED',
      details: { missingFlags },
    });
  }
  return connector;
}

function assertWooCommerceJobDefinition(definition, body) {
  if (definition?.connectorKey !== 'woocommerce'
    || definition?.implementationStatus !== JOB_IMPLEMENTATION_STATUS.UAT_PENDING
    || definition?.manualOnly !== true) {
    throw permanentError('WooCommerce Queue job is not registered as protected manual UAT', {
      code: 'WOOCOMMERCE_JOB_UNSUPPORTED',
    });
  }
  if (body?.trigger !== 'manual_uat') {
    throw permanentError('WooCommerce jobs accept manual_uat trigger only', {
      code: 'WOOCOMMERCE_MANUAL_ONLY',
    });
  }
  if (body?.dryRun === true) {
    throw permanentError('WooCommerce credential preflight is a separate operator gate', {
      code: 'WOOCOMMERCE_DRY_RUN_UNSUPPORTED',
    });
  }
}

function requireStableOperation(value) {
  if (!value?.stable
    || typeof value.operationId !== 'string'
    || typeof value.workKey !== 'string'
    || !Number.isSafeInteger(value.generation)
    || !Number.isSafeInteger(value.originalRequestedAt)) {
    throw permanentError('WooCommerce manual UAT requires stable Queue operation metadata', {
      code: 'WOOCOMMERCE_QUEUE_OPERATION_REQUIRED',
    });
  }
  return value;
}

function createWooCommerceContinuationQueue(input, operation) {
  return Object.freeze({
    async send(reference = {}) {
      const queue = input.env?.MKT_SYNC_QUEUE;
      if (typeof queue?.send !== 'function') {
        throw transientError('WooCommerce continuation Queue binding is unavailable', {
          code: 'WOOCOMMERCE_CONTINUATION_QUEUE_UNAVAILABLE',
        });
      }
      const body = withQueueOperation({
        type: JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC,
        schemaVersion: 1,
        trigger: 'manual_uat',
        continuation: true,
        fullReconciliation: input.job.body?.fullReconciliation === true,
        modifiedAfter: input.job.body?.modifiedAfter ?? null,
        commerceSchemaVersion: reference.schemaVersion ?? null,
        cursorKey: reference.cursorKey ?? null,
        syncRunId: reference.syncRunId ?? null,
      }, operation);
      await queue.send(body);
    },
  });
}
