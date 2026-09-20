import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_BOUNDED_DAILY_TABLE_CONTRACTS,
  runLarkBoundedDailyRetention,
} from '../../packages/application/src/use-cases/lark-bounded-daily-retention.js';
import { processJob } from '../../apps/sync-worker/src/active-job-router.js';
import { buildScheduledJobs, PRIMARY_SCHEDULE_CRON } from '../../apps/sync-worker/src/scheduled-jobs.js';

const NOW = Date.parse('2026-09-19T08:00:00+07:00');
const TABLES = Object.freeze(Object.fromEntries(
  LARK_BOUNDED_DAILY_TABLE_CONTRACTS.map((contract) => [contract.tableKey, `tbl_${contract.tableKey}`]),
));

test('bounded Daily retention deletes only oldest D1-proven rows and honors one global batch cap', async () => {
  const old = row('rec-old', 'conversation_daily_key', 'chatwoot:chemistry_k:conversation:7:2026-04-03', '2026-04-03');
  const recent = row('rec-recent', 'conversation_daily_key', 'chatwoot:chemistry_k:conversation:8:2026-09-18', '2026-09-18');
  const client = retentionClient({
    totals: { mktConversationDaily: 17_000 },
    rows: { mktConversationDaily: [old, recent] },
  });
  const result = await runLarkBoundedDailyRetention({
    client,
    db: retentionDb({ verified: [old.fields.conversation_daily_key] }),
    tables: TABLES,
    customerKey: 'chemistry_k',
    timezone: 'Asia/Bangkok',
    now: NOW,
    retentionDays: 90,
    softLimit: 17_000,
    targetLimit: 15_000,
    maxDeleteRows: 1,
  });

  assert.equal(result.deleted, 1);
  assert.equal(result.d1Mutations, 0);
  assert.equal(client.deleted.length, 1);
  assert.equal(client.deleted[0].recordId, 'rec-old');
  assert.equal(result.tables.find((entry) => entry.tableKey === 'mktConversationDaily').pressureTriggered, true);
});

test('bounded Daily retention preserves a row when D1 cannot prove its exact stable key', async () => {
  const old = row('rec-old', 'conversation_daily_key', 'chatwoot:chemistry_k:conversation:7:2026-04-03', '2026-04-03');
  const client = retentionClient({ rows: { mktConversationDaily: [old] } });
  const result = await runLarkBoundedDailyRetention({
    client,
    db: retentionDb(),
    tables: TABLES,
    customerKey: 'chemistry_k',
    now: NOW,
  });
  assert.equal(result.deleted, 0);
  assert.equal(client.deleted.length, 0);
  assert.equal(result.tables.find((entry) => entry.tableKey === 'mktConversationDaily').safetyBlocked, 1);
});

test('bounded Daily retention trims the oldest proven row before 90 days when the soft limit is reached', async () => {
  const recent = row(
    'rec-recent',
    'conversation_daily_key',
    'chatwoot:chemistry_k:conversation:9:2026-09-18',
    '2026-09-18',
  );
  const client = retentionClient({
    totals: { mktConversationDaily: 17_000 },
    rows: { mktConversationDaily: [recent] },
  });
  const result = await runLarkBoundedDailyRetention({
    client,
    db: retentionDb({ verified: [recent.fields.conversation_daily_key] }),
    tables: TABLES,
    customerKey: 'chemistry_k',
    now: NOW,
    maxDeleteRows: 1,
  });

  assert.equal(result.deleted, 1);
  assert.equal(client.deleted[0].recordId, 'rec-recent');
  assert.equal(result.tables.find((entry) => entry.tableKey === 'mktConversationDaily').pressureTriggered, true);
});

test('bounded Daily retention fails before reads or deletes while a sync lock is active', async () => {
  const client = retentionClient();
  await assert.rejects(() => runLarkBoundedDailyRetention({
    client,
    db: retentionDb({ activeLocks: 1 }),
    tables: TABLES,
    customerKey: 'chemistry_k',
    now: NOW,
  }), (error) => error?.code === 'LARK_BOUNDED_DAILY_RETENTION_ACTIVE_LOCK');
  assert.equal(client.countReads, 0);
  assert.equal(client.deleted.length, 0);
});

test('scheduler emits separate bounded Daily job only when its default-off flag is enabled', () => {
  const jobs = buildScheduledJobs({
    event: { cron: PRIMARY_SCHEDULE_CRON },
    scheduledAt: '2026-09-19T01:05:00.000Z',
    env: {
      DEFAULT_TIMEZONE: 'Asia/Bangkok',
      MKT_REPORT_D1_READ_ENABLED: 'true',
      MKT_LARK_DAILY_RETENTION_ENABLED: 'true',
      MKT_LARK_BOUNDED_DAILY_RETENTION_ENABLED: 'true',
      MKT_CONTENT_DAILY_RETENTION_TIME: '08:05',
      MKT_BOUNDED_DAILY_RETENTION_TIME: '08:05',
    },
  });
  const bounded = jobs.find((job) => job.type === 'lark.bounded-daily.retention');
  assert.equal(bounded.operationId, 'lark-bounded-daily-retention-20260919');
  assert.equal(bounded.trigger, 'lark_bounded_daily_retention_scheduled');
});

test('active router wires all six bounded Daily tables and keeps D1 read-only', async () => {
  const client = retentionClient();
  const result = await processJob({
    env: {
      MKT_REPORT_D1_READ_ENABLED: 'true',
      MKT_LARK_DAILY_RETENTION_ENABLED: 'true',
      MKT_LARK_BOUNDED_DAILY_RETENTION_ENABLED: 'true',
      LARK_TABLE_MKT_CONVERSATION_DAILY: TABLES.mktConversationDaily,
      LARK_TABLE_MKT_AGENT_DAILY: TABLES.mktAgentDaily,
      LARK_TABLE_MKT_INBOX_DAILY: TABLES.mktInboxDaily,
      LARK_TABLE_MKT_CONVERSATION_ACCOUNT_DAILY: TABLES.mktConversationAccountDaily,
      LARK_TABLE_MKT_COMMERCE_DAILY: TABLES.mktCommerceDaily,
      LARK_TABLE_MKT_COMMERCE_PRODUCT_DAILY: TABLES.mktCommerceProductDaily,
    },
    job: { body: { type: 'lark.bounded-daily.retention' } },
    getRuntimeConfig: () => ({ customerKey: 'chemistry_k' }),
    getInfrastructure: () => ({
      getLarkBitableClient: () => client,
      getStateDb: () => retentionDb(),
    }),
  });

  assert.equal(result.deleted, 0);
  assert.equal(result.d1Mutations, 0);
  assert.equal(result.tables.length, 6);
});

function row(recordId, keyField, stableKey, metricDate) {
  return { recordId, fields: { [keyField]: stableKey, metric_date: metricDate } };
}

function retentionClient(input = {}) {
  const counts = new Map(LARK_BOUNDED_DAILY_TABLE_CONTRACTS.map((contract) => [
    TABLES[contract.tableKey],
    input.totals?.[contract.tableKey] ?? (input.rows?.[contract.tableKey]?.length ?? 0),
  ]));
  const records = new Map(LARK_BOUNDED_DAILY_TABLE_CONTRACTS.map((contract) => [
    TABLES[contract.tableKey],
    [...(input.rows?.[contract.tableKey] ?? [])],
  ]));
  const deleted = [];
  let countReads = 0;
  return {
    appToken: 'app-token',
    deleted,
    get countReads() { return countReads; },
    async requestBitableJson(path) {
      countReads += 1;
      const tableId = [...counts.keys()].find((id) => path.includes(`/tables/${id}/records`));
      return { data: { total: counts.get(tableId) ?? 0 } };
    },
    async searchRecords({ tableId }) { return records.get(tableId) ?? []; },
    async batchDeleteRecords({ tableId, recordIds, beforeChunk }) {
      await beforeChunk();
      const ids = new Set(recordIds);
      const before = records.get(tableId) ?? [];
      const removed = before.filter((record) => ids.has(record.recordId));
      records.set(tableId, before.filter((record) => !ids.has(record.recordId)));
      counts.set(tableId, Math.max(0, (counts.get(tableId) ?? 0) - removed.length));
      deleted.push(...removed);
      return { deleted: removed.length };
    },
    async searchRecordsByFieldValues({ tableId, fieldName, values }) {
      const wanted = new Set(values);
      return (records.get(tableId) ?? []).filter((record) => wanted.has(record.fields[fieldName]));
    },
  };
}

function retentionDb(input = {}) {
  const verified = new Set(input.verified ?? []);
  return {
    prepare(sql) {
      return {
        bind(...values) {
          return {
            async first() {
              if (!sql.includes('sync_locks')) throw new Error('unexpected first query');
              return { active_locks: input.activeLocks ?? 0 };
            },
            async all() {
              if (sql.includes('sync_locks')) throw new Error('unexpected all query');
              return { results: values.slice(1).filter((key) => verified.has(key)).map((key) => ({ stable_key: key })) };
            },
          };
        },
      };
    },
  };
}
