#!/usr/bin/env node

import { spawn, execFile } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import { promisify } from 'node:util';
import { readDevVars } from './lib/dev-vars.js';
import {
  parseActiveDeploymentVersionIds,
  resolveSharedActiveD1BindingId,
} from './lib/meta-paid-lark-active-d1-config.js';
import {
  META_PAID_LARK_QUERYABLE_D1_CONFIG_CONTRACT_VERSION,
  materializeNameResolvedD1Config,
} from './lib/meta-paid-lark-queryable-d1-config.js';
import { sanitizeCliOutput } from './lib/sanitize-cli-output.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const READ_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;
const RETRY_DELAY_MS = 2_000;
let stage = 'init';
let closeoutLaunched = false;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      contractVersion: META_PAID_LARK_QUERYABLE_D1_CONFIG_CONTRACT_VERSION,
      action: 'remove_temp_database_id_then_verify_database_name_queryability_then_existing_supervised_drain',
      authority: 'wrangler_database_name_api_lookup_verified_by_select_1',
      sourceConfigMutationAllowed: false,
      directRemoteMutationPerformed: false,
      maxAttempts: MAX_ATTEMPTS,
    }, null, 2)}\n`);
  } else {
    await executeCloseout();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'META_PAID_LARK_QUERYABLE_ENTRY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    closeoutLaunched,
    directRemoteMutationPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeCloseout() {
  stage = 'prepare-queryable-d1-runtime';
  const runtime = await prepareRuntime();
  try {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'queryable-d1-authority-verified',
      contractVersion: META_PAID_LARK_QUERYABLE_D1_CONFIG_CONTRACT_VERSION,
      activeVersionIds: runtime.activeVersionIds,
      activeVersionCount: runtime.activeVersionIds.length,
      bindingName: 'MKT_STATE_DB',
      databaseName: runtime.databaseName,
      configuredDatabaseId: runtime.configuredDatabaseId,
      activeBindingDatabaseId: runtime.activeBindingDatabaseId,
      databaseIdRemovedFromTemporaryConfig: true,
      queryabilityProbe: 'SELECT 1',
      queryabilityVerified: true,
      sourceConfigModified: false,
      temporaryConfigMode: 0o600,
      directRemoteMutationPerformed: false,
    }, null, 2)}\n`);

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
      stage = `supervised-drain-attempt-${attempt}`;
      const result = await runSupervisedDrain(runtime.env);
      closeoutLaunched ||= result.closeoutLaunched;
      if (result.code === 0) return;

      if (closeoutLaunched) {
        throw entryError(
          'Supervised drain failed after guarded closeout started; retry is blocked',
          'META_PAID_LARK_QUERYABLE_CLOSEOUT_STARTED',
          { attempt, childExitCode: result.code, childSignal: result.signal },
        );
      }
      if (!/META_PAID_LARK_DRAIN_COMMAND_FAILED/u.test(result.outputTail)) {
        throw entryError(
          'Supervised drain failed for a non-read reason; retry is blocked',
          'META_PAID_LARK_QUERYABLE_NON_READ_FAILURE',
          { attempt, childExitCode: result.code, childSignal: result.signal },
        );
      }
      if (attempt === MAX_ATTEMPTS) {
        throw entryError(
          'Read-only drain command failed after bounded retries',
          'META_PAID_LARK_QUERYABLE_RETRY_EXHAUSTED',
          { attemptCount: MAX_ATTEMPTS },
        );
      }

      stage = `queryability-reprobe-attempt-${attempt}`;
      await proveQueryable(runtime.env, runtime.temporaryConfigPath);
      process.stdout.write(`${JSON.stringify({
        ok: true,
        stage: 'queryability-reprobe-passed',
        attempt,
        nextAttempt: attempt + 1,
        retryDelayMs: RETRY_DELAY_MS,
        directRemoteMutationPerformed: false,
      }, null, 2)}\n`);
      await sleep(RETRY_DELAY_MS);
    }
  } finally {
    await rm(runtime.temporaryRoot, { recursive: true, force: true });
  }
}

async function prepareRuntime() {
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const fileEnv = await readDevVars(devVarsPath);
  const env = Object.freeze({ ...fileEnv, ...process.env, DEV_VARS_FILE: devVarsPath });
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  const sourceConfigPath = resolve(
    env.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  const sourceInfo = await stat(sourceConfigPath).catch(() => null);
  if (!sourceInfo?.isFile()) {
    throw entryError(
      'Paid Meta source Wrangler config must be a regular file',
      'META_PAID_LARK_QUERYABLE_SOURCE_CONFIG_INVALID',
      { sourceConfigPath },
    );
  }

  const deploymentJson = await runWranglerJson(
    ['deployments', 'status', '--json', '--config', sourceConfigPath],
    env,
    'deployments-status',
  );
  const activeVersionIds = parseActiveDeploymentVersionIds(deploymentJson);
  const versionJsonTexts = [];
  for (const versionId of activeVersionIds) {
    versionJsonTexts.push(await runWranglerJson(
      ['versions', 'view', versionId, '--json', '--config', sourceConfigPath],
      env,
      'versions-view',
    ));
  }
  const activeBindingDatabaseId = resolveSharedActiveD1BindingId(
    versionJsonTexts,
    'MKT_STATE_DB',
  );

  const sourceText = await readFile(sourceConfigPath, 'utf8');
  const materialized = materializeNameResolvedD1Config(sourceText, 'MKT_STATE_DB');
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'meta-paid-lark-queryable-d1-'));
  const temporaryConfigPath = join(temporaryRoot, 'wrangler.meta-paid-lark.queryable-d1.jsonc');
  const runtimeEnv = Object.freeze({
    ...env,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: temporaryConfigPath,
  });

  try {
    await writeFile(temporaryConfigPath, materialized.text, { mode: 0o600 });
    await chmod(temporaryConfigPath, 0o600);
    stage = 'prove-queryable-d1-authority';
    await proveQueryable(runtimeEnv, temporaryConfigPath);
  } catch (error) {
    await rm(temporaryRoot, { recursive: true, force: true });
    throw error;
  }

  return Object.freeze({
    activeVersionIds,
    activeBindingDatabaseId,
    databaseName: materialized.databaseName,
    configuredDatabaseId: materialized.configuredDatabaseId,
    temporaryRoot,
    temporaryConfigPath,
    env: runtimeEnv,
  });
}

async function proveQueryable(env, configPath) {
  await runWranglerJson([
    'd1', 'execute', 'MKT_STATE_DB',
    '--remote', '--json', '--config', configPath,
    '--command', 'SELECT 1 AS meta_paid_lark_d1_probe;',
  ], env, 'd1-queryability-probe');
}

async function runWranglerJson(args, env, operation) {
  try {
    const result = await execFileAsync('npx', ['wrangler', ...args], {
      cwd: repositoryRoot,
      env,
      encoding: 'utf8',
      timeout: READ_TIMEOUT_MS,
      maxBuffer: 64 * 1024 * 1024,
    });
    const stdout = String(result.stdout ?? '').trim();
    if (!stdout) {
      throw entryError(
        `Wrangler ${operation} returned empty JSON`,
        'META_PAID_LARK_QUERYABLE_WRANGLER_JSON_EMPTY',
        { operation },
      );
    }
    return stdout;
  } catch (error) {
    if (error?.code === 'META_PAID_LARK_QUERYABLE_WRANGLER_JSON_EMPTY') throw error;
    throw entryError(
      `Required read-only Wrangler ${operation} failed`,
      'META_PAID_LARK_QUERYABLE_WRANGLER_READ_FAILED',
      {
        operation,
        exitCode: Number.isInteger(error?.code) ? error.code : (error?.exitCode ?? null),
        signal: error?.signal ?? null,
        timedOut: error?.killed === true && error?.signal === 'SIGTERM',
        errorMessage: sanitizeCliOutput(error instanceof Error ? error.message : error),
        stdout: sanitizeCliOutput(error?.stdout),
        stderr: sanitizeCliOutput(error?.stderr),
      },
    );
  }
}

function runSupervisedDrain(env) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [
      'scripts/meta-paid-lark-drain-closeout-supervised.mjs',
      '--execute',
    ], {
      cwd: repositoryRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let outputTail = '';
    let childCloseoutLaunched = false;
    const observe = (stream, destination) => {
      stream.setEncoding('utf8');
      stream.on('data', (chunk) => {
        outputTail = `${outputTail}${chunk}`.slice(-32_768);
        if (/launch_existing_closeout|private-safe-config-materialized|META_PAID_LARK_CLOSEOUT_COMPLETED_SAFE/u.test(outputTail)) {
          childCloseoutLaunched = true;
        }
        destination.write(chunk);
      });
    };
    observe(child.stdout, process.stdout);
    observe(child.stderr, process.stderr);
    child.once('error', rejectPromise);
    child.once('exit', (code, signal) => resolvePromise({
      code: code ?? 1,
      signal: signal ?? null,
      closeoutLaunched: childCloseoutLaunched,
      outputTail,
    }));
  });
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length !== 0) {
    throw entryError(
      'Unsupported queryable entry arguments',
      'META_PAID_LARK_QUERYABLE_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw entryError(
      `Queryable entry requires ${fieldName}=${expected}`,
      'META_PAID_LARK_QUERYABLE_TARGET_INVALID',
      { fieldName },
    );
  }
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload|state_json|completion_json/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function entryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidLarkQueryableEntryError';
  error.code = code;
  error.details = details;
  return error;
}
