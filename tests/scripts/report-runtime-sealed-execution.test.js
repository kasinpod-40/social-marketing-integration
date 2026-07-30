import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  REPORT_RUNTIME_SEALED_HEAD,
  REPORT_RUNTIME_SEALED_MARKER,
  REPORT_RUNTIME_SEALED_ROOT,
  buildReportRuntimeSealedChildEnvironment,
  buildReportRuntimeSealedCloneArgs,
  readReportRuntimeSealedContext,
  sanitizeReportRuntimeGitEnvironment,
} from '../../scripts/lib/report-runtime-sealed-execution.js';

const HEAD = '89f581c5c4a4b54b53ab68572918039e17cf6d26';

test('sealed Report runtime environment removes inherited Git checkout context', () => {
  const clean = sanitizeReportRuntimeGitEnvironment({
    GIT_DIR: '/wrong/.git',
    GIT_WORK_TREE: '/wrong/tree',
    GIT_INDEX_FILE: '/wrong/index',
    GIT_COMMON_DIR: '/wrong/common',
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: 'core.worktree',
    GIT_CONFIG_VALUE_0: '/wrong/tree',
    CLOUDFLARE_ACCOUNT_ID: 'kept',
  });
  assert.equal(clean.GIT_DIR, undefined);
  assert.equal(clean.GIT_WORK_TREE, undefined);
  assert.equal(clean.GIT_INDEX_FILE, undefined);
  assert.equal(clean.GIT_COMMON_DIR, undefined);
  assert.equal(clean.GIT_CONFIG_COUNT, undefined);
  assert.equal(clean.GIT_CONFIG_KEY_0, undefined);
  assert.equal(clean.GIT_CONFIG_VALUE_0, undefined);
  assert.equal(clean.CLOUDFLARE_ACCOUNT_ID, 'kept');
});

test('sealed child environment pins root, HEAD and private runtime inputs', () => {
  const root = resolve('tmp/sealed-report-runtime');
  const env = buildReportRuntimeSealedChildEnvironment({ GIT_DIR: '/wrong/.git' }, {
    root,
    head: HEAD,
    evidenceDir: resolve('outputs/report-runtime-window-repair'),
    devVarsFile: resolve(root, '.dev.vars'),
    wranglerConfigFile: resolve(root, 'wrangler.sync.jsonc'),
  });
  assert.equal(env[REPORT_RUNTIME_SEALED_MARKER], '1');
  assert.equal(env[REPORT_RUNTIME_SEALED_ROOT], root);
  assert.equal(env[REPORT_RUNTIME_SEALED_HEAD], HEAD);
  assert.equal(env.GIT_DIR, undefined);
  assert.equal(env.DEV_VARS_FILE, resolve(root, '.dev.vars'));
  assert.equal(env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG, resolve(root, 'wrangler.sync.jsonc'));
  assert.deepEqual(readReportRuntimeSealedContext(env, root), {
    sealed: true,
    root,
    expectedHead: HEAD,
  });
});

test('sealed context rejects another checkout or malformed pinned SHA', () => {
  const root = resolve('tmp/sealed-report-runtime');
  assert.throws(() => readReportRuntimeSealedContext({
    [REPORT_RUNTIME_SEALED_MARKER]: '1',
    [REPORT_RUNTIME_SEALED_ROOT]: root,
    [REPORT_RUNTIME_SEALED_HEAD]: HEAD,
  }, resolve('tmp/another-checkout')), (error) => error.code === 'REPORT_RUNTIME_SEALED_ROOT_MISMATCH');
  assert.throws(() => readReportRuntimeSealedContext({
    [REPORT_RUNTIME_SEALED_MARKER]: '1',
    [REPORT_RUNTIME_SEALED_ROOT]: root,
    [REPORT_RUNTIME_SEALED_HEAD]: 'short',
  }, root), (error) => error.code === 'REPORT_RUNTIME_SEALED_HEAD_INVALID');
});

test('sealed clone command uses main without a shared worktree', () => {
  const destination = resolve('tmp/report-runtime-clone');
  assert.deepEqual(buildReportRuntimeSealedCloneArgs('git@github.com:example/repo.git', destination), [
    'clone',
    '--no-local',
    '--single-branch',
    '--branch',
    'main',
    '--',
    'git@github.com:example/repo.git',
    destination,
  ]);
});

test('sealed clone remains pinned after the source checkout and source main both move', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'report-runtime-sealed-git-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, 'source');
  const sealed = join(root, 'sealed');
  const updater = join(root, 'updater');

  git(['init', '--initial-branch=main', source], root);
  configureIdentity(source);
  await writeFile(join(source, 'state.txt'), 'pinned\n');
  git(['add', 'state.txt'], source);
  git(['commit', '-m', 'pinned'], source);
  const pinnedHead = gitText(['rev-parse', 'HEAD'], source);

  git(buildReportRuntimeSealedCloneArgs(source, sealed), root);
  git(['checkout', '--force', '-B', 'main', pinnedHead], sealed);
  git(['remote', 'set-url', 'origin', '.'], sealed);
  git(['fetch', 'origin', 'main', '--quiet'], sealed);

  git(['switch', '-c', 'feature-work'], source);
  await writeFile(join(source, 'dirty.txt'), 'parallel checkout mutation\n');
  git(['clone', '--no-local', '--branch', 'main', '--', source, updater], root);
  configureIdentity(updater);
  await writeFile(join(updater, 'state.txt'), 'new remote main\n');
  git(['add', 'state.txt'], updater);
  git(['commit', '-m', 'advance main'], updater);
  git(['push', 'origin', 'main'], updater);
  const advancedSourceMain = gitText(['rev-parse', 'main'], source);
  assert.notEqual(advancedSourceMain, pinnedHead);

  git(['fetch', 'origin', 'main', '--quiet'], sealed);
  assert.equal(gitText(['branch', '--show-current'], sealed), 'main');
  assert.equal(gitText(['rev-parse', 'HEAD'], sealed), pinnedHead);
  assert.equal(gitText(['rev-parse', 'origin/main'], sealed), pinnedHead);
  assert.equal(gitText(['status', '--porcelain', '--untracked-files=all'], sealed), '');
});

function configureIdentity(repository) {
  git(['config', 'user.email', 'report-runtime@example.invalid'], repository);
  git(['config', 'user.name', 'Report Runtime Test'], repository);
}

function git(args, cwd) {
  execFileSync('git', args, {
    cwd,
    env: sanitizeReportRuntimeGitEnvironment(process.env),
    stdio: 'pipe',
  });
}

function gitText(args, cwd) {
  return execFileSync('git', args, {
    cwd,
    env: sanitizeReportRuntimeGitEnvironment(process.env),
    encoding: 'utf8',
    stdio: 'pipe',
  }).trim();
}
