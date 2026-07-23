import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bootstrapTikTokOrganicHistory } from '../../packages/application/src/use-cases/bootstrap-tiktok-organic-history.js';
import { D1OrganicHistoryGateway } from '../../packages/connectors/src/d1-organic-history-gateway.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL('../../migrations/0009_storage_foundation.sql', import.meta.url);
const START = Date.parse('2026-07-23T03:00:00.000Z');
const DAY = 86_400_000;

test('TikTok bootstrap dry-run plans D1 rows and performs zero business writes', async () => {
  const { d1, gateway } = await createGateway();
  try {
    const result = await runBootstrap({
      gateway,
      store: new InMemoryWorkStore(),
      repository: sourceRepository([rawRecord({ views: 100 })]),
      workKey: 'tiktok:dry-run',
      requestedAt: START,
      dryRun: true,
    });

    assert.equal(result.mode, 'dry_run');
    assert.equal(result.destinationMode, 'd1_only');
    assert.equal(result.d1.plannedStateRows, 1);
    assert.equal(result.d1.plannedObservationRows, 1);
    assert.equal(result.d1.contentRowsDurable, 0);
    assert.equal(result.lark.contentWrites, 0);
    assert.equal(result.lark.dailyWrites, 0);
    assert.equal(count(d1, 'organic_content_state'), 0);
    assert.equal(count(d1, 'organic_content_observations'), 0);
    assert.equal(count(d1, 'data_coverage_runs'), 0);
  } finally {
    d1.close();
  }
});

test('TikTok D1-only bootstrap is resumable and never fabricates unchanged history', async () => {
  const { d1, gateway } = await createGateway();
  try {
    const firstStore = new InMemoryWorkStore();
    const first = await runBootstrap({
      gateway,
      store: firstStore,
      repository: sourceRepository([rawRecord({ views: 100 })]),
      workKey: 'tiktok:bootstrap-1',
      requestedAt: START,
    });
    const replay = await runBootstrap({
      gateway,
      store: firstStore,
      repository: sourceRepository([rawRecord({ views: 999 })]),
      workKey: 'tiktok:bootstrap-1',
      requestedAt: START,
    });

    assert.equal(first.mode, 'd1_only');
    assert.equal(first.d1.coverageStatus, 'complete');
    assert.equal(first.lark.contentWrites, 0);
    assert.equal(replay.mode, 'already_completed');
    assert.equal(count(d1, 'organic_content_state'), 1);
    assert.equal(count(d1, 'organic_content_observations'), 1);
    assert.equal(count(d1, 'data_coverage_runs'), 1);

    const unchanged = await runBootstrap({
      gateway,
      store: new InMemoryWorkStore(),
      repository: sourceRepository([rawRecord({ views: 100 })]),
      workKey: 'tiktok:bootstrap-2',
      requestedAt: START + DAY,
    });
    assert.equal(unchanged.d1.plannedObservationRows, 0);
    assert.equal(unchanged.d1.observationsNotRequired, 1);
    assert.equal(count(d1, 'organic_content_observations'), 1);
    assert.equal(
      d1.database.prepare('SELECT last_observed_at FROM organic_content_state').get().last_observed_at,
      START + DAY,
    );

    const changed = await runBootstrap({
      gateway,
      store: new InMemoryWorkStore(),
      repository: sourceRepository([rawRecord({ views: 120 })]),
      workKey: 'tiktok:bootstrap-3',
      requestedAt: START + 2 * DAY,
    });
    assert.equal(changed.d1.observationsCreated, 1);
    assert.equal(count(d1, 'organic_content_observations'), 2);
    assert.deepEqual(
      d1.database.prepare(
        'SELECT observation_kind, metric_date FROM organic_content_observations ORDER BY observed_at',
      ).all(),
      [
        { observation_kind: 'initial', metric_date: '2026-07-23' },
        { observation_kind: 'changed', metric_date: '2026-07-25' },
      ],
    );
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

function runBootstrap(input) {
  return bootstrapTikTokOrganicHistory({
    syncRunId: `attempt:${input.workKey}`,
    assertLockActive: async () => true,
    repository: input.repository,
    gateway: input.gateway,
    resumableWorkStore: input.store,
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    sourceTimezone: 'Asia/Bangkok',
    requestedAt: input.requestedAt,
    cursorKey: 'tiktok:chemistry_k:organic-history-bootstrap',
    workKey: input.workKey,
    rawTableId: 'raw-tiktok',
    sourcePageSize: 100,
    sourceMaxPages: 10,
    dryRun: input.dryRun === true,
  });
}

function sourceRepository(records) {
  return Object.freeze({
    async listPage(_tableId, input) {
      assert.equal(input.pageToken, null);
      return Object.freeze({
        records: Object.freeze(records),
        hasMore: false,
        nextPageToken: null,
      });
    },
  });
}

function rawRecord(input = {}) {
  return Object.freeze({
    recordId: 'raw-video-1',
    fields: Object.freeze({
      video_id: 'video-1',
      published_at: '2026-07-01T00:00:00Z',
      description: 'Chemistry K lesson',
      shareable_url: 'https://www.tiktok.com/@chemistry_k/video/video-1',
      duration_seconds: 30,
      views: input.views ?? 100,
      likes: 10,
      comments: 1,
      shares: 2,
      average_play_duration: 3,
      total_play_duration: (input.views ?? 100) * 3,
      completion_rate: 0.5,
      unique_viewers: null,
    }),
  });
}

class InMemoryWorkStore {
  constructor() {
    this.work = new Map();
    this.phases = new Map();
    this.units = new Map();
  }

  async beginWork(input) {
    const existing = this.work.get(input.workKey);
    if (existing?.completion) {
      return Object.freeze({
        workKey: input.workKey,
        resumed: true,
        superseded: false,
        completed: true,
        completion: structuredClone(existing.completion),
      });
    }
    if (existing && existing.generation !== input.generation) {
      throw new Error('generation mismatch');
    }
    this.work.set(input.workKey, { ...input, completion: null });
    return Object.freeze({
      workKey: input.workKey,
      resumed: Boolean(existing),
      superseded: false,
      completed: false,
    });
  }

  async assertCurrentGeneration() {
    return true;
  }

  async loadPhase(input) {
    const phase = this.phases.get(phaseKey(input.workKey, input.phase));
    return phase ? structuredClone(phase) : null;
  }

  async savePhase(input) {
    if (input.unit) {
      const key = phaseKey(input.workKey, input.phase);
      const units = this.units.get(key) ?? [];
      const next = units.filter((unit) => unit.unitKey !== input.unit.unitKey);
      next.push(structuredClone(input.unit));
      next.sort((left, right) => left.sequence - right.sequence);
      this.units.set(key, next);
    }
    const phase = Object.freeze({
      state: structuredClone(input.state ?? {}),
      expectedItems: input.expectedItems,
      processedItems: input.processedItems,
      pagesProcessed: input.pagesProcessed,
      chunksProcessed: input.chunksProcessed,
      complete: input.complete === true,
    });
    this.phases.set(phaseKey(input.workKey, input.phase), phase);
    return structuredClone(phase);
  }

  async listPhaseUnits(input) {
    const units = this.units.get(phaseKey(input.workKey, input.phase)) ?? [];
    const selected = units
      .filter((unit) => unit.sequence >= input.afterSequence)
      .slice(0, input.limit)
      .map((unit) => Object.freeze({
        unitKey: unit.unitKey,
        sequence: unit.sequence,
        payload: structuredClone(unit.payload),
      }));
    return Object.freeze({
      units: Object.freeze(selected),
      nextSequence: selected.length === input.limit
        ? selected.at(-1).sequence + 1
        : null,
    });
  }

  async completeWork(input) {
    const work = this.work.get(input.workKey);
    this.work.set(input.workKey, { ...work, completion: structuredClone(input.completion) });
    return true;
  }
}

function phaseKey(workKey, phase) {
  return `${workKey}:${phase}`;
}

function count(d1, table) {
  return d1.database.prepare(`SELECT count(*) AS total FROM ${table}`).get().total;
}
