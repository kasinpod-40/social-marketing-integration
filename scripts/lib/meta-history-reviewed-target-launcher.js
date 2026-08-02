export const META_HISTORY_REVIEWED_BRANCH =
  'integration/all-meta-end-to-end-completion-v1';
export const META_HISTORY_REVIEWED_HEAD_ENV =
  'MKT_META_HISTORY_REVIEW_WRAPPER_HEAD';
export const META_HISTORY_REVIEWED_BASE_MAIN_ENV =
  'MKT_META_HISTORY_REVIEW_BASE_MAIN_HEAD';

const FULL_SHA = /^[0-9a-f]{40}$/u;

export function validateMetaHistoryReviewedTargetBoundary(input = {}) {
  const reviewedHead = requireSha(input.reviewedHead, 'reviewedHead');
  const reviewedBaseMainHead = requireSha(
    input.reviewedBaseMainHead,
    'reviewedBaseMainHead',
  );
  const repositoryHead = requireSha(input.repositoryHead, 'repositoryHead');
  const originReviewedHead = requireSha(
    input.originReviewedHead,
    'originReviewedHead',
  );
  const originMainHead = requireSha(input.originMainHead, 'originMainHead');
  const branch = requireText(input.branch, 'branch');

  const checks = Object.freeze({
    branchMatches: branch === META_HISTORY_REVIEWED_BRANCH,
    repositoryHeadMatches: repositoryHead === reviewedHead,
    originReviewedMatches: originReviewedHead === reviewedHead,
    clean: input.clean === true,
    reviewedBaseIsAncestorOfReviewedHead:
      input.reviewedBaseIsAncestorOfReviewedHead === true,
    reviewedBaseIsAncestorOfCurrentMain:
      input.reviewedBaseIsAncestorOfCurrentMain === true,
  });
  const failed = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => name);

  if (failed.length > 0) {
    throw launcherError(
      'Targeted Meta history reviewed repository boundary is invalid',
      'META_HISTORY_2026_REVIEWED_TARGET_REPOSITORY_INVALID',
      {
        failed,
        branch,
        expectedBranch: META_HISTORY_REVIEWED_BRANCH,
        repositoryHead,
        reviewedHead,
        reviewedBaseMainHead,
        originMainHead,
      },
    );
  }

  return Object.freeze({
    accepted: true,
    branch,
    repositoryHead,
    reviewedHead,
    reviewedBaseMainHead,
    originMainHead,
    originMainAdvancedAfterReview: originMainHead !== reviewedBaseMainHead,
  });
}

export function isPinnedOriginMainRead(args = []) {
  return Array.isArray(args)
    && args.length === 2
    && args[0] === 'rev-parse'
    && args[1] === 'origin/main';
}

function requireSha(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!FULL_SHA.test(text)) {
    throw launcherError(
      `${fieldName} must be a full Git SHA`,
      'META_HISTORY_2026_REVIEWED_TARGET_HEAD_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw launcherError(
      `${fieldName} is required`,
      'META_HISTORY_2026_REVIEWED_TARGET_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function launcherError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'MetaHistoryReviewedTargetLauncherError';
  error.code = code;
  error.details = details;
  return error;
}
