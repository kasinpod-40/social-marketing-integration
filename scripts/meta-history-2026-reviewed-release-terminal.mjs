#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  lstat,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const REVIEWED_RELEASE_HEAD = '29de2303fa311c4a13fac4725699416cfdc04386';
const WRAPPER_HEAD_ENV = 'MKT_META_HISTORY_REVIEW_WRAPPER_HEAD';
const CONFIRMATION_ENV = 'CONFIRM_META_HISTORY_EXACT_CONTINUATION';
const CONFIRMATION_VALUE = 'CONTINUE_META_HISTORY_FROM_FACEBOOK_LARK_BOUNDARY';
const EXACT_TERMINAL = 'scripts/meta-history-2026-exact-plan-continuation-terminal.mjs';
const REVIEWED_CLONE_EXCLUDE_PATTERNS = Object.freeze([
  '/outputs',
  '/.dev.vars',
  '/node_modules',
]);

const repositoryRoot = resolve(process.cwd());
let stage = 'init';
let releaseCloneRoot = null;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
  } else {
    stage = 'confirm-reviewed-release-continuation';
    assertConfirmation(process.env);

    stage = 'verify-reviewed-wrapper-checkout';
    const wrapper = verifyReviewedWrapperCheckout(process.env);

    stage = 'verify-reviewed-release-assets';
    const assets = await verifyLocalAssets();

    stage = 'prepare-reviewed-release-clone';
    releaseCloneRoot = await prepareReviewedReleaseClone(assets);

    stage = 'run-reviewed-release-continuation';
    const child = spawnSync(
      process.execPath,
      [join(releaseCloneRoot, EXACT_TERMINAL), '--execute'],
      {
        cwd: releaseCloneRoot,
        env: {
          ...process.env,
          DEV_VARS_FILE: join(releaseCloneRoot, '.dev.vars'),
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
        decision: 'META_HISTORY_2026_REVIEWED_RELEASE_WRAPPER_COMPLETED',
        wrapperHead: wrapper.currentHead,
        reviewedReleaseHead: REVIEWED_RELEASE_HEAD,
        scheduleEnabled: false,
        production: 'BLOCKED',
      }, null, 2)}\n`);
    }
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'META_HISTORY_REVIEWED_RELEASE_WRAPPER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    remoteProviderRequestCount: 0,
    remoteQueueSendCount: 0,
    remoteD1MutationCount: 0,
    remoteLarkMutationCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (releaseCloneRoot) {
    await rm(releaseCloneRoot, { recursive: true, force: true }).catch(() => {});
  }
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw wrapperError(
      'Reviewed release wrapper accepts only --execute',
      'META_HISTORY_REVIEWED_RELEASE_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: 'meta_history_reviewed_release_wrapper_v1',
    reviewedReleaseHead: REVIEWED_RELEASE_HEAD,
    wrapperHeadEnv: WRAPPER_HEAD_ENV,
    confirmation: `${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
    child: EXACT_TERMINAL,
    providerReplayAllowed: false,
    facebookD1QueueResendAllowed: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

function assertConfirmation(env) {
  if (env[CONFIRMATION_ENV] !== CONFIRMATION_VALUE) {
    throw wrapperError(
      `Reviewed release continuation requires ${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      'META_HISTORY_REVIEWED_RELEASE_CONFIRMATION_REQUIRED',
      { envName: CONFIRMATION_ENV },
    );
  }
}

function verifyReviewedWrapperCheckout(env) {
  const expectedWrapperHead = requireSha(env[WRAPPER_HEAD_ENV], WRAPPER_HEAD_ENV);
  const currentHead = gitText(repositoryRoot, ['rev-parse', 'HEAD']);
  const originMain = gitText(repositoryRoot, ['rev-parse', 'origin/main']);
  const branch = gitText(repositoryRoot, ['branch', '--show-current'], false);
  const dirty = gitText(
    repositoryRoot,
    ['status', '--porcelain', '--untracked-files=all'],
    false,
  );

  if (currentHead !== expectedWrapperHead || dirty.trim() !== '') {
    throw wrapperError(
      'Reviewed release wrapper requires the exact clean reviewed wrapper commit',
      'META_HISTORY_REVIEWED_RELEASE_WRAPPER_CHECKOUT_INVALID',
      {
        expectedWrapperHead,
        currentHead,
        originMain,
        branch: branch || '(detached)',
        clean: dirty.trim() === '',
      },
    );
  }

  if (!gitSuccess(repositoryRoot, [
    'merge-base', '--is-ancestor', currentHead, originMain,
  ])) {
    throw wrapperError(
      'Reviewed wrapper commit is not contained in current origin/main history',
      'META_HISTORY_REVIEWED_RELEASE_WRAPPER_ANCESTRY_INVALID',
      { currentHead, originMain },
    );
  }

  if (!gitSuccess(repositoryRoot, [
    'merge-base', '--is-ancestor', REVIEWED_RELEASE_HEAD, originMain,
  ])) {
    throw wrapperError(
      'The reviewed Meta release commit is no longer contained in origin/main history',
      'META_HISTORY_REVIEWED_RELEASE_ANCESTRY_INVALID',
      { reviewedReleaseHead: REVIEWED_RELEASE_HEAD, originMain },
    );
  }

  const conflicts = Object.keys(env).filter(
    (key) => /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key),
  );
  if (conflicts.length > 0) {
    throw wrapperError(
      'Reviewed release wrapper refuses caller-provided Git config overrides',
      'META_HISTORY_REVIEWED_RELEASE_GIT_CONFIG_ENV_INVALID',
      { conflicts: conflicts.sort() },
    );
  }

  return Object.freeze({ currentHead, originMain, branch: branch || '(detached)' });
}

async function verifyLocalAssets() {
  const outputs = join(repositoryRoot, 'outputs');
  const devVars = join(repositoryRoot, '.dev.vars');
  const nodeModules = join(repositoryRoot, 'node_modules');

  await assertDirectory(outputs, 'outputs');
  await assertPrivateRegularFile(devVars, '.dev.vars');
  await assertDirectory(nodeModules, 'node_modules');

  return Object.freeze({ outputs, devVars, nodeModules });
}

async function prepareReviewedReleaseClone(assets) {
  const root = await mkdtemp(join(tmpdir(), 'mkt-meta-reviewed-release-'));
  runGit(repositoryRoot, [
    'clone', '--no-hardlinks', '--no-checkout', repositoryRoot, root,
  ]);
  runGit(root, ['checkout', '-B', 'main', REVIEWED_RELEASE_HEAD]);
  runGit(root, ['update-ref', 'refs/remotes/origin/main', REVIEWED_RELEASE_HEAD]);

  await symlink(assets.outputs, join(root, 'outputs'), 'dir');
  await copyPrivateDevVars(assets.devVars, join(root, '.dev.vars'));
  await symlink(assets.nodeModules, join(root, 'node_modules'), 'dir');
  await ensureReviewedCloneExclude(root);

  const head = gitText(root, ['rev-parse', 'HEAD']);
  const originMain = gitText(root, ['rev-parse', 'origin/main']);
  const branch = gitText(root, ['branch', '--show-current']);
  const dirty = gitText(root, ['status', '--porcelain', '--untracked-files=all'], false);
  if (
    head !== REVIEWED_RELEASE_HEAD
    || originMain !== REVIEWED_RELEASE_HEAD
    || branch !== 'main'
    || dirty.trim() !== ''
  ) {
    throw wrapperError(
      'Prepared reviewed release clone is not exact and clean',
      'META_HISTORY_REVIEWED_RELEASE_CLONE_INVALID',
      {
        head,
        originMain,
        branch,
        clean: dirty.trim() === '',
        dirtyPaths: dirty.split('\n').filter(Boolean),
      },
    );
  }

  return root;
}

async function copyPrivateDevVars(source, destination) {
  await copyFile(source, destination);
  await chmod(destination, 0o600);
  await assertPrivateRegularFile(destination, 'reviewed clone .dev.vars');
}

async function ensureReviewedCloneExclude(root) {
  const excludePath = join(root, '.git', 'info', 'exclude');
  const existing = await lstat(excludePath).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw wrapperError(
      'Reviewed clone Git exclude path must not be a symlink',
      'META_HISTORY_REVIEWED_RELEASE_CLONE_EXCLUDE_INVALID',
    );
  }

  const expected = `${REVIEWED_CLONE_EXCLUDE_PATTERNS.join('\n')}\n`;
  await writeFile(excludePath, expected, { mode: 0o600 });
  await chmod(excludePath, 0o600);

  const [info, observed] = await Promise.all([
    stat(excludePath),
    readFile(excludePath, 'utf8'),
  ]);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || observed !== expected) {
    throw wrapperError(
      'Reviewed clone Git exclude is not exact and private',
      'META_HISTORY_REVIEWED_RELEASE_CLONE_EXCLUDE_INVALID',
    );
  }
}

async function assertDirectory(path, field) {
  try {
    const info = await stat(path);
    if (info.isDirectory()) return;
  } catch {
    // normalized below
  }
  throw wrapperError(
    `Required local ${field} directory is missing`,
    'META_HISTORY_REVIEWED_RELEASE_LOCAL_ASSET_MISSING',
    { field },
  );
}

async function assertPrivateRegularFile(path, field) {
  try {
    const linkInfo = await lstat(path);
    const info = await stat(path);
    if (!linkInfo.isSymbolicLink() && info.isFile() && (info.mode & 0o077) === 0) return;
  } catch {
    // normalized below
  }
  throw wrapperError(
    `Required local ${field} must be a private regular file`,
    'META_HISTORY_REVIEWED_RELEASE_LOCAL_PRIVATE_FILE_INVALID',
    { field },
  );
}

function requireSha(value, field) {
  const normalized = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(normalized)) {
    throw wrapperError(
      `${field} must be an exact 40-character Git SHA`,
      'META_HISTORY_REVIEWED_RELEASE_HEAD_ENV_INVALID',
      { field },
    );
  }
  return normalized;
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
      'META_HISTORY_REVIEWED_RELEASE_GIT_COMMAND_FAILED',
      { status: result.status, stderr: String(result.stderr ?? '').trim() },
    );
  }
  return String(result.stdout ?? '').trim();
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
      'META_HISTORY_REVIEWED_RELEASE_GIT_READ_FAILED',
      { status: result.status, stderr: String(result.stderr ?? '').trim() },
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
  if (result.error) throw result.error;
  return result.status === 0;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, sanitize(item)]),
  );
}

function wrapperError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaHistoryReviewedReleaseWrapperError';
  error.code = code;
  error.details = details;
  return error;
}
