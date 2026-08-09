import { assertConnectorRunnable } from '../../../packages/application/src/connectors/connector-registry.js';
import {
  assertJobImplemented,
  getJobDefinition,
} from '../../../packages/application/src/jobs/job-catalog.js';
import { loadCustomerRuntimeConfig } from '../../../packages/config/src/customer-profiles.js';
import { permanentError } from '../../../packages/shared/src/errors/runtime-error.js';
import { buildScheduledJobs } from './scheduled-jobs.js';
import { logQueueResult } from './worker-runtime-support.js';

/** Cron ทำหน้าที่เป็น Producer เท่านั้น เพื่อให้ Retry/Lock/DLQ อยู่ใน Queue flow เดียวกัน */
export async function produceScheduledJobs(event, env) {
  const scheduledAt = new Date(event.scheduledTime).toISOString();
  const jobs = buildScheduledJobs({ event, env, scheduledAt });

  if (jobs.length === 0) {
    logQueueResult({
      ok: true,
      scope: 'scheduler',
      status: 'skipped',
      reason: 'no_scheduled_jobs_due',
      requestedAt: scheduledAt,
    });
    return;
  }

  const connectorKeys = new Set(jobs
    .map((job) => assertJobImplemented(getJobDefinition(job.type)).connectorKey)
    .filter(Boolean));
  if (connectorKeys.size > 0) {
    const runtimeConfig = loadCustomerRuntimeConfig(env);
    for (const connectorKey of connectorKeys) {
      assertConnectorRunnable(runtimeConfig, connectorKey);
    }
  }
  const queue = env?.MKT_SYNC_QUEUE;
  if (typeof queue?.send !== 'function' && typeof queue?.sendBatch !== 'function') {
    throw permanentError('Missing Queue producer binding MKT_SYNC_QUEUE', {
      code: 'MKT_SYNC_QUEUE_BINDING_REQUIRED',
    });
  }

  if (typeof queue.sendBatch === 'function' && jobs.length > 1) {
    await queue.sendBatch(jobs.map((body) => Object.freeze({ body })));
  } else {
    for (const job of jobs) await queue.send(job);
  }
  for (const job of jobs) {
    logQueueResult({
      ok: true,
      scope: 'scheduler',
      status: 'enqueued',
      type: job.type,
      requestedAt: scheduledAt,
      reportSettingKey: job.reportSettingKey ?? null,
      metricDate: job.metricDate ?? null,
      periodEnd: job.periodEnd ?? null,
    });
  }
}
