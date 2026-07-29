#!/usr/bin/env node

import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { readDevVars } from './lib/dev-vars.js';
import {
  WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG,
  WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIRMATION,
  assertWooCommerceWorkerProviderDiagnosticsConfirmation,
  buildWooCommerceWorkerProviderDiagnosticConfigs,
  parseWooCommerceWorkerProviderDiagnosticsArgs,
  parseWooCommerceWorkerSecretNames,
  validateWooCommerceDiagnosticsAttestation,
  validateWooCommerceWorkerProviderDiagnosticResponse,
} from './lib/woocommerce-worker-provider-diagnostics.js';
import {
  createWooCommerceDiagnosticsAttestedFetch,
} from './lib/woocommerce-diagnostics-attested-fetch.js';
import {
  buildWooCommerceDiagnosticsPreviewOrigin,
  parseWooCommerceDiagnosticsPreviewUpload,
} from './lib/woocommerce-diagnostics-preview-upload.js';

const repositoryRoot = resolve(process.cwd());
const evidenceRoot = resolve(
  process.env.MKT_WOOCOMMERCE_WORKER_DIAGNOSTICS_EVIDENCE_DIR
    ?? 'outputs/woocommerce-worker-provider-diagnostics',
);
const RESPONSE_MAX_BYTES = 64 * 1024;
const WORKER_NAME_DEFAULT = 'social-mkt-sync-worker';
const WORKERS_DEV_SUBDOMAIN_ENV = 'MKT_WOOCOMMERCE_WORKERS_DEV_SUBDOMAIN';
const TRUE_FLAG_PATTERN = /^MKT_[A-Z0-9_]+_ENABLED$/u;
const PREVIEW_ALIAS_PREFIX = 'woo-provider-diag';
const attestedFetch = createWooCommerceDiagnosticsAttestedFetch(globalThis.fetch.bind(globalThis));

let target = null;
let configs = null;
let productionBaselineVersion = null;
let previewAlias = null;
let activePreviewUploadAttempted = false;
let workerVersionUploadCount = 0;
let providerRequestAttemptCount = 0;
let providerRequestCount = 0;

try {
  await main();
} catch (error) {
  const automaticPreviewSafeClose = await attemptAutomaticPreviewSafeClose();
  const productionDeploymentUnchanged = productionDeploymentUnchangedOrFalse();
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'woocommerce-worker-provider-diagnostics',
    code: error?.code ?? 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_FAILED',
    message: redactDiagnosticMessage(error instanceof Error ? error.message : String(error)),
    details: sanitize(error?.details ?? {}),
    automaticPreviewSafeClose,
    productionDeploymentUnchanged,
    productionBaselineVersion,
    providerRequestAttemptCount,
    providerRequestCount: providerRequestAttemptCount === 0 ? 0 : providerRequestCount || null,
    providerMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    workerVersionUploadCount,
    larkRequestCount: 0,
    scheduleMutationCount: 0,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  const options = parseWooCommerceWorkerProviderDiagnosticsArgs(process.argv.slice(2));
  if (!options.execute) {
    printPlan();
    return;
  }

  const env = Object.freeze({
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  });
  assertWooCommerceWorkerProviderDiagnosticsConfirmation(env);
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  const repository = assertRepositoryState();
  const configPath = resolveRepositoryFile(
    env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const sourceText = await readFile(configPath, 'utf8');
  configs = buildWooCommerceWorkerProviderDiagnosticConfigs(sourceText, {
    repositoryRoot,
    sourceConfigPath: relative(repositoryRoot, configPath),
    activeAttestation: randomBytes(32).toString('hex'),
    safeAttestation: randomBytes(32).toString('hex'),
  });
  const workerName = env.MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME ?? WORKER_NAME_DEFAULT;
  requireExact(configs.workerName, workerName, 'Worker config name');
  const accountWorkersDevSubdomain = requireText(
    env[WORKERS_DEV_SUBDOMAIN_ENV],
    WORKERS_DEV_SUBDOMAIN_ENV,
  );
  previewAlias = `${PREVIEW_ALIAS_PREFIX}-${randomBytes(5).toString('hex')}`;
  buildWooCommerceDiagnosticsPreviewOrigin({
    previewAlias,
    workerName,
    accountWorkersDevSubdomain,
  });
  target = Object.freeze({
    repositoryHead: repository.head,
    workerName,
    configPath,
    operatorToken: requireSecret(env.MKT_CONNECTION_OPERATOR_TOKEN, 'MKT_CONNECTION_OPERATOR_TOKEN'),
    pathname: configs.pathname,
    accountWorkersDevSubdomain,
  });

  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const preflight = await runPreflight();
  productionBaselineVersion = preflight.productionActiveVersion;
  await writeEvidence('01-preflight', preflight);

  activePreviewUploadAttempted = true;
  const activeUpload = await uploadPreviewVersion({
    label: 'provider-diagnostics-active-preview',
    configText: configs.active,
    alias: previewAlias,
  });
  const active = await verifyPreviewVersionAndProbe({
    label: 'provider-diagnostics-active-preview',
    upload: activeUpload,
    expectedStatus: 401,
    expectedTrueFlags: [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG],
    expectedAttestation: configs.activeAttestation,
  });
  await writeEvidence('02-active-preview-version', active);

  providerRequestAttemptCount = 1;
  const response = await fetchAuthenticatedDiagnostic(
    activeUpload.previewOrigin,
    configs.activeAttestation,
  );
  const body = await readBoundedJson(response, RESPONSE_MAX_BYTES);
  const diagnostic = validateWooCommerceWorkerProviderDiagnosticResponse(response.status, body);
  providerRequestCount = Number(diagnostic.providerRequestCount);
  await writeEvidence('03-provider-diagnostic', {
    previewVersionId: active.versionId,
    httpStatus: response.status,
    result: diagnostic,
  });

  const safeUpload = await uploadPreviewVersion({
    label: 'provider-diagnostics-safe-preview',
    configText: configs.safe,
    alias: previewAlias,
  });
  const safe = await verifyPreviewVersionAndProbe({
    label: 'provider-diagnostics-safe-preview',
    upload: safeUpload,
    expectedStatus: 404,
    expectedTrueFlags: [],
    expectedAttestation: configs.safeAttestation,
  });
  activePreviewUploadAttempted = false;
  await writeEvidence('04-safe-preview-close', safe);

  assertProductionDeploymentUnchanged();
  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-worker-provider-diagnostics',
    repositoryHead: target.repositoryHead,
    productionBaselineVersion,
    productionDeploymentUnchanged: true,
    activeDiagnosticPreviewVersion: active.versionId,
    closedSafePreviewVersion: safe.versionId,
    diagnosticHttpStatus: response.status,
    diagnostic,
    providerRequestAttemptCount,
    providerRequestCount,
    providerMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount: 0,
    workerVersionUploadCount,
    larkRequestCount: 0,
    scheduleMutationCount: 0,
    previewAliasClosedSafe: true,
    safeHttpClosureAttested: true,
    evidenceRoot: relative(repositoryRoot, evidenceRoot),
  }, null, 2)}\n`);
}

async function attemptAutomaticPreviewSafeClose() {
  if (!activePreviewUploadAttempted || !target || !configs || !previewAlias) return null;
  try {
    const safeUpload = await uploadPreviewVersion({
      label: 'automatic-preview-safe-close',
      configText: configs.safe,
      alias: previewAlias,
    });
    const result = await verifyPreviewVersionAndProbe({
      label: 'automatic-preview-safe-close',
      upload: safeUpload,
      expectedStatus: 404,
      expectedTrueFlags: [],
      expectedAttestation: configs.safeAttestation,
    });
    activePreviewUploadAttempted = false;
    return result;
  } catch (closeError) {
    return {
      ok: false,
      code: closeError?.code
        ?? 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PREVIEW_SAFE_CLOSE_FAILED',
      message: redactDiagnosticMessage(
        closeError instanceof Error ? closeError.message : String(closeError),
      ),
      productionDeploymentUnchanged: productionDeploymentUnchangedOrFalse(),
      details: sanitize(closeError?.details ?? {}),
    };
  }
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    stage: 'woocommerce-worker-provider-diagnostics-plan',
    confirmation: WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIRMATION,
    phases: [
      'local-and-remote-read-only-preflight',
      'upload-isolated-diagnostic-preview-version-without-deployment',
      'attested-preview-401-proof',
      'one-authenticated-system-status-get',
      'upload-isolated-safe-preview-version-to-same-alias',
      'attested-preview-404-closure-proof',
      'verify-production-deployment-unchanged',
    ],
    remoteMutations: {
      workerDeployments: 0,
      workerVersionUploads: 2,
      productionTrafficChanges: 0,
      queueMessages: 0,
      d1Writes: 0,
      larkRequests: 0,
      scheduleMutations: 0,
      secretMutations: 0,
    },
  }, null, 2)}\n`);
}

async function runPreflight() {
  await dryRunConfig(configs.safe, 'safe-preview');
  await dryRunConfig(configs.active, 'active-preview');
  runText('npx', ['wrangler', 'whoami']);
  const secretNames = parseWooCommerceWorkerSecretNames(runText('npx', [
    'wrangler', 'secret', 'list', '--name', target.workerName,
    '--config', target.configPath, '--format', 'json',
  ]));
  const productionActiveVersion = readProductionActiveVersion();
  assertExactFlags(readTrueFlags(readVersionView(productionActiveVersion)), []);
  return Object.freeze({
    repositoryHead: target.repositoryHead,
    productionActiveVersion,
    productionCurrentTrueFlags: [],
    secretNameFingerprint: sha256(JSON.stringify(secretNames)),
    safePreviewConfigSha256: configs.safeSha256,
    activePreviewConfigSha256: configs.activeSha256,
    sourceConfigSha256: configs.bundleSourceSha256,
    previewEntrypointFingerprint: sha256(configs.previewEntrypoint),
    activeAttestationFingerprint: sha256(configs.activeAttestation),
    safeAttestationFingerprint: sha256(configs.safeAttestation),
    previewUrlsEnabled: configs.previewUrlsEnabled,
    productionRoutesCopied: configs.productionRoutesCopied,
    productionBindingsCopied: configs.productionBindingsCopied,
    secretValuesCopied: configs.secretValuesCopied,
    providerRequestCount: 0,
    workerDeploymentCount: 0,
    workerVersionUploadCount: 0,
  });
}

async function dryRunConfig(configText, label) {
  await withGeneratedConfig(configText, async (configPath) => {
    runText('npx', [
      'wrangler', 'versions', 'upload', '--dry-run', '--config', configPath,
    ], { label: `dry-run-${label}` });
  });
}

async function uploadPreviewVersion(input) {
  return withGeneratedConfig(input.configText, async (configPath) => (
    withWranglerOutput(async (outputPath) => {
      const stdout = runText('npx', [
        'wrangler', 'versions', 'upload', '--config', configPath,
        '--preview-alias', input.alias,
        '--message', `woocommerce_worker_provider_diagnostics stage=${input.label} git=${target.repositoryHead}`,
      ], {
        label: input.label,
        env: { WRANGLER_OUTPUT_FILE_PATH: outputPath },
      });
      workerVersionUploadCount += 1;
      const outputText = await readFile(outputPath, 'utf8').catch(() => '');
      return Object.freeze({
        ...parseWooCommerceDiagnosticsPreviewUpload(outputText, stdout, {
          previewAlias: input.alias,
          workerName: target.workerName,
          accountWorkersDevSubdomain: target.accountWorkersDevSubdomain,
        }),
        label: input.label,
        configSha256: sha256(input.configText),
      });
    })
  ));
}

async function verifyPreviewVersionAndProbe(input) {
  assertExactFlags(readTrueFlags(readVersionView(input.upload.versionId)), input.expectedTrueFlags);
  assertProductionDeploymentUnchanged();
  const routeStatuses = [];
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const response = await attestedRouteFetch(
      input.upload.previewOrigin,
      input.expectedAttestation,
      { authenticated: false },
    );
    routeStatuses.push(response.status);
  }
  if (!routeStatuses.every((statusCode) => statusCode === input.expectedStatus)) {
    throw failure(
      'WooCommerce diagnostics Preview route did not reach the expected stable status',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ROUTE_UNSTABLE',
      {
        expectedStatus: input.expectedStatus,
        routeStatuses,
        previewVersionId: input.upload.versionId,
      },
    );
  }
  return Object.freeze({
    ok: true,
    label: input.label,
    versionId: input.upload.versionId,
    previewOriginFingerprint: input.upload.previewOriginFingerprint,
    wranglerPreviewUrlCrossCheckCount: input.upload.wranglerPreviewUrlCrossCheckCount,
    configSha256: input.upload.configSha256,
    expectedTrueFlags: Object.freeze([...input.expectedTrueFlags].sort()),
    routeStatuses: Object.freeze(routeStatuses),
    previewVersionFlagsVerified: true,
    previewHttpAttested: true,
    productionDeploymentUnchanged: true,
  });
}

async function fetchAuthenticatedDiagnostic(previewOrigin, expectedAttestation) {
  return attestedRouteFetch(previewOrigin, expectedAttestation, { authenticated: true });
}

async function attestedRouteFetch(previewOrigin, expectedAttestation, options = {}) {
  const url = new URL(target.pathname, `${previewOrigin}/`);
  url.searchParams.set('mkt_woo_diag', randomUUID());
  const headers = new Headers({
    Accept: 'application/json',
    'Cache-Control': 'no-cache, no-store',
    Pragma: 'no-cache',
  });
  if (options.authenticated) headers.set('Authorization', `Bearer ${target.operatorToken}`);
  const response = await attestedFetch(url, {
    method: 'GET',
    redirect: 'manual',
    headers,
    signal: AbortSignal.timeout(60_000),
  }, expectedAttestation);
  validateWooCommerceDiagnosticsAttestation(response, expectedAttestation);
  return response;
}

async function readBoundedJson(response, maxBytes) {
  const reader = response.body?.getReader();
  if (!reader) return parseJson('', response.status);
  const chunks = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) {
        throw failure(
          'WooCommerce diagnostics response exceeded the bounded size',
          'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RESPONSE_TOO_LARGE',
          { maxBytes },
        );
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return parseJson(new TextDecoder().decode(bytes), response.status);
}

function parseJson(text, status) {
  try {
    return JSON.parse(text);
  } catch {
    throw failure(
      'WooCommerce diagnostics route response was not valid JSON',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RESPONSE_INVALID',
      { status },
    );
  }
}

async function withGeneratedConfig(text, callback) {
  const path = resolve(
    repositoryRoot,
    `.woocommerce-worker-provider-diagnostics-${process.pid}-${Date.now()}-${randomUUID()}.jsonc`,
  );
  try {
    await writeFile(path, text, { mode: 0o600 });
    return await callback(path);
  } finally {
    await rm(path, { force: true });
  }
}

async function withWranglerOutput(callback) {
  const path = resolve(
    repositoryRoot,
    `.woocommerce-worker-provider-diagnostics-output-${process.pid}-${Date.now()}-${randomUUID()}.jsonl`,
  );
  try {
    await writeFile(path, '', { mode: 0o600 });
    return await callback(path);
  } finally {
    await rm(path, { force: true });
  }
}

function assertRepositoryState() {
  const branch = runText('git', ['branch', '--show-current']).trim();
  const head = runText('git', ['rev-parse', 'HEAD']).trim();
  const dirty = runText('git', ['status', '--porcelain', '--untracked-files=all']).trim();
  if (branch !== 'main' || dirty !== '' || !/^[0-9a-f]{40}$/u.test(head)) {
    throw failure(
      'WooCommerce Worker Provider diagnostics requires clean main',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_REPOSITORY_INVALID',
      { branch, head, clean: dirty === '' },
    );
  }
  return Object.freeze({ branch, head });
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, requireText(value, 'configPath'));
  if (!path.startsWith(`${repositoryRoot}/`) && path !== repositoryRoot) {
    throw failure(
      'Config path must remain inside Repository',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PATH_INVALID',
    );
  }
  return path;
}

function runText(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: repositoryRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw failure(
      `${file} command failed during ${options.label ?? 'WooCommerce Worker Provider diagnostics'}`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_COMMAND_FAILED',
      {
        command: `${file} ${args.slice(0, 6).join(' ')}`,
        status: result.status ?? null,
        stderrSha256: sha256(String(result.stderr ?? '')),
      },
    );
  }
  return String(result.stdout ?? '').trim();
}

function readProductionActiveVersion() {
  const status = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status', '--name', target.workerName,
    '--config', target.configPath, '--json',
  ]));
  return requireActiveVersion(Array.isArray(status) ? status[0] : status);
}

function readVersionView(versionId) {
  return JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', versionId,
    '--name', target.workerName, '--config', target.configPath, '--json',
  ]));
}

function assertProductionDeploymentUnchanged() {
  const observed = readProductionActiveVersion();
  if (!productionBaselineVersion || observed !== productionBaselineVersion) {
    throw failure(
      'Production Worker deployment changed during Preview diagnostics',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PRODUCTION_DEPLOYMENT_CHANGED',
      {
        expectedProductionVersion: productionBaselineVersion,
        observedProductionVersion: observed,
      },
    );
  }
  assertExactFlags(readTrueFlags(readVersionView(observed)), []);
  return true;
}

function productionDeploymentUnchangedOrFalse() {
  if (!target || !productionBaselineVersion) return null;
  try {
    return assertProductionDeploymentUnchanged();
  } catch {
    return false;
  }
}

function requireActiveVersion(status) {
  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const active = versions.filter((version) => Number(version?.percentage) === 100);
  if (active.length !== 1 || typeof active[0]?.version_id !== 'string') {
    throw failure(
      'Worker does not have exactly one 100% active Production version',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ACTIVE_VERSION_INVALID',
    );
  }
  return active[0].version_id;
}

function readTrueFlags(value) {
  const flags = new Map();
  walk(value, (node) => {
    if (!node || typeof node !== 'object' || Array.isArray(node)) return;
    for (const [key, nested] of Object.entries(node)) {
      if (TRUE_FLAG_PATTERN.test(key)) flags.set(key, booleanLike(nested));
    }
    if (typeof node.name === 'string' && TRUE_FLAG_PATTERN.test(node.name)) {
      flags.set(node.name, booleanLike(node.text ?? node.value ?? node.json ?? node.data));
    }
  });
  return [...flags.entries()].filter(([, enabled]) => enabled).map(([name]) => name).sort();
}

function assertExactFlags(observed, expected) {
  const left = [...observed].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw failure(
      'Worker flags differ from the approved WooCommerce diagnostics window',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_REMOTE_FLAGS_INVALID',
      { observed: left, expected: right },
    );
  }
}

function walk(value, callback) {
  callback(value);
  if (Array.isArray(value)) {
    for (const item of value) walk(item, callback);
  } else if (value && typeof value === 'object') {
    for (const nested of Object.values(value)) walk(nested, callback);
  }
}

function booleanLike(value) {
  return value === true || value === 1 || String(value ?? '').trim().toLowerCase() === 'true';
}

async function writeEvidence(name, value) {
  const path = resolve(evidenceRoot, `${name}.json`);
  const temporary = `${path}.tmp`;
  const evidence = sanitize({
    stage: name,
    capturedAt: new Date().toISOString(),
    repositoryHead: target?.repositoryHead ?? null,
    data: value,
  });
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(temporary, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  const output = {};
  for (const [key, nested] of Object.entries(value)) {
    if (/token|secret|authorization|cookie|credential|subdomain|previewOrigin/iu.test(key)) continue;
    output[key] = sanitize(nested);
  }
  return output;
}

function redactDiagnosticMessage(value) {
  return String(value ?? '')
    .replace(/https?:\/\/[^\s"'<>]+/giu, '[REDACTED_URL]')
    .slice(0, 2_000);
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw failure(
      `${fieldName} must equal ${expected}`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_TARGET_INVALID',
      { fieldName, expected },
    );
  }
  return value;
}

function requireSecret(value, fieldName) {
  const text = requireText(value, fieldName);
  if (text.length < 16 || /^(?:replace-with-|example|changeme)/iu.test(text)) {
    throw failure(
      `${fieldName} is not configured safely in the local operator environment`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_LOCAL_AUTH_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw failure(
      `${fieldName} is required`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function failure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceWorkerProviderDiagnosticsOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
