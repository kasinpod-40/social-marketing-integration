#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

const repositoryRoot = resolve(process.cwd());
const expectedBranch = 'hotfix/meta-facebook-lark-continuation-v1';
const pinnedBase = 'c03ca9af7ddc0b8f72527419fc193eb49e1c590d';

const expectedHead = process.env.EXPECTED_META_CONTINUATION_HEAD;
if (!/^[0-9a-f]{40}$/u.test(expectedHead ?? '')) {
  fail(
    'EXPECTED_META_CONTINUATION_HEAD must be the exact 40-character branch Head',
    'META_HISTORY_EXACT_CONTINUATION_LOCAL_HEAD_REQUIRED',
  );
}

const branch = gitText(['branch', '--show-current']);
const head = gitText(['rev-parse', 'HEAD']);
const originHead = gitText(['rev-parse', `origin/${expectedBranch}`]);
const clean = gitText(['status', '--porcelain', '--untracked-files=all'], false).trim() === '';
const [behind, ahead] = gitText([
  'rev-list', '--left-right', '--count', `origin/main...${head}`,
]).split(/\s+/u).map(Number);

if (branch !== expectedBranch
  || head !== expectedHead
  || originHead !== expectedHead
  || !clean
  || behind !== 0
  || !Number.isSafeInteger(ahead)
  || ahead < 1
  || !gitSuccess(['merge-base', '--is-ancestor', pinnedBase, head])) {
  fail(
    'Local Meta continuation verification requires the exact clean reviewed branch Head',
    'META_HISTORY_EXACT_CONTINUATION_LOCAL_REPOSITORY_INVALID',
    {
      branch,
      head,
      originHead,
      expectedHead,
      clean,
      behind,
      ahead,
      pinnedBaseIsAncestor: gitSuccess(['merge-base', '--is-ancestor', pinnedBase, head]),
    },
  );
}

const checks = [
  ['npm-ci', 'npm', ['ci']],
  ['syntax-architecture-hygiene', 'npm', ['run', 'check']],
  [
    'focused-exact-continuation',
    process.execPath,
    [
      '--test',
      'tests/application/meta-history-exact-plan-continuation.test.js',
      'tests/application/meta-history-exact-plan-continuation-wiring.test.js',
    ],
  ],
  ['unit-workers', 'npm', ['test']],
  ['report-reliability', 'npm', ['run', 'test:report-reliability']],
  ['dependency-audit', 'npm', ['audit', '--audit-level=high']],
  ['wrangler-dry-run', 'npm', ['run', 'deploy:dry-run']],
];

const completed = [];
for (const [name, command, args] of checks) {
  runVisible(command, args, name);
  completed.push(name);
}

process.stdout.write(`${JSON.stringify({
  ok: true,
  decision: 'META_HISTORY_EXACT_PLAN_CONTINUATION_V1_LOCAL_MACOS_PASS',
  branch,
  repositoryHead: head,
  pinnedBase,
  behindMain: behind,
  aheadMain: ahead,
  exactOperationIdentityContract: 'pass',
  exactReleaseDeltaContract: 'pass',
  retainedSafeConfigTerminalContract: 'pass',
  stableRemoteBoundaryContract: 'pass',
  noFacebookProviderReplayContract: 'pass',
  noFacebookD1QueueResendContract: 'pass',
  sameOperationLarkContinuationContract: 'pass',
  automaticAllFalseRestoreContract: 'pass',
  focusedRegression: 'pass',
  syntaxArchitectureHygiene: 'pass',
  unitWorkers: 'pass',
  reportReliability: 'pass',
  dependencyAudit: 'pass',
  wranglerDryRun: 'pass',
  completedChecks: completed,
  remoteProviderRequestCount: 0,
  remoteQueueSendCount: 0,
  remoteD1MutationCount: 0,
  remoteLarkMutationCount: 0,
  workerDeploymentCount: 0,
  scheduleMutationCount: 0,
  production: 'BLOCKED',
}, null, 2)}\n`);

function runVisible(command, args, name) {
  const result = spawnSync(command, args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    maxBuffer: 512 * 1024 * 1024,
    stdio: 'inherit',
  });
  if (result.error || result.status !== 0) {
    fail(
      `Local verification command failed: ${command} ${args.join(' ')}`,
      'META_HISTORY_EXACT_CONTINUATION_LOCAL_CHECK_FAILED',
      { name, command, exitCode: result.status ?? 1 },
    );
  }
}

function gitText(args, trim = true) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) {
    fail(
      `Git command failed: git ${args.join(' ')}`,
      'META_HISTORY_EXACT_CONTINUATION_LOCAL_GIT_FAILED',
      { exitCode: result.status ?? 1 },
    );
  }
  const output = String(result.stdout ?? '');
  return trim ? output.trim() : output;
}

function gitSuccess(args) {
  const result = spawnSync('git', args, {
    cwd: repositoryRoot,
    env: process.env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return !result.error && result.status === 0;
}

function fail(message, code, details = {}) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    decision: 'META_HISTORY_EXACT_PLAN_CONTINUATION_V1_LOCAL_MACOS_FAILED',
    code,
    message,
    details,
    remoteProviderRequestCount: 0,
    remoteQueueSendCount: 0,
    remoteD1MutationCount: 0,
    remoteLarkMutationCount: 0,
    workerDeploymentCount: 0,
    scheduleMutationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exit(1);
}
