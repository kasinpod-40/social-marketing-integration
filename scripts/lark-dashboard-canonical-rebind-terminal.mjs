#!/usr/bin/env node

import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  LARK_DASHBOARD_SCOPE_PREFLIGHT_VERSION,
  REQUIRED_LARK_DASHBOARD_CANONICAL_REBIND_SCOPES,
  assertLarkDashboardScopeConfirmation,
  buildLarkDashboardScopePreflightFailure,
  isLarkScopePermissionError,
} from './lib/lark-dashboard-scope-preflight-v1.js';

const execFileAsync = promisify(execFile);
const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
let currentStage = 'init';
let attemptRoot = null;

try {
  const repositoryRoot = await resolveRepositoryRoot();
  const evidenceRoot = resolve(
    process.env.MKT_LARK_DASHBOARD_CANONICAL_REBIND_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'lark-dashboard-canonical-rebind-v1'),
  );
  attemptRoot = join(
    evidenceRoot,
    `scope-preflight-${new Date().toISOString().replaceAll(':', '-')}`,
  );
  await mkdir(attemptRoot, { recursive: true, mode: 0o700 });

  currentStage = 'read-private-environment';
  const fileEnv = await readDevVars(
    resolve(repositoryRoot, process.env.DEV_VARS_FILE ?? '.dev.vars'),
  );
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const baseToken = requireText(
    env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN,
    'LARK_APP_TOKEN or LARK_BASE_APP_TOKEN',
  );
  const client = createLarkBitableClientFromEnv(env);

  // Probe เฉพาะ GET ก่อน Live operator เพื่อยืนยัน Dashboard read permission โดยไม่มี Remote mutation
  currentStage = 'dashboard-scope-read-probe';
  await client.requestBitableJson(
    `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}/dashboards?page_size=1`,
    { method: 'GET' },
  );

  const preflight = Object.freeze({
    ok: true,
    contractVersion: LARK_DASHBOARD_SCOPE_PREFLIGHT_VERSION,
    decision: 'LARK_DASHBOARD_SCOPE_READ_PREFLIGHT_PASS',
    requiredScopes: REQUIRED_LARK_DASHBOARD_CANONICAL_REBIND_SCOPES,
    readScopeVerified: true,
    updateScopeRequiredByContract: true,
    fieldDeleteScopeRequiredByContract: true,
    remoteMutationCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });
  await writePrivateJson(join(attemptRoot, 'scope-preflight.json'), preflight);
  process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);

  if (!execute) process.exit(0);

  currentStage = 'confirm-complete-scope-contract';
  assertLarkDashboardScopeConfirmation(
    process.env.CONFIRM_LARK_DASHBOARD_SCOPE_CONTRACT,
  );

  currentStage = 'launch-reviewed-dashboard-operator';
  const exitCode = await runReviewedOperator({ repositoryRoot, evidenceRoot });
  process.exitCode = exitCode;
} catch (error) {
  const failure = isLarkScopePermissionError(error)
    ? buildLarkDashboardScopePreflightFailure(error)
    : Object.freeze({
      ok: false,
      contractVersion: LARK_DASHBOARD_SCOPE_PREFLIGHT_VERSION,
      stage: currentStage,
      code: error?.code ?? 'LARK_DASHBOARD_SCOPE_PREFLIGHT_FAILED',
      message: error instanceof Error ? error.message : String(error),
      details: Object.freeze({
        status: error?.details?.status ?? null,
        larkCode: error?.details?.larkCode ?? null,
        requiredScopes: REQUIRED_LARK_DASHBOARD_CANONICAL_REBIND_SCOPES,
        remoteMutationCount: 0,
      }),
      production: 'BLOCKED',
    });
  if (attemptRoot) {
    await writePrivateJson(join(attemptRoot, 'scope-preflight-failure.json'), failure);
  }
  process.stderr.write(`${JSON.stringify({ ...failure, stage: currentStage }, null, 2)}\n`);
  process.exitCode = 1;
}

async function runReviewedOperator({ repositoryRoot, evidenceRoot }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [join(repositoryRoot, 'scripts', 'lark-dashboard-canonical-rebind.mjs'), '--execute'],
      {
        cwd: repositoryRoot,
        env: {
          ...process.env,
          MKT_LARK_DASHBOARD_CANONICAL_REBIND_EVIDENCE_DIR: evidenceRoot,
        },
        stdio: 'inherit',
      },
    );
    child.once('error', rejectPromise);
    child.once('close', (code, signal) => {
      if (signal) {
        const error = new Error(`Dashboard operator terminated by signal ${signal}`);
        error.code = 'LARK_DASHBOARD_OPERATOR_SIGNALLED';
        rejectPromise(error);
        return;
      }
      resolvePromise(Number.isInteger(code) ? code : 1);
    });
  });
}

async function resolveRepositoryRoot() {
  const result = await execFileAsync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  return resolve(requireText(result.stdout, 'repository root'));
}

async function writePrivateJson(path, value) {
  const text = `${JSON.stringify(value, null, 2)}\n`;
  await writeFile(path, text, { mode: 0o600 });
  await writeFile(
    `${path}.sha256`,
    `${createHash('sha256').update(text).digest('hex')}  ${path.split('/').at(-1)}\n`,
    { mode: 0o600 },
  );
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    const error = new Error(`${fieldName} is required`);
    error.code = 'LARK_DASHBOARD_SCOPE_PREFLIGHT_VALUE_INVALID';
    error.details = Object.freeze({ fieldName });
    throw error;
  }
  return value.trim();
}
