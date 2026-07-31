#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from './lib/meta-d1-only-rollout-operator.js';
import {
  META_HISTORY_EXACT_CONTINUATION_CONFIRMATION,
  META_HISTORY_EXACT_CONTINUATION_CRITICAL_PATHS,
  META_HISTORY_EXACT_CONTINUATION_TARGET,
  assertMetaHistoryExactContinuationConfirmation,
  validateMetaHistoryExactContinuationDelta,
  validateMetaHistoryExactContinuationPlan,
  validateStableMetaHistoryFacebookBoundary,
} from './lib/meta-history-exact-plan-continuation.js';
import {
  validateMetaHistory2026Summary,
  readMetaLarkSummaryCompletion,
} from './lib/meta-history-2026-finalizer.js';
import {
  applyMetaHistoryCustomerRuntimeEnvironment,
} from './lib/meta-history-runtime-authority.js';
import {
  META_LARK_CONFIRMATIONS,
  META_LARK_OPERATOR_PHASES,
  buildMetaLarkSnapshotSql,
  validateMetaD1OnlySummaryForLark,
} from './lib/meta-lark-parity-rollout-operator.js';
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
const workerName = 'social-mkt-sync-worker';
const databaseName = 'social-mkt-state-dev';
const mainQueueName = 'social-mkt-sync-jobs';
const dlqName = 'social-mkt-sync-dlq';
const target = META_HISTORY_EXACT_CONTINUATION_TARGET;
let stage = 'init';
let isolatedRoot = null;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) printPlan();
  else await executeContinuation();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'META_HISTORY_EXACT_CONTINUATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (isolatedRoot) await cleanupIsolatedClone(isolatedRoot);
}

async function executeContinuation() {
  assertMetaHistoryExactContinuationConfirmation(process.env);

  stage = 'exact-clean-current-main';
  const currentHead = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const branch = gitText(['branch', '--show-current']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || currentHead !== originMain || dirty.trim() !== '') {
    throw continuationError(
      'Exact-plan continuation requires clean current main equal to origin/main',
      'META_HISTORY_EXACT_CONTINUATION_REPOSITORY_INVALID',
      { branch, currentHead, originMain, clean: dirty.trim() === '' },
    );
  }
  if (!gitSuccess(['merge-base', '--is-ancestor', target.repositoryHead, currentHead])) {
    throw continuationError(
      'Retained Meta Head is not an ancestor of current main',
      'META_HISTORY_EXACT_CONTINUATION_ANCESTRY_INVALID',
    );
  }
  const changedPaths = gitText([
    'diff', '--name-only', `${target.repositoryHead}..${currentHead}`,
  ]).split('\n').filter(Boolean);
  const repositoryDelta = validateMetaHistoryExactContinuationDelta(changedPaths);
  const criticalDrift = gitText([
    'diff', '--name-only', `${target.repositoryHead}..${currentHead}`, '--',
    ...META_HISTORY_EXACT_CONTINUATION_CRITICAL_PATHS,
  ]).split('\n').filter(Boolean);
  if (criticalDrift.length > 0) {
    throw continuationError(
      'Meta continuation-critical Source changed after the retained operation Head',
      'META_HISTORY_EXACT_CONTINUATION_CRITICAL_DRIFT',
      { criticalDrift },
    );
  }

  stage = 'load-retained-evidence';
  const targetRoot = join(repositoryRoot, 'outputs', 'meta-history-2026', target.repositoryHead);
  const runtimePlanPath = join(targetRoot, 'runtime-plan.json');
  const safeConfigPath = join(targetRoot, 'wrangler.meta-history.safe.jsonc');
  const readOnlySummaryPath = join(targetRoot, 'read-only-validation', 'summary.json');
  const d1Root = join(
    repositoryRoot,
    'outputs',
    'meta-d1-only-rollout',
    target.target,
    target.operationId,
  );
  const d1SummaryPath = join(d1Root, 'summary.json');
  const larkBaseRoot = join(repositoryRoot, 'outputs', 'meta-lark-parity-rollout');
  const larkRoot = join(larkBaseRoot, target.target, target.operationId);
  const finalSummaryPath = join(targetRoot, 'meta-history-2026-summary.json');

  for (const [fieldName, path] of Object.entries({
    runtimePlanPath,
    safeConfigPath,
    readOnlySummaryPath,
    d1SummaryPath,
  })) {
    await assertRegularFile(path, fieldName);
  }
  const plan = JSON.parse(await readFile(runtimePlanPath, 'utf8'));
  const operation = validateMetaHistoryExactContinuationPlan(plan);
  const d1Summary = JSON.parse(await readFile(d1SummaryPath, 'utf8'));
  const acceptedD1 = validateMetaD1OnlySummaryForLark(d1Summary, {
    targetKey: target.target,
    operationId: target.operationId,
  });

  stage = 'load-private-runtime';
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  await assertPrivateRegularFile(devVarsPath, 'DEV_VARS_FILE');
  const fileEnv = await readDevVars(devVarsPath);
  const baseEnv = buildSafeEnvironment({
    ...fileEnv,
    ...process.env,
    DEV_VARS_FILE: devVarsPath,
  });
  const sourceConfigPath = resolve(
    baseEnv.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? baseEnv.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  await assertPrivateRegularFile(sourceConfigPath, 'Meta source Wrangler config');
  const safeConfigText = await readFile(safeConfigPath, 'utf8');

  stage = 'cloudflare-read-only-context';
  const cloudflare = await resolveCloudflareContext(baseEnv, safeConfigText);
  const queueId = await discoverWooCommerceQueueId({
    accountId: cloudflare.accountId,
    apiToken: cloudflare.apiToken,
    queueName: mainQueueName,
  });
  const activeVersion = readActiveVersion(baseEnv, safeConfigPath, cloudflare.accountId);
  const activeVersionView = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', activeVersion,
    '--name', workerName,
    '--config', safeConfigPath,
    '--json',
  ], { ...baseEnv, CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId }));
  assertWooCommerce2026RemoteSafeFlags(activeVersionView);

  stage = 'remote-facebook-boundary-stability';
  const snapshotSql = buildMetaLarkSnapshotSql({
    workKey: target.workKey,
    syncRunId: target.syncRunId,
    operationId: target.operationId,
    platform: 'facebook',
    accountKey: 'chemistry_k',
    customerKey: 'chemistry_k',
  });
  const firstBoundary = readD1Row(baseEnv, safeConfigPath, snapshotSql);
  await sleep(5_000);
  const secondBoundary = readD1Row(baseEnv, safeConfigPath, snapshotSql);
  const stableBoundary = validateStableMetaHistoryFacebookBoundary(
    firstBoundary,
    secondBoundary,
  );

  stage = 'prepare-isolated-retained-head';
  const isolated = await prepareIsolatedClone({
    sourceConfigPath,
    targetRoot,
  });
  isolatedRoot = isolated.root;

  const larkEnv = {
    ...baseEnv,
    DEV_VARS_FILE: devVarsPath,
    CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId,
    CLOUDFLARE_API_TOKEN: cloudflare.apiToken,
    MKT_META_LARK_QUEUE_ID: queueId,
    MKT_META_LARK_TARGET: operation.target,
    MKT_META_LARK_REPOSITORY_HEAD: target.repositoryHead,
    MKT_META_LARK_OPERATION_ID: operation.operationId,
    MKT_META_LARK_ORIGINAL_REQUESTED_AT: operation.originalRequestedAt,
    MKT_META_LARK_PERIOD_START: operation.periodStart,
    MKT_META_LARK_PERIOD_END: operation.periodEnd,
    MKT_META_LARK_ACCOUNT_KEY: 'chemistry_k',
    MKT_META_LARK_WORKER_NAME: workerName,
    MKT_META_LARK_DATABASE_NAME: databaseName,
    MKT_META_LARK_MAIN_QUEUE: mainQueueName,
    MKT_META_LARK_DLQ: dlqName,
    MKT_META_LARK_EXPECTED_ACTIVE_VERSION: activeVersion,
    MKT_META_LARK_WRANGLER_CONFIG: isolated.safeConfigRelativePath,
    MKT_META_LARK_READ_ONLY_SUMMARY: readOnlySummaryPath,
    MKT_META_LARK_D1_SUMMARY: d1SummaryPath,
    MKT_META_LARK_EVIDENCE_DIR: larkBaseRoot,
  };

  stage = 'continue-facebook-lark-same-operation';
  await runLarkPhaseChain({
    cloneRoot: isolated.cloneRoot,
    evidenceRoot: larkRoot,
    env: larkEnv,
  });
  const larkSummaryPath = join(larkRoot, 'summary.json');
  await assertRegularFile(larkSummaryPath, 'Facebook Lark summary');
  const larkSummary = JSON.parse(await readFile(larkSummaryPath, 'utf8'));
  const larkCompletion = readMetaLarkSummaryCompletion(larkSummary);
  if (larkSummary?.data?.accepted !== true
    || !larkCompletion.larkCompleted
    || !larkCompletion.idempotentRerunVerified) {
    throw continuationError(
      'Facebook Lark continuation summary is not accepted',
      'META_HISTORY_EXACT_CONTINUATION_LARK_SUMMARY_INVALID',
    );
  }

  stage = 'resume-retained-meta-plan';
  const finalEnv = {
    ...baseEnv,
    DEV_VARS_FILE: devVarsPath,
    CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId,
    CLOUDFLARE_API_TOKEN: cloudflare.apiToken,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    CONFIRM_META_HISTORY_2026_FINALIZER: 'RUN_META_HISTORY_2026_ONE_COMMAND',
  };
  runVisible(
    process.execPath,
    ['scripts/meta-history-2026-one-command.mjs', '--execute'],
    finalEnv,
    isolated.cloneRoot,
  );

  stage = 'verify-final-safe-summary';
  await assertRegularFile(finalSummaryPath, 'Meta history final summary');
  const finalSummary = JSON.parse(await readFile(finalSummaryPath, 'utf8'));
  validateMetaHistory2026Summary(finalSummary);
  if (finalSummary.decision !== 'META_HISTORY_2026_COMPLETED_SAFE'
    || finalSummary.repositoryHead !== target.repositoryHead) {
    throw continuationError(
      'Retained Meta plan did not reach the accepted final safe decision',
      'META_HISTORY_EXACT_CONTINUATION_FINAL_SUMMARY_INVALID',
    );
  }

  process.stdout.write(`${JSON.stringify({
    ok: true,
    accepted: true,
    decision: 'META_HISTORY_2026_EXACT_PLAN_CONTINUATION_COMPLETED_SAFE',
    retainedRepositoryHead: target.repositoryHead,
    currentRepositoryHead: currentHead,
    operationId: target.operationId,
    originalRequestedAt: target.originalRequestedAt,
    d1SummarySha256: acceptedD1.d1SummarySha256,
    remoteBoundaryFingerprint: stableBoundary.fingerprint,
    repositoryDelta,
    providerReplayForFacebook: false,
    d1QueueResendForFacebook: false,
    facebookLarkCompleted: true,
    finalDecision: finalSummary.decision,
    executionFlagsAllFalse: finalSummary.executionFlagsAllFalse === true,
    activeWork: Number(finalSummary.remote?.activeWork ?? -1),
    activeLocks: Number(finalSummary.remote?.activeLocks ?? -1),
    activeQueueOperations: Number(finalSummary.remote?.activeQueueOperations ?? -1),
    scheduleEnabled: false,
    production: 'BLOCKED',
    evidenceRoot: targetRoot,
  }, null, 2)}\n`);
  process.stdout.write('META_HISTORY_2026_EXACT_PLAN_CONTINUATION_COMPLETED_SAFE\n');
}

async function runLarkPhaseChain({ cloneRoot, evidenceRoot, env }) {
  const restorePhase = 'restore-all-false';
  const verifyRestorePhase = 'verify-restore';
  const summaryPhase = 'summary';
  const executable = META_LARK_OPERATOR_PHASES
    .slice(1)
    .filter((phase) => ![restorePhase, verifyRestorePhase, summaryPhase].includes(phase));
  let failureError = null;
  try {
    for (const phase of executable) {
      const evidencePath = join(evidenceRoot, `${phase}.json`);
      if (await fileExists(evidencePath)) continue;
      if (['send-lark-continuation', 'resend-same-operation'].includes(phase)
        && await fileExists(join(evidenceRoot, `${phase}.attempt.json`))) {
        throw continuationError(
          'Lark Queue acceptance is uncertain; blind resend is blocked',
          'META_HISTORY_EXACT_CONTINUATION_QUEUE_ACCEPTANCE_UNCERTAIN',
          { phase },
        );
      }
      runLarkPhase(cloneRoot, phase, env);
    }
  } catch (error) {
    failureError = error;
  }

  const activated = await fileExists(join(evidenceRoot, 'deploy-lark-gates.json'));
  if (activated) {
    if (!(await fileExists(join(evidenceRoot, `${restorePhase}.json`)))) {
      runLarkPhase(cloneRoot, restorePhase, env);
    }
    if (!(await fileExists(join(evidenceRoot, `${verifyRestorePhase}.json`)))) {
      runLarkPhase(cloneRoot, verifyRestorePhase, env);
    }
  }
  if (failureError) throw failureError;
  if (!(await fileExists(join(evidenceRoot, `${summaryPhase}.json`)))) {
    runLarkPhase(cloneRoot, summaryPhase, env);
  }
}

function runLarkPhase(cloneRoot, phase, env) {
  const confirmation = META_LARK_CONFIRMATIONS[phase];
  const phaseEnv = {
    ...env,
    ...(confirmation ? { [confirmation.envName]: confirmation.value } : {}),
  };
  runVisible(
    process.execPath,
    ['scripts/meta-lark-parity-rollout-launcher.mjs', `--phase=${phase}`, '--execute'],
    phaseEnv,
    cloneRoot,
  );
}

async function prepareIsolatedClone({ sourceConfigPath, targetRoot }) {
  const root = await mkdtemp(join(tmpdir(), 'meta-history-exact-continuation-'));
  const cloneRoot = join(root, 'repository');
  runRequired('git', ['clone', '--no-hardlinks', '--no-checkout', repositoryRoot, cloneRoot]);
  runRequired('git', ['update-ref', 'refs/remotes/origin/main', target.repositoryHead], process.env, cloneRoot);
  runRequired('git', ['checkout', '-B', 'main', target.repositoryHead], process.env, cloneRoot);

  const originalOutputs = join(repositoryRoot, 'outputs');
  await mkdir(originalOutputs, { recursive: true, mode: 0o700 });
  await symlink(originalOutputs, join(cloneRoot, 'outputs'), 'dir');
  await copyFile(sourceConfigPath, join(cloneRoot, 'wrangler.sync.jsonc'));
  await chmod(join(cloneRoot, 'wrangler.sync.jsonc'), 0o600);
  runVisible('npm', ['ci'], process.env, cloneRoot);

  const clean = gitText(['status', '--porcelain', '--untracked-files=all'], false, cloneRoot);
  const head = gitText(['rev-parse', 'HEAD'], true, cloneRoot);
  const originMain = gitText(['rev-parse', 'origin/main'], true, cloneRoot);
  const branch = gitText(['branch', '--show-current'], true, cloneRoot);
  if (clean.trim() !== ''
    || head !== target.repositoryHead
    || originMain !== target.repositoryHead
    || branch !== 'main') {
    throw continuationError(
      'Isolated retained-Head clone is not exact and clean',
      'META_HISTORY_EXACT_CONTINUATION_ISOLATED_CLONE_INVALID',
      { clean: clean.trim() === '', head, originMain, branch },
    );
  }

  const safeConfigPath = join(targetRoot, 'wrangler.meta-history.safe.jsonc');
  return {
    root,
    cloneRoot,
    safeConfigRelativePath: relative(cloneRoot, join(cloneRoot, 'outputs',
      'meta-history-2026', target.repositoryHead, 'wrangler.meta-history.safe.jsonc')),
    safeConfigPath,
  };
}

async function cleanupIsolatedClone(root) {
  try {
    const cloneRoot = join(root, 'repository');
    if (await fileExists(cloneRoot)) {
      runRequired('git', ['worktree', 'prune'], process.env, repositoryRoot, false);
    }
  } catch {
    // Cleanup must not replace the retained execution result.
  }
  await rm(root, { recursive: true, force: true });
}

function buildSafeEnvironment(env = {}) {
  const result = { ...applyMetaHistoryCustomerRuntimeEnvironment(env) };
  for (const key of Object.keys(result)) {
    if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) result[key] = 'false';
  }
  for (const key of META_D1_ONLY_REQUIRED_FALSE_FLAGS) result[key] = 'false';
  return Object.freeze(result);
}

async function resolveCloudflareContext(env, configText) {
  const explicitAccountId = optionalText(env.CLOUDFLARE_ACCOUNT_ID);
  const accountId = resolveCloudflareAccountId({
    explicitAccountId,
    configText,
    whoamiOutput: explicitAccountId
      ? null
      : runText('npx', ['wrangler', 'whoami', '--json'], env),
    preferredAccount: env.MKT_WOOCOMMERCE_ROLLOUT_ACCOUNT,
  });
  const explicitApiToken = optionalText(env.CLOUDFLARE_API_TOKEN);
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken,
    authOutput: explicitApiToken
      ? null
      : runText('npx', ['wrangler', 'auth', 'token', '--json'], env),
  });
  return { accountId, apiToken: auth.token };
}

function readActiveVersion(env, configPath, accountId) {
  const deployment = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status',
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], { ...env, CLOUDFLARE_ACCOUNT_ID: accountId }));
  return selectExactlyOneActiveWorkerVersion(
    Array.isArray(deployment) ? deployment[0] : deployment,
  );
}

function readD1Row(env, configPath, sql) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB',
    '--remote', '--json',
    '--config', configPath,
    '--command', sql,
  ], env));
  const row = Array.isArray(value)
    ? value.flatMap((entry) => entry?.results ?? [])[0]
    : value?.results?.[0];
  if (!row) {
    throw continuationError(
      'Remote D1 boundary query returned no row',
      'META_HISTORY_EXACT_CONTINUATION_D1_QUERY_EMPTY',
    );
  }
  return row;
}

function runVisible(command, args, env, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw continuationError(
      `Required command failed: ${command} ${args.join(' ')}`,
      'META_HISTORY_EXACT_CONTINUATION_COMMAND_FAILED',
      { command, exitCode: result.status ?? 1 },
    );
  }
}

function runRequired(command, args, env = process.env, cwd = repositoryRoot, throwOnFailure = true) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if ((result.error || result.status !== 0) && throwOnFailure) {
    throw continuationError(
      `Required command failed: ${command} ${args.join(' ')}`,
      'META_HISTORY_EXACT_CONTINUATION_COMMAND_FAILED',
      {
        command,
        exitCode: result.status ?? 1,
        stdout: sanitizeText(result.stdout),
        stderr: sanitizeText(result.stderr),
      },
    );
  }
  return result;
}

function runText(command, args, env = process.env, cwd = repositoryRoot) {
  const result = runRequired(command, args, env, cwd);
  return String(result.stdout ?? '').trim();
}

function gitText(args, trim = true, cwd = repositoryRoot) {
  const result = runRequired('git', args, process.env, cwd);
  const output = String(result.stdout ?? '');
  return trim ? output.trim() : output;
}

function gitSuccess(args) {
  const result = runRequired('git', args, process.env, repositoryRoot, false);
  return !result.error && result.status === 0;
}

async function assertRegularFile(path, fieldName) {
  const info = await stat(path);
  if (!info.isFile()) {
    throw continuationError(
      `${fieldName} must be a regular file`,
      'META_HISTORY_EXACT_CONTINUATION_FILE_INVALID',
      { fieldName },
    );
  }
}

async function assertPrivateRegularFile(path, fieldName) {
  const info = await lstat(path);
  if (!info.isFile() || (info.mode & 0o077) !== 0) {
    throw continuationError(
      `${fieldName} must be a private regular file`,
      'META_HISTORY_EXACT_CONTINUATION_PRIVATE_FILE_INVALID',
      { fieldName },
    );
  }
}

async function fileExists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw continuationError(
      'Unsupported exact-plan continuation arguments',
      'META_HISTORY_EXACT_CONTINUATION_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    confirmation: META_HISTORY_EXACT_CONTINUATION_CONFIRMATION,
    retainedRepositoryHead: target.repositoryHead,
    operationId: target.operationId,
    originalRequestedAt: target.originalRequestedAt,
    entryBoundary: 'facebook_d1_complete_lark_pending',
    isolatedExactHeadClone: true,
    reusesPersistedRuntimePlan: true,
    providerReplayForFacebook: false,
    d1QueueResendForFacebook: false,
    sameOperationLarkContinuation: true,
    resumesRemainingRetainedOperations: true,
    automaticAllFalseRestore: true,
    scheduleEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

function sanitize(value, key = '') {
  if (/token|secret|password|authorization|cookie|credential/iu.test(key)) {
    return '[REDACTED]';
  }
  if (Array.isArray(value)) return value.map((item) => sanitize(item));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [
      childKey,
      sanitize(childValue, childKey),
    ]));
  }
  return value;
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"',}]+/giu, '$1[REDACTED]')
    .replace(/(api[_-]?token|access[_-]?token|refresh[_-]?token|secret|password)(\s*[:=]\s*)[^\s"',}]+/giu, '$1$2[REDACTED]')
    .slice(0, 8_000);
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function continuationError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaHistoryExactContinuationError';
  error.code = code;
  error.details = details;
  return error;
}
