import { createHash } from 'node:crypto';
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

const BASELINE_SOURCE_EXPORT_FILENAME = 'Social MKT Data Hub(20260818-030125).base';
const BASELINE_SOURCE_EXPORT_SHA256 = 'c230354d7eb06f7ab598511c1be4d798ba420e50255ce29a6b810db505e8e643';
const SOURCE_EXPORT_NAME_PATTERN = /^Social MKT Data Hub.*\.base$/u;
const TARGET_LABEL = '✨Marketing Content Calendar';
const REQUIRED_PROTECTED_TABLE_NAMES = Object.freeze([
  '🎵 RAW_TikTok_Creator_Videos',
  '(VDO) Content Creator',
  '(Graphic) Content Creator',
  'คำถามจาก Sale & Support',
]);
const PROTECTED_EXTERNAL_TABLE_NAMES = Object.freeze(['🎵 RAW_TikTok_Creator_Videos']);
const BASELINE_COUNTS = Object.freeze({
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
const REFRESH_STRUCTURAL_COUNTS = Object.freeze({
  tables: BASELINE_COUNTS.tables,
  fields: BASELINE_COUNTS.fields,
  views: BASELINE_COUNTS.views,
  relationFields: BASELINE_COUNTS.relationFields,
  formulaFields: BASELINE_COUNTS.formulaFields,
  dashboards: BASELINE_COUNTS.dashboards,
  workflows: BASELINE_COUNTS.workflows,
  advancedPermissionRoles: BASELINE_COUNTS.advancedPermissionRoles,
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
  const sourceAuthority = await resolveSourceAuthority(env, { allowRefresh: mode === 'apply' });
  const sourceExportFile = sourceAuthority.filePath;
  const inspection = sourceAuthority.inspection;
  const currentSourceSha256 = requireSha256(inspection?.file?.sha256, 'current Source export sha256');
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
  const targetAppFingerprintSha256 = fingerprint(targetAppToken);
  const targetClient = withLarkBaseParityCapabilities(createLarkBitableClientFromEnv({
    ...env,
    LARK_APP_TOKEN: targetAppToken,
  }));

  if (mode === 'prepare-checkpoint') {
    if (sourceAuthority.authorityMode !== 'exact-baseline') {
      throw codedError(
        'CUSTOMER_BASE_CONTROLLED_APPLY_CHECKPOINT_REQUIRES_BASELINE_SOURCE',
        'Checkpoint preparation is allowed only with the exact immutable baseline Source export',
      );
    }
    const checkpoint = await prepareCustomerBaseControlledApplyCheckpoint({
      targetClient,
      expectedTableNames,
      requiredProtectedTableNames: REQUIRED_PROTECTED_TABLE_NAMES,
      protectedExternalTableNames: PROTECTED_EXTERNAL_TABLE_NAMES,
      sourceAuthoritySha256: BASELINE_SOURCE_EXPORT_SHA256,
    });
    const persistedCheckpoint = Object.freeze({
      ...checkpoint,
      targetAppFingerprintSha256,
      targetIdentityAnchorTableNames: REQUIRED_PROTECTED_TABLE_NAMES,
    });
    await writePrivateCheckpoint(checkpointFile, persistedCheckpoint);
    printJson({
      ok: true,
      contractVersion: 'customer_base_controlled_apply_operator_v1',
      action: 'prepare-checkpoint',
      mode: 'read-only',
      sourceAuthority: {
        authorityMode: sourceAuthority.authorityMode,
        fileName: basename(sourceExportFile),
        filePath: sourceExportFile,
        fileSha256: currentSourceSha256,
        counts: inspection?.counts ?? null,
      },
      target: TARGET_LABEL,
      targetIdentity: {
        mode: 'configured-app-fingerprint-plus-protected-table-anchors',
        appFingerprintSha256: targetAppFingerprintSha256,
        requiredAnchorTables: REQUIRED_PROTECTED_TABLE_NAMES,
      },
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
  if (checkpoint?.targetAppFingerprintSha256 !== targetAppFingerprintSha256) {
    throw codedError(
      'CUSTOMER_BASE_CONTROLLED_APPLY_TARGET_FINGERPRINT_MISMATCH',
      'Controlled Apply checkpoint belongs to a different configured Target Base token',
      {
        checkpointFingerprint: checkpoint?.targetAppFingerprintSha256 ?? null,
        configuredFingerprint: targetAppFingerprintSha256,
      },
    );
  }
  if (JSON.stringify(checkpoint?.targetIdentityAnchorTableNames ?? []) !== JSON.stringify(REQUIRED_PROTECTED_TABLE_NAMES)) {
    throw codedError(
      'CUSTOMER_BASE_CONTROLLED_APPLY_TARGET_ANCHOR_MISMATCH',
      'Controlled Apply checkpoint does not contain the approved Target identity anchors',
    );
  }
  if (checkpoint?.sourceAuthoritySha256 !== BASELINE_SOURCE_EXPORT_SHA256) {
    throw codedError(
      'CUSTOMER_BASE_CONTROLLED_APPLY_CHECKPOINT_BASELINE_MISMATCH',
      'Controlled Apply checkpoint is not the original approved baseline checkpoint',
      {
        expectedBaselineSha256: BASELINE_SOURCE_EXPORT_SHA256,
        checkpointSha256: checkpoint?.sourceAuthoritySha256 ?? null,
      },
    );
  }
  if (JSON.stringify(checkpoint?.expectedTableNames ?? []) !== JSON.stringify(expectedTableNames)) {
    throw codedError(
      'CUSTOMER_BASE_CONTROLLED_APPLY_SOURCE_REFRESH_SCOPE_MISMATCH',
      'Latest Source export changed the clone-scope Table names; Target mutation is blocked until the structural change is reviewed',
      {
        checkpointTableNames: checkpoint?.expectedTableNames ?? [],
        currentSourceTableNames: expectedTableNames,
        currentSourceSha256,
      },
    );
  }

  const resources = fullSourceClient.getExportResources();
  const permissionSemantics = inspectLarkBaseExportPermissionSemantics({
    roles: resources.roles,
    sourceTables: await fullSourceClient.listTables(),
  });

  // The checkpoint SHA remains the immutable pre-write Target baseline fence.
  // The current export SHA is separately admitted above as refresh-compatible Source authority.
  const result = await applyCustomerBaseControlledParity({
    confirmation,
    sourceClient: cloneSourceClient,
    targetClient,
    permissionSemantics,
    checkpoint,
    expectedTableNames,
    sourceAuthoritySha256: checkpoint.sourceAuthoritySha256,
    onProgress: verboseProgress,
  });

  printJson({
    ...result,
    sourceAuthoritySha256: currentSourceSha256,
    checkpointSourceAuthoritySha256: checkpoint.sourceAuthoritySha256,
    sourceAuthority: {
      authorityMode: sourceAuthority.authorityMode,
      fileName: basename(sourceExportFile),
      filePath: sourceExportFile,
      currentSha256: currentSourceSha256,
      checkpointBaselineSha256: checkpoint.sourceAuthoritySha256,
      refreshedFromCheckpointSource: currentSourceSha256 !== checkpoint.sourceAuthoritySha256,
      counts: inspection?.counts ?? null,
    },
    action: 'apply',
    target: TARGET_LABEL,
    targetIdentity: {
      mode: 'checkpoint-app-fingerprint-plus-protected-table-anchors',
      appFingerprintSha256: targetAppFingerprintSha256,
      requiredAnchorTables: REQUIRED_PROTECTED_TABLE_NAMES,
    },
    targetFolder: 'Setup Phase | Social MKT Data Hub',
    checkpointFile,
    sourceMutationCount: 0,
    deleteCount: 0,
    workerD1QueueScheduleMutationCount: 0,
  });
}

async function resolveSourceAuthority(env, options = {}) {
  const allowRefresh = options?.allowRefresh === true;
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
    const authorityMode = assertAuthority(inspection, { allowRefresh });
    return Object.freeze({ filePath: configured, inspection, authorityMode });
  }

  const searchDirectories = Object.freeze([
    join(homedir(), 'Desktop'),
    join(homedir(), 'Downloads'),
  ]);
  const preferredNames = [BASELINE_SOURCE_EXPORT_FILENAME, 'Social MKT Data Hub.base'];
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

    const assessment = assessAuthority(inspection, { allowRefresh });
    checkedFiles.push(Object.freeze({
      filePath,
      status: assessment.ok ? assessment.authorityMode : 'authority_mismatch',
      sha256: inspection?.file?.sha256 ?? null,
      records: inspection?.counts?.records ?? null,
      mismatches: assessment.mismatches,
    }));
    if (assessment.ok) {
      return Object.freeze({ filePath, inspection, authorityMode: assessment.authorityMode });
    }
  }

  throw codedError(
    'CUSTOMER_BASE_CONTROLLED_APPLY_SOURCE_AUTHORITY_NOT_FOUND',
    allowRefresh
      ? 'No local Social MKT Data Hub .base file matches the approved refresh-compatible Source structure'
      : 'No local Social MKT Data Hub .base file matches the exact approved baseline Source authority',
    {
      searchedDirectories: searchDirectories,
      baselineSha256: BASELINE_SOURCE_EXPORT_SHA256,
      checkedFiles,
      hint: 'Keep the current Social MKT Data Hub export on Desktop/Downloads or set LARK_CUSTOMER_CONSOLIDATION_SOURCE_EXPORT_FILE to its exact path.',
    },
  );
}

async function writePrivateCheckpoint(filePath, checkpoint) {
  await writeFile(filePath, `${JSON.stringify(checkpoint, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  await chmod(filePath, 0o600);
}

function assertAuthority(inspection, options = {}) {
  const assessment = assessAuthority(inspection, options);
  if (!assessment.ok) {
    throw codedError(
      'CUSTOMER_BASE_CONTROLLED_APPLY_SOURCE_AUTHORITY_MISMATCH',
      options?.allowRefresh === true
        ? 'Source export is not refresh-compatible with the approved migration structure'
        : 'Source export is not the exact approved baseline authority',
      {
        mismatches: assessment.mismatches,
        baselineSha256: BASELINE_SOURCE_EXPORT_SHA256,
        actualSha256: inspection?.file?.sha256 ?? null,
      },
    );
  }
  return assessment.authorityMode;
}

function assessAuthority(inspection, options = {}) {
  const baselineMismatches = baselineAuthorityMismatches(inspection);
  if (baselineMismatches.length === 0) {
    return Object.freeze({ ok: true, authorityMode: 'exact-baseline', mismatches: Object.freeze([]) });
  }
  if (options?.allowRefresh !== true) {
    return Object.freeze({ ok: false, authorityMode: null, mismatches: Object.freeze(baselineMismatches) });
  }
  const refreshMismatches = refreshAuthorityMismatches(inspection);
  return Object.freeze({
    ok: refreshMismatches.length === 0,
    authorityMode: refreshMismatches.length === 0 ? 'refresh-compatible' : null,
    mismatches: Object.freeze(refreshMismatches),
  });
}

function baselineAuthorityMismatches(inspection) {
  const mismatches = [];
  if (inspection?.file?.sha256 !== BASELINE_SOURCE_EXPORT_SHA256) {
    mismatches.push({ dimension: 'sha256', expected: BASELINE_SOURCE_EXPORT_SHA256, actual: inspection?.file?.sha256 ?? null });
  }
  for (const [dimension, expected] of Object.entries(BASELINE_COUNTS)) {
    const actual = inspection?.counts?.[dimension];
    if (actual !== expected) mismatches.push({ dimension, expected, actual: actual ?? null });
  }
  return mismatches;
}

function refreshAuthorityMismatches(inspection) {
  const mismatches = [];
  for (const [dimension, expected] of Object.entries(REFRESH_STRUCTURAL_COUNTS)) {
    const actual = inspection?.counts?.[dimension];
    if (actual !== expected) mismatches.push({ dimension, expected, actual: actual ?? null });
  }
  const records = Number(inspection?.counts?.records);
  if (!Number.isInteger(records) || records < BASELINE_COUNTS.records) {
    mismatches.push({
      dimension: 'records',
      expectedMinimum: BASELINE_COUNTS.records,
      actual: Number.isFinite(records) ? records : null,
    });
  }
  const tableNames = new Set(Array.isArray(inspection?.names?.tables) ? inspection.names.tables : []);
  for (const tableName of REQUIRED_PROTECTED_TABLE_NAMES) {
    if (!tableNames.has(tableName)) {
      mismatches.push({ dimension: 'requiredTable', expected: tableName, actual: 'missing' });
    }
  }
  return mismatches;
}

function fingerprint(value) {
  return createHash('sha256').update(requireText(value, 'fingerprint value')).digest('hex');
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

function requireSha256(value, name) {
  const text = requireText(value, name).toLowerCase();
  if (!/^[a-f0-9]{64}$/u.test(text)) throw new TypeError(`${name} must be a SHA-256 hex digest`);
  return text;
}

function codedError(code, message, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
