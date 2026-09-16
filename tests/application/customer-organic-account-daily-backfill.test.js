import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runCustomerOrganicAccountDailyBackfill } from '../../packages/application/src/use-cases/run-customer-organic-account-daily-backfill.js';
import { createAccountDailyKey, createContentKey } from '../../packages/application/src/storage/marketing-history-contract.js';
import { D1MarketingHistoryStore } from '../../packages/connectors/src/d1-marketing-history-store.js';
import { D1OrganicHistoryGateway } from '../../packages/connectors/src/d1-organic-history-gateway.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL('../../migrations/0009_storage_foundation.sql', import.meta.url);
const RELIABILITY_MIGRATION_URL = new URL('../../migrations/0002_reliability.sql', import.meta.url);
const NOW = Date.parse('2026-09-16T01:00:00.000Z');

test('Customer Organic Account Daily backfill previews, writes, reads back and proves idempotency', async () => {
  const d1 = createSqliteD1();
  try {
    d1.exec(await readFile(MIGRATION_URL, 'utf8'));
    d1.exec(await readFile(RELIABILITY_MIGRATION_URL, 'utf8'));
    const store = new D1MarketingHistoryStore({ db: d1 });
    await store.upsertOrganicAccountDailyFact(youtubeFact());
    await store.upsertOrganicContentState(tiktokState());
    const repository = createRepository();
    const input = {
      db: d1,
      store,
      repository,
      syncEngine: new TableSyncEngine(),
      tableId: 'tbl-account-daily',
      observedAt: NOW,
    };

    const preview = await runCustomerOrganicAccountDailyBackfill(input);
    assert.equal(preview.mode, 'preview');
    assert.equal(preview.source.youtubeFacts, 1);
    assert.equal(preview.metricDate, '2026-09-16');
    assert.equal(preview.plan.create, 2);
    assert.equal(repository.records.size, 0);
    assert.equal(d1.database.prepare(
      "SELECT COUNT(*) AS total FROM organic_account_daily_facts WHERE platform='tiktok'",
    ).get().total, 0);

    const result = await runCustomerOrganicAccountDailyBackfill({ ...input, execute: true });
    assert.equal(result.lark.expectedRows, 2);
    assert.equal(result.d1.readbackRows, 1);
    assert.equal(result.lark.readbackRows, 2);
    assert.equal(result.rerun.skipped, 2);
    assert.equal(repository.records.size, 2);
    assert.equal(d1.database.prepare(
      "SELECT COUNT(*) AS total FROM organic_account_daily_facts WHERE platform='tiktok'",
    ).get().total, 1);

    const rerun = await runCustomerOrganicAccountDailyBackfill({ ...input, execute: true });
    assert.equal(rerun.lark.created, 0);
    assert.equal(rerun.lark.updated, 0);
    assert.equal(rerun.lark.skipped, 2);
  } finally {
    d1.close();
  }
});

test('Customer Organic Account Daily backfill rejects an active Organic lock before writes', async () => {
  const d1 = createSqliteD1();
  try {
    d1.exec(await readFile(MIGRATION_URL, 'utf8'));
    d1.exec(await readFile(RELIABILITY_MIGRATION_URL, 'utf8'));
    const store = new D1MarketingHistoryStore({ db: d1 });
    await store.upsertOrganicAccountDailyFact(youtubeFact());
    await store.upsertOrganicContentState(tiktokState());
    d1.database.prepare(`
      INSERT INTO sync_locks(lock_key, owner_id, acquired_at, expires_at, updated_at)
      VALUES (?, ?, ?, ?, ?)
    `).run('production:tiktok:chemistry_k:daily', 'run-1', NOW, Date.now() + 86_400_000, NOW);
    const repository = createRepository();
    await assert.rejects(() => runCustomerOrganicAccountDailyBackfill({
      db: d1, store, repository, syncEngine: new TableSyncEngine(),
      tableId: 'tbl-account-daily', observedAt: NOW, execute: true,
    }), /active production lock/u);
    assert.equal(repository.records.size, 0);
    assert.equal(d1.database.prepare(
      "SELECT COUNT(*) AS total FROM organic_account_daily_facts WHERE platform='tiktok'",
    ).get().total, 0);
  } finally {
    d1.close();
  }
});

test('Customer Organic Account Daily backfill rejects source drift before writes', async () => {
  const d1 = createSqliteD1();
  try {
    d1.exec(await readFile(MIGRATION_URL, 'utf8'));
    d1.exec(await readFile(RELIABILITY_MIGRATION_URL, 'utf8'));
    const store = new D1MarketingHistoryStore({ db: d1 });
    await store.upsertOrganicAccountDailyFact(youtubeFact());
    await store.upsertOrganicContentState(tiktokState());
    const realGateway = new D1OrganicHistoryGateway({ db: d1, store });
    let reads = 0;
    const gateway = {
      async readOrganicAccountSnapshotAggregate(scope) {
        const value = await realGateway.readOrganicAccountSnapshotAggregate(scope);
        reads += 1;
        return reads === 1 ? value : { ...value, views_total: value.views_total + 1 };
      },
    };
    const repository = createRepository();
    await assert.rejects(() => runCustomerOrganicAccountDailyBackfill({
      db: d1, store, gateway, repository, syncEngine: new TableSyncEngine(),
      tableId: 'tbl-account-daily', observedAt: NOW, execute: true,
    }), /snapshot changed/u);
    assert.equal(repository.records.size, 0);
    assert.equal(d1.database.prepare(
      "SELECT COUNT(*) AS total FROM organic_account_daily_facts WHERE platform='tiktok'",
    ).get().total, 0);
  } finally {
    d1.close();
  }
});

function youtubeFact() {
  const row = {
    customer_key: 'chemistry_k',
    platform: 'youtube',
    account_key: 'chemistry_k',
    source_account_id: 'UC1NVIjalyZhB2hqf3sl9GMA',
    metric_date: '2026-09-15',
    account_timezone: 'Asia/Bangkok',
    followers: 146_000,
    follows: null,
    profile_views: null,
    views: 7_000_000,
    reach: null,
    accounts_engaged: null,
    total_interactions: null,
    net_follows: null,
    data_status: 'complete',
    coverage_run_id: 'coverage:youtube:test',
    source_revision: 'youtube-revision',
    fetched_at: NOW,
    sync_run_id: 'history:youtube:test',
    created_at: NOW,
    updated_at: NOW,
  };
  return { ...row, account_daily_key: createAccountDailyKey(row) };
}

function tiktokState() {
  const row = {
    customer_profile: 'chemistry-k-prod',
    customer_key: 'chemistry_k',
    platform: 'tiktok',
    account_key: 'chemistry_k',
    source_account_id: 'chemistry_k',
    external_content_id: 'video-1',
    content_type: 'video',
    published_at: NOW - 86_400_000,
    first_seen_at: NOW,
    last_observed_at: NOW,
    last_changed_at: NOW,
    source_availability_status: 'available',
    views: 100,
    likes: 10,
    comments: 1,
    shares: 2,
    unique_viewers: null,
    avg_watch_time_seconds: null,
    total_watch_time_seconds: null,
    completion_rate: null,
    metrics_hash: 'metrics',
    metadata_hash: 'metadata',
    last_coverage_run_id: 'coverage:tiktok:test',
    last_sync_run_id: 'history:tiktok:test',
    created_at: NOW,
    updated_at: NOW,
  };
  return { ...row, content_key: createContentKey(row) };
}

function createRepository() {
  const records = new Map();
  let sequence = 0;
  return {
    records,
    async listByFieldValues(_tableId, _fieldName, values) {
      return values.flatMap((key) => records.has(key) ? [records.get(key)] : []);
    },
    async prepareRows(_tableId, rows) { return rows; },
    async prepareExistingRecords(_tableId, rows) { return rows; },
    async createMany(_tableId, rows) {
      for (const fields of rows) {
        records.set(fields.account_daily_key, {
          recordId: `record-${sequence += 1}`,
          fields: { ...fields },
        });
      }
      return { created: rows.length };
    },
    async updateMany(_tableId, rows) {
      for (const update of rows) {
        const current = [...records.values()].find((record) => record.recordId === update.recordId);
        current.fields = { ...update.fields };
      }
      return { updated: rows.length };
    },
  };
}
