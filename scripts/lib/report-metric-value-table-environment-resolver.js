import { planLarkSchema } from '../../packages/application/src/use-cases/install-lark-report-schema.js';
import {
  LARK_REPORT_SCHEMA_V2,
  LARK_REPORT_SCHEMA_V2_VERSION,
  validateReportSchemaV2,
} from '../../packages/config/src/lark-report-schema-v2.js';
import { permanentError } from '../../packages/shared/src/errors/runtime-error.js';
import { buildLarkDashboardCompatibilityReportSchema } from './lark-dashboard-compatibility-freeze-v1.js';

export const REPORT_METRIC_VALUE_TABLE_ENV = 'LARK_TABLE_MKT_REPORT_METRIC_VALUES';
const REPORT_METRIC_VALUE_TABLE_KEY = 'mktReportMetricValues';

/**
 * Resolve the existing Report Metric Values table through the shared schema planner before migration.
 * The result is in-memory only; no local config file or Remote resource is changed.
 */
export async function resolveReportMetricValueTableEnvironment(input = {}) {
  const env = Object.freeze({ ...(input.env ?? {}) });
  if (hasText(env[REPORT_METRIC_VALUE_TABLE_ENV])) return env;
  if (!isIntegrationWorkspace(env)) return env;

  const sourceSchema = input.schema ?? LARK_REPORT_SCHEMA_V2;
  const schema = buildLarkDashboardCompatibilityReportSchema(sourceSchema, env);
  const schemaVersion = input.schemaVersion ?? LARK_REPORT_SCHEMA_V2_VERSION;
  const validateSchema = input.validateSchema ?? validateReportSchemaV2;
  const preview = await planLarkSchema({
    client: input.client,
    env,
    schema,
    schemaVersion,
    validateSchema,
  });
  const resolution = preview.resolvedTables.find(
    (table) => table.tableKey === REPORT_METRIC_VALUE_TABLE_KEY,
  );

  if (!hasText(resolution?.tableId)) {
    throw permanentError('Report Metric Values table cannot be resolved before migration', {
      code: 'REPORT_METRIC_FIELD_MIGRATION_TABLE_UNRESOLVED',
      details: {
        tableKey: REPORT_METRIC_VALUE_TABLE_KEY,
        envName: REPORT_METRIC_VALUE_TABLE_ENV,
        conflictCount: Array.isArray(preview.conflicts) ? preview.conflicts.length : 0,
      },
    });
  }

  return Object.freeze({
    ...env,
    [REPORT_METRIC_VALUE_TABLE_ENV]: resolution.tableId,
  });
}

function isIntegrationWorkspace(env) {
  return env?.MKT_ENV === 'development'
    && env?.MKT_CUSTOMER_PROFILE === 'integration_workspace';
}

function hasText(value) {
  return typeof value === 'string' && value.trim() !== '';
}
