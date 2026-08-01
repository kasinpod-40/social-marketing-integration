import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

const WRAPPER = new URL(
  '../../scripts/meta-history-2026-reviewed-release-terminal.mjs',
  import.meta.url,
);

const REVIEWED_RELEASE_HEAD = '29de2303fa311c4a13fac4725699416cfdc04386';

test('reviewed release wrapper plans the immutable approved Meta release', () => {
  const result = spawnSync(process.execPath, [WRAPPER.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(plan.reviewedReleaseHead, REVIEWED_RELEASE_HEAD);
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
  assert.match(source, /merge-base', '--is-ancestor', currentHead, originMain/u);
  assert.match(source, /merge-base', '--is-ancestor', REVIEWED_RELEASE_HEAD, originMain/u);
  assert.match(source, /clone', '--no-hardlinks', '--no-checkout'/u);
  assert.match(source, /checkout', '-B', 'main', REVIEWED_RELEASE_HEAD/u);
  assert.match(source, /update-ref', 'refs\/remotes\/origin\/main', REVIEWED_RELEASE_HEAD/u);
  assert.match(source, /symlink\(assets\.outputs/u);
  assert.match(source, /symlink\(assets\.devVars/u);
  assert.match(source, /symlink\(assets\.nodeModules/u);
  assert.match(source, /meta-history-2026-exact-plan-continuation-terminal\.mjs/u);
  assert.match(source, /status', '--porcelain', '--untracked-files=all/u);
  assert.match(source, /GIT_CONFIG_/u);
  assert.match(source, /KEY_/u);
  assert.match(source, /VALUE_/u);

  assert.doesNotMatch(source, /git pull/u);
  assert.doesNotMatch(source, /wrangler/u);
  assert.doesNotMatch(source, /'queues?',\s*'[^']*send/iu);
  assert.doesNotMatch(source, /production:\s*true/u);
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
