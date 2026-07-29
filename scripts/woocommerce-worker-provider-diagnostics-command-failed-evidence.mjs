#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { watch } from 'node:fs';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseWooCommerceDiagnosticsWranglerFailure,
} from './lib/woocommerce-diagnostics-preview-upload.js';

const repositoryRoot = resolve(process.cwd());
const OUTPUT_PREFIX = '.woocommerce-worker-provider-diagnostics-output-';
const OUTPUT_SUFFIX = '.jsonl';
const OUTPUT_MAX_BYTES = 1024 * 1024;
const confirmation = Object.freeze({
  envName: 'CONFIRM_WOOCOMMERCE_WRANGLER_FAILURE_EVIDENCE',
  value: 'CAPTURE_REDACTED_WRANGLER_FAILURE_EVIDENCE',
});
const captured = new Map();
const pendingCaptures = new Set();
let childStderr = '';

assertConfirmation(process.env);

const watcher = watch(repositoryRoot, { persistent: true }, (_eventType, filename) => {
  if (isOutputFilename(filename)) scheduleCapture(resolve(repositoryRoot, String(filename)));
});
const poll = setInterval(() => {
  void scanOutputFiles();
}, 25);

try {
  await scanOutputFiles();
  const child = spawn(
    process.execPath,
    ['scripts/woocommerce-worker-provider-diagnostics-preview-window.mjs'],
    {
      cwd: repositoryRoot,
      env: process.env,
      stdio: ['inherit', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (chunk) => process.stdout.write(chunk));
  child.stderr.on('data', (chunk) => {
    const text = String(chunk);
    childStderr = `${childStderr}${text}`.slice(-64 * 1024);
    process.stderr.write(chunk);
  });
  const exit = await new Promise((resolveExit) => {
    child.once('error', (error) => resolveExit({ status: null, signal: null, error }));
    child.once('close', (status, signal) => resolveExit({ status, signal, error: null }));
  });
  await scanOutputFiles();
  await sleep(100);
  await Promise.allSettled([...pendingCaptures]);

  const failures = [...captured.values()].map((outputText) => (
    parseWooCommerceDiagnosticsWranglerFailure(
      outputText,
      '',
      childStderr,
      exit.status,
    )
  ));
  captured.clear();

  const ok = exit.error === null && exit.status === 0;
  const summary = {
    ok,
    stage: 'woocommerce-worker-provider-diagnostics-command-failed-evidence',
    diagnosticExitStatus: exit.status,
    diagnosticSignal: exit.signal,
    childStartErrorCode: exit.error?.code ?? null,
    capturedOutputFileCount: failures.length,
    failures,
    rawOutputPersisted: false,
    tokenPrintedByEvidenceLauncher: false,
    remoteActionsAddedByEvidenceLauncher: 0,
  };
  const stream = ok ? process.stdout : process.stderr;
  stream.write(`${JSON.stringify(summary, null, 2)}\n`);
  process.exitCode = ok ? 0 : 1;
} finally {
  clearInterval(poll);
  watcher.close();
  captured.clear();
}

async function scanOutputFiles() {
  const names = await readdir(repositoryRoot).catch(() => []);
  for (const name of names) {
    if (isOutputFilename(name)) scheduleCapture(resolve(repositoryRoot, name));
  }
}

function scheduleCapture(path) {
  const promise = captureOutput(path).finally(() => pendingCaptures.delete(promise));
  pendingCaptures.add(promise);
}

async function captureOutput(path) {
  for (const delay of [0, 5, 20, 50]) {
    if (delay > 0) await sleep(delay);
    try {
      const bytes = await readFile(path);
      if (bytes.byteLength === 0) continue;
      const bounded = bytes.byteLength > OUTPUT_MAX_BYTES
        ? bytes.subarray(bytes.byteLength - OUTPUT_MAX_BYTES)
        : bytes;
      captured.set(path, bounded.toString('utf8'));
      return;
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function isOutputFilename(value) {
  return typeof value === 'string'
    && value.startsWith(OUTPUT_PREFIX)
    && value.endsWith(OUTPUT_SUFFIX);
}

function assertConfirmation(env) {
  if (env[confirmation.envName] !== confirmation.value) {
    const error = new Error(
      `Evidence launcher requires ${confirmation.envName}=${confirmation.value}`,
    );
    error.code = 'WOOCOMMERCE_WRANGLER_FAILURE_EVIDENCE_CONFIRMATION_REQUIRED';
    throw error;
  }
}

function sleep(milliseconds) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds));
}
