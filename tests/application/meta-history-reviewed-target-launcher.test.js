import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  chmod,
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
  META_HISTORY_REVIEWED_BRANCH,
  createMetaHistoryOneShotGitShim,
  isPinnedOriginMainRead,
  validateMetaHistoryReviewedTargetBoundary,
} from '../../scripts/lib/meta-history-reviewed-target-launcher.js';

const BASE = 'a'.repeat(40);
const HEAD = 'b'.repeat(40);
const CURRENT_MAIN = 'c'.repeat(40);

test('Meta reviewed target boundary accepts current main advancing after the reviewed base', () => {
  const result = validateMetaHistoryReviewedTargetBoundary({
    reviewedHead: HEAD,
    reviewedBaseMainHead: BASE,
    repositoryHead: HEAD,
    originReviewedHead: HEAD,
    originMainHead: CURRENT_MAIN,
    branch: META_HISTORY_REVIEWED_BRANCH,
    clean: true,
    reviewedBaseIsAncestorOfReviewedHead: true,
    reviewedBaseIsAncestorOfCurrentMain: true,
  });

  assert.equal(result.accepted, true);
  assert.equal(result.originMainAdvancedAfterReview, true);
  assert.equal(result.reviewedBaseMainHead, BASE);
});

test('Meta reviewed target boundary fails closed on repository or ancestry drift', () => {
  for (const override of [
    { repositoryHead: 'd'.repeat(40) },
    { originReviewedHead: 'e'.repeat(40) },
    { branch: 'main' },
    { clean: false },
    { reviewedBaseIsAncestorOfReviewedHead: false },
    { reviewedBaseIsAncestorOfCurrentMain: false },
  ]) {
    assert.throws(
      () => validateMetaHistoryReviewedTargetBoundary({
        reviewedHead: HEAD,
        reviewedBaseMainHead: BASE,
        repositoryHead: HEAD,
        originReviewedHead: HEAD,
        originMainHead: CURRENT_MAIN,
        branch: META_HISTORY_REVIEWED_BRANCH,
        clean: true,
        reviewedBaseIsAncestorOfReviewedHead: true,
        reviewedBaseIsAncestorOfCurrentMain: true,
        ...override,
      }),
      (error) => error?.code === 'META_HISTORY_2026_REVIEWED_TARGET_REPOSITORY_INVALID',
    );
  }
});

test('Meta reviewed target boundary requires full immutable SHAs', () => {
  assert.throws(
    () => validateMetaHistoryReviewedTargetBoundary({
      reviewedHead: 'short',
      reviewedBaseMainHead: BASE,
      repositoryHead: HEAD,
      originReviewedHead: HEAD,
      originMainHead: CURRENT_MAIN,
      branch: META_HISTORY_REVIEWED_BRANCH,
      clean: true,
      reviewedBaseIsAncestorOfReviewedHead: true,
      reviewedBaseIsAncestorOfCurrentMain: true,
    }),
    (error) => error?.code === 'META_HISTORY_2026_REVIEWED_TARGET_HEAD_INVALID',
  );
});

test('Meta git shim pins only the exact origin/main read', () => {
  assert.equal(isPinnedOriginMainRead(['rev-parse', 'origin/main']), true);
  assert.equal(isPinnedOriginMainRead(['rev-parse', 'HEAD']), false);
  assert.equal(isPinnedOriginMainRead(['status', '--porcelain']), false);
  assert.equal(isPinnedOriginMainRead(['rev-parse', 'origin/main', '--verify']), false);
});

test('Meta reviewed target git shim is one-shot and repository-scoped', async () => {
  const root = await mkdtemp(join(tmpdir(), 'meta-reviewed-target-shim-'));
  try {
    const repositoryRoot = join(root, 'repository');
    const otherRoot = join(root, 'other-repository');
    await mkdir(repositoryRoot);
    await mkdir(otherRoot);

    const realGit = join(root, 'real-git.mjs');
    await writeFile(realGit, `#!/usr/bin/env node\nprocess.stdout.write(\`delegated:\${process.argv.slice(2).join('|')}:\${process.cwd()}\\n\`);\n`, 'utf8');
    await chmod(realGit, 0o700);

    const markerPath = join(root, 'origin-main-read.used');
    const shimPath = join(root, 'git-shim.mjs');
    await writeFile(shimPath, createMetaHistoryOneShotGitShim({
      realGit,
      reviewedBaseMainHead: BASE,
      repositoryRoot,
      markerPath,
    }), 'utf8');
    await chmod(shimPath, 0o700);

    const first = spawnSync(process.execPath, [shimPath, 'rev-parse', 'origin/main'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    assert.equal(first.status, 0, first.stderr);
    assert.equal(first.stdout.trim(), BASE);

    const second = spawnSync(process.execPath, [shimPath, 'rev-parse', 'origin/main'], {
      cwd: repositoryRoot,
      encoding: 'utf8',
    });
    assert.equal(second.status, 0, second.stderr);
    assert.equal(
      second.stdout.trim(),
      `delegated:rev-parse|origin/main:${repositoryRoot}`,
    );

    const outsideMarker = join(root, 'outside-origin-main-read.used');
    const outsideShim = join(root, 'outside-git-shim.mjs');
    await writeFile(outsideShim, createMetaHistoryOneShotGitShim({
      realGit,
      reviewedBaseMainHead: BASE,
      repositoryRoot,
      markerPath: outsideMarker,
    }), 'utf8');
    await chmod(outsideShim, 0o700);
    const outside = spawnSync(process.execPath, [outsideShim, 'rev-parse', 'origin/main'], {
      cwd: otherRoot,
      encoding: 'utf8',
    });
    assert.equal(outside.status, 0, outside.stderr);
    assert.equal(
      outside.stdout.trim(),
      `delegated:rev-parse|origin/main:${otherRoot}`,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('Meta reviewed target launcher contains no ref mutation or network Git action', async () => {
  const source = await readFile(
    new URL('../../scripts/meta-history-2026-reviewed-target-launcher.mjs', import.meta.url),
    'utf8',
  );
  assert.doesNotMatch(
    source,
    /\['(?:update-ref|reset|checkout|switch|pull|push|fetch|merge|rebase)'/u,
  );
  assert.match(source, /reviewedBaseIsAncestorOfCurrentMain/u);
  assert.match(source, /createMetaHistoryOneShotGitShim/u);
  assert.match(source, /meta-history-2026-finalizer\.mjs/u);
});
