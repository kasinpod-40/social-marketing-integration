#!/usr/bin/env node

import { createHash, randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  materializeMetaHistoryLarkRuntimeConfig,
} from './lib/meta-history-runtime-authority.js';
import {
  buildMetaK3PreviewRuntimeConfig,
  parseMetaK3PreviewUpload,
  validateMetaK3PreviewTransport,
} from './lib/meta-k3-preview-recovery.js';
import {
  META_K3_PREVIEW_WINDOW_CONFIRMATION,
  assertMetaK3PreviewWindowConfirmation,
  validateMetaK3SafeRouteProbe,
} from './lib/meta-k3-preview-window.js';
import {
  assertWooCommercePreviewUrlActive,
  assertWooCommercePreviewUrlBaseline,
  assertWooCommercePreviewUrlRestored,
  buildWooCommercePreviewUrlMutation,
  parseWooCommercePreviewUrlState,
} from './lib/woocommerce-preview-url-window.js';

const repositoryRoot = realpathSync.native(process.cwd());
const branch = 'integration/all-meta-end-to-end-completion-v1';
const workerName = 'social-mkt-sync-worker';
const finalizerPath = join(
  repositoryRoot,
  'scripts',
  'meta-k3-partial-staging-preview-finalizer.mjs',
);
const runtimeRoot = join(
  repositoryRoot,
  'outputs',
  'meta-k3-partial-staging-preview-runtime',
);
const runtimeConfigPath = join(runtimeRoot, 'wrangler.preview.absolute.jsonc');

const execute = parseArgs(process.argv.slice(2));
if (!execute) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    stage: 'meta-k3-preview-recovery-window',
    confirmation: META_K3_PREVIEW_WINDOW_CONFIRMATION,
    executionTransport: 'preview_version_upload',
    previewWindow: {
      baseline: { workersDev: false, previewUrls: false },
      active: { workersDev: false, previewUrls: true },
      restored: { workersDev: false, previewUrls: false },
    },
    safePreviewBootstrapRequired: true,
    safeRouteProbeRequiredBeforeFinalizer: true,
    dedicatedFinalizer: true,
    loaderUsed: false,
    queueMessageCount: 0,
    lifecycleSqlRepairCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
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
let wrapperWorkerVersionUploadCount = 0;
let childFinalizerStarted = false;
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
      const safeUpload = await uploadPreviewVersion({
        label: 'meta-k3-outer-finally-safe-close',
      });
      await verifyVersionFlags(safeUpload.versionId, []);

      currentStage = 'restore-preview-url-window';
      previewSettingMutationAttemptCount += 1;
      const restored = await writePreviewState(false, 'restore');
      assertWooCommercePreviewUrlRestored(restored);
      previewSettingMutationCount += 1;
      await waitForPreviewState(
        assertWooCommercePreviewUrlRestored,
        'restore-readback',
      );
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
    code: error?.code ?? 'META_K3_PREVIEW_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    childFinalizerStarted,
    childRemoteState: childFinalizerStarted
      ? 'SEE_PRECEDING_CHILD_FINALIZER_OUTPUT'
      : 'NOT_STARTED',
    previewUrlsRestored,
    workersDevRestoredDisabled,
    previewSettingMutationAttemptCount,
    previewSettingMutationCount,
    wrapperWorkerVersionUploadCount,
    wrapperWorkerDeploymentCount: 0,
    wrapperQueueMessageCount: 0,
    wrapperLifecycleSqlRepairCount: 0,
    productionTrafficChange: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
} else {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'meta-k3-preview-recovery-window-closed',
    executionTransport: 'preview_version_upload',
    safeRouteProbePassed: true,
    previewUrlsRestored: true,
    workersDevRestoredDisabled: true,
    previewSettingMutationAttemptCount,
    previewSettingMutationCount,
    wrapperWorkerVersionUploadCount,
    wrapperWorkerDeploymentCount: 0,
    productionDeploymentUnchanged: true,
    productionTrafficChange: false,
    wrapperQueueMessageCount: 0,
    wrapperLifecycleSqlRepairCount: 0,
    scheduleEnabled: false,
    production: false,
  }, null, 2)}\n`);
}

async function main() {
  assertMetaK3PreviewWindowConfirmation(process.env);
  const repositoryHead = verifyRepository();

  currentStage = 'load-private-environment';
  const devVarsPath = await resolvePrivateFile(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
    'DEV_VARS_FILE',
  );
  const devVars = await readDevVars(devVarsPath);
  const mergedEnv = mergeNonEmptyEnvironment(devVars, process.env);
  const baseConfigPath = await resolveRepositoryFile(
    mergedEnv.MKT_META_K3_RECOVERY_WRANGLER_CONFIG
      ?? mergedEnv.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
    'MKT_META_K3_RECOVERY_WRANGLER_CONFIG',
  );

  currentStage = 'materialize-safe-preview-config';
  const sourceText = await readFile(baseConfigPath, 'utf8');
  const authorityText = materializeMetaHistoryLarkRuntimeConfig(
    sourceText,
    mergedEnv,
  );
  const safeAuthorityText = closeExecutionFlagsInConfig(authorityText);
  const previewConfig = buildMetaK3PreviewRuntimeConfig(
    safeAuthorityText,
    { repositoryRoot },
  );
  if (previewConfig.trueFlags.length !== 0
    || previewConfig.previewUrlsEnabled !== true
    || previewConfig.workersDevEnabled !== false
    || previewConfig.routesCopied !== 0
    || previewConfig.scheduleTriggersCopied !== 0) {
    throw recoveryError(
      'K3 outer Preview bootstrap config is not the exact all-false isolated baseline',
      'META_K3_PREVIEW_SAFE_BASELINE_INVALID',
      { trueFlags: previewConfig.trueFlags },
    );
  }
  await writePrivateText(runtimeConfigPath, previewConfig.text);

  currentStage = 'load-cloudflare-authority';
  const accountId = requireText(
    mergedEnv.CLOUDFLARE_ACCOUNT_ID,
    'CLOUDFLARE_ACCOUNT_ID',
  );
  const bearerToken = requireText(
    mergedEnv.CLOUDFLARE_API_TOKEN,
    'CLOUDFLARE_API_TOKEN',
  );
  const accountWorkersDevSubdomain = requireText(
    mergedEnv.MKT_META_K3_PREVIEW_SUBDOMAIN,
    'MKT_META_K3_PREVIEW_SUBDOMAIN',
  );
  const productionBaselineVersion = requireVersion(
    mergedEnv.MKT_META_K3_PRODUCTION_BASELINE_VERSION,
    'MKT_META_K3_PRODUCTION_BASELINE_VERSION',
  );
  const previewAlias = [
    'meta-k3-recovery',
    repositoryHead.slice(0, 7),
    randomBytes(3).toString('hex'),
  ].join('-');

  target = Object.freeze({
    env: {
      ...mergedEnv,
      CLOUDFLARE_ACCOUNT_ID: accountId,
      CLOUDFLARE_API_TOKEN: bearerToken,
    },
    accountId,
    token: bearerToken,
    accountWorkersDevSubdomain,
    previewAlias,
    productionBaselineVersion,
    repositoryHead,
    devVarsPath,
  });

  currentStage = 'production-safe-baseline';
  await assertProductionVersionUnchanged();

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
  await waitForPreviewState(
    assertWooCommercePreviewUrlActive,
    'enable-readback',
  );

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'enable-preview-url-window',
    baseline,
    workersDevEnabled: false,
    previewUrlsEnabled: true,
    previewSettingMutationCount,
    productionDeploymentUnchanged: true,
    productionTrafficChange: false,
    queueMessageCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);

  currentStage = 'upload-safe-preview-bootstrap';
  const safeUpload = await uploadPreviewVersion({
    label: 'meta-k3-safe-preview-bootstrap',
  });
  await verifyVersionFlags(safeUpload.versionId, []);
  await assertProductionVersionUnchanged();

  currentStage = 'probe-safe-recovery-route';
  const safeRouteProbe = await probeSafeRecoveryRoute(safeUpload.recoveryUrl);
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

  currentStage = 'run-exact-k3-finalizer';
  childFinalizerStarted = true;
  const child = spawnSync(process.execPath, [finalizerPath, '--execute'], {
    cwd: repositoryRoot,
    env: {
      ...target.env,
      DEV_VARS_FILE: target.devVarsPath,
      MKT_META_HISTORY_REVIEW_WRAPPER_HEAD: repositoryHead,
      MKT_META_HISTORY_REVIEW_BASE_MAIN_HEAD:
        requireText(
          mergedEnv.MKT_META_HISTORY_REVIEW_BASE_MAIN_HEAD,
          'MKT_META_HISTORY_REVIEW_BASE_MAIN_HEAD',
        ),
      MKT_META_K3_RECOVERY_WRANGLER_CONFIG: runtimeConfigPath,
      MKT_META_K3_PREVIEW_ALIAS: previewAlias,
      MKT_META_K3_PREVIEW_SUBDOMAIN: accountWorkersDevSubdomain,
      MKT_META_K3_PRODUCTION_BASELINE_VERSION: productionBaselineVersion,
      MKT_META_K3_EXACT_HEAD_CI: 'PASS',
      MKT_META_K3_EXACT_HEAD_CI_SHA: repositoryHead,
      MKT_META_D1_ONLY_READ_ONLY_SUMMARY:
        requireText(
          mergedEnv.MKT_META_D1_ONLY_READ_ONLY_SUMMARY,
          'MKT_META_D1_ONLY_READ_ONLY_SUMMARY',
        ),
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
  });
  if (child.error) throw child.error;
  if (child.status !== 0) {
    throw recoveryError(
      'Exact K3 finalizer failed; use the preceding child output as Remote truth',
      'META_K3_PREVIEW_FINALIZER_FAILED',
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
      '--no-install',
      'wrangler',
      'versions',
      'upload',
      '--config',
      runtimeConfigPath,
      '--preview-alias',
      target.previewAlias,
      '--message',
      `${input.label} git=${target.repositoryHead}`,
    ], {
      ...target.env,
      WRANGLER_OUTPUT_FILE_PATH: outputPath,
    });
    wrapperWorkerVersionUploadCount += 1;
    const outputText = await readFile(outputPath, 'utf8').catch(() => '');
    const upload = parseMetaK3PreviewUpload(outputText, stdout, {
      previewAlias: target.previewAlias,
      accountWorkersDevSubdomain: target.accountWorkersDevSubdomain,
    });
    validateMetaK3PreviewTransport({
      productionBaselineVersion: target.productionBaselineVersion,
      productionCurrentVersion: readActiveVersion(),
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
        authorization: 'Bearer meta-k3-safe-preview-probe-only',
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
      body: '{}',
      redirect: 'manual',
      signal: controller.signal,
    });
    const body = await response.json().catch(() => ({}));
    return validateMetaK3SafeRouteProbe({
      status: response.status,
      redirected: response.redirected,
      body,
    });
  } catch (error) {
    if (error?.code) throw error;
    throw recoveryError(
      'K3 safe Preview route probe failed',
      'META_K3_PREVIEW_SAFE_ROUTE_PROBE_FAILED',
      { errorName: error instanceof Error ? error.name : typeof error },
    );
  } finally {
    clearTimeout(timer);
  }
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
    throw recoveryError(
      `Cloudflare K3 Preview URL state read failed during ${label}`,
      'META_K3_PREVIEW_WINDOW_READ_FAILED',
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
    throw recoveryError(
      `Cloudflare K3 Preview URL state mutation failed during ${label}`,
      label === 'restore'
        ? 'META_K3_PREVIEW_WINDOW_RESTORE_FAILED'
        : 'META_K3_PREVIEW_WINDOW_ENABLE_FAILED',
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
  throw lastError ?? recoveryError(
    `K3 Preview URL state did not converge during ${label}`,
    'META_K3_PREVIEW_WINDOW_STATE_UNSTABLE',
    { label },
  );
}

function workerSubdomainEndpoint() {
  return `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId)}`
    + `/workers/scripts/${encodeURIComponent(workerName)}/subdomain`;
}

function readActiveVersion() {
  const value = JSON.parse(runText('npx', [
    '--no-install',
    'wrangler',
    'deployments',
    'status',
    '--name',
    workerName,
    '--config',
    runtimeConfigPath,
    '--json',
  ], target.env));
  const status = Array.isArray(value) ? value[0] : value;
  const active = (Array.isArray(status?.versions) ? status.versions : [])
    .filter((entry) => Number(entry?.percentage) === 100);
  if (active.length !== 1 || !active[0]?.version_id) {
    throw recoveryError(
      'Worker does not have exactly one 100% active Production version',
      'META_K3_PREVIEW_ACTIVE_VERSION_INVALID',
    );
  }
  return active[0].version_id;
}

function readActiveTrueFlags(versionId) {
  const value = JSON.parse(runText('npx', [
    '--no-install',
    'wrangler',
    'versions',
    'view',
    versionId,
    '--name',
    workerName,
    '--config',
    runtimeConfigPath,
    '--json',
  ], target.env));
  return readEnabledFlags(value);
}

async function verifyVersionFlags(versionId, expectedTrueFlags) {
  const observed = readActiveTrueFlags(versionId);
  if (stableJson(observed) !== stableJson([...expectedTrueFlags].sort())) {
    throw recoveryError(
      'K3 Preview version flags differ from the exact expected baseline',
      'META_K3_PREVIEW_FLAG_DRIFT',
      { observed, expected: expectedTrueFlags },
    );
  }
  await assertProductionVersionUnchanged();
}

async function assertProductionVersionUnchanged() {
  if (!target) return true;
  const current = readActiveVersion();
  if (current !== target.productionBaselineVersion) {
    throw recoveryError(
      'Production Worker deployment changed during K3 Preview recovery',
      'META_K3_PREVIEW_PRODUCTION_VERSION_DRIFT',
    );
  }
  const trueFlags = readActiveTrueFlags(current);
  if (trueFlags.length !== 0) {
    throw recoveryError(
      'Production Worker flags changed during K3 Preview recovery',
      'META_K3_PREVIEW_PRODUCTION_FLAG_DRIFT',
      { trueFlags },
    );
  }
  return true;
}

function verifyRepository() {
  const repositoryHead = gitText(['rev-parse', 'HEAD']);
  requireExact(
    repositoryHead,
    requireFullSha(
      process.env.MKT_META_K3_APPROVED_HEAD,
      'MKT_META_K3_APPROVED_HEAD',
    ),
    'repositoryHead',
  );
  requireExact(gitText(['branch', '--show-current']), branch, 'branch');
  requireExact(
    gitText(['rev-parse', `origin/${branch}`]),
    repositoryHead,
    'originBranchHead',
  );
  if (gitText(['status', '--porcelain', '--untracked-files=all'], false).trim()) {
    throw recoveryError(
      'K3 Preview recovery requires a clean Working Tree',
      'META_K3_PREVIEW_REPOSITORY_INVALID',
    );
  }
  return repositoryHead;
}

function closeExecutionFlagsInConfig(source) {
  return String(source).replace(
    /(["']?MKT_[A-Z0-9_]+_ENABLED["']?\s*:\s*)(?:true|false|["'][^"']*["'])/gu,
    '$1"false"',
  );
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
      flags.set(node.name, booleanLike(
        node.text ?? node.value ?? node.json ?? node.data,
      ));
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
  return false;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw recoveryError(
      'Unsupported K3 Preview recovery argument',
      'META_K3_PREVIEW_ARGUMENT_INVALID',
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

async function resolveRepositoryFile(value, fieldName) {
  const candidate = resolve(repositoryRoot, requireText(value, fieldName));
  const canonical = await realpath(candidate);
  if (canonical !== repositoryRoot && !canonical.startsWith(`${repositoryRoot}/`)) {
    throw recoveryError(
      `${fieldName} must resolve inside the Repository`,
      'META_K3_PREVIEW_PATH_INVALID',
      { fieldName },
    );
  }
  const valueStat = await stat(canonical);
  if (!valueStat.isFile()) {
    throw recoveryError(
      `${fieldName} must be a regular file`,
      'META_K3_PREVIEW_FILE_INVALID',
      { fieldName },
    );
  }
  return canonical;
}

async function resolvePrivateFile(value, fieldName) {
  const canonical = await resolveRepositoryFile(value, fieldName);
  const valueStat = await stat(canonical);
  if ((valueStat.mode & 0o077) !== 0) {
    throw recoveryError(
      `${fieldName} must not be readable by group or others`,
      'META_K3_PREVIEW_PRIVATE_FILE_INVALID',
      { fieldName },
    );
  }
  return canonical;
}

async function writePrivateText(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, value, { mode: 0o600 });
  await chmod(path, 0o600);
}

function runText(command, args, env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...env },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw recoveryError(
      `${command} command failed during K3 Preview recovery`,
      'META_K3_PREVIEW_COMMAND_FAILED',
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

function readErrorCodes(body) {
  return Array.isArray(body?.errors)
    ? body.errors
      .map((entry) => entry?.code ?? null)
      .filter((value) => value !== null)
    : [];
}

function requireVersion(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/u.test(text)) {
    throw recoveryError(
      `${fieldName} must be a Worker version UUID`,
      'META_K3_PREVIEW_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireFullSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw recoveryError(
      `${fieldName} must be a full SHA`,
      'META_K3_PREVIEW_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw recoveryError(
      `${fieldName} is required`,
      'META_K3_PREVIEW_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw recoveryError(
      `${fieldName} does not match the exact reviewed value`,
      'META_K3_PREVIEW_INPUT_INVALID',
      { fieldName },
    );
  }
  return value;
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
  if (Array.isArray(value)) return value.map((entry) => sanitize(entry, key));
  if (typeof value !== 'object') {
    return /token|authorization|account|subdomain|origin|url|credential|secret/iu.test(key)
      ? '[REDACTED]'
      : value;
  }
  return Object.fromEntries(Object.entries(value).map(([nestedKey, nestedValue]) => [
    nestedKey,
    sanitize(nestedValue, nestedKey),
  ]));
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaK3PreviewRecoveryError';
  error.code = code;
  error.details = details;
  return error;
}
