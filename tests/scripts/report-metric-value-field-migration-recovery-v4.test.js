import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION,
  applyReportMetricValueFieldMigration,
  planReportMetricValueFieldMigration,
  safeReportMetricValueFieldMigrationEvidence,
} from '../../scripts/lib/report-metric-value-field-migration-recovery-v4.js';

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
    schemaVersion: 'canonical-authority-test-v4',
    validateSchema: () => true,
    ...overrides,
  };
}

function convergedRuntimeState() {
  return {
    tables: [{ tableId: 'tblMetric', name: 'MKT_Report_Metric_Values' }],
    fields: [
      field('fldKey', 'report_metric_key', 1, 'Text', true),
      field('fldDisplayText', 'display_name', 1, 'Text'),
      field('fldDisplayLegacy', LEGACY_DISPLAY_V1, 3, 'SingleSelect'),
      field('fldWindowNumber', 'window_days', 2, 'Number', false, { formatter: '0' }),
      field('fldWindowLegacy', LEGACY_WINDOW_V1, 3, 'SingleSelect'),
    ],
    records: [
      record('rec1', {
        report_metric_key: 'one',
        display_name: 'ยอดดูปัจจุบัน',
        [LEGACY_DISPLAY_V1]: 'ยอดดู',
        window_days: 1,
        [LEGACY_WINDOW_V1]: '1',
      }),
      record('rec2', {
        report_metric_key: 'two',
        display_name: 'การเข้าถึง',
        [LEGACY_DISPLAY_V1]: 'การเข้าถึง',
        window_days: 1,
        [LEGACY_WINDOW_V1]: '1',
      }),
      record('rec3', {
        report_metric_key: 'three',
        display_name: 'ข้อมูลพร้อมใช้งาน',
        [LEGACY_DISPLAY_V1]: null,
        window_days: 1,
        [LEGACY_WINDOW_V1]: '1',
      }),
    ],
    fieldUpdates: [],
    fieldCreates: [],
    recordBatches: [],
  };
}

test('preview treats canonical Text as authoritative after deterministic Legacy archive exists', async () => {
  const state = convergedRuntimeState();
  const preview = await planReportMetricValueFieldMigration(options(statefulClient(state)));

  assert.equal(preview.contractVersion, REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION);
  assert.equal(preview.repairable, true);
  assert.equal(preview.blockerCount, 0);
  assert.equal(preview.migrationCount, 2);
  assert.equal(preview.pendingMigrationCount, 0);
  assert.equal(preview.convergedMigrationCount, 2);
  assert.equal(preview.plannedFieldMutationCount, 0);
  assert.equal(preview.plannedCanonicalValueWriteCount, 0);
  assert.equal(preview.canonicalAuthority, 'display_name_text');
  assert.equal(preview.canonicalAuthoritativeDivergenceCount, 1);
  assert.equal(preview.canonicalOnlyRecordCount, 1);
  assert.equal(preview.legacyBackfillRecordCount, 0);
});

test('apply preserves divergent canonical and every archived Legacy value without mutation', async () => {
  const state = convergedRuntimeState();
  const beforeCanonical = state.records.map((item) => item.fields.display_name);
  const beforeLegacy = state.records.map((item) => item.fields[LEGACY_DISPLAY_V1]);

  const result = await applyReportMetricValueFieldMigration(options(statefulClient(state), {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));

  assert.equal(result.contractVersion, REPORT_METRIC_VALUE_FIELD_MIGRATION_RECOVERY_VERSION);
  assert.equal(result.pendingMigrationCount, 0);
  assert.equal(result.blockerCount, 0);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.fieldMutationCount, 0);
  assert.equal(result.canonicalValueWriteCount, 0);
  assert.equal(result.recordBatchWriteCount, 0);
  assert.equal(result.legacyValueMutationCount, 0);
  assert.equal(result.deleteCount, 0);
  assert.equal(result.canonicalAuthoritativeDivergenceCount, 1);
  assert.deepEqual(state.records.map((item) => item.fields.display_name), beforeCanonical);
  assert.deepEqual(state.records.map((item) => item.fields[LEGACY_DISPLAY_V1]), beforeLegacy);
});

test('canonical-authority recovery backfills only missing canonical values', async () => {
  const state = convergedRuntimeState();
  state.records[1].fields.display_name = null;
  const beforeLegacy = state.records.map((item) => item.fields[LEGACY_DISPLAY_V1]);

  const preview = await planReportMetricValueFieldMigration(options(statefulClient(state)));
  assert.equal(preview.repairable, true);
  assert.equal(preview.pendingMigrationCount, 1);
  assert.equal(preview.plannedCanonicalValueWriteCount, 1);
  assert.equal(preview.legacyBackfillRecordCount, 1);

  const result = await applyReportMetricValueFieldMigration(options(statefulClient(state), {
    env: CONFIRMED_ENV,
    sleepImpl: async () => undefined,
  }));
  assert.equal(result.remoteMutationCount, 1);
  assert.equal(result.canonicalValueWriteCount, 1);
  assert.equal(result.recordBatchWriteCount, 1);
  assert.equal(result.legacyValueMutationCount, 0);
  assert.equal(state.records[1].fields.display_name, 'การเข้าถึง');
  assert.deepEqual(state.records.map((item) => item.fields[LEGACY_DISPLAY_V1]), beforeLegacy);
});

test('conflicting archived Legacy sources without canonical remain blocked before mutation', async () => {
  const state = convergedRuntimeState();
  state.fields.push(field('fldDisplayLegacyV2', LEGACY_DISPLAY_V2, 3, 'SingleSelect'));
  for (const item of state.records) item.fields[LEGACY_DISPLAY_V2] = item.fields[LEGACY_DISPLAY_V1];
  state.records[0].fields[LEGACY_DISPLAY_V2] = 'ค่าขัดแย้ง';
  state.records[0].fields.display_name = null;
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
  );
  assert.equal(state.fieldUpdates.length, 0);
  assert.equal(state.fieldCreates.length, 0);
  assert.equal(state.recordBatches.length, 0);
});

test('safe evidence exposes counts but excludes physical IDs and Business values', async () => {
  const preview = await planReportMetricValueFieldMigration(
    options(statefulClient(convergedRuntimeState())),
  );
  const safe = safeReportMetricValueFieldMigrationEvidence(preview);
  const serialized = JSON.stringify(safe);

  for (const forbidden of ['tblMetric', 'fldDisplayText', 'rec1', 'ยอดดูปัจจุบัน', 'การเข้าถึง']) {
    assert.equal(serialized.includes(forbidden), false);
  }
  assert.equal(safe.canonicalAuthority, 'display_name_text');
  assert.equal(safe.canonicalAuthoritativeDivergenceCount, 1);
});

function field(fieldId, fieldName, type, uiType, isPrimary = false, property = null) {
  return { fieldId, fieldName, type, uiType, isPrimary, property };
}

function record(recordId, fields) {
  return { recordId, fields };
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
