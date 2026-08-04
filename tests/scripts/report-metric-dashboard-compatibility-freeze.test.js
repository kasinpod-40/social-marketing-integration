import test from 'node:test';
import assert from 'node:assert/strict';
import {
  LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES,
  buildLarkDashboardCompatibilityReportSchema,
  inspectLarkDashboardCompatibilityFreeze,
} from '../../scripts/lib/lark-dashboard-compatibility-freeze-v1.js';
import {
  REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
  applyReportMetricValueFieldMigration,
  planReportMetricValueFieldMigration,
} from '../../scripts/lib/report-metric-value-field-migration-recovery-v4.js';
import {
  assertReportMetricValueFieldMigrationPreviewSafe,
} from '../../scripts/lib/report-runtime-finalize-operator.js';

const TABLE_ID = 'tblMetric';
const ENV = Object.freeze({
  MKT_ENV: 'development',
  MKT_CUSTOMER_PROFILE: 'integration_workspace',
  LARK_TABLE_MKT_REPORT_METRIC_VALUES: TABLE_ID,
});
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
        options: Object.freeze(['1', '3', '7', '30'].map((name) => Object.freeze({ name }))),
      }),
    }),
  ]),
})]);

function exactState() {
  const identities = LARK_DASHBOARD_COMPATIBILITY_FIELD_IDENTITIES;
  return {
    tables: [{ tableId: TABLE_ID, name: 'MKT_Report_Metric_Values' }],
    fields: [
      exactField(identities.metricKey),
      exactField(identities.displayName),
      exactField(identities.numberWindow, false, { formatter: '0' }),
      exactField(identities.preservedWindowSelect, false, {
        options: ['1', '3', '7', '30'].map((name) => ({ name })),
      }),
      exactField(identities.windowSelectV2, false, {
        options: ['1', '3', '7', '30'].map((name) => ({ name })),
      }),
      exactField(identities.displaySelectV1, false, {
        options: [{ name: 'Old A' }, { name: 'B' }],
      }),
      exactField(identities.displaySelectV2, false, {
        options: [{ name: 'Older A' }, { name: 'B' }],
      }),
    ],
    records: [
      record('rec1', {
        metric_key: 'one',
        display_name: 'Canonical A',
        __mkt_legacy_display_name_single_select_v1: 'Old A',
        __mkt_legacy_display_name_single_select_v2: 'Older A',
        window_days: 1,
        __mkt_legacy_window_days_single_select_v1: '1',
        __mkt_legacy_window_days_single_select_v2: '1',
      }),
      record('rec2', {
        metric_key: 'two',
        display_name: 'B',
        __mkt_legacy_display_name_single_select_v1: null,
        __mkt_legacy_display_name_single_select_v2: null,
        window_days: 3,
        __mkt_legacy_window_days_single_select_v1: '3',
        __mkt_legacy_window_days_single_select_v2: null,
      }),
    ],
    fieldUpdates: [],
    fieldCreates: [],
    recordBatches: [],
  };
}

test('exact Integration Workspace freeze overlays only Metric window_days as Number', () => {
  const schema = buildLarkDashboardCompatibilityReportSchema(SCHEMA, ENV);
  const window = schema[0].fields.find((field) => field.fieldName === 'window_days');
  assert.equal(window.type, 2);
  assert.equal(window.uiType, 'Number');
  assert.deepEqual(window.property, { formatter: '0' });
  assert.equal(SCHEMA[0].fields[2].type, 3);
});

test('exact Dashboard Compatibility Freeze is admitted as zero-mutation migration convergence', async () => {
  const state = exactState();
  const client = statefulClient(state);
  const compatibility = await inspectLarkDashboardCompatibilityFreeze({ client, env: ENV });
  assert.equal(compatibility.compatible, true);
  assert.equal(compatibility.windowParityCount, 2);
  assert.equal(compatibility.archivedDisplayConflictCount, 1);

  const preview = await planReportMetricValueFieldMigration({
    client,
    env: ENV,
    schema: SCHEMA,
    schemaVersion: 'compatibility-freeze-test-v1',
    validateSchema: () => true,
  });
  assert.equal(preview.repairable, true);
  assert.equal(preview.blockerCount, 0);
  assert.equal(preview.migrationCount, 2);
  assert.equal(preview.pendingMigrationCount, 0);
  assert.equal(preview.compatibilityFreeze, true);
  assert.equal(preview.plannedFieldMutationCount, 0);
  assert.equal(preview.plannedCanonicalValueWriteCount, 0);
  assertReportMetricValueFieldMigrationPreviewSafe({ ...preview, ok: true, mode: 'preview' });

  const result = await applyReportMetricValueFieldMigration({
    client,
    env: {
      ...ENV,
      CONFIRM_REPORT_METRIC_VALUE_FIELD_MIGRATION:
        REPORT_METRIC_VALUE_FIELD_MIGRATION_CONFIRMATION,
    },
    schema: SCHEMA,
    schemaVersion: 'compatibility-freeze-test-v1',
    validateSchema: () => true,
    sleepImpl: async () => undefined,
  });
  assert.equal(result.pendingMigrationCount, 0);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.legacyValueMutationCount, 0);
  assert.equal(result.deleteCount, 0);
  assert.equal(state.fieldUpdates.length, 0);
  assert.equal(state.fieldCreates.length, 0);
  assert.equal(state.recordBatches.length, 0);
});

test('Dashboard Compatibility Freeze blocks Number and preserved Select mismatch', async () => {
  const state = exactState();
  state.records[0].fields.__mkt_legacy_window_days_single_select_v1 = '3';
  const preview = await planReportMetricValueFieldMigration({
    client: statefulClient(state),
    env: ENV,
    schema: SCHEMA,
    schemaVersion: 'compatibility-freeze-test-v1',
    validateSchema: () => true,
  });
  assert.equal(preview.repairable, false);
  assert.equal(preview.blockerCount, 1);
  assert.equal(
    preview.blockers[0].code,
    'REPORT_METRIC_COMPATIBILITY_FREEZE_WINDOW_PARITY_MISMATCH',
  );
  assert.equal(preview.remoteMutationCount, 0);
});

test('Dashboard Compatibility Freeze blocks stale physical Field identity', async () => {
  const state = exactState();
  state.fields.find((field) => field.fieldName === 'window_days').fieldId = 'fldWrong';
  const compatibility = await inspectLarkDashboardCompatibilityFreeze({
    client: statefulClient(state),
    env: ENV,
  });
  assert.equal(compatibility.compatible, false);
  assert.equal(
    compatibility.blockers[0].code,
    'REPORT_METRIC_COMPATIBILITY_FREEZE_FIELD_IDENTITY_MISMATCH',
  );
});

test('Dashboard Compatibility Freeze blocks metric_key promoted to Primary', async () => {
  const state = exactState();
  state.fields.find((field) => field.fieldName === 'metric_key').isPrimary = true;
  const compatibility = await inspectLarkDashboardCompatibilityFreeze({
    client: statefulClient(state),
    env: ENV,
  });
  assert.equal(compatibility.compatible, false);
  assert.equal(compatibility.blockers.length, 1);
  assert.equal(
    compatibility.blockers[0].code,
    'REPORT_METRIC_COMPATIBILITY_FREEZE_FIELD_IDENTITY_MISMATCH',
  );
  assert.equal(compatibility.blockers[0].identityKey, 'metricKey');
  assert.equal(compatibility.blockers[0].expectedPrimary, false);
  assert.equal(compatibility.blockers[0].actualPrimary, true);
});

test('Dashboard Compatibility Freeze blocks missing canonical display even with one archive', async () => {
  const state = exactState();
  state.records[0].fields.display_name = null;
  state.records[0].fields.__mkt_legacy_display_name_single_select_v2 = 'Old A';
  const compatibility = await inspectLarkDashboardCompatibilityFreeze({
    client: statefulClient(state),
    env: ENV,
  });
  assert.equal(compatibility.compatible, false);
  assert.equal(
    compatibility.blockers[0].code,
    'REPORT_METRIC_COMPATIBILITY_FREEZE_CANONICAL_DISPLAY_MISSING',
  );
});

function exactField(identity, isPrimary = false, property = null) {
  return {
    fieldId: identity.fieldId,
    fieldName: identity.fieldName,
    type: identity.type,
    uiType: identity.type === 1 ? 'Text' : identity.type === 2 ? 'Number' : 'SingleSelect',
    isPrimary,
    property,
  };
}

function record(recordId, fields) {
  return { recordId, fields };
}

function statefulClient(state) {
  return {
    async listTables() { return structuredClone(state.tables); },
    async listFields() { return structuredClone(state.fields); },
    async listRecords() { return structuredClone(state.records); },
    async updateField({ fieldId, field }) {
      state.fieldUpdates.push({ fieldId, field: structuredClone(field) });
      return { fieldId, ...structuredClone(field) };
    },
    async createField({ field }) {
      state.fieldCreates.push(structuredClone(field));
      return { fieldId: `created-${state.fieldCreates.length}`, ...structuredClone(field) };
    },
    async batchUpdateRecords({ records }) {
      state.recordBatches.push(structuredClone(records));
      return { updated: records.length };
    },
  };
}
