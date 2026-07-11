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
import { CONNECTOR_KEYS } from '../../../packages/config/src/connector-catalog.js';
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
import { CompositeReliabilityStore } from '../../../packages/reliability/src/composite-reliability-store.js';
import { LarkReliabilityStore } from '../../../packages/reliability/src/lark-reliability-store.js';

const DEFAULT_LOCK_LEASE_MS = 10 * 60 * 1000;
const DEFAULT_LOCK_RENEW_INTERVAL_MS = 2 * 60 * 1000;
const DEFAULT_RETRY_DELAY_SECONDS = 30;

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
      if (!readBoolean(env?.MKT_SCHEDULE_TIKTOK_ENABLED, false)) {
        logQueueResult({ ok: true, scope: 'scheduler', status: 'skipped', reason: 'tiktok_schedule_disabled' });
        return;
      }

      const runtimeConfig = loadCustomerRuntimeConfig(env);
      assertConnectorRunnable(runtimeConfig, CONNECTOR_KEYS.TIKTOK);
      const queue = env?.MKT_SYNC_QUEUE;
      if (typeof queue?.send !== 'function') {
        throw permanentError('Missing Queue producer binding MKT_SYNC_QUEUE', {
          code: 'MKT_SYNC_QUEUE_BINDING_REQUIRED',
        });
      }

      const scheduledAt = new Date(event.scheduledTime).toISOString();
      const job = Object.freeze({
        schemaVersion: 1,
        type: JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
        requestedAt: scheduledAt,
        trigger: 'scheduled',
      });
      await queue.send(job);
      logQueueResult({
        ok: true,
        scope: 'scheduler',
        status: 'enqueued',
        type: job.type,
        requestedAt: scheduledAt,
      });
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

          if (error?.reliabilityHandled !== true) {
            try {
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
      execute: ({ syncRunId, assertLockActive }) => syncTikTokCreatorNativeToLark({
        syncRunId,
        assertLockActive,
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
export function createInfrastructure(env) {
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
  const prefix = type.split('.')[0];
  return new Set(['facebook', 'instagram', 'tiktok', 'youtube']).has(prefix) ? prefix : 'system';
}

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
  console.log(JSON.stringify({
    timestamp: new Date().toISOString(),
    scope: payload.scope ?? 'sync_worker_queue',
    ...payload,
  }));
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
    writeOutcome: value.writeOutcome ?? null,
  });
}
