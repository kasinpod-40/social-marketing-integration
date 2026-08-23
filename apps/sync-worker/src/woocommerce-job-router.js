import {
  JOB_IMPLEMENTATION_STATUS,
  JOB_TRIGGERS,
  JOB_TYPES,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import { withQueueOperation } from '../../../packages/application/src/jobs/queue-operation.js';
import { syncWooCommerceCommerce } from '../../../packages/application/src/use-cases/sync-woocommerce-commerce.js';
import { isReviewedConnectorRuntime } from '../../../packages/config/src/customer-profiles.js';
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

const WOOCOMMERCE_INVALID_JSON_RETRY_DELAYS_MS = Object.freeze([250, 1_000]);

/**
 * Chemistry K Integration Workspace route สำหรับ Manual UAT และ Scheduled incremental.
 * ทุก Trigger ใช้ Shared Reliability/Queue/DLQ เดิม และ Fail ก่อน Provider เมื่อ Gate ใดปิด.
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
  const connector = assertWooCommerceRuntime(runtimeConfig, wooConfig, input.job.body.trigger);
  const operation = requireStableOperation(input.operation);
  const fullReconciliation = input.job.body.trigger === JOB_TRIGGERS.WOOCOMMERCE_SCHEDULED
    ? false
    : input.job.body?.fullReconciliation === true;
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
    fetchImpl: createWooCommerceWorkerFetch(globalThis, {
      invalidJsonRetryDelaysMs: WOOCOMMERCE_INVALID_JSON_RETRY_DELAYS_MS,
    }),
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
      orderCreatedAfter: input.job.body?.orderCreatedAfter ?? null,
      orderCreatedBefore: input.job.body?.orderCreatedBefore ?? null,
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

export function assertWooCommerceRuntime(runtimeConfig, wooConfig, trigger) {
  if (!isReviewedConnectorRuntime(runtimeConfig)) {
    throw permanentError('WooCommerce execution requires the reviewed Integration or customer Production ownership tuple', {
      code: 'WOOCOMMERCE_RUNTIME_TARGET_INVALID',
    });
  }
  const connector = assertConnectorRunnable(runtimeConfig, 'woocommerce');
  if (!connector
    || connector.accountKey !== 'chemistry_k'
    || connector.enabled !== true
    || connector.implementationStatus !== JOB_IMPLEMENTATION_STATUS.ACTIVE) {
    throw permanentError('WooCommerce connector is disabled or not active', {
      code: 'WOOCOMMERCE_CONNECTOR_INVALID',
    });
  }
  const missingFlags = [];
  if (wooConfig?.flags?.connector !== true) missingFlags.push('MKT_CONNECTOR_WOOCOMMERCE_ENABLED');
  if (wooConfig?.flags?.d1Write !== true) missingFlags.push('MKT_WOOCOMMERCE_D1_WRITE_ENABLED');
  if (wooConfig?.flags?.larkWrite !== true) missingFlags.push('MKT_WOOCOMMERCE_LARK_WRITE_ENABLED');
  if (trigger === JOB_TRIGGERS.WOOCOMMERCE_MANUAL_UAT && wooConfig?.flags?.schedule === true) {
    missingFlags.push('MKT_SCHEDULE_WOOCOMMERCE_ENABLED=false');
  }
  if (trigger === JOB_TRIGGERS.WOOCOMMERCE_SCHEDULED && wooConfig?.flags?.schedule !== true) {
    missingFlags.push('MKT_SCHEDULE_WOOCOMMERCE_ENABLED');
  }
  if (missingFlags.length > 0) {
    throw permanentError('WooCommerce processing gates are disabled or unsafe', {
      code: 'WOOCOMMERCE_PROCESSING_GATES_DISABLED',
      details: { missingFlags },
    });
  }
  return connector;
}

/** Compatibility export for callers that still name the manual-only guard explicitly. */
export function assertWooCommerceManualRuntime(runtimeConfig, wooConfig) {
  return assertWooCommerceRuntime(
    runtimeConfig,
    wooConfig,
    JOB_TRIGGERS.WOOCOMMERCE_MANUAL_UAT,
  );
}

function assertWooCommerceJobDefinition(definition, body) {
  if (definition?.connectorKey !== 'woocommerce'
    || definition?.implementationStatus !== JOB_IMPLEMENTATION_STATUS.ACTIVE
    || !Array.isArray(definition?.allowedTriggers)
    || !definition.allowedTriggers.includes(body?.trigger)) {
    throw permanentError('WooCommerce Queue job is not registered for the requested trigger', {
      code: 'WOOCOMMERCE_JOB_UNSUPPORTED',
    });
  }
  if (body?.dryRun === true) {
    throw permanentError('WooCommerce credential preflight is a separate operator gate', {
      code: 'WOOCOMMERCE_DRY_RUN_UNSUPPORTED',
    });
  }
  if (body.trigger === JOB_TRIGGERS.WOOCOMMERCE_SCHEDULED
    && body.fullReconciliation === true) {
    throw permanentError('Scheduled WooCommerce jobs must remain incremental', {
      code: 'WOOCOMMERCE_SCHEDULED_FULL_RECONCILIATION_BLOCKED',
    });
  }
}

function requireStableOperation(value) {
  if (!value?.stable
    || typeof value.operationId !== 'string'
    || typeof value.workKey !== 'string'
    || !Number.isSafeInteger(value.generation)
    || !Number.isSafeInteger(value.originalRequestedAt)
    || value.generation !== value.originalRequestedAt) {
    throw permanentError('WooCommerce execution requires stable Queue operation metadata', {
      code: 'WOOCOMMERCE_QUEUE_OPERATION_REQUIRED',
    });
  }
  return value;
}

/** Preserve the Cloudflare runtime receiver and optionally retry only known HTML contamination. */
export function createWooCommerceWorkerFetch(target = globalThis, options = {}) {
  const fetchImpl = target?.fetch;
  if (typeof fetchImpl !== 'function') {
    throw permanentError('WooCommerce Worker fetch implementation is unavailable', {
      code: 'WOOCOMMERCE_FETCH_RUNTIME_UNAVAILABLE',
    });
  }
  const retryDelays = normalizeInvalidJsonRetryDelays(options.invalidJsonRetryDelaysMs);
  const sleep = typeof options.sleep === 'function' ? options.sleep : sleepMs;
  return async (...args) => {
    for (let attempt = 0; ; attempt += 1) {
      const response = await Reflect.apply(fetchImpl, target, args);
      if (attempt >= retryDelays.length
        || !await isKnownWooCommerceHtmlContamination(response)) {
        return response;
      }
      await sleep(retryDelays[attempt]);
    }
  };
}

async function isKnownWooCommerceHtmlContamination(response) {
  if (response?.status !== 200
    || response?.ok !== true
    || response?.redirected === true
    || !String(response?.headers?.get?.('content-type') ?? '')
      .toLowerCase()
      .includes('application/json')) {
    return false;
  }
  try {
    const body = await response.clone().text();
    const normalized = body.charCodeAt(0) === 0xfeff ? body.slice(1) : body;
    return normalized.trimStart().startsWith('<');
  } catch {
    return false;
  }
}

function normalizeInvalidJsonRetryDelays(value) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value) || value.length > 2) {
    throw permanentError('WooCommerce invalid-JSON retry delays are invalid', {
      code: 'WOOCOMMERCE_INVALID_JSON_RETRY_CONFIG_INVALID',
    });
  }
  return Object.freeze(value.map((delay) => {
    const milliseconds = Number(delay);
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0 || milliseconds > 5_000) {
      throw permanentError('WooCommerce invalid-JSON retry delay is invalid', {
        code: 'WOOCOMMERCE_INVALID_JSON_RETRY_CONFIG_INVALID',
      });
    }
    return milliseconds;
  }));
}

function sleepMs(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
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
        trigger: input.job.body?.trigger,
        continuation: true,
        fullReconciliation: input.job.body?.trigger === JOB_TRIGGERS.WOOCOMMERCE_SCHEDULED
          ? false
          : input.job.body?.fullReconciliation === true,
        modifiedAfter: input.job.body?.modifiedAfter ?? null,
        orderCreatedAfter: input.job.body?.orderCreatedAfter ?? null,
        orderCreatedBefore: input.job.body?.orderCreatedBefore ?? null,
        commerceSchemaVersion: reference.schemaVersion ?? null,
        cursorKey: reference.cursorKey ?? null,
        syncRunId: reference.syncRunId ?? null,
      }, operation);
      await queue.send(body);
    },
  });
}
