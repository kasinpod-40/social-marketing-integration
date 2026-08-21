import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { collectCustomerBaseFormulaPresentationEvidence } from './lib/customer-base-formula-presentation-evidence.js';

const CURRENT_SOURCE_SHA256 = '9c24f5da1400d05ca0c070ab736e87c49e7ff4ea78e854a96d4e4c2c3ab267f7';
const PROTECTED_EXTERNAL_TABLE = '🎵 RAW_TikTok_Creator_Videos';
const DEFAULT_SOURCE_FILE = join(homedir(), 'Desktop', 'Social MKT Data Hub.base');

try {
  const sourceFile = process.env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE
    ?? process.argv[2]
    ?? DEFAULT_SOURCE_FILE;
  const inspection = await inspectLarkBaseExport(sourceFile);
  assertCurrentSourceAuthority(inspection);

  const sourceClient = await createLarkBaseExportSourceClient(sourceFile, {
    excludedTableNames: [PROTECTED_EXTERNAL_TABLE],
  });
  const evidence = await collectCustomerBaseFormulaPresentationEvidence(sourceClient);

  console.log('=== COPY THIS SUMMARY JSON ===');
  console.log(JSON.stringify({
    ok: true,
    stage: 'customer-base-formula-presentation-source-diagnostic',
    status: 'SOURCE_FORMULA_PRESENTATION_READY',
    mode: 'local-read-only',
    sourceFileName: basename(sourceFile),
    sourceSha256: inspection.file.sha256,
    formulaCount: evidence.formulaCount,
    formulas: evidence.formulas,
    sourceMutationCount: 0,
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  }, null, 2));
} catch (error) {
  console.error('=== COPY THIS SUMMARY JSON ===');
  console.error(JSON.stringify({
    ok: false,
    stage: 'customer-base-formula-presentation-source-diagnostic',
    status: 'ERROR',
    code: error?.code ?? 'CUSTOMER_BASE_FORMULA_PRESENTATION_SOURCE_DIAGNOSTIC_FAILED',
    message: error?.message ?? String(error),
    details: error?.details ?? {},
    sourceMutationCount: 0,
    remoteRequestCount: 0,
    remoteMutationCount: 0,
  }, null, 2));
  process.exitCode = 1;
}

function assertCurrentSourceAuthority(inspection) {
  const actualSha256 = inspection?.file?.sha256 ?? null;
  if (actualSha256 !== CURRENT_SOURCE_SHA256) {
    throw codedError(
      'CUSTOMER_BASE_FORMULA_PRESENTATION_SOURCE_SHA_MISMATCH',
      'Formula presentation diagnostic requires the exact current Source export revision',
      { expectedSha256: CURRENT_SOURCE_SHA256, actualSha256 },
    );
  }

  const expected = {
    tables: 33,
    fields: 723,
    views: 111,
    relationFields: 12,
    formulaFields: 4,
    dashboards: 6,
    workflows: 2,
    advancedPermissionRoles: 4,
  };
  const mismatches = [];
  for (const [dimension, value] of Object.entries(expected)) {
    const actual = inspection?.counts?.[dimension];
    if (actual !== value) mismatches.push({ dimension, expected: value, actual: actual ?? null });
  }
  if (mismatches.length > 0) {
    throw codedError(
      'CUSTOMER_BASE_FORMULA_PRESENTATION_SOURCE_STRUCTURE_MISMATCH',
      'Formula presentation Source structure differs from the admitted customer Base revision',
      { mismatches },
    );
  }
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
