#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readDevVars } from './lib/dev-vars.js';
import { buildMetaPaidLarkRuntimeDiagnosisQueries } from './lib/meta-paid-lark-runtime-blocker-diagnosis.js';
import { sanitizeCliOutput } from './lib/sanitize-cli-output.js';
import { resolve } from 'node:path';
import { stat } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const MAX_ATTEMPTS = 3;
const READ_TIMEOUT_MS = 60_000;
const RETRY_DELAY_MS = 2_000;
let currentStage = 'init';
let closeoutLaunched = false;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      action: 'retry_transient_read_only_d1_then_existing_supervised_drain',
      maxAttempts: MAX_ATTEMPTS,
      readTimeoutMs: READ_TIMEOUT_MS,
      directRemoteMutationPerformed: false,
    }, null, 2)}\n`);
  } else {
    await executeResilientEntry();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_PAID_LARK_DRAIN_RESILIENT_ENTRY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    closeoutLaunched,
    directRemoteMutationPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeResilientEntry() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    currentStage = `supervised-drain-attempt-${attempt}`;
    const result = await runSupervisedDrain();
    closeoutLaunched ||= result.closeoutLaunched;
    if (result.code === 0) return;

    if (closeoutLaunched) {
      throw entryError(
        'Supervised drain failed after guarded closeout had started; automatic retry is blocked',
        'META_PAID_LARK_DRAIN_RESILIENT_CLOSEOUT_STARTED',
        { attempt, childExitCode: result.code, childSignal: result.signal },
      );
    }

    if (!/META_PAID_LARK_DRAIN_COMMAND_FAILED/u.test(result.outputTail)) {
      throw entryError(
        'Supervised drain failed for a non-D1-read reason; automatic retry is blocked',
        'META_PAID_LARK_DRAIN_RESILIENT_NON_READ_FAILURE',
        { attempt, childExitCode: result.code, childSignal: result.signal },
      );
    }

    currentStage = `diagnose-read-only-d1-attempt-${attempt}`;
    const probe = await diagnoseReadOnlyD1();
    process.stdout.write(`${JSON.stringify({
      ok: probe.ok,
      stage: 'read-only-d1-diagnosis',
      attempt,
      queryCount: probe.queryCount,
      failedQuery: probe.failedQuery ?? null,
      errorCode: probe.errorCode ?? null,
      exitCode: probe.exitCode ?? null,
      signal: probe.signal ?? null,
      timedOut: probe.timedOut ?? false,
      errorMessage: probe.errorMessage ?? null,
      stdout: probe.stdout ?? null,
      stderr: probe.stderr ?? null,
      directRemoteMutationPerformed: false,
    }, null, 2)}\n`);

    if (!probe.ok) {
      throw entryError(
        'Exact read-only D1 diagnosis failed; automatic retry is blocked until the underlying Wrangler error is resolved',
        'META_PAID_LARK_DRAIN_RESILIENT_D1_DIAGNOSIS_FAILED',
        probe,
      );
    }

    if (attempt === MAX_ATTEMPTS) {
      throw entryError(
        'Read-only D1 command failed repeatedly even though immediate exact probes recovered',
        'META_PAID_LARK_DRAIN_RESILIENT_RETRY_EXHAUSTED',
        { attemptCount: MAX_ATTEMPTS },
      );
    }

    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'transient-read-recovered',
      attempt,
      nextAttempt: attempt + 1,
      retryDelayMs: RETRY_DELAY_MS,
      directRemoteMutationPerformed: false,
    }, null, 2)}\n`);
    await sleep(RETRY_DELAY_MS);
  }
}

function runSupervisedDrain() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [
      'scripts/meta-paid-lark-drain-closeout-supervised.mjs',
      '--execute',
    ], {
      cwd: repositoryRoot,
      env: process.env,
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

async function diagnoseReadOnlyD1() {
  const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const fileEnv = await readDevVars(devVarsPath);
  const env = Object.freeze({ ...fileEnv, ...process.env, DEV_VARS_FILE: devVarsPath });
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  const configPath = resolve(
    env.MKT_META_D1_ONLY_WRANGLER_CONFIG
      ?? env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG
      ?? 'wrangler.sync.jsonc',
  );
  const info = await stat(configPath).catch(() => null);
  if (!info?.isFile()) {
    return { ok: false, queryCount: 0, failedQuery: 'config', errorCode: 'CONFIG_INVALID' };
  }

  const queries = buildMetaPaidLarkRuntimeDiagnosisQueries();
  let completed = 0;
  for (const [name, sql] of Object.entries(queries)) {
    try {
      await execFileAsync('npx', [
        'wrangler', 'd1', 'execute', 'MKT_STATE_DB',
        '--remote', '--json', '--config', configPath,
        '--command', sql,
      ], {
        cwd: repositoryRoot,
        env,
        encoding: 'utf8',
        timeout: READ_TIMEOUT_MS,
        maxBuffer: 64 * 1024 * 1024,
      });
      completed += 1;
    } catch (error) {
      return {
        ok: false,
        queryCount: completed,
        failedQuery: name,
        errorCode: error?.code ?? null,
        exitCode: Number.isInteger(error?.code) ? error.code : (error?.exitCode ?? null),
        signal: error?.signal ?? null,
        timedOut: error?.killed === true && error?.signal === 'SIGTERM',
        errorMessage: sanitizeCliOutput(error instanceof Error ? error.message : error),
        stdout: sanitizeCliOutput(error?.stdout),
        stderr: sanitizeCliOutput(error?.stderr),
      };
    }
  }
  return { ok: true, queryCount: completed };
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length !== 0) {
    throw entryError('Unsupported resilient entry arguments', 'META_PAID_LARK_DRAIN_RESILIENT_ARGUMENT_INVALID', { unknown });
  }
  return args.includes('--execute');
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw entryError(
      `Resilient entry requires ${fieldName}=${expected}`,
      'META_PAID_LARK_DRAIN_RESILIENT_TARGET_INVALID',
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
  error.name = 'MetaPaidLarkDrainResilientEntryError';
  error.code = code;
  error.details = details;
  return error;
}
