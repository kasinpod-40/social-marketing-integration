import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_METRIC_VALUE_TABLE_ENV,
  resolveReportMetricValueTableEnvironment,
} from '../../scripts/lib/report-metric-value-table-environment-resolver.js';

const TABLE_ID = 'tblMetricValues';
const TABLE_NAME = '📊 MKT_Report_Metric_Values';
const SCHEMA = Object.freeze([Object.freeze({
  key: 'mktReportMetricValues',
  logicalName: 'MKT_Report_Metric_Values',
  createName: TABLE_NAME,
  aliases: Object.freeze(['MKT_Report_Metric_Values', TABLE_NAME]),
  envName: REPORT_METRIC_VALUE_TABLE_ENV,
  defaultViewName: 'All Metrics',
  fields: Object.freeze([
    Object.freeze({
      fieldName: 'report_metric_key',
      type: 1,
      uiType: 'Text',
      primary: true,
      description: 'Stable key',
    }),
  ]),
})]);

const INTEGRATION_ENV = Object.freeze({
  MKT_ENV: 'development',
  MKT_CUSTOMER_PROFILE: 'integration_workspace',
});

test('missing Report Metric table mapping resolves through the shared schema planner in memory', async () => {
  const calls = [];
  const env = await resolveReportMetricValueTableEnvironment({
    env: INTEGRATION_ENV,
    schema: SCHEMA,
    schemaVersion: 'resolver-test-v1',
    validateSchema: () => true,
    client: {
      async listTables() {
        calls.push('listTables');
        return [{ tableId: TABLE_ID, name: TABLE_NAME }];
      },
      async listFields({ tableId }) {
        calls.push(`listFields:${tableId}`);
        return [{
          fieldId: 'fldPrimary',
          fieldName: 'report_metric_key',
          type: 1,
          isPrimary: true,
          description: 'Stable key',
          property: null,
        }];
      },
    },
  });

  assert.equal(env[REPORT_METRIC_VALUE_TABLE_ENV], TABLE_ID);
  assert.equal(Object.hasOwn(INTEGRATION_ENV, REPORT_METRIC_VALUE_TABLE_ENV), false);
  assert.deepEqual(calls, ['listTables', `listFields:${TABLE_ID}`]);
});

test('configured Report Metric table mapping remains authoritative without discovery', async () => {
  let readCount = 0;
  const env = await resolveReportMetricValueTableEnvironment({
    env: {
      ...INTEGRATION_ENV,
      [REPORT_METRIC_VALUE_TABLE_ENV]: TABLE_ID,
    },
    client: {
      async listTables() { readCount += 1; return []; },
      async listFields() { readCount += 1; return []; },
    },
  });

  assert.equal(env[REPORT_METRIC_VALUE_TABLE_ENV], TABLE_ID);
  assert.equal(readCount, 0);
});

test('non-Integration profile keeps standard migration behavior without private discovery', async () => {
  let readCount = 0;
  const env = await resolveReportMetricValueTableEnvironment({
    env: {
      MKT_ENV: 'production',
      MKT_CUSTOMER_PROFILE: 'chemistry_k',
    },
    client: {
      async listTables() { readCount += 1; return []; },
      async listFields() { readCount += 1; return []; },
    },
  });

  assert.equal(Object.hasOwn(env, REPORT_METRIC_VALUE_TABLE_ENV), false);
  assert.equal(readCount, 0);
});

test('ambiguous Report Metric table names fail closed without choosing an identity', async () => {
  await assert.rejects(
    () => resolveReportMetricValueTableEnvironment({
      env: INTEGRATION_ENV,
      schema: SCHEMA,
      schemaVersion: 'resolver-test-v1',
      validateSchema: () => true,
      client: {
        async listTables() {
          return [
            { tableId: 'tblOne', name: TABLE_NAME },
            { tableId: 'tblTwo', name: TABLE_NAME },
          ];
        },
        async listFields() { return []; },
      },
    }),
    (error) => error?.code === 'REPORT_METRIC_FIELD_MIGRATION_TABLE_UNRESOLVED'
      && error?.details?.conflictCount === 1,
  );
});
