import { homedir } from 'node:os';
import { join } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { buildLarkBaseViewManualParityManifest } from './lib/lark-base-view-manual-parity-manifest.js';
import { printJson } from './lib/lark-runtime.js';

const SOURCE_EXPORT_FILENAME = 'Social MKT Data Hub(20260818-030125).base';
const SOURCE_EXPORT_SHA256 = 'c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643';
const PROTECTED_EXTERNAL_TABLE = '🎵 RAW_TikTok_Creator_Videos';
const EXPECTED_AUTHORITY_COUNTS = Object.freeze({
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
const EXPECTED_CLONE_SCOPE = Object.freeze({
  tables: 32,
  fields: 705,
  records: 33_488,
  views: 110,
});

try {
  const fileEnv = await readDevVars(process.env.CUSTOMER_PROD_VARS_FILE ?? '.customer.prod.vars');
  const env = { ...fileEnv, ...process.env };
  const sourceExportFile = optionalText(env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE)
    ?? join(homedir(), 'Downloads', SOURCE_EXPORT_FILENAME);
  const inspection = await inspectLarkBaseExport(sourceExportFile);
  assertAuthority(inspection);

  const sourceClient = await createLarkBaseExportSourceClient(sourceExportFile, {
    excludedTableNames: [PROTECTED_EXTERNAL_TABLE],
  });
  const cloneScope = await countCloneScope(sourceClient);
  assertCloneScope(cloneScope);
  const manifest = await buildLarkBaseViewManualParityManifest({ sourceClient });

  printJson({
    ok: true,
    contractVersion: 'customer_base_view_manual_parity_operator_v1',
    action: 'build-view-manual-parity-manifest',
    stage: 'exact-export-clone-scope-manual-view-layout-manifest',
    mode: 'local-read-only-id-redacted',
    sourceAuthority: {
      fileSha256: inspection.file.sha256,
      fileSizeBytes: inspection.file.sizeBytes,
      counts: inspection.counts,
    },
    policyB: {
      protectedExternalTableName: PROTECTED_EXTERNAL_TABLE,
      cloneScope,
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
    contractVersion: 'customer_base_view_manual_parity_operator_v1',
    code: error?.code ?? 'CUSTOMER_BASE_VIEW_MANUAL_PARITY_MANIFEST_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  }, null, 2));
  process.exitCode = 1;
}

async function countCloneScope(client) {
  const tables = await client.listTables();
  let fields = 0;
  let records = 0;
  let views = 0;
  for (const table of tables) {
    fields += (await client.listFields({ tableId: table.tableId })).length;
    records += (await client.listRecords({ tableId: table.tableId })).length;
    views += (await client.listViews({ tableId: table.tableId })).length;
  }
  return Object.freeze({ tables: tables.length, fields, records, views });
}

function assertAuthority(inspection) {
  const mismatches = [];
  if (inspection?.file?.sha256 !== SOURCE_EXPORT_SHA256) {
    mismatches.push({ dimension: 'sha256', expected: SOURCE_EXPORT_SHA256, actual: inspection?.file?.sha256 ?? null });
  }
  for (const [dimension, expected] of Object.entries(EXPECTED_AUTHORITY_COUNTS)) {
    const actual = inspection?.counts?.[dimension];
    if (actual !== expected) mismatches.push({ dimension, expected, actual: actual ?? null });
  }
  if (mismatches.length === 0) return;
  throw codedError('CUSTOMER_BASE_SOURCE_EXPORT_AUTHORITY_MISMATCH', 'Source export does not match the approved authority; View manifest stopped', { mismatches });
}

function assertCloneScope(actual) {
  const mismatches = [];
  for (const [dimension, expected] of Object.entries(EXPECTED_CLONE_SCOPE)) {
    if (actual?.[dimension] !== expected) mismatches.push({ dimension, expected, actual: actual?.[dimension] ?? null });
  }
  if (mismatches.length === 0) return;
  throw codedError('CUSTOMER_BASE_CLONE_SCOPE_MISMATCH', 'Policy-B clone scope does not match approved evidence; View manifest stopped', { mismatches });
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
