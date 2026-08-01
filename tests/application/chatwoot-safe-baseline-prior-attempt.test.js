import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdtemp,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  loadChatwootSafeBaselinePriorAttempt,
  validateChatwootSafeBaselinePriorAttempt,
} from '../../scripts/lib/chatwoot-safe-baseline-prior-attempt.js';

const TERMINAL = new URL(
  '../../scripts/chatwoot-safe-baseline-prior-attempt-terminal.mjs',
  import.meta.url,
);
const HEAD = 'a'.repeat(40);
const SESSION = 'b'.repeat(64);
const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-4222-8222-222222222222';
const FILES = [
  '01-active-window.attempt.json',
  '02-safe-restore.json',
];

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function attempt(overrides = {}) {
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

function restore(overrides = {}) {
  return {
    contractVersion: 'chatwoot_controller_safe_baseline_resume_v1',
    repositoryHead: HEAD,
    retainedSessionFingerprint: SESSION,
    restoredAllFlagsFalse: true,
    restoreDeployment: true,
    finalVersionFingerprint: sha256(VERSION_A),
    scheduleEnabled: false,
    webhookEnabled: false,
    production: false,
    ...overrides,
  };
}

function worker(overrides = {}) {
  return {
    activeVersion: VERSION_A,
    enabledFlags: [],
    ...overrides,
  };
}

async function writePrivateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

test('prior Chatwoot attempt validates exact attempt, restore and Worker identity', () => {
  const result = validateChatwootSafeBaselinePriorAttempt({
    priorHead: HEAD,
    entries: FILES,
    attempt: attempt(),
    restore: restore(),
    currentWorker: worker(),
  });
  assert.equal(result.accepted, true);
  assert.equal(result.priorHead, HEAD);
  assert.equal(result.currentWorkerAllFlagsFalse, true);
  assert.equal(result.fileCount, 2);
  assert.equal(result.retainedSessionFingerprint, SESSION);
});

test('real filesystem loader accepts only private regular evidence files', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatwoot-prior-attempt-'));
  try {
    await writePrivateJson(join(root, FILES[0]), attempt());
    await writePrivateJson(join(root, FILES[1]), restore());
    const result = await loadChatwootSafeBaselinePriorAttempt({
      directory: root,
      priorHead: HEAD,
      currentWorker: worker(),
    });
    assert.equal(result.accepted, true);
    assert.equal(result.restoreDeployment, true);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('prior attempt rejects summaries, extra files and symlink evidence', async () => {
  const root = await mkdtemp(join(tmpdir(), 'chatwoot-prior-attempt-invalid-'));
  try {
    await writePrivateJson(join(root, FILES[0]), attempt());
    await writePrivateJson(join(root, FILES[1]), restore());
    await writePrivateJson(join(root, '03-summary.json'), { ok: true });
    await assert.rejects(
      loadChatwootSafeBaselinePriorAttempt({
        directory: root,
        priorHead: HEAD,
        currentWorker: worker(),
      }),
      (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_FILE_SET_INVALID',
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }

  const symlinkRoot = await mkdtemp(join(tmpdir(), 'chatwoot-prior-attempt-link-'));
  const sourceRoot = await mkdtemp(join(tmpdir(), 'chatwoot-prior-attempt-source-'));
  try {
    await writePrivateJson(join(sourceRoot, FILES[0]), attempt());
    await symlink(join(sourceRoot, FILES[0]), join(symlinkRoot, FILES[0]), 'file');
    await writePrivateJson(join(symlinkRoot, FILES[1]), restore());
    await assert.rejects(
      loadChatwootSafeBaselinePriorAttempt({
        directory: symlinkRoot,
        priorHead: HEAD,
        currentWorker: worker(),
      }),
      (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_PRIOR_ATTEMPT_INVALID',
    );
  } finally {
    await rm(symlinkRoot, { recursive: true, force: true });
    await rm(sourceRoot, { recursive: true, force: true });
  }
});

test('prior attempt remains blocked for Worker flags, version drift or restore drift', () => {
  assert.throws(
    () => validateChatwootSafeBaselinePriorAttempt({
      priorHead: HEAD,
      entries: FILES,
      attempt: attempt(),
      restore: restore(),
      currentWorker: worker({ enabledFlags: ['MKT_CONNECTOR_CHATWOOT_ENABLED'] }),
    }),
    (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_PRIOR_WORKER_UNSAFE',
  );
  assert.throws(
    () => validateChatwootSafeBaselinePriorAttempt({
      priorHead: HEAD,
      entries: FILES,
      attempt: attempt(),
      restore: restore(),
      currentWorker: worker({ activeVersion: VERSION_B }),
    }),
    (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_PRIOR_WORKER_DRIFT',
  );
  assert.throws(
    () => validateChatwootSafeBaselinePriorAttempt({
      priorHead: HEAD,
      entries: FILES,
      attempt: attempt(),
      restore: restore({ restoredAllFlagsFalse: false }),
      currentWorker: worker(),
    }),
    (error) => error?.code === 'CHATWOOT_SAFE_BASELINE_PRIOR_RESTORE_INVALID',
  );
});

test('prior-attempt terminal is plan-only and delegates without mutation authority', async () => {
  const result = spawnSync(process.execPath, [TERMINAL.pathname], {
    cwd: process.cwd(),
    encoding: 'utf8',
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.planOnly, true);
  assert.equal(plan.priorAttemptSummaryAllowed, false);
  assert.equal(plan.currentHeadEvidenceGuard, 'required_before_child');
  assert.equal(plan.secondInitialAdmissionAllowed, false);
  assert.equal(plan.remoteActionsPerformed, false);

  const source = await readFile(TERMINAL, 'utf8');
  assert.match(source, /loadChatwootSafeBaselinePriorAttempt/u);
  assert.match(source, /assertChatwootSafeBaselineCurrentHeadClear/u);
  assert.match(source, /chatwoot-controller-safe-baseline-exact-terminal\.mjs/u);
  assert.match(source, /wrangler', 'deployments', 'status'/u);
  assert.match(source, /wrangler', 'versions', 'view'/u);
  assert.doesNotMatch(source, /'wrangler', 'versions', 'deploy'/u);
  assert.doesNotMatch(source, /'wrangler', 'd1', 'execute'/u);
  assert.doesNotMatch(source, /queues\/.+\/messages/u);
  assert.doesNotMatch(source, /rename\(/u);
  assert.doesNotMatch(source, /unlink\(/u);
});
