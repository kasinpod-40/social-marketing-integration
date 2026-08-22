#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_D1_ONLY_CONFIRMATIONS,
  META_D1_ONLY_OPERATOR_PHASES,
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from './lib/meta-d1-only-rollout-operator.js';
import {
  META_LARK_CONFIRMATIONS,
  META_LARK_OPERATOR_PHASES,
} from './lib/meta-lark-parity-rollout-operator.js';
import {
  META_READ_ONLY_VALIDATION_CONFIRMATIONS,
} from './lib/meta-read-only-validation-operator.js';
import {
  applyMetaHistoryCustomerRuntimeEnvironment,
} from './lib/meta-history-runtime-authority.js';
import {
  createMetaHistoryCloudflarePhaseEnvironment,
  injectMetaHistoryConfig,
} from './lib/meta-history-2026-finalizer.js';
import {
  META_PAID_LARK_CLOSEOUT_CONTRACT_VERSION,
  META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS,
  META_PAID_LARK_CLOSEOUT_TABLE_KEYS,
  buildMetaPaidLarkEnvironment,
  createMetaPaidLarkCloseoutPlan,
  validateMetaPaidLarkCloseoutPlan,
  validateMetaPaidLarkReconciliation,
} from './lib/meta-paid-lark-closeout.js';
import {
  assertWooCommerce2026RemoteSafeFlags,
  selectExactlyOneActiveWorkerVersion,
} from './lib/woocommerce-2026-completion-one-command.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import { discoverWooCommerceQueueId } from './lib/woocommerce-final-queue-discovery.js';

const repositoryRoot = resolve(process.cwd());
const outputRoot = join(repositoryRoot, 'outputs', 'meta-paid-lark-closeout');
const workerName = 'social-mkt-sync-worker';
const databaseName = 'social-mkt-state-dev';
const mainQueueName = 'social-mkt-sync-jobs';
const dlqName = 'social-mkt-sync-dlq';
const retainedForensicWorkKey =
  'meta_ads:chemistry_k2:meta-chemistry_k2-history-20260501-20260731-a22a21bea8ba';
const confirmation = Object.freeze({
  envName: 'CONFIRM_META_PAID_LARK_CLOSEOUT',
  value: 'RUN_META_PAID_LARK_CLOSEOUT',
});
let currentStage = 'init';

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) printPlan();
  else await executeCloseout();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_PAID_LARK_CLOSEOUT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    facebookSyncExecutionCount: 0,
    instagramQueueSendCount: 0,
    scheduleEnabled: false,
    production: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeCloseout() {
  if (process.env[confirmation.envName] !== confirmation.value) {
    throw closeoutError(
      `Paid Meta closeout requires ${confirmation.envName}=${confirmation.value}`,
      'META_PAID_LARK_CLOSEOUT_CONFIRMATION_REQUIRED',
    );
  }

  currentStage = 'exact-clean-main';
  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const branch = gitText(['branch', '--show-current']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || repositoryHead !== originMain || dirty.trim() !== '') {
    throw closeoutError(
      'Paid Meta closeout requires exact clean main equal to origin/main',
      'META_PAID_LARK_CLOSEOUT_REPOSITORY_INVALID',
      { branch, repositoryHead, originMain, clean: dirty.trim() === '' },
    );
  }

  currentStage = 'load-private-runtime';
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  await assertPrivateRegularFile(devVarsPath, 'DEV_VARS_FILE');
  const fileEnv = await readDevVars(devVarsPath);
  const baseEnv = closeExecutionFlags(applyMetaHistoryCustomerRuntimeEnvironment({
    ...fileEnv,
    ...process.env,
    DEV_VARS_FILE: devVarsPath,
  }));
  requireExact(baseEnv.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(baseEnv.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(baseEnv.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  currentStage = 'persist-plan';
  const evidenceRoot = join(outputRoot, repositoryHead);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const planPath = join(evidenceRoot, 'runtime-plan.json');
  const plan = await loadOrCreatePlan(planPath, repositoryHead);

  currentStage = 'materialize-private-safe-config';
  const sourceConfigPath = resolve(
    baseEnv.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? baseEnv.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  const sourceConfigText = await readRegularSourceText(sourceConfigPath, 'Meta Wrangler config');
  const configPath = join(evidenceRoot, 'wrangler.meta-paid-lark.safe.jsonc');
  const safeConfigText = injectMetaHistoryConfig(sourceConfigText, undefined, {
    baseDirectory: repositoryRoot,
  });
  await writePrivateText(configPath, safeConfigText);

  currentStage = 'resolve-safe-runtime';
  const cloudflare = await resolveCloudflareContext(baseEnv, configPath);
  await assertRemoteSafe(baseEnv, configPath, cloudflare);

  currentStage = 'fresh-read-only-validation';
  const readOnlySummaryPath = await runFreshReadOnlyValidation(
    baseEnv,
    join(evidenceRoot, 'read-only-validation'),
  );
  await assertRemoteSafe(baseEnv, configPath, cloudflare);

  const completed = [];
  for (const operation of plan.operations) {
    currentStage = `d1-${operation.target}`;
    await assertRemoteSafe(baseEnv, configPath, cloudflare, {
      allowOperationWorkKey: workKey(operation),
    });
    const d1Root = join(
      repositoryRoot,
      'outputs',
      'meta-d1-only-rollout',
      operation.target,
      operation.operationId,
    );
    const d1SummaryPath = join(d1Root, 'summary.json');
    if (!(await fileExists(d1SummaryPath))) {
      const activeVersion = await readActiveVersion(baseEnv, configPath);
      const env = d1Environment({
        baseEnv,
        operation,
        repositoryHead,
        configPath,
        readOnlySummaryPath,
        activeVersion,
        cloudflare,
      });
      await runPhaseChain({
        kind: 'd1',
        phases: META_D1_ONLY_OPERATOR_PHASES.slice(1),
        confirmations: META_D1_ONLY_CONFIRMATIONS,
        launcher: 'scripts/meta-d1-only-rollout-launcher.mjs',
        evidenceRoot: d1Root,
        env,
      });
    }
    const d1Summary = JSON.parse(await readFile(d1SummaryPath, 'utf8'));
    if (d1Summary?.data?.accepted !== true
      || d1Summary?.data?.d1OnlyVerified !== true
      || d1Summary?.data?.idempotentRerunVerified !== true
      || d1Summary?.data?.restoredAllFalse !== true
      || Number(d1Summary?.data?.larkMutationCount) !== 0) {
      throw closeoutError(
        'Paid Meta D1-only summary is not accepted',
        'META_PAID_LARK_CLOSEOUT_D1_INVALID',
        { target: operation.target, operationId: operation.operationId },
      );
    }

    currentStage = `lark-${operation.target}`;
    await assertRemoteSafe(baseEnv, configPath, cloudflare, {
      allowOperationWorkKey: workKey(operation),
    });
    const larkRoot = join(
      repositoryRoot,
      'outputs',
      'meta-lark-parity-rollout',
      operation.target,
      operation.operationId,
    );
    const larkSummaryPath = join(larkRoot, 'summary.json');
    if (!(await fileExists(larkSummaryPath))) {
      const activeVersion = await readActiveVersion(baseEnv, configPath);
      const env = larkEnvironment({
        baseEnv,
        operation,
        repositoryHead,
        configPath,
        readOnlySummaryPath,
        activeVersion,
        cloudflare,
        d1SummaryPath,
      });
      await runPhaseChain({
        kind: 'lark',
        phases: META_LARK_OPERATOR_PHASES.slice(1),
        confirmations: META_LARK_CONFIRMATIONS,
        launcher: 'scripts/meta-lark-parity-rollout-launcher.mjs',
        evidenceRoot: larkRoot,
        env,
      });
    }

    const larkSummary = JSON.parse(await readFile(larkSummaryPath, 'utf8'));
    if (larkSummary?.data?.accepted !== true
      || larkSummary?.data?.larkParityVerified !== true
      || larkSummary?.data?.idempotentRerunVerified !== true
      || larkSummary?.data?.restoredAllFalse !== true
      || Number(larkSummary?.data?.providerRequestCount) !== 0
      || Number(larkSummary?.data?.scheduleActivationCount) !== 0) {
      throw closeoutError(
        'Paid Meta Lark summary is not accepted',
        'META_PAID_LARK_CLOSEOUT_LARK_INVALID',
        { target: operation.target, operationId: operation.operationId },
      );
    }
    const verification = JSON.parse(await readFile(join(larkRoot, 'verify-lark.json'), 'utf8'));
    const reconciliation = validateMetaPaidLarkReconciliation(verification, operation);
    completed.push(Object.freeze({
      target: operation.target,
      operationId: operation.operationId,
      periodStart: operation.periodStart,
      periodEnd: operation.periodEnd,
      d1Completed: true,
      larkCompleted: true,
      idempotentRerunVerified: true,
      larkTableKeys: reconciliation.larkTableKeys,
      excludedLarkTableKeys: reconciliation.excludedLarkTableKeys,
    }));
    await assertRemoteSafe(baseEnv, configPath, cloudflare);
  }

  currentStage = 'final-safe-readback';
  const safe = await assertRemoteSafe(baseEnv, configPath, cloudflare);
  const summary = {
    ok: true,
    accepted: completed.length === 2
      && completed.every((item) => item.d1Completed && item.larkCompleted && item.idempotentRerunVerified),
    contractVersion: META_PAID_LARK_CLOSEOUT_CONTRACT_VERSION,
    repositoryHead,
    operations: completed,
    larkTableKeys: [...META_PAID_LARK_CLOSEOUT_TABLE_KEYS],
    excludedLarkTableKeys: [...META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS],
    instagramMode: 'verify_only_no_queue_send',
    instagramQueueSendCount: 0,
    facebookMode: 'excluded_no_sync_no_queue_send',
    facebookSyncExecutionCount: 0,
    excludedPaidLarkWriteCount: 0,
    executionFlagsAllFalse: safe.executionFlagsAllFalse,
    remote: safe.remote,
    scheduleEnabled: false,
    production: false,
    marker: 'META_PAID_LARK_CLOSEOUT_COMPLETED_SAFE',
  };
  if (!summary.accepted || !summary.executionFlagsAllFalse) {
    throw closeoutError('Paid Meta closeout summary is incomplete', 'META_PAID_LARK_CLOSEOUT_SUMMARY_INVALID');
  }
  await writePrivateJson(join(evidenceRoot, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidenceRoot }, null, 2)}\n`);
  process.stdout.write('META_PAID_LARK_CLOSEOUT_COMPLETED_SAFE\n');
}

async function runPhaseChain({ kind, phases, confirmations, launcher, evidenceRoot, env }) {
  const restorePhase = 'restore-all-false';
  const verifyRestorePhase = 'verify-restore';
  const summaryPhase = 'summary';
  const latePhase = 'verify-late-completion';
  const beforeRestore = phases.filter((phase) => ![
    restorePhase,
    verifyRestorePhase,
    summaryPhase,
    latePhase,
  ].includes(phase));
  let failure = null;
  try {
    for (const phase of beforeRestore) {
      const path = join(evidenceRoot, `${phase}.json`);
      if (await fileExists(path)) continue;
      if ((phase === 'send-one-d1-only'
        || phase === 'send-lark-continuation'
        || phase === 'resend-same-operation')
        && await fileExists(join(evidenceRoot, `${phase}.attempt.json`))) {
        throw closeoutError(
          'Queue acceptance is uncertain; blind resend is blocked',
          'META_PAID_LARK_CLOSEOUT_QUEUE_ACCEPTANCE_UNCERTAIN',
          { kind, phase },
        );
      }
      runOperatorPhase(launcher, phase, confirmations[phase], env);
    }
  } catch (error) {
    failure = error;
  }

  const activated = await fileExists(join(evidenceRoot, kind === 'd1'
    ? 'deploy-d1-only-gates.json'
    : 'deploy-lark-gates.json'));
  if (activated) {
    if (!(await fileExists(join(evidenceRoot, `${restorePhase}.json`)))) {
      runOperatorPhase(launcher, restorePhase, confirmations[restorePhase], env);
    }
    if (!(await fileExists(join(evidenceRoot, `${verifyRestorePhase}.json`)))) {
      runOperatorPhase(launcher, verifyRestorePhase, confirmations[verifyRestorePhase], env);
    }
  }
  if (failure) throw failure;
  if (!(await fileExists(join(evidenceRoot, `${summaryPhase}.json`)))) {
    runOperatorPhase(launcher, summaryPhase, confirmations[summaryPhase], env);
  }
}

function runOperatorPhase(launcher, phase, phaseConfirmation, env) {
  const phaseEnv = { ...env };
  if (phaseConfirmation) phaseEnv[phaseConfirmation.envName] = phaseConfirmation.value;
  runVisible(process.execPath, [launcher, `--phase=${phase}`, '--execute'], phaseEnv);
}

async function runFreshReadOnlyValidation(baseEnv, evidenceRoot) {
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  for (const phase of [
    'preflight',
    'facebook',
    'instagram',
    'meta-ads-chemistry-k2',
    'meta-ads-chemistry-k3',
    'summary',
  ]) {
    const path = join(evidenceRoot, `${phase}.json`);
    if (await fileExists(path)) continue;
    const phaseConfirmation = META_READ_ONLY_VALIDATION_CONFIRMATIONS[phase];
    runVisible(process.execPath, [
      'scripts/meta-read-only-validation-operator.mjs',
      `--phase=${phase}`,
      '--execute',
    ], {
      ...baseEnv,
      MKT_META_READ_ONLY_EVIDENCE_DIR: evidenceRoot,
      [phaseConfirmation.envName]: phaseConfirmation.value,
    });
  }
  const summaryPath = join(evidenceRoot, 'summary.json');
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  if (summary?.details?.accepted !== true
    || Number(summary?.details?.validationCount) !== 4
    || summary?.mutationPerformed !== false
    || Number(summary?.businessWrites) !== 0
    || Number(summary?.queueMessages) !== 0) {
    throw closeoutError(
      'Fresh Meta read-only validation is not accepted',
      'META_PAID_LARK_CLOSEOUT_READ_ONLY_INVALID',
    );
  }
  return summaryPath;
}

function d1Environment({
  baseEnv,
  operation,
  repositoryHead,
  configPath,
  readOnlySummaryPath,
  activeVersion,
  cloudflare,
}) {
  return {
    ...createMetaHistoryCloudflarePhaseEnvironment(baseEnv, cloudflare),
    MKT_META_D1_ONLY_QUEUE_ID: cloudflare.queueId,
    MKT_META_D1_ONLY_TARGET: operation.target,
    MKT_META_D1_ONLY_REPOSITORY_HEAD: repositoryHead,
    MKT_META_D1_ONLY_OPERATION_ID: operation.operationId,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: operation.originalRequestedAt,
    MKT_META_D1_ONLY_PERIOD_START: operation.periodStart,
    MKT_META_D1_ONLY_PERIOD_END: operation.periodEnd,
    MKT_META_D1_ONLY_ACCOUNT_KEY: 'chemistry_k',
    MKT_META_D1_ONLY_WORKER_NAME: workerName,
    MKT_META_D1_ONLY_DATABASE_NAME: databaseName,
    MKT_META_D1_ONLY_MAIN_QUEUE: mainQueueName,
    MKT_META_D1_ONLY_DLQ: dlqName,
    MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION: activeVersion,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: configPath,
    MKT_META_D1_ONLY_READ_ONLY_SUMMARY: readOnlySummaryPath,
  };
}

function larkEnvironment({
  baseEnv,
  operation,
  repositoryHead,
  configPath,
  readOnlySummaryPath,
  activeVersion,
  cloudflare,
  d1SummaryPath,
}) {
  return buildMetaPaidLarkEnvironment({
    ...createMetaHistoryCloudflarePhaseEnvironment(baseEnv, cloudflare),
    MKT_META_LARK_QUEUE_ID: cloudflare.queueId,
    MKT_META_LARK_REPOSITORY_HEAD: repositoryHead,
    MKT_META_LARK_ACCOUNT_KEY: 'chemistry_k',
    MKT_META_LARK_WORKER_NAME: workerName,
    MKT_META_LARK_DATABASE_NAME: databaseName,
    MKT_META_LARK_MAIN_QUEUE: mainQueueName,
    MKT_META_LARK_DLQ: dlqName,
    MKT_META_LARK_EXPECTED_ACTIVE_VERSION: activeVersion,
    MKT_META_LARK_WRANGLER_CONFIG: configPath,
    MKT_META_LARK_READ_ONLY_SUMMARY: readOnlySummaryPath,
    MKT_META_LARK_D1_SUMMARY: d1SummaryPath,
  }, operation);
}

async function resolveCloudflareContext(env, configPath) {
  const configText = await readFile(configPath, 'utf8');
  let accountId;
  try {
    accountId = resolveCloudflareAccountId({
      explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
      configText,
      whoamiOutput: null,
      preferredAccount: env.MKT_WOOCOMMERCE_ROLLOUT_ACCOUNT,
    });
  } catch (error) {
    if (error?.code !== 'WOOCOMMERCE_FINAL_WHOAMI_JSON_INVALID') throw error;
    accountId = resolveCloudflareAccountId({
      explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
      configText,
      whoamiOutput: runText('npx', ['wrangler', 'whoami', '--json'], env),
      preferredAccount: env.MKT_WOOCOMMERCE_ROLLOUT_ACCOUNT,
    });
  }
  const explicitToken = optionalText(env.CLOUDFLARE_API_TOKEN);
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: explicitToken,
    authOutput: explicitToken ? null : runText('npx', ['wrangler', 'auth', 'token', '--json'], env),
  });
  const queueId = await discoverWooCommerceQueueId({
    accountId,
    apiToken: auth.token,
    queueName: mainQueueName,
  });
  return Object.freeze({
    accountId,
    apiToken: auth.token,
    authSource: auth.source,
    queueId,
  });
}

async function assertRemoteSafe(env, configPath, cloudflare, options = {}) {
  const activeVersion = await readActiveVersion(env, configPath);
  const version = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', activeVersion,
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], { ...env, CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId }));
  assertWooCommerce2026RemoteSafeFlags(version);
  const allowedWork = options.allowOperationWorkKey
    ? ` AND work_key <> ${sqlText(options.allowOperationWorkKey)}`
    : '';
  const allowedJoinedWork = options.allowOperationWorkKey
    ? ` AND w.work_key <> ${sqlText(options.allowOperationWorkKey)}`
    : '';
  const row = readD1Row(env, configPath, `SELECT
    (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active'
      AND work_key <> ${sqlText(retainedForensicWorkKey)}${allowedWork}) AS active_work,
    (SELECT COUNT(*) FROM sync_locks WHERE expires_at > (unixepoch() * 1000)) AS active_locks,
    (SELECT COUNT(DISTINCT q.operation_id) FROM queue_operation_attempts q
      JOIN sync_work_runs w ON w.work_key = q.work_key
      WHERE w.lifecycle_status = 'active'
        AND w.work_key <> ${sqlText(retainedForensicWorkKey)}${allowedJoinedWork}) AS active_queue_operations;`);
  const remote = Object.freeze({
    activeWork: Number(row.active_work ?? 0),
    activeLocks: Number(row.active_locks ?? 0),
    activeQueueOperations: Number(row.active_queue_operations ?? 0),
  });
  if (Object.values(remote).some((value) => value !== 0)) {
    throw closeoutError(
      'Remote Reliability state is not idle',
      'META_PAID_LARK_CLOSEOUT_REMOTE_NOT_IDLE',
      remote,
    );
  }
  return Object.freeze({ executionFlagsAllFalse: true, activeVersion, remote });
}

async function readActiveVersion(env, configPath) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status',
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], env));
  return selectExactlyOneActiveWorkerVersion(Array.isArray(value) ? value[0] : value);
}

function readD1Row(env, configPath, sql) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB',
    '--remote',
    '--json',
    '--config', configPath,
    '--command', sql,
  ], env));
  const row = Array.isArray(value)
    ? value.flatMap((entry) => entry?.results ?? [])[0]
    : value?.results?.[0];
  if (!row) {
    throw closeoutError(
      'Remote D1 query returned no row',
      'META_PAID_LARK_CLOSEOUT_D1_QUERY_EMPTY',
    );
  }
  return row;
}

async function loadOrCreatePlan(path, repositoryHead) {
  if (await fileExists(path)) {
    return validateMetaPaidLarkCloseoutPlan(
      JSON.parse(await readFile(path, 'utf8')),
      repositoryHead,
    );
  }
  const plan = createMetaPaidLarkCloseoutPlan(repositoryHead);
  await writePrivateJson(path, plan);
  return plan;
}

function closeExecutionFlags(env) {
  const result = { ...env };
  for (const key of Object.keys(result)) {
    if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) result[key] = 'false';
  }
  for (const key of META_D1_ONLY_REQUIRED_FALSE_FLAGS) result[key] = 'false';
  return Object.freeze(result);
}

function workKey(operation) {
  return `meta_ads:${operation.target}:${operation.operationId}`;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw closeoutError(
      'Unsupported paid Meta closeout arguments',
      'META_PAID_LARK_CLOSEOUT_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  const head = gitText(['rev-parse', 'HEAD']);
  const plan = createMetaPaidLarkCloseoutPlan(head, Date.UTC(2026, 7, 22, 0, 0, 0));
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: META_PAID_LARK_CLOSEOUT_CONTRACT_VERSION,
    confirmation: `${confirmation.envName}=${confirmation.value}`,
    repositoryHead: head,
    targets: plan.operations.map((item) => item.target),
    periodStart: plan.operations[0].periodStart,
    periodEnd: plan.operations[0].periodEnd,
    operationIds: plan.operations.map((item) => item.operationId),
    larkTableKeys: [...META_PAID_LARK_CLOSEOUT_TABLE_KEYS],
    excludedLarkTableKeys: [...META_PAID_LARK_CLOSEOUT_EXCLUDED_TABLE_KEYS],
    facebookSyncExecutionCount: 0,
    instagramQueueSendCount: 0,
    freshReadOnlyIdentityValidation: true,
    d1BeforeLark: true,
    idempotentRerunRequired: true,
    automaticAllFalseRestore: true,
    scheduleEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

function runVisible(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw closeoutError(
      `Required command failed: ${command} ${args.join(' ')}`,
      'META_PAID_LARK_CLOSEOUT_COMMAND_FAILED',
      { command, exitCode: result.status ?? 1 },
    );
  }
}

function runText(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw closeoutError(
      `Command failed: ${command} ${args.join(' ')}`,
      'META_PAID_LARK_CLOSEOUT_COMMAND_FAILED',
      { command, exitCode: result.status ?? 1 },
    );
  }
  return String(result.stdout ?? '').trim();
}

function gitText(args, trim = true) {
  const output = runText('git', args, process.env);
  return trim ? output.trim() : `${output}\n`;
}

async function assertPrivateRegularFile(path, label) {
  const info = await lstat(path).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw closeoutError(
      `${label} must be a private regular non-symlink file`,
      'META_PAID_LARK_CLOSEOUT_PRIVATE_FILE_INVALID',
      { label },
    );
  }
}

async function readRegularSourceText(path, label) {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) {
    throw closeoutError(
      `${label} must resolve to a readable regular file`,
      'META_PAID_LARK_CLOSEOUT_SOURCE_FILE_INVALID',
      { label },
    );
  }
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw closeoutError(
      `${label} must resolve to a readable regular file`,
      'META_PAID_LARK_CLOSEOUT_SOURCE_FILE_INVALID',
      { label },
    );
  }
}

async function writePrivateJson(path, value) {
  await writePrivateText(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writePrivateText(path, text) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, text, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function fileExists(path) {
  return stat(path).then((info) => info.isFile() || info.isDirectory()).catch(() => false);
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value.trim() || null : String(value);
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw closeoutError(
      `${fieldName} must equal ${expected}`,
      'META_PAID_LARK_CLOSEOUT_ENV_INVALID',
      { fieldName },
    );
  }
}

function sqlText(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function closeoutError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidLarkCloseoutError';
  error.code = code;
  error.details = details;
  return error;
}