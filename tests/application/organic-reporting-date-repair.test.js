import test from 'node:test';
import assert from 'node:assert/strict';

import { repairOrganicReportingDateSemantics } from '../../packages/application/src/use-cases/repair-organic-reporting-date-semantics.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const RUN_ID = 'history:youtube:f04ed8d2d644bd5de24b0a8f0298687be97f2be6a395fef2f9e87d774db6da66';
const OBSERVED_AT = 1_789_065_029_000;
const TIKTOK_FINISHED_AT = 1_789_079_890_599;

test('repairs exact YouTube reporting dates and TikTok freshness idempotently', async () => {
  const d1 = createSqliteD1();
  provisionD1(d1);
  seedD1(d1);
  const storage = createLarkStorage();
  seedLark(storage);

  const common = {
    db: d1,
    client: storage.client,
    repository: storage.repository,
    tables: { mktAccounts: 'accounts', mktContentDaily: 'daily' },
  };
  const first = await repairOrganicReportingDateSemantics({
    ...common,
    syncEngine: new TableSyncEngine(),
    execute: true,
  });
  assert.deepEqual(first.youtube.larkWrite, {
    created: 14,
    updated: 36,
    skipped: 0,
    duplicateInputRows: 0,
  });
  assert.equal(first.youtube.larkDelete.deleted, 50);
  assert.deepEqual(first.youtube.d1Write.changes, [50, 1, 1, 2]);
  assert.equal(first.tiktok.larkWrite.updated, 1);
  assert.equal(storage.byKey('daily', 'content_daily_key', 'youtube:chemistry_k:video-0:2026-09-11'), null);
  assert.equal(storage.byKey('daily', 'content_daily_key', 'youtube:chemistry_k:video-0:2026-09-10').fields.views, 100);
  assert.equal(storage.byKey('accounts', 'account_key', 'tiktok:chemistry_k').fields.last_sync_at, TIKTOK_FINISHED_AT);
  assert.deepEqual(
    d1.database.prepare('SELECT metric_date,COUNT(*) rows FROM organic_content_observations GROUP BY metric_date').all(),
    [{ metric_date: '2026-09-10', rows: 50 }],
  );

  const second = await repairOrganicReportingDateSemantics({
    ...common,
    syncEngine: new TableSyncEngine(),
    execute: true,
  });
  assert.deepEqual(second.youtube.larkWrite, {
    created: 0,
    updated: 0,
    skipped: 50,
    duplicateInputRows: 0,
  });
  assert.equal(second.youtube.larkDelete.deleted, 0);
  assert.deepEqual(second.youtube.d1Write.changes, [0, 0, 0, 0]);
  assert.equal(second.tiktok.larkWrite.skipped, 1);
  assert.equal(storage.table('daily').size, 50);
  d1.close();
});

function provisionD1(d1) {
  d1.exec(`
    CREATE TABLE sync_locks (lock_key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);
    CREATE TABLE sync_runs (sync_run_id TEXT PRIMARY KEY, platform TEXT, status TEXT, finished_at INTEGER);
    CREATE TABLE organic_content_observations (
      observation_key TEXT PRIMARY KEY, content_key TEXT, customer_key TEXT, platform TEXT,
      account_key TEXT, external_content_id TEXT, observed_at INTEGER, metric_date TEXT,
      views INTEGER, likes INTEGER, comments INTEGER, shares INTEGER, unique_viewers INTEGER,
      avg_watch_time_seconds REAL, total_watch_time_seconds REAL, completion_rate REAL,
      sync_run_id TEXT
    );
    CREATE TABLE data_coverage_runs (
      coverage_run_id TEXT PRIMARY KEY, sync_run_id TEXT, customer_key TEXT, platform TEXT,
      account_key TEXT, dataset_key TEXT, period_start TEXT, period_end TEXT, status TEXT,
      completed_at INTEGER, updated_at INTEGER
    );
    CREATE TABLE organic_account_daily_facts (
      account_daily_key TEXT PRIMARY KEY, customer_key TEXT, platform TEXT, account_key TEXT,
      source_account_id TEXT, metric_date TEXT, followers INTEGER, views INTEGER, data_status TEXT,
      coverage_run_id TEXT, source_revision TEXT, fetched_at INTEGER, sync_run_id TEXT,
      created_at INTEGER, updated_at INTEGER
    );
  `);
}

function seedD1(d1) {
  const insertObservation = d1.database.prepare(`
    INSERT INTO organic_content_observations VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `);
  for (let index = 0; index < 50; index += 1) {
    insertObservation.run(
      `observation-${index}`, `youtube:chemistry_k:video-${index}`, 'chemistry_k', 'youtube',
      'chemistry_k', `video-${index}`, OBSERVED_AT, '2026-09-11', 100 + index, 10, 2, 1,
      null, null, null, null, RUN_ID,
    );
  }
  d1.database.prepare('INSERT INTO sync_runs VALUES (?,?,?,?)').run(
    'tiktok-post-lark:watermark:test', 'tiktok', 'success', TIKTOK_FINISHED_AT,
  );
  for (const dataset of ['organic_account_snapshot', 'organic_content_cumulative']) {
    d1.database.prepare('INSERT INTO data_coverage_runs VALUES (?,?,?,?,?,?,?,?,?,?,?)').run(
      `coverage-${dataset}`, RUN_ID, 'chemistry_k', 'youtube', 'chemistry_k', dataset,
      '2026-09-11', '2026-09-11', 'complete', OBSERVED_AT, OBSERVED_AT,
    );
  }
  const insertAccount = d1.database.prepare('INSERT INTO organic_account_daily_facts VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)');
  insertAccount.run(
    'youtube:chemistry_k:2026-09-10', 'chemistry_k', 'youtube', 'chemistry_k', 'channel',
    '2026-09-10', 900, 9000, 'complete', 'old-coverage', 'old', OBSERVED_AT - 1,
    'old-run', OBSERVED_AT - 1, OBSERVED_AT - 1,
  );
  insertAccount.run(
    'youtube:chemistry_k:2026-09-11', 'chemistry_k', 'youtube', 'chemistry_k', 'channel',
    '2026-09-11', 901, 9001, 'complete', 'coverage-organic_account_snapshot', 'new',
    OBSERVED_AT, RUN_ID, OBSERVED_AT, OBSERVED_AT,
  );
}

function createLarkStorage() {
  const tables = new Map([['daily', new Map()], ['accounts', new Map()]]);
  let sequence = 1;
  const table = (tableId) => tables.get(tableId);
  const fieldKey = (tableId) => tableId === 'daily' ? 'content_daily_key' : 'account_key';
  const byKey = (tableId, keyField, key) => (
    [...table(tableId).values()].find((record) => record.fields[keyField] === key) ?? null
  );
  const repository = {
    async prepareRows(_tableId, rows) { return rows; },
    async prepareExistingRecords(_tableId, records) { return records; },
    async listByFieldValues(tableId, keyField, values) {
      const allowed = new Set(values);
      return [...table(tableId).values()].filter((record) => allowed.has(record.fields[keyField]));
    },
    async createMany(tableId, rows) {
      for (const fields of rows) {
        const recordId = `created-${sequence++}`;
        table(tableId).set(recordId, { recordId, fields: { ...fields } });
      }
      return { created: rows.length };
    },
    async updateMany(tableId, records) {
      for (const record of records) table(tableId).set(record.recordId, { recordId: record.recordId, fields: { ...record.fields } });
      return { updated: records.length };
    },
  };
  const client = {
    async searchRecordsByFieldValues({ tableId, fieldName, values }) {
      const allowed = new Set(values);
      return [...table(tableId).values()].filter((record) => allowed.has(record.fields[fieldName]));
    },
    async batchDeleteRecords({ tableId, recordIds }) {
      for (const recordId of recordIds) table(tableId).delete(recordId);
      return { deleted: recordIds.length };
    },
  };
  return { table, byKey, repository, client };
}

function seedLark(storage) {
  const daily = storage.table('daily');
  for (let index = 0; index < 50; index += 1) {
    daily.set(`wrong-${index}`, {
      recordId: `wrong-${index}`,
      fields: dailyFields(index, '2026-09-11', 100 + index),
    });
    if (index < 36) {
      daily.set(`target-${index}`, {
        recordId: `target-${index}`,
        fields: dailyFields(index, '2026-09-10', index),
      });
    }
  }
  storage.table('accounts').set('tiktok-account', {
    recordId: 'tiktok-account',
    fields: { account_key: 'tiktok:chemistry_k', platform: 'tiktok', last_sync_at: TIKTOK_FINISHED_AT - 86_400_000 },
  });
}

function dailyFields(index, date, views) {
  return {
    content_daily_key: `youtube:chemistry_k:video-${index}:${date}`,
    metric_date: Date.parse(`${date}T00:00:00+07:00`),
    platform: 'youtube',
    account_id: 'chemistry_k',
    external_content_id: `video-${index}`,
    views,
    likes: 10,
    comments: 2,
    shares: 1,
    unique_viewers: null,
    avg_watch_time_seconds: null,
    total_watch_time_seconds: null,
    completion_rate: null,
  };
}
