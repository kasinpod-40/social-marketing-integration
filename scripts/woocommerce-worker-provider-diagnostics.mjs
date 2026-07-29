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

const repositoryRoot = resolve(process.cwd());
const evidenceRoot = resolve(
  process.env.MKT_WOOCOMMERCE_WORKER_DIAGNOSTICS_EVIDENCE_DIR
    ?? 'outputs/woocommerce-worker-provider-diagnostics',
);
const RESPONSE_MAX_BYTES = 64 * 1024;
const WORKER_NAME_DEFAULT = 'social-mkt-sync-worker';
const TRUE_FLAG_PATTERN = /^MKT_[A-Z0-9_]+_ENABLED$/u;
const attestedFetch = createWooCommerceDiagnosticsAttestedFetch(globalThis.fetch.bind(globalThis));
let target = null;
let configs = null;
let activeDeploymentAttempted = false;
let workerDeploymentCount = 0;
let providerRequestCount = 0;

try {
  await main();
} catch (error) {
  let automaticSafeRestore = null;
  if (activeDeploymentAttempted && target && configs) {
    try {
      automaticSafeRestore = await deployAndProbe({
        label: 'automatic-safe-restore',
        configText: configs.safe,
        expectedStatus: 404,
        expectedTrueFlags: [],
        expectedAttestation: configs.safeAttestation,
      });
    } catch (restoreError) {
      const details = sanitize(restoreError?.details ?? {});
      automaticSafeRestore = {
        ok: false,
        code: restoreError?.code ?? 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_RESTORE_FAILED',
        message: restoreError instanceof Error ? restoreError.message : String(restoreError),
        controlPlaneSafeRestored:
          details.controlPlaneVersionVerified === true
          && details.controlPlaneTrueFlagsVerified === true,
        httpClosureAttested: false,
        restoredSafeVersion: details.deployedVersionId ?? null,
        details,
      };
    }
  }
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'woocommerce-worker-provider-diagnostics',
    code: error?.code ?? 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    automaticSafeRestore,
    providerRequestCount,
    providerMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount,
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
  const operatorToken = requireSecret(env.MKT_CONNECTION_OPERATOR_TOKEN, 'MKT_CONNECTION_OPERATOR_TOKEN');
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
  target = Object.freeze({
    repositoryHead: repository.head,
    workerName: env.MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME ?? WORKER_NAME_DEFAULT,
    configPath,
    operatorToken,
    origin: configs.origin,
    pathname: configs.pathname,
  });

  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const preflight = await runPreflight();
  await writeEvidence('01-preflight', preflight);

  activeDeploymentAttempted = true;
  const active = await deployAndProbe({
    label: 'provider-diagnostics-active',
    configText: configs.active,
    expectedStatus: 401,
    expectedTrueFlags: [WOOCOMMERCE_PROVIDER_DIAGNOSTICS_FLAG],
    expectedAttestation: configs.activeAttestation,
  });
  await writeEvidence('02-active-deployment', active);

  const response = await fetchAuthenticatedDiagnostic(configs.activeAttestation);
  const body = await readBoundedJson(response, RESPONSE_MAX_BYTES);
  const diagnostic = validateWooCommerceWorkerProviderDiagnosticResponse(response.status, body);
  providerRequestCount = Number(diagnostic.providerRequestCount);
  await writeEvidence('03-provider-diagnostic', {
    versionId: active.versionId,
    httpStatus: response.status,
    result: diagnostic,
  });

  const safe = await deployAndProbe({
    label: 'provider-diagnostics-safe-restore',
    configText: configs.safe,
    expectedStatus: 404,
    expectedTrueFlags: [],
    expectedAttestation: configs.safeAttestation,
  });
  activeDeploymentAttempted = false;
  await writeEvidence('04-safe-restore', safe);

  process.stdout.write(`${JSON.stringify({
    ok: true,
    stage: 'woocommerce-worker-provider-diagnostics',
    repositoryHead: target.repositoryHead,
    activeDiagnosticVersion: active.versionId,
    restoredSafeVersion: safe.versionId,
    diagnosticHttpStatus: response.status,
    diagnostic,
    providerRequestCount,
    providerMutationCount: 0,
    businessMutationCount: 0,
    queueMessageCount: 0,
    workerDeploymentCount,
    larkRequestCount: 0,
    scheduleMutationCount: 0,
    safeRestored: true,
    safeControlPlaneVerified: true,
    safeHttpClosureAttested: true,
    evidenceRoot: relative(repositoryRoot, evidenceRoot),
  }, null, 2)}\n`);
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    stage: 'woocommerce-worker-provider-diagnostics-plan',
    confirmation: WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_CONFIRMATION,
    phases: [
      'local-and-remote-read-only-preflight',
      'deploy-diagnostic-only-window',
      'control-plane-and-config-attestation-proof',
      'one-authenticated-system-status-get',
      'automatic-all-false-safe-restore',
      'attested-safe-route-closure-proof',
    ],
    remoteMutations: {
      workerDeployments: 2,
      queueMessages: 0,
      d1Writes: 0,
      larkRequests: 0,
      scheduleMutations: 0,
      secretMutations: 0,
    },
  }, null, 2)}\n`);
}

async function runPreflight() {
  await dryRunConfig(configs.safe, 'safe');
  await dryRunConfig(configs.active, 'active');
  runText('npx', ['wrangler', 'whoami']);
  const secretNames = parseWooCommerceWorkerSecretNames(runText('npx', [
    'wrangler', 'secret', 'list', '--name', target.workerName,
    '--config', target.configPath, '--format', 'json',
  ]));
  const status = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status', '--name', target.workerName,
    '--config', target.configPath, '--json',
  ]));
  const activeVersion = requireActiveVersion(Array.isArray(status) ? status[0] : status);
  const view = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', activeVersion,
    '--name', target.workerName, '--config', target.configPath, '--json',
  ]));
  assertExactFlags(readTrueFlags(view), []);
  return Object.freeze({
    repositoryHead: target.repositoryHead,
    activeVersion,
    currentTrueFlags: [],
    secretNameFingerprint: sha256(JSON.stringify(secretNames)),
    safeConfigSha256: configs.safeSha256,
    activeConfigSha256: configs.activeSha256,
    sourceConfigSha256: configs.bundleSourceSha256,
    activeAttestationFingerprint: sha256(configs.activeAttestation),
    safeAttestationFingerprint: sha256(configs.safeAttestation),
    secretValuesCopied: configs.secretValuesCopied,
    providerRequestCount: 0,
    workerDeploymentCount: 0,
  });
}

async function dryRunConfig(configText, label) {
  await withGeneratedConfig(configText, async (configPath) => {
    runText('npx', ['wrangler', 'deploy', '--dry-run', '--config', configPath], {
      label: `dry-run-${label}`,
    });
  });
}

async function deployAndProbe(input) {
  const deployment = await withGeneratedConfig(input.configText, async (configPath) => {
    const stdout = runText('npx', [
      'wrangler', 'deploy', '--config', configPath,
      '--message', `woocommerce_worker_provider_diagnostics stage=${input.label} git=${target.repositoryHead}`,
    ], { label: input.label });
    workerDeploymentCount += 1;
    return { stdout, versionId: extractVersionId(stdout) };
  });
  const status = JSON.parse(runText('npx', [
    'wrangler', 'deployments', 'status', '--name', target.workerName,
    '--config', target.configPath, '--json',
  ]));
  requireActiveVersion(Array.isArray(status) ? status[0] : status, deployment.versionId);
  const view = JSON.parse(runText('npx', [
    'wrangler', 'versions', 'view', deployment.versionId,
    '--name', target.workerName, '--config', target.configPath, '--json',
  ]));
  assertExactFlags(readTrueFlags(view), input.expectedTrueFlags);
  const controlPlaneEvidence = Object.freeze({
    deployedVersionId: deployment.versionId,
    controlPlaneVersionVerified: true,
    controlPlaneTrueFlagsVerified: true,
    expectedTrueFlags: Object.freeze([...input.expectedTrueFlags].sort()),
  });

  try {
    const routeStatuses = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await attestedRouteFetch(input.expectedAttestation, { authenticated: false });
      routeStatuses.push(response.status);
    }
    if (!routeStatuses.every((statusCode) => statusCode === input.expectedStatus)) {
      throw failure(
        'WooCommerce diagnostics route did not reach the expected stable status',
        'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ROUTE_UNSTABLE',
        { expectedStatus: input.expectedStatus, routeStatuses },
      );
    }
    return Object.freeze({
      ok: true,
      label: input.label,
      versionId: deployment.versionId,
      configSha256: sha256(input.configText),
      expectedTrueFlags: Object.freeze([...input.expectedTrueFlags].sort()),
      routeStatuses: Object.freeze(routeStatuses),
      controlPlaneVersionVerified: true,
      controlPlaneTrueFlagsVerified: true,
      httpDeploymentAttested: true,
    });
  } catch (error) {
    error.details = {
      ...sanitize(error?.details ?? {}),
      ...controlPlaneEvidence,
      expectedStatus: input.expectedStatus,
      expectedAttestationFingerprint: sha256(input.expectedAttestation),
    };
    throw error;
  }
}

async function fetchAuthenticatedDiagnostic(expectedAttestation) {
  return attestedRouteFetch(expectedAttestation, { authenticated: true });
}

async function attestedRouteFetch(expectedAttestation, options = {}) {
  const url = new URL(target.pathname, `${target.origin}/`);
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
    throw failure('Config path must remain inside Repository', 'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_PATH_INVALID');
  }
  return path;
}

function runText(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw failure(
      `${file} command failed during ${options.label ?? 'WooCommerce Worker Provider diagnostics'}`,
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_COMMAND_FAILED',
      {
        command: `${file} ${args.slice(0, 5).join(' ')}`,
        status: result.status ?? null,
        stderrSha256: sha256(String(result.stderr ?? '')),
      },
    );
  }
  return String(result.stdout ?? '').trim();
}

function extractVersionId(output) {
  const text = String(output);
  const labeled = /Version ID:\s*([0-9a-f-]{36})/iu.exec(text)?.[1]?.toLowerCase();
  if (labeled) return labeled;
  const values = [...new Set((text.match(/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu) ?? [])
    .map((value) => value.toLowerCase()))];
  if (values.length !== 1) {
    throw failure(
      'Deployment output did not contain exactly one Worker version ID',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_DEPLOYMENT_INVALID',
      { count: values.length },
    );
  }
  return values[0];
}

function requireActiveVersion(status, expected = null) {
  const versions = Array.isArray(status?.versions) ? status.versions : [];
  const active = versions.filter((version) => Number(version?.percentage) === 100);
  if (active.length !== 1 || typeof active[0]?.version_id !== 'string') {
    throw failure(
      'Worker does not have exactly one 100% active version',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ACTIVE_VERSION_INVALID',
    );
  }
  if (expected && active[0].version_id !== expected) {
    throw failure(
      'Worker active version differs from the just-deployed diagnostics version',
      'WOOCOMMERCE_WORKER_PROVIDER_DIAGNOSTICS_ACTIVE_VERSION_MISMATCH',
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
    if (/token|secret|authorization|cookie|credential/iu.test(key)) continue;
    output[key] = sanitize(nested);
  }
  return output;
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
