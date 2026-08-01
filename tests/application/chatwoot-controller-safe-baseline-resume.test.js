import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  selectChatwootControllerSafeBaselineEvidence,
} from '../../scripts/lib/chatwoot-controller-safe-baseline-resume.js';

const WRAPPER = new URL(
  '../../scripts/chatwoot-controller-safe-baseline-resume-terminal.mjs',
  import.meta.url,
);
const PINNED_WRAPPER = new URL(
  '../../scripts/chatwoot-controller-safe-baseline-pinned-origin-terminal.mjs',
  import.meta.url,
);
const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-4222-8222-222222222222';
const VERSION_C = '33333333-3333-4333-8333-333333333333';
const SESSION = 'a'.repeat(64);

function candidate(overrides = {}) {
  return {
    directory: '/outputs/chatwoot-final-30d-daily-uat/head-a',
    directoryName: 'head-a',
    sessionFingerprint: SESSION,
    baselineVersion: VERSION_A,
    activeVersion: VERSION_B,
    baseline: {
      d1Counts: { chatwoot_account_state: 1 },
      larkCounts: { rawChatwootAccounts: 1 },
    },
    modifiedAt: 100,
    ...overrides,
  };
}

test('Chatwoot safe-baseline wrapper is plan-only by default', () => {
  const result = spawnSync(process.execPath, [WRAPPER.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(plan.selectionAuthority, 'current_safe_baseline_version');
  assert.equal(plan.requiredBoundary, 'queue_retry_exhausted_terminal_v1');
  assert.equal(plan.activeWindowSource, 'retained_reviewed_active_version');
  assert.equal(
    plan.child,
    'scripts/chatwoot-controller-evidence-arbitration-terminal.mjs',
  );
  assert.equal(plan.retainedEvidenceMutation, false);
  assert.equal(plan.secondInitialAdmissionAllowed, false);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.webhookEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
  assert.equal(plan.remoteActionsPerformed, false);
});

test('Chatwoot safe-baseline pinned wrapper is plan-only by default', () => {
  const result = spawnSync(process.execPath, [PINNED_WRAPPER.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(
    plan.innerWrapper,
    'scripts/chatwoot-controller-safe-baseline-resume-terminal.mjs',
  );
  assert.equal(plan.innerOrigin, 'temporary_bare_main_pinned_to_wrapper_head');
  assert.equal(plan.retainedEvidenceMutation, false);
  assert.equal(plan.secondInitialAdmissionAllowed, false);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.webhookEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
  assert.equal(plan.remoteActionsPerformed, false);
});

test('exact duplicate safe-baseline evidence keeps the newest local copy', () => {
  const selected = selectChatwootControllerSafeBaselineEvidence([
    candidate({ directory: '/older', directoryName: 'older', modifiedAt: 100 }),
    candidate({ directory: '/newer', directoryName: 'newer', modifiedAt: 200 }),
  ], VERSION_A, []);
  assert.equal(selected.directory, '/newer');
  assert.equal(selected.candidateCount, 1);
  assert.equal(selected.selectedBy, 'current_safe_baseline_version');
});

test('current all-false baseline resolves distinct controller generations', () => {
  const selected = selectChatwootControllerSafeBaselineEvidence([
    candidate({ directory: '/current', directoryName: 'current' }),
    candidate({
      directory: '/other',
      directoryName: 'other',
      baselineVersion: VERSION_C,
      activeVersion: VERSION_A,
    }),
  ], VERSION_A, []);
  assert.equal(selected.directory, '/current');
  assert.equal(selected.baselineVersion, VERSION_A);
  assert.equal(selected.activeVersion, VERSION_B);
  assert.equal(selected.candidateCount, 2);
});

test('safe-baseline selector fails closed without one baseline match', () => {
  assert.throws(
    () => selectChatwootControllerSafeBaselineEvidence([
      candidate({ baselineVersion: VERSION_A }),
      candidate({
        directory: '/other',
        directoryName: 'other',
        baselineVersion: VERSION_B,
        activeVersion: VERSION_C,
      }),
    ], VERSION_C, []),
    (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_EVIDENCE_AMBIGUOUS'
      && error?.details?.candidateCount === 2
      && error?.details?.baselineVersionMatchCount === 0,
  );

  assert.throws(
    () => selectChatwootControllerSafeBaselineEvidence([
      candidate({ directory: '/one', directoryName: 'one' }),
      candidate({
        directory: '/two',
        directoryName: 'two',
        activeVersion: VERSION_C,
      }),
    ], VERSION_A, []),
    (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_EVIDENCE_AMBIGUOUS'
      && error?.details?.baselineVersionMatchCount === 2,
  );
});

test('safe-baseline selector rejects enabled flags and same active version', () => {
  assert.throws(
    () => selectChatwootControllerSafeBaselineEvidence([
      candidate(),
    ], VERSION_A, ['MKT_CONNECTOR_CHATWOOT_ENABLED']),
    (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_WORKER_FLAGS_INVALID',
  );
  assert.throws(
    () => selectChatwootControllerSafeBaselineEvidence([
      candidate({ activeVersion: VERSION_A }),
    ], VERSION_A, []),
    (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_EVIDENCE_INVALID',
  );
});

test('safe-baseline wrapper proves boundary before promotion and delegates existing authority', async () => {
  const source = await readFile(WRAPPER, 'utf8');
  assert.match(source, /selectChatwootControllerSafeBaselineEvidence/u);
  assert.match(source, /assertChatwootFinalUatControllerResume/u);
  assert.match(source, /buildChatwootFinalUatSnapshotSql/u);
  assert.match(source, /queue_retry_exhausted_terminal_v1/u);
  assert.match(source, /replaceActiveDeployment/u);
  assert.match(source, /wrangler', 'versions', 'deploy'/u);
  assert.match(source, /chatwoot-controller-evidence-arbitration-terminal\.mjs/u);
  assert.match(source, /ensureSafeRestore/u);
  assert.match(source, /current_safe_baseline_version/u);
  assert.match(source, /status', '--porcelain', '--untracked-files=all/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /UPDATE\s+sync_work_runs/iu);
  assert.doesNotMatch(source, /createLarkBitableClientFromEnv/u);
});

test('safe-baseline outer wrapper keeps nested origin exact', async () => {
  const source = await readFile(PINNED_WRAPPER, 'utf8');
  assert.match(source, /prepareExactPinnedGitOrigin/u);
  assert.match(source, /MKT_CHATWOOT_SAFE_BASELINE_PINNED_ORIGIN_HEAD/u);
  assert.match(source, /MKT_CHATWOOT_SAFE_BASELINE_WRAPPER_HEAD/u);
  assert.match(source, /chatwoot-controller-safe-baseline-resume-terminal\.mjs/u);
  assert.match(source, /fetch', 'origin', 'main', '--quiet'/u);
  assert.match(source, /status', '--porcelain', '--untracked-files=all/u);
  assert.doesNotMatch(source, /wrangler/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /d1', 'execute/u);
});
