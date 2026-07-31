#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  readFile,
  readdir,
  rename,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  FINAL_DELIVERY_META_HEAD,
  FINAL_DELIVERY_META_OPERATION_ID,
  inspectMetaSession,
} from './lib/final-delivery-readiness.js';
import {
  isRecoverableMetaHistoryFinalSummaryFailure,
  reconcileMetaHistory2026Evidence,
} from './lib/meta-history-2026-closeout.js';
import {
  META_HISTORY_2026_CONTRACT_VERSION,
  META_HISTORY_2026_DECISION,
  assertMetaHistory2026Confirmation,
  validateMetaHistory2026Summary,
} from './lib/meta-history-2026-finalizer.js';
import {
  assertWooCommerce2026RemoteSafeFlags,
  selectExactlyOneActiveWorkerVersion,
} from './lib/woocommerce-2026-completion-one-command.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';

const repositoryRoot = resolve(process.cwd());
const workerName = 'social-mkt-sync-worker';
const databaseName = 'social-mkt-state-dev';
const finalizerPath = join(repositoryRoot, 'scripts', 'meta-history-2026-finalizer.mjs');
let currentStage = 'init';

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) printPlan();
  else await executeOneCommand();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_HISTORY_2026_ONE_COMMAND_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeOneCommand() {
  assertMetaHistory2026Confirmation(process.env);
  currentStage = 'execute-guarded-finalizer';
  const child = spawnSync(process.execPath, [finalizerPath, '--execute'], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: ['inherit', 'pipe', 'pipe'],
  });
  process.stdout.write(String(child.stdout ?? ''));
  process.stderr.write(String(child.stderr ?? ''));
  if (child.error) throw child.error;
  if (child.status === 0) return;

  currentStage = 'restore-after-child-failure';
  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  const env = await loadPrivateEnvironment();
  const safeConfigPath = join(
    repositoryRoot,
    'outputs',
    'meta-history-2026',
    repositoryHead,
    'wrangler.meta-history.safe.jsonc',
  );
  let safe = null;
  if (await fileExists(safeConfigPath)) {
    safe = await ensureRemoteAllFalse(env, safeConfigPath, repositoryHead);
  }

  const childFailure = parseLastJsonObject(child.stderr);
  if (!isRecoverableMetaHistoryFinalSummaryFailure(childFailure)) {
    throw oneCommandError(
      'Meta history finalizer failed before the exact recoverable closeout boundary',
      'META_HISTORY_2026_CHILD_FAILED',
      {
        childExitCode: child.status ?? 1,
        childStage: childFailure?.stage ?? null,
        childCode: childFailure?.code ?? null,
        remoteSafeRestored: safe?.executionFlagsAllFalse === true,
      },
    );
  }
  if (!safe?.executionFlagsAllFalse) {
    throw oneCommandError(
      'Meta history closeout requires a verified all-false Worker',
      'META_HISTORY_2026_CLOSEOUT_REMOTE_UNSAFE',
    );
  }

  currentStage = 'reconcile-authoritative-evidence';
  const root = join(repositoryRoot, 'outputs', 'meta-history-2026', repositoryHead);
  const plan = JSON.parse(await readFile(join(root, 'runtime-plan.json'), 'utf8'));
  const evidenceByOperation = {};
  for (const operation of plan.operations) {
    const d1Root = join(
      repositoryRoot,
      'outputs',
      'meta-d1-only-rollout',
      operation.target,
      operation.operationId,
    );
    const larkRoot = join(
      repositoryRoot,
      'outputs',
      'meta-lark-parity-rollout',
      operation.target,
      operation.operationId,
    );
    if (!(await fileExists(join(d1Root, 'summary.json')))
      || !(await fileExists(join(larkRoot, 'summary.json')))) {
      continue;
    }
    evidenceByOperation[operation.operationId] = {
      d1Summary: JSON.parse(await readFile(join(d1Root, 'summary.json'), 'utf8')),
      d1Verification: JSON.parse(await readFile(join(d1Root, 'verify-d1-only.json'), 'utf8')),
      larkSummary: JSON.parse(await readFile(join(larkRoot, 'summary.json'), 'utf8')),
    };
  }
  const reconciled = reconcileMetaHistory2026Evidence({ plan, evidenceByOperation });
  const facebook = await verifyPinnedFacebook(env);

  currentStage = 'write-corrected-safe-summary';
  const instagram = reconciled.completed.find((item) => item.target === 'instagram');
  const summary = {
    ok: true,
    accepted: true,
    contractVersion: META_HISTORY_2026_CONTRACT_VERSION,
    decision: META_HISTORY_2026_DECISION,
    repositoryHead,
    facebook,
    instagram: {
      completed: reconciled.instagramCompleted,
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      operationId: instagram?.operationId ?? null,
    },
    metaAds: {
      baselineCompleted: reconciled.adsBaselineCompleted,
      baselinePeriodStart: '2026-05-01',
      baselinePeriodEnd: '2026-07-31',
      expandedToYearStart: reconciled.expansion.allowed,
      expansionPeriodStart: reconciled.expansion.allowed ? '2026-01-01' : null,
      expansionPeriodEnd: reconciled.expansion.allowed ? '2026-04-30' : null,
      expansionDecision: reconciled.expansion,
    },
    operations: reconciled.completed.map((item) => ({
      target: item.target,
      operationId: item.operationId,
      periodStart: item.periodStart,
      periodEnd: item.periodEnd,
      mode: item.mode,
      d1Completed: item.d1Completed,
      larkCompleted: item.larkCompleted,
    })),
    parityVerified: reconciled.parityVerified,
    idempotentRerunsVerified: reconciled.idempotentRerunsVerified,
    executionFlagsAllFalse: safe.executionFlagsAllFalse,
    remote: safe.remote,
    scheduleEnabled: false,
    production: false,
    nextStep: 'repository_live_closeout',
    marker: META_HISTORY_2026_DECISION,
    closeoutRecoveredFromExactAliasMismatch: true,
  };
  validateMetaHistory2026Summary(summary);
  const summaryPath = join(root, 'meta-history-2026-summary.json');
  await writePrivateJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidenceRoot: root }, null, 2)}\n`);
  process.stdout.write(`${META_HISTORY_2026_DECISION}\n`);
}

async function ensureRemoteAllFalse(env, configPath, repositoryHead) {
  const cloudflare = await resolveCloudflareContext(env, configPath);
  let verified = await inspectRemoteSafe(env, configPath, cloudflare).catch(() => null);
  if (!verified?.executionFlagsAllFalse) {
    currentStage = 'automatic-all-false-restore';
    runRequired('npx', [
      'wrangler', 'deploy',
      '--config', configPath,
      '--message', `${META_HISTORY_2026_CONTRACT_VERSION} emergency-safe-restore git=${repositoryHead}`,
    ], { ...env, CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId });
    verified = await inspectRemoteSafe(env, configPath, cloudflare);
  }
  return verified;
}

async function inspectRemoteSafe(env, configPath, cloudflare) {
  const deployment = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status',
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], { ...env, CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId }));
  const activeVersion = selectExactlyOneActiveWorkerVersion(
    Array.isArray(deployment) ? deployment[0] : deployment,
  );
  const version = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', activeVersion,
    '--name', workerName,
    '--config', configPath,
    '--json',
  ], { ...env, CLOUDFLARE_ACCOUNT_ID: cloudflare.accountId }));
  assertWooCommerce2026RemoteSafeFlags(version);
  const row = readD1Row(env, configPath, `SELECT
    (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status = 'active') AS active_work,
    (SELECT COUNT(*) FROM sync_locks WHERE expires_at > (unixepoch() * 1000)) AS active_locks,
    (SELECT COUNT(*) FROM sync_runs WHERE status IN ('queued', 'running')) AS active_queue_operations;`);
  const remote = {
    activeWork: Number(row.active_work ?? 0),
    activeLocks: Number(row.active_locks ?? 0),
    activeQueueOperations: Number(row.active_queue_operations ?? 0),
  };
  if (Object.values(remote).some((value) => value !== 0)) {
    throw oneCommandError(
      'Remote Reliability state is not idle after safe restore',
      'META_HISTORY_2026_REMOTE_NOT_IDLE',
      remote,
    );
  }
  return { executionFlagsAllFalse: true, activeVersion, remote };
}

async function verifyPinnedFacebook(env) {
  const paths = await resolvePinnedMetaFiles(env);
  const session = inspectMetaSession(
    JSON.parse(await readFile(paths.sessionPath, 'utf8')),
    {
      repositoryHead: FINAL_DELIVERY_META_HEAD,
      operationId: FINAL_DELIVERY_META_OPERATION_ID,
    },
  );
  if (!session.sessionCompleted) {
    throw oneCommandError(
      'Pinned Meta session is not completed',
      'META_HISTORY_2026_PINNED_SESSION_INCOMPLETE',
    );
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
    sessionPath: optionalPath(env.MKT_META_FINALIZE_SESSION_FILE),
  };
  if (direct.sessionPath) return direct;
  const manifests = await findJsonFiles(join(repositoryRoot, 'outputs'), 7);
  for (const path of manifests.reverse()) {
    try {
      const value = JSON.parse(await readFile(path, 'utf8'));
      const sessionPath = optionalPath(value?.meta?.sessionPath);
      if (sessionPath && await fileExists(sessionPath)) return { sessionPath };
    } catch {
      // Unrelated private JSON artifacts are ignored.
    }
  }
  throw oneCommandError(
    'Pinned Meta session file was not found',
    'META_HISTORY_2026_PINNED_SESSION_MISSING',
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
    authOutput: explicitToken
      ? null
      : runText('npx', ['wrangler', 'auth', 'token', '--json'], env),
  });
  return { accountId, apiToken: auth.token };
}

async function loadPrivateEnvironment() {
  const path = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  await assertPrivateRegularFile(path, 'DEV_VARS_FILE');
  const fileEnv = await readDevVars(path);
  const env = { ...fileEnv, ...process.env, DEV_VARS_FILE: path };
  for (const key of Object.keys(env)) {
    if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) env[key] = 'false';
  }
  return env;
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
    throw oneCommandError(
      'Remote D1 query returned no row',
      'META_HISTORY_2026_D1_QUERY_EMPTY',
    );
  }
  return row;
}

function parseLastJsonObject(value) {
  const text = String(value ?? '').trim();
  for (let index = text.lastIndexOf('{'); index >= 0; index = text.lastIndexOf('{', index - 1)) {
    try {
      return JSON.parse(text.slice(index));
    } catch {
      // Continue scanning for the start of the final JSON document.
    }
  }
  return null;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw oneCommandError(
      'Unsupported Meta history launcher arguments',
      'META_HISTORY_2026_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    command: 'CONFIRM_META_HISTORY_2026_FINALIZER=RUN_META_HISTORY_2026_ONE_COMMAND node scripts/meta-history-2026-one-command.mjs --execute',
    guardedFinalizer: 'scripts/meta-history-2026-finalizer.mjs',
    exactEvidenceCloseout: true,
    automaticAllFalseRestore: true,
    blindQueueResend: false,
    scheduleEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

function runRequired(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    throw oneCommandError(
      `Required command failed: ${command} ${args.join(' ')}`,
      'META_HISTORY_2026_COMMAND_FAILED',
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
    throw oneCommandError(
      `Command failed: ${command} ${args.join(' ')}`,
      'META_HISTORY_2026_COMMAND_FAILED',
      { command, exitCode: result.status ?? 1 },
    );
  }
  return String(result.stdout ?? '').trim();
}

function gitText(args) {
  return runText('git', args, process.env);
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

async function assertPrivateRegularFile(path, label) {
  const info = await lstat(path).catch(() => null);
  if (!info || !info.isFile() || info.isSymbolicLink() || (info.mode & 0o077) !== 0) {
    throw oneCommandError(
      `${label} must be a private regular non-symlink file`,
      'META_HISTORY_2026_PRIVATE_FILE_INVALID',
      { label },
    );
  }
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function fileExists(path) {
  return stat(path).then((info) => info.isFile() || info.isDirectory()).catch(() => false);
}

function optionalPath(value) {
  const text = optionalText(value);
  return text ? resolve(text) : null;
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return typeof value === 'string' ? value.trim() || null : String(value);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value)
      .filter(([key]) => !/token|secret|authorization/iu.test(key))
      .map(([key, nested]) => [key, sanitize(nested)]),
  );
}

function oneCommandError(message, code, details = undefined) {
  const error = new Error(message);
  error.name = 'MetaHistory2026OneCommandError';
  error.code = code;
  error.details = details;
  return error;
}
