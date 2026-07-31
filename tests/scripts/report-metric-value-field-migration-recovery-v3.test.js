import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION,
  applyReportMetricValueFieldMigration,
  planReportMetricValueFieldMigration,
  safeReportMetricValueFieldMigrationEvidence,
} from '../../scripts/lib/report-metric-value-field-migration-recovery-v3.js';

const LEGACY_DISPLAY_V1 = '__mkt_legacy_display_name_single_select_v1';
const LEGACY_DISPLAY_V2 = '__mkt_legacy_display_name_single_select_v2';
const LEGACY_WINDOW_V1 = '__mkt_legacy_window_days_single_select_v1';
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
      fieldName: 'window_days',
      type: 2,
      uiType: 'Number',
      primary: false,
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
    schemaVersion: 'display-recovery-test-v3',
    validateSchema: () => true,
    ...overrides,
  };
}

function canonicalDisplaySelectState() {
  return {
    tables: [{ tableId: 'tblMetric', name: 'MKT_Report_Metric_Values' }],
    fields: [
      field('fldKey', 'report_metric_key', 1, 'Text', true),
      field('fldDisplaySelect', 'display_name', 3, 'SingleSelect'),
      field('fldWindowNumber', 'window_days', 2, 'Number', false, { formatter: '0' }),
      field('fldWindowLegacy', LEGACY_WINDOW_V1, 3, 'SingleSelect'),
    ],
    records: [
      record('rec1', {
        report_metric_key: 'one',
        display_name: 'Views',
        window_days: 1,
        [LEGACY_WINDOW_V1]: '1',
      }),
      record('rec2', {
        report_metric_key: 'two',
        display_name: 'Reach',
        window_days: 3,
        [LEGACY_WINDOW_V1]: '3',
      }),
      record('rec3', {
        report_metric_key: 'three',
        display_name: 'Clicks',
        window_days: 7,
        [LEGACY_WINDOW_V1]: '7',
      }),
    ],
    fieldUpdates: [],
    fieldCreates: [],
    recordBatches: [],
  };
}

test('preview plans exact canonical Select rename, Text create and lossless backfill', async () => {
  const state = canonicalDisplaySelectState();
  const preview = await planReportMetricValueFieldMigration(options(statefulClient(state)));

  assert.equal(preview.contractVersion, REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION);
  assert.equal(preview.repairable, true);
  assert.equal(preview.blockerCount, 0);
  assert.equal(preview.migrationCount, 2);
  assert.equal(preview.pendingMigrationCount, 1);
  assert.equal(preview.plannedFieldMutationCount, 2);
  assert.equal(preview.plannedCanonicalValueWriteCount, 3);
  const display = preview.migrations.find((item) => item.fieldName === 'display_name');
  const window = preview.migrations.find((item) => item.fieldName === 'window_days');
  assert.equal(display.state, 'needs_rename');
  assert.equal(display.nextStep, 'rename_canonical_source');
  assert.equal(display.sourceFieldCount, 1);
  assert.equal(window.state, 'converged');
});

test('apply preserves the original Select field identity and creates Text canonical display_name', async () => {
  const state = canonicalDisplaySelectState();
  const before = snapshotByFieldId(state);
  const result = await applyReportMetricValueFieldMigration(options(statefulClient(state), {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));

  assert.equal(result.contractVersion, REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION);
  assert.equal(result.pendingMigrationCount, 0);
  assert.equal(result.blockerCount, 0);
  assert.equal(result.fieldMutationCount, 2);
  assert.equal(result.canonicalValueWriteCount, 3);
  assert.equal(result.recordBatchWriteCount, 1);
  assert.equal(result.remoteMutationCount, 3);
  assert.equal(result.legacyValueMutationCount, 0);
  assert.equal(result.deleteCount, 0);

  const canonical = state.fields.find((item) => item.fieldName === 'display_name');
  const legacy = state.fields.find((item) => item.fieldName === LEGACY_DISPLAY_V1);
  assert.equal(canonical.type, 1);
  assert.equal(canonical.uiType, 'Text');
  assert.equal(legacy.fieldId, 'fldDisplaySelect');
  assert.deepEqual(state.records.map((item) => item.fields.display_name), ['Views', 'Reach', 'Clicks']);
  assert.deepEqual(
    state.records.map((item) => item.fields[LEGACY_DISPLAY_V1]),
    ['Views', 'Reach', 'Clicks'],
  );

  const after = snapshotByFieldId(state);
  assert.deepEqual(after.get('fldDisplaySelect'), before.get('fldDisplaySelect'));
  assert.equal(state.fields.some((item) => item.fieldName === LEGACY_DISPLAY_V2), false);
});

test('resume after Select rename creates canonical Text and backfills without repeating rename', async () => {
  const state = canonicalDisplaySelectState();
  const display = state.fields.find((item) => item.fieldId === 'fldDisplaySelect');
  display.fieldName = LEGACY_DISPLAY_V1;
  for (const item of state.records) {
    item.fields[LEGACY_DISPLAY_V1] = item.fields.display_name;
    delete item.fields.display_name;
  }

  const preview = await planReportMetricValueFieldMigration(options(statefulClient(state)));
  assert.equal(preview.migrations.find((item) => item.fieldName === 'display_name').state, 'needs_create');
  assert.equal(preview.plannedFieldMutationCount, 1);

  const result = await applyReportMetricValueFieldMigration(options(statefulClient(state), {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));
  assert.equal(result.fieldMutationCount, 1);
  assert.equal(result.canonicalValueWriteCount, 3);
  assert.equal(state.fieldUpdates.length, 0);
  assert.equal(state.fieldCreates.length, 1);
});

test('dual Select display sources are archived and merged without changing either source value', async () => {
  const state = canonicalDisplaySelectState();
  state.fields.push(field('fldDisplayLegacy', LEGACY_DISPLAY_V1, 3, 'SingleSelect'));
  state.records[0].fields[LEGACY_DISPLAY_V1] = 'Views';
  state.records[1].fields[LEGACY_DISPLAY_V1] = null;
  state.records[2].fields.display_name = null;
  state.records[2].fields[LEGACY_DISPLAY_V1] = 'Clicks';
  const before = snapshotByFieldId(state);

  const preview = await planReportMetricValueFieldMigration(options(statefulClient(state)));
  const displayPreview = preview.migrations.find((item) => item.fieldName === 'display_name');
  assert.equal(displayPreview.state, 'needs_archive_primary_legacy');
  assert.equal(preview.plannedFieldMutationCount, 3);
  assert.equal(preview.plannedCanonicalValueWriteCount, 3);

  const result = await applyReportMetricValueFieldMigration(options(statefulClient(state), {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));
  assert.equal(result.fieldMutationCount, 3);
  assert.equal(result.canonicalValueWriteCount, 3);
  assert.equal(state.fields.find((item) => item.fieldName === LEGACY_DISPLAY_V1).fieldId, 'fldDisplaySelect');
  assert.equal(state.fields.find((item) => item.fieldName === LEGACY_DISPLAY_V2).fieldId, 'fldDisplayLegacy');

  const after = snapshotByFieldId(state);
  assert.deepEqual(after.get('fldDisplaySelect'), before.get('fldDisplaySelect'));
  assert.deepEqual(after.get('fldDisplayLegacy'), before.get('fldDisplayLegacy'));
  assert.deepEqual(state.records.map((item) => item.fields.display_name), ['Views', 'Reach', 'Clicks']);
});

test('resume after display archive keeps the secondary legacy source in the union', async () => {
  const state = canonicalDisplaySelectState();
  state.fields.push(field('fldDisplayLegacy', LEGACY_DISPLAY_V2, 3, 'SingleSelect'));
  state.records[0].fields[LEGACY_DISPLAY_V2] = 'Views';
  state.records[1].fields[LEGACY_DISPLAY_V2] = null;
  state.records[2].fields.display_name = null;
  state.records[2].fields[LEGACY_DISPLAY_V2] = 'Clicks';

  const preview = await planReportMetricValueFieldMigration(options(statefulClient(state)));
  assert.equal(preview.migrations.find((item) => item.fieldName === 'display_name').state, 'needs_rename');

  const result = await applyReportMetricValueFieldMigration(options(statefulClient(state), {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));
  assert.equal(result.fieldMutationCount, 2);
  assert.equal(result.canonicalValueWriteCount, 3);
  assert.deepEqual(state.records.map((item) => item.fields.display_name), ['Views', 'Reach', 'Clicks']);
  assert.deepEqual(
    state.records.map((item) => item.fields[LEGACY_DISPLAY_V2] ?? null),
    ['Views', null, 'Clicks'],
  );
});

test('conflicting display Select sources block before any Remote mutation', async () => {
  const state = canonicalDisplaySelectState();
  state.fields.push(field('fldDisplayLegacy', LEGACY_DISPLAY_V1, 3, 'SingleSelect'));
  for (const item of state.records) item.fields[LEGACY_DISPLAY_V1] = item.fields.display_name;
  state.records[0].fields[LEGACY_DISPLAY_V1] = 'Different Views';
  const client = statefulClient(state);

  const preview = await planReportMetricValueFieldMigration(options(client));
  assert.equal(preview.repairable, false);
  assert.equal(preview.blockerCount, 1);
  assert.equal(
    preview.blockers[0].code,
    'REPORT_METRIC_FIELD_MIGRATION_RECOVERY_SOURCE_VALUE_CONFLICT',
  );
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

test('safe evidence excludes physical IDs and display Business values', async () => {
  const preview = await planReportMetricValueFieldMigration(
    options(statefulClient(canonicalDisplaySelectState())),
  );
  const safe = safeReportMetricValueFieldMigrationEvidence(preview);
  const serialized = JSON.stringify(safe);
  for (const forbidden of ['tblMetric', 'fldDisplaySelect', 'rec1', 'Views', 'Clicks']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(safe.migrationCount, 2);
  assert.equal(safe.plannedFieldMutationCount, 2);
  assert.equal(typeof safe.migrations[0].sourceFingerprint, 'string');
});

function field(fieldId, fieldName, type, uiType, isPrimary = false, property = null) {
  return { fieldId, fieldName, type, uiType, isPrimary, property };
}

function record(recordId, fields) {
  return { recordId, fields };
}

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
