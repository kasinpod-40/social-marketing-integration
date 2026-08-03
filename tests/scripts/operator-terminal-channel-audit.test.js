import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import {
  auditOperatorTerminalChannels,
  classifyOperatorTerminal,
  inspectOperatorTerminalSource,
} from '../../scripts/lib/operator-terminal-channel-audit.js';
import {
  OPERATOR_TERMINAL_REQUIRED_CHANNELS,
  OPERATOR_TERMINAL_STATUSES,
} from '../../scripts/lib/operator-terminal-channel-policy.js';

function inspect(source, overrides = {}) {
  return inspectOperatorTerminalSource({
    path: 'scripts/example-terminal.mjs',
    source,
    spawnedTests: overrides.spawnedTests ?? ['tests/scripts/example-terminal.test.js'],
    companion: overrides.companion ?? null,
  });
}

test('unsafe shell child process is always forbidden', () => {
  const features = inspect(`
    import { execSync } from 'node:child_process';
    execSync('node child.mjs', { shell: true });
  `);
  assert.equal(features.hasUnsafeShell, true);
  assert.deepEqual(features.unsafeChildProcessImports, ['execSync']);
  assert.equal(classifyOperatorTerminal(features), 'UNSAFE_SHELL_COMMAND');
});

test('status ordering exposes missing spawned test blocker exit and restore controls', () => {
  const noSpawn = inspect(`
    const blockers = [];
    function printPlan() { console.log({ planOnly: true }); }
    if (process.argv.includes('--execute')) process.exitCode = 2;
  `, { spawnedTests: [] });
  assert.equal(classifyOperatorTerminal(noSpawn), 'NEEDS_SPAWNED_TEST');

  const noBlockers = inspect(`
    function printPlan() { console.log({ planOnly: true }); }
    if (process.argv.includes('--execute')) process.exitCode = 2;
  `);
  assert.equal(classifyOperatorTerminal(noBlockers), 'NEEDS_ALL_BLOCKER_PREFLIGHT');

  const noCompletion = inspect(`
    const blockers = [];
    const blockerCount = blockers.length;
    function printPlan() { console.log({ planOnly: true }); }
    if (process.argv.includes('--execute')) console.log(blockerCount);
  `);
  assert.equal(classifyOperatorTerminal(noCompletion), 'NEEDS_EXIT_CODE_CONTRACT');

  const noRestore = inspect(`
    import { spawnSync } from 'node:child_process';
    const blockers = [];
    const blockerCount = blockers.length;
    function printPlan() { console.log({ planOnly: true }); }
    if (process.argv.includes('--execute')) {
      spawnSync('wrangler', ['deploy'], { shell: false });
      process.exitCode = blockerCount > 0 ? 2 : 0;
    }
    process.exitCode = 1;
  `);
  assert.equal(classifyOperatorTerminal(noRestore), 'NEEDS_SAFE_RESTORE_EVIDENCE');
});

test('strong exact terminal with replay and private evidence passes', () => {
  const features = inspect(`
    import { execFile } from 'node:child_process';
    import { chmod, open, writeFile } from 'node:fs/promises';
    const blockers = [];
    const blockerCount = blockers.length;
    const reviewedHead = 'a'.repeat(40);
    const repository = { branch: 'main', reviewedHead };
    const originMain = reviewedHead;
    function printPlan() { console.log({ planOnly: true, hiddenPrerequisiteFiles: 0 }); }
    async function execute() {
      const lockPath = '.exact-terminal.lock';
      await open(lockPath, 'wx', 0o600);
      await writeFile('summary.json', JSON.stringify({ verification: 'zero_drift' }), { mode: 0o600 });
      await chmod('summary.json', 0o600);
      execFile('node', ['child.mjs'], { shell: false });
      console.log({ replay: 'same-input-replay', no_op: 40, writes: { total: 0 } });
    }
    if (process.argv.includes('--execute')) execute();
    void blockerCount; void repository; void originMain;
  `);
  assert.equal(features.hasUnsafeShell, false);
  assert.equal(features.hasSpawnedTest, true);
  assert.equal(features.hasAllBlockerPreflight, true);
  assert.equal(features.hasReplay, true);
  assert.equal(features.hasPrivateEvidence, true);
  assert.equal(classifyOperatorTerminal(features), 'PASS_EXISTING_PATTERN');
});

test('repository audit discovers every required business channel and known status vocabulary', async () => {
  const report = await auditOperatorTerminalChannels({
    projectRoot: resolve('.'),
    changedPaths: [],
  });
  const paths = new Set(report.entries.map((entry) => entry.path));
  for (const path of Object.values(OPERATOR_TERMINAL_REQUIRED_CHANNELS)) {
    assert.equal(paths.has(path), true, `missing ${path}`);
  }
  assert.ok(report.candidateCount >= Object.keys(OPERATOR_TERMINAL_REQUIRED_CHANNELS).length);
  assert.deepEqual(Object.keys(report.statusCounts).sort(), [...OPERATOR_TERMINAL_STATUSES].sort());
  assert.equal(report.remoteReadCount, 0);
  assert.equal(report.remoteWriteCount, 0);
  assert.equal(report.queueActionCount, 0);
  assert.equal(report.workerDeploymentCount, 0);
  assert.equal(report.production, 'BLOCKED');
});
