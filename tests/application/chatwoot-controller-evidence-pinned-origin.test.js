import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  prepareExactPinnedGitOrigin,
} from '../../scripts/lib/exact-pinned-git-origin.js';

const WRAPPER = new URL(
  '../../scripts/chatwoot-controller-evidence-pinned-origin-terminal.mjs',
  import.meta.url,
);

function git(cwd, args, options = {}) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: 'Pinned Origin Test',
      GIT_AUTHOR_EMAIL: 'pinned-origin@example.invalid',
      GIT_COMMITTER_NAME: 'Pinned Origin Test',
      GIT_COMMITTER_EMAIL: 'pinned-origin@example.invalid',
    },
    ...options,
  });
  assert.equal(result.status, 0, result.stderr);
  return String(result.stdout ?? '').trim();
}

test('Chatwoot pinned-origin wrapper is plan-only by default', () => {
  const result = spawnSync(process.execPath, [WRAPPER.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(
    plan.innerWrapper,
    'scripts/chatwoot-controller-evidence-arbitration-terminal.mjs',
  );
  assert.equal(
    plan.innerOrigin,
    'temporary_bare_main_pinned_to_wrapper_head',
  );
  assert.equal(plan.retainedEvidenceMutation, false);
  assert.equal(plan.secondInitialAdmissionAllowed, false);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.webhookEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
  assert.equal(plan.remoteActionsPerformed, false);
});

test('synthetic origin keeps main pinned after the source branch advances', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatwoot-pinned-origin-test-'));
  try {
    const source = join(root, 'source');
    const pinnedRoot = join(root, 'pinned');
    await mkdir(source, { recursive: true });
    await mkdir(pinnedRoot, { recursive: true });
    git(source, ['init', '-b', 'main']);

    await writeFile(join(source, 'state.txt'), 'reviewed\n', 'utf8');
    git(source, ['add', 'state.txt']);
    git(source, ['commit', '-m', 'reviewed']);
    const reviewedHead = git(source, ['rev-parse', 'HEAD']);

    await writeFile(join(source, 'state.txt'), 'advanced\n', 'utf8');
    git(source, ['add', 'state.txt']);
    git(source, ['commit', '-m', 'advanced']);
    const advancedHead = git(source, ['rev-parse', 'HEAD']);
    assert.notEqual(advancedHead, reviewedHead);

    const pinned = prepareExactPinnedGitOrigin({
      sourceRepository: source,
      temporaryRoot: pinnedRoot,
      head: reviewedHead,
    });
    git(pinned.cloneRoot, ['fetch', 'origin', 'main', '--quiet']);

    assert.equal(git(pinned.cloneRoot, ['rev-parse', 'HEAD']), reviewedHead);
    assert.equal(git(pinned.cloneRoot, ['rev-parse', 'origin/main']), reviewedHead);
    assert.equal(git(pinned.cloneRoot, ['branch', '--show-current']), 'main');
    assert.equal(git(pinned.bareRoot, ['rev-parse', 'refs/heads/main']), reviewedHead);
    assert.equal(git(source, ['rev-parse', 'main']), advancedHead);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('outer wrapper pins origin before delegating to the existing arbitration authority', async () => {
  const source = await readFile(WRAPPER, 'utf8');
  assert.match(source, /prepareExactPinnedGitOrigin/u);
  assert.match(source, /MKT_CHATWOOT_PINNED_ORIGIN_WRAPPER_HEAD/u);
  assert.match(source, /MKT_CHATWOOT_EVIDENCE_ARBITRATION_WRAPPER_HEAD/u);
  assert.match(source, /chatwoot-controller-evidence-arbitration-terminal\.mjs/u);
  assert.match(source, /fetch', 'origin', 'main', '--quiet'/u);
  assert.match(source, /originMain !== expectedHead/u);
  assert.match(source, /status', '--porcelain', '--untracked-files=all/u);
  assert.doesNotMatch(source, /wrangler/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /d1', 'execute/u);
  assert.doesNotMatch(source, /deploy'/u);
});
