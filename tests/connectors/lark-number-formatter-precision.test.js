import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canonicalizeNumberForLarkFormatter,
  normalizeExistingRecordsForComparison,
  readFixedNumberFormatterPrecision,
  serializeRowsForLark,
} from '../../packages/connectors/src/lark/lark-field-serializer.js';
import { TableSyncEngine } from '../../packages/sync-engine/src/table-sync-engine.js';

const fields = Object.freeze([
  { fieldName: 'key', type: 1 },
  { fieldName: 'coverage_rate', type: 2, property: { formatter: '0.0000' } },
]);

test('parses only explicit fixed-decimal Lark number formatters', () => {
  assert.equal(readFixedNumberFormatterPrecision('0'), 0);
  assert.equal(readFixedNumberFormatterPrecision('0.0000'), 4);
  assert.equal(readFixedNumberFormatterPrecision('1,000'), 0);
  assert.equal(readFixedNumberFormatterPrecision('1,000.00'), 2);
  assert.equal(readFixedNumberFormatterPrecision('#,##0.00'), 2);
  assert.equal(readFixedNumberFormatterPrecision('0.0%'), null);
  assert.equal(readFixedNumberFormatterPrecision('0.00%'), 4);
  assert.equal(readFixedNumberFormatterPrecision('0.00000'), null);
  assert.equal(readFixedNumberFormatterPrecision('1,000.000'), null);
  assert.equal(readFixedNumberFormatterPrecision('currency'), null);
  assert.equal(readFixedNumberFormatterPrecision(undefined), null);
});

test('canonicalizes incoming and existing numbers with the same formatter precision', () => {
  assert.equal(canonicalizeNumberForLarkFormatter(0.833333333333, fields[1]), 0.8333);
  assert.equal(canonicalizeNumberForLarkFormatter(-1.23456, fields[1]), -1.2346);
  assert.equal(canonicalizeNumberForLarkFormatter(-0.00001, fields[1]), 0);
  assert.equal(canonicalizeNumberForLarkFormatter(1.6, {
    fieldName: 'window_days', type: 2, property: { formatter: '0' },
  }), 2);
  assert.equal(canonicalizeNumberForLarkFormatter(1.6, {
    fieldName: 'grouped_count', type: 2, property: { formatter: '1,000' },
  }), 2);
  assert.equal(canonicalizeNumberForLarkFormatter(1234.567, {
    fieldName: 'amount', type: 2, property: { formatter: '1,000.00' },
  }), 1234.57);

  const [incoming] = serializeRowsForLark([
    { key: 'one', coverage_rate: 0.833333333333 },
  ], fields, { tableId: 'tbl', keyField: 'key' });
  const [existing] = normalizeExistingRecordsForComparison([{
    recordId: 'rec-one',
    fields: { key: 'one', coverage_rate: 0.8333 },
  }], fields, {
    tableId: 'tbl',
    incomingFieldNames: ['key', 'coverage_rate'],
  });

  assert.equal(incoming.coverage_rate, 0.8333);
  assert.equal(existing.fields.coverage_rate, 0.8333);
});

test('preserves exact behavior for unsupported formatters and rejects invalid numbers', () => {
  const unsupported = { fieldName: 'ratio', type: 2, property: { formatter: '0.0%' } };
  assert.equal(canonicalizeNumberForLarkFormatter(0.833333333333, unsupported), 0.833333333333);
  assert.equal(canonicalizeNumberForLarkFormatter(1.234567, {
    fieldName: 'unknown_precision', type: 2, property: { formatter: '0.00000' },
  }), 1.234567);
  assert.throws(() => canonicalizeNumberForLarkFormatter(Number.NaN, fields[1]), /finite/);
  assert.throws(() => canonicalizeNumberForLarkFormatter(Number.POSITIVE_INFINITY, fields[1]), /finite/);
});

test('keeps observed zero distinct from missing values', () => {
  const [zero] = serializeRowsForLark([{ key: 'zero', coverage_rate: 0 }], fields, {
    tableId: 'tbl', keyField: 'key',
  });
  const [missing] = serializeRowsForLark([{ key: 'missing', coverage_rate: null }], fields, {
    tableId: 'tbl', keyField: 'key',
  });

  assert.equal(zero.coverage_rate, 0);
  assert.equal(Object.hasOwn(missing, 'coverage_rate'), false);
});

test('sync planning skips formatter-equivalent numbers without global tolerance', async () => {
  const repository = createRepository(0.8333);
  const plan = await new TableSyncEngine().planByKey({
    repository,
    tableId: 'tbl',
    keyField: 'key',
    rows: [{ key: 'one', coverage_rate: 0.833333333333 }],
  });

  assert.equal(plan.createRows.length, 0);
  assert.equal(plan.updateRows.length, 0);
  assert.equal(plan.skipped, 1);
  assert.deepEqual(plan.changedFieldCounts, {});
});

test('sync planning still updates a real numeric difference after canonicalization', async () => {
  const repository = createRepository(0.8332);
  const plan = await new TableSyncEngine().planByKey({
    repository,
    tableId: 'tbl',
    keyField: 'key',
    rows: [{ key: 'one', coverage_rate: 0.833333333333 }],
  });

  assert.equal(plan.createRows.length, 0);
  assert.equal(plan.updateRows.length, 1);
  assert.equal(plan.skipped, 0);
  assert.deepEqual(plan.changedFieldCounts, { coverage_rate: 1 });
});

function createRepository(existingCoverageRate) {
  return {
    async prepareRows(tableId, rows, context) {
      return serializeRowsForLark(rows, fields, { tableId, keyField: context.keyField });
    },
    async listByFieldValues() {
      return [{ recordId: 'rec-one', fields: { key: 'one', coverage_rate: existingCoverageRate } }];
    },
    async prepareExistingRecords(tableId, records, context) {
      return normalizeExistingRecordsForComparison(records, fields, {
        tableId,
        incomingFieldNames: context.incomingFieldNames,
      });
    },
    async createMany() {
      throw new Error('create must not run during planning');
    },
    async updateMany() {
      throw new Error('update must not run during planning');
    },
  };
}


test('two-decimal percent formatter keeps fraction units and stable replay precision', async () => {
  const percentFields = [
    { fieldName: 'key', type: 1 },
    { fieldName: 'video_view_rate', type: 2, property: { formatter: '0.00%' } },
  ];
  const repository = {
    ...createRepository(0),
    async prepareRows(tableId, rows, context) {
      return serializeRowsForLark(rows, percentFields, { tableId, keyField: context.keyField });
    },
    async listByFieldValues() {
      return [{ recordId: 'rec-one', fields: { key: 'one', video_view_rate: 0.833333333333333 } }];
    },
    async prepareExistingRecords(tableId, records, context) {
      return normalizeExistingRecordsForComparison(records, percentFields, {
        tableId, incomingFieldNames: context.incomingFieldNames,
      });
    },
  };
  const [serialized] = await repository.prepareRows('tbl', [{ key: 'one', video_view_rate: 5 / 6 }], { keyField: 'key' });
  assert.equal(serialized.video_view_rate, 0.8333);
  const engine = new TableSyncEngine();
  const same = await engine.planByKey({ repository, tableId: 'tbl', keyField: 'key',
    rows: [{ key: 'one', video_view_rate: 5 / 6 }] });
  assert.equal(same.skipped, 1);
  assert.equal(same.updateRows.length, 0);
  const changed = await engine.planByKey({ repository, tableId: 'tbl', keyField: 'key',
    rows: [{ key: 'one', video_view_rate: 0.8332 }] });
  assert.equal(changed.updateRows.length, 1);
  assert.deepEqual(changed.changedFieldCounts, { video_view_rate: 1 });
  const [zero, missing] = serializeRowsForLark([
    { key: 'zero', video_view_rate: 0 }, { key: 'missing', video_view_rate: null },
  ], percentFields, { tableId: 'tbl', keyField: 'key' });
  assert.equal(zero.video_view_rate, 0);
  assert.equal(Object.hasOwn(missing, 'video_view_rate'), false);
  assert.equal(canonicalizeNumberForLarkFormatter(1.234567, {
    fieldName: 'unproved', property: { formatter: '0.0%' },
  }), 1.234567);
});
