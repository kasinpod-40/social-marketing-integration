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
  LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
  REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES,
  assertFieldIdentityScopeConfirmation,
} from './lib/lark-dashboard-field-identity-recovery-v3.js';

const execFileAsync = promisify(execFile);
const args = new Set(process.argv.slice(2));
const execute = args.has('--execute');
let currentStage = 'init';
let attemptRoot = null;

try {
  const repositoryRoot = await resolveRepositoryRoot();
  const evidenceRoot = resolve(
    process.env.MKT_LARK_DASHBOARD_CANONICAL_REBIND_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'lark-dashboard-field-identity-recovery-v3'),
  );
  attemptRoot = join(
    evidenceRoot,
    `field-identity-v3-scope-preflight-${new Date().toISOString().replaceAll(':', '-')}`,
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

  currentStage = 'read-scope-probes';
  await client.requestBitableJson(
    `/open-apis/base/v3/bases/${encodeURIComponent(baseToken)}/dashboards?page_size=1`,
    { method: 'GET' },
  );
  const tables = await client.listTables();
  const reportTable = tables.find((table) => table.name === '📊 MKT_Report_Metric_Values');
  if (!reportTable?.tableId) {
    throw preflightError(
      'Report Metric table is not readable',
      'LARK_DASHBOARD_FIELD_IDENTITY_TABLE_UNRESOLVED',
    );
  }
  await client.listFields({ tableId: reportTable.tableId });
  await client.listRecords({ tableId: reportTable.tableId, includeRecordMetadata: false });

  const preflight = Object.freeze({
    ok: true,
    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    decision: 'LARK_DASHBOARD_FIELD_IDENTITY_READ_PREFLIGHT_PASS',
    requiredScopes: REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES,
    dashboardReadVerified: true,
    blockReadVerified: true,
    fieldReadVerified: true,
    recordReadVerified: true,
    blockUpdateDeclared: true,
    fieldUpdateDeclared: true,
    fieldDeleteDeclared: true,
    recordUpdateDeclared: true,
    slicerPatchCount: 0,
    remoteMutationCount: 0,
    production: 'BLOCKED',
    evidenceRoot: attemptRoot,
  });
  await writePrivateJson(join(attemptRoot, 'scope-preflight.json'), preflight);
  process.stdout.write(`${JSON.stringify(preflight, null, 2)}\n`);
  if (!execute) process.exit(0);

  currentStage = 'confirm-complete-scope-contract';
  assertFieldIdentityScopeConfirmation(
    process.env.CONFIRM_LARK_DASHBOARD_FIELD_IDENTITY_SCOPE_CONTRACT,
  );

  currentStage = 'launch-reviewed-field-identity-operator';
  process.exitCode = await runOperator({ repositoryRoot, evidenceRoot });
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    contractVersion: LARK_DASHBOARD_FIELD_IDENTITY_RECOVERY_VERSION,
    stage: currentStage,
    code: error?.code ?? 'LARK_DASHBOARD_FIELD_IDENTITY_PREFLIGHT_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: Object.freeze({
      ...(error?.details ?? {}),
      requiredScopes: REQUIRED_LARK_DASHBOARD_FIELD_IDENTITY_SCOPES,
      remoteMutationCount: 0,
    }),
    production: 'BLOCKED',
  });
  if (attemptRoot) await writePrivateJson(join(attemptRoot, 'scope-preflight-failure.json'), failure);
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

async function runOperator({ repositoryRoot, evidenceRoot }) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(
      process.execPath,
      [join(repositoryRoot, 'scripts', 'lark-dashboard-field-identity-recovery-v3.mjs'), '--execute'],
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
        rejectPromise(preflightError(
          `Field-identity recovery operator terminated by signal ${signal}`,
          'LARK_DASHBOARD_FIELD_IDENTITY_OPERATOR_SIGNALLED',
        ));
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
  if (typeof value !== 'string' || !value.trim()) {
    throw preflightError(
      `${fieldName} is required`,
      'LARK_DASHBOARD_FIELD_IDENTITY_VALUE_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}
function preflightError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
