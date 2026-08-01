import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  readChatwootExecutionFlags,
  selectChatwootControllerEvidence,
} from '../../scripts/lib/chatwoot-controller-evidence-arbitration.js';

const WRAPPER = new URL(
  '../../scripts/chatwoot-controller-evidence-arbitration-terminal.mjs',
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

test('Chatwoot evidence arbitration is plan-only by default', () => {
  const result = spawnSync(process.execPath, [WRAPPER.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(plan.selectionAuthority, 'current_active_worker_version');
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

test('wrapper keeps evidence immutable and delegates through an isolated exact-main clone', async () => {
  const source = await readFile(WRAPPER, 'utf8');
  assert.match(source, /selectChatwootControllerEvidence/u);
  assert.match(source, /current_active_worker_version/u);
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
