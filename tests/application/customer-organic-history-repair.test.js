import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { repairCustomerOrganicContentHistoryBatch } from '../../packages/application/src/use-cases/repair-customer-organic-content-history.js';
import { D1MarketingHistoryStore } from '../../packages/connectors/src/d1-marketing-history-store.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL('../../migrations/0009_storage_foundation.sql', import.meta.url);
const FACEBOOK_ACCOUNT = '982406442148381';
const YOUTUBE_ACCOUNT = 'UC1NVIjalyZhB2hqf3sl9GMA';

test('Facebook history repair writes exact provider facts to D1/Lark and reruns as a no-op', async () => {
  const runtime = await createRuntime();
  try {
    seedContentState(runtime.d1, {
      platform: 'facebook', sourceAccountId: FACEBOOK_ACCOUNT,
      externalContentId: 'post-1', publishedAt: '2026-06-19',
    });
    const facebookSource = {
      async fetchContentInsightsPage(input) {
        assert.deepEqual(input, {
          pageId: FACEBOOK_ACCOUNT,
          contentId: 'post-1',
          since: '2026-06-19',
          until: '2026-06-20',
        });
        return {
          rows: [
            { name: 'post_media_view', period: 'day', values: [{ value: 123, end_time: '2026-06-19T12:00:00+07:00' }] },
            { name: 'post_total_media_view_unique', period: 'day', values: [{ value: 100, end_time: '2026-06-19T12:00:00+07:00' }] },
            { name: 'post_media_view', period: 'lifetime', values: [{ value: 999 }] },
          ],
        };
      },
    };
    const input = {
      execute: true,
      platform: 'facebook',
      metricDate: '2026-06-19',
      batchIndex: 0,
      db: runtime.d1,
      store: runtime.store,
      repository: runtime.lark.repository,
      syncEngine: new TableSyncEngine(),
      tableId: 'content-daily',
      facebookSource,
    };

    const first = await repairCustomerOrganicContentHistoryBatch(input);
    assert.equal(first.d1Created, 1);
    assert.equal(first.larkCreated, 1);
    assert.deepEqual(first.readback, { d1: true, lark: true, duplicateStableKeys: 0 });
    const stored = runtime.d1.database.prepare(`
      SELECT metric_date,views,unique_viewers,likes,comments,shares,observation_kind
      FROM organic_content_observations
    `).get();
    assert.deepEqual(stored, {
      metric_date: '2026-06-19', views: 123, unique_viewers: 100,
      likes: null, comments: null, shares: null, observation_kind: 'backfill',
    });
    assert.equal(
      runtime.lark.byKey('facebook:982406442148381:post-1:2026-06-19').views,
      123,
    );
    assert.deepEqual(
      Object.keys(runtime.lark.byKey('facebook:982406442148381:post-1:2026-06-19')).sort(),
      [
        'account_id', 'avg_watch_time_seconds', 'comments', 'completion_rate',
        'content_daily_key', 'external_content_id', 'likes', 'metric_date', 'platform',
        'shares', 'total_watch_time_seconds', 'unique_viewers', 'views',
      ],
    );

    const second = await repairCustomerOrganicContentHistoryBatch({
      ...input,
      syncEngine: new TableSyncEngine(),
    });
    assert.equal(second.replay, true);
    assert.equal(second.d1Created, 0);
    assert.equal(second.d1Skipped, 1);
    assert.equal(second.larkCreated, 0);
    assert.equal(second.larkSkipped, 1);
    assert.equal(runtime.lark.size(), 1);
  } finally {
    runtime.d1.close();
  }
});

test('YouTube history repair requests cumulative views and keeps unavailable metrics null', async () => {
  const runtime = await createRuntime();
  try {
    for (const [externalContentId, publishedAt] of [
      ['video-1', '2026-06-01'],
      ['video-2', '2026-06-10'],
    ]) {
      seedContentState(runtime.d1, {
        platform: 'youtube', sourceAccountId: YOUTUBE_ACCOUNT,
        externalContentId, publishedAt,
      });
    }
    let analyticsInput = null;
    const result = await repairCustomerOrganicContentHistoryBatch({
      execute: false,
      platform: 'youtube',
      metricDate: '2026-06-19',
      batchIndex: 0,
      db: runtime.d1,
      store: runtime.store,
      youtubeOwnerClient: {
        async getChannel() { return { id: YOUTUBE_ACCOUNT }; },
        async queryAnalytics(input) {
          analyticsInput = input;
          return {
            columnHeaders: [{ name: 'video' }, { name: 'views' }],
            rows: [['video-1', 77]],
          };
        },
      },
    });
    assert.equal(result.mode, 'preview');
    assert.equal(result.providerRows, 2);
    assert.equal(result.sourceMetricRows, 1);
    assert.equal(result.larkRequired, false);
    assert.equal(result.larkCreate, 0);
    assert.equal(result.d1Writes, 0);
    assert.deepEqual(analyticsInput, {
      channelId: YOUTUBE_ACCOUNT,
      startDate: '2005-04-23',
      endDate: '2026-06-19',
      dimensions: 'video',
      metrics: 'views',
      filters: 'video==video-1,video-2',
      sort: 'video',
      maxResults: 200,
      startIndex: 1,
    });
    assert.equal(runtime.d1.database.prepare(
      'SELECT COUNT(*) AS count FROM organic_content_observations',
    ).get().count, 0);
    assert.equal(runtime.lark.size(), 0);
  } finally {
    runtime.d1.close();
  }
});

test('YouTube history repair completes D1 authority without expanding the bounded Lark cache', async () => {
  const runtime = await createRuntime();
  try {
    seedContentState(runtime.d1, {
      platform: 'youtube', sourceAccountId: YOUTUBE_ACCOUNT,
      externalContentId: 'video-1', publishedAt: '2026-06-01',
    });
    const input = {
      execute: true,
      platform: 'youtube',
      metricDate: '2026-06-19',
      batchIndex: 0,
      db: runtime.d1,
      store: runtime.store,
      youtubeOwnerClient: {
        async getChannel() { return { id: YOUTUBE_ACCOUNT }; },
        async queryAnalytics() {
          return {
            columnHeaders: [{ name: 'video' }, { name: 'views' }],
            rows: [['video-1', 77]],
          };
        },
      },
    };
    const first = await repairCustomerOrganicContentHistoryBatch(input);
    assert.equal(first.d1Created, 1);
    assert.equal(first.larkRequired, false);
    assert.equal(first.larkCreated, 0);
    assert.deepEqual(first.readback, { d1: true, lark: null, duplicateStableKeys: 0 });
    assert.equal(runtime.lark.size(), 0);
    const second = await repairCustomerOrganicContentHistoryBatch(input);
    assert.equal(second.replay, true);
    assert.equal(second.d1Skipped, 1);
    assert.equal(runtime.d1.database.prepare(
      'SELECT COUNT(*) AS count FROM organic_content_observations',
    ).get().count, 1);
  } finally {
    runtime.d1.close();
  }
});

test('history repair fails closed on active Production work before reading a provider', async () => {
  const runtime = await createRuntime();
  try {
    runtime.d1.database.prepare('INSERT INTO sync_locks VALUES (?,?)')
      .run('facebook:chemistry_k:organic', Date.now() + 60_000);
    let sourceRead = false;
    await assert.rejects(
      () => repairCustomerOrganicContentHistoryBatch({
        execute: false,
        platform: 'facebook',
        metricDate: '2026-06-19',
        db: runtime.d1,
        store: runtime.store,
        repository: runtime.lark.repository,
        syncEngine: new TableSyncEngine(),
        tableId: 'content-daily',
        facebookSource: {
          async fetchContentInsightsPage() { sourceRead = true; return { rows: [] }; },
        },
      }),
      (error) => error?.code === 'CUSTOMER_ORGANIC_HISTORY_ACTIVE_LOCK',
    );
    assert.equal(sourceRead, false);
  } finally {
    runtime.d1.close();
  }
});

test('Facebook empty exact-date result exposes only bounded date/period diagnostics', async () => {
  const runtime = await createRuntime();
  try {
    seedContentState(runtime.d1, {
      platform: 'facebook', sourceAccountId: FACEBOOK_ACCOUNT,
      externalContentId: 'post-1', publishedAt: '2026-06-19',
    });
    await assert.rejects(
      () => repairCustomerOrganicContentHistoryBatch({
        execute: false,
        platform: 'facebook',
        metricDate: '2026-06-19',
        batchIndex: 0,
        db: runtime.d1,
        store: runtime.store,
        repository: runtime.lark.repository,
        syncEngine: new TableSyncEngine(),
        tableId: 'content-daily',
        facebookSource: {
          async fetchContentInsightsPage() {
            return {
              rows: [{
                name: 'post_media_view', period: 'day',
                values: [{ value: 123, end_time: '2026-06-20T00:00:00+0000' }],
              }],
            };
          },
        },
      }),
      (error) => {
        assert.equal(error?.code, 'CUSTOMER_ORGANIC_HISTORY_SOURCE_METRICS_EMPTY');
        assert.deepEqual(error?.details?.sourceDiagnostics, {
          returnedDates: [['2026-06-20', 1]],
          returnedPeriods: [['day', 1]],
        });
        assert.equal(JSON.stringify(error.details).includes('post-1'), false);
        assert.equal(JSON.stringify(error.details).includes('123'), false);
        return true;
      },
    );
  } finally {
    runtime.d1.close();
  }
});

async function createRuntime() {
  const d1 = createSqliteD1();
  d1.exec(await readFile(MIGRATION_URL, 'utf8'));
  d1.exec('CREATE TABLE sync_locks (lock_key TEXT PRIMARY KEY, expires_at INTEGER NOT NULL);');
  return {
    d1,
    store: new D1MarketingHistoryStore({ db: d1 }),
    lark: createLarkRepository(),
  };
}

function seedContentState(d1, input) {
  const publishedAt = Date.parse(`${input.publishedAt}T00:00:00+07:00`);
  d1.database.prepare(`
    INSERT INTO organic_content_state (
      content_key,customer_profile,customer_key,platform,account_key,source_account_id,
      external_content_id,content_type,published_at,first_seen_at,last_observed_at,
      source_availability_status,metrics_hash,metadata_hash,last_coverage_run_id,
      last_sync_run_id,created_at,updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    `${input.platform}:chemistry_k:${input.externalContentId}`,
    'chemistry_k', 'chemistry_k', input.platform, 'chemistry_k', input.sourceAccountId,
    input.externalContentId, 'video', publishedAt, publishedAt, publishedAt,
    'available', 'metrics', 'metadata', 'coverage', 'sync', publishedAt, publishedAt,
  );
}

function createLarkRepository() {
  const rows = new Map();
  let sequence = 0;
  const repository = {
    async prepareRows(_tableId, values) { return values; },
    async prepareExistingRecords(_tableId, values) { return values; },
    async listByFieldValues(_tableId, fieldName, values) {
      const allowed = new Set(values);
      return [...rows.entries()]
        .filter(([, fields]) => allowed.has(fields[fieldName]))
        .map(([recordId, fields]) => ({ recordId, fields }));
    },
    async createMany(_tableId, values) {
      for (const fields of values) rows.set(`record-${sequence++}`, { ...fields });
      return { created: values.length };
    },
    async updateMany() { throw new Error('Historical repair must never update Lark'); },
  };
  return {
    repository,
    size() { return rows.size; },
    byKey(key) {
      return [...rows.values()].find((fields) => fields.content_daily_key === key) ?? null;
    },
  };
}
