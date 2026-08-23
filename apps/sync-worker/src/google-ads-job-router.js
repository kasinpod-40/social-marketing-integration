import {
  validateGoogleAdsQueueReference,
} from '../../../packages/application/src/google-ads/google-ads-queue-reference.js';
import {
  processGoogleAdsManagerSignedDelivery,
} from '../../../packages/application/src/use-cases/process-google-ads-manager-signed-delivery.js';
import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import { isReviewedConnectorRuntime } from '../../../packages/config/src/customer-profiles.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import {
  drainPendingSyncWarnings,
  runReliableSync,
} from '../../../packages/reliability/src/reliable-sync-runner.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import {
  DEFAULT_LOCK_LEASE_MS,
  DEFAULT_LOCK_RENEW_INTERVAL_MS,
  logQueueResult,
  readAttempts,
  readBoolean,
  readPositiveInteger,
  sanitizeReliabilityEvent,
} from './worker-runtime-support.js';

const GOOGLE_ADS_TABLE_KEYS = Object.freeze([
  'mktAdsAccounts',
  'mktAdsCampaigns',
  'mktAdsAssetGroups',
  'mktAdsAdGroups',
  'mktAdsAds',
  'mktAdsCreatives',
  'mktAdsDaily',
  'mktSyncLog',
  'mktSystemAlerts',
]);

/**
 * Google Ads signed-delivery consumer. The external Manager Script owns source scheduling;
 * Cloudflare consumes only authenticated completed-run references.
 */
export async function processGoogleAdsManualUatJob(input = {}) {
  const runtimeConfig = input.getRuntimeConfig();
  assertGoogleAdsManualUatRuntime(runtimeConfig, input.env);
  const reference = validateGoogleAdsQueueReference(input.job?.body);
  assertQueueOperationMatches(reference, input.operation);

  const infrastructure = input.getInfrastructure();
  const admissionStore = infrastructure.getGoogleAdsAdmissionStore();
  // Queue receipt proves that an ambiguous producer send reached Cloudflare even if
  // the producer failed before persisting its final queued marker.
  await confirmGoogleAdsQueueReceipt({ admissionStore, reference });

  const tableIds = readLarkTableIdsFromEnv(input.env, GOOGLE_ADS_TABLE_KEYS);
  const reliability = infrastructure.getReliability(tableIds);
  const resumableWorkStore = infrastructure.getResumableWorkStore();
  const connectorConfig = runtimeConfig.connectors.google_ads;

  await drainPendingSyncWarnings({
    store: reliability.store,
    warningOutboxStore: resumableWorkStore,
    platform: 'google_ads',
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
    platform: 'google_ads',
    source: 'google_ads_manager_script_signed_delivery',
    syncType: 'paid_ads_delivery',
    retryCount: Math.max(0, (input.mainQueueAttempts ?? readAttempts(input.message)) - 1),
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
    execute: ({ syncRunId, lockKey, assertLockActive }) => processGoogleAdsManagerSignedDelivery({
      queueReference: reference,
      syncRunId,
      cursorKey: lockKey,
      assertLockActive,
      admissionStore,
      deliveryStore: infrastructure.getGoogleAdsDeliveryStore(),
      historyStore: infrastructure.getMarketingHistoryStore(),
      resumableWorkStore,
      repository: infrastructure.repository,
      syncEngine: infrastructure.syncEngine,
      continuationQueue: requireQueue(input.env),
      businessWriteEnabled: readBoolean(input.env?.MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED, false),
      larkWriteEnabled: readBoolean(input.env?.MKT_GOOGLE_ADS_LARK_WRITE_ENABLED, false),
      maxD1RowsPerInvocation: readPositiveInteger(
        input.env?.MKT_GOOGLE_ADS_D1_ROWS_PER_INVOCATION,
        250,
      ),
      maxLarkRowsPerInvocation: readPositiveInteger(
        input.env?.MKT_GOOGLE_ADS_LARK_ROWS_PER_INVOCATION,
        50,
      ),
      tables: {
        mktAdsAccounts: tableIds.mktAdsAccounts,
        mktAdsCampaigns: tableIds.mktAdsCampaigns,
        mktAdsAssetGroups: tableIds.mktAdsAssetGroups,
        mktAdsAdGroups: tableIds.mktAdsAdGroups,
        mktAdsAds: tableIds.mktAdsAds,
        mktAdsCreatives: tableIds.mktAdsCreatives,
        mktAdsDaily: tableIds.mktAdsDaily,
      },
    }),
  });

  await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
  return result;
}

/** Promote only an ambiguous send-pending admission; all other states remain unchanged. */
export async function confirmGoogleAdsQueueReceipt(input = {}) {
  const admissionStore = input.admissionStore;
  if (typeof admissionStore?.getByOperationId !== 'function'
    || typeof admissionStore?.markQueued !== 'function') {
    throw new TypeError('confirmGoogleAdsQueueReceipt requires admissionStore getByOperationId/markQueued');
  }
  const reference = validateGoogleAdsQueueReference(input.reference);
  const admission = await admissionStore.getByOperationId(reference.operationId);
  if (!admission) {
    throw permanentError('Google Ads Queue receipt has no LIVE admission', {
      code: 'GOOGLE_ADS_LIVE_ADMISSION_NOT_FOUND',
    });
  }
  if (admission.operationId !== reference.operationId
    || admission.workKey !== reference.workKey
    || admission.generation !== reference.generation
    || admission.originalRequestedAt !== reference.originalRequestedAt) {
    throw permanentError('Google Ads Queue receipt conflicts with LIVE admission', {
      code: 'GOOGLE_ADS_LIVE_ADMISSION_IDENTITY_MISMATCH',
    });
  }
  if (admission.status === 'send_pending') {
    return admissionStore.markQueued({ runId: reference.operationId });
  }
  return admission;
}

export function assertGoogleAdsManualUatRuntime(runtimeConfig, env = {}) {
  if (!isReviewedConnectorRuntime(runtimeConfig)) {
    throw permanentError('Google Ads runtime requires the reviewed Integration or customer Production ownership tuple', {
      code: 'GOOGLE_ADS_MANUAL_UAT_TARGET_INVALID',
    });
  }
  const connector = assertConnectorRunnable(runtimeConfig, 'google_ads');
  if (!connector || connector.accountKey !== 'chemistry_k' || connector.enabled !== true) {
    throw permanentError('Google Ads connector is disabled or has an invalid account identity', {
      code: 'GOOGLE_ADS_MANUAL_UAT_CONNECTOR_INVALID',
    });
  }
  const requiredFlags = [
    'MKT_CONNECTOR_GOOGLE_ADS_ENABLED',
    'MKT_GOOGLE_ADS_QUEUE_ADMISSION_ENABLED',
    'MKT_GOOGLE_ADS_BUSINESS_WRITE_ENABLED',
    'MKT_GOOGLE_ADS_LARK_WRITE_ENABLED',
  ];
  const disabled = requiredFlags.filter((key) => !readBoolean(env?.[key], false));
  if (disabled.length > 0) {
    throw permanentError('Google Ads manual UAT execution gates are disabled', {
      code: 'GOOGLE_ADS_MANUAL_UAT_GATES_DISABLED',
      details: { disabled },
    });
  }
  return connector;
}

function assertQueueOperationMatches(reference, operation) {
  if (!operation?.stable
    || operation.operationId !== reference.operationId
    || operation.workKey !== reference.workKey
    || operation.generation !== reference.generation
    || operation.originalRequestedAt !== reference.originalRequestedAt) {
    throw permanentError('Google Ads Queue operation metadata is inconsistent', {
      code: 'GOOGLE_ADS_QUEUE_OPERATION_MISMATCH',
    });
  }
}

function requireQueue(env) {
  const queue = env?.MKT_SYNC_QUEUE;
  if (typeof queue?.send !== 'function') {
    throw permanentError('Google Ads continuation Queue binding is unavailable', {
      code: 'GOOGLE_ADS_QUEUE_BINDING_UNAVAILABLE',
    });
  }
  return queue;
}
