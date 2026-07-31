#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  META_D1_ONLY_CONFIRMATIONS,
  META_D1_ONLY_OPERATOR_PHASES,
} from './lib/meta-d1-only-rollout-operator.js';
import {
  META_LARK_CONFIRMATIONS,
  META_LARK_OPERATOR_PHASES,
} from './lib/meta-lark-parity-rollout-operator.js';
import {
  META_READ_ONLY_VALIDATION_CONFIRMATIONS,
} from './lib/meta-read-only-validation-operator.js';
import {
  FINAL_DELIVERY_META_HEAD,
  FINAL_DELIVERY_META_OPERATION_ID,
  inspectMetaSession,
} from './lib/final-delivery-readiness.js';
import {
  assertWooCommerce2026RemoteSafeFlags,
  selectExactlyOneActiveWorkerVersion,
} from './lib/woocommerce-2026-completion-one-command.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import { discoverWooCommerceQueueId } from './lib/woocommerce-final-queue-discovery.js';
import {
  META_HISTORY_2026_CONTRACT_VERSION,
  META_HISTORY_2026_DECISION,
  assertMetaHistory2026Confirmation,
  createMetaHistory2026Plan,
  injectMetaHistoryConfig,
  shouldExpandMetaAdsHistory,
  validateMetaHistory2026Summary,
} from './lib/meta-history-2026-finalizer.js';

const repositoryRoot = resolve(process.cwd());
const outputRoot = join(repositoryRoot, 'outputs', 'meta-history-2026');
const workerName = 'social-mkt-sync-worker';
const databaseName = 'social-mkt-state-dev';
const mainQueueName = 'social-mkt-sync-jobs';
const dlqName = 'social-mkt-sync-dlq';
let currentStage = 'init';

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) printPlan();
  else await executeHistory();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_HISTORY_2026_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeHistory() {
  assertMetaHistory2026Confirmation(process.env);
  currentStage = 'exact-clean-main';
  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  const originMain = gitText(['rev-parse', 'origin/main']);
  const branch = gitText(['branch', '--show-current']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || repositoryHead !== originMain || dirty.trim() !== '') {
    throw historyError('Meta history requires exact clean main equal to origin/main', 'META_HISTORY_2026_REPOSITORY_INVALID', {
      branch, repositoryHead, originMain, clean: dirty.trim() === '',
    });
  }

  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  await assertPrivateRegularFile(devVarsPath, 'DEV_VARS_FILE');
  const fileEnv = await readDevVars(devVarsPath);
  const baseEnv = closeExecutionFlags({ ...fileEnv, ...process.env, DEV_VARS_FILE: devVarsPath });
  requireExact(baseEnv.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(baseEnv.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(baseEnv.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  await mkdir(join(outputRoot, repositoryHead), { recursive: true, mode: 0o700 });
  const runtimePlan = await loadOrCreateRuntimePlan(repositoryHead);

  currentStage = 'local-full-gates';
  runVisible('npm', ['ci'], baseEnv);
  runVisible('npm', ['run', 'check'], baseEnv);
  runVisible(process.execPath, ['--test',
    'tests/connectors/meta-history-range-adapters.test.js',
    'tests/application/meta-history-2026-finalizer.test.js',
    'tests/application/meta-d1-only-rollout-operator.test.js',
    'tests/application/meta-lark-parity-rollout-operator.test.js',
  ], baseEnv);
  runVisible('npm', ['test'], baseEnv);
  runVisible('npm', ['run', 'test:report-reliability'], baseEnv);
  runVisible('npm', ['audit', '--audit-level=high'], baseEnv);
  runVisible('npm', ['run', 'deploy:dry-run'], baseEnv);

  currentStage = 'prepare-safe-config';
  const sourceConfigPath = resolve(
    baseEnv.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? baseEnv.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  const sourceConfigText = await readRegularSourceText(sourceConfigPath, 'Meta Wrangler config');
  const safeConfigPath = join(outputRoot, repositoryHead, 'wrangler.meta-history.safe.jsonc');
  const safeConfigText = injectMetaHistoryConfig(sourceConfigText, undefined, {
    baseDirectory: repositoryRoot,
  });
  await writePrivateText(safeConfigPath, safeConfigText);
  const configRelativePath = relative(repositoryRoot, safeConfigPath);

  currentStage = 'cloudflare-readiness';
  const cloudflare = await resolveCloudflareContext(baseEnv, safeConfigPath);
  await assertRemoteSafe(baseEnv, safeConfigPath, cloudflare);

  currentStage = 'resume-pinned-meta-finalizer';
  const pinned = await resolvePinnedMetaFiles(baseEnv);
  const facebook = await resumePinnedFinalizer({
    ...pinned,
    env: baseEnv,
    devVarsPath,
  });
  await assertRemoteSafe(baseEnv, safeConfigPath, cloudflare);

  currentStage = 'fresh-read-only-validation';
  const readOnlyRoot = join(outputRoot, repositoryHead, 'read-only-validation');
  const readOnlySummaryPath = await runFreshReadOnlyValidation(baseEnv, readOnlyRoot);

  const completed = [];
  const baselineSnapshots = [];
  for (const operation of runtimePlan.operations.filter((item) => item.mode === 'required')) {
    currentStage = `operation-${operation.target}-${operation.periodStart}-${operation.periodEnd}`;
    const result = await runMetaOperation({
      operation,
      repositoryHead,
      baseEnv,
      configRelativePath,
      readOnlySummaryPath,
      cloudflare,
    });
    completed.push(result);
    if (operation.target.startsWith('chemistry_k')) baselineSnapshots.push(result.d1Verification);
  }

  const expansion = shouldExpandMetaAdsHistory(baselineSnapshots);
  if (expansion.allowed) {
    for (const operation of runtimePlan.operations.filter((item) => item.mode === 'conditional')) {
      currentStage = `operation-${operation.target}-${operation.periodStart}-${operation.periodEnd}`;
      completed.push(await runMetaOperation({
        operation,
        repositoryHead,
        baseEnv,
        configRelativePath,
        readOnlySummaryPath,
        cloudflare,
      }));
    }
  }

  currentStage = 'final-safe-verification';
  const safe = await assertRemoteSafe(baseEnv, safeConfigPath, cloudflare);
  const instagramResult = completed.find((item) => item.target === 'instagram');
  const adsBaselineResults = completed.filter((item) => item.mode === 'required' && item.target.startsWith('chemistry_k'));
  const summary = {
    ok: true,
    accepted: true,
    contractVersion: META_HISTORY_2026_CONTRACT_VERSION,
    decision: META_HISTORY_2026_DECISION,
    repositoryHead,
    facebook,
    instagram: {
      completed: Boolean(instagramResult?.larkCompleted),
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      operationId: instagramResult?.operationId ?? null,
    },
    metaAds: {
      baselineCompleted: adsBaselineResults.length === 2
        && adsBaselineResults.every((item) => item.larkCompleted),
      baselinePeriodStart: '2026-05-01',
      baselinePeriodEnd: '2026-07-31',
      expandedToYearStart: expansion.allowed,
      expansionPeriodStart: expansion.allowed ? '2026-01-01' : null,
      expansionPeriodEnd: expansion.allowed ? '2026-04-30' : null,
      expansionDecision: expansion,
    },
    operations: completed.map((item) => ({
      target: item.target,
      operationId: item.operationId,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      mode: item.mode,
      d1Completed: item.d1Completed,
      larkCompleted: item.larkCompleted,
    })),
    parityVerified: completed.every((item) => item.larkCompleted),
    idempotentRerunsVerified: completed.every((item) => item.idempotentRerunVerified),
    executionFlagsAllFalse: safe.executionFlagsAllFalse,
    remote: safe.remote,
    scheduleEnabled: false,
    production: false,
    nextStep: 'repository_live_closeout',
    marker: META_HISTORY_2026_DECISION,
  };
  validateMetaHistory2026Summary(summary);
  const summaryPath = join(outputRoot, repositoryHead, 'meta-history-2026-summary.json');
  await writePrivateJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidenceRoot: dirname(summaryPath) }, null, 2)}\n`);
  process.stdout.write(`${META_HISTORY_2026_DECISION}\n`);
}

async function runMetaOperation(input) {
  const { operation, repositoryHead, baseEnv, configRelativePath, readOnlySummaryPath, cloudflare } = input;
  const d1Root = join(repositoryRoot, 'outputs', 'meta-d1-only-rollout', operation.target, operation.operationId);
  const larkRoot = join(repositoryRoot, 'outputs', 'meta-lark-parity-rollout', operation.target, operation.operationId);
  const d1SummaryPath = join(d1Root, 'summary.json');
  const larkSummaryPath = join(larkRoot, 'summary.json');

  if (!(await fileExists(d1SummaryPath))) {
    const activeVersion = await readActiveVersion(baseEnv, configRelativePath);
    const env = d1Environment({
      baseEnv, operation, repositoryHead, configRelativePath,
      readOnlySummaryPath, activeVersion, cloudflare,
    });
    await runGuardedPhaseChain({
      kind: 'd1',
      phases: META_D1_ONLY_OPERATOR_PHASES.slice(1),
      confirmations: META_D1_ONLY_CONFIRMATIONS,
      launcher: 'scripts/meta-d1-only-rollout-launcher.mjs',
      evidenceRoot: d1Root,
      env,
    });
  }

  const d1Summary = JSON.parse(await readFile(d1SummaryPath, 'utf8'));
  const d1VerificationPath = join(d1Root, 'verify-d1-only.json');
  const d1Verification = JSON.parse(await readFile(d1VerificationPath, 'utf8'));

  if (!(await fileExists(larkSummaryPath))) {
    const activeVersion = await readActiveVersion(baseEnv, configRelativePath);
    const env = larkEnvironment({
      baseEnv, operation, repositoryHead, configRelativePath,
      readOnlySummaryPath, activeVersion, cloudflare, d1SummaryPath,
    });
    await runGuardedPhaseChain({
      kind: 'lark',
      phases: META_LARK_OPERATOR_PHASES.slice(1),
      confirmations: META_LARK_CONFIRMATIONS,
      launcher: 'scripts/meta-lark-parity-rollout-launcher.mjs',
      evidenceRoot: larkRoot,
      env,
    });
  }

  const larkSummary = JSON.parse(await readFile(larkSummaryPath, 'utf8'));
  if (d1Summary?.data?.accepted !== true || larkSummary?.data?.accepted !== true) {
    throw historyError('Meta operation summary is not accepted', 'META_HISTORY_2026_OPERATION_SUMMARY_INVALID', {
      target: operation.target,
      operationId: operation.operationId,
    });
  }
  return {
    ...operation,
    d1Completed: d1Summary.data.d1OnlyVerified === true,
    larkCompleted: larkSummary.data.larkVerified === true,
    idempotentRerunVerified: d1Summary.data.idempotentRerunVerified === true
      && larkSummary.data.idempotentRerunVerified === true,
    d1Verification,
  };
}

async function runGuardedPhaseChain({ kind, phases, confirmations, launcher, evidenceRoot, env }) {
  const restorePhase = 'restore-all-false';
  const verifyRestorePhase = 'verify-restore';
  const summaryPhase = 'summary';
  let failure = null;
  try {
    for (const phase of phases.filter((item) => ![restorePhase, verifyRestorePhase, summaryPhase].includes(item))) {
      const path = join(evidenceRoot, `${phase}.json`);
      if (await fileExists(path)) continue;
      if ((phase === 'send-one-d1-only' || phase === 'send-lark-continuation')
        && await fileExists(join(evidenceRoot, `${phase}.attempt.json`))) {
        throw historyError('Queue acceptance is uncertain; blind resend is blocked', 'META_HISTORY_2026_QUEUE_ACCEPTANCE_UNCERTAIN', { kind, phase });
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

function runOperatorPhase(launcher, phase, confirmation, env) {
  const phaseEnv = { ...env };
  if (confirmation) phaseEnv[confirmation.envName] = confirmation.value;
  runVisible(process.execPath, [launcher, `--phase=${phase}`, '--execute'], phaseEnv);
}

async function runFreshReadOnlyValidation(baseEnv, evidenceRoot) {
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  for (const phase of ['preflight', 'facebook', 'instagram', 'meta-ads-chemistry-k2', 'meta-ads-chemistry-k3', 'summary']) {
    const output = join(evidenceRoot, `${phase}.json`);
    if (await fileExists(output)) continue;
    const confirmation = META_READ_ONLY_VALIDATION_CONFIRMATIONS[phase];
    runVisible(process.execPath, [
      'scripts/meta-read-only-validation-operator.mjs',
      `--phase=${phase}`,
      '--execute',
    ], {
      ...baseEnv,
      MKT_META_READ_ONLY_EVIDENCE_DIR: evidenceRoot,
      [confirmation.envName]: confirmation.value,
    });
  }
  const summaryPath = join(evidenceRoot, 'summary.json');
  const summary = JSON.parse(await readFile(summaryPath, 'utf8'));
  if (summary?.details?.accepted !== true || Number(summary?.details?.validationCount) !== 4) {
    throw historyError('Fresh Meta read-only validation is not accepted', 'META_HISTORY_2026_READ_ONLY_INVALID');
  }
  return summaryPath;
}

async function resumePinnedFinalizer({ clonePath, sessionPath, overlayPath, finalizerPath, env, devVarsPath }) {
  for (const [path, label] of [
    [sessionPath, 'Meta pinned session'],
    [overlayPath, 'Meta pinned overlay'],
    [finalizerPath, 'Meta pinned finalizer'],
  ]) await assertPrivateRegularFile(path, label);
  const head = gitText(['-C', clonePath, 'rev-parse', 'HEAD']);
  const originMain = gitText(['-C', clonePath, 'rev-parse', 'origin/main']);
  const branch = gitText(['-C', clonePath, 'branch', '--show-current']);
  const dirty = gitText(['-C', clonePath, 'status', '--porcelain', '--untracked-files=all'], false);
  if (head !== FINAL_DELIVERY_META_HEAD || originMain !== FINAL_DELIVERY_META_HEAD
    || branch !== 'main' || dirty.trim() !== '') {
    throw historyError('Pinned Meta clone changed', 'META_HISTORY_2026_PINNED_CLONE_INVALID');
  }
  const sessionBefore = inspectMetaSession(
    JSON.parse(await readFile(sessionPath, 'utf8')),
    { repositoryHead: FINAL_DELIVERY_META_HEAD, operationId: FINAL_DELIVERY_META_OPERATION_ID },
  );
  if (!sessionBefore.sessionCompleted) {
    await copyFile(devVarsPath, join(clonePath, '.dev.vars'));
    await chmod(join(clonePath, '.dev.vars'), 0o600);
    runVisible(process.execPath, [finalizerPath], {
      ...env,
      DEV_VARS_FILE: join(clonePath, '.dev.vars'),
      MKT_META_SAFE_CONFIG: overlayPath,
      MKT_META_FINALIZE_SESSION_FILE: sessionPath,
      CONFIRM_META_FINALIZE_ALL: 'RUN_AUTHORIZED_META_REMAINING_LANES',
    }, clonePath);
  }
  const sessionAfter = inspectMetaSession(
    JSON.parse(await readFile(sessionPath, 'utf8')),
    { repositoryHead: FINAL_DELIVERY_META_HEAD, operationId: FINAL_DELIVERY_META_OPERATION_ID },
  );
  if (!sessionAfter.sessionCompleted) {
    throw historyError('Pinned Meta finalizer did not complete', 'META_HISTORY_2026_PINNED_FINALIZER_INCOMPLETE');
  }
  return {
    verified: true,
    providerReplay: false,
    pinnedSessionCompleted: true,
    pinnedRepositoryHead: FINAL_DELIVERY_META_HEAD,
  };
}

async function resolvePinnedMetaFiles(env) {
  const direct = {
    clonePath: optionalPath(env.MKT_META_FINALIZE_CLONE),
    sessionPath: optionalPath(env.MKT_META_FINALIZE_SESSION_FILE),
    overlayPath: optionalPath(env.MKT_META_FINALIZE_OVERLAY),
    finalizerPath: optionalPath(env.MKT_META_FINALIZER_FILE),
  };
  if (Object.values(direct).every(Boolean)) return direct;
  const manifests = await findJsonFiles(join(repositoryRoot, 'outputs'), 6);
  for (const path of manifests.reverse()) {
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      const meta = value?.meta;
      const candidate = {
        clonePath: optionalPath(meta?.clonePath),
        sessionPath: optionalPath(meta?.sessionPath),
        overlayPath: optionalPath(meta?.overlayPath),
        finalizerPath: optionalPath(meta?.finalizerPath),
      };
      if (Object.values(candidate).every(Boolean)) return candidate;
    } catch {
      // Ignore unrelated/private JSON artifacts while searching for the exact readiness manifest.
    }
  }
  throw historyError(
    'Pinned Meta files were not found in .dev.vars or an existing readiness manifest',
    'META_HISTORY_2026_PINNED_FILES_MISSING',
  );
}

async function resolveCloudflareContext(env, configPath) {
  const whoami = runText('npx', ['wrangler', 'whoami', '--json'], env);
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    configText: await readFile(configPath, 'utf8'),
    whoamiOutput: whoami,
    preferredAccount: env.MKT_WOOCOMMERCE_ROLLOUT_ACCOUNT,
  });
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
  return { accountId, apiToken: auth.token, queueId };
}

async function assertRemoteSafe(env, configPath, cloudflare) {
  const activeVersion = await readActiveVersion(env, configPath);
  const version = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', activeVersion,
    '--name', workerName, '--config', configPath, '--json',
  ], { ...env, CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId }));
  assertWooCommerce2026RemoteSafeFlags(version);
  const row = readD1Row(env, configPath, `SELECT
    (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work,
    (SELECT COUNT(*) FROM sync_locks WHERE expires_at > (unixepoch() * 1000)) AS active_locks,
    (SELECT COUNT(DISTINCT q.operation_id) FROM queue_operation_attempts q
      JOIN sync_work_runs w ON w.work_key = q.work_key
      WHERE w.lifecycle_status = 'active') AS active_queue_operations;`);
  const remote = {
    activeWork: Number(row.active_work ?? 0),
    activeLocks: Number(row.active_locks ?? 0),
    activeQueueOperations: Number(row.active_queue_operations ?? 0),
  };
  if (Object.values(remote).some((value) => value !== 0)) {
    throw historyError('Remote Reliability state is not idle', 'META_HISTORY_2026_REMOTE_NOT_IDLE', remote);
  }
  return { executionFlagsAllFalse: true, activeVersion, remote };
}

async function readActiveVersion(env, configPath) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status', '--name', workerName,
    '--config', configPath, '--json',
  ], env));
  return selectExactlyOneActiveWorkerVersion(Array.isArray(value) ? value[0] : value);
}

function readD1Row(env, configPath, sql) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
    '--config', configPath, '--command', sql,
  ], env));
  const row = Array.isArray(value)
    ? value.flatMap((entry) => entry?.results ?? [])[0]
    : value?.results?.[0];
  if (!row) throw historyError('Remote D1 query returned no row', 'META_HISTORY_2026_D1_QUERY_EMPTY');
  return row;
}

function d1Environment({ baseEnv, operation, repositoryHead, configRelativePath, readOnlySummaryPath, activeVersion, cloudflare }) {
  return {
    ...baseEnv,
    CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId,
    CLOUDFLARE_API_TOKEN: cloudflare.apiToken,
    MKT_META_D1_ONLY_QUEUE_ID: cloudflare.queueId,
    MKT_META_D1_ONLY_TARGET: operation.target,
    MKT_META_D1_ONLY_REPOSITORY_HEAD: repositoryHead,
    MKT_META_D1_ONLY_OPERATION_ID: operation.operationId,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: String(operation.originalRequestedAt),
    MKT_META_D1_ONLY_PERIOD_START: operation.periodStart,
    MKT_META_D1_ONLY_PERIOD_END: operation.periodEnd,
    MKT_META_D1_ONLY_ACCOUNT_KEY: 'chemistry_k',
    MKT_META_D1_ONLY_WORKER_NAME: workerName,
    MKT_META_D1_ONLY_DATABASE_NAME: databaseName,
    MKT_META_D1_ONLY_MAIN_QUEUE: mainQueueName,
    MKT_META_D1_ONLY_DLQ: dlqName,
    MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION: activeVersion,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: configRelativePath,
    MKT_META_D1_ONLY_READ_ONLY_SUMMARY: readOnlySummaryPath,
  };
}

function larkEnvironment({ baseEnv, operation, repositoryHead, configRelativePath, readOnlySummaryPath, activeVersion, cloudflare, d1SummaryPath }) {
  return {
    ...baseEnv,
    CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId,
    CLOUDFLARE_API_TOKEN: cloudflare.apiToken,
    MKT_META_LARK_QUEUE_ID: cloudflare.queueId,
    MKT_META_LARK_TARGET: operation.target,
    MKT_META_LARK_REPOSITORY_HEAD: repositoryHead,
    MKT_META_LARK_OPERATION_ID: operation.operationId,
    MKT_META_LARK_ORIGINAL_REQUESTED_AT: String(operation.originalRequestedAt),
    MKT_META_LARK_PERIOD_START: operation.periodStart,
    MKT_META_LARK_PERIOD_END: operation.periodEnd,
    MKT_META_LARK_ACCOUNT_KEY: 'chemistry_k',
    MKT_META_LARK_WORKER_NAME: workerName,
    MKT_META_LARK_DATABASE_NAME: databaseName,
    MKT_META_LARK_MAIN_QUEUE: mainQueueName,
    MKT_META_LARK_DLQ: dlqName,
    MKT_META_LARK_EXPECTED_ACTIVE_VERSION: activeVersion,
    MKT_META_LARK_WRANGLER_CONFIG: configRelativePath,
    MKT_META_LARK_READ_ONLY_SUMMARY: readOnlySummaryPath,
    MKT_META_LARK_D1_SUMMARY: d1SummaryPath,
  };
}

async function loadOrCreateRuntimePlan(repositoryHead) {
  const path = join(outputRoot, repositoryHead, 'runtime-plan.json');
  if (await fileExists(path)) {
    const value = JSON.parse(await readFile(path, 'utf8'));
    if (value.repositoryHead !== repositoryHead || !Array.isArray(value.operations)) {
      throw historyError('Persisted Meta history plan is invalid', 'META_HISTORY_2026_PLAN_INVALID');
    }
    return value;
  }
  const base = createMetaHistory2026Plan(repositoryHead);
  const createdAt = Date.now();
  const value = {
    ...base,
    createdAt: new Date(createdAt).toISOString(),
    operations: base.operations.map((operation, index) => ({
      ...operation,
      originalRequestedAt: createdAt + index,
    })),
  };
  await writePrivateJson(path, value);
  return value;
}

function closeExecutionFlags(env) {
  const result = { ...env };
  for (const key of Object.keys(result)) {
    if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) result[key] = 'false';
  }
  return result;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) throw historyError('Unsupported Meta history arguments', 'META_HISTORY_2026_ARGUMENT_INVALID', { unknown });
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: META_HISTORY_2026_CONTRACT_VERSION,
    confirmation: 'CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND',
    facebook: 'verify existing completed pinned lane; no Provider replay',
    instagram: '2026-07-01..2026-07-31',
    metaAds: '2026-05-01..2026-07-31, then 2026-01-01..2026-04-30 when bounded volume is safe',
    d1BeforeLark: true,
    parityAndIdempotencyRequired: true,
    automaticAllFalseRestore: true,
    scheduleEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

function runVisible(command, args, env, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw historyError(`Required command failed: ${command} ${args.join(' ')}`, 'META_HISTORY_2026_COMMAND_FAILED', {
      command, exitCode: result.status ?? 1,
    });
  }
}

function runText(command, args, env, cwd = repositoryRoot) {
  const result = spawnSync(command, args, {
    cwd,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 128 * 1024 * 1024,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    throw historyError(`Command failed: ${command} ${args.join(' ')}`, 'META_HISTORY_2026_COMMAND_FAILED', {
      command, exitCode: result.status ?? 1,
    });
  }
  return String(result.stdout ?? '').trim();
}

function gitText(args, trim = true) {
  const output = runText('git', args, process.env);
  return trim ? output.trim() : `${output}\n`;
}

async function findJsonFiles(root, depth) {
  if (depth < 0 || !(await fileExists(root))) return [];
  const result = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) result.push(...await findJsonFiles(path, depth - 1));
    else if (entry.isFile() && entry.name.endsWith('.json')) result.push(path);
  }
  return result.sort((left, right) => left.localeCompare(right));
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

async function assertPrivateRegularFile(path, label) {
  const info = await lstat(path).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw historyError(`${label} must be a private regular non-symlink file`, 'META_HISTORY_2026_PRIVATE_FILE_INVALID', { label });
  }
}

async function readRegularSourceText(path, label) {
  const info = await stat(path).catch(() => null);
  if (!info || !info.isFile()) {
    throw historyError(
      `${label} must resolve to a readable regular file`,
      'META_HISTORY_2026_SOURCE_FILE_INVALID',
      { label },
    );
  }
  try {
    return await readFile(path, 'utf8');
  } catch {
    throw historyError(
      `${label} must resolve to a readable regular file`,
      'META_HISTORY_2026_SOURCE_FILE_INVALID',
      { label },
    );
  }
}

async function fileExists(path) {
  return stat(path).then((info) => info.isFile() || info.isDirectory()).catch(() => false);
}

function optionalPath(value) {
  return optionalText(value) ? resolve(value.trim()) : null;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value.trim() || null : String(value);
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) throw historyError(`${fieldName} must equal ${expected}`, 'META_HISTORY_2026_ENV_INVALID', { fieldName });
  return value;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !/token|secret|authorization/iu.test(key)).map(([key, nested]) => [key, sanitize(nested)]));
}

function historyError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'MetaHistory2026FinalizerError';
  error.code = code;
  error.details = details;
  return error;
}
