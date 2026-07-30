#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  realpath,
  rename,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  buildWooCommerceFinalRecoveryOnlySnapshotSql,
  classifyWooCommerceFinalRecoveryOnlyState,
} from './lib/woocommerce-final-recovery-only.js';
import {
  buildWooCommerceLarkSelectOptionRepair,
  createWooCommerceLarkSchemaContract,
} from './lib/woocommerce-final-rollout-operator.js';
import {
  assertWooCommerce2026RemoteSafeFlags,
  selectExactlyOneActiveWorkerVersion,
  validateWooCommerce2026CleanupPreflight,
} from './lib/woocommerce-2026-completion-one-command.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import { discoverWooCommerceQueueId } from './lib/woocommerce-final-queue-discovery.js';
import {
  assertWooCommercePreviewUrlBaseline,
  parseWooCommercePreviewUrlState,
} from './lib/woocommerce-preview-url-window.js';
import {
  readAccountWorkersDevSubdomain,
} from './woocommerce-worker-provider-diagnostics-preview-window.mjs';
import {
  createLarkBitableClientFromEnv,
} from '../packages/connectors/src/lark/lark-bitable.client.js';
import {
  FINAL_DELIVERY_META_HEAD,
  FINAL_DELIVERY_META_OPERATION_ID,
  FINAL_DELIVERY_READINESS_CONFIRMATION,
  FINAL_DELIVERY_READINESS_TTL_MS,
  FINAL_DELIVERY_WOO_INCIDENT_OPERATION_ID,
  buildFinalDeliveryReadinessManifest,
  inspectMetaSession,
  readinessSummary,
  sha256,
} from './lib/final-delivery-readiness.js';

const repositoryRoot = resolve(process.cwd());
const confirmationName = 'CONFIRM_MKT_FINAL_DELIVERY_READINESS';
const defaultDatabase = 'social-mkt-state-dev';
const defaultWorker = 'social-mkt-sync-worker';
const defaultQueue = 'social-mkt-sync-jobs';
const oldOperationId = 'woo-final-full-e2372e56d52d';
const oldWorkKey = `woocommerce:${oldOperationId}`;
const historyStartMs = Date.parse('2026-01-01T00:00:00.000Z');
const requiredWorkerSecrets = Object.freeze([
  'LARK_APP_SECRET',
  'WOOCOMMERCE_CONSUMER_KEY',
  'WOOCOMMERCE_CONSUMER_SECRET',
]);
const requiredOperatorFiles = Object.freeze([
  'scripts/woocommerce-invalid-json-recovery-chain.mjs',
  'scripts/woocommerce-worker-provider-diagnostics-preview-window.mjs',
  'scripts/woocommerce-worker-provider-diagnostics-ephemeral.mjs',
  'scripts/woocommerce-final-recovery-only.mjs',
  'scripts/woocommerce-2026-completion-canonical-launcher.mjs',
]);

const issues = [];
let remoteReadCount = 0;
let localContext = null;
let cloudflareContext = null;
let wooContext = null;
let larkContext = null;
let metaContext = null;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
  } else {
    await runAudit();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    status: 'NOT_READY',
    code: error?.code ?? 'FINAL_DELIVERY_READINESS_AUDIT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    issues: issues.length > 0 ? issues : [safeIssue('audit', error)],
    providerRequestCount: 0,
    workerVersionUploadCount: 0,
    workerDeploymentCount: 0,
    queueMessageCount: 0,
    d1MutationCount: 0,
    larkMutationCount: 0,
    scheduleMutationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function runAudit() {
  requireExact(
    process.env[confirmationName],
    FINAL_DELIVERY_READINESS_CONFIRMATION,
    confirmationName,
  );

  localContext = await collectGate('local', auditLocal);
  cloudflareContext = await collectGate('cloudflare', async () => {
    requireDependency(localContext, 'local');
    return auditCloudflare(localContext);
  });
  wooContext = await collectGate('woocommerce', async () => {
    requireDependency(localContext, 'local');
    requireDependency(cloudflareContext, 'cloudflare');
    return auditWoo(localContext, cloudflareContext);
  });
  larkContext = await collectGate('lark', async () => {
    requireDependency(localContext, 'local');
    return auditLark(localContext);
  });
  metaContext = await collectGate('meta', auditMeta);

  if (issues.length > 0) {
    const error = auditError(
      'Final delivery readiness audit found all blocking prerequisites',
      'FINAL_DELIVERY_READINESS_BLOCKED',
      { issueCount: issues.length },
    );
    throw error;
  }

  const createdAt = new Date();
  const manifest = buildFinalDeliveryReadinessManifest({
    repositoryHead: localContext.repositoryHead,
    createdAt: createdAt.toISOString(),
    expiresAt: new Date(createdAt.getTime() + FINAL_DELIVERY_READINESS_TTL_MS).toISOString(),
    local: {
      devVarsSha256: localContext.devVarsSha256,
      wranglerConfigSha256: localContext.wranglerConfigSha256,
      packageLockSha256: localContext.packageLockSha256,
      nodeMajor: localContext.nodeMajor,
      cleanMain: true,
      privateInputsSecure: true,
    },
    cloudflare: {
      accountId: cloudflareContext.accountId,
      authType: cloudflareContext.authType,
      workersDevSubdomain: cloudflareContext.workersDevSubdomain,
      workerName: cloudflareContext.workerName,
      activeVersionId: cloudflareContext.activeVersionId,
      executionFlagsAllFalse: true,
      previewUrlsEnabled: cloudflareContext.previewUrlsEnabled,
      workersDevEnabled: cloudflareContext.workersDevEnabled,
      queueId: cloudflareContext.queueId,
      requiredSecretNamesPresent: true,
      secretNameFingerprint: cloudflareContext.secretNameFingerprint,
    },
    woo: {
      incidentOperationId: FINAL_DELIVERY_WOO_INCIDENT_OPERATION_ID,
      incidentState: wooContext.incidentState,
      syncRunStatus: wooContext.syncRunStatus,
      syncRunErrorCode: wooContext.syncRunErrorCode,
      activeLockCount: wooContext.activeLockCount,
      queueOperationAttempts: wooContext.queueOperationAttempts,
      coverageRunCount: wooContext.coverageRunCount,
      incidentBusinessRows: wooContext.incidentBusinessRows,
      retainedBusinessRows: wooContext.retainedBusinessRows,
      cleanupOldRows: wooContext.cleanupOldRows,
      cleanupAggregateRows: wooContext.cleanupAggregateRows,
      cleanupComplete: true,
    },
    lark: larkContext,
    meta: metaContext,
    safety: {
      providerRequestCount: 0,
      workerVersionUploadCount: 0,
      workerDeploymentCount: 0,
      queueMessageCount: 0,
      d1MutationCount: 0,
      larkMutationCount: 0,
      scheduleMutationCount: 0,
    },
  });

  const outputPath = resolveRequiredPath(
    process.env.MKT_FINAL_DELIVERY_READINESS_MANIFEST,
    'MKT_FINAL_DELIVERY_READINESS_MANIFEST',
  );
  await writePrivateJsonAtomic(outputPath, manifest);

  process.stdout.write(`${JSON.stringify({
    ...readinessSummary(manifest),
    manifestPath: outputPath,
    manifestSha256: sha256(await readFile(outputPath)),
    remoteReadCount,
    allPrerequisitesCollectedInOneAudit: true,
    nextCommandRequiresThisManifest: true,
  }, null, 2)}\n`);
}

async function auditLocal() {
  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const branch = gitText(['branch', '--show-current']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || repositoryHead !== originMain || dirty.trim() !== '') {
    throw auditError(
      'Readiness audit requires exact clean main equal to origin/main',
      'FINAL_DELIVERY_READINESS_REPOSITORY_INVALID',
      { branch, repositoryHead, originMain, clean: dirty.trim() === '' },
    );
  }

  const devVarsPath = resolveRequiredPath(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
    'DEV_VARS_FILE',
  );
  const configPath = resolveRequiredPath(
    process.env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
    'MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG',
  );
  await assertPrivateRegularFile(devVarsPath, 'DEV_VARS_FILE');
  await assertPrivateRegularFile(configPath, 'MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG');
  for (const path of requiredOperatorFiles) {
    await assertRegularFile(resolve(repositoryRoot, path), path, { privateFile: false });
  }
  await assertRegularFile(resolve(repositoryRoot, 'package-lock.json'), 'package-lock.json', {
    privateFile: false,
  });
  const wranglerExecutable = resolve(
    repositoryRoot,
    'node_modules',
    '.bin',
    process.platform === 'win32' ? 'wrangler.cmd' : 'wrangler',
  );
  await assertRegularFile(wranglerExecutable, 'pinned Wrangler executable', {
    privateFile: false,
  });

  const fileEnv = await readDevVars(devVarsPath);
  const env = Object.freeze({ ...fileEnv, ...process.env });
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  requireText(env.LARK_APP_ID, 'LARK_APP_ID');
  requireText(env.LARK_APP_SECRET, 'LARK_APP_SECRET');
  requireText(env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN, 'LARK_APP_TOKEN');

  return Object.freeze({
    repositoryHead,
    devVarsPath,
    configPath,
    configText: await readFile(configPath, 'utf8'),
    env,
    wranglerExecutable,
    devVarsSha256: digest(await readFile(devVarsPath)),
    wranglerConfigSha256: digest(await readFile(configPath)),
    packageLockSha256: digest(await readFile(resolve(repositoryRoot, 'package-lock.json'))),
    nodeMajor: Number(process.versions.node.split('.')[0]),
  });
}

async function auditCloudflare(local) {
  const baseEnv = compactCloudflareEnv(local.env);
  const whoami = runWrangler(local, ['whoami', '--json'], baseEnv);
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: local.env.CLOUDFLARE_ACCOUNT_ID,
    configText: local.configText,
    whoamiOutput: whoami,
    preferredAccount: local.env.MKT_WOOCOMMERCE_ROLLOUT_ACCOUNT,
  });
  const selectedEnv = { ...baseEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
  runWrangler(local, ['whoami', '--account', accountId, '--json'], selectedEnv);
  const explicitApiToken = optionalText(local.env.CLOUDFLARE_API_TOKEN);
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken,
    authOutput: explicitApiToken
      ? null
      : runWrangler(local, ['auth', 'token', '--json'], selectedEnv),
  });
  const workerName = optionalText(local.env.MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME)
    ?? defaultWorker;
  const workersDevSubdomain = await readAccountWorkersDevSubdomain({
    accountId,
    bearerToken: auth.token,
  });
  remoteReadCount += 1;

  const workerSubdomainResponse = await cloudflareGet(
    accountId,
    auth.token,
    `/workers/scripts/${encodeURIComponent(workerName)}/subdomain`,
  );
  const previewState = assertWooCommercePreviewUrlBaseline(
    parseWooCommercePreviewUrlState(workerSubdomainResponse, 'readiness-audit'),
  );

  const deploymentRaw = parseJson(runWrangler(local, [
    'deployments', 'status',
    '--name', workerName,
    '--config', local.configPath,
    '--json',
  ], selectedEnv), 'Worker deployments');
  const deployment = Array.isArray(deploymentRaw) ? deploymentRaw[0] : deploymentRaw;
  const activeVersionId = selectExactlyOneActiveWorkerVersion(deployment);
  const versionView = parseJson(runWrangler(local, [
    'versions', 'view', activeVersionId,
    '--name', workerName,
    '--config', local.configPath,
    '--json',
  ], selectedEnv), 'Worker version view');
  assertWooCommerce2026RemoteSafeFlags(versionView);

  const secretOutput = runWrangler(local, [
    'secret', 'list',
    '--name', workerName,
    '--config', local.configPath,
    '--format', 'json',
  ], selectedEnv);
  const secretNames = parseSecretNames(secretOutput);
  const missingSecrets = requiredWorkerSecrets.filter((name) => !secretNames.includes(name));
  if (missingSecrets.length > 0) {
    throw auditError(
      'Required Worker Secret names are missing',
      'FINAL_DELIVERY_READINESS_WORKER_SECRETS_MISSING',
      { missingSecrets },
    );
  }

  const queueId = await discoverWooCommerceQueueId({
    accountId,
    apiToken: auth.token,
    queueName: optionalText(local.env.MKT_MAIN_QUEUE_NAME) ?? defaultQueue,
  });
  remoteReadCount += 1;

  return Object.freeze({
    accountId,
    authType: auth.type,
    authToken: auth.token,
    selectedEnv,
    workerName,
    workersDevSubdomain,
    previewUrlsEnabled: previewState.previewsEnabled,
    workersDevEnabled: previewState.enabled,
    activeVersionId,
    queueId,
    secretNameFingerprint: sha256(JSON.stringify(secretNames)),
  });
}

async function auditWoo(local, cloudflare) {
  const env = {
    ...local.env,
    ...cloudflare.selectedEnv,
    CLOUDFLARE_API_TOKEN: cloudflare.authToken,
    MKT_WOOCOMMERCE_FINAL_QUEUE_ID: cloudflare.queueId,
    MKT_WOOCOMMERCE_WORKERS_DEV_SUBDOMAIN: cloudflare.workersDevSubdomain,
  };
  const databaseName = optionalText(local.env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME)
    ?? defaultDatabase;
  const incidentRow = readD1Row(local, env, databaseName,
    buildWooCommerceFinalRecoveryOnlySnapshotSql({
      accountKey: 'chemistry_k',
      operationId: FINAL_DELIVERY_WOO_INCIDENT_OPERATION_ID,
    }));
  const incident = classifyWooCommerceFinalRecoveryOnlyState(incidentRow, {
    operationId: FINAL_DELIVERY_WOO_INCIDENT_OPERATION_ID,
  });
  const cleanupRow = readD1Row(local, env, databaseName, buildCleanupStateSql());
  const cleanup = validateWooCommerce2026CleanupPreflight(cleanupRow);
  if (!cleanup.alreadyClean || cleanup.oldRows !== 0 || cleanup.aggregateRows !== 0) {
    throw auditError(
      'WooCommerce 2026 cleanup is not complete',
      'FINAL_DELIVERY_READINESS_WOO_CLEANUP_INCOMPLETE',
      {
        pendingExactCleanup: cleanup.pendingExactCleanup,
        oldRows: cleanup.oldRows,
        aggregateRows: cleanup.aggregateRows,
      },
    );
  }
  return Object.freeze({
    incidentState: incident.state,
    syncRunStatus: incident.result.snapshot.syncRunStatus,
    syncRunErrorCode: incident.result.snapshot.syncRunErrorCode,
    activeLockCount: incident.result.snapshot.activeLockCount,
    queueOperationAttempts: incident.result.snapshot.queueOperationAttempts,
    coverageRunCount: incident.result.snapshot.coverageRunCount,
    incidentBusinessRows: incident.result.incidentBusinessRows,
    retainedBusinessRows: incident.result.retainedBusinessRows,
    cleanupOldRows: cleanup.oldRows,
    cleanupAggregateRows: cleanup.aggregateRows,
  });
}

async function auditLark(local) {
  const requestMethods = [];
  const client = createLarkBitableClientFromEnv(local.env, {
    onRequest: (event) => requestMethods.push(event?.method ?? event?.stage ?? 'request'),
  });
  const contracts = createWooCommerceLarkSchemaContract();
  const tables = await client.listTables();
  const byId = new Map(tables.map((table) => [table.tableId, table]));
  const byName = new Map(tables.map((table) => [table.name, table]));
  const identities = [];
  const repairs = [];
  for (const contract of contracts) {
    const configuredId = optionalText(local.env[contract.envName]);
    const table = (configuredId ? byId.get(configuredId) : null)
      ?? byName.get(contract.tableName)
      ?? null;
    if (!table?.tableId) {
      repairs.push({ tableKey: contract.tableKey, requirement: 'create_table' });
      continue;
    }
    identities.push([contract.tableKey, table.tableId]);
    const fields = await client.listFields({ tableId: table.tableId });
    const byField = new Map(fields.map((field) => [field.fieldName, field]));
    for (const contractField of contract.fields) {
      const liveField = byField.get(contractField.fieldName);
      if (!liveField) {
        repairs.push({
          tableKey: contract.tableKey,
          fieldName: contractField.fieldName,
          requirement: 'create_field',
        });
        continue;
      }
      if (buildWooCommerceLarkSelectOptionRepair({ contractField, liveField })) {
        repairs.push({
          tableKey: contract.tableKey,
          fieldName: contractField.fieldName,
          requirement: 'select_option_repair',
        });
      }
    }
  }
  if (repairs.length > 0) {
    throw auditError(
      'WooCommerce Lark schema requires mutation before delivery execution',
      'FINAL_DELIVERY_READINESS_LARK_SCHEMA_REPAIR_REQUIRED',
      {
        repairCount: repairs.length,
        repairs: repairs.slice(0, 50),
      },
    );
  }
  remoteReadCount += requestMethods.length;
  return Object.freeze({
    reachable: true,
    tableCount: identities.length,
    schemaRepairRequired: false,
    tableIdentityFingerprint: sha256(JSON.stringify(identities.sort())),
  });
}

async function auditMeta() {
  const clonePath = resolveRequiredPath(
    process.env.MKT_META_FINALIZE_CLONE,
    'MKT_META_FINALIZE_CLONE',
  );
  const sessionPath = resolveRequiredPath(
    process.env.MKT_META_FINALIZE_SESSION_FILE,
    'MKT_META_FINALIZE_SESSION_FILE',
  );
  const overlayPath = resolveRequiredPath(
    process.env.MKT_META_FINALIZE_OVERLAY,
    'MKT_META_FINALIZE_OVERLAY',
  );
  const finalizerPath = resolveRequiredPath(
    process.env.MKT_META_FINALIZER_FILE,
    'MKT_META_FINALIZER_FILE',
  );
  await assertPrivateRegularFile(sessionPath, 'Meta session');
  await assertPrivateRegularFile(overlayPath, 'Meta overlay');
  await assertPrivateRegularFile(finalizerPath, 'Meta finalizer');
  const cloneReal = await realpath(clonePath);
  const branch = gitText(['-C', cloneReal, 'branch', '--show-current']);
  const head = gitText(['-C', cloneReal, 'rev-parse', 'HEAD']);
  const originMain = gitText(['-C', cloneReal, 'rev-parse', 'origin/main']);
  const dirty = gitText([
    '-C', cloneReal,
    'status', '--porcelain', '--untracked-files=all',
  ], false);
  if (branch !== 'main'
    || head !== FINAL_DELIVERY_META_HEAD
    || originMain !== FINAL_DELIVERY_META_HEAD
    || dirty.trim() !== '') {
    throw auditError(
      'Meta pinned clone changed',
      'FINAL_DELIVERY_READINESS_META_CLONE_INVALID',
      { branch, head, originMain, clean: dirty.trim() === '' },
    );
  }
  const sessionBytes = await readFile(sessionPath);
  const session = parseJson(sessionBytes.toString('utf8'), 'Meta session');
  const inspected = inspectMetaSession(session, {
    repositoryHead: FINAL_DELIVERY_META_HEAD,
    operationId: FINAL_DELIVERY_META_OPERATION_ID,
  });
  const finalizerText = await readFile(finalizerPath, 'utf8');
  for (const marker of [
    'mkt_meta_remaining_lanes_finalizer_v1',
    'RUN_AUTHORIZED_META_REMAINING_LANES',
    'META_WIDE_COMPLETED_AND_SAFELY_CLOSED',
  ]) {
    if (!finalizerText.includes(marker)) {
      throw auditError(
        'Meta finalizer contract marker is missing',
        'FINAL_DELIVERY_READINESS_META_FINALIZER_INVALID',
        { marker },
      );
    }
  }
  return Object.freeze({
    ...inspected,
    sessionSha256: digest(sessionBytes),
    overlaySha256: digest(await readFile(overlayPath)),
    finalizerSha256: digest(Buffer.from(finalizerText)),
    clonePath: cloneReal,
    sessionPath,
    overlayPath,
    finalizerPath,
  });
}

async function collectGate(gate, action) {
  try {
    return await action();
  } catch (error) {
    issues.push(safeIssue(gate, error));
    return null;
  }
}

function requireDependency(value, gate) {
  if (!value) throw auditError(
    `Readiness gate is blocked by ${gate}`,
    'FINAL_DELIVERY_READINESS_GATE_DEPENDENCY_BLOCKED',
    { dependency: gate },
  );
}

function runWrangler(local, args, env) {
  const result = spawnSync(local.wranglerExecutable, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw auditError(
      'Pinned Wrangler read-only command failed',
      'FINAL_DELIVERY_READINESS_WRANGLER_FAILED',
      {
        command: args.slice(0, 3).join(' '),
        status: result.status ?? 1,
        stderrSha256: digest(Buffer.from(String(result.stderr ?? ''))),
      },
    );
  }
  remoteReadCount += 1;
  return String(result.stdout ?? '');
}

function readD1Row(local, env, databaseName, sql) {
  const parsed = parseJson(runWrangler(local, [
    'd1', 'execute', databaseName,
    '--remote', '--json',
    '--config', local.configPath,
    '--command', sql,
  ], env), 'D1 read');
  const rows = Array.isArray(parsed)
    ? parsed.flatMap((entry) => entry?.results ?? [])
    : parsed?.results ?? [];
  if (rows.length !== 1) throw auditError(
    'Readiness D1 query returned an unexpected row count',
    'FINAL_DELIVERY_READINESS_D1_ROW_INVALID',
    { rowCount: rows.length },
  );
  return rows[0];
}

async function cloudflareGet(accountId, token, path) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(accountId)}${path}`,
    {
      method: 'GET',
      headers: {
        authorization: `Bearer ${token}`,
        accept: 'application/json',
      },
      redirect: 'error',
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  remoteReadCount += 1;
  if (!response.ok || body?.success !== true) {
    throw auditError(
      'Cloudflare GET-only readiness request failed',
      'FINAL_DELIVERY_READINESS_CLOUDFLARE_READ_FAILED',
      { httpStatus: response.status, errorCodes: readErrorCodes(body) },
    );
  }
  return body;
}

function buildCleanupStateSql() {
  return `SELECT
    (SELECT COUNT(*) FROM raw_commerce_order_items
      WHERE account_key='chemistry_k' AND raw_order_key IN (
        SELECT raw_order_key FROM raw_commerce_orders
        WHERE account_key='chemistry_k' AND source_created_at < ${historyStartMs}
      )) AS old_raw_order_items,
    (SELECT COUNT(*) FROM raw_commerce_refunds
      WHERE account_key='chemistry_k' AND raw_order_key IN (
        SELECT raw_order_key FROM raw_commerce_orders
        WHERE account_key='chemistry_k' AND source_created_at < ${historyStartMs}
      )) AS old_raw_refunds,
    (SELECT COUNT(*) FROM raw_commerce_orders
      WHERE account_key='chemistry_k' AND source_created_at < ${historyStartMs}) AS old_raw_orders,
    (SELECT COUNT(*) FROM commerce_order_status_observations
      WHERE account_key='chemistry_k' AND order_key IN (
        SELECT order_key FROM commerce_order_state
        WHERE account_key='chemistry_k' AND source_created_at < ${historyStartMs}
      )) AS old_order_status_observations,
    (SELECT COUNT(*) FROM commerce_order_line_facts
      WHERE account_key='chemistry_k' AND order_key IN (
        SELECT order_key FROM commerce_order_state
        WHERE account_key='chemistry_k' AND source_created_at < ${historyStartMs}
      )) AS old_order_line_facts,
    (SELECT COUNT(*) FROM commerce_order_state
      WHERE account_key='chemistry_k' AND source_created_at < ${historyStartMs}) AS old_order_state,
    (SELECT COUNT(*) FROM commerce_customer_aggregates
      WHERE account_key='chemistry_k') AS old_customer_aggregates,
    (SELECT COUNT(*) FROM commerce_daily_sales_facts
      WHERE account_key='chemistry_k' AND metric_date < '2026-01-01') AS old_daily,
    (SELECT COUNT(*) FROM commerce_product_daily_facts
      WHERE account_key='chemistry_k' AND metric_date < '2026-01-01') AS old_product_daily,
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status='active') AS active_work,
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status='active' AND work_key='${oldWorkKey}') AS replaced_active_work,
    (SELECT COUNT(*) FROM sync_work_runs
      WHERE lifecycle_status='active' AND work_key<>'${oldWorkKey}') AS other_active_work,
    (SELECT COUNT(*) FROM sync_locks
      WHERE expires_at > unixepoch('now') * 1000) AS active_locks,
    (SELECT lifecycle_status FROM sync_work_runs
      WHERE work_key='${oldWorkKey}') AS replaced_work_status,
    (SELECT status FROM sync_runs
      WHERE sync_run_id='${oldWorkKey}') AS replaced_sync_status,
    (SELECT error_code FROM sync_runs
      WHERE sync_run_id='${oldWorkKey}') AS replaced_sync_error_code;`;
}

function parseSecretNames(output) {
  const parsed = parseJson(output, 'Worker secret list');
  const values = Array.isArray(parsed) ? parsed : parsed?.result ?? parsed?.secrets ?? [];
  return [...new Set((Array.isArray(values) ? values : [])
    .map((item) => item?.name ?? item?.secret_name)
    .filter((name) => typeof name === 'string' && name.trim() !== '')
    .map((name) => name.trim()))].sort();
}

function parseJson(value, label) {
  try {
    return JSON.parse(String(value));
  } catch {
    throw auditError(
      `${label} returned invalid JSON`,
      'FINAL_DELIVERY_READINESS_JSON_INVALID',
      { label },
    );
  }
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) throw auditError(
    'Unsupported readiness audit arguments',
    'FINAL_DELIVERY_READINESS_ARGUMENT_INVALID',
    { unknown },
  );
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: 'mkt_final_delivery_readiness_v1',
    phases: [
      'exact-clean-main-and-private-local-inputs',
      'cloudflare-account-auth-workers-dev-worker-version-secrets-queue-read-only',
      'woocommerce-exact-incident-and-cleanup-d1-read-only',
      'lark-table-and-field-read-only-schema-verification',
      'meta-pinned-clone-session-overlay-finalizer-local-verification',
      'write-mode-0600-expiring-sealed-manifest',
    ],
    remoteMutations: 0,
    providerRequests: 0,
    workerVersionUploads: 0,
    workerDeployments: 0,
    queueMessages: 0,
    d1Mutations: 0,
    larkMutations: 0,
    production: false,
  }, null, 2)}\n`);
}

async function assertPrivateRegularFile(path, label) {
  return assertRegularFile(path, label, { privateFile: true });
}

async function assertRegularFile(path, label, options = {}) {
  const info = await lstat(path).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink()) {
    throw auditError(
      `${label} must be a regular non-symlink file`,
      'FINAL_DELIVERY_READINESS_LOCAL_FILE_INVALID',
      { label },
    );
  }
  if (options.privateFile && (info.mode & 0o077) !== 0) {
    throw auditError(
      `${label} permissions must not grant group or world access`,
      'FINAL_DELIVERY_READINESS_LOCAL_FILE_PERMISSION_INVALID',
      { label, mode: (info.mode & 0o777).toString(8) },
    );
  }
  return info;
}

async function writePrivateJsonAtomic(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function resolveRequiredPath(value, fieldName) {
  return resolve(requireText(value, fieldName));
}

function gitText(args, trim = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) throw auditError(
    'Git readiness command failed',
    'FINAL_DELIVERY_READINESS_GIT_FAILED',
    { command: args.slice(-3).join(' '), status: result.status ?? 1 },
  );
  const output = String(result.stdout ?? '');
  return trim ? output.trim() : output;
}

function compactCloudflareEnv(env) {
  const output = { ...env };
  for (const name of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!optionalText(output[name])) delete output[name];
  }
  return output;
}

function readErrorCodes(body) {
  const errors = Array.isArray(body?.errors) ? body.errors : [];
  return errors
    .map((item) => Number(item?.code))
    .filter((code) => Number.isSafeInteger(code));
}

function safeIssue(gate, error) {
  return Object.freeze({
    gate,
    code: error?.code ?? 'FINAL_DELIVERY_READINESS_GATE_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
  });
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:token|secret|authorization|password|accountId|queueId|subdomain|path)/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) throw auditError(
    `${fieldName} must equal ${expected}`,
    'FINAL_DELIVERY_READINESS_TARGET_INVALID',
    { fieldName },
  );
  return expected;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw auditError(
    `${fieldName} is required`,
    'FINAL_DELIVERY_READINESS_INPUT_REQUIRED',
    { fieldName },
  );
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function digest(value) {
  return createHash('sha256').update(value).digest('hex');
}

function auditError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'FinalDeliveryReadinessAuditError';
  error.code = code;
  error.details = details;
  return error;
}
