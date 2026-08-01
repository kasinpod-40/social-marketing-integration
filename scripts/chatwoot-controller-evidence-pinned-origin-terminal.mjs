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

import { prepareExactPinnedGitOrigin } from './lib/exact-pinned-git-origin.js';

const WRAPPER_HEAD_ENV = 'MKT_CHATWOOT_PINNED_ORIGIN_WRAPPER_HEAD';
const INNER_WRAPPER_HEAD_ENV = 'MKT_CHATWOOT_EVIDENCE_ARBITRATION_WRAPPER_HEAD';
const CONFIRMATION_ENV = 'CONFIRM_CHATWOOT_INITIAL_FAILURE_RECOVERY';
const CONFIRMATION_VALUE = 'RECOVER_EXACT_CHATWOOT_INITIAL_TO_LARK_PARITY';
const INNER_WRAPPER = 'scripts/chatwoot-controller-evidence-arbitration-terminal.mjs';
const SOURCE_CONFIG = 'wrangler.sync.jsonc';
const EXCLUDES = Object.freeze([
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
    stage = 'confirm-chatwoot-pinned-origin';
    assertConfirmation(process.env);

    stage = 'verify-chatwoot-pinned-origin-wrapper';
    const repository = verifyWrapperCheckout(process.env);

    stage = 'verify-chatwoot-pinned-origin-assets';
    const assets = await verifyLocalAssets();

    stage = 'prepare-chatwoot-pinned-origin';
    temporaryRoot = await mkdtemp(join(tmpdir(), 'mkt-chatwoot-pinned-origin-'));
    const pinned = prepareExactPinnedGitOrigin({
      sourceRepository: repositoryRoot,
      temporaryRoot,
      head: repository.currentHead,
    });
    await injectLocalAssets(pinned.cloneRoot, assets);
    await verifyPreparedClone(pinned.cloneRoot, repository.currentHead);

    stage = 'run-chatwoot-evidence-arbitration';
    childStarted = true;
    const child = spawnSync(
      process.execPath,
      [join(pinned.cloneRoot, INNER_WRAPPER), '--execute'],
      {
        cwd: pinned.cloneRoot,
        env: {
          ...process.env,
          [INNER_WRAPPER_HEAD_ENV]: repository.currentHead,
          DEV_VARS_FILE: join(pinned.cloneRoot, '.dev.vars'),
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
        marker: 'CHATWOOT_PINNED_ORIGIN_WRAPPER_COMPLETED_SAFE',
        wrapperHead: repository.currentHead,
        innerWrapper: INNER_WRAPPER,
        innerOriginPinned: true,
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
    code: error?.code ?? 'CHATWOOT_PINNED_ORIGIN_WRAPPER_FAILED',
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
      'Chatwoot pinned-origin wrapper accepts only --execute',
      'CHATWOOT_PINNED_ORIGIN_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: 'chatwoot_controller_evidence_pinned_origin_v1',
    wrapperHeadEnv: WRAPPER_HEAD_ENV,
    confirmation: `${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
    innerWrapper: INNER_WRAPPER,
    innerOrigin: 'temporary_bare_main_pinned_to_wrapper_head',
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
      `Chatwoot pinned-origin wrapper requires ${CONFIRMATION_ENV}=${CONFIRMATION_VALUE}`,
      'CHATWOOT_PINNED_ORIGIN_CONFIRMATION_REQUIRED',
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
      'Chatwoot pinned-origin wrapper requires the exact clean reviewed commit',
      'CHATWOOT_PINNED_ORIGIN_CHECKOUT_INVALID',
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
      'Reviewed Chatwoot pinned-origin wrapper is not contained in current origin/main history',
      'CHATWOOT_PINNED_ORIGIN_ANCESTRY_INVALID',
      { currentHead, originMain },
    );
  }
  const conflicts = Object.keys(env).filter(
    (key) => /^GIT_CONFIG_(?:COUNT|KEY_\d+|VALUE_\d+)$/u.test(key),
  );
  if (conflicts.length > 0) {
    throw wrapperError(
      'Chatwoot pinned-origin wrapper refuses caller-provided Git config overrides',
      'CHATWOOT_PINNED_ORIGIN_GIT_CONFIG_ENV_INVALID',
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
  return Object.freeze({ outputs, devVars, nodeModules, sourceConfig });
}

async function injectLocalAssets(cloneRoot, assets) {
  await copyPrivateFile(assets.devVars, join(cloneRoot, '.dev.vars'), '.dev.vars');
  await copyPrivateFile(
    assets.sourceConfig,
    join(cloneRoot, SOURCE_CONFIG),
    SOURCE_CONFIG,
  );
  await symlink(assets.outputs, join(cloneRoot, 'outputs'), 'dir');
  await symlink(assets.nodeModules, join(cloneRoot, 'node_modules'), 'dir');
  await writeExactExcludes(cloneRoot);
}

async function writeExactExcludes(cloneRoot) {
  const excludePath = join(cloneRoot, '.git', 'info', 'exclude');
  const existing = await lstat(excludePath).catch(() => null);
  if (existing?.isSymbolicLink()) {
    throw wrapperError(
      'Pinned-origin clone exclude path must not be a symlink',
      'CHATWOOT_PINNED_ORIGIN_EXCLUDE_INVALID',
    );
  }
  const expected = `${EXCLUDES.join('\n')}\n`;
  await writeFile(excludePath, expected, { mode: 0o600 });
  await chmod(excludePath, 0o600);
  const [info, observed] = await Promise.all([
    stat(excludePath),
    readFile(excludePath, 'utf8'),
  ]);
  if (!info.isFile() || (info.mode & 0o077) !== 0 || observed !== expected) {
    throw wrapperError(
      'Pinned-origin clone exclude is not exact and private',
      'CHATWOOT_PINNED_ORIGIN_EXCLUDE_INVALID',
    );
  }
}

async function verifyPreparedClone(cloneRoot, expectedHead) {
  const fetch = spawnSync('git', ['fetch', 'origin', 'main', '--quiet'], {
    cwd: cloneRoot,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (fetch.error || fetch.status !== 0) {
    throw wrapperError(
      'Pinned-origin clone could not fetch its exact synthetic main',
      'CHATWOOT_PINNED_ORIGIN_FETCH_INVALID',
      {
        exitCode: fetch.status ?? null,
        spawnErrorCode: fetch.error?.code ?? null,
      },
    );
  }
  const observed = {
    head: gitText(cloneRoot, ['rev-parse', 'HEAD']),
    originMain: gitText(cloneRoot, ['rev-parse', 'origin/main']),
    branch: gitText(cloneRoot, ['branch', '--show-current']),
    dirty: gitText(
      cloneRoot,
      ['status', '--porcelain', '--untracked-files=all'],
      false,
    ),
  };
  if (observed.head !== expectedHead
      || observed.originMain !== expectedHead
      || observed.branch !== 'main'
      || observed.dirty.trim() !== '') {
    throw wrapperError(
      'Prepared Chatwoot pinned-origin clone is not exact and clean after fetch',
      'CHATWOOT_PINNED_ORIGIN_CLONE_INVALID',
      {
        head: observed.head,
        originMain: observed.originMain,
        branch: observed.branch,
        clean: observed.dirty.trim() === '',
        dirtyPaths: observed.dirty.split('\n').filter(Boolean),
      },
    );
  }
}

async function copyPrivateFile(source, destination, field) {
  await copyFile(source, destination);
  await chmod(destination, 0o600);
  await assertPrivateRegularFile(destination, field);
}

async function assertDirectory(path, field) {
  try {
    if ((await stat(path)).isDirectory()) return;
  } catch {
    // normalized below
  }
  throw wrapperError(
    `Required local ${field} directory is missing`,
    'CHATWOOT_PINNED_ORIGIN_LOCAL_ASSET_MISSING',
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
    'CHATWOOT_PINNED_ORIGIN_LOCAL_FILE_INVALID',
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
    'CHATWOOT_PINNED_ORIGIN_LOCAL_PRIVATE_FILE_INVALID',
    { field },
  );
}

function requireSha(value, field) {
  const text = String(value ?? '').trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(text)) {
    throw wrapperError(
      `${field} must be an exact 40-character Git SHA`,
      'CHATWOOT_PINNED_ORIGIN_HEAD_ENV_INVALID',
      { field },
    );
  }
  return text;
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
      'CHATWOOT_PINNED_ORIGIN_GIT_READ_FAILED',
      {
        exitCode: result.status ?? null,
        stderr: String(result.stderr ?? '').trim(),
      },
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
  error.name = 'ChatwootPinnedOriginWrapperError';
  error.code = code;
  error.details = details;
  return error;
}
