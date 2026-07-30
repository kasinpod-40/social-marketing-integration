#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
  REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION,
  REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE,
  assertReportRuntimeWindowRepairConfirmation,
  parseReportRuntimeWindowRepairArgs,
} from './lib/report-runtime-window-repair.js';
import {
  assertReportWindowDirectorySafeToStart,
  summarizeReusableReportWindow,
  validateReusableReportFinalizerEvidence,
} from './lib/report-runtime-window-repair-resume.js';
import { secureLocalSecretFile } from './lib/local-secret-file-policy.js';

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
    details: sanitizeDetails(error?.details ?? {}),
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
      'validate-clean-current-main',
      'reuse-valid-finalizer-evidence-or-finalize',
      ...REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE.map((step) => (
        `reuse-complete-or-run-${step.operation}-${step.windowDays}d`
      )),
      'aggregate-sanitized-evidence',
    ],
    safety: {
      exactMainOnly: true,
      localDevVarsMode: '0600',
      localDevVarsWorktreeSymlinkSupported: true,
      sameHeadFinalizerReuse: true,
      completedWindowReuse: true,
      partialWindowAutomaticRerun: false,
      foreignExecutionWindowAutomaticOverride: false,
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
  const devVars = await ensureDevVarsPermissions();
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const repository = readRepositoryState();
  const finalizerRoot = join(outputRoot, 'finalizer');
  const finalizerEvidencePath = join(finalizerRoot, 'report-runtime-finalize-summary.json');
  const finalizer = await ensureFinalizerEvidence({
    path: finalizerEvidencePath,
    root: finalizerRoot,
    repositoryHead: repository.head,
  });

  const windows = [];
  for (const step of REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE) {
    const label = `${step.windowDays}d-${step.operation}`;
    const evidenceDir = join(outputRoot, label);
    const evidencePath = join(evidenceDir, 'report-runtime-closeout-summary.json');
    const existing = await readJsonIfExists(evidencePath);
    if (existing) {
      windows.push(Object.freeze({
        ...summarizeReusableReportWindow(existing, step),
        evidencePath,
      }));
      continue;
    }

    const entries = await readDirectoryEntries(evidenceDir);
    assertReportWindowDirectorySafeToStart(entries, step);
    runRequiredStep(label, ['scripts/report-runtime-closeout-operator.mjs', '--execute'], {
      ...process.env,
      MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE: finalizerEvidencePath,
      MKT_REPORT_RUNTIME_CLOSEOUT_EVIDENCE_DIR: evidenceDir,
      MKT_REPORT_RUNTIME_CLOSEOUT_WINDOW_DAYS: String(step.windowDays),
      MKT_REPORT_RUNTIME_CLOSEOUT_OPERATION: step.operation,
      CONFIRM_REPORT_RUNTIME_CLOSEOUT: 'EXECUTE_REPORT_RUNTIME_CLOSEOUT',
    });
    const summary = await readRequiredJson(evidencePath);
    windows.push(Object.freeze({
      ...summarizeReusableReportWindow(summary, step),
      reused: false,
      evidencePath,
    }));
  }

  const summary = Object.freeze({
    ok: true,
    decision: 'ORGANIC_DASHBOARD_WINDOWS_REPAIRED',
    sequence: REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE,
    finalizerEvidence: finalizerEvidencePath,
    execution: Object.freeze({
      repositoryHead: repository.head,
      finalizerReused: finalizer.reused,
      reusedWindowCount: windows.filter((window) => window.reused).length,
      executedWindowCount: windows.filter((window) => !window.reused).length,
    }),
    windows: Object.freeze(windows),
    safety: Object.freeze({
      localDevVarsMode: devVars.mode,
      localDevVarsSymbolicLink: devVars.symbolicLink,
      stableReportIds: true,
      manualD1OrLarkEditing: false,
      businessFactsDeleted: false,
      providerCalls: 0,
      schedulesEnabled: false,
      aiEnabled: false,
      production: false,
      partialWindowAutomaticRerun: false,
      foreignExecutionWindowAutomaticOverride: false,
      restoredAllFalseAfterEveryWindow: windows.every((window) => window.restoredAllFalse),
    }),
  });
  const summaryPath = join(outputRoot, 'report-runtime-window-repair-summary.json');
  await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, { mode: 0o600 });
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`);
}

async function ensureFinalizerEvidence(input) {
  const existing = await readJsonIfExists(input.path);
  if (existing) {
    try {
      validateReusableReportFinalizerEvidence(existing, input.repositoryHead);
      return Object.freeze({ reused: true, evidence: existing });
    } catch (error) {
      if (error?.code !== 'REPORT_RUNTIME_WINDOW_REPAIR_FINALIZER_HEAD_STALE') throw error;
    }
  }

  runRequiredStep('report-runtime-finalizer', ['scripts/report-runtime-finalize-operator.mjs', '--execute'], {
    ...process.env,
    MKT_REPORT_RUNTIME_FINALIZE_EVIDENCE_DIR: input.root,
    CONFIRM_REPORT_RUNTIME_FINALIZE: 'EXECUTE_REPORT_RUNTIME_FINALIZE',
  });
  const evidence = await readRequiredJson(input.path);
  validateReusableReportFinalizerEvidence(evidence, input.repositoryHead);
  return Object.freeze({ reused: false, evidence });
}

function readRepositoryState() {
  runGit(['fetch', 'origin', 'main', '--quiet']);
  const branch = runGitText(['branch', '--show-current']);
  const head = runGitText(['rev-parse', 'HEAD']);
  const originMainHead = runGitText(['rev-parse', 'origin/main']);
  const dirty = runGitText(['status', '--porcelain', '--untracked-files=all'], false);
  if (branch !== 'main' || head !== originMainHead || dirty.trim() !== '') {
    throw repairFailure(
      'Report window repair requires a clean current main checkout equal to origin/main',
      'REPORT_RUNTIME_WINDOW_REPAIR_REPOSITORY_STATE_INVALID',
      { branch, head, originMainHead, clean: dirty.trim() === '' },
    );
  }
  return Object.freeze({ branch, head, originMainHead, clean: true });
}

async function ensureDevVarsPermissions() {
  try {
    return await secureLocalSecretFile(resolve(repositoryRoot, '.dev.vars'), {
      expectedBasename: '.dev.vars',
    });
  } catch (error) {
    const permissionFailure = [
      'LOCAL_SECRET_FILE_PERMISSION_FAILED',
      'LOCAL_SECRET_FILE_TARGET_CHANGED',
    ].includes(error?.code);
    throw repairFailure(
      error instanceof Error ? error.message : 'Unable to validate .dev.vars',
      permissionFailure
        ? 'REPORT_RUNTIME_WINDOW_REPAIR_DEV_VARS_PERMISSION_FAILED'
        : 'REPORT_RUNTIME_WINDOW_REPAIR_DEV_VARS_INVALID',
    );
  }
}

function runRequiredStep(name, args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env,
  });
  if (result.status !== 0) {
    throw repairFailure(
      `Required Report window repair step failed: ${name}`,
      'REPORT_RUNTIME_WINDOW_REPAIR_STEP_FAILED',
      { name, exitCode: result.status ?? 1 },
    );
  }
}

function runGit(args) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8' });
  if (result.status !== 0) throw repairFailure(
    `Git command failed: git ${args.join(' ')}`,
    'REPORT_RUNTIME_WINDOW_REPAIR_GIT_FAILED',
    { exitCode: result.status ?? 1 },
  );
  return result;
}

function runGitText(args, trim = true) {
  const text = String(runGit(args).stdout ?? '');
  return trim ? text.trim() : text;
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    if (error instanceof SyntaxError) throw repairFailure(
      'Report window evidence JSON is invalid',
      'REPORT_RUNTIME_WINDOW_REPAIR_EVIDENCE_JSON_INVALID',
      { path },
    );
    throw error;
  }
}

async function readRequiredJson(path) {
  const value = await readJsonIfExists(path);
  if (!value) throw repairFailure(
    'Required Report window evidence is missing',
    'REPORT_RUNTIME_WINDOW_REPAIR_EVIDENCE_MISSING',
    { path },
  );
  return value;
}

async function readDirectoryEntries(path) {
  try {
    return await readdir(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return [];
    throw error;
  }
}

function sanitizeDetails(value) {
  if (Array.isArray(value)) return value.map(sanitizeDetails);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:token|secret|authorization|cookie|password|tableId|fieldId|recordId)/iu.test(key))
    .map(([key, nested]) => [key, sanitizeDetails(nested)]));
}

function repairFailure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportRuntimeWindowRepairError';
  error.code = code;
  error.details = details;
  return error;
}

export const REPORT_RUNTIME_WINDOW_REPAIR_ONE_COMMAND = Object.freeze({
  confirmation: REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION,
  command: `CONFIRM_REPORT_RUNTIME_WINDOW_REPAIR=${REPORT_RUNTIME_WINDOW_REPAIR_CONFIRMATION} node scripts/report-runtime-window-repair.mjs --execute`,
});
