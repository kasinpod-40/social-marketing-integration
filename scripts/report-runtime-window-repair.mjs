#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION,
  REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE,
  assertReportRuntimeWindowRepairConfirmation,
  parseReportRuntimeWindowRepairArgs,
} from './lib/report-runtime-window-repair.js';

const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_WINDOW_REPAIR_EVIDENCE_DIR
    ?? 'outputs/report-runtime-window-repair',
);

try {
  const options = parseReportRuntimeWindowRepairArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeRepair();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    code: error?.code ?? 'REPORT_RUNTIME_WINDOW_REPAIR_FAILED',
    message: error instanceof Error ? error.message : String(error),
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    command: `CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR=${REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION} node scripts/report-runtime-window-repair.mjs --execute`,
    sequence: REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE,
    stages: [
      'secure-local-dev-vars-permissions',
      'finalize-schema-and-58-dashboard-settings',
      ...REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE.map((step) => `${step.operation}-${step.windowDays}d`),
      'aggregate-sanitized-evidence',
    ],
    safety: {
      exactMainOnly: true,
      localDevVarsMode: '0600',
      remoteD1BackupBeforeEveryWindow: true,
      stableReportIds: true,
      manualD1OrLarkEditing: false,
      connectorsEnabled: false,
      providerCalls: false,
      schedulesEnabled: false,
      aiEnabled: false,
      production: false,
      automaticAllFalseRestoreAfterEveryWindow: true,
    },
  }, null, 2)}\n`);
}

async function executeRepair() {
  assertReportRuntimeWindowRepairConfirmation(process.env);
  await ensureDevVarsPermissions();
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const finalizerRoot = join(outputRoot, 'finalizer');
  const finalizerEvidence = join(finalizerRoot, 'report-runtime-finalize-summary.json');

  runRequiredStep('report-runtime-finalizer', ['scripts/report-runtime-finalize-operator.mjs', '--execute'], {
    ...process.env,
    MKT_REPORT_RUNTIME_FINALIZE_EVIDENCE_DIR: finalizerRoot,
    CONFIRM_REPORT_RUNTIME_FINALIZE: 'EXECUTE_REPORT_RUNTIME_FINALIZE',
  });

  const windows = [];
  for (const step of REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE) {
    const label = `${step.windowDays}d-${step.operation}`;
    const evidenceDir = join(outputRoot, label);
    runRequiredStep(label, ['scripts/report-runtime-closeout-operator.mjs', '--execute'], {
      ...process.env,
      MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE: finalizerEvidence,
      MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: evidenceDir,
      MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: String(step.windowDays),
      MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: step.operation,
      CONFIRM_REPORT_RUNTIME_CLOSEOUT: 'EXECUTE_REPORT_RUNTIME_CLOSEOUT',
    });
    const summary = JSON.parse(await readFile(
      join(evidenceDir, 'report-runtime-closeout-summary.json'),
      'utf8',
    ));
    windows.push(Object.freeze({
      windowDays: step.windowDays,
      operation: step.operation,
      decision: summary.decision,
      reportId: summary.target?.reportId ?? null,
      dataStatus: summary.materialization?.dataStatus ?? null,
      integrity: summary.materialization?.integrity ?? null,
      restoredAllFalse: summary.runtime?.restoredAllFalse === true,
      finalWorkerVersion: summary.runtime?.finalWorkerVersion ?? null,
      evidencePath: join(evidenceDir, 'report-runtime-closeout-summary.json'),
    }));
  }

  const summary = Object.freeze({
    ok: true,
    decision: 'ORGANIC_DASHBOARD_WINDOWS_REPAIRED',
    sequence: REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE,
    finalizerEvidence,
    windows: Object.freeze(windows),
    safety: Object.freeze({
      localDevVarsMode: process.platform === 'win32' ? 'platform-managed' : '0600',
      stableReportIds: true,
      manualD1OrLarkEditing: false,
      businessFactsDeleted: false,
      providerCalls: 0,
      schedulesEnabled: false,
      aiEnabled: false,
      production: false,
      restoredAllFalseAfterEveryWindow: windows.every((window) => window.restoredAllFalse),
    }),
  });
  const summaryPath = join(outputRoot, 'report-runtime-window-repair-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`);
}

async function ensureDevVarsPermissions() {
  const devVarsPath = resolve(repositoryRoot, '.dev.vars');
  let before;
  try {
    before = await lstat(devVarsPath);
  } catch (error) {
    if (error?.code === 'ENOENT') return Object.freeze({ exists: false, mode: null });
    throw error;
  }
  if (!before.isFile() || before.isSymbolicLink()) {
    throw repairFailure(
      '.dev.vars must be a regular non-symlink file before Report repair execution',
      'REPORT_RUNTIME_WINDOW_REPAIR_DEV_VARS_INVALID',
    );
  }
  if (process.platform === 'win32') return Object.freeze({ exists: true, mode: 'platform-managed' });
  await chmod(devVarsPath, 0o600);
  const after = await lstat(devVarsPath);
  if ((after.mode & 0o077) !== 0) {
    throw repairFailure(
      'Unable to restrict .dev.vars permissions to owner-only access',
      'REPORT_RUNTIME_WINDOW_REPAIR_DEV_VARS_PERMISSION_FAILED',
    );
  }
  return Object.freeze({ exists: true, mode: '0600' });
}

function runRequiredStep(name, args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env,
  });
  if (result.status !== 0) {
    const error = new Error(`Required Report window repair step failed: ${name}`);
    error.name = 'ReportRuntimeWindowRepairError';
    error.code = 'REPORT_RUNTIME_WINDOW_REPAIR_STEP_FAILED';
    error.details = { name, exitCode: result.status ?? 1 };
    throw error;
  }
}

function repairFailure(message, code) {
  const error = new Error(message);
  error.name = 'ReportRuntimeWindowRepairError';
  error.code = code;
  return error;
}

export const REPORT_RUNTIME_WINDOW_REPAIR_ONE_COMMAND = Object.freeze({
  confirmation: REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION,
  command: `CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR=${REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION} node scripts/report-runtime-window-repair.mjs --execute`,
});
