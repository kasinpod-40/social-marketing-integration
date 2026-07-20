import { JOB_TYPES } from '../../../packages/application/src/jobs/job-catalog.js';
import { normalizeQueueJobMessage } from '../../../packages/application/src/jobs/queue-job.js';
import { createSystemAlert } from '../../../packages/domain/src/entities/system-alert.js';
import {
  isRetryableError,
  permanentError,
} from '../../../packages/shared/src/errors/runtime-error.js';
import { D1ResumableWorkStore } from '../../../packages/sync-engine/src/d1-resumable-work-store.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import {
  logQueueResult,
  readAttempts,
  readRetryDelaySeconds,
  requireJobText,
  requireQueueName,
  summarizeJobResult,
} from './worker-runtime-support.js';

export const QUEUE_ROLES = Object.freeze({
  MAIN: 'main',
  DLQ: 'dlq',
  UNKNOWN: 'unknown',
});

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

      try {
        // Permanent ทุกเส้นทางต้องมี Dead-letter payload สำหรับ Redrive
        // แม้ Reliability runner จะบันทึก Sync failure/alert ไปแล้วก็ตาม.
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
      message.ack();
    }
  }
}

async function processDeadLetterBatch(batch, env, storeFactory) {
  const store = storeFactory(env);
  for (const message of batch.messages) {
    let job = null;
    try { job = normalizeQueueJobMessage(message); } catch { /* เก็บ Raw body ต่อได้ */ }
    const dlqId = `dlq:${message.id}`;
    try {
      await markQueueWorkTerminal({
        env,
        message,
        jobType: job?.body?.type,
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
        retryCount: readAttempts(message),
        status: 'open',
      });
      if (shouldCreateQueueFailureAlert(job?.body?.type)) {
        await store.saveSystemAlert(createSystemAlert({
          alertId: `alert:${dlqId}`,
          alertType: 'queue_dead_letter',
          severity: 'critical',
          platform: platformFromJobType(job?.body?.type),
          status: 'open',
          errorCode: 'QUEUE_RETRY_EXHAUSTED',
          message: `Queue job ไปถึง DLQ หลัง Retry ครบ
message_id=${message.id}
job_type=${job?.body?.type ?? 'unknown'}`,
          details: { queueName: batch.queue, attempts: readAttempts(message) },
        }));
      }
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
  await markQueueWorkTerminal({
    env: input.env,
    message: input.message,
    jobType: input.job?.body?.type,
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
    retryCount: Math.max(0, readAttempts(input.message) - 1),
    status: 'open',
  });
  if (shouldCreateQueueFailureAlert(input.job?.body?.type)) {
    await store.saveSystemAlert(createSystemAlert({
      alertId: `alert:${dlqId}`,
      alertType: 'queue_permanent_failure',
      severity: 'critical',
      platform: platformFromJobType(input.job?.body?.type),
      errorCode: input.error?.code ?? 'PERMANENT_QUEUE_FAILURE',
      message: `Queue job หยุดแบบ Permanent
message_id=${input.message.id}
job_type=${input.job?.body?.type ?? 'unknown'}
error=${input.error instanceof Error ? input.error.message : String(input.error)}`,
      details: { attempts: readAttempts(input.message) },
    }));
  }
}

async function markQueueWorkTerminal(input) {
  const platform = platformFromJobType(input.jobType);
  if (!new Set(['youtube', 'tiktok']).has(platform)) return false;
  // Dependency-injected/non-production route อาจไม่มี D1 binding;
  // Production path ยัง fail-closed ที่ createOperationalStore เมื่อ binding หาย
  if (!input.env?.MKT_STATE_DB) return false;
  const workStore = new D1ResumableWorkStore({ db: input.env?.MKT_STATE_DB });
  const result = await workStore.abandonWork({
    workKey: `${platform}:${requireJobText(input.message?.id, 'message.id')}`,
    reason: input.reason,
    auditReference: input.auditReference,
  });
  await workStore.cleanupExpiredWork({ limit: 25 });
  return result;
}

function platformFromJobType(type) {
  if (typeof type !== 'string') return 'system';
  if (type.startsWith('report.')) return 'tiktok';
  const prefix = type.split('.')[0];
  return new Set(['facebook', 'instagram', 'tiktok', 'youtube']).has(prefix) ? prefix : 'system';
}

function shouldCreateQueueFailureAlert(jobType) {
  // Mirror delivery failure must not create a new mirrored alert, otherwise Lark outage
  // would recursively enqueue more mirror jobs after every terminal/DLQ event.
  return jobType !== JOB_TYPES.RELIABILITY_MIRROR_DELIVER;
}
