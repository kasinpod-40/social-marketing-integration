import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { D1YouTubeAnalyticsDailyStore } from '../../packages/connectors/src/youtube/d1-youtube-analytics-daily-store.js';

const migration = readFileSync('migrations/0020_youtube_analytics_daily_facts.sql', 'utf8');

test('YouTube Analytics migration defines D1 period-fact authority and bounded indexes', () => {
  assert.match(migration, /CREATE TABLE IF NOT EXISTS youtube_analytics_daily_facts/u);
  assert.match(migration, /analytics_daily_key TEXT PRIMARY KEY/u);
  assert.match(migration, /idx_youtube_analytics_daily_account_date/u);
  assert.match(migration, /idx_youtube_analytics_daily_video_date/u);
});

test('D1 YouTube Analytics store preserves signed adjustments and scopes reconciliation', async () => {
  const db = createD1();
  const store = new D1YouTubeAnalyticsDailyStore({ db });
  assert.equal((await store.assertSchemaReady()).ready, true);

  const row = {
    raw_analytics_daily_key: 'youtube:channel_A:video_A:2026-08-09',
    source_metric_date: '2026-08-09',
    channel_id: 'channel_A',
    video_id: 'video_A',
    views: 10,
    likes: -1,
    comments: 0,
    shares: -2,
    estimated_minutes_watched: 4.5,
    average_view_duration_seconds: 27.5,
    average_view_percentage: 125.5,
    fetched_at: 1_000,
    source_payload_json: '{"source":"youtube"}',
  };
  const context = {
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    syncRunId: 'youtube:test',
  };
  assert.deepEqual(await store.upsertMany([row], context), { rows: 1, written: 1, skipped: 0 });
  assert.equal(db.rows.get(row.raw_analytics_daily_key).likes, -1);
  assert.equal(db.rows.get(row.raw_analytics_daily_key).average_view_percentage, 125.5);

  assert.deepEqual(await store.upsertMany([row], context), { rows: 1, written: 0, skipped: 1 });

  assert.deepEqual(await store.listStableKeysByScope({
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    channelId: 'channel_A',
    videoIds: ['video_A'],
    startDate: '2026-08-09',
    endDate: '2026-08-09',
  }), [row.raw_analytics_daily_key]);

  assert.deepEqual(await store.upsertMany([{ ...row, fetched_at: 999 }], context), {
    rows: 1, written: 0, skipped: 1,
  });
  assert.equal(db.rows.get(row.raw_analytics_daily_key).fetched_at, 1_000);
});

function createD1() {
  const rows = new Map();
  const db = {
    rows,
    prepare(sql) {
      return {
        bind(...bindings) {
          return {
            async first() {
              if (sql.includes('sqlite_master')) return { name: 'youtube_analytics_daily_facts' };
              return null;
            },
            async all() {
              if (!sql.includes('FROM youtube_analytics_daily_facts')) return { results: [] };
              const [customerKey, accountKey, channelId, startDate, endDate, limit] = bindings;
              return {
                results: [...rows.values()]
                  .filter((row) => row.customer_key === customerKey
                    && row.account_key === accountKey
                    && row.channel_id === channelId
                    && row.source_metric_date >= startDate
                    && row.source_metric_date <= endDate)
                  .sort((left, right) => left.analytics_daily_key.localeCompare(right.analytics_daily_key))
                  .slice(0, limit)
                  .map((row) => ({
                    analytics_daily_key: row.analytics_daily_key,
                    video_id: row.video_id,
                  })),
              };
            },
            sql,
            bindings,
          };
        },
      };
    },
    async batch(statements) {
      return statements.map(({ bindings }) => {
        const row = rowFromBindings(bindings);
        const current = rows.get(row.analytics_daily_key);
        if (current && current.fetched_at > row.fetched_at) return { meta: { changes: 0 } };
        if (current && current.fetched_at === row.fetched_at && sameFact(current, row)) {
          return { meta: { changes: 0 } };
        }
        rows.set(row.analytics_daily_key, current
          ? { ...row, created_at: current.created_at }
          : row);
        return { meta: { changes: 1 } };
      });
    },
  };
  return db;
}

function sameFact(left, right) {
  return [
    'customer_profile', 'customer_key', 'account_key', 'channel_id', 'video_id',
    'source_metric_date', 'views', 'likes', 'comments', 'shares',
    'estimated_minutes_watched', 'average_view_duration_seconds',
    'average_view_percentage', 'source_payload_json',
  ].every((fieldName) => left[fieldName] === right[fieldName]);
}

function rowFromBindings(values) {
  const names = [
    'analytics_daily_key', 'customer_profile', 'customer_key', 'account_key',
    'channel_id', 'video_id', 'source_metric_date', 'views', 'likes', 'comments',
    'shares', 'estimated_minutes_watched', 'average_view_duration_seconds',
    'average_view_percentage', 'fetched_at', 'source_payload_json', 'sync_run_id',
    'created_at', 'updated_at',
  ];
  return Object.fromEntries(names.map((name, index) => [name, values[index]]));
}
