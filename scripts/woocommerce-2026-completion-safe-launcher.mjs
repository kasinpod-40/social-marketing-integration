#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve } from 'node:path';
import { secureLocalSecretFile } from './lib/local-secret-file-policy.js';
import {
  buildReportRuntimeSealedChildEnvironment,
  buildReportRuntimeSealedCloneArgs,
  sanitizeReportRuntimeGitEnvironment,
} from './lib/report-runtime-sealed-execution.js';
import {
  WOOCOMMERCE_2026_COMPLETION_CONFIRMATION,
  WOOCOMMERCE_2026_COMPLETION_SEALED_HEAD,
  WOOCOMMERCE_2026_COMPLETION_SEALED_MARKER,
  WOOCOMMERCE_2026_COMPLETION_SEALED_VALUE,
  WOOCOMMERCE_2026_HISTORY_START,
  assertWooCommerce2026CompletionConfirmation,
  requireWooCommerce2026CompletionHead,
} from './lib/woocommerce-2026-completion-one-command.js';

const repositoryRoot = resolve(process.cwd());
const PRIVATE_CONFIG_NAME = '.mkt-woocommerce-2026-completion-wrangler.jsonc';
const LEGACY_CONFIG_NAME = 'wrangler.sync.jsonc';

try {
  const args = process.argv.slice(2);
  if (args.some((arg) => arg !== '--execute')) throw failure(
    `Unsupported WooCommerce completion launcher argument: ${args.join(', ')}`,
    'WOOCOMMERCE_2026_COMPLETION_LAUNCHER_ARGUMENT_INVALID',
  );
  if (!args.includes('--execute')) printPlan();
  else await execute();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: error?.stage ?? null,
    code: error?.code ?? 'WOOCOMMERCE_2026_COMPLETION_LAUNCHER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    remoteActionStarted: error?.remoteActionStarted === true,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    command: `CONFIRM_WOOCOMMERCE_2026_COMPLETION=${WOOCOMMERCE_2026_COMPLETION_CONFIRMATION} node scripts/woocommerce-2026-completion-safe-launcher.mjs --execute`,
    stages: [
      'secure-source-dev-vars',
      'pin-current-origin-main',
      'create-independent-sealed-clone',
      'pin-local-origin-main',
      'copy-dev-vars-as-private-ignored-file',
      'copy-wrangler-config-as-modern-private-ignored-file',
      'copy-wrangler-config-as-legacy-private-ignored-file',
      'verify-clean-exact-sealed-clone',
      'delegate-to-reviewed-completion-child',
      'destroy-sealed-clone',
    ],
    safety: {
      trackedWranglerConfigOverwritten: false,
      privateConfigName: PRIVATE_CONFIG_NAME,
      legacyConfigName: LEGACY_CONFIG_NAME,
      legacyConfigCompatibilitySnapshot: true,
      privateFilesMode: '0600',
      canonicalMacOsPathIdentity: true,
      inheritedGitContextRemoved: true,
      mutableSourceCheckoutUsedForExecution: false,
      exactOriginMainPinnedOnce: true,
      production: false,
    },
  }, null, 2)}\n`);
}

async function execute() {
  assertWooCommerce2026CompletionConfirmation(process.env);
  const gitEnv = sanitizeReportRuntimeGitEnvironment(process.env);
  const devVars = await secureDevVars();
  const sourceConfigPath = resolve(
    repositoryRoot,
    process.env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? LEGACY_CONFIG_NAME,
  );
  await assertRegularFile(sourceConfigPath, LEGACY_CONFIG_NAME);

  runGit(['fetch', 'origin', 'main', '--quiet'], { env: gitEnv });
  const originUrl = runGitText(['remote', 'get-url', 'origin'], { env: gitEnv });
  const pinnedHead = requireWooCommerce2026CompletionHead(
    runGitText(['rev-parse', 'origin/main'], { env: gitEnv }),
  );

  const baseEvidenceRoot = resolve(
    process.env.MKT_WOOCOMMERCE_2026_COMPLETION_EVIDENCE_DIR
      ?? join(repositoryRoot, 'outputs', 'woocommerce-2026-completion'),
  );
  const evidenceRoot = join(baseEvidenceRoot, pinnedHead);
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });

  const sandboxRoot = await mkdtemp(
    join(tmpdir(), 'mkt-woocommerce-2026-completion-safe-'),
  );
  const cloneRoot = join(sandboxRoot, 'repository');

  try {
    runCommand('git', buildReportRuntimeSealedCloneArgs(originUrl, cloneRoot), {
      cwd: repositoryRoot,
      env: gitEnv,
      stage: 'create-sealed-clone',
      code: 'WOOCOMMERCE_2026_COMPLETION_SEALED_CLONE_FAILED',
    });
    runGit(['checkout', '--force', '-B', 'main', pinnedHead], {
      cwd: cloneRoot,
      env: gitEnv,
    });
    runGit(['remote', 'set-url', 'origin', '.'], {
      cwd: cloneRoot,
      env: gitEnv,
    });
    runGit(['fetch', 'origin', 'main', '--quiet'], {
      cwd: cloneRoot,
      env: gitEnv,
    });
    assertExactClone(cloneRoot, pinnedHead, gitEnv);

    const sealedDevVars = join(cloneRoot, '.dev.vars');
    const sealedConfig = join(cloneRoot, PRIVATE_CONFIG_NAME);
    const sealedLegacyConfig = join(cloneRoot, LEGACY_CONFIG_NAME);
    await assertPathMissing(sealedLegacyConfig, LEGACY_CONFIG_NAME);
    await ensureLocalExclude(cloneRoot, [
      '/.dev.vars',
      `/${PRIVATE_CONFIG_NAME}`,
      `/${LEGACY_CONFIG_NAME}`,
    ], gitEnv);
    await snapshotPrivateFile(devVars.resolvedPath, sealedDevVars, '.dev.vars');
    await snapshotPrivateFile(
      sourceConfigPath,
      sealedConfig,
      'private Wrangler config',
    );
    await snapshotPrivateFile(
      sealedConfig,
      sealedLegacyConfig,
      'legacy Wrangler compatibility config',
    );
    assertExactClone(cloneRoot, pinnedHead, gitEnv);

    const sharedSealedEnv = buildReportRuntimeSealedChildEnvironment(
      process.env,
      {
        root: cloneRoot,
        head: pinnedHead,
        evidenceDir: evidenceRoot,
        devVarsFile: sealedDevVars,
        wranglerConfigFile: sealedConfig,
      },
    );
    const childEnv = sanitizeReportRuntimeGitEnvironment({
      ...sharedSealedEnv,
      CONFIRM_WOOCOMMERCE_2026_COMPLETION:
        WOOCOMMERCE_2026_COMPLETION_CONFIRMATION,
      [WOOCOMMERCE_2026_COMPLETION_SEALED_MARKER]:
        WOOCOMMERCE_2026_COMPLETION_SEALED_VALUE,
      [WOOCOMMERCE_2026_COMPLETION_SEALED_HEAD]: pinnedHead,
      DEV_VARS_FILE: sealedDevVars,
      MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: sealedConfig,
      MKT_WOOCOMMERCE_2026_COMPLETION_EVIDENCE_DIR: evidenceRoot,
      MKT_WOOCOMMERCE_2026_CLEANUP_EVIDENCE_DIR:
        join(evidenceRoot, 'cleanup'),
      MKT_WOOCOMMERCE_FINAL_EVIDENCE_DIR:
        join(evidenceRoot, 'final'),
      MKT_WOOCOMMERCE_ORDER_HISTORY_START:
        WOOCOMMERCE_2026_HISTORY_START,
    });
    delete childEnv.MKT_WOOCOMMERCE_FINAL_RESUME_OPERATION_ID;

    const child = spawnSync(
      process.execPath,
      ['scripts/woocommerce-2026-completion-one-command.mjs', '--execute'],
      {
        cwd: cloneRoot,
        env: childEnv,
        stdio: 'inherit',
      },
    );
    if (child.error || child.status !== 0) {
      const error = failure(
        'Sealed WooCommerce 2026 completion child failed',
        'WOOCOMMERCE_2026_COMPLETION_CHILD_FAILED',
        { exitCode: child.status ?? 1 },
      );
      error.stage = 'sealed-completion-child';
      error.remoteActionStarted = true;
      throw error;
    }
  } finally {
    await rm(sandboxRoot, { recursive: true, force: true });
  }
}

async function secureDevVars() {
  const requested = resolve(
    process.env.DEV_VARS_FILE ?? join(repositoryRoot, '.dev.vars'),
  );
  try {
    const inspected = await secureLocalSecretFile(requested, {
      expectedBasename: basename(requested),
    });
    if (!inspected.exists || !inspected.resolvedPath) throw failure(
      'Required local .dev.vars file is missing',
      'WOOCOMMERCE_2026_COMPLETION_DEV_VARS_INVALID',
    );
    return inspected;
  } catch (error) {
    if (error?.name === 'WooCommerce2026CompletionLauncherError') throw error;
    throw failure(
      error instanceof Error ? error.message : 'Unable to secure local .dev.vars',
      'WOOCOMMERCE_2026_COMPLETION_DEV_VARS_INVALID',
    );
  }
}

async function assertRegularFile(path, label) {
  let inspected;
  try {
    inspected = await stat(path);
  } catch {
    throw failure(
      `Required ${label} cannot be read`,
      'WOOCOMMERCE_2026_COMPLETION_LOCAL_INPUT_INVALID',
      { label },
    );
  }
  if (!inspected.isFile()) throw failure(
    `Required ${label} must be a regular file`,
    'WOOCOMMERCE_2026_COMPLETION_LOCAL_INPUT_INVALID',
    { label },
  );
}

async function assertPathMissing(path, label) {
  try {
    await stat(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return;
    throw error;
  }
  throw failure(
    `Sealed clone already contains ${label}`,
    'WOOCOMMERCE_2026_COMPLETION_LEGACY_CONFIG_COLLISION',
    { label },
  );
}

async function snapshotPrivateFile(sourcePath, destinationPath, label) {
  let before;
  try {
    before = await stat(sourcePath, { bigint: true });
  } catch {
    throw failure(
      `Required ${label} cannot be read`,
      'WOOCOMMERCE_2026_COMPLETION_LOCAL_INPUT_INVALID',
      { label },
    );
  }
  if (!before.isFile()) throw failure(
    `Required ${label} must be a regular file`,
    'WOOCOMMERCE_2026_COMPLETION_LOCAL_INPUT_INVALID',
    { label },
  );
  const bytes = await readFile(sourcePath);
  const after = await stat(sourcePath, { bigint: true });
  if (before.dev !== after.dev
    || before.ino !== after.ino
    || before.size !== after.size
    || before.mtimeNs !== after.mtimeNs
    || before.ctimeNs !== after.ctimeNs) {
    throw failure(
      `Required ${label} changed while the private snapshot was created`,
      'WOOCOMMERCE_2026_COMPLETION_LOCAL_INPUT_CHANGED',
      { label },
    );
  }
  await writeFile(destinationPath, bytes, { mode: 0o600, flag: 'wx' });
  await chmod(destinationPath, 0o600);
}

async function ensureLocalExclude(root, patterns, env) {
  const gitPath = runGitText(['rev-parse', '--git-path', 'info/exclude'], {
    cwd: root,
    env,
  });
  const excludePath = isAbsolute(gitPath) ? gitPath : resolve(root, gitPath);
  let existing = '';
  try {
    existing = await readFile(excludePath, 'utf8');
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const lines = new Set(existing.split(/\r?\n/u).filter(Boolean));
  let changed = false;
  for (const pattern of patterns) {
    if (!lines.has(pattern)) {
      lines.add(pattern);
      changed = true;
    }
  }
  if (!changed) return;
  await mkdir(dirname(excludePath), { recursive: true });
  await writeFile(excludePath, `${[...lines].join('\n')}\n`, 'utf8');
}

function assertExactClone(root, expectedHead, env) {
  const branch = runGitText(['branch', '--show-current'], { cwd: root, env });
  const head = runGitText(['rev-parse', 'HEAD'], { cwd: root, env });
  const originMain = runGitText(['rev-parse', 'origin/main'], { cwd: root, env });
  const dirty = runGitText(
    ['status', '--porcelain', '--untracked-files=all'],
    { cwd: root, env, trim: false },
  );
  if (branch !== 'main'
    || head !== expectedHead
    || originMain !== expectedHead
    || dirty.trim() !== '') {
    throw failure(
      'Safe launcher sealed clone is not exact and clean',
      'WOOCOMMERCE_2026_COMPLETION_SEALED_CLONE_INVALID',
      {
        branch,
        head,
        originMain,
        expectedHead,
        clean: dirty.trim() === '',
      },
    );
  }
}

function runGit(args, options = {}) {
  return runCommand('git', args, {
    ...options,
    env: sanitizeReportRuntimeGitEnvironment(options.env ?? process.env),
    code: 'WOOCOMMERCE_2026_COMPLETION_GIT_FAILED',
  });
}

function runGitText(args, options = {}) {
  const text = String(runGit(args, options).stdout ?? '');
  return options.trim === false ? text : text.trim();
}

function runCommand(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? repositoryRoot,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: 'pipe',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    const error = failure(
      `Command failed in WooCommerce completion launcher: ${command}`,
      options.code ?? 'WOOCOMMERCE_2026_COMPLETION_LAUNCHER_COMMAND_FAILED',
      {
        exitCode: result.status ?? 1,
        stdoutLength: String(result.stdout ?? '').length,
        stderrLength: String(result.stderr ?? '').length,
      },
    );
    error.stage = options.stage ?? 'launcher-command';
    throw error;
  }
  return result;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/(?:token|secret|authorization|cookie|password|accountId|queueId|tableId|fieldId|recordId|originUrl|path)$/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}

function failure(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerce2026CompletionLauncherError';
  error.code = code;
  error.details = details;
  return error;
}
