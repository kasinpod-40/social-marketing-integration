#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import { summarizeMetaK2PublisherPlatformFootprint } from './lib/meta-k2-publisher-platform-footprint.js';
import { META_K2_EXACT_RECOVERY_IDENTITY } from '../packages/config/src/meta-k2-exact-recovery-contract.js';

const repositoryRoot = realpathSync.native(process.cwd());
const branchName = 'integration/all-meta-end-to-end-completion-v1';
const databaseBinding = 'MKT_STATE_DB';
const sourcePhase = 'meta_end_to_end_source_staging_v1';
const execute = parseArgs(process.argv.slice(2));

if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    stage: 'meta-k2-publisher-platform-footprint-read-only-audit',
    reads: {
      d1Schema: true,
      exactSourcePhase: true,
      stagedPublisherPlatformFootprint: true,
    },
    rawPayloadPrinted: false,
    identityPrinted: false,
    providerRequestCount: 0,
    queueActionCount: 0,
    d1WriteCount: 0,
    larkWriteCount: 0,
    workerVersionUploadCount: 0,
    productionDeploymentCount: 0,
    productionTrafficChangeCount: 0,
    previewSettingMutationCount: 0,
    recoveryAuthorized: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exit(0);
}

try {
  const repository = verifyRepository();
  const devVarsPath = await resolveRepositoryFile(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
    'DEV_VARS_FILE',
  );
  await assertPrivateFile(devVarsPath, 'DEV_VARS_FILE');
  const configPath = await resolveRepositoryFile(
    process.env.MKT_META_K2_PLATFORM_FOOTPRINT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
    'MKT_META_K2_PLATFORM_FOOTPRINT_WRANGLER_CONFIG',
  );
  const devVars = await readDevVars(devVarsPath);
  const env = cleanCloudflareEnvironment({ ...devVars, ...process.env });
  runText('npx', ['wrangler', 'whoami', '--json'], env);

  const phaseColumns = readTableColumns(env, configPath, 'sync_work_phases');
  for (const column of ['work_key', 'phase', 'state_json', 'complete']) {
    requireColumn(phaseColumns, column, 'sync_work_phases');
  }
  const phaseRows = runD1Rows(env, configPath, `
    SELECT state_json, complete
    FROM sync_work_phases
    WHERE work_key = ${sqlText(META_K2_EXACT_RECOVERY_IDENTITY.workKey)}
      AND phase = ${sqlText(sourcePhase)};
  `);
  if (phaseRows.length !== 1 || Number(phaseRows[0].complete) !== 1) {
    throw auditError(
      'Meta K2 exact source phase is not one complete retained phase',
      'META_K2_PLATFORM_FOOTPRINT_SOURCE_PHASE_INVALID',
      { observed: phaseRows.length, complete: phaseRows[0]?.complete ?? null },
    );
  }
  const sourceState = parseJsonObject(phaseRows[0].state_json, 'source phase state_json');
  if (sourceState.stage !== 'complete') {
    throw auditError(
      'Meta K2 exact source state is not complete',
      'META_K2_PLATFORM_FOOTPRINT_SOURCE_PHASE_INVALID',
      { stage: sourceState.stage ?? null },
    );
  }

  const unitColumns = readTableColumns(env, configPath, 'sync_work_units');
  const workKeyColumn = selectColumn(unitColumns, ['work_key'], 'work key');
  const phaseColumn = selectColumn(unitColumns, ['phase'], 'phase');
  const sequenceColumn = selectColumn(
    unitColumns,
    ['sequence', 'unit_sequence', 'sequence_number'],
    'sequence',
  );
  const payloadColumn = selectColumn(
    unitColumns,
    ['payload_json', 'payload', 'unit_json'],
    'payload',
  );
  const unitRows = runD1Rows(env, configPath, `
    SELECT
      ${quoteIdentifier(sequenceColumn)} AS unit_sequence,
      ${quoteIdentifier(payloadColumn)} AS payload_json
    FROM sync_work_units
    WHERE ${quoteIdentifier(workKeyColumn)} = ${sqlText(META_K2_EXACT_RECOVERY_IDENTITY.workKey)}
      AND ${quoteIdentifier(phaseColumn)} = ${sqlText(sourcePhase)}
    ORDER BY ${quoteIdentifier(sequenceColumn)} ASC;
  `);
  const payloads = unitRows.map((row, index) => {
    const sequence = nonNegativeInteger(row.unit_sequence, 'unit_sequence');
    if (sequence !== index) {
      throw auditError(
        'Meta K2 staged unit sequence is not contiguous from zero',
        'META_K2_PLATFORM_FOOTPRINT_SEQUENCE_INVALID',
        { expected: index, observed: sequence },
      );
    }
    return parseJsonObject(row.payload_json, 'sync_work_units payload_json');
  });

  if (payloads.length !== Number(sourceState.unitCount)) {
    throw auditError(
      'Meta K2 staged unit count differs from complete source state',
      'META_K2_PLATFORM_FOOTPRINT_TOTAL_INVALID',
      { expectedUnits: Number(sourceState.unitCount), observedUnits: payloads.length },
    );
  }
  const footprint = summarizeMetaK2PublisherPlatformFootprint(payloads);
  if (footprint.dailyRowCount + 1 !== Number(sourceState.rowCount)) {
    throw auditError(
      'Meta K2 daily footprint plus retained account row differs from source state',
      'META_K2_PLATFORM_FOOTPRINT_TOTAL_INVALID',
      {
        expectedRows: Number(sourceState.rowCount),
        observedDailyRows: footprint.dailyRowCount,
      },
    );
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'meta-k2-publisher-platform-footprint-read-only-audit',
    repository,
    targetKey: META_K2_EXACT_RECOVERY_IDENTITY.targetKey,
    operationId: META_K2_EXACT_RECOVERY_IDENTITY.operationId,
    boundary: 'source_complete_pre_d1_failed',
    sourceState: {
      stage: sourceState.stage,
      unitCount: Number(sourceState.unitCount),
      rowCount: Number(sourceState.rowCount),
    },
    footprint,
    rawPayloadPrinted: false,
    identityPrinted: false,
    providerRequestCount: 0,
    queueActionCount: 0,
    d1ReadCount: 4,
    d1WriteCount: 0,
    larkWriteCount: 0,
    workerVersionUploadCount: 0,
    productionDeploymentCount: 0,
    productionTrafficChangeCount: 0,
    previewSettingMutationCount: 0,
    lifecycleSqlRepairCount: 0,
    remoteMutationCount: 0,
    recoveryAuthorized: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'meta-k2-publisher-platform-footprint-read-only-audit',
    code: error?.code ?? 'META_K2_PLATFORM_FOOTPRINT_AUDIT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    rawPayloadPrinted: false,
    identityPrinted: false,
    providerRequestCount: 0,
    queueActionCount: 0,
    d1WriteCount: 0,
    larkWriteCount: 0,
    workerVersionUploadCount: 0,
    productionDeploymentCount: 0,
    productionTrafficChangeCount: 0,
    previewSettingMutationCount: 0,
    lifecycleSqlRepairCount: 0,
    remoteMutationCount: 0,
    recoveryAuthorized: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function readTableColumns(env, configPath, tableName) {
  const rows = runD1Rows(
    env,
    configPath,
    `PRAGMA table_info(${quoteIdentifier(tableName)});`,
  );
  const columns = rows.map((row) => String(row.name ?? '').trim()).filter(Boolean);
  if (columns.length === 0) {
    throw auditError(
      `Meta K2 audit table schema is unavailable for ${tableName}`,
      'META_K2_PLATFORM_FOOTPRINT_SCHEMA_INVALID',
      { tableName },
    );
  }
  return columns;
}

function runD1Rows(env, configPath, sql) {
  const text = runText('npx', [
    'wrangler', 'd1', 'execute', databaseBinding,
    '--remote', '--json', '--config', configPath,
    '--command', compactSql(sql),
  ], env);
  let value;
  try {
    value = JSON.parse(text);
  } catch {
    throw auditError(
      'Remote D1 read did not return JSON',
      'META_K2_PLATFORM_FOOTPRINT_D1_RESPONSE_INVALID',
      { responseSha256: sha256(text) },
    );
  }
  if (Array.isArray(value)) return value.flatMap((entry) => entry?.results ?? []);
  return Array.isArray(value?.results) ? value.results : [];
}

function verifyRepository() {
  const branch = gitText(['branch', '--show-current']);
  const head = gitText(['rev-parse', 'HEAD']);
  const remoteHead = gitText(['rev-parse', `origin/${branchName}`]);
  const expectedHead = requireFullSha(
    process.env.MKT_META_K2_PLATFORM_FOOTPRINT_HEAD,
    'MKT_META_K2_PLATFORM_FOOTPRINT_HEAD',
  );
  const dirty = gitText(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== branchName
    || head !== expectedHead
    || remoteHead !== expectedHead
    || dirty.trim() !== '') {
    throw auditError(
      'Meta K2 platform audit requires the exact clean reviewed Head',
      'META_K2_PLATFORM_FOOTPRINT_REPOSITORY_INVALID',
      {
        branch,
        expectedBranch: branchName,
        head,
        remoteHead,
        expectedHead,
        clean: dirty.trim() === '',
      },
    );
  }
  return { branch, head, clean: true };
}

async function resolveRepositoryFile(value, fieldName) {
  const input = requireText(value, fieldName);
  const candidate = resolve(repositoryRoot, input);
  const canonical = await realpath(candidate);
  if (canonical !== repositoryRoot && !canonical.startsWith(`${repositoryRoot}/`)) {
    throw auditError(
      `${fieldName} must resolve inside the Repository`,
      'META_K2_PLATFORM_FOOTPRINT_PATH_INVALID',
      { fieldName },
    );
  }
  const valueStat = await stat(canonical);
  if (!valueStat.isFile()) {
    throw auditError(
      `${fieldName} must be a regular file`,
      'META_K2_PLATFORM_FOOTPRINT_FILE_INVALID',
      { fieldName },
    );
  }
  return canonical;
}

async function assertPrivateFile(path, fieldName) {
  const valueStat = await stat(path);
  if ((valueStat.mode & 0o077) !== 0) {
    throw auditError(
      `${fieldName} must not be readable by group or others`,
      'META_K2_PLATFORM_FOOTPRINT_PRIVATE_FILE_INVALID',
      { fieldName },
    );
  }
}

function runText(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw auditError(
      `Read-only command failed: ${command}`,
      'META_K2_PLATFORM_FOOTPRINT_COMMAND_FAILED',
      {
        command,
        exitCode: result.status ?? null,
        stderrSha256: sha256(result.stderr ?? ''),
      },
    );
  }
  return String(result.stdout ?? '').trim();
}

function gitText(args, trim = true) {
  const value = runText('git', args, process.env);
  return trim ? value.trim() : value;
}

function cleanCloudflareEnvironment(env) {
  const output = { ...env };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!String(output[key] ?? '').trim()) delete output[key];
  }
  return output;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw auditError(
      'Unsupported Meta K2 platform audit argument',
      'META_K2_PLATFORM_FOOTPRINT_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function selectColumn(columns, candidates, fieldName) {
  const selected = candidates.find((candidate) => columns.includes(candidate));
  if (!selected) {
    throw auditError(
      `Meta K2 platform audit schema is missing ${fieldName}`,
      'META_K2_PLATFORM_FOOTPRINT_SCHEMA_INVALID',
      { fieldName, candidates },
    );
  }
  return selected;
}

function requireColumn(columns, column, tableName) {
  if (!columns.includes(column)) {
    throw auditError(
      `Meta K2 platform audit schema is missing ${tableName}.${column}`,
      'META_K2_PLATFORM_FOOTPRINT_SCHEMA_INVALID',
      { tableName, column },
    );
  }
}

function quoteIdentifier(value) {
  const text = requireText(value, 'SQL identifier');
  if (!/^[a-z_][a-z0-9_]*$/u.test(text)) {
    throw auditError(
      'Meta K2 platform audit SQL identifier is invalid',
      'META_K2_PLATFORM_FOOTPRINT_SCHEMA_INVALID',
    );
  }
  return `"${text}"`;
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function compactSql(value) {
  return String(value).replace(/\s+/gu, ' ').trim();
}

function parseJsonObject(value, fieldName) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw auditError(
      `${fieldName} is not valid JSON`,
      'META_K2_PLATFORM_FOOTPRINT_JSON_INVALID',
      { fieldName },
    );
  }
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw auditError(
      `${fieldName} is not a non-negative integer`,
      'META_K2_PLATFORM_FOOTPRINT_NUMBER_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw auditError(
      `${fieldName} must be a full Git SHA`,
      'META_K2_PLATFORM_FOOTPRINT_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw auditError(
      `${fieldName} is required`,
      'META_K2_PLATFORM_FOOTPRINT_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function sanitize(value, key = '') {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, key));
  if (typeof value !== 'object') {
    return /token|authorization|secret|password|payload|cursor|origin|url|account|entity/iu.test(key)
      ? '[REDACTED]'
      : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    sanitize(nestedValue, nestedKey),
  ]));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function auditError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK2PublisherPlatformFootprintAuditError';
  error.code = code;
  error.details = details;
  return error;
}
