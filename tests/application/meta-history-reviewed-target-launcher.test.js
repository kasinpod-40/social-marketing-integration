import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  META_HISTORY_REVIEWED_BRANCH,
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
  assert.match(source, /meta-history-2026-finalizer\.mjs/u);
});
