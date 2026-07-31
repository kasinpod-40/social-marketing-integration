import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  REPORT_METRIC_VALUE_FIELD_MIGRATION_VERSION,
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
        type: 3,
        uiType: 'SingleSelect',
        primary: false,
        property: Object.freeze({
          options: Object.freeze(['1', '3', '7', '30'].map((name) => Object.freeze({ name }))),
        }),
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
        property: {
          options: [
            { id: 'optViews', name: 'Views', color: 0 },
            { id: 'optReach', name: 'Reach', color: 1 },
            { id: 'optClicks', name: 'Clicks', color: 2 },
          ],
        },
      },
      {
        fieldId: 'fldWindow',
        fieldName: 'window_days',
        type: 3,
        uiType: 'SingleSelect',
        isPrimary: false,
        property: {
          options: ['1', '3', '7', '30'].map((name, color) => ({
            id: `opt${name}`,
            name,
            color,
          })),
        },
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
    schemaVersion: 'test-v2',
    validateSchema: VALIDATE,
    ...overrides,
  };
}

test('v2 migrates display_name while window_days remains a read-only ownership assertion', async () => {
  const state = initialState();
  const client = statefulClient(state);
  const originalWindowField = structuredClone(state.fields.find((field) => field.fieldId === 'fldWindow'));
  const originalWindowValues = structuredClone(state.records.map((record) => record.fields.window_days ?? null));
  const preview = await planReportMetricValueFieldMigration(migrationOptions(client));

  assert.equal(REPORT_METRIC_VALUE_FIELD_MIGRATION_VERSION, 'report_metric_value_field_migration_v2');
  assert.equal(preview.repairable, true);
  assert.equal(preview.migrationCount, 2);
  assert.equal(preview.pendingMigrationCount, 1);
  assert.equal(preview.notRequiredMigrationCount, 1);
  assert.equal(preview.plannedFieldMutationCount, 2);
  assert.equal(preview.plannedCanonicalValueWriteCount, 3);
  assert.deepEqual(preview.migrations.map((item) => item.fieldName), [
    'display_name',
    'window_days',
  ]);
  assert.deepEqual(preview.migrations.map((item) => item.nextStep), [
    'rename_legacy',
    null,
  ]);
  assert.equal(preview.migrations[1].state, 'not_required');
  assert.equal(preview.migrations[1].conversion, 'managed_by_field_identity_recovery_v3');

  const result = await applyReportMetricValueFieldMigration(migrationOptions(client, {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));

  assert.equal(result.pendingMigrationCount, 0);
  assert.equal(result.convergedMigrationCount, 1);
  assert.equal(result.notRequiredMigrationCount, 1);
  assert.equal(result.fieldMutationCount, 2);
  assert.equal(result.canonicalValueWriteCount, 3);
  assert.equal(result.recordBatchWriteCount, 1);
  assert.equal(result.remoteMutationCount, 3);
  assert.equal(result.legacyValueMutationCount, 0);
  assert.equal(result.deleteCount, 0);

  const displayLegacy = state.fields.find(
    (field) => field.fieldName === '__mkt_legacy_display_name_single_select_v1',
  );
  const displayCanonical = state.fields.find((field) => field.fieldName === 'display_name');
  assert.equal(displayLegacy.fieldId, 'fldDisplay');
  assert.equal(displayLegacy.type, 3);
  assert.deepEqual(
    displayLegacy.property.options.map((option) => option.id),
    ['optViews', 'optReach', 'optClicks'],
  );
  assert.equal(displayCanonical.type, 1);
  assert.deepEqual(state.records.map((record) => record.fields.display_name), [
    'Views',
    'Reach',
    'Clicks',
  ]);

  assert.deepEqual(
    state.fields.find((field) => field.fieldId === 'fldWindow'),
    originalWindowField,
  );
  assert.deepEqual(
    state.records.map((record) => record.fields.window_days ?? null),
    originalWindowValues,
  );
  assert.equal(
    state.fields.some((field) => field.fieldName.includes('legacy_window_days')),
    false,
  );

  const readback = await planReportMetricValueFieldMigration(migrationOptions(client));
  assert.equal(readback.pendingMigrationCount, 0);
  assert.equal(readback.convergedMigrationCount, 1);
  assert.equal(readback.notRequiredMigrationCount, 1);
});

test('resumes from renamed/canonical display partial state and writes only missing text values', async () => {
  const state = initialState();
  state.fields = [
    state.fields[0],
    {
      ...state.fields[1],
      fieldName: '__mkt_legacy_display_name_single_select_v1',
    },
    {
      fieldId: 'fldDisplayNew',
      fieldName: 'display_name',
      type: 1,
      uiType: 'Text',
      isPrimary: false,
      property: null,
    },
    state.fields[2],
  ];
  state.records = [
    {
      recordId: 'rec1',
      fields: {
        report_metric_key: 'one',
        __mkt_legacy_display_name_single_select_v1: 'Views',
        display_name: 'Views',
        window_days: '3',
      },
    },
    {
      recordId: 'rec2',
      fields: {
        report_metric_key: 'two',
        __mkt_legacy_display_name_single_select_v1: 'Reach',
        window_days: '7',
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
  assert.deepEqual(state.records.map((record) => record.fields.window_days), ['3', '7']);
});

test('window values are never converted by the legacy migration', async () => {
  const state = initialState();
  state.records[0].fields.window_days = '3D';
  const preview = await planReportMetricValueFieldMigration(
    migrationOptions(statefulClient(state)),
  );
  assert.equal(preview.repairable, true);
  assert.equal(preview.migrationCount, 2);
  const window = preview.migrations.find((item) => item.fieldName === 'window_days');
  assert.equal(window.state, 'not_required');
  assert.equal(window.pending, false);
});

test('blocks noncanonical window field identity and delegates recovery to v3', async () => {
  const state = initialState();
  state.fields.find((field) => field.fieldId === 'fldWindow').type = 2;
  state.fields.find((field) => field.fieldId === 'fldWindow').uiType = 'Number';
  state.fields.find((field) => field.fieldId === 'fldWindow').property = { formatter: '0' };
  const preview = await planReportMetricValueFieldMigration(
    migrationOptions(statefulClient(state)),
  );
  assert.equal(preview.repairable, false);
  assert.equal(
    preview.blockers.some(
      (blocker) => blocker.code === 'REPORT_METRIC_FIELD_MIGRATION_WINDOW_OWNERSHIP_NOT_CONVERGED'
        && blocker.recoveryContract === 'lark_dashboard_field_identity_recovery_v3',
    ),
    true,
  );
});

test('blocks conflicting canonical display values instead of overwriting them', async () => {
  const state = initialState();
  state.fields[1] = {
    ...state.fields[1],
    fieldName: '__mkt_legacy_display_name_single_select_v1',
  };
  state.fields.push({
    fieldId: 'fldDisplayNew',
    fieldName: 'display_name',
    type: 1,
    uiType: 'Text',
    isPrimary: false,
    property: null,
  });
  for (const record of state.records) {
    record.fields.__mkt_legacy_display_name_single_select_v1 = record.fields.display_name;
  }
  state.records[0].fields.display_name = 'Different';
  const preview = await planReportMetricValueFieldMigration(
    migrationOptions(statefulClient(state)),
  );
  assert.equal(preview.repairable, false);
  assert.equal(
    preview.blockers.some(
      (blocker) => blocker.code === 'REPORT_METRIC_FIELD_MIGRATION_CANONICAL_VALUE_MISMATCH',
    ),
    true,
  );
});

test('safe evidence removes physical IDs and row payloads while retaining counts and fingerprints', async () => {
  const preview = await planReportMetricValueFieldMigration(
    migrationOptions(statefulClient(initialState())),
  );
  const safe = safeReportMetricValueFieldMigrationEvidence(preview);
  const serialized = JSON.stringify(safe);
  assert.equal(serialized.includes('tblMetric'), false);
  assert.equal(serialized.includes('fldDisplay'), false);
  assert.equal(serialized.includes('rec1'), false);
  assert.equal(serialized.includes('Views'), false);
  assert.equal(safe.migrations[0].recordCount, 3);
  assert.equal(typeof safe.migrations[0].sourceFingerprint, 'string');
  assert.equal(safe.migrations[1].sourceFingerprint, null);
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
