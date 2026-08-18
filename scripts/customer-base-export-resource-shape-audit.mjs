import { homedir } from 'node:os';
import { join } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { inspectLarkBaseExportResourceShapes } from './lib/lark-base-export-resource-shape.js';
import { printJson } from './lib/lark-runtime.js';

const SOURCE_EXPORT_FILENAME = 'Social MKT Data Hub(20260818-030125).base';
const SOURCE_EXPORT_SHA256 = 'c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643';
const EXPECTED_COUNTS = Object.freeze({
  tables: 33,
  fields: 723,
  records: 35_528,
  views: 111,
  relationFields: 12,
  formulaFields: 4,
  dashboards: 6,
  workflows: 2,
  advancedPermissionRoles: 4,
});

try {
  const fileEnv = await readDevVars(process.env.CUSTOMER_PROD_VARS_FILE ?? '.customer.prod.vars');
  const env = { ...fileEnv, ...process.env };
  const sourceExportFile = optionalText(env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE)
    ?? join(homedir(), 'Downloads', SOURCE_EXPORT_FILENAME);
  const inspection = await inspectLarkBaseExport(sourceExportFile);
  assertAuthority(inspection);
  const sourceClient = await createLarkBaseExportSourceClient(sourceExportFile);
  const resourceShapes = inspectLarkBaseExportResourceShapes(sourceClient.getExportResources());

  printJson({
    ok: true,
    contractVersion: 'customer_base_export_resource_shape_operator_v1',
    action: 'source-resource-shape-audit',
    stage: 'exact-export-local-resource-schema-inventory',
    mode: 'local-read-only-value-redacted',
    sourceAuthority: {
      fileSha256: inspection.file.sha256,
      fileSizeBytes: inspection.file.sizeBytes,
      counts: inspection.counts,
    },
    resourceShapes,
    remoteRequestCount: 0,
    remoteMutationCount: 0,
    targetReadExecuted: false,
    targetMutationExecuted: false,
    cloneApplyEnabled: false,
  });
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_export_resource_shape_operator_v1',
    code: error?.code ?? 'CUSTOMER_BASE_EXPORT_RESOURCE_SHAPE_AUDIT_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  }, null, 2));
  process.exitCode = 1;
}

function assertAuthority(inspection) {
  const mismatches = [];
  if (inspection?.file?.sha256 !== SOURCE_EXPORT_SHA256) {
    mismatches.push({ dimension: 'sha256', expected: SOURCE_EXPORT_SHA256, actual: inspection?.file?.sha256 ?? null });
  }
  for (const [dimension, expected] of Object.entries(EXPECTED_COUNTS)) {
    const actual = inspection?.counts?.[dimension];
    if (actual !== expected) mismatches.push({ dimension, expected, actual: actual ?? null });
  }
  if (mismatches.length === 0) return;
  const error = new Error('Source export does not match the approved authority; resource-shape audit stopped');
  error.code = 'CUSTOMER_BASE_SOURCE_EXPORT_AUTHORITY_MISMATCH';
  error.details = { mismatches };
  throw error;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
