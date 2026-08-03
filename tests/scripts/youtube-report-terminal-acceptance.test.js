import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  OPERATOR_TERMINAL_EXIT_CODES,
  buildShellFreeCommandSpec,
  classifyOperatorTerminalExit,
} from '../../scripts/lib/operator-terminal-reliability.js';
import {
  YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
} from '../../scripts/lib/youtube-report-remote-readiness-collector.js';

const HEAD = 'a'.repeat(40);
const acceptancePath = resolve('scripts/youtube-report-terminal-acceptance.mjs');
const reviewedTerminalPath = resolve('scripts/youtube-report-remote-readiness-reviewed-terminal.mjs');

function parseSingleJson(value) {
  return JSON.parse(String(value ?? '').trim());
}

test('shell-free command contract uses argv arrays and rejects multiline shell fragments', () => {
  assert.deepEqual(buildShellFreeCommandSpec({
    executable: process.execPath,
    args: [reviewedTerminalPath, '--execute'],
    requiredEnv: ['B', 'A'],
  }), {
    executable: process.execPath,
    args: [reviewedTerminalPath, '--execute'],
    requiredEnv: ['A', 'B'],
    shell: false,
  });
  assert.throws(
    () => buildShellFreeCommandSpec({ executable: process.execPath, args: ['# comment\nnode script.mjs'] }),
    (error) => error.code === 'OPERATOR_TERMINAL_ARGUMENT_UNSAFE',
  );
});

test('terminal exit classifier separates local blockers from execution failures', () => {
  assert.deepEqual(classifyOperatorTerminalExit('repository-read-only-preflight'), {
    exitCode: OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked,
    exitClass: 'PRECHECK_BLOCKED',
  });
  assert.deepEqual(classifyOperatorTerminalExit('run-internal-read-only-collector'), {
    exitCode: OPERATOR_TERMINAL_EXIT_CODES.executionFailed,
    exitClass: 'EXECUTION_FAILED',
  });
});

test('reviewed terminal plan is a spawned JSON process with explicit reliability contract', () => {
  const result = spawnSync(process.execPath, [reviewedTerminalPath], {
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  const output = parseSingleJson(result.stdout);
  assert.equal(output.planOnly, true);
  assert.equal(output.acceptanceCommand, 'node scripts/youtube-report-terminal-acceptance.mjs');
  assert.equal(output.commandTransport.shell, false);
  assert.equal(output.metaRemoteLockGate.privateMode, '0600');
  assert.equal(output.metaRemoteLockGate.digestVerified, true);
  assert.equal(output.localCredentialSource.missingDevVarsDoesNotCauseENOENT, true);
  assert.equal(output.exitCodeContract['2'], 'precheck_or_readiness_blocked_without_remote_mutation');
  assert.equal(output.remoteReadExecuted, false);
});

test('acceptance runner reports all local blockers in one spawned run with zero Remote actions', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube terminal acceptance '));
  try {
    const result = spawnSync(process.execPath, [acceptancePath], {
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD: 'not-a-sha',
        MKT_YOUTUBE_REPORT_REMOTE_COLLECTOR_WRANGLER_CONFIG: join(directory, 'missing config.jsonc'),
        DEV_VARS_FILE: join(directory, 'missing dev vars'),
        MKT_YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_EVIDENCE: join(directory, 'missing lock evidence.json'),
        MKT_YOUTUBE_REPORT_REMOTE_COLLECTOR_EVIDENCE: join(directory, 'output folder', 'summary.json'),
        CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR: '',
        LARK_APP_ID: '',
        LARK_APP_SECRET: '',
        LARK_APP_TOKEN: '',
        LARK_BASE_APP_TOKEN: '',
      },
    });
    assert.equal(result.status, OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked, result.stderr);
    const output = parseSingleJson(result.stdout);
    assert.equal(output.ok, false);
    assert.equal(output.decision, 'LOCAL_PRECHECK_BLOCKED');
    assert.equal(output.allBlockersReportedInSingleRun, true);
    assert.ok(output.blockers.length >= 5);
    assert.ok(output.blockers.some(({ gate }) => gate === 'reviewed-head-input'));
    assert.ok(output.blockers.some(({ gate }) => gate === 'wrangler-config-local-contract'));
    assert.ok(output.blockers.some(({ gate }) => gate === 'local-secret-source'));
    assert.ok(output.blockers.some(({ gate }) => gate === 'meta-remote-lock-release-evidence'));
    assert.ok(output.blockers.some(({ gate }) => gate === 'confirmation-value'));
    assert.equal(output.gates.find(({ name }) => name === 'reviewed-terminal-plan-spawn').status, 'pass');
    assert.equal(output.command.shell, false);
    assert.equal(output.remoteReadCount, 0);
    assert.equal(output.remoteWriteCount, 0);
    assert.equal(output.queueActionCount, 0);
    assert.equal(output.workerDeploymentCount, 0);
    assert.equal(output.production, 'BLOCKED');
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('reviewed terminal stops before Remote read on missing retained lock evidence with exit 2', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'youtube fake git '));
  const fakeGit = join(directory, 'git');
  const missingLock = join(directory, 'missing lock evidence.json');
  try {
    await writeFile(fakeGit, `#!/usr/bin/env node
const args = process.argv.slice(2).join(' ');
if (args === 'branch --show-current') process.stdout.write('main\\n');
else if (args === 'rev-parse HEAD') process.stdout.write('${HEAD}\\n');
else if (args === 'status --porcelain --untracked-files=all') process.stdout.write('');
else process.exitCode = 1;
`, { mode: 0o755 });
    await chmod(fakeGit, 0o755);

    const result = spawnSync(process.execPath, [reviewedTerminalPath, '--execute'], {
      encoding: 'utf8',
      shell: false,
      env: {
        ...process.env,
        PATH: `${directory}${delimiter}${process.env.PATH ?? ''}`,
        CONFIRM_YOUTUBE_REPORT_REMOTE_READINESS_COLLECTOR:
          YOUTUBE_REPORT_REMOTE_COLLECTOR_CONFIRMATION,
        MKT_YOUTUBE_REPORT_REMOTE_REVIEWED_HEAD: HEAD,
        MKT_YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_EVIDENCE: missingLock,
      },
    });
    assert.equal(result.status, OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked, result.stdout);
    const failure = parseSingleJson(result.stderr);
    assert.equal(failure.ok, false);
    assert.equal(failure.stage, 'meta-remote-lock-release-preflight');
    assert.equal(failure.code, 'YOUTUBE_REPORT_REMOTE_LOCK_RELEASE_LOAD_FAILED');
    assert.equal(failure.exitClass, 'PRECHECK_BLOCKED');
    assert.equal(failure.remoteReadExecuted, false);
    assert.equal(failure.remoteMutationCount, 0);
    assert.equal(failure.queueActionCount, 0);
    assert.equal(failure.workerDeploymentCount, 0);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
