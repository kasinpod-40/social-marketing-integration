import { createSyncLogEntry } from '../../../packages/domain/src/entities/sync-log.js';

export default {
  async scheduled(event, env, ctx) {
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

  async queue(batch, env, ctx) {
    const jobs = batch.messages.map((message) => normalizeQueueMessage(message));
    const results = await Promise.allSettled(jobs.map((job) => processJob(job)));

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        batch.messages[index].ack();
      } else {
        batch.messages[index].retry();
      }
    });
  },
};

function normalizeQueueMessage(message) {
  return {
    id: message.id,
    body: message.body ?? {},
    receivedAt: new Date().toISOString(),
  };
}

async function processJob(job) {
  if (!job.body?.type) {
    throw new Error(`Invalid sync job without type: ${job.id}`);
  }

  return { ok: true, jobId: job.id, type: job.body.type };
}
