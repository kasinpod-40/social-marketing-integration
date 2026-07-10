import { createSyncLogEntry } from '../../../packages/domain/src/entities/sync-log.js';
import { syncTikTokCreatorNativeToLark } from '../../../packages/application/src/use-cases/sync-tiktok-creator-native-to-lark.js';
import { createLarkBitableClientFromEnv } from '../../../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../../../packages/connectors/src/lark/lark-record-repository.js';
import { seedMetricDefinitions } from '../../../packages/application/src/use-cases/seed-metric-definitions.js';
import { readLarkTableIdsFromEnv } from '../../../packages/config/src/lark-table-config.js';
import { validateLarkLiveSync } from '../../../packages/application/src/use-cases/validate-lark-live-sync.js';

const JOB_TYPES = Object.freeze({
  TIKTOK_CREATOR_NATIVE_SYNC: 'tiktok.creator.native.sync',
  METRIC_DEFINITIONS_SEED: 'metric.definitions.seed',
  TIKTOK_CREATOR_NATIVE_VALIDATE: 'tiktok.creator.native.validate',
});

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
    const repository = createRepository(env);
    const results = await Promise.allSettled(jobs.map((job) => processJob({ job, env, repository })));

    results.forEach((result, index) => {
      if (result.status === 'fulfilled') {
        batch.messages[index].ack();
      } else {
        console.error(JSON.stringify({
          ok: false,
          messageId: batch.messages[index].id,
          error: result.reason instanceof Error ? result.reason.message : String(result.reason),
        }));
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

async function processJob(input) {
  const job = input.job;
  const type = requireText(job?.body?.type, `job.type:${job?.id ?? 'unknown'}`);

  if (type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_SYNC) {
    const tableIds = readLarkTableIdsFromEnv(input.env, [
      'rawTikTokCreatorVideos',
      'mktContent',
      'mktContentDaily',
      'mktClassificationDictionary',
    ]);
    return syncTikTokCreatorNativeToLark({
      repository: input.repository,
      accountId: requireText(job.body?.accountId ?? input.env?.TIKTOK_CREATOR_ACCOUNT_ID, 'TIKTOK_CREATOR_ACCOUNT_ID'),
      metricDate: requireText(job.body?.metricDate ?? todayInBangkok(), 'metricDate'),
      tables: {
        rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
        mktContent: tableIds.mktContent,
        mktContentDaily: tableIds.mktContentDaily,
        mktClassificationDictionary: tableIds.mktClassificationDictionary,
      },
    });
  }

  if (type === JOB_TYPES.TIKTOK_CREATOR_NATIVE_VALIDATE) {
    const tableIds = readLarkTableIdsFromEnv(input.env, [
      'rawTikTokCreatorVideos',
      'mktClassificationDictionary',
    ]);
    const result = await validateLarkLiveSync({
      repository: input.repository,
      accountId: requireText(job.body?.accountId ?? input.env?.TIKTOK_CREATOR_ACCOUNT_ID, 'TIKTOK_CREATOR_ACCOUNT_ID'),
      metricDate: requireText(job.body?.metricDate ?? todayInBangkok(), 'metricDate'),
      sampleLimit: job.body?.sampleLimit,
      tables: {
        rawTikTokCreatorVideos: tableIds.rawTikTokCreatorVideos,
        mktClassificationDictionary: tableIds.mktClassificationDictionary,
      },
    });
    console.log(JSON.stringify(result));
    return result;
  }

  if (type === JOB_TYPES.METRIC_DEFINITIONS_SEED) {
    const tableIds = readLarkTableIdsFromEnv(input.env, ['mktMetricDefinitions']);
    return seedMetricDefinitions({
      repository: input.repository,
      tableId: tableIds.mktMetricDefinitions,
    });
  }

  throw new Error(`Unsupported sync job type: ${type}`);
}

function createRepository(env) {
  const client = createLarkBitableClientFromEnv(env);
  return new LarkRecordRepository({ client });
}

function todayInBangkok() {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(new Date());
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`Sync worker requires ${fieldName}`);
  }

  return value.trim();
}
