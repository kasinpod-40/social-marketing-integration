#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

const repositoryRoot = resolve(process.cwd());
const MAX_ATTEMPTS = 6;
const RETRY_DELAYS_MS = Object.freeze([5_000, 10_000, 20_000, 30_000, 30_000]);
let stage = 'init';
let closeoutLaunched = false;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      action: 'retry_only_transient_queryable_d1_failures_before_closeout',
      childEntry: 'scripts/meta-paid-lark-drain-queryable-entry.mjs',
      maxAttempts: MAX_ATTEMPTS,
      retryDelaysMs: RETRY_DELAYS_MS,
      retryAfterCloseoutAllowed: false,
      directRemoteMutationPerformed: false,
    }, null, 2)}\n`);
  } else {
    await executeSupervised();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'META_PAID_LARK_TRANSIENT_SUPERVISOR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: error?.details ?? {},
    closeoutLaunched,
    directRemoteMutationPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeSupervised() {
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    stage = `queryable-entry-attempt-${attempt}`;
    const result = await runQueryableEntry();
    closeoutLaunched ||= result.closeoutLaunched;
    if (result.code === 0) return;

    if (closeoutLaunched) {
      throw supervisorError(
        'Queryable paid Meta entry failed after closeout started; automatic retry is blocked',
        'META_PAID_LARK_TRANSIENT_SUPERVISOR_CLOSEOUT_STARTED',
        { attempt, childExitCode: result.code, childSignal: result.signal },
      );
    }

    if (!isTransientReadFailure(result.outputTail)) {
      throw supervisorError(
        'Queryable paid Meta entry failed for a non-transient reason; automatic retry is blocked',
        'META_PAID_LARK_TRANSIENT_SUPERVISOR_NON_TRANSIENT',
        { attempt, childExitCode: result.code, childSignal: result.signal },
      );
    }

    if (attempt === MAX_ATTEMPTS) {
      throw supervisorError(
        'Transient paid Meta D1 reads did not recover within the bounded retry window',
        'META_PAID_LARK_TRANSIENT_SUPERVISOR_RETRY_EXHAUSTED',
        { attemptCount: MAX_ATTEMPTS },
      );
    }

    const retryDelayMs = RETRY_DELAYS_MS[attempt - 1];
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'transient-read-retry-scheduled',
      attempt,
      nextAttempt: attempt + 1,
      retryDelayMs,
      closeoutLaunched: false,
      directRemoteMutationPerformed: false,
    }, null, 2)}\n`);
    await sleep(retryDelayMs);
  }
}

function runQueryableEntry() {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(process.execPath, [
      'scripts/meta-paid-lark-drain-queryable-entry.mjs',
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
        outputTail = `${outputTail}${chunk}`.slice(-65_536);
        if (/(?:launch_existing_closeout|private-safe-config-materialized|META_PAID_LARK_CLOSEOUT_COMPLETED_SAFE|"closeoutLaunched"\s*:\s*true)/u.test(outputTail)) {
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

function isTransientReadFailure(output) {
  if (typeof output !== 'string' || output === '') return false;
  return /(?:\[code:\s*7500\]|"code"\s*:\s*7500|internal error; reference\s*=|ECONNRESET|ETIMEDOUT|EAI_AGAIN|ENETUNREACH|"timedOut"\s*:\s*true|HTTP\s+(?:429|5\d\d)\b)/iu.test(output);
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length !== 0) {
    throw supervisorError(
      'Unsupported paid Meta transient supervisor arguments',
      'META_PAID_LARK_TRANSIENT_SUPERVISOR_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function supervisorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidLarkTransientSupervisorError';
  error.code = code;
  error.details = details;
  return error;
}
