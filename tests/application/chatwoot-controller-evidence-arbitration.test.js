import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  readChatwootExecutionFlags,
  selectChatwootControllerEvidence,
  validateChatwootSafeBaselineSelectionHint,
} from '../../scripts/lib/chatwoot-controller-evidence-arbitration.js';

const WRAPPER = new URL(
  '../../scripts/chatwoot-controller-evidence-arbitration-terminal.mjs',
  import.meta.url,
);
const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-4222-8222-222222222222';
const VERSION_C = '33333333-3333-4333-8333-333333333333';
const SESSION = 'a'.repeat(64);
const OTHER_SESSION = 'b'.repeat(64);
const HEAD = 'c'.repeat(40);

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

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

function handoff(overrides = {}) {
  return {
    contractVersion: 'chatwoot_controller_safe_baseline_resume_v1',
    repositoryHead: HEAD,
    retainedSessionFingerprint: SESSION,
    baselineVersionFingerprint: sha256(VERSION_A),
    retainedActiveVersionFingerprint: sha256(VERSION_B),
    controllerBoundary: 'queue_retry_exhausted_terminal_v1',
    candidateCount: 2,
    selectedBy: 'current_safe_baseline_version',
    secondInitialAdmission: false,
    queueAction: false,
    d1Mutation: false,
    larkMutation: false,
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
    ...overrides,
  };
}

test('Chatwoot evidence arbitration is plan-only by default', () => {
  const result = spawnSync(process.execPath, [WRAPPER.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(
    plan.selectionAuthority,
    'current_active_worker_version_or_verified_safe_baseline_handoff',
  );
  assert.equal(
    plan.child,
    'scripts/chatwoot-initial-terminal-failure-recovery-launcher.mjs',
  );
  assert.equal(plan.retainedEvidenceMutation, false);
  assert.equal(plan.secondInitialAdmissionAllowed, false);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.webhookEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
  assert.equal(plan.remoteActionsPerformed, false);
});

test('exact duplicate controller evidence keeps the newest local copy', () => {
  const selected = selectChatwootControllerEvidence([
    candidate({ directory: '/older', directoryName: 'older', modifiedAt: 100 }),
    candidate({ directory: '/newer', directoryName: 'newer', modifiedAt: 200 }),
  ], VERSION_B);
  assert.equal(selected.directory, '/newer');
  assert.equal(selected.candidateCount, 1);
  assert.equal(selected.selectedBy, 'current_active_worker_version');
});

test('current active Worker version resolves distinct controller generations', () => {
  const selected = selectChatwootControllerEvidence([
    candidate({ directory: '/old', directoryName: 'old', activeVersion: VERSION_A }),
    candidate({ directory: '/current', directoryName: 'current', activeVersion: VERSION_B }),
  ], VERSION_B);
  assert.equal(selected.directory, '/current');
  assert.equal(selected.activeVersion, VERSION_B);
  assert.equal(selected.candidateCount, 2);
});

test('verified safe-baseline handoff resolves shared active Worker version', () => {
  const selectionHint = validateChatwootSafeBaselineSelectionHint(handoff(), HEAD);
  const selected = selectChatwootControllerEvidence([
    candidate({ directory: '/selected', directoryName: 'selected' }),
    candidate({
      directory: '/other',
      directoryName: 'other',
      sessionFingerprint: OTHER_SESSION,
      baselineVersion: VERSION_C,
    }),
  ], VERSION_B, selectionHint);
  assert.equal(selected.directory, '/selected');
  assert.equal(selected.sessionFingerprint, SESSION);
  assert.equal(
    selected.selectedBy,
    'verified_safe_baseline_handoff_and_current_active_worker_version',
  );
  assert.equal(selected.candidateCount, 2);
});

test('safe-baseline handoff remains fail closed when identity does not match', () => {
  const selectionHint = validateChatwootSafeBaselineSelectionHint(handoff(), HEAD);
  assert.throws(
    () => selectChatwootControllerEvidence([
      candidate({
        sessionFingerprint: OTHER_SESSION,
        baselineVersion: VERSION_C,
      }),
    ], VERSION_B, selectionHint),
    (error) => error?.code === 'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_AMBIGUOUS'
      && error?.details?.activeVersionMatchCount === 1
      && error?.details?.selectionHandoffMatchCount === 0,
  );
});

test('safe-baseline handoff validator requires exact non-mutating parent contract', () => {
  const selected = validateChatwootSafeBaselineSelectionHint(handoff(), HEAD);
  assert.equal(selected.repositoryHead, HEAD);
  assert.equal(selected.sessionFingerprint, SESSION);
  assert.equal(selected.baselineVersionFingerprint, sha256(VERSION_A));
  assert.equal(selected.activeVersionFingerprint, sha256(VERSION_B));

  assert.throws(
    () => validateChatwootSafeBaselineSelectionHint(
      handoff({ queueAction: true }),
      HEAD,
    ),
    (error) => error?.code === 'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_INVALID',
  );
  assert.throws(
    () => validateChatwootSafeBaselineSelectionHint(handoff(), 'not-a-head'),
    (error) => error?.code === 'CHATWOOT_CONTROLLER_EVIDENCE_SELECTION_HANDOFF_INVALID',
  );
});

test('controller evidence remains fail closed without one active-version match', () => {
  assert.throws(
    () => selectChatwootControllerEvidence([
      candidate({ activeVersion: VERSION_A }),
      candidate({
        directory: '/other',
        directoryName: 'other',
        activeVersion: VERSION_B,
        baselineVersion: VERSION_C,
      }),
    ], VERSION_C),
    (error) => error?.code === 'CHATWOOT_CONTROLLER_EVIDENCE_ACTIVE_VERSION_AMBIGUOUS'
      && error?.details?.candidateCount === 2
      && error?.details?.activeVersionMatchCount === 0,
  );

  assert.throws(
    () => selectChatwootControllerEvidence([
      candidate({ directory: '/one', directoryName: 'one' }),
      candidate({
        directory: '/two',
        directoryName: 'two',
        baselineVersion: VERSION_C,
      }),
    ], VERSION_B),
    (error) => error?.code === 'CHATWOOT_CONTROLLER_EVIDENCE_ACTIVE_VERSION_AMBIGUOUS'
      && error?.details?.activeVersionMatchCount === 2,
  );
});

test('execution flag reader recognizes only enabled MKT gates', () => {
  assert.deepEqual(readChatwootExecutionFlags({
    bindings: [
      { name: 'MKT_CONNECTOR_CHATWOOT_ENABLED', text: 'true' },
      { name: 'MKT_CHATWOOT_D1_WRITE_ENABLED', value: true },
      { name: 'MKT_CHATWOOT_LARK_WRITE_ENABLED', text: 'true' },
      { name: 'MKT_CHATWOOT_REPORT_WRITE_ENABLED', text: 'true' },
      { name: 'MKT_SCHEDULE_CHATWOOT_ENABLED', text: 'false' },
      { name: 'CHATWOOT_API_ACCESS_TOKEN', text: 'true' },
    ],
  }), [
    'MKT_CHATWOOT_D1_WRITE_ENABLED',
    'MKT_CHATWOOT_LARK_WRITE_ENABLED',
    'MKT_CHATWOOT_REPORT_WRITE_ENABLED',
    'MKT_CONNECTOR_CHATWOOT_ENABLED',
  ]);
});

test('wrapper verifies parent handoff and delegates one isolated evidence identity', async () => {
  const source = await readFile(WRAPPER, 'utf8');
  assert.match(source, /validateChatwootSafeBaselineSelectionHint/u);
  assert.match(source, /01-active-window\.attempt\.json/u);
  assert.match(source, /read-chatwoot-safe-baseline-selection-handoff/u);
  assert.match(source, /selectionHint/u);
  assert.match(source, /current_active_worker_version_or_verified_safe_baseline_handoff/u);
  assert.match(source, /wrangler', 'deployments', 'status'/u);
  assert.match(source, /wrangler', 'versions', 'view'/u);
  assert.match(source, /clone', '--no-hardlinks', '--no-checkout'/u);
  assert.match(source, /checkout', '-B', 'main'/u);
  assert.match(source, /update-ref', 'refs\/remotes\/origin\/main'/u);
  assert.match(source, /chatwoot-initial-terminal-failure-recovery-launcher\.mjs/u);
  assert.match(source, /MKT_CHATWOOT_INITIAL_FAILURE_WRANGLER_CONFIG/u);
  assert.match(source, /CURRENT_HEAD_PRESENT/u);
  assert.match(source, /status', '--porcelain', '--untracked-files=all/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /'wrangler', 'deploy'/u);
  assert.doesNotMatch(source, /rename\(/u);
  assert.doesNotMatch(source, /unlink\(/u);
});
