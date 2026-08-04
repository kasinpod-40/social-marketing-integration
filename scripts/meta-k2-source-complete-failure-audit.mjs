#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  describeMetaK2PersistedError,
  replayMetaK2CompleteLarkPayloadPreflight,
  replayMetaK2SourceCompleteValidation,
  selectMetaK2AuditColumn,
  summarizeMetaK2StagedUnits,
} from './lib/meta-k2-source-complete-failure-audit.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import {
  assertWooCommercePreviewUrlBaseline,
  parseWooCommercePreviewUrlState,
} from './lib/woocommerce-preview-url-window.js';
import {
  META_K2_EXACT_RECOVERY_IDENTITY,
} from '../packages/config/src/meta-k2-exact-recovery-contract.js';
import { readLarkTableIdsFromEnv } from '../packages/config/src/lark-table-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';

const repositoryRoot = realpathSync.native(process.cwd());
const branchName = 'integration/all-meta-end-to-end-completion-v1';
const workerName = 'social-mkt-sync-worker';
const databaseBinding = 'MKT_STATE_DB';
const sourcePhase = 'meta_end_to_end_source_staging_v1';
const execute = parseArgs(process.argv.slice(2));

if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    stage: 'meta-k2-source-complete-failure-read-only-audit',
    reads: {
      d1Schema: true,
      d1ExactOperation: true,
      stagedPayloadReplayInMemory: true,
      larkLiveFieldSchema: true,
      completeLarkPayloadPreflight: true,
      productionWorker: true,
      previewUrlState: true,
    },
    rawPayloadPrinted: false,
    providerRequestCount: 0,
    queueActionCount: 0,
    d1WriteCount: 0,
    larkRecordReadCount: 0,
    larkWriteCount: 0,
    workerVersionUploadCount: 0,
    productionDeploymentCount: 0,
    productionTrafficChangeCount: 0,
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
    process.env.MKT_META_K2_FAILURE_AUDIT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
    'MKT_META_K2_FAILURE_AUDIT_WRANGLER_CONFIG',
  );
  const configText = await readFile(configPath, 'utf8');
  const devVars = await readDevVars(devVarsPath);
  const mergedEnv = cleanCloudflareEnvironment({ ...devVars, ...process.env });
  const authContext = resolveAuthContext(mergedEnv, configText);

  const productionBefore = readProductionState(authContext.env, configPath);
  const previewBefore = assertWooCommercePreviewUrlBaseline(
    await readPreviewState(authContext, 'before-audit'),
  );

  const schemas = readSchemas(authContext.env, configPath);
  const exact = readExactOperation({
    env: authContext.env,
    configPath,
    schemas,
  });
  const payloads = readStagedPayloads({
    env: authContext.env,
    configPath,
    schemas,
  });
  const stagedSummary = summarizeMetaK2StagedUnits(payloads);
  assertStagedSummaryMatchesState(stagedSummary, exact.sourceState);
  const replay = await replayMetaK2SourceCompleteValidation({
    payloads,
    sourceState: exact.sourceState,
    identity: META_K2_EXACT_RECOVERY_IDENTITY,
    generation: exact.generation,
    originalRequestedAt: exact.originalRequestedAt,
  });
  const larkAudit = createReadOnlyLarkAuditContext(authContext.env);
  const larkPayloadPreflight = await replayMetaK2CompleteLarkPayloadPreflight({
    payloads,
    sourceState: exact.sourceState,
    identity: META_K2_EXACT_RECOVERY_IDENTITY,
    generation: exact.generation,
    originalRequestedAt: exact.originalRequestedAt,
    repository: larkAudit.repository,
    tables: readExactLarkTableIds(authContext.env),
  });

  const productionAfter = readProductionState(authContext.env, configPath);
  const previewAfter = assertWooCommercePreviewUrlBaseline(
    await readPreviewState(authContext, 'after-audit'),
  );
  if (productionBefore.versionId !== productionAfter.versionId
    || productionBefore.trueFlags.length !== 0
    || productionAfter.trueFlags.length !== 0) {
    throw auditError(
      'Production Worker changed or is not all-false during the Meta K2 audit',
      'META_K2_FAILURE_AUDIT_PRODUCTION_DRIFT',
      {
        versionUnchanged: productionBefore.versionId === productionAfter.versionId,
        beforeTrueFlags: productionBefore.trueFlags,
        afterTrueFlags: productionAfter.trueFlags,
      },
    );
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'meta-k2-source-complete-failure-read-only-audit',
    repository,
    targetKey: META_K2_EXACT_RECOVERY_IDENTITY.targetKey,
    operationId: META_K2_EXACT_RECOVERY_IDENTITY.operationId,
    boundary: 'retained_source_complete_exact_operation',
    persistedSyncRun: exact.syncRunSummary,
    persistedError: describeMetaK2PersistedError(exact.syncRunErrorRow),
    stagedSummary,
    replay,
    larkPayloadPreflight,
    productionWorker: {
      versionId: productionAfter.versionId,
      versionUnchanged: true,
      trueFlags: productionAfter.trueFlags,
      allFalse: true,
      deploymentPercentage: 100,
    },
    previewWindow: {
      before: previewBefore,
      after: previewAfter,
      previewUrlsRestoredSafe: true,
      workersDevRestoredDisabled: true,
    },
    rawPayloadPrinted: false,
    providerRequestCount: replay.providerRequestCount
      + larkPayloadPreflight.providerRequestCount,
    queueActionCount: 0,
    d1ReadCount: 8,
    d1WriteCount: 0,
    larkSchemaReadCount: larkAudit.fieldReadCount,
    larkRecordReadCount: larkAudit.recordReadCount,
    larkWriteCount: larkAudit.writeCount,
    workerVersionUploadCount: 0,
    productionDeploymentCount: 0,
    productionTrafficChangeCount: 0,
    lifecycleSqlRepairCount: 0,
    recoveryAuthorized: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'meta-k2-source-complete-failure-read-only-audit',
    code: error?.code ?? 'META_K2_FAILURE_AUDIT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    rawPayloadPrinted: false,
    providerRequestCount: 0,
    queueActionCount: 0,
    d1WriteCount: 0,
    larkRecordReadCount: 0,
    larkWriteCount: 0,
    workerVersionUploadCount: 0,
    productionDeploymentCount: 0,
    productionTrafficChangeCount: 0,
    lifecycleSqlRepairCount: 0,
    recoveryAuthorized: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function createReadOnlyLarkAuditContext(env) {
  const client = createLarkBitableClientFromEnv(env);
  let fieldReadCount = 0;
  let recordReadCount = 0;
  let writeCount = 0;
  const blocked = (kind) => {
    if (kind === 'record_read') recordReadCount += 1;
    else writeCount += 1;
    throw auditError(
      `Meta K2 read-only Lark audit blocked ${kind}`,
      'META_K2_FAILURE_AUDIT_LARK_MUTATION_ATTEMPTED',
      { kind },
    );
  };
  const guardedClient = {
    async listFields(input) {
      fieldReadCount += 1;
      return client.listFields(input);
    },
    async listRecords() {
      return blocked('record_read');
    },
    async batchCreateRecords() {
      return blocked('batch_create');
    },
    async batchUpdateRecords() {
      return blocked('batch_update');
    },
  };
  const repository = new LarkRecordRepository({ client: guardedClient });
  return Object.freeze({
    repository,
    get fieldReadCount() { return fieldReadCount; },
    get recordReadCount() { return recordReadCount; },
    get writeCount() { return writeCount; },
  });
}

function readExactLarkTableIds(env) {
  return readLarkTableIdsFromEnv(env, [
    'mktAdsAccounts',
    'mktAdsCampaigns',
    'mktAdsAdGroups',
    'mktAdsAds',
  ]);
}

function readSchemas(env, configPath) {
  return Object.freeze({
    syncRuns: readTableColumns(env, configPath, 'sync_runs'),
    syncWorkRuns: readTableColumns(env, configPath, 'sync_work_runs'),
    syncWorkPhases: readTableColumns(env, configPath, 'sync_work_phases'),
    syncWorkUnits: readTableColumns(env, configPath, 'sync_work_units'),
  });
}

function readExactOperation({ env, configPath, schemas }) {
  const syncColumns = schemas.syncRuns;
  const baseSyncColumns = [
    'status', 'started_at', 'finished_at', 'error_code', 'records_written', 'updated_at',
  ];
  for (const column of baseSyncColumns) requireColumn(syncColumns, column, 'sync_runs');
  const optionalErrorColumns = syncColumns.filter((column) => (
    /error|message|detail|cause/iu.test(column) && !baseSyncColumns.includes(column)
  ));
  const syncSelect = [...baseSyncColumns, ...optionalErrorColumns]
    .map((column) => `${quoteIdentifier(column)} AS ${quoteIdentifier(column)}`)
    .join(', ');
  const syncRows = runD1Rows(env, configPath, `
    SELECT ${syncSelect}
    FROM sync_runs
    WHERE sync_run_id = ${sqlText(META_K2_EXACT_RECOVERY_IDENTITY.syncRunId)};
  `);
  if (syncRows.length !== 1) {
    throw auditError(
      'Meta K2 exact Sync Run was not found uniquely',
      'META_K2_FAILURE_AUDIT_SYNC_RUN_INVALID',
      { observed: syncRows.length },
    );
  }

  const workColumns = schemas.syncWorkRuns;
  const generationColumn = selectMetaK2AuditColumn(
    workColumns,
    ['generation', 'requested_at', 'original_requested_at'],
    'sync_work_runs generation',
  );
  const requestedColumn = selectMetaK2AuditColumn(
    workColumns,
    ['requested_at', 'original_requested_at', 'generation'],
    'sync_work_runs requested timestamp',
  );
  const workRows = runD1Rows(env, configPath, `
    SELECT
      ${quoteIdentifier(generationColumn)} AS generation,
      ${quoteIdentifier(requestedColumn)} AS original_requested_at
    FROM sync_work_runs
    WHERE work_key = ${sqlText(META_K2_EXACT_RECOVERY_IDENTITY.workKey)};
  `);
  if (workRows.length !== 1) {
    throw auditError(
      'Meta K2 exact Work was not found uniquely',
      'META_K2_FAILURE_AUDIT_WORK_INVALID',
      { observed: workRows.length },
    );
  }

  for (const column of ['work_key', 'phase', 'state_json', 'complete']) {
    requireColumn(schemas.syncWorkPhases, column, 'sync_work_phases');
  }
  const phaseRows = runD1Rows(env, configPath, `
    SELECT state_json, complete
    FROM sync_work_phases
    WHERE work_key = ${sqlText(META_K2_EXACT_RECOVERY_IDENTITY.workKey)}
      AND phase = ${sqlText(sourcePhase)};
  `);
  if (phaseRows.length !== 1 || Number(phaseRows[0].complete) !== 1) {
    throw auditError(
      'Meta K2 source phase is not one complete retained phase',
      'META_K2_FAILURE_AUDIT_SOURCE_PHASE_INVALID',
      { observed: phaseRows.length, complete: phaseRows[0]?.complete ?? null },
    );
  }
  const sourceState = parseJsonObject(phaseRows[0].state_json, 'source phase state_json');
  if (sourceState.stage !== 'complete') {
    throw auditError(
      'Meta K2 source state is not complete',
      'META_K2_FAILURE_AUDIT_SOURCE_PHASE_INVALID',
      { stage: sourceState.stage ?? null },
    );
  }

  const row = syncRows[0];
  return Object.freeze({
    generation: positiveTimestamp(workRows[0].generation, 'generation'),
    originalRequestedAt: positiveTimestamp(
      workRows[0].original_requested_at,
      'original_requested_at',
    ),
    sourceState,
    syncRunErrorRow: Object.freeze({
      error_code: row.error_code ?? null,
      ...Object.fromEntries(optionalErrorColumns.map((column) => [column, row[column] ?? null])),
    }),
    syncRunSummary: Object.freeze({
      status: row.status ?? null,
      startedAt: nullableNumber(row.started_at),
      finishedAt: nullableNumber(row.finished_at),
      errorCode: row.error_code ?? null,
      recordsWritten: nonNegativeInteger(row.records_written, 'records_written'),
      updatedAt: nullableNumber(row.updated_at),
    }),
  });
}

function readStagedPayloads({ env, configPath, schemas }) {
  const columns = schemas.syncWorkUnits;
  const workKeyColumn = selectMetaK2AuditColumn(
    columns,
    ['work_key'],
    'sync_work_units work key',
  );
  const phaseColumn = selectMetaK2AuditColumn(
    columns,
    ['phase'],
    'sync_work_units phase',
  );
  const sequenceColumn = selectMetaK2AuditColumn(
    columns,
    ['sequence', 'unit_sequence', 'sequence_number'],
    'sync_work_units sequence',
  );
  const payloadColumn = selectMetaK2AuditColumn(
    columns,
    ['payload_json', 'payload', 'unit_json'],
    'sync_work_units payload',
  );
  const rows = runD1Rows(env, configPath, `
    SELECT
      ${quoteIdentifier(sequenceColumn)} AS unit_sequence,
      ${quoteIdentifier(payloadColumn)} AS payload_json
    FROM sync_work_units
    WHERE ${quoteIdentifier(workKeyColumn)} = ${sqlText(META_K2_EXACT_RECOVERY_IDENTITY.workKey)}
      AND ${quoteIdentifier(phaseColumn)} = ${sqlText(sourcePhase)}
    ORDER BY ${quoteIdentifier(sequenceColumn)} ASC;
  `);
  return Object.freeze(rows.map((row, index) => {
    const sequence = nonNegativeInteger(row.unit_sequence, 'unit_sequence');
    if (sequence !== index) {
      throw auditError(
        'Meta K2 staged unit sequence is not contiguous from zero',
        'META_K2_FAILURE_AUDIT_UNIT_SEQUENCE_INVALID',
        { expected: index, observed: sequence },
      );
    }
    return parseJsonObject(row.payload_json, 'sync_work_units payload_json');
  }));
}

function assertStagedSummaryMatchesState(summary, state) {
  if (summary.unitCount !== Number(state.unitCount)
    || summary.rowCount !== Number(state.rowCount)) {
    throw auditError(
      'Meta K2 staged payload totals differ from the complete source state',
      'META_K2_FAILURE_AUDIT_STAGED_TOTAL_MISMATCH',
      {
        expectedUnits: Number(state.unitCount),
        observedUnits: summary.unitCount,
        expectedRows: Number(state.rowCount),
        observedRows: summary.rowCount,
      },
    );
  }
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
      'META_K2_FAILURE_AUDIT_SCHEMA_INVALID',
      { tableName },
    );
  }
  return Object.freeze(columns);
}

function resolveAuthContext(env, configText) {
  const whoami = runText('npx', ['wrangler', 'whoami', '--json'], env);
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    configText,
    whoamiOutput: whoami,
  });
  const selectedEnv = { ...env, CLOUDFLARE_ACCOUNT_ID: accountId };
  runText('npx', ['wrangler', 'whoami', '--account', accountId, '--json'], selectedEnv);
  const authOutput = selectedEnv.CLOUDFLARE_API_TOKEN
    ? null
    : runText('npx', ['wrangler', 'auth', 'token', '--json'], selectedEnv);
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: selectedEnv.CLOUDFLARE_API_TOKEN,
    authOutput,
  });
  return Object.freeze({ env: selectedEnv, accountId, token: auth.token });
}

function readProductionState(env, configPath) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status',
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], env));
  const status = Array.isArray(value) ? value[0] : value;
  const active = (Array.isArray(status?.versions) ? status.versions : [])
    .filter((entry) => Number(entry?.percentage) === 100);
  if (active.length !== 1 || !active[0]?.version_id) {
    throw auditError(
      'Worker does not have exactly one 100% Production version',
      'META_K2_FAILURE_AUDIT_ACTIVE_VERSION_INVALID',
    );
  }
  const versionId = active[0].version_id;
  const version = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', versionId,
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], env));
  return Object.freeze({ versionId, trueFlags: readEnabledFlags(version) });
}

async function readPreviewState(auth, label) {
  const endpoint = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(auth.accountId)}`
    + `/workers/scripts/${encodeURIComponent(workerName)}/subdomain`;
  const response = await fetch(endpoint, {
    method: 'GET',
    headers: {
      authorization: `Bearer ${auth.token}`,
      accept: 'application/json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw auditError(
      'Cloudflare Worker Preview URL state read failed',
      'META_K2_FAILURE_AUDIT_PREVIEW_READ_FAILED',
      { label, httpStatus: response.status },
    );
  }
  return parseWooCommercePreviewUrlState(body, label);
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
      'META_K2_FAILURE_AUDIT_D1_RESPONSE_INVALID',
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
    process.env.MKT_META_K2_FAILURE_AUDIT_HEAD,
    'MKT_META_K2_FAILURE_AUDIT_HEAD',
  );
  const dirty = gitText(['status', '--porcelain', '--untracked-files=no'], false);
  if (branch !== branchName
    || head !== expectedHead
    || remoteHead !== expectedHead
    || dirty.trim() !== '') {
    throw auditError(
      'Meta K2 failure audit requires the exact clean reviewed Head',
      'META_K2_FAILURE_AUDIT_REPOSITORY_INVALID',
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
  return Object.freeze({ branch, head, clean: true });
}

function readEnabledFlags(value) {
  const flags = new Map();
  walk(value, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, nested] of Object.entries(node)) {
      if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) flags.set(key, booleanLike(nested));
    }
    if (typeof node.name === 'string'
      && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(node.name)) {
      flags.set(node.name, booleanLike(node.text ?? node.value ?? node.json ?? node.data));
    }
  });
  return [...flags.entries()]
    .filter(([, enabled]) => enabled)
    .map(([name]) => name)
    .sort();
}

function walk(value, callback) {
  callback(value);
  if (Array.isArray(value)) {
    for (const nested of value) walk(nested, callback);
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) walk(nested, callback);
  }
}

function booleanLike(value) {
  if (value === true || value === false) return value;
  if (value && typeof value === 'object') {
    return booleanLike(value.text ?? value.value ?? value.json ?? value.data);
  }
  const normalized = String(value ?? '').trim().toLowerCase();
  if (['true', '1', 'yes', 'on'].includes(normalized)) return true;
  if (['false', '0', 'no', 'off', ''].includes(normalized)) return false;
  return false;
}

async function resolveRepositoryFile(value, fieldName) {
  const input = requireText(value, fieldName);
  const candidate = resolve(repositoryRoot, input);
  const canonical = await realpath(candidate);
  if (canonical !== repositoryRoot && !canonical.startsWith(`${repositoryRoot}/`)) {
    throw auditError(
      `${fieldName} must resolve inside the Repository`,
      'META_K2_FAILURE_AUDIT_PATH_INVALID',
      { fieldName },
    );
  }
  const valueStat = await stat(canonical);
  if (!valueStat.isFile()) {
    throw auditError(
      `${fieldName} must be a regular file`,
      'META_K2_FAILURE_AUDIT_FILE_INVALID',
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
      'META_K2_FAILURE_AUDIT_PRIVATE_FILE_INVALID',
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
      'META_K2_FAILURE_AUDIT_COMMAND_FAILED',
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
      'Unsupported Meta K2 failure audit argument',
      'META_K2_FAILURE_AUDIT_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw auditError(
      `${fieldName} must be a full Git SHA`,
      'META_K2_FAILURE_AUDIT_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireColumn(columns, column, tableName) {
  if (!columns.includes(column)) {
    throw auditError(
      `Meta K2 audit schema is missing ${tableName}.${column}`,
      'META_K2_FAILURE_AUDIT_SCHEMA_INVALID',
      { tableName, column },
    );
  }
}

function quoteIdentifier(value) {
  const text = requireText(value, 'SQL identifier');
  if (!/^[a-z_][a-z0-9_]*$/u.test(text)) {
    throw auditError(
      'Meta K2 audit SQL identifier is invalid',
      'META_K2_FAILURE_AUDIT_SCHEMA_INVALID',
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
      'META_K2_FAILURE_AUDIT_JSON_INVALID',
      { fieldName },
    );
  }
}

function positiveTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw auditError(
      `${fieldName} is not a positive timestamp`,
      'META_K2_FAILURE_AUDIT_TIMESTAMP_INVALID',
      { fieldName },
    );
  }
  return number;
}

function nonNegativeInteger(value, fieldName) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    throw auditError(
      `${fieldName} is not a non-negative integer`,
      'META_K2_FAILURE_AUDIT_NUMBER_INVALID',
      { fieldName },
    );
  }
  return number;
}

function nullableNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw auditError(
      `${fieldName} is required`,
      'META_K2_FAILURE_AUDIT_INPUT_INVALID',
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
  error.name = 'MetaK2SourceCompleteFailureAuditError';
  error.code = code;
  error.details = details;
  return error;
}
