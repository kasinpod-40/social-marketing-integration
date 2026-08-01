import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  assertChatwootSafeBaselineCurrentHeadClear,
} from '../../scripts/lib/chatwoot-safe-baseline-current-head-guard.js';

const WRAPPER = new URL(
  '../../scripts/chatwoot-controller-safe-baseline-exact-terminal.mjs',
  import.meta.url,
);
const HEAD = 'a'.repeat(40);
const SYMLINK_HEAD = 'b'.repeat(40);

test('Chatwoot safe-baseline exact terminal is plan-only by default', () => {
  const result = spawnSync(process.execPath, [WRAPPER.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(plan.currentHeadEvidenceGuard, 'required_before_child');
  assert.equal(
    plan.child,
    'scripts/chatwoot-controller-safe-baseline-pinned-origin-terminal.mjs',
  );
  assert.equal(plan.retainedEvidenceMutation, false);
  assert.equal(plan.secondInitialAdmissionAllowed, false);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.webhookEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
  assert.equal(plan.remoteActionsPerformed, false);
});

test('current-head guard allows absent and empty evidence only', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatwoot-safe-baseline-guard-'));
  try {
    const absent = await assertChatwootSafeBaselineCurrentHeadClear({
      outputs: root,
      repositoryHead: HEAD,
    });
    assert.equal(absent.clear, true);
    assert.equal(absent.entryCount, 0);

    const directory = join(root, 'chatwoot-controller-safe-baseline-resume', HEAD);
    await mkdir(directory, { recursive: true });
    const empty = await assertChatwootSafeBaselineCurrentHeadClear({
      outputs: root,
      repositoryHead: HEAD,
    });
    assert.equal(empty.clear, true);
    assert.equal(empty.entryCount, 0);

    await writeFile(join(directory, '01-active-window.attempt.json'), '{}\n', 'utf8');
    await assert.rejects(
      assertChatwootSafeBaselineCurrentHeadClear({
        outputs: root,
        repositoryHead: HEAD,
      }),
      (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_PRESENT'
        && error?.details?.entryCount === 1,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('current-head guard rejects invalid, non-directory and symlinked evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatwoot-safe-baseline-invalid-'));
  try {
    await assert.rejects(
      assertChatwootSafeBaselineCurrentHeadClear({
        outputs: root,
        repositoryHead: 'not-a-head',
      }),
      (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_INVALID',
    );

    const recoveryRoot = join(root, 'chatwoot-controller-safe-baseline-resume');
    await mkdir(recoveryRoot, { recursive: true });
    await writeFile(join(recoveryRoot, HEAD), 'not a directory\n', 'utf8');
    await assert.rejects(
      assertChatwootSafeBaselineCurrentHeadClear({
        outputs: root,
        repositoryHead: HEAD,
      }),
      (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_INVALID',
    );

    const target = join(root, 'external-empty-directory');
    await mkdir(target);
    await symlink(target, join(recoveryRoot, SYMLINK_HEAD), 'dir');
    await assert.rejects(
      assertChatwootSafeBaselineCurrentHeadClear({
        outputs: root,
        repositoryHead: SYMLINK_HEAD,
      }),
      (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_CURRENT_HEAD_INVALID',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('exact terminal checks current-head evidence before delegating', async () => {
  const source = await import('node:fs/promises').then(({ readFile }) => readFile(WRAPPER, 'utf8'));
  const guardPosition = source.indexOf('assertChatwootSafeBaselineCurrentHeadClear');
  const childPosition = source.indexOf('spawnSync(\n      process.execPath');
  assert.ok(guardPosition >= 0);
  assert.ok(childPosition > guardPosition);
  assert.match(source, /MKT_CHATWOOT_SAFE_BASELINE_EXACT_HEAD/u);
  assert.match(source, /MKT_CHATWOOT_SAFE_BASELINE_PINNED_ORIGIN_HEAD/u);
  assert.match(source, /status', '--porcelain', '--untracked-files=all/u);
  assert.doesNotMatch(source, /spawnSync\(\s*['"]npx['"]/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /d1', 'execute/u);
  assert.doesNotMatch(source, /versions', 'deploy/u);
});
