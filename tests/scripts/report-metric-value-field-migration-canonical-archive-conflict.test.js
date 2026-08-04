import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  applyReportMetricValueFieldMigration,
  planReportMetricValueFieldMigration,
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

function options(client, extra = {}) {
  return {
    client,
    schema: SCHEMA,
    schemaVersion: 'canonical-archive-conflict-hotfix-v1',
    validateSchema: () => true,
    ...extra,
  };
}

function stateWithArchiveConflict({ canonicalValue = 'ยอดดูปัจจุบัน' } = {}) {
  return {
    tables: [{ tableId: 'tblMetric', name: 'MKT_Report_Metric_Values' }],
    fields: [
      field('fldKey', 'report_metric_key', 1, 'Text', true),
      field('fldDisplay', 'display_name', 1, 'Text'),
      field('fldLegacyV1', LEGACY_DISPLAY_V1, 3, 'SingleSelect'),
      field('fldLegacyV2', LEGACY_DISPLAY_V2, 3, 'SingleSelect'),
      field('fldWindow', 'window_days', 2, 'Number', false, { formatter: '0' }),
      field('fldWindowLegacy', LEGACY_WINDOW_V1, 3, 'SingleSelect'),
    ],
    records: [{
      recordId: 'rec1',
      fields: {
        report_metric_key: 'views',
        display_name: canonicalValue,
        [LEGACY_DISPLAY_V1]: 'ยอดดู',
        [LEGACY_DISPLAY_V2]: 'จำนวนการรับชม',
        window_days: 1,
        [LEGACY_WINDOW_V1]: '1',
      },
    }],
    fieldUpdates: [],
    fieldCreates: [],
    recordBatches: [],
  };
}

test('canonical display_name authorizes conflicting immutable archive values', async () => {
  const state = stateWithArchiveConflict();
  const client = statefulClient(state);
  const before = structuredClone(state.records[0].fields);

  const preview = await planReportMetricValueFieldMigration(options(client));
  assert.equal(preview.repairable, true);
  assert.equal(preview.blockerCount, 0);
  assert.equal(preview.pendingMigrationCount, 0);
  assert.equal(preview.canonicalAuthority, 'display_name_text');
  assert.equal(preview.canonicalAuthoritativeArchivedConflictCount, 1);
  assert.equal(preview.canonicalAuthoritativeDivergenceCount, 1);

  const result = await applyReportMetricValueFieldMigration(options(client, {
    env: {
      CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION:
        REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
    },
    sleepImpl: async () => undefined,
  }));

  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.legacyValueMutationCount, 0);
  assert.equal(result.deleteCount, 0);
  assert.equal(result.canonicalAuthoritativeArchivedConflictCount, 1);
  assert.deepEqual(state.records[0].fields, before);
  assert.equal(state.fieldUpdates.length, 0);
  assert.equal(state.fieldCreates.length, 0);
  assert.equal(state.recordBatches.length, 0);
});

test('conflicting archive values remain blocked when canonical display_name is missing', async () => {
  const state = stateWithArchiveConflict({ canonicalValue: null });
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
      env: {
        CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION:
          REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
      },
      sleepImpl: async () => undefined,
    })),
  );
  assert.equal(state.fieldUpdates.length, 0);
  assert.equal(state.fieldCreates.length, 0);
  assert.equal(state.recordBatches.length, 0);
});

function field(fieldId, fieldName, type, uiType, isPrimary = false, property = null) {
  return { fieldId, fieldName, type, uiType, isPrimary, property };
}

function statefulClient(state) {
  return {
    async listTables() { return structuredClone(state.tables); },
    async listFields() { return structuredClone(state.fields); },
    async listRecords() { return structuredClone(state.records); },
    async updateField({ fieldId, field: update }) {
      const index = state.fields.findIndex((item) => item.fieldId === fieldId);
      assert.notEqual(index, -1);
      state.fields[index] = { ...state.fields[index], ...structuredClone(update) };
      state.fieldUpdates.push({ fieldId, field: structuredClone(update) });
      return structuredClone(state.fields[index]);
    },
    async createField({ field: contract }) {
      const created = {
        fieldId: `created-${state.fieldCreates.length + 1}`,
        ...structuredClone(contract),
        isPrimary: false,
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
