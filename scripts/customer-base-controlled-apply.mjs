import { chmod, readFile, readdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { basename, join } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import { inspectLarkBaseExportPermissionSemantics } from './lib/lark-base-export-permission-semantics.js';
import { createLarkBaseExportSourceClient } from './lib/lark-base-export-source-client.js';
import { inspectLarkBaseExport } from './lib/lark-base-export.js';
import { printJson } from './lib/lark-runtime.js';
import {
  CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION,
  applyCustomerBaseControlledParity,
  prepareCustomerBaseControlledApplyCheckpoint,
} from '../packages/application/src/use-cases/apply-customer-base-controlled-parity.js';
import { withLarkBaseParityCapabilities } from '../packages/connectors/src/lark/lark-bitable-parity.client.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';

const SOURCE_EXPORT_FILENAME = 'Social MKT Data Hub(20260818-030125).base';
const SOURCE_EXPORT_SHA256 = 'c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643';
const SOURCE_EXPORT_NAME_PATTERN = /^Social MKT Data Hub.*\.base$/u;
const TARGET_LABEL = '✨Marketing Content Calendar';
const PROTECTED_EXTERNAL_TABLE_NAMES = Object.freeze(['🎵 RAW_TikTok_Creator_Videos']);
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
const DEFAULT_CHECKPOINT_FILE = join(homedir(), 'Downloads', 'customer-base-controlled-apply-checkpoint.json');

try {
  await main();
} catch (error) {
  console.error(JSON.stringify({
    ok: false,
    contractVersion: 'customer_base_controlled_apply_operator_v1',
    code: error?.code ?? 'CUSTOMER_BASE_CONTROLLED_APPLY_OPERATOR_FAILED',
    message: error?.message ?? String(error),
    details: safeDetails(error?.details ?? {}),
  }, null, 2));
  process.exitCode = 1;
}

async function main() {
  const mode = resolveMode(process.argv.slice(2));
  const customerProdVarsFile = process.env.CUSTOMER_PROD_VARS_FILE ?? '.customer.prod.vars';
  const fileEnv = await readDevVars(customerProdVarsFile);
  const env = { ...fileEnv, ...process.env };
  const sourceAuthority = await resolveSourceAuthority(env);
  const sourceExportFile = sourceAuthority.filePath;
  const inspection = sourceAuthority.inspection;
  const checkpointFile = optionalText(env.CUSTOMER_BASE_CONTROLLED_APPLY_CHECKPOINT_FILE) ?? DEFAULT_CHECKPOINT_FILE;

  const fullSourceClient = await createLarkBaseExportSourceClient(sourceExportFile);
  const cloneSourceClient = await createLarkBaseExportSourceClient(sourceExportFile, {
    excludedTableNames: PROTECTED_EXTERNAL_TABLE_NAMES,
  });
  const expectedTableNames = (await cloneSourceClient.listTables()).map((table) => requireText(table?.name, 'clone table name'));
  if (expectedTableNames.length !== 32) {
    throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_CLONE_SCOPE_COUNT_MISMATCH', 'Clone-scope export projection must contain exactly 32 Tables', {
      actual: expectedTableNames.length,
    });
  }

  const targetAppToken = requireText(env.LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN, 'LARK_CUSTOMER_CONSOLIDATION_TARGET_APP_TOKEN');
  const targetClient = withLarkBaseParityCapabilities(createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: targetAppToken,
  }));
  await assertTargetIdentity(targetClient);

  if (mode === 'prepare-checkpoint') {
    const checkpoint = await prepareCustomerBaseControlledApplyCheckpoint({
      targetClient,
      expectedTableNames,
      requiredProtectedTableNames: PROTECTED_EXTERNAL_TABLE_NAMES,
      protectedExternalTableNames: PROTECTED_EXTERNAL_TABLE_NAMES,
      sourceAuthoritySha256: SOURCE_EXPORT_SHA256,
    });
    await writePrivateCheckpoint(checkpointFile, checkpoint);
    printJson({
      ok: true,
      contractVersion: 'customer_base_controlled_apply_operator_v1',
      action: 'prepare-checkpoint',
      mode: 'read-only',
      sourceAuthority: {
        fileName: inspection?.file?.fileName ?? basename(sourceExportFile),
        filePath: sourceExportFile,
        fileSha256: SOURCE_EXPORT_SHA256,
      },
      target: TARGET_LABEL,
      cloneScopeTables: expectedTableNames.length,
      checkpointFile,
      protectedTables: checkpoint.protectedTables.map((table) => table.name),
      protectedRoles: checkpoint.protectedRoles.map((role) => role.roleName),
      remoteMutationCount: 0,
      customerApplyExecuted: false,
      nextCommand: `CUSTOMER_BASE_APPLY_CONFIRMATION=${CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION} node scripts/customer-base-controlled-apply.mjs --apply`,
    });
    return;
  }

  const confirmation = requireText(env.CUSTOMER_BASE_APPLY_CONFIRMATION, 'CUSTOMER_BASE_APPLY_CONFIRMATION');
  if (confirmation !== CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION) {
    throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION_REQUIRED', 'Exact controlled-Apply confirmation is required', {
      expected: CUSTOMER_BASE_CONTROLLED_APPLY_CONFIRMATION,
    });
  }
  const checkpoint = JSON.parse(await readFile(checkpointFile, 'utf8'));
  const resources = fullSourceClient.getExportResources();
  const permissionSemantics = inspectLarkBaseExportPermissionSemantics({
    roles: resources.roles,
    sourceTables: await fullSourceClient.listTables(),
  });

  const result = await applyCustomerBaseControlledParity({
    confirmation,
    sourceClient: cloneSourceClient,
    targetClient,
    permissionSemantics,
    checkpoint,
    expectedTableNames,
    sourceAuthoritySha256: SOURCE_EXPORT_SHA256,
    onProgress: verboseProgress,
  });

  printJson({
    ...result,
    action: 'apply',
    target: TARGET_LABEL,
    targetFolder: 'Setup Phase | Social MKT Data Hub',
    checkpointFile,
    sourceMutationCount: 0,
    deleteCount: 0,
    workerD1QueueScheduleMutationCount: 0,
  });
}

async function resolveSourceAuthority(env) {
  const configured = optionalText(env.LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE);
  if (configured) {
    let inspection;
    try {
      inspection = await inspectLarkBaseExport(configured);
    } catch (error) {
      throw codedError(
        'CUSTOMER_BASE_CONTROLLED_APPLY_SOURCE_AUTHORITY_UNREADABLE',
        'Configured Source export file cannot be read',
        { configuredPath: configured, causeCode: error?.code ?? null },
      );
    }
    assertAuthority(inspection);
    return Object.freeze({ filePath: configured, inspection });
  }

  const searchDirectories = Object.freeze([
    join(homedir(), 'Desktop'),
    join(homedir(), 'Downloads'),
  ]);
  const preferredNames = [SOURCE_EXPORT_FILENAME, 'Social MKT Data Hub.base'];
  const candidatePaths = [];

  for (const directory of searchDirectories) {
    for (const fileName of preferredNames) candidatePaths.push(join(directory, fileName));
    try {
      const entries = await readdir(directory, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.isFile() && SOURCE_EXPORT_NAME_PATTERN.test(entry.name)) {
          candidatePaths.push(join(directory, entry.name));
        }
      }
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }

  const checkedFiles = [];
  for (const filePath of [...new Set(candidatePaths)]) {
    let inspection;
    try {
      inspection = await inspectLarkBaseExport(filePath);
    } catch (error) {
      if (error?.code === 'ENOENT') continue;
      checkedFiles.push(Object.freeze({ filePath, status: 'unreadable_or_invalid', causeCode: error?.code ?? null }));
      continue;
    }

    const mismatches = authorityMismatches(inspection);
    checkedFiles.push(Object.freeze({
      filePath,
      status: mismatches.length === 0 ? 'exact_authority' : 'authority_mismatch',
      sha256: inspection?.file?.sha256 ?? null,
    }));
    if (mismatches.length === 0) return Object.freeze({ filePath, inspection });
  }

  throw codedError(
    'CUSTOMER_BASE_CONTROLLED_APPLY_SOURCE_AUTHORITY_NOT_FOUND',
    'No local Social MKT Data Hub .base file matches the exact approved Source authority SHA/counts',
    {
      searchedDirectories: searchDirectories,
      expectedSha256: SOURCE_EXPORT_SHA256,
      checkedFiles,
      hint: 'Keep the exact approved export on Desktop/Downloads or set LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE to its exact path.',
    },
  );
}

async function assertTargetIdentity(client) {
  const response = await client.requestBitableJson(`/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}`, { method: 'GET' });
  const app = response?.data?.app ?? response?.data ?? {};
  const actual = requireText(app?.name, 'Target Base name');
  if (actual !== TARGET_LABEL) {
    throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_TARGET_IDENTITY_MISMATCH', 'Configured Target Base is not the approved customer destination', {
      expected: TARGET_LABEL,
      actual,
    });
  }
}

async function writePrivateCheckpoint(filePath, checkpoint) {
  await writeFile(filePath, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(filePath, 0o600);
}

function assertAuthority(inspection) {
  const mismatches = authorityMismatches(inspection);
  if (mismatches.length > 0) {
    throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_SOURCE_AUTHORITY_MISMATCH', 'Source export is not the exact approved authority', { mismatches });
  }
}

function authorityMismatches(inspection) {
  const mismatches = [];
  if (inspection?.file?.sha256 !== SOURCE_EXPORT_SHA256) {
    mismatches.push({ dimension: 'sha256', expected: SOURCE_EXPORT_SHA256, actual: inspection?.file?.sha256 ?? null });
  }
  for (const [dimension, expected] of Object.entries(EXPECTED_COUNTS)) {
    const actual = inspection?.counts?.[dimension];
    if (actual !== expected) mismatches.push({ dimension, expected, actual: actual ?? null });
  }
  return mismatches;
}

function resolveMode(argv) {
  const modes = argv.filter((item) => item === '--prepare-checkpoint' || item === '--apply');
  if (modes.length !== 1) {
    throw codedError('CUSTOMER_BASE_CONTROLLED_APPLY_MODE_REQUIRED', 'Choose exactly one mode: --prepare-checkpoint or --apply');
  }
  return modes[0] === '--apply' ? 'apply' : 'prepare-checkpoint';
}

function verboseProgress(event) {
  if (process.env.CUSTOMER_BASE_VERBOSE !== '1') return;
  console.error(JSON.stringify({ event: 'customer_base_controlled_apply_progress', ...safeDetails(event ?? {}) }));
}

function safeDetails(value) {
  if (Array.isArray(value)) return value.map(safeDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => {
    if (/(?:token|secret|authorization|credential|password)/iu.test(key)) return [key, '[redacted]'];
    return [key, safeDetails(nested)];
  }));
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireText(value, name) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${name} is required`);
  return text;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
