import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import {
  isStableOperationJobType,
  resolveQueueOperation,
} from '../../../packages/application/src/jobs/queue-operation.js';
import { normalizeQueueJobMessage } from '../../../packages/application/src/jobs/queue-job.js';
import { createSystemAlert } from '../../../packages/domain/src/entities/system-alert.js';
import { D1QueueOperationStore } from '../../../packages/reliability/src/d1-queue-operation-store.js';
import {
  isRetryableError,
  permanentError,
} from '../../../packages/shared/src/errors/runtime-error.js';
import { D1ResumableWorkStore } from '../../../packages/sync-engine/src/queue-terminal-safe-d1-resumable-work-store.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import {
  logQueueResult,
  readAttempts,
  readRetryDelaySeconds,
  requireQueueName,
  summarizeJobResult,
} from './worker-runtime-support.js';
import { attemptQueueAutoRecovery } from './queue-auto-recovery.js';

export const QUEUE_ROLES = Object.freeze({
  MAIN: 'main',
  DLQ: 'dlq',
  UNKNOWN: 'unknown',
});

const STABLE_RESUMABLE_WORK_JOB_TYPES = new Set([
  JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC,
  JOB_TYPES.FACEBOOK_ORGANIC_SYNC,
  JOB_TYPES.INSTAGRAM_ORGANIC_SYNC,
  JOB_TYPES.META_ADS_SYNC,
  JOB_TYPES.GOOGLE_ADS_MANAGER_SIGNED_DELIVERY_PROCESS,
  JOB_TYPES.WOOCOMMERCE_COMMERCE_SYNC,
]);

/** Queue routing เป็น whitelist และ fail-closed: Main, DLQ หรือ Unknown เท่านั้น */
export async function routeQueueBatch(batch, env, dependencies = {}) {
  const role = classifyQueueBatch(batch, env);
  const operationalStoreFactory = dependencies.createOperationalStore;
  if (role === QUEUE_ROLES.DLQ) {
    await processDeadLetterBatch(batch, env, operationalStoreFactory);
    return;
  }
  if (role === QUEUE_ROLES.UNKNOWN) {
    await processUnknownQueueBatch(batch, env, operationalStoreFactory);
    return;
  }
  await processMainQueueBatch(batch, env, dependencies);
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

async function processMainQueueBatch(batch, env, dependencies) {
  const processJobImpl = dependencies.processJob;
  const infrastructureFactory = dependencies.createInfrastructure;
  const operationalStoreFactory = dependencies.createOperationalStore;
  const queueOperationStore = createQueueOperationStore(env);
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
    let operation = null;
    let mainQueueAttempts = readAttempts(message);
    try {
      job = normalizeQueueJobMessage(message);
      operation = resolveQueueOperation({ job, message });
      if (operation.stable && queueOperationStore) {
        const recorded = await queueOperationStore.recordMainQueueAttempt({
          operationId: operation.operationId,
          workKey: operation.workKey,
          generation: operation.generation,
          originalRequestedAt: operation.originalRequestedAt,
          messageId: message.id,
        });
        mainQueueAttempts = recorded.mainQueueAttempts;
      }
      const result = await processJobImpl({
        job,
        message,
        operation,
        mainQueueAttempts,
        env,
        getRuntimeConfig,
        getInfrastructure,
      });
      if (operation?.stable && queueOperationStore) {
        await queueOperationStore.completeSafeAutoRecoveriesForWork({
          workKey: operation.workKey,
          generation: operation.generation,
        });
      }
      logQueueResult({
        ok: true,
        messageId: message.id,
        mainQueueAttempts,
        operationId: operation?.operationId ?? null,
        workKey: operation?.workKey ?? null,
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
        mainQueueAttempts,
        operationId: operation?.operationId ?? null,
        workKey: operation?.workKey ?? null,
        schemaVersion: job?.schemaVersion ?? null,
        type: job?.body?.type ?? null,
        syncRunId: error?.syncRunId ?? null,
        reliabilityHandled: error?.reliabilityHandled === true,
        retryable,
        error: error instanceof Error ? error.message : String(error),
        code: error?.code ?? null,
      });

      if (retryable) {
        message.retry({ delaySeconds: readRetryDelaySeconds(env, message, error) });
        continue;
      }

      try {
        await recordPermanentQueueFailure({
          env,
          batch,
          message,
          job,
          operation,
          mainQueueAttempts,
          error,
          operationalStoreFactory,
          queueOperationStore,
        });
      } catch (persistenceError) {
        logQueueResult({
          ok: false,
          scope: 'terminal_failure_persistence',
          messageId: message.id,
          error: persistenceError instanceof Error
            ? persistenceError.message
            : String(persistenceError),
          code: persistenceError?.code ?? null,
        });
        message.retry({
          delaySeconds: readRetryDelaySeconds(env, message, persistenceError),
        });
        continue;
      }
      message.ack();
    }
  }
}

async function processDeadLetterBatch(batch, env, storeFactory) {
  const store = storeFactory(env);
  const queueOperationStore = createQueueOperationStore(env);
  for (const message of batch.messages) {
    let job = null;
    let operation = null;
    try {
      job = normalizeQueueJobMessage(message);
      operation = resolveQueueOperation({ job, message });
    } catch {
      // Keep malformed/legacy payload available for forensic persistence, but never derive a
      // stable bootstrap Work from the DLQ delivery message.id.
    }
    const dlqId = `dlq:${message.id}`;
    const dlqDeliveryAttempts = readAttempts(message);
    const recordedAttempts = operation?.operationId && queueOperationStore
      ? await queueOperationStore.readMainQueueAttempts({ operationId: operation.operationId })
      : null;
    const mainQueueAttempts = recordedAttempts?.tracked
      ? recordedAttempts.mainQueueAttempts
      : 0;

    try {
      await markQueueWorkTerminal({
        env,
        message,
        jobType: job?.body?.type,
        workKey: operation?.workKey ?? null,
        stableOperation: operation?.stable === true,
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
        retryCount: mainQueueAttempts,
        status: 'open',
      });
      if (queueOperationStore) {
        await queueOperationStore.saveDeadLetterMetadata({
          dlqId,
          operationId: operation?.operationId ?? null,
          workKey: operation?.workKey ?? null,
          generation: operation?.generation ?? null,
          originalRequestedAt: operation?.originalRequestedAt ?? null,
          mainQueueAttempts,
          dlqDeliveryAttempts,
        });
      }
      if (shouldCreateQueueFailureAlert(job?.body?.type)) {
        await store.saveSystemAlert(createSystemAlert({
          alertId: `alert:${dlqId}`,
          alertType: 'queue_dead_letter',
          severity: 'critical',
          platform: platformFromJobType(job?.body?.type),
          status: 'open',
          errorCode: 'QUEUE_RETRY_EXHAUSTED',
          message: `Queue job ไปถึง DLQ หลัง Retry ครบ\nmessage_id=${message.id}\njob_type=${job?.body?.type ?? 'unknown'}`,
          details: {
            queueName: batch.queue,
            mainQueueAttempts,
            dlqDeliveryAttempts,
            operationId: operation?.operationId ?? null,
            workKey: operation?.workKey ?? null,
          },
        }));
      }
      const autoRecovery = await attemptQueueAutoRecovery({
        env,
        job,
        operation,
        dlqId,
        queueOperationStore,
      });
      logQueueResult({
        ok: false,
        scope: 'dead_letter',
        messageId: message.id,
        dlqId,
        mainQueueAttempts,
        dlqDeliveryAttempts,
        operationId: operation?.operationId ?? null,
        workKey: operation?.workKey ?? null,
        persisted: true,
        autoRecovery,
      });
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
      message.retry({ delaySeconds: readRetryDelaySeconds(env, message, error) });
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
      message.retry({ delaySeconds: readRetryDelaySeconds(env, message, error) });
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
    workKey: input.operation?.workKey ?? null,
    stableOperation: input.operation?.stable === true,
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
    retryCount: input.mainQueueAttempts,
    status: 'open',
  });
  if (input.queueOperationStore) {
    await input.queueOperationStore.saveDeadLetterMetadata({
      dlqId,
      operationId: input.operation?.operationId ?? null,
      workKey: input.operation?.workKey ?? null,
      generation: input.operation?.generation ?? null,
      originalRequestedAt: input.operation?.originalRequestedAt ?? null,
      mainQueueAttempts: input.mainQueueAttempts,
      dlqDeliveryAttempts: 0,
    });
  }
  if (shouldCreateQueueFailureAlert(input.job?.body?.type)) {
    await store.saveSystemAlert(createSystemAlert({
      alertId: `alert:${dlqId}`,
      alertType: 'queue_permanent_failure',
      severity: 'critical',
      platform: platformFromJobType(input.job?.body?.type),
      errorCode: input.error?.code ?? 'PERMANENT_QUEUE_FAILURE',
      message: `Queue job หยุดแบบ Permanent\nmessage_id=${input.message.id}\njob_type=${input.job?.body?.type ?? 'unknown'}\nerror=${input.error instanceof Error ? input.error.message : String(input.error)}`,
      details: {
        mainQueueAttempts: input.mainQueueAttempts,
        operationId: input.operation?.operationId ?? null,
        workKey: input.operation?.workKey ?? null,
      },
    }));
  }
}

async function markQueueWorkTerminal(input) {
  const platform = platformFromJobType(input.jobType);
  if (!new Set(['youtube', 'tiktok', 'chatwoot']).has(platform)
    && !STABLE_RESUMABLE_WORK_JOB_TYPES.has(input.jobType)) return false;
  if (!input.env?.MKT_STATE_DB) return false;
  let workKey = input.workKey;
  if (!workKey && input.stableOperation !== true && !isStableOperationJobType(input.jobType)) {
    workKey = `${platform}:${requireMessageId(input.message?.id)}`;
  }
  // Stable bootstrap/recovery jobs without persisted identity must not terminalize a different Work.
  if (!workKey) return false;
  const workStore = new D1ResumableWorkStore({ db: input.env.MKT_STATE_DB });
  const result = await workStore.abandonWork({
    workKey,
    reason: input.reason,
    auditReference: input.auditReference,
  });
  await workStore.cleanupExpiredWork({ limit: 25 });
  return result;
}

function createQueueOperationStore(env) {
  return typeof env?.MKT_STATE_DB?.prepare === 'function'
    && typeof env?.MKT_STATE_DB?.batch === 'function'
    ? new D1QueueOperationStore({ db: env.MKT_STATE_DB })
    : null;
}

function requireMessageId(value) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw permanentError('Queue message.id is required', {
      code: 'MKT_RUNTIME_CONFIG_INVALID',
    });
  }
  return value.trim();
}

function platformFromJobType(type) {
  if (typeof type !== 'string') return 'system';
  if (type.startsWith('report.')) return 'tiktok';
  const prefix = type.split('.')[0];
  return new Set(['facebook', 'instagram', 'tiktok', 'youtube', 'chatwoot']).has(prefix)
    ? prefix
    : 'system';
}

function shouldCreateQueueFailureAlert(jobType) {
  return jobType !== JOB_TYPES.RELIABILITY_MIRROR_DELIVER;
}
