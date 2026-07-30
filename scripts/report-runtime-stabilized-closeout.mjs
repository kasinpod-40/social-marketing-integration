#!/usr/bin/env node

import childProcess from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { attachExecFilePromiseContract } from './lib/exec-file-promise-contract.js';
import {
  assertReportRuntimeStableActiveDeployment,
} from './lib/report-runtime-fresh-config-dlq-recovery.js';

const originalExecFile = childProcess.execFile;
const originalExecFileAsync = promisify(originalExecFile);
const DEFAULT_DELAYS_MS = Object.freeze([0, 10_000, 20_000]);
let pendingBarrierError = null;

function stabilizedExecFile(file, args, options, callback) {
  const normalized = normalizeExecArguments(args, options, callback);
  const commandArgs = normalized.args;

  if (pendingBarrierError && isDeploymentStatusCommand(file, commandArgs)) {
    const barrierError = pendingBarrierError;
    pendingBarrierError = null;
    return originalExecFile(file, commandArgs, normalized.options, (error, stdout, stderr) => {
      normalized.callback(error ?? barrierError, stdout, stderr);
    });
  }

  if (!isLiveWranglerDeploy(file, commandArgs)) {
    return originalExecFile(file, commandArgs, normalized.options, normalized.callback);
  }

  return originalExecFile(file, commandArgs, normalized.options, (error, stdout, stderr) => {
    if (error) {
      normalized.callback(error, stdout, stderr);
      return;
    }
    stabilizeDeployment(commandArgs, normalized.options, stdout)
      .catch((barrierError) => {
        pendingBarrierError = barrierError;
      })
      .finally(() => {
        normalized.callback(null, stdout, stderr);
      });
  });
}

childProcess.execFile = attachExecFilePromiseContract(stabilizedExecFile);
syncBuiltinESMExports();
await import('./report-runtime-closeout-operator.mjs');

function normalizeExecArguments(args, options, callback) {
  const normalizedArgs = Array.isArray(args) ? args : [];
  if (typeof options === 'function') {
    return { args: normalizedArgs, options: {}, callback: options };
  }
  if (typeof callback !== 'function') {
    throw new TypeError('Stabilized Report closeout requires execFile callback semantics');
  }
  return { args: normalizedArgs, options: options ?? {}, callback };
}

function isLiveWranglerDeploy(file, args) {
  return basename(String(file)) === 'npx'
    && args[0] === 'wrangler'
    && args[1] === 'deploy'
    && !args.includes('--dry-run');
}

function isDeploymentStatusCommand(file, args) {
  return basename(String(file)) === 'npx'
    && args[0] === 'wrangler'
    && args[1] === 'deployments'
    && args[2] === 'status';
}

async function stabilizeDeployment(deployArgs, options, deployStdout) {
  const configPath = valueAfter(deployArgs, '--config');
  if (!configPath) throw barrierFailure(
    'Live Report deployment lacks an exact generated config path',
    'REPORT_RUNTIME_ACTIVE_DEPLOYMENT_CONFIG_MISSING',
  );
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  const workerName = requireText(config.name, 'workerName');
  const expectedVersionId = extractVersionId(deployStdout);
  const expectedTrueFlags = Object.entries(config.vars ?? {})
    .filter(([name, value]) => /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && readBoolean(value) === true)
    .map(([name]) => name)
    .sort();
  const samples = [];
  for (const delayMs of readDelays()) {
    if (delayMs > 0) await sleep(delayMs);
    const statusOutput = await runOriginal('npx', [
      'wrangler', 'deployments', 'status', '--name', workerName, '--config', configPath, '--json',
    ], options);
    const activeVersion = resolveActiveVersion(JSON.parse(statusOutput), expectedVersionId);
    const versionOutput = await runOriginal('npx', [
      'wrangler', 'versions', 'view', activeVersion, '--name', workerName, '--config', configPath, '--json',
    ], options);
    const bindings = collectBindings(JSON.parse(versionOutput));
    const trueFlags = bindings
      .filter((binding) => normalizeBindingType(binding?.type) === 'plain_text')
      .map((binding) => [readBindingName(binding), readBoolean(binding?.text ?? binding?.value)])
      .filter(([name, enabled]) => name && /^MKT_[A-Z0-9_]+_ENABLED$/u.test(name) && enabled === true)
      .map(([name]) => name)
      .sort();
    samples.push(Object.freeze({ versionId: activeVersion, trueFlags, mode: 'active' }));
  }
  assertReportRuntimeStableActiveDeployment(samples, {
    versionId: expectedVersionId,
    trueFlags: expectedTrueFlags,
  });
}

async function runOriginal(file, args, options) {
  const result = await originalExecFileAsync(file, args, {
    cwd: options?.cwd,
    env: options?.env,
    maxBuffer: options?.maxBuffer ?? 64 * 1024 * 1024,
    encoding: 'utf8',
  });
  return String(result.stdout ?? '');
}

function readDelays() {
  const raw = String(process.env.MKT_REPORT_RUNTIME_ACTIVE_STABILITY_DELAYS_MS ?? '').trim();
  if (!raw) return DEFAULT_DELAYS_MS;
  const values = raw.split(',').map((value) => Number(value.trim()));
  if (values.length < 3 || values.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    throw barrierFailure(
      'Report Active stability delays must contain at least three non-negative integers',
      'REPORT_RUNTIME_ACTIVE_DEPLOYMENT_DELAY_INVALID',
    );
  }
  return Object.freeze(values);
}

function valueAfter(args, flag) {
  const index = args.indexOf(flag);
  return index >= 0 ? String(args[index + 1] ?? '').trim() || null : null;
}

function extractVersionId(stdout) {
  const labeled = String(stdout).match(/Version ID:\s*([0-9a-f-]{36})/iu)?.[1];
  if (labeled) return labeled;
  const unique = [...new Set([...String(stdout).matchAll(
    /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/giu,
  )].map((match) => match[0]))];
  if (unique.length !== 1) throw barrierFailure(
    'Unable to resolve the exact Report deployment Version ID',
    'REPORT_RUNTIME_ACTIVE_DEPLOYMENT_VERSION_UNRESOLVED',
    { matchCount: unique.length },
  );
  return unique[0];
}

function resolveActiveVersion(value, expectedVersionId) {
  const candidates = [];
  visit(value);
  const unique = [...new Set(candidates)];
  if (!unique.includes(expectedVersionId) || unique.length !== 1) throw barrierFailure(
    'Expected Report deployment is not the sole version at 100% traffic',
    'REPORT_RUNTIME_ACTIVE_DEPLOYMENT_NOT_STABLE',
    { expectedVersionId, activeVersions: unique },
  );
  return unique[0];

  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    const percentage = Number(nested.percentage ?? nested.traffic ?? nested.percent ?? Number.NaN);
    const versionId = String(nested.version_id ?? nested.versionId ?? '').trim();
    if (percentage === 100 && /^[0-9a-f-]{36}$/iu.test(versionId)) candidates.push(versionId);
    Object.values(nested).forEach(visit);
  }
}

function collectBindings(value) {
  const arrays = [];
  visit(value);
  return arrays.find((items) => items.some((item) => readBindingName(item))) ?? [];

  function visit(nested) {
    if (Array.isArray(nested)) { nested.forEach(visit); return; }
    if (!nested || typeof nested !== 'object') return;
    if (Array.isArray(nested.bindings)) arrays.push(nested.bindings);
    Object.values(nested).forEach(visit);
  }
}

function readBindingName(binding) {
  return String(binding?.name ?? binding?.binding ?? '').trim() || null;
}

function normalizeBindingType(value) {
  return String(value ?? '').trim().toLowerCase().replaceAll('-', '_');
}

function readBoolean(value) {
  if (value === true || String(value).trim().toLowerCase() === 'true') return true;
  if (value === false || String(value).trim().toLowerCase() === 'false') return false;
  return null;
}

function requireText(value, fieldName) {
  const text = String(value ?? '').trim();
  if (!text) throw barrierFailure(
    `Report Active deployment barrier requires ${fieldName}`,
    'REPORT_RUNTIME_ACTIVE_DEPLOYMENT_VALUE_INVALID',
    { fieldName },
  );
  return text;
}

function sleep(delayMs) {
  return new Promise((resolve) => setTimeout(resolve, delayMs));
}

function barrierFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeActiveDeploymentBarrierError';
  error.code = code;
  error.details = details;
  return error;
}
