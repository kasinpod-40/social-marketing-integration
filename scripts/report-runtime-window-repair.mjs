#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
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
import {
  assertReportRuntimeSealedHead,
  buildReportRuntimeSealedChildEnvironment,
  buildReportRuntimeSealedCloneArgs,
  readReportRuntimeSealedContext,
  sanitizeReportRuntimeGitEnvironment,
} from './lib/report-runtime-sealed-execution.js';
import { secureLocalSecretFile } from './lib/local-secret-file-policy.js';

const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_WINDOW_REPAIR_EVIDENCE_DIR
    ?? 'outputs/report-runtime-window-repair',
);

try {
  const options = parseReportRuntimeWindowRepairArgs(process.argv.slice(2));
  if (!options.execute) {
    printPlan();
  } else {
    const sealedContext = readReportRuntimeSealedContext(process.env, repositoryRoot);
    if (sealedContext) await executeRepair(sealedContext);
    else await executeInSealedClone();
  }
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
      'snapshot-current-origin-main-into-sealed-clone',
      'pin-sealed-origin-to-local-main',
      'copy-private-runtime-inputs',
      'validate-clean-pinned-main',
      'reuse-valid-finalizer-evidence-or-finalize',
      ...REPORT_RUNTIME_WINDOW_REPAIR_SEQUENCE.map((step) => (
        `reuse-complete-or-run-${step.operation}-${step.windowDays}d`
      )),
      'aggregate-sanitized-evidence',
      'destroy-sealed-clone',
    ],
    safety: {
      exactMainOnly: true,
      originMainPinnedAtCommandStart: true,
      sealedOriginMainClone: true,
      sealedOriginFetchIsLocal: true,
      dynamicOriginMainDriftIsolated: true,
      mutableInvocationCheckoutUsedForExecution: false,
      inheritedGitContextRemoved: true,
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

async function executeInSealedClone() {
  assertReportRuntimeWindowRepairConfirmation(process.env);
  const devVars = await ensureDevVarsPermissions();
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });

  const sourceConfigPath = resolve(
    repositoryRoot,
    process.env.MKT_REPORT_RUNTIME_WINDOW_REPAIR_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const gitEnv = sanitizeReportRuntimeGitEnvironment(process.env);
  runGit(['fetch', 'origin', 'main', '--quiet'], { env: gitEnv });
  const originUrl = runGitText(['remote', 'get-url', 'origin'], { env: gitEnv });
  const pinnedHead = runGitText(['rev-parse', 'origin/main'], { env: gitEnv });

  const sandboxRoot = await mkdtemp(join(tmpdir(), 'mkt-report-window-repair-sealed-'));
  const cloneRoot = join(sandboxRoot, 'repository');
  try {
    runCommand('git', buildReportRuntimeSealedCloneArgs(originUrl, cloneRoot), {
      cwd: repositoryRoot,
      env: gitEnv,
      code: 'REPORT_RUNTIME_WINDOW_REPAIR_SEALED_CLONE_FAILED',
    });
    runGit(['checkout', '--force', '-B', 'main', pinnedHead], { cwd: cloneRoot, env: gitEnv });
    runGit(['remote', 'set-url', 'origin', '.'], { cwd: cloneRoot, env: gitEnv });
    runGit(['fetch', 'origin', 'main', '--quiet'], { cwd: cloneRoot, env: gitEnv });

    const cloneBranch = runGitText(['branch', '--show-current'], { cwd: cloneRoot, env: gitEnv });
    const cloneHead = runGitText(['rev-parse', 'HEAD'], { cwd: cloneRoot, env: gitEnv });
    const cloneOriginMainHead = runGitText(['rev-parse', 'origin/main'], { cwd: cloneRoot, env: gitEnv });
    const cloneDirty = runGitText(
      ['status', '--porcelain', '--untracked-files=all'],
      { cwd: cloneRoot, env: gitEnv, trim: false },
    );
    if (cloneBranch !== 'main'
      || cloneHead !== pinnedHead
      || cloneOriginMainHead !== pinnedHead
      || cloneDirty.trim() !== '') {
      throw repairFailure(
        'Sealed Report runtime clone does not match the pinned origin/main snapshot',
        'REPORT_RUNTIME_WINDOW_REPAIR_SEALED_CLONE_INVALID',
        {
          branch: cloneBranch,
          head: cloneHead,
          originMainHead: cloneOriginMainHead,
          expectedHead: pinnedHead,
          clean: cloneDirty.trim() === '',
        },
      );
    }

    const sealedDevVarsPath = join(cloneRoot, '.dev.vars');
    const sealedConfigPath = join(cloneRoot, 'wrangler.sync.jsonc');
    await snapshotPrivateFile(devVars.resolvedPath, sealedDevVarsPath, '.dev.vars');
    await snapshotPrivateFile(sourceConfigPath, sealedConfigPath, 'wrangler.sync.jsonc');

    const childEnv = buildReportRuntimeSealedChildEnvironment(process.env, {
      root: cloneRoot,
      head: pinnedHead,
      evidenceDir: outputRoot,
      devVarsFile: sealedDevVarsPath,
      wranglerConfigFile: sealedConfigPath,
    });
    const result = spawnSync(
      process.execPath,
      ['scripts/report-runtime-window-repair.mjs', '--execute'],
      {
        cwd: cloneRoot,
        stdio: 'inherit',
        env: childEnv,
      },
    );
    if (result.error || result.status !== 0) {
      throw repairFailure(
        'Sealed Report runtime execution did not complete successfully',
        'REPORT_RUNTIME_WINDOW_REPAIR_SEALED_CHILD_FAILED',
        { exitCode: result.status ?? 1, pinnedHead },
      );
    }
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}

async function executeRepair(sealedContext) {
  assertReportRuntimeWindowRepairConfirmation(process.env);
  const devVars = await ensureDevVarsPermissions();
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const repository = readRepositoryState(sealedContext);
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
      sealedOriginMainClone: repository.sealed === true,
      originMainPinnedAtCommandStart: repository.sealed === true,
      finalizerReused: finalizer.reused,
      reusedWindowCount: windows.filter((window) => window.reused).length,
      executedWindowCount: windows.filter((window) => !window.reused).length,
    }),
    windows: Object.freeze(windows),
    safety: Object.freeze({
      localDevVarsMode: devVars.mode,
      localDevVarsSymbolicLink: devVars.symbolicLink,
      sealedOriginMainClone: repository.sealed === true,
      sealedOriginFetchIsLocal: repository.sealed === true,
      dynamicOriginMainDriftIsolated: repository.sealed === true,
      mutableInvocationCheckoutUsedForExecution: false,
      inheritedGitContextRemoved: true,
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

function readRepositoryState(sealedContext) {
  const gitEnv = sanitizeReportRuntimeGitEnvironment(process.env);
  const branch = runGitText(['branch', '--show-current'], { env: gitEnv });
  const head = runGitText(['rev-parse', 'HEAD'], { env: gitEnv });
  const dirty = runGitText(
    ['status', '--porcelain', '--untracked-files=all'],
    { env: gitEnv, trim: false },
  );
  if (branch !== 'main' || dirty.trim() !== '') {
    throw repairFailure(
      'Report window repair requires a clean main checkout',
      'REPORT_RUNTIME_WINDOW_REPAIR_REPOSITORY_STATE_INVALID',
      { branch, head, clean: dirty.trim() === '' },
    );
  }

  if (sealedContext) {
    assertReportRuntimeSealedHead(sealedContext, head);
    return Object.freeze({
      branch,
      head,
      originMainHead: sealedContext.expectedHead,
      clean: true,
      sealed: true,
    });
  }

  runGit(['fetch', 'origin', 'main', '--quiet'], { env: gitEnv });
  const originMainHead = runGitText(['rev-parse', 'origin/main'], { env: gitEnv });
  if (head !== originMainHead) {
    throw repairFailure(
      'Report window repair requires current main equal to origin/main',
      'REPORT_RUNTIME_WINDOW_REPAIR_REPOSITORY_STATE_INVALID',
      { branch, head, originMainHead, clean: true },
    );
  }
  return Object.freeze({ branch, head, originMainHead, clean: true, sealed: false });
}

async function ensureDevVarsPermissions() {
  try {
    const inspected = await secureLocalSecretFile(resolve(repositoryRoot, '.dev.vars'), {
      expectedBasename: '.dev.vars',
    });
    if (!inspected.exists || !inspected.resolvedPath) throw repairFailure(
      'Required local .dev.vars file is missing',
      'REPORT_RUNTIME_WINDOW_REPAIR_DEV_VARS_INVALID',
    );
    return inspected;
  } catch (error) {
    if (error?.name === 'ReportRuntimeWindowRepairError') throw error;
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

async function snapshotPrivateFile(sourcePath, destinationPath, label) {
  let before;
  try {
    before = await stat(sourcePath, { bigint: true });
  } catch {
    throw repairFailure(
      `Required local ${label} file cannot be read`,
      'REPORT_RUNTIME_WINDOW_REPAIR_LOCAL_INPUT_INVALID',
      { label },
    );
  }
  if (!before.isFile()) throw repairFailure(
    `Required local ${label} target must be a regular file`,
    'REPORT_RUNTIME_WINDOW_REPAIR_LOCAL_INPUT_INVALID',
    { label },
  );

  const bytes = await readFile(sourcePath);
  const after = await stat(sourcePath, { bigint: true });
  if (before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs
    || before.ctimeNs !== after.ctimeNs) {
    throw repairFailure(
      `Required local ${label} changed while the sealed snapshot was being created`,
      'REPORT_RUNTIME_WINDOW_REPAIR_LOCAL_INPUT_CHANGED',
      { label },
    );
  }

  await writeFile(destinationPath, bytes, { mode: 0o600, flag: 'wx' });
  await chmod(destinationPath, 0o600);
  return Object.freeze({ label, bytes: bytes.length });
}

function runRequiredStep(name, args, env) {
  const result = spawnSync(process.execPath, args, {
    cwd: repositoryRoot,
    stdio: 'inherit',
    env,
  });
  if (result.error || result.status !== 0) {
    throw repairFailure(
      `Required Report window repair step failed: ${name}`,
      'REPORT_RUNTIME_WINDOW_REPAIR_STEP_FAILED',
      { name, exitCode: result.status ?? 1 },
    );
  }
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? sanitizeReportRuntimeGitEnvironment(process.env),
    stdio: options.stdio ?? 'inherit',
    encoding: options.stdio === 'inherit' ? undefined : 'utf8',
  });
  if (result.error || result.status !== 0) throw repairFailure(
    `Command failed: ${command}`,
    options.code ?? 'REPORT_RUNTIME_WINDOW_REPAIR_COMMAND_FAILED',
    { exitCode: result.status ?? 1 },
  );
  return result;
}

function runGit(args, options = {}) {
  return runCommand('git', args, {
    ...options,
    env: sanitizeReportRuntimeGitEnvironment(options.env ?? process.env),
    stdio: options.stdio ?? 'pipe',
    code: 'REPORT_RUNTIME_WINDOW_REPAIR_GIT_FAILED',
  });
}

function runGitText(args, options = {}) {
  const text = String(runGit(args, options).stdout ?? '');
  return options.trim === false ? text : text.trim();
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
    .filter(([key]) => !/(?:token|secret|authorization|cookie|password|tableId|fieldId|recordId|originUrl)/iu.test(key))
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
