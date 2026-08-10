import test from 'node:test';
import assert from 'node:assert/strict';

import { D1ResumableWorkStore } from '../../packages/sync-engine/src/queue-terminal-safe-d1-resumable-work-store.js';

const WORK_KEY = 'facebook:facebook-dashboard-repair-20260809-v1';
const GENERATION = Date.parse('2026-08-10T00:30:00.000Z');
const SOURCE_PHASE = 'meta_end_to_end_source_staging_v1';

function fakeD1({ current, changes = 1 }) {
  const prepared = [];
  return {
    prepared,
    prepare(sql) {
      const statement = {
        sql: String(sql),
        bindings: [],
        bind(...values) {
          this.bindings = values;
          return this;
        },
        async first() {
          if (/FROM sync_work_runs AS work/u.test(this.sql)) {
            return current;
          }
          return null;
        },
        async run() {
          return { meta: { changes } };
        },
      };
      prepared.push(statement);
      return statement;
    },
    async batch() {
      return [];
    },
  };
}

test('revives only exact terminal generation after retained source is complete', async () => {
  const db = fakeD1({
    current: {
      work_key: WORK_KEY,
      generation: GENERATION,
      lifecycle_status: 'terminal',
      completed_at: null,
      source_complete: 1,
      source_stage: 'complete',
      active_lock_count: 0,
    },
  });
  const store = new D1ResumableWorkStore({
    db,
    now: () => Date.parse('2026-08-11T00:00:00.000Z'),
  });

  const result = await store.prepareCompletedSourceRedrive({
    workKey: WORK_KEY,
    generation: GENERATION,
    sourcePhase: SOURCE_PHASE,
    auditReference: 'redrive:terminal:facebook-message-173:1',
  });

  assert.equal(result.disposition, 'revived');
  assert.equal(result.lifecycleStatus, 'active');
  assert.equal(result.sourceComplete, true);
  assert.equal(result.sourceStage, 'complete');
  const update = db.prepared.find((statement) => /SET lifecycle_status = 'active'/u.test(statement.sql));
  assert.ok(update);
  assert.match(update.sql, /generation = \?/u);
  assert.match(update.sql, /phase\.complete = 1/u);
  assert.match(update.sql, /json_extract\(phase\.state_json, '\$\.stage'\) = 'complete'/u);
  assert.match(update.sql, /NOT EXISTS[\s\S]*sync_locks/u);
});

test('fails closed before lifecycle mutation when retained source is incomplete', async () => {
  const db = fakeD1({
    current: {
      work_key: WORK_KEY,
      generation: GENERATION,
      lifecycle_status: 'terminal',
      completed_at: null,
      source_complete: 0,
      source_stage: 'content_insights',
      active_lock_count: 0,
    },
  });
  const store = new D1ResumableWorkStore({ db });

  await assert.rejects(
    store.prepareCompletedSourceRedrive({
      workKey: WORK_KEY,
      generation: GENERATION,
      sourcePhase: SOURCE_PHASE,
      auditReference: 'redrive:terminal:facebook-message-173:2',
      now: Date.parse('2026-08-11T00:00:00.000Z'),
    }),
    (error) => error?.code === 'SYNC_WORK_RECOVERY_SOURCE_INCOMPLETE'
      && error.retryable === false,
  );
  assert.equal(db.prepared.some((statement) => /SET lifecycle_status = 'active'/u.test(statement.sql)), false);
});

test('active lock makes recovery a no-op and never rewrites lifecycle', async () => {
  const db = fakeD1({
    current: {
      work_key: WORK_KEY,
      generation: GENERATION,
      lifecycle_status: 'terminal',
      completed_at: null,
      source_complete: 1,
      source_stage: 'complete',
      active_lock_count: 1,
    },
  });
  const store = new D1ResumableWorkStore({ db });

  const result = await store.prepareCompletedSourceRedrive({
    workKey: WORK_KEY,
    generation: GENERATION,
    sourcePhase: SOURCE_PHASE,
    auditReference: 'redrive:terminal:facebook-message-173:3',
    now: Date.parse('2026-08-11T00:00:00.000Z'),
  });

  assert.equal(result.disposition, 'already_processing');
  assert.equal(db.prepared.some((statement) => /SET lifecycle_status = 'active'/u.test(statement.sql)), false);
});
