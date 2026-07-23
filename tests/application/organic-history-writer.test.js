import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { D1OrganicHistoryGateway } from '../../packages/connectors/src/d1-organic-history-gateway.js';
import { createOrganicHistoryWriter } from '../../packages/application/src/storage/organic-history-writer.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL('../../migrations/0009_storage_foundation.sql', import.meta.url);
const DAY = 86_400_000;
const START = Date.parse('2026-07-23T03:00:00.000Z');

test('Organic history gateway fails closed before Migration 0009 exists', async () => {
  const d1 = createSqliteD1();
  try {
    const gateway = new D1OrganicHistoryGateway({ db: d1 });
    await assert.rejects(
      () => gateway.assertSchemaReady(),
      (error) => error.code === 'D1_MARKETING_STORAGE_SCHEMA_NOT_READY'
        && error.details.missingTables.includes('organic_content_state'),
    );
  } finally {
    d1.close();
  }
});

test('Organic history creates initial observation and retries the same durable snapshot idempotently', async () => {
  const { d1, gateway } = await createGateway();
  try {
    const writer = createWriter(gateway, { observedAt: START, suffix: 'one' });
    const batch = sourceBatch({ views: 100, likes: 10 });
    const preflight = await writer.preflightBatch(batch);
    assert.equal(preflight.stateRows.length, 1);
    assert.equal(preflight.observationRows[0].observation_kind, 'initial');
    assert.equal(preflight.observationRows[0].metric_date, '2026-07-23');

    await writer.beginCoverage({ expectedEntities: 1, expectedRows: 1, sourceWatermark: 'source-one' });
    const first = await writer.writeBatch(batch);
    const retry = await writer.writeBatch(batch);
    await writer.completeCoverage({
      expectedEntities: 1,
      observedEntities: 1,
      expectedRows: 1,
      observedRows: 1,
      writtenRows: 2,
      sourceWatermark: 'source-one',
      completedAt: START + 1,
    });

    assert.equal(first.observationsCreated, 1);
    assert.equal(retry.observationsNotRequired, 1);
    assert.equal(count(d1, 'organic_content_state'), 1);
    assert.equal(count(d1, 'organic_content_observations'), 1);
    assert.equal(count(d1, 'data_coverage_entities'), 1);
    assert.equal(d1.database.prepare('SELECT status FROM data_coverage_runs').get().status, 'complete');
  } finally {
    d1.close();
  }
});

test('new observations classify unchanged, changed and cumulative correction correctly', async () => {
  const { d1, gateway } = await createGateway();
  try {
    const initial = createWriter(gateway, { observedAt: START, suffix: 'initial' });
    await initial.writeBatch(sourceBatch({ views: 100, likes: 10, shares: null }));

    const unchanged = createWriter(gateway, { observedAt: START + DAY, suffix: 'unchanged' });
    const unchangedPlan = await unchanged.preflightBatch(
      sourceBatch({ views: 100, likes: 10, shares: null }),
    );
    assert.equal(unchangedPlan.observationRows.length, 0);
    await unchanged.writeBatch(sourceBatch({ views: 100, likes: 10, shares: null }));

    const changed = createWriter(gateway, { observedAt: START + 2 * DAY, suffix: 'changed' });
    const changedPlan = await changed.preflightBatch(
      sourceBatch({ views: 120, likes: 12, shares: 0 }),
    );
    assert.equal(changedPlan.observationRows[0].observation_kind, 'changed');
    assert.equal(changedPlan.observationRows[0].shares, 0);
    await changed.writeBatch(sourceBatch({ views: 120, likes: 12, shares: 0 }));

    const correction = createWriter(gateway, { observedAt: START + 3 * DAY, suffix: 'correction' });
    const correctionPlan = await correction.preflightBatch(
      sourceBatch({ views: 119, likes: 12, shares: 0 }),
    );
    assert.equal(correctionPlan.observationRows[0].observation_kind, 'correction');
    await correction.writeBatch(sourceBatch({ views: 119, likes: 12, shares: 0 }));

    const observations = d1.database.prepare(
      'SELECT observation_kind, metric_date FROM organic_content_observations ORDER BY observed_at',
    ).all();
    assert.deepEqual(observations, [
      { observation_kind: 'initial', metric_date: '2026-07-23' },
      { observation_kind: 'changed', metric_date: '2026-07-25' },
      { observation_kind: 'correction', metric_date: '2026-07-26' },
    ]);
    assert.equal(count(d1, 'organic_content_state'), 1);
  } finally {
    d1.close();
  }
});

async function createGateway() {
  const d1 = createSqliteD1();
  d1.exec(await readFile(MIGRATION_URL, 'utf8'));
  const gateway = new D1OrganicHistoryGateway({ db: d1 });
  await gateway.assertSchemaReady();
  return { d1, gateway };
}

function createWriter(gateway, input) {
  return createOrganicHistoryWriter({
    gateway,
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    platform: 'tiktok',
    accountKey: 'chemistry_k',
    sourceAccountId: null,
    sourceTimezone: 'Asia/Bangkok',
    observedAt: input.observedAt,
    fetchedAt: input.observedAt,
    historySyncRunId: `history:${input.suffix}`,
    coverageRunId: `coverage:${input.suffix}`,
    sourceRevision: `source:${input.suffix}`,
  });
}

function sourceBatch(metrics) {
  return {
    contentRows: [{
      content_key: 'tiktok:chemistry_k:video-1',
      platform: 'tiktok',
      account_id: 'chemistry_k',
      external_content_id: 'video-1',
      content_type: 'video',
      published_at: Date.parse('2026-07-01T00:00:00.000Z'),
      caption: 'Chemistry K',
      content_url: 'https://www.tiktok.com/@chemistry_k/video/video-1',
      thumbnail_url: null,
      duration_seconds: 30,
      latest_views: metrics.views,
      latest_likes: metrics.likes,
      latest_comments: metrics.comments ?? 1,
      latest_shares: metrics.shares,
      latest_unique_viewers: null,
      avg_watch_time_seconds: 3,
      completion_rate: 0.5,
    }],
    dailySnapshotRows: [{
      content_daily_key: 'unused-by-history-writer',
      metric_date: START,
      platform: 'tiktok',
      account_id: 'chemistry_k',
      external_content_id: 'video-1',
      views: metrics.views,
      likes: metrics.likes,
      comments: metrics.comments ?? 1,
      shares: metrics.shares,
      unique_viewers: null,
      avg_watch_time_seconds: 3,
      total_watch_time_seconds: metrics.views * 3,
      completion_rate: 0.5,
      traffic_sources: null,
      country_region_breakdown: null,
    }],
  };
}

function count(d1, table) {
  return d1.database.prepare(`SELECT count(*) AS total FROM ${table}`).get().total;
}
