import { createSyncLogEntry } from '../../../packages/domain/src/entities/sync-log.js';
import { createSystemAlert } from '../../../packages/domain/src/entities/system-alert.js';
import { syncTikTokCreatorNativeToLark } from '../../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { createLarkBitableClientFromEnv } from '../../../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../../../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../../../packages/sync-engine/src/table-sync-engine.js';
import { seedMetricDefinitions } from '../../../packages/application/src/use-cases/seed-metric-definitions.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
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
} from '../../../packages/shared/src/errors/runtime-error.js';
import { runReliableSync } from '../../../packages/reliability/src/reliable-sync-runner.js';
import { createCloudflareReliabilityRuntime } from '../../../packages/reliability/src/runtime-factory.js';
import { D1ReliabilityStore } from '../../../packages/reliability/src/d1-reliability-store.js';

const DEFAULT_LOCK_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_RETRY_DELAY_SECONDS = 30;

/** Cloudflare Worker สำหรับ Scheduled jobs, Queue jobs และ Dead Letter Queue */
export default {
  /** Scheduled heartbeat ยังไม่เริ่ม Sync อัตโนมัติใน Release นี้ */
  async scheduled(event) {
    const scheduledAt = new Date(event.scheduledTime).toISOString();
    const entry = createSyncLogEntry({
      platform: 'system',
      syncType: 'scheduled-heartbeat',
      status: 'success',
      startedAt: scheduledAt,
      finishedAt: scheduledAt,
      recordsPulled: 0,
      recordsWritten: 0,
    });
    console.log(JSON.stringify(entry));
  },

  /**
   * ประมวลผล Queue แบบเรียงทีละ Message
   * - Queue หลัก Route งานและ Retry เฉพาะ Transient error
   * - Queue ที่ชื่อเท่ากับ MKT_DLQ_QUEUE_NAME จะบันทึก Dead letter และ Alert โดยไม่ Execute ซ้ำ
   */
  async queue(batch, env) {
    if (isDeadLetterBatch(batch, env)) {
      await processDeadLetterBatch(batch, env);
      return;
    }

    let runtimeConfig = null;
    let infrastructure = null;

    const getRuntimeConfig = () => {
      runtimeConfig ??= loadCustomerRuntimeConfig(env);
      return runtimeConfig;
    };

    const getInfrastructure = () => {
      infrastructure ??= createInfrastructure(env);
      return infrastructure;
    };

    for (const message of batch.messages) {
      let job = null;
      try {
        job = normalizeQueueJobMessage(message);
        const result = await processJob({
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

        if (error?.reliabilityHandled !== true) {
          await recordPermanentQueueFailureBestEffort({ env, batch, message, job, error });
        }
        message.ack();
      }
    }
  },
};

/** Route Job type ไปยัง Use case จริง โดยตรวจ Implementation/Profile/Feature flag ตามลำดับ */
async function processJob(input) {
  const definition = assertJobImplemented(getJobDefinition(input.job?.body?.type));
  const runtimeConfig = input.getRuntimeConfig();
  const connectorConfig = definition.connectorKey
    ? assertConnectorRunnable(runtimeConfig, definition.connectorKey)
    : null;
  const infrastructure = input.getInfrastructure();

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

    return runReliableSync({
      store: reliability.store,
      lockManager: reliability.lockManager,
      customerProfile: runtimeConfig.profileKey,
      accountKey: connectorConfig.accountKey,
      platform: 'tiktok',
      source: 'lark_native_tiktok_for_creator',
      syncType: 'native_import',
      retryCount: Math.max(0, readAttempts(input.message) - 1),
      leaseMs: readPositiveInteger(input.env?.MKT_SYNC_LOCK_LEASE_MS, DEFAULT_LOCK_LEASE_MS),
      alertOnRetryableFailure: false,
      onReliabilityError: (event) => logQueueResult({
        ok: false,
        scope: 'reliability',
        ...sanitizeReliabilityEvent(event),
      }),
      execute: ({ syncRunId }) => syncTikTokCreatorNativeToLark({
        syncRunId,
        repository: infrastructure.repository,
        syncEngine: infrastructure.syncEngine,
        accountId: connectorConfig.accountKey,
        sourceHandle: connectorConfig.sourceHandle,
        metricDate: readMetricDate(input.job.body?.metricDate, input.env),
        tables: {
          rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
          mktContent: tableIds.mktContent,
          mktContentDaily: tableIds.mktContentDaily,
          mktClassificationDictionary: tableIds.mktClassificationDictionary,
        },
      }),
    });
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

  throw permanentError(`Active sync job has no runtime handler: ${definition.type}`, {
    code: 'SYNC_JOB_HANDLER_MISSING',
    details: { type: definition.type },
  });
}

/** สร้าง Infrastructure หนึ่งชุดต่อ Queue event เพื่อแชร์ Token, Schema cache และ D1 store */
function createInfrastructure(env) {
  const client = createLarkBitableClientFromEnv(env);
  const repository = new LarkRecordRepository({ client });
  const syncEngine = new TableSyncEngine();
  let reliability = null;

  return Object.freeze({
    repository,
    syncEngine,
    getReliability(tableIds) {
      reliability ??= createCloudflareReliabilityRuntime({
        env,
        repository,
        syncEngine,
        tables: tableIds,
        onStoreError: ({ method, store, error }) => logQueueResult({
          ok: false,
          scope: 'reliability_store',
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

/** Persist Message จาก DLQ ลง D1 และ Mirror Alert ไป Lark เมื่อ Runtime config พร้อม */
async function processDeadLetterBatch(batch, env) {
  const store = createBestEffortOperationalStore(env);

  for (const message of batch.messages) {
    let job = null;
    try {
      job = normalizeQueueJobMessage(message);
    } catch {
      // Body เสียยังต้องเก็บ Raw payload ใน DLQ ได้
    }

    const dlqId = `dlq:${message.id}`;
    try {
      await store.saveDeadLetter({
        dlqId,
        messageId: message.id,
        queueName: batch.queue,
        jobType: job?.body?.type ?? null,
        schemaVersion: job?.schemaVersion ?? null,
        payload: message.body,
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

/** Permanent error ที่เกิดก่อน Reliable runner จะถูกเก็บใน D1 และ Mirror Alert ไป Lark แบบ Best effort */
async function recordPermanentQueueFailureBestEffort(input) {
  if (typeof input.env?.MKT_STATE_DB?.prepare !== 'function') return;
  try {
    const store = createBestEffortOperationalStore(input.env);
    const dlqId = `terminal:${input.message.id}`;
    await store.saveDeadLetter({
      dlqId,
      messageId: input.message.id,
      queueName: input.batch?.queue ?? null,
      jobType: input.job?.body?.type ?? null,
      schemaVersion: input.job?.schemaVersion ?? null,
      payload: input.message.body,
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
  } catch (storeError) {
    logQueueResult({
      ok: false,
      scope: 'terminal_failure_persistence',
      messageId: input.message.id,
      error: storeError instanceof Error ? storeError.message : String(storeError),
      code: storeError?.code ?? null,
    });
  }
}


/**
 * สร้าง Store สำหรับ Operational failure โดยให้ D1 เป็นแหล่งหลักเสมอ
 * ถ้า Lark credential และ Table ID พร้อม จะใช้ Composite store เพื่อ Mirror Alert เข้า Base ด้วย
 */
function createBestEffortOperationalStore(env) {
  const d1Store = new D1ReliabilityStore({ db: env?.MKT_STATE_DB });
  try {
    const infrastructure = createInfrastructure(env);
    const tableIds = readLarkTableIdsFromEnv(env, ['mktSyncLog', 'mktSystemAlerts']);
    return infrastructure.getReliability(tableIds).store;
  } catch (error) {
    logQueueResult({
      ok: false,
      scope: 'reliability_store_fallback',
      store: 'D1ReliabilityStore',
      error: error instanceof Error ? error.message : String(error),
      code: error?.code ?? null,
    });
    return d1Store;
  }
}

function isDeadLetterBatch(batch, env) {
  const configured = typeof env?.MKT_DLQ_QUEUE_NAME === 'string' ? env.MKT_DLQ_QUEUE_NAME.trim() : '';
  return configured !== '' && batch?.queue === configured;
}

function platformFromJobType(type) {
  if (typeof type !== 'string') return 'system';
  const prefix = type.split('.')[0];
  return new Set(['facebook', 'instagram', 'tiktok', 'youtube']).has(prefix) ? prefix : 'system';
}

/** อ่าน Metric date จาก Job ก่อน จาก Environment รองลงมา และวันที่กรุงเทพฯ เป็นค่าเริ่มต้น */
function readMetricDate(jobValue, env) {
  return resolveMetricDate({ env, override: jobValue });
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

  if (env?.MKT_QUEUE_RETRY_DELAY_SECONDS !== undefined
    && env?.MKT_QUEUE_RETRY_DELAY_SECONDS !== ''
    && base === DEFAULT_RETRY_DELAY_SECONDS
    && String(env.MKT_QUEUE_RETRY_DELAY_SECONDS) !== String(DEFAULT_RETRY_DELAY_SECONDS)) {
    logQueueResult({
      ok: false,
      scope: 'reliability_config',
      code: 'MKT_QUEUE_RETRY_DELAY_INVALID',
      error: 'MKT_QUEUE_RETRY_DELAY_SECONDS ไม่ถูกต้อง จึงใช้ค่าเริ่มต้นแทน',
    });
  }

  return Math.min(43_200, base * Math.min(readAttempts(message), 10));
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

function sanitizeReliabilityEvent(event) {
  return {
    stage: event?.stage ?? null,
    error: event?.error instanceof Error ? event.error.message : String(event?.error ?? ''),
    code: event?.error?.code ?? null,
  };
}

/** เขียน Structured log โดยไม่ใส่ Credential หรือ Environment ทั้งก้อน */
function logQueueResult(payload) {
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    scope: payload.scope ?? 'sync_worker_queue',
    ...payload,
  }));
}

/** ลดผลลัพธ์ใน Log ให้เหลือเฉพาะ Count/สถานะ */
function summarizeJobResult(result) {
  if (result === null || typeof result !== 'object') return result;
  return Object.freeze({
    syncRunId: result.syncRunId ?? null,
    platform: result.platform ?? null,
    source: result.source ?? null,
    mode: result.mode ?? null,
    readyToWrite: result.readyToWrite ?? result.ok ?? null,
    rawRecords: result.rawRecords ?? null,
    classificationRules: result.classificationRules ?? null,
    invalidClassificationRuleCount: Array.isArray(result.classificationDictionary?.invalidRows)
      ? result.classificationDictionary.invalidRows.length
      : 0,
    content: summarizeWriteResult(result.content ?? result.syncPlan?.content),
    dailySnapshots: summarizeWriteResult(result.dailySnapshots ?? result.syncPlan?.dailySnapshots),
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
  });
}
