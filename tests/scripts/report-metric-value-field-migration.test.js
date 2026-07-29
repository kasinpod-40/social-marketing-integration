import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  applyReportMetricValueFieldMigration,
  planReportMetricValueFieldMigration,
  safeReportMetricValueFieldMigrationEvidence,
} from '../../scripts/lib/report-metric-value-field-migration.js';

const SCHEMA = Object.freeze([
  Object.freeze({
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
  }),
]);
const VALIDATE = () => true;
const CONFIRMED_ENV = Object.freeze({
  CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION:
    REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
});

function initialState() {
  return {
    tables: [{ tableId: 'tblMetric', name: 'MKT_Report_Metric_Values' }],
    fields: [
      { fieldId: 'fldKey', fieldName: 'report_metric_key', type: 1, uiType: 'Text', isPrimary: true, property: null },
      {
        fieldId: 'fldDisplay',
        fieldName: 'display_name',
        type: 3,
        uiType: 'SingleSelect',
        isPrimary: false,
        property: { options: [{ id: 'optViews', name: 'Views', color: 0 }, { id: 'optReach', name: 'Reach', color: 1 }, { id: 'optClicks', name: 'Clicks', color: 2 }] },
      },
      {
        fieldId: 'fldWindow',
        fieldName: 'window_days',
        type: 3,
        uiType: 'SingleSelect',
        isPrimary: false,
        property: { options: [{ id: 'opt3', name: '3', color: 0 }, { id: 'opt7', name: '7', color: 1 }] },
      },
    ],
    records: [
      { recordId: 'rec1', fields: { report_metric_key: 'one', display_name: 'Views', window_days: '3' } },
      { recordId: 'rec2', fields: { report_metric_key: 'two', display_name: { name: 'Reach' }, window_days: [{ text: '7' }] } },
      { recordId: 'rec3', fields: { report_metric_key: 'three', display_name: ['Clicks'], window_days: null } },
    ],
    fieldUpdates: [],
    fieldCreates: [],
    recordBatches: [],
  };
}

function migrationOptions(client, overrides = {}) {
  return {
    client,
    schema: SCHEMA,
    schemaVersion: 'test-v1',
    validateSchema: VALIDATE,
    ...overrides,
  };
}

test('plans and applies a lossless populated SingleSelect to Text/Number migration', async () => {
  const state = initialState();
  const client = statefulClient(state);
  const preview = await planReportMetricValueFieldMigration(migrationOptions(client));

  assert.equal(preview.repairable, true);
  assert.equal(preview.migrationCount, 2);
  assert.equal(preview.pendingMigrationCount, 2);
  assert.equal(preview.plannedFieldMutationCount, 4);
  assert.equal(preview.plannedCanonicalValueWriteCount, 5);
  assert.deepEqual(preview.migrations.map((item) => item.nextStep), [
    'rename_legacy',
    'rename_legacy',
  ]);

  const beforeLegacyValues = structuredClone(state.records.map((record) => record.fields));
  const result = await applyReportMetricValueFieldMigration(migrationOptions(client, {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));

  assert.equal(result.pendingMigrationCount, 0);
  assert.equal(result.convergedMigrationCount, 2);
  assert.equal(result.fieldMutationCount, 4);
  assert.equal(result.canonicalValueWriteCount, 5);
  assert.equal(result.recordBatchWriteCount, 2);
  assert.equal(result.remoteMutationCount, 6);
  assert.equal(result.legacyValueMutationCount, 0);
  assert.equal(result.deleteCount, 0);

  const displayLegacy = state.fields.find((field) => field.fieldName === '__mkt_legacy_display_name_single_select_v1');
  const windowLegacy = state.fields.find((field) => field.fieldName === '__mkt_legacy_window_days_single_select_v1');
  const displayCanonical = state.fields.find((field) => field.fieldName === 'display_name');
  const windowCanonical = state.fields.find((field) => field.fieldName === 'window_days');
  assert.equal(displayLegacy.fieldId, 'fldDisplay');
  assert.equal(displayLegacy.type, 3);
  assert.deepEqual(displayLegacy.property.options.map((option) => option.id), ['optViews', 'optReach', 'optClicks']);
  assert.equal(windowLegacy.fieldId, 'fldWindow');
  assert.equal(windowLegacy.type, 3);
  assert.equal(displayCanonical.type, 1);
  assert.equal(windowCanonical.type, 2);
  assert.deepEqual(windowCanonical.property, { formatter: '0' });

  assert.deepEqual(state.records.map((record) => record.fields.display_name), ['Views', 'Reach', 'Clicks']);
  assert.deepEqual(state.records.map((record) => record.fields.window_days ?? null), [3, 7, null]);
  assert.deepEqual(
    state.records.map((record) => ({
      display: record.fields.__mkt_legacy_display_name_single_select_v1,
      window: record.fields.__mkt_legacy_window_days_single_select_v1 ?? null,
    })),
    beforeLegacyValues.map((fields) => ({
      display: fields.display_name,
      window: fields.window_days ?? null,
    })),
  );

  const readback = await planReportMetricValueFieldMigration(migrationOptions(client));
  assert.equal(readback.pendingMigrationCount, 0);
  assert.equal(readback.convergedMigrationCount, 2);
});

test('resumes from renamed/canonical partial state and writes only missing canonical values', async () => {
  const state = initialState();
  state.fields = [
    state.fields[0],
    {
      ...state.fields[1],
      fieldName: '__mkt_legacy_display_name_single_select_v1',
    },
    { fieldId: 'fldDisplayNew', fieldName: 'display_name', type: 1, uiType: 'Text', isPrimary: false, property: null },
    { fieldId: 'fldWindowNew', fieldName: 'window_days', type: 2, uiType: 'Number', isPrimary: false, property: { formatter: '0' } },
  ];
  state.records = [
    {
      recordId: 'rec1',
      fields: {
        report_metric_key: 'one',
        __mkt_legacy_display_name_single_select_v1: 'Views',
        display_name: 'Views',
        window_days: 3,
      },
    },
    {
      recordId: 'rec2',
      fields: {
        report_metric_key: 'two',
        __mkt_legacy_display_name_single_select_v1: 'Reach',
        window_days: 7,
      },
    },
  ];
  const client = statefulClient(state);
  const preview = await planReportMetricValueFieldMigration(migrationOptions(client));
  const display = preview.migrations.find((item) => item.fieldName === 'display_name');
  const window = preview.migrations.find((item) => item.fieldName === 'window_days');
  assert.equal(display.state, 'needs_backfill');
  assert.equal(display.pendingRecordCount, 1);
  assert.equal(window.state, 'not_required');

  const result = await applyReportMetricValueFieldMigration(migrationOptions(client, {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));
  assert.equal(result.fieldMutationCount, 0);
  assert.equal(result.canonicalValueWriteCount, 1);
  assert.equal(result.recordBatchWriteCount, 1);
  assert.equal(state.records[1].fields.display_name, 'Reach');
  assert.equal(state.records[0].fields.__mkt_legacy_display_name_single_select_v1, 'Views');
});

test('blocks non-lossless window labels before any remote mutation', async () => {
  const state = initialState();
  state.records[0].fields.window_days = '3D';
  const client = statefulClient(state);
  const preview = await planReportMetricValueFieldMigration(migrationOptions(client));
  assert.equal(preview.repairable, false);
  assert.equal(preview.blockers.some((blocker) => blocker.code === 'REPORT_METRIC_FIELD_MIGRATION_VALUE_NOT_LOSSLESS'), true);

  await assert.rejects(
    applyReportMetricValueFieldMigration(migrationOptions(client, {
      env: CONFIRMED_ENV,
      sleepImpl: async () => undefined,
    })),
    (error) => error.code === 'REPORT_METRIC_FIELD_MIGRATION_BLOCKED',
  );
  assert.equal(state.fieldUpdates.length, 0);
  assert.equal(state.fieldCreates.length, 0);
  assert.equal(state.recordBatches.length, 0);
});

test('blocks conflicting canonical values instead of overwriting them', async () => {
  const state = initialState();
  state.fields[1] = {
    ...state.fields[1],
    fieldName: '__mkt_legacy_display_name_single_select_v1',
  };
  state.fields.push({ fieldId: 'fldDisplayNew', fieldName: 'display_name', type: 1, uiType: 'Text', isPrimary: false, property: null });
  for (const record of state.records) {
    record.fields.__mkt_legacy_display_name_single_select_v1 = record.fields.display_name;
  }
  state.records[0].fields.display_name = 'Different';
  const preview = await planReportMetricValueFieldMigration(migrationOptions(statefulClient(state)));
  assert.equal(preview.repairable, false);
  assert.equal(preview.blockers.some((blocker) => blocker.code === 'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_VALUE_MISMATCH'), true);
});

test('safe evidence removes physical IDs and row payloads while retaining counts and fingerprints', async () => {
  const preview = await planReportMetricValueFieldMigration(migrationOptions(statefulClient(initialState())));
  const safe = safeReportMetricValueFieldMigrationEvidence(preview);
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes('tblMetric'), false);
  assert.equal(serialized.includes('fldDisplay'), false);
  assert.equal(serialized.includes('rec1'), false);
  assert.equal(serialized.includes('Views'), false);
  assert.equal(safe.migrations[0].recordCount, 3);
  assert.equal(typeof safe.migrations[0].sourceFingerprint, 'string');
});

function statefulClient(state) {
  return {
    async listTables() {
      return state.tables.map((table) => structuredClone(table));
    },
    async listFields() {
      return state.fields.map((field) => structuredClone(field));
    },
    async listRecords() {
      return state.records.map((record) => structuredClone(record));
    },
    async updateField({ fieldId, field }) {
      const index = state.fields.findIndex((candidate) => candidate.fieldId === fieldId);
      assert.notEqual(index, -1);
      const previousName = state.fields[index].fieldName;
      state.fields[index] = {
        ...state.fields[index],
        fieldName: field.fieldName,
        type: field.type,
        uiType: field.uiType ?? state.fields[index].uiType,
        description: field.description ?? state.fields[index].description ?? '',
        property: structuredClone(field.property ?? null),
      };
      for (const record of state.records) {
        if (Object.hasOwn(record.fields, previousName)) {
          record.fields[field.fieldName] = record.fields[previousName];
          delete record.fields[previousName];
        }
      }
      state.fieldUpdates.push({ fieldId, field: structuredClone(field) });
      return structuredClone(state.fields[index]);
    },
    async createField({ field }) {
      const created = {
        fieldId: `fldCreated${state.fieldCreates.length + 1}`,
        fieldName: field.fieldName,
        type: field.type,
        uiType: field.uiType,
        isPrimary: false,
        description: field.description ?? '',
        property: structuredClone(field.property ?? null),
      };
      state.fields.push(created);
      state.fieldCreates.push(structuredClone(created));
      return structuredClone(created);
    },
    async batchUpdateRecords({ records }) {
      for (const update of records) {
        const record = state.records.find((candidate) => candidate.recordId === update.recordId);
        assert.ok(record);
        Object.assign(record.fields, structuredClone(update.fields));
      }
      state.recordBatches.push(structuredClone(records));
      return { updated: records.length };
    },
  };
}
