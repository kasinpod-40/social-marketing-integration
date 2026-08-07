import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES,
} from '../../scripts/lib/lark-dashboard-compatibility-freeze-v1.js';
import {
  planReportMetricValueFieldMigration,
} from '../../scripts/lib/report-metric-value-field-migration-recovery-v4.js';

const TABLE_ID = 'tblMetric';
const ENV = Object.freeze({
  MKT_ENV: 'development',
  MKT_CUSTOMER_PROFILE: 'integration_workspace',
  LARK_TABLE_MKT_REPORT_METRIC_VALUES: TABLE_ID,
});
const WINDOW_PRESETS = Object.freeze([1, 3, 7, 30]);
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
      type: 3,
      uiType: 'SingleSelect',
      primary: false,
      property: Object.freeze({
        options: Object.freeze(WINDOW_PRESETS.map((value) => Object.freeze({ name: String(value) }))),
      }),
    }),
  ]),
})]);

const CHAIN_FILES = Object.freeze([
  'scripts/lib/report-metric-value-field-migration.js',
  'scripts/lib/report-metric-value-field-migration-recovery.js',
  'scripts/lib/report-metric-value-field-migration-recovery-v3.js',
  'scripts/lib/report-metric-value-field-migration-recovery-v4.js',
  'scripts/lib/lark-dashboard-compatibility-freeze-v1.js',
]);

test('Finalizer migration chain contains no total-table row-count admission ceiling', () => {
  for (const path of CHAIN_FILES) {
    const source = readFileSync(path, 'utf8');
    assert.equal(source.includes('REPORT_METRIC_FIELD_MIGRATION_RECORD_BOUND_EXCEEDED'), false, path);
    assert.equal(source.includes('REPORT_METRIC_COMPATIBILITY_FREEZE_RECORD_BOUND_EXCEEDED'), false, path);
    assert.equal(/\bMAX_RECORDS\b/u.test(source), false, path);
    assert.equal(/\bMAX_REPORT_METRIC_RECORDS\b/u.test(source), false, path);
  }
});

test('exact Finalizer v4 path admits 2501 compatible Report Metric records with zero pending migration', async () => {
  const state = exactCompatibilityState(2_501);
  const preview = await planReportMetricValueFieldMigration({
    client: statefulClient(state),
    env: ENV,
    schema: SCHEMA,
    schemaVersion: 'growth-safe-finalizer-chain-v1',
    validateSchema: () => true,
  });

  assert.equal(preview.repairable, true);
  assert.equal(preview.blockerCount, 0);
  assert.equal(preview.pendingMigrationCount, 0);
  assert.equal(preview.migrationCount, 2);
  assert.equal(preview.compatibilityFreeze, true);
  assert.equal(preview.compatibilityFreezeRecordCount, 2_501);
  assert.equal(preview.compatibilityFreezeWindowParityCount, 2_501);
  assert.equal(preview.remoteMutationCount, 0);
  assert.equal(preview.deleteCount, 0);
});

function exactCompatibilityState(recordCount) {
  const identities = LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES;
  const fields = [
    exactField(identities.metricKey),
    exactField(identities.displayName),
    exactField(identities.numberWindow, { formatter: '0' }),
    exactField(identities.preservedWindowSelect, {
      options: WINDOW_PRESETS.map((value) => ({ name: String(value) })),
    }),
    exactField(identities.windowSelectV2, {
      options: WINDOW_PRESETS.map((value) => ({ name: String(value) })),
    }),
    exactField(identities.displaySelectV1, { options: [] }),
    exactField(identities.displaySelectV2, { options: [] }),
  ];
  const records = Array.from({ length: recordCount }, (_, index) => {
    const windowDays = WINDOW_PRESETS[index % WINDOW_PRESETS.length];
    return {
      recordId: `rec${index + 1}`,
      fields: {
        metric_key: `metric-${index + 1}`,
        display_name: `Metric ${index + 1}`,
        window_days: windowDays,
        __mkt_legacy_window_days_single_select_v1: String(windowDays),
        __mkt_legacy_window_days_single_select_v2: null,
        __mkt_legacy_display_name_single_select_v1: null,
        __mkt_legacy_display_name_single_select_v2: null,
      },
    };
  });
  return {
    tables: [{ tableId: TABLE_ID, name: 'MKT_Report_Metric_Values' }],
    fields,
    records,
  };
}

function statefulClient(state) {
  return {
    async listTables() { return structuredClone(state.tables); },
    async listFields() { return structuredClone(state.fields); },
    async listRecords() { return structuredClone(state.records); },
    async updateField() { throw new Error('unexpected updateField in preview'); },
    async createField() { throw new Error('unexpected createField in preview'); },
    async batchUpdateRecords() { throw new Error('unexpected batchUpdateRecords in preview'); },
  };
}

function exactField(identity, property = null) {
  return {
    fieldId: identity.fieldId,
    fieldName: identity.fieldName,
    type: identity.type,
    uiType: identity.type === 1 ? 'Text' : identity.type === 2 ? 'Number' : 'SingleSelect',
    isPrimary: identity.isPrimary,
    property,
  };
}
