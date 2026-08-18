import { homedir } from 'node:os';
import { join } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { buildLarkBaseResourceManualParityManifest } from './lib/lark-base-resource-manual-parity-manifest.js';
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
  const manifest = await buildLarkBaseResourceManualParityManifest({ sourceClient });
  assertResourceCounts(manifest);

  printJson({
    ok: true,
    contractVersion: 'customer_base_resource_manual_parity_operator_v1',
    action: 'build-base-resource-manual-parity-manifest',
    stage: 'exact-export-dashboard-workflow-manual-parity-inventory',
    mode: 'local-read-only-sensitive-values-redacted',
    sourceAuthority: {
      fileSha256: inspection.file.sha256,
      fileSizeBytes: inspection.file.sizeBytes,
      counts: inspection.counts,
    },
    manifest,
    remoteRequestCount: 0,
    remoteMutationCount: 0,
    targetReadExecuted: false,
    targetMutationExecuted: false,
    cloneApplyEnabled: false,
  });
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_resource_manual_parity_operator_v1',
    code: error?.code ?? 'CUSTOMER_BASE_RESOURCE_MANUAL_PARITY_MANIFEST_FAILED',
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
  const error = new Error('Source export does not match the approved authority; Base resource manifest stopped');
  error.code = 'CUSTOMER_BASE_SOURCE_EXPORT_AUTHORITY_MISMATCH';
  error.details = { mismatches };
  throw error;
}

function assertResourceCounts(manifest) {
  const mismatches = [];
  if (manifest?.summary?.dashboardCount !== EXPECTED_COUNTS.dashboards) {
    mismatches.push({ dimension: 'dashboards', expected: EXPECTED_COUNTS.dashboards, actual: manifest?.summary?.dashboardCount ?? null });
  }
  if (manifest?.summary?.workflowCount !== EXPECTED_COUNTS.workflows) {
    mismatches.push({ dimension: 'workflows', expected: EXPECTED_COUNTS.workflows, actual: manifest?.summary?.workflowCount ?? null });
  }
  if (mismatches.length === 0) return;
  const error = new Error('Dashboard/Workflow manifest count mismatch');
  error.code = 'CUSTOMER_BASE_RESOURCE_MANUAL_PARITY_COUNT_MISMATCH';
  error.details = { mismatches };
  throw error;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}
