import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const WRAPPER = new URL(
  '../../scripts/meta-history-2026-reviewed-release-terminal.mjs',
  import.meta.url,
);

const REVIEWED_RELEASE_HEAD = '29de2303fa311c4a13fac4725699416cfdc04386';
const REVIEWED_WRAPPER_BRANCH = 'integration/all-meta-end-to-end-completion-v1';
const REVIEWED_CLONE_EXCLUDE = '/outputs\n/.dev.vars\n/node_modules\n';

test('reviewed release wrapper plans the immutable approved Meta release', () => {
  const result = spawnSync(process.execPath, [WRAPPER.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(plan.reviewedReleaseHead, REVIEWED_RELEASE_HEAD);
  assert.equal(plan.wrapperBranch, REVIEWED_WRAPPER_BRANCH);
  assert.equal(plan.assetRootEnv, 'MKT_META_HISTORY_REVIEW_ASSET_ROOT');
  assert.equal(
    plan.child,
    'scripts/meta-history-2026-exact-plan-continuation-terminal.mjs',
  );
  assert.equal(plan.providerReplayAllowed, false);
  assert.equal(plan.facebookD1QueueResendAllowed, false);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
});

test('reviewed release wrapper isolates the approved release from moving main', async () => {
  const source = await readFile(WRAPPER, 'utf8');

  assert.match(source, new RegExp(REVIEWED_RELEASE_HEAD, 'u'));
  assert.match(source, /MKT_META_HISTORY_REVIEW_WRAPPER_HEAD/u);
  assert.match(source, /merge-base', '--is-ancestor', originMain, currentHead/u);
  assert.match(source, new RegExp(REVIEWED_WRAPPER_BRANCH, 'u'));
  assert.match(source, /originBranch !== currentHead/u);
  assert.match(source, /merge-base', '--is-ancestor', REVIEWED_RELEASE_HEAD, originMain/u);
  assert.match(source, /clone', '--no-hardlinks', '--no-checkout'/u);
  assert.match(source, /checkout', '-B', 'main', REVIEWED_RELEASE_HEAD/u);
  assert.match(source, /update-ref', 'refs\/remotes\/origin\/main', REVIEWED_RELEASE_HEAD/u);
  assert.match(source, /symlink\(assets\.outputs/u);
  assert.match(source, /copyPrivateDevVars\(assets\.devVars/u);
  assert.doesNotMatch(source, /symlink\(assets\.devVars/u);
  assert.match(source, /symlink\(assets\.nodeModules/u);
  assert.match(source, /ensureReviewedCloneExclude\(root\)/u);
  assert.match(source, /'\/outputs'/u);
  assert.match(source, /'\/\.dev\.vars'/u);
  assert.match(source, /'\/node_modules'/u);
  assert.match(source, /join\(root, '\.git', 'info', 'exclude'\)/u);
  assert.match(source, /observed !== expected/u);
  assert.match(source, /mode & 0o077/u);
  assert.match(source, /dirtyPaths/u);
  assert.match(source, /meta-history-2026-exact-plan-continuation-terminal\.mjs/u);
  assert.match(source, /MKT_META_HISTORY_EXACT_CONTINUATION_CHILD/u);
  assert.match(source, /MKT_META_HISTORY_ONE_COMMAND_PATH/u);
  assert.match(source, /MKT_META_HISTORY_LARK_LAUNCHER_PATH/u);
  assert.match(source, /MKT_META_LARK_OPERATOR_PATH/u);
  assert.match(source, /MKT_META_HISTORY_REVIEW_ASSET_ROOT/u);
  assert.match(source, /assets\.exactTerminal/u);
  assert.match(source, /status', '--porcelain', '--untracked-files=all/u);
  assert.match(source, /GIT_CONFIG_/u);
  assert.match(source, /KEY_/u);
  assert.match(source, /VALUE_/u);

  assert.doesNotMatch(source, /status\.showUntrackedFiles/u);
  assert.doesNotMatch(source, /--untracked-files=no/u);
  assert.doesNotMatch(source, /git pull/u);
  assert.doesNotMatch(source, /wrangler/u);
  assert.doesNotMatch(source, /'queues?',\s*'[^']*send/iu);
  assert.doesNotMatch(source, /production:\s*true/u);
});

test('reviewed clone exact excludes hide only injected runtime assets', async () => {
  const root = await mkdtemp(join(tmpdir(), 'mkt-reviewed-clone-exclude-test-'));
  const repo = join(root, 'repo');
  const assets = join(root, 'assets');

  try {
    await mkdir(repo);
    await mkdir(assets);
    runGit(repo, ['init']);
    runGit(repo, ['config', 'user.name', 'Meta Test']);
    runGit(repo, ['config', 'user.email', 'meta-test@example.invalid']);
    await writeFile(join(repo, 'tracked.txt'), 'tracked\n');
    runGit(repo, ['add', 'tracked.txt']);
    runGit(repo, ['commit', '-m', 'test fixture']);

    const outputs = join(assets, 'outputs');
    const nodeModules = join(assets, 'node_modules');
    const devVars = join(assets, '.dev.vars');
    await mkdir(outputs);
    await mkdir(nodeModules);
    await writeFile(devVars, 'PRIVATE_TEST_VALUE=redacted\n', { mode: 0o600 });
    await chmod(devVars, 0o600);

    await symlink(outputs, join(repo, 'outputs'), 'dir');
    await copyFile(devVars, join(repo, '.dev.vars'));
    await chmod(join(repo, '.dev.vars'), 0o600);
    await symlink(nodeModules, join(repo, 'node_modules'), 'dir');
    await writeFile(join(repo, '.git', 'info', 'exclude'), REVIEWED_CLONE_EXCLUDE, {
      mode: 0o600,
    });

    assert.equal(gitText(repo, ['status', '--porcelain', '--untracked-files=all']), '');

    await writeFile(join(repo, 'unexpected.txt'), 'must remain visible\n');
    assert.equal(
      gitText(repo, ['status', '--porcelain', '--untracked-files=all']),
      '?? unexpected.txt',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('reviewed release wrapper rejects execute without exact confirmation', () => {
  const result = spawnSync(process.execPath, [WRAPPER.pathname, '--execute'], {
    cwd: process.cwd(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CONFIRM_META_HISTORY_EXACT_CONTINUATION: '',
      MKT_META_HISTORY_REVIEW_WRAPPER_HEAD: '',
    },
  });
  assert.equal(result.status, 1);
  const failure = JSON.parse(result.stderr);
  assert.equal(failure.stage, 'confirm-reviewed-release-continuation');
  assert.equal(failure.code, 'META_HISTORY_REVIEWED_RELEASE_CONFIRMATION_REQUIRED');
  assert.equal(failure.remoteProviderRequestCount, 0);
  assert.equal(failure.remoteQueueSendCount, 0);
  assert.equal(failure.remoteD1MutationCount, 0);
  assert.equal(failure.remoteLarkMutationCount, 0);
  assert.equal(failure.workerDeploymentCount, 0);
  assert.equal(failure.scheduleEnabled, false);
  assert.equal(failure.production, 'BLOCKED');
});

function runGit(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  return String(result.stdout ?? '').trim();
}

function gitText(cwd, args) {
  return runGit(cwd, args);
}
