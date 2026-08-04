#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, realpath, stat } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import {
  readAccountWorkersDevSubdomain,
} from './woocommerce-worker-provider-diagnostics-preview-window.mjs';

const repositoryRoot = realpathSync.native(process.cwd());
const branch = 'integration/all-meta-end-to-end-completion-v1';
const reviewBase = 'fac11f0f95b56ab0944da02dcb0360d2f5c43710';
const operationId =
  'meta-chemistry_k3-history-20260701-20260731-d4824a9e2ba9';
const finalizer = resolve(
  repositoryRoot,
  'scripts/meta-k3-partial-staging-preview-finalizer.mjs',
);
const d1Root = resolve(
  repositoryRoot,
  'outputs',
  'meta-d1-only-rollout',
  'chemistry_k3',
  operationId,
);
const recoveryRoot = resolve(
  d1Root,
  'exact-partial-staging-recovery-v1',
);
const readOnlySummary = resolve(
  repositoryRoot,
  'outputs',
  'meta-history-2026',
  '6d82a50bc6d051cc39307254543619fcd29211b4',
  'read-only-validation-chemistry_k3',
  'summary.json',
);
const confirmation = Object.freeze({
  envName: 'CONFIRM_META_K3_ONE_COMMAND',
  value: 'RUN_EXACT_META_K3_ONE_COMMAND',
});

const execute = parseArgs(process.argv.slice(2));
if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    target: 'chemistry_k3',
    operationId,
    branch,
    approvedHeadEnv: 'MKT_META_K3_APPROVED_HEAD',
    confirmation,
    cloudflareLookupMethod: 'GET',
    executionTransport: 'preview_version_upload',
    dedicatedFinalizer: true,
    loaderUsed: false,
    previewUrlAuthority: 'wrangler_version_upload_record',
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exit(0);
}

let currentStage = 'init';
let childFinalizerStarted = false;

try {
  requireExact(
    process.env[confirmation.envName],
    confirmation.value,
    confirmation.envName,
  );

  currentStage = 'repository-admission';
  runText('git', ['fetch', '--prune', 'origin'], process.env);
  const head = gitText(['rev-parse', 'HEAD']);
  const approvedHead = requireFullSha(
    process.env.MKT_META_K3_APPROVED_HEAD,
    'MKT_META_K3_APPROVED_HEAD',
  );
  requireExact(head, approvedHead, 'repositoryHead');
  requireExact(gitText(['branch', '--show-current']), branch, 'branch');
  requireExact(
    gitText(['rev-parse', `origin/${branch}`]),
    head,
    'originBranchHead',
  );
  if (gitText(['status', '--porcelain', '--untracked-files=all'], false).trim()) {
    throw launcherError(
      'K3 one-command requires a clean Working Tree',
      'META_K3_ONE_COMMAND_REPOSITORY_INVALID',
    );
  }
  const originMain = gitText(['rev-parse', 'origin/main']);
  if (!gitSucceeds(['merge-base', '--is-ancestor', reviewBase, head])
    || !gitSucceeds(['merge-base', '--is-ancestor', reviewBase, originMain])) {
    throw launcherError(
      'K3 reviewed ancestry is invalid',
      'META_K3_ONE_COMMAND_REPOSITORY_INVALID',
    );
  }

  currentStage = 'private-environment';
  const devVarsPath = await resolvePrivateFile(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
    'DEV_VARS_FILE',
  );
  const devVars = await readDevVars(devVarsPath);
  const mergedEnv = mergeNonEmptyEnvironment(devVars, process.env);
  const configPath = await resolveRepositoryFile(
    mergedEnv.MKT_META_K3_RECOVERY_WRANGLER_CONFIG
      ?? mergedEnv.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
    'MKT_META_K3_RECOVERY_WRANGLER_CONFIG',
  );
  const configText = await readFile(configPath, 'utf8');
  await resolveRepositoryFile(readOnlySummary, 'K3_READ_ONLY_SUMMARY');
  await resolveRepositoryDirectory(recoveryRoot, 'K3_RECOVERY_ROOT');

  currentStage = 'safe-version-authority';
  const verifyRestore = JSON.parse(
    await readFile(resolve(d1Root, 'verify-restore.json'), 'utf8'),
  );
  const productionBaselineVersion =
    verifyRestore?.data?.activeVersion
    ?? verifyRestore?.data?.deploymentVersionId;
  if (verifyRestore?.status !== 'passed'
    || verifyRestore?.data?.mode !== 'safe'
    || !Array.isArray(verifyRestore?.data?.expectedTrueFlags)
    || verifyRestore.data.expectedTrueFlags.length !== 0
    || typeof productionBaselineVersion !== 'string'
    || productionBaselineVersion.trim() === '') {
    throw launcherError(
      'K3 retained Safe Worker authority is invalid',
      'META_K3_ONE_COMMAND_SAFE_VERSION_INVALID',
    );
  }

  currentStage = 'cloudflare-authority';
  const authEnv = { ...mergedEnv };
  for (const key of [
    'CLOUDFLARE_ACCOUNT_ID',
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
  ]) {
    if (!String(authEnv[key] ?? '').trim()) delete authEnv[key];
  }
  const whoami = runText(
    'npx',
    ['--no-install', 'wrangler', 'whoami', '--json'],
    authEnv,
  );
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: authEnv.CLOUDFLARE_ACCOUNT_ID,
    configText,
    whoamiOutput: whoami,
    preferredAccount: authEnv.MKT_WOOCOMMERCE_ROLLOUT_ACCOUNT,
  });
  const selectedEnv = {
    ...authEnv,
    CLOUDFLARE_ACCOUNT_ID: accountId,
  };
  const authOutput = selectedEnv.CLOUDFLARE_API_TOKEN
    ? null
    : runText(
      'npx',
      ['--no-install', 'wrangler', 'auth', 'token', '--json'],
      selectedEnv,
    );
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: selectedEnv.CLOUDFLARE_API_TOKEN,
    authOutput,
  });
  const accountSubdomain = await readAccountWorkersDevSubdomain({
    accountId,
    bearerToken: auth.token,
  });
  const previewAlias = 'meta-k3-recovery';

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'exact-k3-one-command-admitted',
    target: 'chemistry_k3',
    operationId,
    repositoryHead: head,
    safeVersionAuthorityPresent: true,
    workersDevAuthorityResolved: true,
    recoveryEvidencePresent: true,
    executionTransport: 'preview_version_upload',
    dedicatedFinalizer: true,
    loaderUsed: false,
    previewUrlAuthority: 'wrangler_version_upload_record',
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);

  currentStage = 'run-exact-k3-finalizer';
  childFinalizerStarted = true;
  const child = spawnSync(
    process.execPath,
    [finalizer, '--execute'],
    {
      cwd: repositoryRoot,
      env: {
        ...mergedEnv,
        CLOUDFLARE_ACCOUNT_ID: accountId,
        CLOUDFLARE_API_TOKEN: auth.token,
        DEV_VARS_FILE: devVarsPath,
        MKT_META_HISTORY_REVIEW_WRAPPER_HEAD: head,
        MKT_META_HISTORY_REVIEW_BASE_MAIN_HEAD: reviewBase,
        MKT_META_K3_RECOVERY_WRANGLER_CONFIG: configPath,
        MKT_META_K3_PREVIEW_ALIAS: previewAlias,
        MKT_META_K3_PREVIEW_SUBDOMAIN: accountSubdomain,
        MKT_META_K3_PRODUCTION_BASELINE_VERSION:
          productionBaselineVersion,
        MKT_META_K3_EXACT_HEAD_CI: 'PASS',
        MKT_META_K3_EXACT_HEAD_CI_SHA: head,
        MKT_META_D1_ONLY_READ_ONLY_SUMMARY: readOnlySummary,
        MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY:
          'RECOVER_EXACT_PARTIAL_META_ADS_STAGING',
        MKT_META_K3_RESUME_PRE_MUTATION_CONFIG_FAILURE:
          'RESUME_EXACT_K3_PRE_MUTATION_CONFIG_FAILURE',
        CONFIRM_META_K3_PARTIAL_STAGING_RECOVERY:
          'RECOVER_AND_COMPLETE_EXACT_META_K3_PARTIAL_STAGING',
        MKT_META_K3_D1_MAX_DIRECT_INVOCATIONS: '100',
        MKT_META_K3_LARK_MAX_DIRECT_INVOCATIONS: '20',
      },
      stdio: 'inherit',
    },
  );
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw launcherError(
      'Exact K3 finalizer failed; use the preceding child finalizer output as Remote truth',
      'META_K3_ONE_COMMAND_FINALIZER_FAILED',
      { exitCode: child.status },
    );
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_K3_ONE_COMMAND_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    childFinalizerStarted,
    childRemoteState: childFinalizerStarted
      ? 'SEE_PRECEDING_CHILD_FINALIZER_OUTPUT'
      : 'NOT_STARTED',
    wrapperQueueMessageCount: 0,
    wrapperLifecycleSqlRepairCount: 0,
    wrapperWorkerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw launcherError(
      'Unsupported K3 one-command argument',
      'META_K3_ONE_COMMAND_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function mergeNonEmptyEnvironment(base, override) {
  const merged = { ...base };
  for (const [key, value] of Object.entries(override ?? {})) {
    if (value === undefined || value === null) continue;
    if (typeof value === 'string' && value.trim() === ''
      && typeof merged[key] === 'string' && merged[key].trim() !== '') {
      continue;
    }
    merged[key] = value;
  }
  return merged;
}

function runText(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw launcherError(
      `${command} command failed during K3 one-command admission`,
      'META_K3_ONE_COMMAND_COMMAND_FAILED',
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

function gitSucceeds(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    stdio: 'ignore',
  });
  return result.status === 0;
}

async function resolveRepositoryFile(value, fieldName) {
  const candidate = resolve(repositoryRoot, requireText(value, fieldName));
  const canonical = await realpath(candidate);
  assertInsideRepository(canonical, fieldName);
  const valueStat = await stat(canonical);
  if (!valueStat.isFile()) {
    throw launcherError(
      `${fieldName} must be a regular file`,
      'META_K3_ONE_COMMAND_FILE_INVALID',
      { fieldName },
    );
  }
  return canonical;
}

async function resolvePrivateFile(value, fieldName) {
  const canonical = await resolveRepositoryFile(value, fieldName);
  const valueStat = await stat(canonical);
  if ((valueStat.mode & 0o077) !== 0) {
    throw launcherError(
      `${fieldName} must not be readable by group or others`,
      'META_K3_ONE_COMMAND_PRIVATE_FILE_INVALID',
      { fieldName },
    );
  }
  return canonical;
}

async function resolveRepositoryDirectory(value, fieldName) {
  const canonical = await realpath(value);
  assertInsideRepository(canonical, fieldName);
  const valueStat = await stat(canonical);
  if (!valueStat.isDirectory()) {
    throw launcherError(
      `${fieldName} must be a directory`,
      'META_K3_ONE_COMMAND_FILE_INVALID',
      { fieldName },
    );
  }
  return canonical;
}

function assertInsideRepository(path, fieldName) {
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}/`)) {
    throw launcherError(
      `${fieldName} must resolve inside the Repository`,
      'META_K3_ONE_COMMAND_PATH_INVALID',
      { fieldName },
    );
  }
}

function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw launcherError(
      `${fieldName} must be a full SHA`,
      'META_K3_ONE_COMMAND_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw launcherError(
      `${fieldName} is required`,
      'META_K3_ONE_COMMAND_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw launcherError(
      `${fieldName} does not match the exact reviewed value`,
      'META_K3_ONE_COMMAND_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function sanitize(value, key = '') {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (typeof value !== 'object') {
    return /token|authorization|account|subdomain|origin|url|credential|secret/iu
      .test(key)
      ? '[REDACTED]'
      : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    sanitize(nestedValue, nestedKey),
  ]));
}

function launcherError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK3OneCommandLauncherError';
  error.code = code;
  error.details = details;
  return error;
}
