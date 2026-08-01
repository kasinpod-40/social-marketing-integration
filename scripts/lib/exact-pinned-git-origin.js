import { spawnSync } from 'node:child_process';
import { join, resolve } from 'node:path';

const SHA = /^[0-9a-f]{40}$/u;

export function prepareExactPinnedGitOrigin({
  sourceRepository,
  temporaryRoot,
  head,
}) {
  const source = resolve(requireText(sourceRepository, 'sourceRepository'));
  const root = resolve(requireText(temporaryRoot, 'temporaryRoot'));
  const exactHead = requireSha(head, 'head');
  const bareRoot = join(root, 'origin.git');
  const cloneRoot = join(root, 'repository');

  runGit(source, [
    'clone', '--bare', '--no-hardlinks', source, bareRoot,
  ]);
  runGit(bareRoot, ['update-ref', 'refs/heads/main', exactHead]);
  runGit(bareRoot, ['symbolic-ref', 'HEAD', 'refs/heads/main']);

  runGit(source, [
    'clone', '--no-hardlinks', '--no-checkout', bareRoot, cloneRoot,
  ]);
  runGit(cloneRoot, ['checkout', '-B', 'main', exactHead]);
  runGit(cloneRoot, ['update-ref', 'refs/remotes/origin/main', exactHead]);

  const observed = Object.freeze({
    head: gitText(cloneRoot, ['rev-parse', 'HEAD']),
    originMain: gitText(cloneRoot, ['rev-parse', 'origin/main']),
    branch: gitText(cloneRoot, ['branch', '--show-current']),
    remoteMain: gitText(bareRoot, ['rev-parse', 'refs/heads/main']),
  });
  if (observed.head !== exactHead
      || observed.originMain !== exactHead
      || observed.remoteMain !== exactHead
      || observed.branch !== 'main') {
    throw pinnedOriginError(
      'Prepared pinned Git origin is not exact',
      'EXACT_PINNED_GIT_ORIGIN_INVALID',
      observed,
    );
  }

  return Object.freeze({ bareRoot, cloneRoot, head: exactHead });
}

function runGit(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw pinnedOriginError(
      `Git command failed: git ${args.join(' ')}`,
      'EXACT_PINNED_GIT_ORIGIN_COMMAND_FAILED',
      {
        exitCode: result.status ?? null,
        spawnErrorCode: result.error?.code ?? null,
        stderr: String(result.stderr ?? '').trim(),
      },
    );
  }
}

function gitText(cwd, args) {
  const result = spawnSync('git', args, {
    cwd,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  if (result.error || result.status !== 0) {
    throw pinnedOriginError(
      `Git read failed: git ${args.join(' ')}`,
      'EXACT_PINNED_GIT_ORIGIN_COMMAND_FAILED',
      {
        exitCode: result.status ?? null,
        spawnErrorCode: result.error?.code ?? null,
      },
    );
  }
  return String(result.stdout ?? '').trim();
}

function requireSha(value, fieldName) {
  const text = requireText(value, fieldName).toLowerCase();
  if (!SHA.test(text)) {
    throw pinnedOriginError(
      `${fieldName} must be an exact Git SHA`,
      'EXACT_PINNED_GIT_ORIGIN_INPUT_INVALID',
      { fieldName },
    );
  }
  return text;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw pinnedOriginError(
      `${fieldName} is required`,
      'EXACT_PINNED_GIT_ORIGIN_INPUT_INVALID',
      { fieldName },
    );
  }
  return value.trim();
}

function pinnedOriginError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ExactPinnedGitOriginError';
  error.code = code;
  error.details = details;
  return error;
}
