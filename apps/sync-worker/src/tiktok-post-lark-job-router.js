import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  JOB_TYPES,
  assertJobImplemented,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { resolveQueueOperation } from '../../../packages/application/src/jobs/queue-operation.js';
import { createTikTokOrganicHistoryHooks } from '../../../packages/application/src/storage/tiktok-organic-history-hooks.js';
import { admitTikTokPostLarkSource } from '../../../packages/application/src/use-cases/admit-tiktok-post-lark-source.js';
import { assertTikTokPostProcessCoverageReady } from '../../../packages/application/src/use-cases/assert-tiktok-post-process-coverage-ready.js';
import {
  settleTikTokNativeSourceWatermark,
} from '../../../packages/application/src/use-cases/probe-tiktok-native-source-watermark.js';
import { syncTikTokCreatorNativeToLark } from '../../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { isReviewedConnectorRuntime } from '../../../packages/config/src/customer-profiles.js';
import { readStorageRuntimeConfig } from '../../../packages/config/src/storage-runtime-config.js';
import { readTikTokPostLarkRuntimeConfig } from '../../../packages/config/src/tiktok-post-lark-runtime-config.js';
import { D1TikTokPostLarkStore } from '../../../packages/connectors/src/tiktok/d1-tiktok-post-lark-store.js';
import { D1TikTokReportRequestStore } from '../../../packages/connectors/src/tiktok/d1-tiktok-report-request-store.js';
import { runReliableSync } from '../../../packages/reliability/src/reliable-sync-runner.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { createStableFingerprint } from '../../../packages/shared/src/hash/stable-fingerprint.js';
import { processJobWithHistoryBootstrap } from './history-bootstrap-job-router.js';
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
  requireJobText,
  sanitizeReliabilityEvent,
} from './worker-runtime-support.js';
import {
  enqueueTikTokSyncContinuation,
  resolveTikTokSyncInvocation,
} from './tiktok-sync-continuation.js';

/** Intercept only the new probe and admitted sync; all legacy/manual paths remain unchanged. */
export async function processJobWithTikTokPostLark(input) {
  const type = input.job?.body?.type;
  if (type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_PROBE) {
    return processProbeJob(input);
  }
  if (type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC
    && input.job?.body?.trigger === 'post_lark_watermark') {
    return processAdmittedSyncJob(input);
  }
  return processJobWithHistoryBootstrap(input);
}

async function processProbeJob(input) {
  const definition = assertJobImplemented(getJobDefinition(input.job.body.type));
  const runtimeConfig = input.getRuntimeConfig();
  assertTikTokPostLarkRuntime(runtimeConfig);
  const connectorConfig = assertConnectorRunnable(runtimeConfig, definition.connectorKey);
  const config = readTikTokPostLarkRuntimeConfig(input.env);
  if (!config.watermarkAdmissionEnabled) {
    throw permanentError('TikTok watermark admission is disabled', {
      code: 'MKT_TIKTOK_WATERMARK_ADMISSION_DISABLED',
    });
  }
  const tableIds = readLarkTableIdsFromEnv(input.env, ['rawTikTokCreatorVideos']);
  const infrastructure = input.getInfrastructure();
  const settledProbe = await settleTikTokNativeSourceWatermark({
    repository: infrastructure.repository,
    tableId: tableIds.rawTikTokCreatorVideos,
    accountKey: connectorConfig.accountKey,
    expectedSourceHandle: connectorConfig.sourceHandle,
    pageSize: readPositiveInteger(
      input.env?.MKT_TIKTOK_SOURCE_PAGE_SIZE,
      DEFAULT_TIKTOK_SOURCE_PAGE_SIZE,
    ),
    maxPages: readPositiveInteger(
      input.env?.MKT_TIKTOK_SOURCE_MAX_PAGES ?? input.env?.LARK_MAX_PAGES,
      DEFAULT_TIKTOK_SOURCE_MAX_PAGES,
    ),
    settleMs: config.settleMs,
  });
  return admitTikTokPostLarkSource({
    settledProbe,
    store: new D1TikTokPostLarkStore({ db: input.env?.MKT_STATE_DB }),
    queue: input.env?.MKT_SYNC_QUEUE,
    customerProfile: runtimeConfig.profileKey,
    customerKey: runtimeConfig.customerKey,
    accountKey: connectorConfig.accountKey,
    metricDate: readMetricDate(input.job.body?.metricDate, input.env),
    requestedAt: Date.parse(input.job.body?.requestedAt ?? input.job.requestedAt),
    syncJobType: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
  });
}

async function processAdmittedSyncJob(input) {
  const config = readTikTokPostLarkRuntimeConfig(input.env);
  if (!config.watermarkAdmissionEnabled) {
    throw permanentError('TikTok admitted sync is disabled', {
      code: 'MKT_TIKTOK_WATERMARK_ADMISSION_DISABLED',
    });
  }
  const operation = input.operation ?? resolveQueueOperation({ job: input.job, message: input.message });
  const admissionStore = new D1TikTokPostLarkStore({ db: input.env?.MKT_STATE_DB });
  const admissionKey = requireJobText(input.job.body?.admissionKey, 'admissionKey');
  const admission = await admissionStore.readAdmission(admissionKey);
  assertAdmissionMatches(admission, input.job.body, operation);
  if (admission.status === 'completed') {
    return Object.freeze({
      mode: 'already_completed',
      platform: 'tiktok',
      source: 'lark_native_tiktok_for_creator',
      syncRunId: admission.syncRunId,
      postLarkAdmission: admission,
      reportRequest: admission.reportRequestId
        ? Object.freeze({ requestId: admission.reportRequestId })
        : null,
      warnings: Object.freeze([]),
    });
  }

  const syncRunId = `tiktok-post-lark:${requireJobText(operation.operationId, 'operation.operationId')}`;
  await admissionStore.markProcessing({ admissionKey, syncRunId });
  try {
    const result = await processPostLarkD1FirstSync({
      ...input,
      operation,
      syncRunId,
    });
    if (result.continuationRequired === true) {
      await enqueueTikTokSyncContinuation({
        env: input.env,
        originalBody: input.job.body,
        operation,
        result,
      });
      return Object.freeze({
        ...result,
        postLarkAdmission: admission,
      });
    }
    let coverageProof = null;
    let reportRequest = null;
    if (config.postProcessReportEnabled) {
      coverageProof = await assertTikTokPostProcessCoverageReady({
        gateway: input.getInfrastructure().getOrganicHistoryGateway(),
        coverageRunId: result.reconciliation?.coverageRunId,
        expectedSourceWatermark: admission.sourceWatermark,
      });
      reportRequest = await enqueuePostProcessReport({
        input,
        admission,
        result,
      });
    }
    const completed = await admissionStore.markCompleted({
      admissionKey,
      syncRunId,
      reportRequestId: reportRequest?.requestId ?? null,
    });
    return Object.freeze({
      ...result,
      postLarkAdmission: completed,
      postProcessCoverage: coverageProof,
      reportRequest,
    });
  } catch (error) {
    if (error?.code === 'TIKTOK_CONTINUATION_QUEUE_UNAVAILABLE'
      || error?.code === 'TIKTOK_CONTINUATION_QUEUE_SEND_FAILED') throw error;
    await admissionStore.markFailed({
      admissionKey,
      retryable: error?.retryable === true,
      syncRunId,
      errorCode: error?.code ?? 'TIKTOK_POST_LARK_PROCESSING_FAILED',
    });
    throw error;
  }
}

async function processPostLarkD1FirstSync(input) {
  const definition = assertJobImplemented(getJobDefinition(input.job.body.type));
  const runtimeConfig = input.getRuntimeConfig();
  assertTikTokPostLarkRuntime(runtimeConfig);
  const connectorConfig = assertConnectorRunnable(runtimeConfig, definition.connectorKey);
  const storage = readStorageRuntimeConfig(input.env);
  if (!storage.timeSeriesD1WriteEnabled) {
    throw permanentError('TikTok post-Lark D1 write is disabled', {
      code: 'MKT_TIME_SERIES_D1_WRITE_DISABLED',
    });
  }
  const infrastructure = input.getInfrastructure();
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
  const generation = invocation.generation;
  const metricDate = readMetricDate(input.job.body?.metricDate, input.env);
  const sourceWatermark = requireJobText(input.job.body?.sourceWatermark, 'sourceWatermark');
  const workKey = requireJobText(input.operation.workKey, 'operation.workKey');
  const incrementalEnabled = readBoolean(input.env?.MKT_TIKTOK_INCREMENTAL_ENABLED, false);
  const coverageDigest = await createStableFingerprint({
    contract: 'tiktok-d1-first-coverage-v1',
    workKey,
    generation,
    sourceWatermark,
    datasetKey: 'organic_content_cumulative',
  });
  const coverageRunId = `coverage:tiktok:${coverageDigest}`;

  const result = await runReliableSync({
    syncRunId: requireJobText(input.syncRunId, 'syncRunId'),
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
    onReliabilityError: reliabilityLogger,
    execute: async ({ syncRunId, lockKey, assertLockActive }) => {
      const gateway = infrastructure.getOrganicHistoryGateway();
      await gateway.assertSchemaReady();
      const historyHooks = createTikTokOrganicHistoryHooks({
        gateway,
        customerProfile: runtimeConfig.profileKey,
        customerKey: runtimeConfig.customerKey,
        platform: 'tiktok',
        accountKey: connectorConfig.accountKey,
        sourceAccountId: null,
        sourceTimezone: input.env?.DEFAULT_TIMEZONE ?? 'Asia/Bangkok',
        observedAt: requestedAt,
        fetchedAt: requestedAt,
        historySyncRunId: `history:tiktok:${coverageDigest}`,
        coverageRunId,
        sourceRevision: sourceWatermark,
        sourceWatermark,
        scopeMode: incrementalEnabled ? 'exact_entities' : 'full_inventory',
        datasetKey: 'organic_content_cumulative',
      });
      const syncResult = await syncTikTokCreatorNativeToLark({
        syncRunId,
        assertLockActive,
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        accountId: connectorConfig.accountKey,
        sourceHandle: connectorConfig.sourceHandle,
        metricDate,
        customerProfile: runtimeConfig.profileKey,
        cursorKey: lockKey,
        workKey,
        requestedAt,
        generation,
        continuationSequence: invocation.continuationSequence,
        resumableWorkStore,
        expectedSourceWatermark: sourceWatermark,
        sourcePageSize: readPositiveInteger(
          input.env?.MKT_TIKTOK_SOURCE_PAGE_SIZE,
          DEFAULT_TIKTOK_SOURCE_PAGE_SIZE,
        ),
        sourceMaxPages: readPositiveInteger(
          input.env?.MKT_TIKTOK_SOURCE_MAX_PAGES ?? input.env?.LARK_MAX_PAGES,
          DEFAULT_TIKTOK_SOURCE_MAX_PAGES,
        ),
        maxSourcePagesPerInvocation: invocation.maxSourcePagesPerInvocation,
        maxBusinessUnitsPerInvocation: invocation.maxBusinessUnitsPerInvocation,
        syncMode: input.job.body?.syncMode,
        incrementalEnabled,
        incrementalStateStore: incrementalEnabled
          ? infrastructure.getIncrementalStateStore()
          : null,
        fullSyncIntervalMs: readPositiveInteger(
          input.env?.MKT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS,
          DEFAULT_TIKTOK_FULL_RECONCILIATION_INTERVAL_MS,
        ),
        historyHooks,
        tables: {
          rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
          mktAccounts: tableIds.mktAccounts,
          mktContent: tableIds.mktContent,
          mktContentDaily: tableIds.mktContentDaily,
          mktClassificationDictionary: tableIds.mktClassificationDictionary,
        },
      });
      return Object.freeze({
        ...syncResult,
        reconciliation: Object.freeze({
          ...(syncResult.reconciliation ?? {}),
          coverageRunId,
          sourceWatermark,
          d1History: Object.freeze({ ...(syncResult.d1History ?? {}) }),
        }),
      });
    },
  });
  await resumableWorkStore.cleanupExpiredWork({ limit: 25 });
  return result;
}

async function enqueuePostProcessReport({ input, admission, result }) {
  const requestedAt = Date.now();
  const requestDigest = await createStableFingerprint({
    contract: 'tiktok-post-process-report-request-v1',
    customerProfile: admission.customerProfile,
    customerKey: admission.customerKey,
    accountKey: admission.accountKey,
    reportType: 'daily_organic_report',
    periodEnd: admission.metricDate,
    formulaVersion: 'tiktok-organic-v1',
    sourceWatermark: admission.sourceWatermark,
  });
  const requestId = `report-request:tiktok:${requestDigest}`;
  const store = new D1TikTokReportRequestStore({ db: input.env?.MKT_STATE_DB });
  const claim = await store.claim({
    requestId,
    customerKey: admission.customerKey,
    accountKey: admission.accountKey,
    periodStart: admission.metricDate,
    periodEnd: admission.metricDate,
    comparisonMode: 'previous_period',
    requestedAt,
  });
  if (claim.request.status === 'completed' || claim.request.status === 'processing') {
    return claim.request;
  }
  if (typeof input.env?.MKT_SYNC_QUEUE?.send !== 'function') {
    throw permanentError('TikTok post-process Report Queue binding is unavailable', {
      code: 'MKT_SYNC_QUEUE_BINDING_REQUIRED',
    });
  }
  await input.env.MKT_SYNC_QUEUE.send({
    schemaVersion: 1,
    type: JOB_TYPES.DAILY_REPORT_GENERATE,
    trigger: 'post_tiktok_processing',
    requestedAt: new Date(requestedAt).toISOString(),
    periodEnd: admission.metricDate,
    reportSettingKey: requireJobText(
      input.env?.MKT_DAILY_REPORT_SETTING_KEY,
      'MKT_DAILY_REPORT_SETTING_KEY',
    ),
    reportRequestId: requestId,
    sourceWatermark: admission.sourceWatermark,
    sourceSyncRunId: result.syncRunId,
  });
  return claim.request;
}

function assertAdmissionMatches(admission, body, operation) {
  if (!admission) {
    throw permanentError('TikTok source admission does not exist', {
      code: 'TIKTOK_SOURCE_ADMISSION_NOT_FOUND',
    });
  }
  const expected = {
    sourceWatermark: requireJobText(body?.sourceWatermark, 'sourceWatermark'),
    metricDate: readMetricDate(body?.metricDate, {}),
    workKey: requireJobText(operation?.workKey, 'operation.workKey'),
    generation: operation?.generation,
  };
  const mismatch = Object.entries(expected).find(([field, value]) => admission[field] !== value);
  if (mismatch) {
    throw permanentError('TikTok Queue job does not match its source admission', {
      code: 'TIKTOK_SOURCE_ADMISSION_IDENTITY_CONFLICT',
      details: { admissionKey: admission.admissionKey, fieldName: mismatch[0] },
    });
  }
  if (!['queued', 'processing', 'completed'].includes(admission.status)) {
    throw permanentError('TikTok source admission is not executable', {
      code: 'TIKTOK_SOURCE_ADMISSION_STATE_CONFLICT',
      details: { admissionKey: admission.admissionKey, status: admission.status },
    });
  }
}

export function assertTikTokPostLarkRuntime(runtimeConfig = {}) {
  if (!isReviewedConnectorRuntime(runtimeConfig)) {
    throw permanentError('TikTok post-Lark pipeline requires the reviewed Integration or customer Production runtime', {
      code: 'TIKTOK_POST_LARK_ENVIRONMENT_BLOCKED',
      details: {
        environment: runtimeConfig.environment ?? null,
        profileKey: runtimeConfig.profileKey ?? null,
        infrastructureOwner: runtimeConfig.infrastructureOwner ?? null,
      },
    });
  }
  return runtimeConfig;
}

function reliabilityLogger(event) {
  logQueueResult({
    ok: false,
    scope: 'reliability',
    ...sanitizeReliabilityEvent(event),
  });
}
