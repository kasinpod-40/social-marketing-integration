#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { delimiter, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import {
  META_HISTORY_REVIEWED_BASE_MAIN_ENV,
  META_HISTORY_REVIEWED_BRANCH,
  META_HISTORY_REVIEWED_HEAD_ENV,
  createMetaHistoryOneShotGitShim,
  validateMetaHistoryReviewedTargetBoundary,
} from './lib/meta-history-reviewed-target-launcher.js';

const repositoryRoot = resolve(process.cwd());
const finalizerPath = join(repositoryRoot, 'scripts', 'meta-history-2026-finalizer.mjs');
let tempDirectory = null;

try {
  const args = process.argv.slice(2);
  if (!args.includes('--execute')) {
    exitFrom(runFinalizer(args, process.env));
  } else {
    const realGit = resolveRealGit();
    const reviewedHead = process.env[META_HISTORY_REVIEWED_HEAD_ENV];
    const reviewedBaseMainHead = process.env[META_HISTORY_REVIEWED_BASE_MAIN_ENV];
    const repositoryHead = gitText(realGit, ['rev-parse', 'HEAD']);
    const branch = gitText(realGit, ['branch', '--show-current']);
    const originReviewedHead = gitText(
      realGit,
      ['rev-parse', `origin/${META_HISTORY_REVIEWED_BRANCH}`],
    );
    const originMainHead = gitText(realGit, ['rev-parse', 'origin/main']);
    const clean = gitText(
      realGit,
      ['status', '--porcelain', '--untracked-files=all'],
    ) === '';

    validateMetaHistoryReviewedTargetBoundary({
      reviewedHead,
      reviewedBaseMainHead,
      repositoryHead,
      branch,
      originReviewedHead,
      originMainHead,
      clean,
      reviewedBaseIsAncestorOfReviewedHead: gitSuccess(
        realGit,
        ['merge-base', '--is-ancestor', reviewedBaseMainHead, reviewedHead],
      ),
      reviewedBaseIsAncestorOfCurrentMain: gitSuccess(
        realGit,
        ['merge-base', '--is-ancestor', reviewedBaseMainHead, originMainHead],
      ),
    });

    tempDirectory = await mkdtemp(join(tmpdir(), 'meta-reviewed-target-git-'));
    const shimPath = join(tempDirectory, 'git');
    const markerPath = join(tempDirectory, 'origin-main-read.used');
    await writeFile(
      shimPath,
      createMetaHistoryOneShotGitShim({
        realGit,
        reviewedBaseMainHead,
        repositoryRoot,
        markerPath,
      }),
      { encoding: 'utf8', mode: 0o700 },
    );
    await chmod(shimPath, 0o700);

    exitFrom(runFinalizer(args, {
      ...process.env,
      PATH: `${tempDirectory}${delimiter}${process.env.PATH ?? ''}`,
    }));
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: 'reviewed-target-repository-boundary',
    code: error?.code ?? 'META_HISTORY_2026_REVIEWED_TARGET_LAUNCHER_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitize(error?.details ?? {}),
    remoteMutationCount: 0,
    queueMessages: 0,
    businessWrites: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (tempDirectory) await rm(tempDirectory, { recursive: true, force: true });
}

function runFinalizer(args, env) {
  return spawnSync(process.execPath, [finalizerPath, ...args], {
    cwd: repositoryRoot,
    env,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
    stdio: 'inherit',
  });
}

function exitFrom(result) {
  if (result.error) throw result.error;
  if (result.signal) process.kill(process.pid, result.signal);
  else process.exitCode = result.status ?? 1;
}

function resolveRealGit() {
  const result = spawnSync('which', ['git'], {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const error = new Error('Unable to resolve the real git executable');
    error.code = 'META_HISTORY_2026_REAL_GIT_NOT_FOUND';
    throw error;
  }
  const path = String(result.stdout ?? '').trim();
  if (!path.startsWith('/')) {
    const error = new Error('Resolved git executable must be an absolute path');
    error.code = 'META_HISTORY_2026_REAL_GIT_INVALID';
    throw error;
  }
  return path;
}

function gitText(realGit, args) {
  const result = spawnSync(realGit, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    const error = new Error(`Git command failed: git ${args.join(' ')}`);
    error.code = 'META_HISTORY_2026_REVIEWED_TARGET_GIT_FAILED';
    throw error;
  }
  return String(result.stdout ?? '').trim();
}

function gitSuccess(realGit, args) {
  const result = spawnSync(realGit, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: 'ignore',
  });
  return !result.error && result.status === 0;
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => !/token|secret|authorization/iu.test(key))
    .map(([key, nested]) => [key, sanitize(nested)]));
}
