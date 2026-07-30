import test from 'node:test';
import assert from 'node:assert/strict';
import { createExplicitNullUpdateRepository } from '../../packages/sync-engine/src/explicit-null-update-repository.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';

function createBaseRepository(existingRecords = []) {
  const calls = { creates: [], updates: [] };
  const repository = {
    async prepareRows(_tableId, rows) {
      return rows.map((row) => Object.freeze(Object.fromEntries(
        Object.entries(row).filter(([, value]) => value !== null && value !== undefined && value !== ''),
      )));
    },
    async prepareExistingRecords(_tableId, records, context = {}) {
      return records.map((record) => {
        const fields = {};
        for (const fieldName of context.incomingFieldNames ?? []) {
          const value = record.fields[fieldName];
          if (value !== null && value !== undefined && value !== '') fields[fieldName] = value;
        }
        return Object.freeze({ recordId: record.recordId, fields: Object.freeze(fields) });
      });
    },
    async listByFieldValues() { return existingRecords; },
    async createMany(_tableId, rows) {
      calls.creates.push(...rows);
      return { created: rows.length };
    },
    async updateMany(_tableId, records) {
      calls.updates.push(...records);
      return { updated: records.length };
    },
  };
  return { repository, calls };
}

function wrap(repository) {
  return createExplicitNullUpdateRepository({
    repository,
    fieldNames: ['current_value', 'compare_value'],
  });
}

test('explicit-null adapter clears selected fields on update', async () => {
  const { repository, calls } = createBaseRepository([{
    recordId: 'rec1',
    fields: { report_metric_key: 'report::metric', current_value: 123, compare_value: 10 },
  }]);
  const engine = new TableSyncEngine();
  const plan = await engine.planByKey({
    repository: wrap(repository),
    tableId: 'tbl_metrics',
    keyField: 'report_metric_key',
    rows: [{ report_metric_key: 'report::metric', current_value: null, compare_value: 10 }],
  });

  assert.equal(plan.createRows.length, 0);
  assert.equal(plan.updateRows.length, 1);
  await engine.executePlan(plan);
  assert.deepEqual(calls.updates, [{
    recordId: 'rec1',
    fields: { report_metric_key: 'report::metric', current_value: null, compare_value: 10 },
  }]);
});

test('explicit-null adapter treats an already empty selected field as unchanged', async () => {
  const { repository, calls } = createBaseRepository([{
    recordId: 'rec1',
    fields: { report_metric_key: 'report::metric', current_value: null },
  }]);
  const engine = new TableSyncEngine();
  const plan = await engine.planByKey({
    repository: wrap(repository),
    tableId: 'tbl_metrics',
    keyField: 'report_metric_key',
    rows: [{ report_metric_key: 'report::metric', current_value: null }],
  });

  assert.equal(plan.updateRows.length, 0);
  assert.equal(plan.skipped, 1);
  await engine.executePlan(plan);
  assert.deepEqual(calls.updates, []);
});

test('explicit-null adapter omits selected null fields on create', async () => {
  const { repository, calls } = createBaseRepository([]);
  const engine = new TableSyncEngine();
  const plan = await engine.planByKey({
    repository: wrap(repository),
    tableId: 'tbl_metrics',
    keyField: 'report_metric_key',
    rows: [{ report_metric_key: 'report::metric', current_value: null, compare_value: 7 }],
  });

  assert.equal(plan.createRows.length, 1);
  await engine.executePlan(plan);
  assert.deepEqual(calls.creates, [{ report_metric_key: 'report::metric', compare_value: 7 }]);
});
