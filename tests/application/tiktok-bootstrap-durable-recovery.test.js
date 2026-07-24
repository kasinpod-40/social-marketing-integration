import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { bootstrapTikTokOrganicHistoryDurable } from '../../packages/application/src/use-cases/bootstrap-tiktok-organic-history-durable.js';
import { normalizeTikTokHistoryBatch } from '../../packages/application/src/storage/normalize-tiktok-history-batch.js';
import { createOrganicHistoryWriter } from '../../packages/application/src/storage/organic-history-writer.js';
import { D1OrganicHistoryGateway } from '../../packages/connectors/src/d1-organic-history-gateway.js';
import { transientError } from '../../packages/shared/src/errors/runtime-error.js';
import { createSqliteD1 } from '../helpers/sqlite-d1.js';

const MIGRATION_URL = new URL('../../migrations/0009_storage_foundation.sql', import.meta.url);
const REQUESTED_AT = 1784829780000;
const WORK_KEY = 'tiktok:f59b852f00634005c7ff4da51afee964';
const CURSOR_KEY = 'tiktok:chemistry_k:lark_native_tiktok_for_creator:organic_history_bootstrap';
const PREFLIGHT_PHASE = 'tiktok_organic_history_preflight_v1';
const WRITE_PHASE = 'tiktok_organic_history_write_v1';
const RECORDS = Object.freeze(Array.from({ length: 2021 }, (_, index) => rawRecord(index + 1)));

/** Exact incident shape: staged preflight, two complete write Units, then 309 legacy State rows. */
test('TikTok bootstrap recovers Unit 3 idempotently after 309 durable State rows', async () => {
  const d1 = createSqliteD1();
  d1.exec(await readFile(MIGRATION_URL, 'utf8'));
  const gateway = new D1OrganicHistoryGateway({ db: d1 });
  const store = new InMemoryWorkStore();
  const repository = paginatedRepository(RECORDS);

  try {
    for (let expectedSequence = 1; expectedSequence <= 5; expectedSequence += 1) {
      const preflight = await runDurable({ gateway, store, repository });
      assert.equal(preflight.mode, 'd1_only_preflight_continuation');
      assert.equal(preflight.continuationRequired, true);
      assert.equal(preflight.continuationPhase, PREFLIGHT_PHASE);
      assert.equal(preflight.nextSequence, expectedSequence);
      assert.equal(count(d1, 'organic_content_state'), 0);
      assert.equal(count(d1, 'organic_content_observations'), 0);
      assert.equal(count(d1, 'data_coverage_entities'), 0);
      const checkpoint = await store.loadPhase({ workKey: WORK_KEY, phase: PREFLIGHT_PHASE });
      assert.equal(checkpoint.state.unitsPreflighted, expectedSequence);
      assert.equal(checkpoint.complete, expectedSequence === 5);
    }
    assert.equal(count(d1, 'data_coverage_runs'), 0);

    const first = await runDurable({ gateway, store, repository });
    const second = await runDurable({ gateway, store, repository });
    assert.equal(first.mode, 'd1_only_write_continuation');
    assert.equal(second.mode, 'd1_only_write_continuation');
    assert.equal(first.continuationPhase, WRITE_PHASE);
    assert.equal(second.continuationPhase, WRITE_PHASE);
    assert.equal(first.nextSequence, 1);
    assert.equal(second.nextSequence, 2);
    assert.equal(count(d1, 'organic_content_state'), 1000);
    assert.equal(count(d1, 'organic_content_observations'), 1000);
    assert.equal(count(d1, 'data_coverage_entities'), 1000);

    const beforeInterrupt = await store.loadPhase({ workKey: WORK_KEY, phase: WRITE_PHASE });
    assert.equal(beforeInterrupt.state.nextSequence, 2);
    assert.equal(beforeInterrupt.state.rawRecordsCompleted, 1000);
    assert.equal(beforeInterrupt.state.contentRowsDurable, 1000);
    assert.equal(beforeInterrupt.state.observationRowsDurable, 1000);
    assert.equal(beforeInterrupt.state.coverageEntitiesWritten, 1000);

    await assert.rejects(
      () => simulateLegacyUnitThreeInterruption({
        gateway,
        coverageRunId: second.d1.coverageRunId,
        sourceWatermark: second.d1.sourceWatermark,
      }),
      (error) => error.code === 'TEST_MID_UNIT_INTERRUPTION',
    );

    const afterInterrupt = await store.loadPhase({ workKey: WORK_KEY, phase: WRITE_PHASE });
    assert.deepEqual(afterInterrupt, beforeInterrupt);
    assert.equal(count(d1, 'organic_content_state'), 1309);
    assert.equal(count(d1, 'organic_content_observations'), 1000);
    assert.equal(count(d1, 'data_coverage_entities'), 1000);
    assert.equal(
      d1.database.prepare('SELECT status FROM data_coverage_runs').get().status,
      'partial',
    );
    assert.equal(
      d1.database.prepare('SELECT completed_at FROM data_coverage_runs').get().completed_at,
      null,
    );

    const recoveredUnitThree = await runDurable({ gateway, store, repository });
    assert.equal(recoveredUnitThree.continuationRequired, true);
    assert.equal(recoveredUnitThree.continuationPhase, WRITE_PHASE);
    assert.equal(recoveredUnitThree.nextSequence, 3);
    assert.equal(count(d1, 'organic_content_state'), 1500);
    assert.equal(count(d1, 'organic_content_observations'), 1500);
    assert.equal(count(d1, 'data_coverage_entities'), 1500);

    const unitFour = await runDurable({ gateway, store, repository });
    assert.equal(unitFour.continuationRequired, true);
    assert.equal(unitFour.nextSequence, 4);
    const completed = await runDurable({ gateway, store, repository });
    assert.equal(completed.mode, 'd1_only');
    assert.equal(completed.continuationRequired, false);
    assert.equal(completed.resumableWork.complete, true);
    assert.equal(completed.lark.contentWrites, 0);
    assert.equal(completed.lark.dailyWrites, 0);

    assert.equal(count(d1, 'organic_content_state'), 2021);
    assert.equal(count(d1, 'organic_content_observations'), 2021);
    assert.equal(count(d1, 'data_coverage_entities'), 2021);
    assert.equal(countWhere(d1, 'organic_content_observations', "observation_kind = 'initial'"), 2021);
    assert.equal(duplicateGroups(d1, 'organic_content_state', 'content_key'), 0);
    assert.equal(duplicateGroups(d1, 'organic_content_observations', 'observation_key'), 0);

    const coverage = d1.database.prepare(`
      SELECT status, expected_entities, observed_entities,
             expected_rows, observed_rows, failed_rows, completed_at
      FROM data_coverage_runs
    `).get();
    assert.equal(coverage.status, 'complete');
    assert.equal(coverage.expected_entities, 2021);
    assert.equal(coverage.observed_entities, 2021);
    assert.equal(coverage.expected_rows, 2021);
    assert.equal(coverage.observed_rows, 2021);
    assert.equal(coverage.failed_rows, 0);
    assert.ok(Number.isSafeInteger(coverage.completed_at));

    const work = store.work.get(WORK_KEY);
    assert.ok(work.completion);
    assert.equal(work.completion.d1.coverageStatus, 'complete');
    assert.equal(work.completion.reconciliation.expectedRows, 2021);
    assert.equal(work.completion.reconciliation.observedRows, 2021);
    assert.equal(work.completion.reconciliation.failedRows, 0);
  } finally {
    d1.close();
  }
});

test('TikTok bootstrap dry-run remains bounded and never turns into a live write', async () => {
  const d1 = createSqliteD1();
  d1.exec(await readFile(MIGRATION_URL, 'utf8'));
  const gateway = new D1OrganicHistoryGateway({ db: d1 });
  const store = new InMemoryWorkStore();
  const repository = paginatedRepository(RECORDS);
  const workKey = 'tiktok:dry-run-operation';

  try {
    for (let expectedSequence = 1; expectedSequence <= 4; expectedSequence += 1) {
      const result = await runDurable({
        gateway,
        store,
        repository,
        workKey,
        dryRun: true,
      });
      assert.equal(result.mode, 'd1_only_preflight_continuation');
      assert.equal(result.continuationRequired, true);
      assert.equal(result.nextSequence, expectedSequence);
      assert.equal(result.lark.contentWrites, 0);
      assert.equal(result.lark.dailyWrites, 0);
    }
    const completed = await runDurable({
      gateway,
      store,
      repository,
      workKey,
      dryRun: true,
    });
    assert.equal(completed.mode, 'dry_run');
    assert.equal(completed.dryRun, true);
    assert.equal(completed.continuationRequired, false);
    assert.equal(completed.nextSequence, 5);
    assert.equal(completed.resumableWork.complete, true);
    assert.equal(completed.d1.plannedStateRows, 2021);
    assert.equal(completed.d1.plannedObservationRows, 2021);
    assert.equal(count(d1, 'organic_content_state'), 0);
    assert.equal(count(d1, 'organic_content_observations'), 0);
    assert.equal(count(d1, 'data_coverage_runs'), 0);
    assert.equal(count(d1, 'data_coverage_entities'), 0);
  } finally {
    d1.close();
  }
});

async function simulateLegacyUnitThreeInterruption(input) {
  const unitThreeRecords = RECORDS.slice(1000, 1500);
  const normalized = normalizeTikTokHistoryBatch({
    records: unitThreeRecords,
    accountKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    sourceTimezone: 'Asia/Bangkok',
    metricDate: '2026-07-24',
  });
  let stateWrites = 0;
  const interruptingGateway = new Proxy(input.gateway, {
    get(target, property) {
      if (property === 'upsertOrganicContentState') {
        return async (row) => {
          if (stateWrites >= 309) {
            throw transientError('Synthetic interruption after 309 State rows', {
              code: 'TEST_MID_UNIT_INTERRUPTION',
            });
          }
          stateWrites += 1;
          return target.upsertOrganicContentState(row);
        };
      }
      const value = Reflect.get(target, property, target);
      return typeof value === 'function' ? value.bind(target) : value;
    },
  });
  const writer = createOrganicHistoryWriter({
    gateway: interruptingGateway,
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    platform: 'tiktok',
    accountKey: 'chemistry_k',
    sourceAccountId: null,
    sourceTimezone: 'Asia/Bangkok',
    observedAt: REQUESTED_AT,
    fetchedAt: REQUESTED_AT,
    historySyncRunId: input.coverageRunId.replace('coverage:', 'history:'),
    coverageRunId: input.coverageRunId,
    sourceRevision: input.sourceWatermark,
    scopeMode: 'full_inventory',
    datasetKey: 'organic_content_cumulative',
  });
  await writer.writeBatch({
    contentRows: normalized.contentRows,
    dailySnapshotRows: normalized.dailySnapshotRows,
  });
}

function runDurable({
  gateway,
  store,
  repository,
  workKey = WORK_KEY,
  dryRun = false,
}) {
  return bootstrapTikTokOrganicHistoryDurable({
    syncRunId: `attempt:${Math.random()}`,
    assertLockActive: async () => true,
    repository,
    gateway,
    resumableWorkStore: store,
    customerProfile: 'integration_workspace',
    customerKey: 'chemistry_k',
    accountKey: 'chemistry_k',
    sourceHandle: 'chemistry_k',
    sourceTimezone: 'Asia/Bangkok',
    requestedAt: REQUESTED_AT,
    generation: REQUESTED_AT,
    cursorKey: CURSOR_KEY,
    workKey,
    rawTableId: 'raw-tiktok',
    sourcePageSize: 500,
    sourceMaxPages: 10,
    dryRun,
  });
}

function paginatedRepository(records) {
  return Object.freeze({
    async listPage(_tableId, input) {
      const offset = input.pageToken === null ? 0 : Number(input.pageToken);
      const pageRecords = records.slice(offset, offset + input.pageSize);
      const nextOffset = offset + pageRecords.length;
      const hasMore = nextOffset < records.length;
      return Object.freeze({
        records: Object.freeze(pageRecords),
        hasMore,
        nextPageToken: hasMore ? String(nextOffset) : null,
      });
    },
  });
}

function rawRecord(index) {
  return Object.freeze({
    recordId: `raw-video-${index}`,
    fields: Object.freeze({
      video_id: `video-${index}`,
      published_at: '2026-07-01T00:00:00Z',
      description: `Chemistry K lesson ${index}`,
      shareable_url: `https://www.tiktok.com/@chemistry_k/video/video-${index}`,
      duration_seconds: 30,
      views: index,
      likes: index % 100,
      comments: index % 10,
      shares: index % 7,
      average_play_duration: 3,
      total_play_duration: index * 3,
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
    if (existing && existing.generation !== input.generation) throw new Error('generation mismatch');
    this.work.set(input.workKey, { ...input, completion: null });
    return Object.freeze({
      workKey: input.workKey,
      resumed: Boolean(existing),
      superseded: false,
      completed: false,
    });
  }

  async assertCurrentGeneration() { return true; }

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
      nextSequence: selected.length === input.limit ? selected.at(-1).sequence + 1 : null,
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

function countWhere(d1, table, clause) {
  return d1.database.prepare(`SELECT count(*) AS total FROM ${table} WHERE ${clause}`).get().total;
}

function duplicateGroups(d1, table, key) {
  return d1.database.prepare(`
    SELECT count(*) AS total
    FROM (
      SELECT ${key}
      FROM ${table}
      GROUP BY ${key}
      HAVING count(*) > 1
    )
  `).get().total;
}
