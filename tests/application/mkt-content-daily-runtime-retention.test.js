import test from 'node:test';
import assert from 'node:assert/strict';
import { runMktContentDailyRetention } from '../../packages/application/src/use-cases/mkt-content-daily-retention.js';
import { processJob } from '../../apps/sync-worker/src/active-job-router.js';
import { buildScheduledJobs, PRIMARY_SCHEDULE_CRON } from '../../apps/sync-worker/src/scheduled-jobs.js';

const day = (value) => Date.parse(`${value}T00:00:00+07:00`);
const record = (recordId, platform, content, date) => ({
  recordId,
  fields: {
    content_daily_key: `${platform}:chemistry_k:${content}:${date}`,
    platform,
    account_id: 'chemistry_k',
    external_content_id: content,
    metric_date: day(date),
  },
});

test('scheduled retention preserves deferred Facebook and converges exact non-Facebook deletes', async () => {
  let rows = [
    record('facebook', 'facebook', 'fb', '2026-06-01'),
    record('old', 'tiktok', 'tt', '2026-06-01'),
    record('latest', 'tiktok', 'tt', '2026-08-15'),
  ];
  const client = {
    async listRecords() { return rows; },
    async batchDeleteRecords(input) {
      const deleted = new Set(input.recordIds);
      await input.beforeChunk();
      rows = rows.filter((row) => !deleted.has(row.recordId));
      return { deleted: deleted.size };
    },
  };
  const result = await runMktContentDailyRetention({
    client,
    db: unlockedDb(),
    tableId: 'mkt-daily',
    deferredPlatforms: ['facebook'],
    retentionDays: 1,
    maxRetainedRecords: 2,
  });
  assert.deepEqual(result, {
    status: 'completed',
    contractVersion: 'mkt-content-daily-retention-v3',
    recordsBefore: 3,
    recordsAfter: 2,
    retained: 2,
    deleted: 1,
    effectiveRetentionDays: 1,
    deferredPlatforms: ['facebook'],
    d1Mutations: 0,
    recordCreates: 0,
    recordUpdates: 0,
  });
  assert.deepEqual(rows.map((row) => row.recordId), ['facebook', 'latest']);
});

test('runtime retention fails before Lark delete when any sync lock is active', async () => {
  let deleteCalls = 0;
  await assert.rejects(() => runMktContentDailyRetention({
    client: {
      async listRecords() { return []; },
      async batchDeleteRecords() { deleteCalls += 1; },
    },
    db: lockedDb(),
    tableId: 'mkt-daily',
  }), (error) => error?.code === 'MKT_CONTENT_DAILY_RETENTION_ACTIVE_LOCK');
  assert.equal(deleteCalls, 0);
});

test('scheduler emits one stable retention job at 08:05 Bangkok and defers Facebook explicitly', () => {
  const jobs = buildScheduledJobs({
    event: { cron: PRIMARY_SCHEDULE_CRON },
    scheduledAt: '2026-08-15T01:05:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_REPORT_D1_READ_ENABLED: 'true',
      MKT_LARK_DAILY_RETENTION_ENABLED: 'true',
      MKT_CONTENT_DAILY_RETENTION_TIME: '08:05',
      MKT_CONTENT_DAILY_RETENTION_DEFERRED_PLATFORMS: 'facebook',
    },
  });
  assert.equal(jobs[0].type, 'lark.mkt-content-daily.retention');
  assert.equal(jobs[0].operationId, 'mkt-content-daily-retention-20260815');
  assert.deepEqual(jobs[0].deferredPlatforms, ['facebook']);
  assert.equal(jobs.at(-1).type, 'system.reliability-mirror.deliver');
});

test('active router invokes retention without loading a connector runtime', async () => {
  const rows = [record('one', 'youtube', 'one', '2026-08-15')];
  let runtimeLoads = 0;
  const result = await processJob({
    env: {
      MKT_REPORT_D1_READ_ENABLED: 'true',
      MKT_LARK_DAILY_RETENTION_ENABLED: 'true',
      LARK_TABLE_MKT_CONTENT_DAILY: 'mkt-daily',
    },
    job: { body: { type: 'lark.mkt-content-daily.retention', deferredPlatforms: ['facebook'] } },
    getRuntimeConfig() { runtimeLoads += 1; throw new Error('must not load'); },
    getInfrastructure() {
      return {
        getLarkBitableClient: () => ({
          async listRecords() { return rows; },
          async batchDeleteRecords() { return { deleted: 0 }; },
        }),
        getStateDb: () => unlockedDb(),
      };
    },
  });
  assert.equal(result.recordsAfter, 1);
  assert.equal(runtimeLoads, 0);
});

function unlockedDb() { return dbWithLocks(0); }
function lockedDb() { return dbWithLocks(1); }
function dbWithLocks(activeLocks) {
  return {
    prepare() {
      return {
        bind() {
          return { async first() { return { active_locks: activeLocks }; } };
        },
      };
    },
  };
}
