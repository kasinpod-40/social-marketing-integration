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
