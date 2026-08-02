import { realpathSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';

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

export function createMetaHistoryOneShotGitShim(input = {}) {
  const realGit = requireAbsolutePath(input.realGit, 'realGit');
  const repositoryRoot = requireCanonicalDirectoryPath(
    input.repositoryRoot,
    'repositoryRoot',
  );
  const markerPath = requireAbsolutePath(input.markerPath, 'markerPath');
  const reviewedBaseMainHead = requireSha(
    input.reviewedBaseMainHead,
    'reviewedBaseMainHead',
  );

  return `#!/usr/bin/env node\n\nimport { spawnSync } from 'node:child_process';\nimport { openSync, closeSync, realpathSync } from 'node:fs';\nimport { resolve } from 'node:path';\n\nconst args = process.argv.slice(2);\nlet currentRoot = resolve(process.cwd());\ntry {\n  currentRoot = realpathSync.native(currentRoot);\n} catch {\n  // Missing or inaccessible cwd must delegate to real Git and fail naturally.\n}\nconst exactPinnedRead = args.length === 2\n  && args[0] === 'rev-parse'\n  && args[1] === 'origin/main'\n  && currentRoot === ${JSON.stringify(repositoryRoot)};\n\nif (exactPinnedRead) {\n  try {\n    const descriptor = openSync(${JSON.stringify(markerPath)}, 'wx', 0o600);\n    closeSync(descriptor);\n    process.stdout.write(${JSON.stringify(`${reviewedBaseMainHead}\n`)});\n    process.exit(0);\n  } catch (error) {\n    if (error?.code !== 'EEXIST') throw error;\n  }\n}\n\nconst result = spawnSync(${JSON.stringify(realGit)}, args, {\n  env: process.env,\n  stdio: 'inherit',\n});\nif (result.error) throw result.error;\nif (result.signal) process.kill(process.pid, result.signal);\nelse process.exitCode = result.status ?? 1;\n`;
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

function requireCanonicalDirectoryPath(value, fieldName) {
  const path = requireAbsolutePath(value, fieldName);
  try {
    return realpathSync.native(path);
  } catch {
    throw launcherError(
      `${fieldName} must resolve to an existing directory`,
      'META_HISTORY_2026_REVIEWED_TARGET_PATH_INVALID',
      { fieldName },
    );
  }
}

function requireAbsolutePath(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!isAbsolute(text)) {
    throw launcherError(
      `${fieldName} must be an absolute path`,
      'META_HISTORY_2026_REVIEWED_TARGET_PATH_INVALID',
      { fieldName },
    );
  }
  return resolve(text);
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
