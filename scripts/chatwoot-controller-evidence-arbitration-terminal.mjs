#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join, relative, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import {
  readChatwootExecutionFlags,
  selectChatwootControllerEvidence,
  validateChatwootSafeBaselineSelectionHint,
} from './lib/chatwoot-controller-evidence-arbitration.js';
import {
  materializeChatwootControllerEvidenceDirectory,
} from './lib/chatwoot-controller-evidence-isolation.js';
import {
  CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
} from './lib/chatwoot-final-30d-daily-uat.js';
import {
  validateRetainedSession,
} from './lib/chatwoot-initial-terminal-failure-recovery.js';
import {
  parseChatwootWranglerJsonOutput,
} from './lib/chatwoot-final-source-config-recovery.js';
import { readDevVars } from './lib/dev-vars.js';

const WRAPPER_HEAD_ENV = 'MKT_CHATWOOT_EVIDENCE_ARBITRATION_WRAPPER_HEAD';
const CONFIRMATION_ENV = 'CONFIRM_CHATWOOT_INITIAL_FAILURE_RECOVERY';
const CONFIRMATION_VALUE = 'RECOVER_EXACT_CHATWOOT_INITIAL_TO_LARK_PARITY';
const CHILD = 'scripts/chatwoot-initial-terminal-failure-recovery-launcher.mjs';
const WORKER_NAME = 'social-mkt-sync-worker';
const FINAL_UAT_OUTPUT = 'chatwoot-final-30d-daily-uat';
const SAFE_BASELINE_OUTPUT = 'chatwoot-controller-safe-baseline-resume';
const SAFE_BASELINE_ATTEMPT = '01-active-window.attempt.json';
const SOURCE_CONFIG = 'wrangler.sync.jsonc';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CLONE_EXCLUDES = Object.freeze([
  '/outputs',
  '/.dev.vars',
  '/node_modules',
  `/${SOURCE_CONFIG}`,
]);

const repositoryRoot = resolve(process.cwd());
let stage = 'init';
let temporaryRoot = null;
let childStarted = false;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
  } else {
    stage = 'confirm-chatwoot-evidence-arbitration';
    assertConfirmation(process.env);

    stage = 'verify-chatwoot-wrapper-checkout';
    const repository = verifyWrapperCheckout(process.env);

    stage = 'load-chatwoot-local-runtime';
    const assets = await verifyLocalAssets();
    const fileEnv = await readDevVars(assets.devVars);
    const env = Object.freeze({ ...fileEnv, ...process.env });

    stage = 'read-chatwoot-safe-baseline-selection-handoff';
    const selectionHint = await readSafeBaselineSelectionHint(
      assets.outputs,
      repository.currentHead,
    );

    stage = 'read-current-chatwoot-worker';
    const worker = readCurrentChatwootWorker(env, assets.sourceConfig);

    stage = 'select-chatwoot-controller-evidence';
    const selection = await selectCurrentControllerEvidence({
      outputs: assets.outputs,
      currentHead: repository.currentHead,
      currentActiveVersion: worker.activeVersion,
      selectionHint,
    });

    stage = 'prepare-chatwoot-isolated-evidence-view';
    const isolated = await prepareIsolatedEvidenceView({
      assets,
      selection,
      wrapperHead: repository.currentHead,
    });
    temporaryRoot = isolated.temporaryRoot;

    stage = 'run-chatwoot-selected-controller-resume';
    childStarted = true;
    const child = spawnSync(
      process.execPath,
      [join(isolated.cloneRoot, CHILD), '--execute'],
      {
        cwd: isolated.cloneRoot,
        env: {
          ...process.env,
          DEV_VARS_FILE: join(isolated.cloneRoot, '.dev.vars'),
          MKT_CHATWOOT_INITIAL_FAILURE_WRANGLER_CONFIG: SOURCE_CONFIG,
        },
        encoding: 'utf8',
        maxBuffer: 512 * 1024 * 1024,
        stdio: 'inherit',
      },
    );
    if (child.error) throw child.error;
    process.exitCode = child.status ?? 1;
    if (child.status === 0) {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        marker: 'CHATWOOT_CONTROLLER_EVIDENCE_ARBITRATION_COMPLETED_SAFE',
        wrapperHead: repository.currentHead,
        candidateCount: selection.candidateCount,
        selectedBy: selection.selectedBy,
        selectionHandoffUsed: selectionHint !== null,
        selectedEvidenceRealDirectory: true,
        restoredAllFlagsFalseExpectedFromChild: true,
        scheduleEnabled: false,
        webhookEnabled: false,
        production: 'BLOCKED',
      }, null, 2)}\n`);
    }
  }
} catch (error) {
  const failure = {
    ok: false,
    stage,
    code: error?.code ?? 'CHATWOOT_CONTROLLER_EVIDENCE_ARBITRATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: scrub(error?.details ?? {}),
    safeRestore: childStarted
      ? 'OWNED_BY_INNER_OPERATOR_AFTER_CHILD_START'
      : 'NOT_REQUIRED_BEFORE_CHILD_START',
    scheduleEnabled: false,
    webhookEnabled: false,
    production: 'BLOCKED',
  };
  if (!childStarted) {
    Object.assign(failure, {
      providerRequests: 0,
      queueActions: 0,
      remoteD1Mutations: 0,
      remoteLarkMutations: 0,
      workerDeployments: 0,
      incidentClosureActions: 0,
    });
  }
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (temporaryRoot) {
    await rm(temporaryRoot, { recursive: true, force: true }).catch(() => undefined);
  }
}

function parseArgs(args) {
  const unknown = args.filter((argument) => argument !== '--execute');
  if (unknown.length > 0) {
    throw wrapperError(
      'Chatwoot evidence arbitration accepts only --execute',
      'CHATWOOT_CONTROLLER_EVIDENCE_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: 'chatwoot_controller_evidence_arbitration_v3',
    wrapperHeadEnv: WRAPPER_HEAD_ENV,
    confirmation: `${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
    selectionAuthority: 'current_active_worker_version_or_verified_safe_baseline_handoff',
    selectedEvidenceView: 'temporary_real_directory_copy',
    child: CHILD,
    retainedEvidenceMutation: false,
    secondInitialAdmissionAllowed: false,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: 'BLOCKED',
    remoteActionsPerformed: false,
  }, null, 2)}\n`);
}

function assertConfirmation(env) {
  if (env[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
    throw wrapperError(
      `Chatwoot evidence arbitration requires ${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      'CHATWOOT_CONTROLLER_EVIDENCE_CONFIRMATION_REQUIRED',
      { envName: CONFIRMATION_ENV },
    );
  }
}

function verifyWrapperCheckout(env) {
  const expectedHead = requireSha(env[WRAPPER_HEAD_ENV], WRAPPER_HEAD_ENV);
  const currentHead = gitText(repositoryRoot, ['rev-parse', 'HEAD']);
  const originMain = gitText(repositoryRoot, ['rev-parse', 'origin/main']);
  const branch = gitText(repositoryRoot, ['branch', '--show-current'], false);
  const dirty = gitText(
    repositoryRoot,
    ['status', '--porcelain', '--untracked-files=all'],
    false,
  );
  if (currentHead !== expectedHead || dirty.trim() !== '') {
    throw wrapperError(
      'Chatwoot evidence arbitration requires the exact clean reviewed wrapper commit',
      'CHATWOOT_CONTROLLER_EVIDENCE_WRAPPER_CHECKOUT_INVALID',
      {
        expectedHead,
        currentHead,
        originMain,
        branch: branch || '(detached)',
        clean: dirty.trim() === '',
      },
    );
  }
  if (!gitSuccess(repositoryRoot, ['merge-base', '--is-ancestor', currentHead, originMain])) {
    throw wrapperError(
      'Reviewed Chatwoot evidence wrapper is not contained in current origin/main history',
      'CHATWOOT_CONTROLLER_EVIDENCE_WRAPPER_ANCESTRY_INVALID',
      { currentHead, originMain },
    );
  }
  const conflicts = Object.keys(env).filter(
    (key) => /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key),
  );
  if (conflicts.length > 0) {
    throw wrapperError(
      'Chatwoot evidence arbitration refuses caller-provided Git config overrides',
      'CHATWOOT_CONTROLLER_EVIDENCE_GIT_CONFIG_ENV_INVALID',
      { conflicts: conflicts.sort() },
    );
  }
  return Object.freeze({ currentHead, originMain, branch: branch || '(detached)' });
}

async function verifyLocalAssets() {
  const outputs = join(repositoryRoot, 'outputs');
  const devVars = join(repositoryRoot, '.dev.vars');
  const nodeModules = join(repositoryRoot, 'node_modules');
  const sourceConfig = join(repositoryRoot, SOURCE_CONFIG);
  await assertDirectory(outputs, 'outputs');
  await assertPrivateRegularFile(devVars, '.dev.vars');
  await assertDirectory(nodeModules, 'node_modules');
  await assertRegularFile(sourceConfig, SOURCE_CONFIG);
  await assertDirectory(join(outputs, FINAL_UAT_OUTPUT), FINAL_UAT_OUTPUT);
  return Object.freeze({ outputs, devVars, nodeModules, sourceConfig });
}

async function readSafeBaselineSelectionHint(outputs, currentHead) {
  const path = join(
    outputs,
    SAFE_BASELINE_OUTPUT,
    currentHead,
    SAFE_BASELINE_ATTEMPT,
  );
  let link;
  try {
    link = await lstat(path);
  } catch (cause) {
    if (cause?.code === 'ENOENT') return null;
    throw cause;
  }
  const info = await stat(path);
  if (link.isSymbolicLink() || !info.isFile() || (info.mode & 0o077) !== 0) {
    throw wrapperError(
      'Chatwoot safe-baseline selection handoff must be a private regular file',
      'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_INVALID',
    );
  }
  return validateChatwootSafeBaselineSelectionHint(
    await readJson(path),
    currentHead,
  );
}

function readCurrentChatwootWorker(env, sourceConfig) {
  const wranglerEnv = buildWranglerOAuthEnvironment(env);
  const status = parseChatwootWranglerJsonOutput(runText('npx', [
    'wrangler', 'deployments', 'status',
    '--name', WORKER_NAME,
    '--config', sourceConfig,
    '--json',
  ], wranglerEnv), 'Chatwoot Worker deployment status');
  const item = Array.isArray(status) ? status[0] : status;
  const active = (item?.versions ?? []).filter(
    (version) => Number(version?.percentage) === 100,
  );
  if (active.length !== 1) {
    throw wrapperError(
      'Chatwoot Worker does not have exactly one active version',
      'CHATWOOT_CONTROLLER_EVIDENCE_WORKER_STATE_INVALID',
      { activeVersionCount: active.length },
    );
  }
  const activeVersion = requireVersionId(
    active[0]?.version_id ?? active[0]?.id,
    'current active Worker version',
  );
  const view = parseChatwootWranglerJsonOutput(runText('npx', [
    'wrangler', 'versions', 'view', activeVersion,
    '--name', WORKER_NAME,
    '--config', sourceConfig,
    '--json',
  ], wranglerEnv), 'Chatwoot Worker version view');
  const enabledFlags = readChatwootExecutionFlags(view);
  const expected = [...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS].sort();
  if (JSON.stringify(enabledFlags) !== JSON.stringify(expected)) {
    throw wrapperError(
      'Current Worker is not the exact Chatwoot Final UAT active window',
      'CHATWOOT_CONTROLLER_EVIDENCE_WORKER_FLAGS_INVALID',
      { enabledFlags },
    );
  }
  return Object.freeze({ activeVersion, enabledFlags });
}

async function selectCurrentControllerEvidence({
  outputs,
  currentHead,
  currentActiveVersion,
  selectionHint,
}) {
  const root = join(outputs, FINAL_UAT_OUTPUT);
  const entries = await readdir(root, { withFileTypes: true });
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name.startsWith('.') || entry.name === currentHead) continue;
    const directory = join(root, entry.name);
    const required = [
      'session.json',
      'read-only-preflight.json',
      'active-deployment.json',
      'initial-send.attempt.json',
    ];
    if (!(await Promise.all(required.map((name) => isRegularFile(join(directory, name)))))
      .every(Boolean)) continue;
    if (await isRegularFile(join(directory, 'summary.json'))
        || await isRegularFile(join(directory, 'safe-restore.json'))) continue;

    const session = validateRetainedSession(await readJson(join(directory, 'session.json')));
    const attempt = await readJson(join(directory, 'initial-send.attempt.json'));
    if (attempt.operationId !== session.initial.operationId
        || attempt.workKey !== session.initial.workKey
        || attempt.generation !== session.initial.generation) continue;
    const preflight = unwrapEvidence(await readJson(join(directory, 'read-only-preflight.json')));
    const deployment = unwrapEvidence(await readJson(join(directory, 'active-deployment.json')));
    candidates.push({
      directory,
      directoryName: entry.name,
      session,
      sessionFingerprint: session.sessionFingerprint,
      baselineVersion: preflight.activeVersion,
      activeVersion: deployment.activeVersion,
      baseline: preflight.baseline,
      modifiedAt: (await stat(join(directory, 'initial-send.attempt.json'))).mtimeMs,
    });
  }
  return selectChatwootControllerEvidence(
    candidates,
    currentActiveVersion,
    selectionHint,
  );
}

async function prepareIsolatedEvidenceView({ assets, selection, wrapperHead }) {
  const temporaryRoot = await mkdtemp(join(tmpdir(), 'mkt-chatwoot-evidence-arbitration-'));
  const cloneRoot = join(temporaryRoot, 'repository');
  runGit(repositoryRoot, [
    'clone', '--no-hardlinks', '--no-checkout', repositoryRoot, cloneRoot,
  ]);
  runGit(cloneRoot, ['checkout', '-B', 'main', wrapperHead]);
  runGit(cloneRoot, ['update-ref', 'refs/remotes/origin/main', wrapperHead]);

  await copyPrivateFile(assets.devVars, join(cloneRoot, '.dev.vars'), '.dev.vars');
  await copyPrivateFile(assets.sourceConfig, join(cloneRoot, SOURCE_CONFIG), SOURCE_CONFIG);
  await symlink(assets.nodeModules, join(cloneRoot, 'node_modules'), 'dir');
  await prepareOutputsView({
    sourceOutputs: assets.outputs,
    cloneOutputs: join(cloneRoot, 'outputs'),
    selection,
    wrapperHead,
  });
  await writeCloneExcludes(cloneRoot);

  const head = gitText(cloneRoot, ['rev-parse', 'HEAD']);
  const originMain = gitText(cloneRoot, ['rev-parse', 'origin/main']);
  const branch = gitText(cloneRoot, ['branch', '--show-current']);
  const dirty = gitText(
    cloneRoot,
    ['status', '--porcelain', '--untracked-files=all'],
    false,
  );
  if (head !== wrapperHead || originMain !== wrapperHead
      || branch !== 'main' || dirty.trim() !== '') {
    throw wrapperError(
      'Prepared Chatwoot evidence arbitration clone is not exact and clean',
      'CHATWOOT_CONTROLLER_EVIDENCE_CLONE_INVALID',
      {
        head,
        originMain,
        branch,
        clean: dirty.trim() === '',
        dirtyPaths: dirty.split('\n').filter(Boolean),
      },
    );
  }
  return Object.freeze({ temporaryRoot, cloneRoot });
}

async function prepareOutputsView({
  sourceOutputs,
  cloneOutputs,
  selection,
  wrapperHead,
}) {
  await mkdir(cloneOutputs, { recursive: true, mode: 0o700 });
  const entries = await readdir(sourceOutputs, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === FINAL_UAT_OUTPUT) continue;
    const source = join(sourceOutputs, entry.name);
    const target = join(cloneOutputs, entry.name);
    await symlink(source, target, entry.isDirectory() ? 'dir' : 'file');
  }

  const sourceFinalRoot = join(sourceOutputs, FINAL_UAT_OUTPUT);
  const cloneFinalRoot = join(cloneOutputs, FINAL_UAT_OUTPUT);
  await mkdir(cloneFinalRoot, { recursive: true, mode: 0o700 });
  await materializeChatwootControllerEvidenceDirectory({
    sourceDirectory: selection.directory,
    destinationRoot: cloneFinalRoot,
    directoryName: selection.directoryName,
  });

  const currentEvidence = join(sourceFinalRoot, wrapperHead);
  const existing = await lstat(currentEvidence).catch(() => null);
  if (existing) {
    if (!existing.isDirectory()) {
      throw wrapperError(
        'Current-head Chatwoot evidence path is not a directory',
        'CHATWOOT_CONTROLLER_EVIDENCE_CURRENT_HEAD_INVALID',
      );
    }
    const currentEntries = await readdir(currentEvidence);
    if (currentEntries.length > 0) {
      throw wrapperError(
        'Current-head Chatwoot evidence already exists; blind rerun is blocked',
        'CHATWOOT_CONTROLLER_EVIDENCE_CURRENT_HEAD_PRESENT',
        { entryCount: currentEntries.length },
      );
    }
  } else {
    await mkdir(currentEvidence, { recursive: true, mode: 0o700 });
  }
  await symlink(currentEvidence, join(cloneFinalRoot, wrapperHead), 'dir');
}

async function writeCloneExcludes(cloneRoot) {
  const excludePath = join(cloneRoot, '.git', 'info', 'exclude');
  const expected = `${CLONE_EXCLUDES.join('\n')}\n`;
  await writeFile(excludePath, expected, { mode: 0o600 });
  await chmod(excludePath, 0o600);
  const [info, observed] = await Promise.all([
    stat(excludePath),
    readFile(excludePath, 'utf8'),
  ]);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || observed !== expected) {
    throw wrapperError(
      'Chatwoot arbitration clone exclude is not exact and private',
      'CHATWOOT_CONTROLLER_EVIDENCE_CLONE_EXCLUDE_INVALID',
    );
  }
}

async function copyPrivateFile(source, destination, field) {
  await copyFile(source, destination);
  await chmod(destination, 0o600);
  await assertPrivateRegularFile(destination, field);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (cause) {
    throw wrapperError(
      'Chatwoot controller evidence JSON is missing or invalid',
      'CHATWOOT_CONTROLLER_EVIDENCE_INVALID',
      { fileName: basename(path), errorCode: cause?.code ?? 'JSON_PARSE_FAILED' },
    );
  }
}

function unwrapEvidence(value) {
  return value?.data && typeof value.data === 'object' ? value.data : value;
}

async function assertDirectory(path, field) {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {
    // normalized below
  }
  throw wrapperError(
    `Required local ${field} directory is missing`,
    'CHATWOOT_CONTROLLER_EVIDENCE_LOCAL_ASSET_MISSING',
    { field },
  );
}

async function assertRegularFile(path, field) {
  try {
    const link = await lstat(path);
    const info = await stat(path);
    if (!link.isSymbolicLink() && info.isFile()) return;
  } catch {
    // normalized below
  }
  throw wrapperError(
    `Required local ${field} must be a regular file`,
    'CHATWOOT_CONTROLLER_EVIDENCE_LOCAL_FILE_INVALID',
    { field },
  );
}

async function assertPrivateRegularFile(path, field) {
  try {
    const link = await lstat(path);
    const info = await stat(path);
    if (!link.isSymbolicLink() && info.isFile() && (info.mode & 0o077) === 0) return;
  } catch {
    // normalized below
  }
  throw wrapperError(
    `Required local ${field} must be a private regular file`,
    'CHATWOOT_CONTROLLER_EVIDENCE_LOCAL_PRIVATE_FILE_INVALID',
    { field },
  );
}

async function isRegularFile(path) {
  try {
    return (await stat(path)).isFile();
  } catch (cause) {
    if (cause?.code === 'ENOENT') return false;
    throw cause;
  }
}

function requireSha(value, field) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw wrapperError(
      `${field} must be an exact 40-character Git SHA`,
      'CHATWOOT_CONTROLLER_EVIDENCE_HEAD_ENV_INVALID',
      { field },
    );
  }
  return text;
}

function requireVersionId(value, field) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!UUID.test(text)) {
    throw wrapperError(
      `${field} is invalid`,
      'CHATWOOT_CONTROLLER_EVIDENCE_WORKER_STATE_INVALID',
      { field },
    );
  }
  return text;
}

function runText(command, args, env = process.env) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw wrapperError(
      `Read-only command failed: ${command}`,
      'CHATWOOT_CONTROLLER_EVIDENCE_READ_COMMAND_FAILED',
      { command, exitCode: result.status ?? null },
    );
  }
  return String(result.stdout ?? '');
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw wrapperError(
      `Git command failed: git ${args.join(' ')}`,
      'CHATWOOT_CONTROLLER_EVIDENCE_GIT_COMMAND_FAILED',
      { exitCode: result.status ?? null, stderr: String(result.stderr ?? '').trim() },
    );
  }
}

function gitText(cwd, args, required = true) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0 && required) {
    throw wrapperError(
      `Git read failed: git ${args.join(' ')}`,
      'CHATWOOT_CONTROLLER_EVIDENCE_GIT_READ_FAILED',
      { exitCode: result.status ?? null, stderr: String(result.stderr ?? '').trim() },
    );
  }
  return String(result.stdout ?? '').trim();
}

function gitSuccess(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return !result.error && result.status === 0;
}

function scrub(value) {
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map(scrub);
  if (typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization|password|cookie|tableId|accountId|queueId|versionId/iu.test(key))
    .map(([key, nested]) => [key, scrub(nested)]));
}

function wrapperError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ChatwootControllerEvidenceArbitrationTerminalError';
  error.code = code;
  error.details = details;
  return error;
}
