#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';

export const META_PAID_LARK_DRAIN_SUPERVISOR_CONTRACT_VERSION =
  'meta_paid_lark_drain_supervisor_v1';
export const META_PAID_LARK_DRAIN_SUPERVISOR_HEARTBEAT_MS = 30_000;
export const META_PAID_LARK_DRAIN_READ_ONLY_SILENCE_TIMEOUT_MS = 120_000;

const repositoryRoot = resolve(process.cwd());
let currentStage = 'init';
let closeoutLaunched = false;
let childPid = null;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    process.stdout.write(`${JSON.stringify({
      ok: true,
      planOnly: true,
      contractVersion: META_PAID_LARK_DRAIN_SUPERVISOR_CONTRACT_VERSION,
      action: 'supervise_existing_read_only_drain_then_guarded_closeout',
      heartbeatMs: META_PAID_LARK_DRAIN_SUPERVISOR_HEARTBEAT_MS,
      readOnlySilenceTimeoutMs: META_PAID_LARK_DRAIN_READ_ONLY_SILENCE_TIMEOUT_MS,
      killAllowedBeforeCloseoutOnly: true,
      directRemoteMutationPerformed: false,
    }, null, 2)}\n`);
  } else {
    await executeSupervisedDrain();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'META_PAID_LARK_DRAIN_SUPERVISOR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    closeoutLaunched,
    childPid,
    directRemoteMutationPerformed: false,
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeSupervisedDrain() {
  currentStage = 'launch-existing-drain';
  const child = spawn(process.execPath, [
    'scripts/meta-paid-lark-drain-closeout.mjs',
    '--execute',
  ], {
    cwd: repositoryRoot,
    env: process.env,
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  childPid = child.pid ?? null;

  let lastOutputAt = Date.now();
  let rollingOutput = '';
  let readOnlyStallDetected = false;
  let settled = false;

  const observe = (stream, destination) => {
    stream.setEncoding('utf8');
    stream.on('data', (chunk) => {
      lastOutputAt = Date.now();
      rollingOutput = `${rollingOutput}${chunk}`.slice(-16_384);
      if (/"action"\s*:\s*"launch_existing_closeout"/u.test(rollingOutput)
        || /"stage"\s*:\s*"private-safe-config-materialized"/u.test(rollingOutput)
        || /META_PAID_LARK_CLOSEOUT_COMPLETED_SAFE/u.test(rollingOutput)) {
        closeoutLaunched = true;
      }
      destination.write(chunk);
    });
  };
  observe(child.stdout, process.stdout);
  observe(child.stderr, process.stderr);

  const heartbeat = setInterval(() => {
    const quietMs = Date.now() - lastOutputAt;
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: closeoutLaunched
        ? 'closeout-supervisor-heartbeat'
        : 'read-only-drain-supervisor-heartbeat',
      childPid,
      closeoutLaunched,
      quietMs,
      readOnlySilenceTimeoutMs: closeoutLaunched
        ? null
        : META_PAID_LARK_DRAIN_READ_ONLY_SILENCE_TIMEOUT_MS,
      directRemoteMutationPerformed: false,
    }, null, 2)}\n`);

    if (!closeoutLaunched
      && !readOnlyStallDetected
      && quietMs >= META_PAID_LARK_DRAIN_READ_ONLY_SILENCE_TIMEOUT_MS) {
      readOnlyStallDetected = true;
      currentStage = 'read-only-drain-stalled';
      terminateProcessGroup(child.pid);
    }
  }, META_PAID_LARK_DRAIN_SUPERVISOR_HEARTBEAT_MS);
  heartbeat.unref();

  try {
    const result = await new Promise((resolvePromise, rejectPromise) => {
      child.once('error', rejectPromise);
      child.once('exit', (code, signal) => resolvePromise({ code, signal }));
    });
    settled = true;
    if (readOnlyStallDetected) {
      throw supervisorError(
        'Paid Meta read-only drain produced no output for the bounded silence window and was stopped before closeout mutation',
        'META_PAID_LARK_DRAIN_READ_ONLY_STALLED',
        {
          quietTimeoutMs: META_PAID_LARK_DRAIN_READ_ONLY_SILENCE_TIMEOUT_MS,
          childExitCode: result.code,
          childSignal: result.signal,
        },
      );
    }
    if (result.code !== 0) {
      throw supervisorError(
        'Existing paid Meta drain closeout exited unsuccessfully',
        'META_PAID_LARK_DRAIN_SUPERVISED_CHILD_FAILED',
        { childExitCode: result.code, childSignal: result.signal },
      );
    }
    currentStage = 'complete';
    process.stdout.write(`${JSON.stringify({
      ok: true,
      stage: 'supervisor-complete',
      contractVersion: META_PAID_LARK_DRAIN_SUPERVISOR_CONTRACT_VERSION,
      closeoutLaunched,
      childExitCode: 0,
      directRemoteMutationPerformed: false,
    }, null, 2)}\n`);
  } finally {
    clearInterval(heartbeat);
    if (!settled && !closeoutLaunched) terminateProcessGroup(child.pid);
  }
}

function terminateProcessGroup(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) return;
  try {
    process.kill(-pid, 'SIGTERM');
  } catch (error) {
    if (error?.code !== 'ESRCH') throw error;
    return;
  }
  void sleep(5_000).then(() => {
    try {
      process.kill(-pid, 'SIGKILL');
    } catch (error) {
      if (error?.code !== 'ESRCH') {
        process.stderr.write(`${JSON.stringify({
          ok: false,
          stage: 'read-only-drain-force-stop',
          code: error?.code ?? 'META_PAID_LARK_DRAIN_FORCE_STOP_FAILED',
          message: error instanceof Error ? error.message : String(error),
        }, null, 2)}\n`);
      }
    }
  });
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length !== 0) {
    throw supervisorError(
      'Unsupported paid Meta drain supervisor arguments',
      'META_PAID_LARK_DRAIN_SUPERVISOR_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|payload|state_json|completion_json/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function supervisorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaPaidLarkDrainSupervisorError';
  error.code = code;
  error.details = details;
  return error;
}
