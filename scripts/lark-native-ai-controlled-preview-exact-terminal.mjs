#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, isAbsolute, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { buildLarkNativeAiControlledPreviewReadiness } from '../packages/application/src/reports/build-lark-native-ai-controlled-preview-readiness.js';
import {
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_DEFAULT_SOURCE_PATH,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_EVIDENCE_SCHEMA_VERSION,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_OUTPUT_ROOT,
  LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION,
} from '../packages/config/src/lark-native-ai-controlled-preview-exact-terminal-contract.js';
import {
  assertLarkNativeAiControlledPreviewExactTerminalConfirmation,
  assertLarkNativeAiControlledPreviewExactTerminalFirstPass,
  assertLarkNativeAiControlledPreviewExactTerminalNodeVersion,
  assertLarkNativeAiControlledPreviewExactTerminalReplay,
  assertLarkNativeAiControlledPreviewExactTerminalRepository,
  buildLarkNativeAiControlledPreviewExactTerminalChildEnv,
  buildLarkNativeAiControlledPreviewExactTerminalReadiness,
  exactTerminalError,
  parseLarkNativeAiControlledPreviewExactTerminalArgs,
  sanitizeLarkNativeAiControlledPreviewExactTerminalValue,
  validateLarkNativeAiControlledPreviewSourcePackage,
} from './lib/lark-native-ai-controlled-preview-exact-terminal.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const sourcePath = resolve(
  process.env.MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE
    ?? LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_DEFAULT_SOURCE_PATH,
);
const outputRoot = resolve(
  process.env.MKT_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_OUTPUT_ROOT
    ?? LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_OUTPUT_ROOT,
);
const lockPath = resolve(outputRoot, '.exact-terminal.lock');

let stage = 'init';
let repository = null;
let sourcePackage = null;
let attemptDirectory = null;
let lockHandle = null;
let summaryWritten = false;

try {
  const options = parseLarkNativeAiControlledPreviewExactTerminalArgs(process.argv.slice(2));
  if (!options.execute) printPlan();
  else await executeExactTerminal();
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_FAILED',
    message: sanitizeLarkNativeAiControlledPreviewExactTerminalValue(
      error?.message ?? String(error),
    ),
    details: sanitizeLarkNativeAiControlledPreviewExactTerminalValue(error?.details ?? {}),
    repository,
    sourcePackageSha256: sourcePackage?.packageSha256 ?? null,
    attemptDirectory: attemptDirectory ? relative(repositoryRoot, attemptDirectory) : null,
    aiCallCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    automationCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  if (attemptDirectory && !summaryWritten) {
    try {
      await writePrivateJson(resolve(attemptDirectory, 'failure-summary.json'), failure);
      summaryWritten = true;
    } catch {
      // Preserve the primary failure. The stderr JSON still contains the exact stage and code.
    }
  }
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (lockHandle) {
    try { await lockHandle.close(); } catch { /* no-op */ }
    try { await unlink(lockPath); } catch { /* preserve primary result */ }
  }
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
    objective: 'validate_retained_real_report_evidence_then_apply_and_replay_exact_40_lark_preview_rows',
    defaultSourcePackage: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_DEFAULT_SOURCE_PATH,
    sourcePackageRequirements: [
      'private regular file mode 0600; symlink forbidden',
      'exact current main Head and retained package checksum',
      'exact validated real-data Offline inputs for 1D/3D/7D/30D',
      'Lark schema zero drift with exact 6/6 View filters',
      'released all-false Remote authority captured after the prior Terminal stopped',
      'Fixture, dummy, placeholder and sample generation identities forbidden',
    ],
    exactCommand: [
      `CONFIRM_LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL=${LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONFIRMATION}`,
      'node scripts/lark-native-ai-controlled-preview-exact-terminal.mjs --execute',
    ].join(' '),
    executionSequence: [
      'fetch origin/main and require clean exact local main',
      'acquire one local exact-terminal lock without stale-lock deletion',
      'validate retained source package before any Lark request',
      'build exact approved readiness plans for 1D/3D/7D/30D',
      'write private head-bound Live Pilot input',
      'run bounded Lark apply with fixed client limits',
      'run a separate same-input replay',
      'require 40 no-op / zero writes',
      'write immutable private attempt evidence',
    ],
    maximumFirstPassWrites:
      LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.maximumFirstPassWrites,
    replayWritesRequired: 0,
    deleteActionCount: 0,
    schemaMutationCount: 0,
    aiCallCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    executed: false,
  }, null, 2)}\n`);
}

async function executeExactTerminal() {
  stage = 'confirmation';
  assertLarkNativeAiControlledPreviewExactTerminalConfirmation(process.env);
  assertLarkNativeAiControlledPreviewExactTerminalNodeVersion(process.versions.node);

  stage = 'fetch-origin-main';
  await runGit(['fetch', '--quiet', 'origin', 'main']);

  stage = 'repository-preflight';
  repository = assertLarkNativeAiControlledPreviewExactTerminalRepository({
    branch: await gitText(['branch', '--show-current']),
    head: await gitText(['rev-parse', 'HEAD']),
    originMain: await gitText(['rev-parse', 'origin/main']),
    clean: (await gitText(['status', '--porcelain'])) === '',
  });

  stage = 'acquire-local-execution-lock';
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await chmod(outputRoot, 0o700);
  lockHandle = await acquireExecutionLock();

  stage = 'load-private-retained-source-package';
  await assertPrivateRegularRepositoryFile(sourcePath);
  const sourceBytes = await readFile(sourcePath);
  if (sourceBytes.byteLength > LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.maximumSourcePackageBytes) {
    throw exactTerminalError(
      'Retained source package exceeds the reviewed byte limit',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_TOO_LARGE',
      {
        maximumBytes:
          LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.maximumSourcePackageBytes,
        observedBytes: sourceBytes.byteLength,
      },
    );
  }
  sourcePackage = await validateLarkNativeAiControlledPreviewSourcePackage(
    parseJson(sourceBytes.toString('utf8'), 'retained source package'),
    repository,
  );

  stage = 'create-immutable-attempt-directory';
  attemptDirectory = await createAttemptDirectory(sourcePackage.packageSha256);
  const inputPath = resolve(attemptDirectory, 'live-pilot-input.json');
  const firstEvidencePath = resolve(attemptDirectory, '01-first-pass.json');
  const replayEvidencePath = resolve(attemptDirectory, '02-same-input-replay.json');

  stage = 'build-exact-four-window-readiness';
  const readinessPlans = await buildLarkNativeAiControlledPreviewExactTerminalReadiness({
    sourcePackage,
    repository,
    buildReadiness: buildLarkNativeAiControlledPreviewReadiness,
  });
  await writePrivateJson(inputPath, {
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_LIVE_PILOT_INPUT_SCHEMA_VERSION,
    readinessPlans,
  });

  stage = 'lark-first-pass';
  const firstPassRaw = await runLivePilotChild({
    inputPath,
    evidencePath: firstEvidencePath,
    passName: 'first-pass',
  });
  const firstPass = assertLarkNativeAiControlledPreviewExactTerminalFirstPass(firstPassRaw);

  stage = 'lark-same-input-replay';
  const replayRaw = await runLivePilotChild({
    inputPath,
    evidencePath: replayEvidencePath,
    passName: 'same-input-replay',
  });
  const replay = assertLarkNativeAiControlledPreviewExactTerminalReplay(replayRaw);

  stage = 'write-exact-terminal-summary';
  const summary = Object.freeze({
    ok: true,
    schemaVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_EVIDENCE_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
    stage: 'complete',
    repository,
    sourcePackageSha256: sourcePackage.packageSha256,
    sourceEvidenceSha256: sourcePackage.provenance.sourceEvidenceSha256,
    windows: sourcePackage.offlineInputs.map((item) => item.window.windowDays),
    firstPass: {
      mode: firstPass.mode,
      writes: firstPass.writes,
      verification: firstPass.verification,
      remote: firstPass.remote,
    },
    replay: {
      mode: replay.mode,
      writes: replay.writes,
      verification: replay.verification,
      remote: replay.remote,
    },
    totalRecordWrites: firstPass.writes.total,
    sameInputReplayWrites: replay.writes.total,
    deleteActionCount: 0,
    schemaMutationCount: 0,
    aiCallCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    automationCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    attemptDirectory: relative(repositoryRoot, attemptDirectory),
  });
  await writePrivateJson(resolve(attemptDirectory, 'summary.json'), summary);
  summaryWritten = true;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function runLivePilotChild({ inputPath, evidencePath, passName }) {
  const env = buildLarkNativeAiControlledPreviewExactTerminalChildEnv(process.env, {
    head: repository.exactHeadSha,
    inputPath,
    evidencePath,
  });
  try {
    const result = await execFileAsync(process.execPath, [
      'scripts/lark-native-ai-controlled-preview-live-pilot.mjs',
      '--execute',
    ], {
      cwd: repositoryRoot,
      env,
      encoding: 'utf8',
      timeout: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.childTimeoutMs,
      maxBuffer: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LIMITS.childMaxBufferBytes,
    });
    return parseChildJson(result.stdout, passName);
  } catch (error) {
    const retained = await readOptionalJson(evidencePath);
    const childEvidence = retained
      ?? parseOptionalChildJson(error?.stdout)
      ?? parseOptionalChildJson(error?.stderr)
      ?? {};
    throw exactTerminalError(
      `Controlled Preview ${passName} child process failed`,
      childEvidence.code ?? 'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_FAILED',
      {
        passName,
        childStage: childEvidence.stage ?? null,
        childMessage: childEvidence.message ?? null,
        childDetails: childEvidence.details ?? {},
        childExitCode: Number.isInteger(error?.code) ? error.code : null,
        childSignal: error?.signal ?? null,
        automaticRetryPerformed: false,
      },
    );
  }
}

async function acquireExecutionLock() {
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({
      contractVersion: LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CONTRACT_VERSION,
      head: repository.exactHeadSha,
      pid: process.pid,
      createdAt: Date.now(),
    })}\n`, 'utf8');
    await chmod(lockPath, 0o600);
    return handle;
  } catch (error) {
    if (error?.code === 'EEXIST') throw exactTerminalError(
      'A Controlled Preview Exact Terminal lock already exists; it is never deleted automatically',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_LOCK_EXISTS',
      { lockPath: relative(repositoryRoot, lockPath) },
    );
    throw error;
  }
}

async function assertPrivateRegularRepositoryFile(path) {
  const location = relative(repositoryRoot, path);
  if (location === '' || location.startsWith('..') || isAbsolute(location)) throw exactTerminalError(
    'Retained source package must be inside the repository working tree',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_PATH_INVALID',
  );
  let metadata;
  try { metadata = await lstat(path); } catch (error) {
    throw exactTerminalError(
      'Retained source package was not found at the exact configured path',
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_NOT_FOUND',
      { sourcePath: location, sourceCode: error?.code ?? null },
    );
  }
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw exactTerminalError(
    'Retained source package must be a regular non-symlink file',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_FILE_TYPE_INVALID',
    { sourcePath: location },
  );
  if ((metadata.mode & 0o077) !== 0) throw exactTerminalError(
    'Retained source package must use private mode 0600',
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_SOURCE_PACKAGE_MODE_INVALID',
    { sourcePath: location, observedMode: (metadata.mode & 0o777).toString(8) },
  );
}

async function createAttemptDirectory(packageSha256) {
  const timestamp = new Date().toISOString().replace(/[-:.]/gu, '').replace('Z', 'Z');
  const path = resolve(outputRoot, `${timestamp}-${packageSha256.slice(0, 12)}-${process.pid}`);
  await mkdir(path, { recursive: false, mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(path, 0o600);
}

async function readOptionalJson(path) {
  try { return parseJson(await readFile(path, 'utf8'), 'retained child evidence'); }
  catch (error) {
    if (error?.code === 'ENOENT') return null;
    return null;
  }
}

function parseChildJson(value, label) {
  const parsed = parseOptionalChildJson(value);
  if (!parsed) throw exactTerminalError(
    `Controlled Preview ${label} child returned invalid JSON`,
    'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_CHILD_JSON_INVALID',
    { label },
  );
  return parsed;
}

function parseOptionalChildJson(value) {
  const text = String(value ?? '').trim();
  if (!text) return null;
  try { return JSON.parse(text); } catch { /* continue */ }
  const starts = [...text.matchAll(/\{/gu)].map((match) => match.index).reverse();
  for (const start of starts) {
    try { return JSON.parse(text.slice(start)); } catch { /* continue */ }
  }
  return null;
}

function parseJson(value, label) {
  try { return JSON.parse(String(value)); } catch (cause) {
    const error = exactTerminalError(
      `${label} is not valid JSON`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_JSON_INVALID',
    );
    error.cause = cause;
    throw error;
  }
}

async function runGit(args) {
  try {
    await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
  } catch (error) {
    throw exactTerminalError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}

async function gitText(args) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
    });
    return String(result.stdout ?? '').trim();
  } catch (error) {
    throw exactTerminalError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_CONTROLLED_PREVIEW_EXACT_TERMINAL_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}
