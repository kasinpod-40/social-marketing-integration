#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  realpath,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  META_HISTORY_2026_WINDOWS,
  injectMetaHistoryConfig,
} from './lib/meta-history-2026-finalizer.js';
import {
  META_K2_POST_ACTIVATION_FAILURE_FILES,
  META_K2_PREACTIVATION_FAILURE_FILES,
  injectMetaK2ReviewedRuntimeConfig,
  validateMetaK2PostActivationRetry,
  validateMetaK2PreactivationRetry,
  validateMetaK2SafeRouteProbe,
} from './lib/meta-k2-partial-staging-reviewed-launcher.js';
import {
  META_K2_PREVIEW_ALIAS_PREFIX,
  META_K2_PREVIEW_RECOVERY_CONFIRMATION,
  assertMetaK2PreviewRecoveryConfirmation,
  buildMetaK2PreviewRecoveryUrl,
  buildMetaK2PreviewRuntimeConfig,
  parseMetaK2PreviewUpload,
  validateMetaK2PreviewTransport,
} from './lib/meta-k2-preview-recovery.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import {
  readAccountWorkersDevSubdomain,
} from './woocommerce-worker-provider-diagnostics-preview-window.mjs';
import {
  assertWooCommercePreviewUrlActive,
  assertWooCommercePreviewUrlBaseline,
  assertWooCommercePreviewUrlRestored,
  buildWooCommercePreviewUrlMutation,
  parseWooCommercePreviewUrlState,
} from './lib/woocommerce-preview-url-window.js';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
  buildMetaD1OnlySnapshotSql,
  normalizeMetaD1OnlySnapshot,
} from './lib/meta-d1-only-rollout-operator.js';
import {
  META_K2_EXACT_RECOVERY_IDENTITY,
} from '../packages/config/src/meta-k2-exact-recovery-contract.js';
import {
  META_K2_RETAINED_OPERATION_HEAD,
  validateMetaK2ReviewedRepositoryState,
} from './lib/meta-k2-partial-staging-finalizer.js';

const repositoryRoot = realpathSync.native(process.cwd());
const finalizerPath = join(
  repositoryRoot,
  'scripts',
  'meta-k2-partial-staging-preview-finalizer.mjs',
);
const runtimeRoot = join(
  repositoryRoot,
  'outputs',
  'meta-k2-partial-staging-preview-runtime',
);
const runtimeConfigPath = join(runtimeRoot, 'wrangler.preview.absolute.jsonc');
const exactRecoveryRoot = join(
  repositoryRoot,
  'outputs',
  'meta-d1-only-rollout',
  META_K2_EXACT_RECOVERY_IDENTITY.targetKey,
  META_K2_EXACT_RECOVERY_IDENTITY.operationId,
  'exact-partial-staging-recovery-v1',
);
const workerName = 'social-mkt-sync-worker';
const databaseBinding = 'MKT_STATE_DB';

const execute = parseArgs(process.argv.slice(2));
if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    confirmation: META_K2_PREVIEW_RECOVERY_CONFIRMATION,
    executionTransport: 'preview_version_upload',
    previewWindow: {
      baseline: { workersDev: false, previewUrls: false },
      active: { workersDev: false, previewUrls: true },
      restored: { workersDev: false, previewUrls: false },
    },
    previewEntrypoint: 'exact POST recovery route only',
    productionWorkerDeployment: false,
    productionTrafficChange: false,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    executeArgument: '--execute',
  }, null, 2)}\n`);
  process.exit(0);
}

let currentStage = 'init';
let target = null;
let previewMutationAttempted = false;
let previewUrlsRestored = false;
let workersDevRestoredDisabled = false;
let previewSettingMutationAttemptCount = 0;
let previewSettingMutationCount = 0;
let workerVersionUploadCount = 0;
let recoveryArchive = null;
let primaryError = null;
let restoreError = null;

try {
  await main();
} catch (error) {
  primaryError = error;
} finally {
  if (target && previewMutationAttempted) {
    try {
      currentStage = 'automatic-preview-safe-close';
      await uploadPreviewVersion({
        configPath: runtimeConfigPath,
        label: 'meta-k2-outer-finally-safe-close',
      });
      currentStage = 'restore-preview-url-window';
      previewSettingMutationAttemptCount += 1;
      const restored = await writePreviewState(false, 'restore');
      assertWooCommercePreviewUrlRestored(restored);
      previewSettingMutationCount += 1;
      await waitForPreviewState(assertWooCommercePreviewUrlRestored, 'restore-readback');
      previewUrlsRestored = true;
      workersDevRestoredDisabled = true;
      await assertProductionVersionUnchanged();
    } catch (error) {
      restoreError = error;
    }
  }
  await rm(runtimeConfigPath, { force: true });
  await rm(runtimeRoot, { recursive: true, force: true });
}

if (primaryError || restoreError) {
  const error = restoreError ?? primaryError;
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_K2_PREVIEW_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    recoveryArchive: recoveryArchive?.archivePath ?? null,
    executionTransport: 'preview_version_upload',
    previewUrlsRestored,
    workersDevRestoredDisabled,
    previewSettingMutationAttemptCount,
    previewSettingMutationCount,
    workerVersionUploadCount,
    workerDeploymentCount: 0,
    productionTrafficChange: false,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'meta-k2-preview-recovery-window-closed',
    executionTransport: 'preview_version_upload',
    previewUrlsRestored: true,
    workersDevRestoredDisabled: true,
    previewSettingMutationAttemptCount,
    previewSettingMutationCount,
    workerVersionUploadCount,
    workerDeploymentCount: 0,
    productionDeploymentUnchanged: true,
    productionTrafficChange: false,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

async function main() {
  assertMetaK2PreviewRecoveryConfirmation(process.env);
  const repository = verifyReviewedRepository();
  verifyExactHeadCi(repository.repositoryHead);

  currentStage = 'load-private-environment';
  const devVarsPath = await resolveRepositoryFile(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
    'DEV_VARS_FILE',
  );
  await assertPrivateFile(devVarsPath, 'DEV_VARS_FILE');
  const devVars = await readDevVars(devVarsPath);
  const mergedEnv = { ...devVars, ...process.env };

  currentStage = 'materialize-preview-runtime-config';
  const baseConfigPath = await resolveRepositoryFile(
    process.env.MKT_META_K2_RECOVERY_BASE_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
    'MKT_META_K2_RECOVERY_BASE_WRANGLER_CONFIG',
  );
  const source = await readFile(baseConfigPath, 'utf8');
  const absolute = injectMetaHistoryConfig(
    source,
    META_HISTORY_2026_WINDOWS.ads,
    { baseDirectory: dirname(baseConfigPath) },
  );
  const reviewed = injectMetaK2ReviewedRuntimeConfig(absolute, mergedEnv);
  const previewConfig = buildMetaK2PreviewRuntimeConfig(reviewed.configText, {
    repositoryRoot,
  });
  if (previewConfig.trueFlags.length !== 0
    || reviewed.allFalseFlagCount !== META_D1_ONLY_REQUIRED_FALSE_FLAGS.length) {
    throw launcherError(
      'Meta K2 Preview bootstrap config is not the complete all-false baseline',
      'META_K2_PREVIEW_SAFE_BASELINE_INVALID',
      { trueFlags: previewConfig.trueFlags },
    );
  }
  await writePrivateText(runtimeConfigPath, previewConfig.text);

  currentStage = 'resolve-cloudflare-auth';
  const authEnv = cleanCloudflareEnvironment(mergedEnv);
  const whoami = runText('npx', ['wrangler', 'whoami', '--json'], authEnv);
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: authEnv.CLOUDFLARE_ACCOUNT_ID,
    configText: source,
    whoamiOutput: whoami,
  });
  const selectedEnv = { ...authEnv, CLOUDFLARE_ACCOUNT_ID: accountId };
  runText('npx', ['wrangler', 'whoami', '--account', accountId, '--json'], selectedEnv);
  const authOutput = selectedEnv.CLOUDFLARE_API_TOKEN
    ? null
    : runText('npx', ['wrangler', 'auth', 'token', '--json'], selectedEnv);
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: selectedEnv.CLOUDFLARE_API_TOKEN,
    authOutput,
  });
  const accountWorkersDevSubdomain = await readAccountWorkersDevSubdomain({
    accountId,
    bearerToken: auth.token,
  });

  currentStage = 'read-production-baseline';
  const productionBaselineVersion = readActiveVersion(selectedEnv);
  const productionTrueFlags = readActiveTrueFlags(selectedEnv, productionBaselineVersion);
  if (productionTrueFlags.length !== 0) {
    throw launcherError(
      'Meta K2 Preview recovery requires the Production Worker all-false baseline',
      'META_K2_PREVIEW_PRODUCTION_BASELINE_INVALID',
      { trueFlags: productionTrueFlags },
    );
  }

  const previewAlias = `${META_K2_PREVIEW_ALIAS_PREFIX}-${repository.repositoryHead.slice(0, 7)}-${randomBytes(3).toString('hex')}`;
  const recoveryUrl = buildMetaK2PreviewRecoveryUrl({
    previewAlias,
    accountWorkersDevSubdomain,
  });
  target = Object.freeze({
    env: selectedEnv,
    accountId,
    token: auth.token,
    accountWorkersDevSubdomain,
    previewAlias,
    recoveryUrl,
    productionBaselineVersion,
    repositoryHead: repository.repositoryHead,
    devVarsPath,
    baseConfigPath,
  });

  currentStage = 'preview-url-window-baseline';
  const baseline = assertWooCommercePreviewUrlBaseline(
    await readPreviewState('baseline'),
  );

  currentStage = 'enable-preview-url-window';
  previewMutationAttempted = true;
  previewSettingMutationAttemptCount += 1;
  const enabled = await writePreviewState(true, 'enable');
  assertWooCommercePreviewUrlActive(enabled);
  previewSettingMutationCount += 1;
  await waitForPreviewState(assertWooCommercePreviewUrlActive, 'enable-readback');

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'enable-preview-url-window',
    baseline,
    workersDevEnabled: false,
    previewUrlsEnabled: true,
    rawOriginPrinted: false,
    previewSettingMutationCount,
    productionDeploymentUnchanged: true,
    productionTrafficChange: false,
    queueMessageCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);

  currentStage = 'upload-safe-preview-bootstrap';
  const safeUpload = await uploadPreviewVersion({
    configPath: runtimeConfigPath,
    label: 'meta-k2-safe-preview-bootstrap',
  });
  await verifyVersionFlags(target.env, safeUpload.versionId, []);
  await assertProductionVersionUnchanged();

  currentStage = 'probe-safe-recovery-route';
  const safeRouteProbe = await probeSafeRecoveryRoute(target.recoveryUrl);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'probe-safe-recovery-route',
    ...safeRouteProbe,
    executionTransport: 'preview_version_upload',
    previewOriginFingerprint: safeUpload.previewOriginFingerprint,
    productionDeploymentUnchanged: true,
    productionTrafficChange: false,
    queueMessageCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);

  currentStage = 'archive-retryable-failure';
  recoveryArchive = await archiveExactRetryableFailureIfPresent(
    mergedEnv,
    safeRouteProbe,
  );
  if (recoveryArchive) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'archive-retryable-failure',
      archived: true,
      retryClass: recoveryArchive.retryClass,
      archivePath: recoveryArchive.archivePath,
      remoteMutationCount: recoveryArchive.remoteMutationCount,
      activeDeploymentCount: recoveryArchive.activeDeploymentCount,
      safeRestoreDeploymentCount: recoveryArchive.safeRestoreDeploymentCount,
      continuationHttpAttemptCount: recoveryArchive.continuationHttpAttemptCount,
      directUseCaseInvocationCount: recoveryArchive.directUseCaseInvocationCount,
      queueMessageCount: recoveryArchive.queueMessageCount,
      lifecycleSqlRepairCount: recoveryArchive.lifecycleSqlRepairCount,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }, null, 2)}\n`);
  }

  currentStage = 'run-preview-finalizer';
  const child = spawnSync(process.execPath, [finalizerPath, '--execute'], {
    cwd: repositoryRoot,
    env: {
      ...process.env,
      DEV_VARS_FILE: devVarsPath,
      MKT_META_K2_RECOVERY_WRANGLER_CONFIG: runtimeConfigPath,
      MKT_META_K2_EXACT_RECOVERY_URL: recoveryUrl,
      MKT_META_K2_PREVIEW_ALIAS: previewAlias,
      MKT_META_K2_PREVIEW_SUBDOMAIN: accountWorkersDevSubdomain,
      MKT_META_K2_PRODUCTION_BASELINE_VERSION: productionBaselineVersion,
    },
    stdio: 'inherit',
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw launcherError(
      'Meta K2 Preview finalizer failed',
      'META_K2_PREVIEW_FINALIZER_FAILED',
      { exitCode: child.status },
    );
  }

  currentStage = 'verify-production-unchanged-after-finalizer';
  await assertProductionVersionUnchanged();
}

async function uploadPreviewVersion(input) {
  const outputPath = join(
    runtimeRoot,
    `.wrangler-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}.ndjson`,
  );
  try {
    const stdout = runText('npx', [
      'wrangler', 'versions', 'upload', '--config', input.configPath,
      '--preview-alias', target.previewAlias,
      '--message', `${input.label} git=${target.repositoryHead}`,
    ], {
      ...target.env,
      WRANGLER_OUTPUT_FILE_PATH: outputPath,
    });
    workerVersionUploadCount += 1;
    const outputText = await readFile(outputPath, 'utf8').catch(() => '');
    const upload = parseMetaK2PreviewUpload(outputText, stdout, {
      previewAlias: target.previewAlias,
      accountWorkersDevSubdomain: target.accountWorkersDevSubdomain,
    });
    if (new URL(upload.previewOrigin).origin !== new URL(target.recoveryUrl).origin) {
      throw launcherError(
        'Uploaded Preview origin differs from the deterministic recovery origin',
        'META_K2_PREVIEW_ORIGIN_MISMATCH',
      );
    }
    const currentVersion = readActiveVersion(target.env);
    validateMetaK2PreviewTransport({
      productionBaselineVersion: target.productionBaselineVersion,
      productionCurrentVersion: currentVersion,
      previewVersion: upload.versionId,
    });
    return upload;
  } finally {
    await rm(outputPath, { force: true });
  }
}

async function probeSafeRecoveryRoute(recoveryUrl) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);
  try {
    const response = await fetch(recoveryUrl, {
      method: 'POST',
      headers: {
        authorization: 'Bearer meta-k2-safe-preview-probe-only',
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: '{}',
      redirect: 'manual',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return validateMetaK2SafeRouteProbe({
      status: response.status,
      redirected: response.redirected,
      body,
    });
  } catch (error) {
    if (error?.code) throw error;
    throw launcherError(
      'Meta K2 safe Preview route probe failed',
      'META_K2_PREVIEW_SAFE_ROUTE_PROBE_FAILED',
      { errorName: error instanceof Error ? error.name : typeof error },
    );
  } finally {
    clearTimeout(timer);
  }
}

async function archiveExactRetryableFailureIfPresent(env, safeRouteProbe) {
  try {
    const value = await stat(exactRecoveryRoot);
    if (!value.isDirectory()) {
      throw launcherError(
        'Exact Meta K2 recovery root must be a directory',
        'META_K2_PREVIEW_RETRY_INVALID',
      );
    }
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }

  const entries = await readdir(exactRecoveryRoot, { withFileTypes: true });
  if (entries.some((entry) => !entry.isFile())) {
    throw launcherError(
      'Exact Meta K2 recovery root contains a non-file entry',
      'META_K2_PREVIEW_RETRY_INVALID',
      { fileNames: entries.map((entry) => entry.name).sort() },
    );
  }
  const fileNames = entries.map((entry) => entry.name).sort();
  const backupPath = join(exactRecoveryRoot, 'meta-k2-before-recovery.sql');
  const common = {
    fileNames,
    retainedEvidence: await readJson(join(
      exactRecoveryRoot,
      'retained-evidence-admission.json',
    )),
    stabilityEvidence: await readJson(join(
      exactRecoveryRoot,
      'read-only-stability.json',
    )),
    backupEvidence: await readJson(join(exactRecoveryRoot, 'backup.json')),
    backupBytes: await readFile(backupPath),
    expectedBackupFile: relative(repositoryRoot, backupPath),
  };

  let validation;
  let archiveLabel;
  if (sameFileNames(fileNames, META_K2_PREACTIVATION_FAILURE_FILES)) {
    validation = validateMetaK2PreactivationRetry(common, env);
    archiveLabel = 'preactivation-failed';
  } else if (sameFileNames(fileNames, META_K2_POST_ACTIVATION_FAILURE_FILES)) {
    validation = validateMetaK2PostActivationRetry({
      ...common,
      deployEvidence: await readJson(join(
        exactRecoveryRoot,
        'deploy-d1-continuation.json',
      )),
      verifyDeployEvidence: await readJson(join(
        exactRecoveryRoot,
        'verify-d1-continuation.json',
      )),
      restoreEvidence: await readJson(join(
        exactRecoveryRoot,
        'restore-after-d1.json',
      )),
      verifyRestoreEvidence: await readJson(join(
        exactRecoveryRoot,
        'verify-restore-after-d1.json',
      )),
      currentSnapshot: readD1Snapshot(target.env),
      currentActiveTrueFlags: readActiveTrueFlags(
        target.env,
        target.productionBaselineVersion,
      ),
      safeRouteProbe,
    }, env);
    archiveLabel = 'postactivation-no-business-failed';
  } else {
    throw launcherError(
      'Exact Meta K2 recovery root is not a reviewed retry footprint',
      'META_K2_PREVIEW_RETRY_INVALID',
      { fileNames },
    );
  }

  const archivePath = `${exactRecoveryRoot}-${archiveLabel}-${Date.now()}`;
  await rename(exactRecoveryRoot, archivePath);
  return Object.freeze({
    ...validation,
    archivePath: relative(repositoryRoot, archivePath),
  });
}

function readD1Snapshot(env) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'd1', 'execute', databaseBinding, '--remote', '--json',
    '--config', runtimeConfigPath,
    '--command', buildMetaD1OnlySnapshotSql(META_K2_EXACT_RECOVERY_IDENTITY),
  ], env));
  const row = Array.isArray(value)
    ? value.flatMap((entry) => entry?.results ?? [])[0]
    : value?.results?.[0];
  if (!row) {
    throw launcherError(
      'Remote D1 recovery retry query returned no row',
      'META_K2_PREVIEW_D1_QUERY_EMPTY',
    );
  }
  return normalizeMetaD1OnlySnapshot(row);
}

function readActiveVersion(env) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status',
    '--name', workerName,
    '--config', runtimeConfigPath,
    '--json',
  ], env));
  const status = Array.isArray(value) ? value[0] : value;
  const active = (Array.isArray(status?.versions) ? status.versions : [])
    .filter((entry) => Number(entry?.percentage) === 100);
  if (active.length !== 1 || !active[0]?.version_id) {
    throw launcherError(
      'Worker does not have exactly one 100% active Production version',
      'META_K2_PREVIEW_ACTIVE_VERSION_INVALID',
    );
  }
  return active[0].version_id;
}

function readActiveTrueFlags(env, versionId) {
  const value = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', versionId,
    '--name', workerName,
    '--config', runtimeConfigPath,
    '--json',
  ], env));
  return readEnabledFlags(value);
}

async function verifyVersionFlags(env, versionId, expectedTrueFlags) {
  const observed = readActiveTrueFlags(env, versionId);
  if (stableJson(observed) !== stableJson([...expectedTrueFlags].sort())) {
    throw launcherError(
      'Meta K2 Preview version flags differ from the exact safe baseline',
      'META_K2_PREVIEW_FLAG_DRIFT',
      { observed, expected: expectedTrueFlags },
    );
  }
  await assertProductionVersionUnchanged();
}

async function assertProductionVersionUnchanged() {
  if (!target) return true;
  const current = readActiveVersion(target.env);
  if (current !== target.productionBaselineVersion) {
    throw launcherError(
      'Production Worker deployment changed during Meta K2 Preview recovery',
      'META_K2_PREVIEW_PRODUCTION_VERSION_DRIFT',
    );
  }
  const trueFlags = readActiveTrueFlags(target.env, current);
  if (trueFlags.length !== 0) {
    throw launcherError(
      'Production Worker flags changed during Meta K2 Preview recovery',
      'META_K2_PREVIEW_PRODUCTION_FLAG_DRIFT',
      { trueFlags },
    );
  }
  return true;
}

async function readPreviewState(label) {
  const response = await fetch(workerSubdomainEndpoint(), {
    method: 'GET',
    headers: {
      authorization: `Bearer ${target.token}`,
      accept: 'application/json',
    },
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw launcherError(
      `Cloudflare Worker Preview URL state read failed during ${label}`,
      'META_K2_PREVIEW_WINDOW_READ_FAILED',
      { label, httpStatus: response.status, errorCodes: readErrorCodes(body) },
    );
  }
  return parseWooCommercePreviewUrlState(body, label);
}

async function writePreviewState(previewsEnabled, label) {
  const response = await fetch(workerSubdomainEndpoint(), {
    method: 'POST',
    headers: {
      authorization: `Bearer ${target.token}`,
      accept: 'application/json',
      'content-type': 'application/json',
    },
    body: JSON.stringify(buildWooCommercePreviewUrlMutation(previewsEnabled)),
    redirect: 'error',
    signal: AbortSignal.timeout(30_000),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw launcherError(
      `Cloudflare Worker Preview URL state mutation failed during ${label}`,
      label === 'restore'
        ? 'META_K2_PREVIEW_WINDOW_RESTORE_FAILED'
        : 'META_K2_PREVIEW_WINDOW_ENABLE_FAILED',
      { label, httpStatus: response.status, errorCodes: readErrorCodes(body) },
    );
  }
  return parseWooCommercePreviewUrlState(body, label);
}

async function waitForPreviewState(assertion, label) {
  const delays = [0, 500, 1_000, 2_000, 3_000];
  let lastError = null;
  for (const delay of delays) {
    if (delay > 0) await sleep(delay);
    try {
      return assertion(await readPreviewState(label));
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError ?? launcherError(
    `Preview URL state did not converge during ${label}`,
    'META_K2_PREVIEW_WINDOW_STATE_UNSTABLE',
    { label },
  );
}

function workerSubdomainEndpoint() {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId)}`
    + `/workers/scripts/${encodeURIComponent(workerName)}/subdomain`;
}

function verifyReviewedRepository() {
  currentStage = 'exact-clean-reviewed-head';
  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  const branch = gitText(['branch', '--show-current']);
  const originReviewedHead = gitText([
    'rev-parse',
    'origin/integration/all-meta-end-to-end-completion-v1',
  ]);
  const reviewedHead = requireFullSha(
    process.env.MKT_META_HISTORY_REVIEW_WRAPPER_HEAD,
    'MKT_META_HISTORY_REVIEW_WRAPPER_HEAD',
  );
  const reviewBase = requireFullSha(
    process.env.MKT_META_HISTORY_REVIEW_BASE_MAIN_HEAD,
    'MKT_META_HISTORY_REVIEW_BASE_MAIN_HEAD',
  );
  const originMain = gitText(['rev-parse', 'origin/main']);
  const dirty = gitText(['status', '--porcelain', '--untracked-files=all'], false);
  return validateMetaK2ReviewedRepositoryState({
    branch,
    repositoryHead,
    reviewedHead,
    originReviewedHead,
    retainedHead: META_K2_RETAINED_OPERATION_HEAD,
    retainedHeadIsAncestor: gitSucceeds([
      'merge-base', '--is-ancestor', META_K2_RETAINED_OPERATION_HEAD, repositoryHead,
    ]),
    reviewBaseIsAncestor: gitSucceeds([
      'merge-base', '--is-ancestor', reviewBase, repositoryHead,
    ]) && gitSucceeds(['merge-base', '--is-ancestor', reviewBase, originMain]),
    clean: dirty.trim() === '',
  });
}

function verifyExactHeadCi(repositoryHead) {
  if (process.env.MKT_META_K2_EXACT_HEAD_CI !== 'PASS'
    || process.env.MKT_META_K2_EXACT_HEAD_CI_SHA !== repositoryHead) {
    throw launcherError(
      'Meta K2 Preview recovery requires exact-head CI attestation',
      'META_K2_PREVIEW_EXACT_HEAD_CI_REQUIRED',
    );
  }
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw launcherError(
      'Unsupported Meta K2 Preview recovery argument',
      'META_K2_PREVIEW_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
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

function runText(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw launcherError(
      `Command failed: ${command} ${args.join(' ')}`,
      'META_K2_PREVIEW_COMMAND_FAILED',
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

function readEnabledFlags(value) {
  const flags = new Map();
  walk(value, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, nested] of Object.entries(node)) {
      if (/^MKT_[A-Z0-9_]+_ENABLED$/u.test(key)) {
        flags.set(key, booleanLike(nested));
      }
    }
    if (typeof node.name === 'string'
      && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(node.name)) {
      flags.set(
        node.name,
        booleanLike(node.text ?? node.value ?? node.json ?? node.data),
      );
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
    throw launcherError(
      `${fieldName} must resolve inside the Repository`,
      'META_K2_PREVIEW_PATH_INVALID',
      { fieldName },
    );
  }
  const valueStat = await stat(canonical);
  if (!valueStat.isFile()) {
    throw launcherError(
      `${fieldName} must be a regular file`,
      'META_K2_PREVIEW_FILE_INVALID',
      { fieldName },
    );
  }
  return canonical;
}

async function assertPrivateFile(path, fieldName) {
  const valueStat = await stat(path);
  if ((valueStat.mode & 0o077) !== 0) {
    throw launcherError(
      `${fieldName} must not be readable by group or others`,
      'META_K2_PREVIEW_PRIVATE_FILE_INVALID',
      { fieldName },
    );
  }
}

async function readJson(path) {
  return JSON.parse(await readFile(path, 'utf8'));
}

async function writePrivateText(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, value, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function sameFileNames(observed, expected) {
  return stableJson([...observed].sort()) === stableJson([...expected].sort());
}

function readErrorCodes(body) {
  return Array.isArray(body?.errors)
    ? body.errors.map((entry) => entry?.code ?? null).filter((value) => value !== null)
    : [];
}

function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw launcherError(
      `${fieldName} must be a full SHA`,
      'META_K2_PREVIEW_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw launcherError(
      `${fieldName} is required`,
      'META_K2_PREVIEW_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function stableJson(value) {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((key) => (
      `${JSON.stringify(key)}:${stableJson(value[key])}`
    )).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function sanitize(value, key = '') {
  if (value === null || value === undefined) return value ?? null;
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (typeof value !== 'object') {
    return /token|authorization|account|zone|hostname|subdomain|origin|url|secret|credential/iu.test(key)
      ? '[REDACTED]'
      : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    sanitize(nestedValue, nestedKey),
  ]));
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

function launcherError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK2PreviewRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
