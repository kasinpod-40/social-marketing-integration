import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  applyReportMetricValueFieldMigration,
  planReportMetricValueFieldMigration,
  safeReportMetricValueFieldMigrationEvidence,
} from '../../scripts/lib/report-metric-value-field-migration-recovery.js';

const LEGACY_DISPLAY = '__mkt_legacy_display_name_single_select_v1';
const LEGACY_WINDOW_V1 = '__mkt_legacy_window_days_single_select_v1';
const LEGACY_WINDOW_V2 = '__mkt_legacy_window_days_single_select_v2';
const SCHEMA = Object.freeze([Object.freeze({
  key: 'mktReportMetricValues',
  logicalName: 'MKT_Report_Metric_Values',
  createName: 'MKT_Report_Metric_Values',
  aliases: Object.freeze(['MKT_Report_Metric_Values']),
  envName: 'LARK_TABLE_MKT_REPORT_METRIC_VALUES',
  defaultViewName: 'All',
  fields: Object.freeze([
    Object.freeze({ fieldName: 'report_metric_key', type: 1, uiType: 'Text', primary: true }),
    Object.freeze({ fieldName: 'display_name', type: 1, uiType: 'Text', primary: false }),
    Object.freeze({
      fieldName: 'window_days', type: 2, uiType: 'Number', primary: false,
      property: Object.freeze({ formatter: '0' }),
    }),
  ]),
})]);
const CONFIRMED_ENV = Object.freeze({
  CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION:
    REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
});

function options(client, overrides = {}) {
  return {
    client,
    schema: SCHEMA,
    schemaVersion: 'recovery-test-v2',
    validateSchema: () => true,
    ...overrides,
  };
}

function exactState() {
  return {
    tables: [{ tableId: 'tblMetric', name: 'MKT_Report_Metric_Values' }],
    fields: [
      field('fldKey', 'report_metric_key', 1, 'Text', true),
      field('fldDisplayCanonical', 'display_name', 1, 'Text'),
      field('fldDisplayLegacy', LEGACY_DISPLAY, 3, 'SingleSelect'),
      field('fldWindowCanonicalSource', 'window_days', 3, 'SingleSelect'),
      field('fldWindowLegacySource', LEGACY_WINDOW_V1, 3, 'SingleSelect'),
    ],
    records: [
      record('rec1', {
        report_metric_key: 'one', display_name: 'Views', [LEGACY_DISPLAY]: 'Views',
        window_days: '3', [LEGACY_WINDOW_V1]: '3',
      }),
      record('rec2', {
        report_metric_key: 'two', display_name: 'Reach', [LEGACY_DISPLAY]: null,
        window_days: '7', [LEGACY_WINDOW_V1]: null,
      }),
      record('rec3', {
        report_metric_key: 'three', display_name: 'Clicks', [LEGACY_DISPLAY]: 'Clicks',
        window_days: null, [LEGACY_WINDOW_V1]: '30',
      }),
    ],
    fieldUpdates: [],
    fieldCreates: [],
    recordBatches: [],
  };
}

test('preview accepts canonical-only display rows and plans exact dual-Select recovery', async () => {
  const preview = await planReportMetricValueFieldMigration(options(statefulClient(exactState())));
  assert.equal(preview.repairable, true);
  assert.equal(preview.blockerCount, 0);
  assert.equal(preview.migrationCount, 2);
  assert.equal(preview.pendingMigrationCount, 1);
  assert.equal(preview.plannedFieldMutationCount, 3);
  assert.equal(preview.plannedCanonicalValueWriteCount, 3);
  const display = preview.migrations.find((item) => item.fieldName === 'display_name');
  const window = preview.migrations.find((item) => item.fieldName === 'window_days');
  assert.equal(display.state, 'converged');
  assert.equal(window.state, 'needs_archive_primary_legacy');
  assert.equal(window.sourceFieldCount, 2);
});

test('apply archives both Select sources, creates Number canonical and preserves legacy values', async () => {
  const state = exactState();
  const before = snapshotByFieldId(state);
  const result = await applyReportMetricValueFieldMigration(options(statefulClient(state), {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));

  assert.equal(result.pendingMigrationCount, 0);
  assert.equal(result.fieldMutationCount, 3);
  assert.equal(result.canonicalValueWriteCount, 3);
  assert.equal(result.recordBatchWriteCount, 1);
  assert.equal(result.remoteMutationCount, 4);
  assert.equal(result.legacyValueMutationCount, 0);
  assert.equal(result.deleteCount, 0);

  const canonical = state.fields.find((item) => item.fieldName === 'window_days');
  const legacyV1 = state.fields.find((item) => item.fieldName === LEGACY_WINDOW_V1);
  const legacyV2 = state.fields.find((item) => item.fieldName === LEGACY_WINDOW_V2);
  assert.equal(canonical.type, 2);
  assert.deepEqual(canonical.property, { formatter: '0' });
  assert.equal(legacyV1.fieldId, 'fldWindowCanonicalSource');
  assert.equal(legacyV2.fieldId, 'fldWindowLegacySource');
  assert.deepEqual(state.records.map((item) => item.fields.window_days), [3, 7, 30]);
  assert.deepEqual(state.records.map((item) => item.fields[LEGACY_WINDOW_V1] ?? null), ['3', '7', null]);
  assert.deepEqual(state.records.map((item) => item.fields[LEGACY_WINDOW_V2] ?? null), ['3', null, '30']);

  const after = snapshotByFieldId(state);
  for (const fieldId of ['fldDisplayLegacy', 'fldWindowCanonicalSource', 'fldWindowLegacySource']) {
    assert.deepEqual(after.get(fieldId), before.get(fieldId));
  }
  const readback = await planReportMetricValueFieldMigration(options(statefulClient(state)));
  assert.equal(readback.pendingMigrationCount, 0);
  assert.equal(readback.convergedMigrationCount, 2);
});

test('recovery backfills legacy-only display rows while preserving canonical-only rows', async () => {
  const state = exactState();
  state.fields = state.fields.filter((item) => item.fieldId !== 'fldWindowCanonicalSource');
  state.fields.push(field('fldWindowNumber', 'window_days', 2, 'Number', false, { formatter: '0' }));
  for (const item of state.records) item.fields.window_days = Number(item.fields[LEGACY_WINDOW_V1] ?? 3);
  state.records[0].fields.display_name = null;

  const result = await applyReportMetricValueFieldMigration(options(statefulClient(state), {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));
  assert.equal(result.fieldMutationCount, 0);
  assert.equal(result.canonicalValueWriteCount, 1);
  assert.equal(result.recordBatchWriteCount, 1);
  assert.equal(state.records[0].fields.display_name, 'Views');
  assert.equal(state.records[1].fields.display_name, 'Reach');
});

test('conflicting dual Select values block before mutation', async () => {
  const state = exactState();
  state.records[0].fields[LEGACY_WINDOW_V1] = '7';
  const client = statefulClient(state);
  const preview = await planReportMetricValueFieldMigration(options(client));
  assert.equal(preview.repairable, false);
  assert.equal(preview.blockers[0].code, 'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_SOURCE_VALUE_CONFLICT');
  await assert.rejects(
    applyReportMetricValueFieldMigration(options(client, {
      env: CONFIRMED_ENV,
      sleepImpl: async () => undefined,
    })),
    (error) => error.code === 'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_BLOCKED',
  );
  assert.equal(state.fieldUpdates.length, 0);
  assert.equal(state.fieldCreates.length, 0);
  assert.equal(state.recordBatches.length, 0);
});

test('safe evidence excludes physical IDs and Business values', async () => {
  const preview = await planReportMetricValueFieldMigration(options(statefulClient(exactState())));
  const safe = safeReportMetricValueFieldMigrationEvidence(preview);
  const serialized = JSON.stringify(safe);
  for (const forbidden of ['tblMetric', 'fldWindowCanonicalSource', 'rec1', 'Views', 'Clicks']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(safe.migrationCount, 2);
  assert.equal(safe.plannedFieldMutationCount, 3);
  assert.equal(typeof safe.migrations[1].sourceFingerprint, 'string');
});

function field(fieldId, fieldName, type, uiType, isPrimary = false, property = null) {
  return { fieldId, fieldName, type, uiType, isPrimary, property };
}
function record(recordId, fields) { return { recordId, fields }; }

function snapshotByFieldId(state) {
  return new Map(state.fields.map((candidate) => [
    candidate.fieldId,
    state.records.map((item) => item.fields[candidate.fieldName] ?? null),
  ]));
}

function statefulClient(state) {
  return {
    async listTables() { return structuredClone(state.tables); },
    async listFields() { return structuredClone(state.fields); },
    async listRecords() { return structuredClone(state.records); },
    async updateField({ fieldId, field: update }) {
      const index = state.fields.findIndex((item) => item.fieldId === fieldId);
      assert.notEqual(index, -1);
      const previousName = state.fields[index].fieldName;
      state.fields[index] = {
        ...state.fields[index],
        fieldName: update.fieldName,
        type: update.type,
        uiType: update.uiType ?? state.fields[index].uiType,
        description: update.description ?? state.fields[index].description ?? '',
        property: structuredClone(update.property ?? null),
      };
      for (const item of state.records) {
        if (Object.hasOwn(item.fields, previousName)) {
          item.fields[update.fieldName] = item.fields[previousName];
          delete item.fields[previousName];
        }
      }
      state.fieldUpdates.push({ fieldId, field: structuredClone(update) });
      return structuredClone(state.fields[index]);
    },
    async createField({ field: contract }) {
      const created = {
        fieldId: `fldCreated${state.fieldCreates.length + 1}`,
        fieldName: contract.fieldName,
        type: contract.type,
        uiType: contract.uiType,
        isPrimary: false,
        description: contract.description ?? '',
        property: structuredClone(contract.property ?? null),
      };
      state.fields.push(created);
      state.fieldCreates.push(structuredClone(created));
      return structuredClone(created);
    },
    async batchUpdateRecords({ records }) {
      for (const update of records) {
        const target = state.records.find((item) => item.recordId === update.recordId);
        assert.ok(target);
        Object.assign(target.fields, structuredClone(update.fields));
      }
      state.recordBatches.push(structuredClone(records));
      return { updated: records.length };
    },
  };
}
