import { homedir } from 'node:os';
import { join } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { buildLarkBaseViewManualParityManifest } from './lib/lark-base-view-manual-parity-manifest.js';
import { printJson } from './lib/lark-runtime.js';

const SOURCE_EXPORT_FILENAME = 'Social MKT Data Hub.base';
const SOURCE_EXPORT_SHA256 = '9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7';
const PROTECTED_EXTERNAL_TABLE = '🎵 RAW_TikTok_Creator_Videos';

// Record counts are intentionally not pinned here. The closeout contract is the
// current exact Source file hash plus stable structural counts. Records may be
// refreshed while per-View presentation authority must remain tied to this file.
const EXPECTED_AUTHORITY_COUNTS = Object.freeze({
  tables: 33,
  fields: 723,
  views: 111,
  relationFields: 12,
  formulaFields: 4,
  dashboards: 6,
  workflows: 2,
});
const EXPECTED_CLONE_SCOPE = Object.freeze({
  tables: 32,
  fields: 705,
  views: 110,
});

try {
  const fileEnv = await readDevVars(process.env.CUSTOMER_PROD_VARS_FILE ?? '.customer.prod.vars');
  const env = { ...fileEnv, ...process.env };
  const sourceExportFile = optionalText(env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE)
    ?? join(homedir(), 'Desktop', SOURCE_EXPORT_FILENAME);
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
    contractVersion: 'customer_base_view_manual_parity_operator_v2',
    action: 'build-view-manual-parity-manifest',
    stage: 'current-exact-export-clone-scope-view-layout-authority',
    mode: 'local-read-only-id-redacted',
    sourceAuthority: {
      fileName: SOURCE_EXPORT_FILENAME,
      fileSha256: inspection.file.sha256,
      fileSizeBytes: inspection.file.sizeBytes,
      counts: inspection.counts,
    },
    policyB: {
      protectedExternalTableName: PROTECTED_EXTERNAL_TABLE,
      cloneScope,
    },
    acceptanceScope: {
      fieldOrder: 'blocking',
      columnWidth: 'excluded-by-user',
      advancedPermissionRoles: 'excluded-by-user',
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
    contractVersion: 'customer_base_view_manual_parity_operator_v2',
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
  let views = 0;
  for (const table of tables) {
    fields += (await client.listFields({ tableId: table.tableId })).length;
    views += (await client.listViews({ tableId: table.tableId })).length;
  }
  return Object.freeze({ tables: tables.length, fields, views });
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
  throw codedError('CUSTOMER_BASE_SOURCE_EXPORT_AUTHORITY_MISMATCH', 'Source export does not match the approved current authority; View manifest stopped', { mismatches });
}

function assertCloneScope(actual) {
  const mismatches = [];
  for (const [dimension, expected] of Object.entries(EXPECTED_CLONE_SCOPE)) {
    if (actual?.[dimension] !== expected) mismatches.push({ dimension, expected, actual: actual?.[dimension] ?? null });
  }
  if (mismatches.length === 0) return;
  throw codedError('CUSTOMER_BASE_CLONE_SCOPE_MISMATCH', 'Policy-B clone scope does not match approved current evidence; View manifest stopped', { mismatches });
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
