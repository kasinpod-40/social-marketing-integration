import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
} from '../../scripts/lib/chatwoot-final-30d-daily-uat.js';
import {
  fingerprintChatwootFinalSourceRecovery,
} from '../../scripts/lib/chatwoot-final-source-config-recovery.js';
import {
  CHATWOOT_INITIAL_FAILURE_WORKER_SAFETY_MODES,
  classifyChatwootInitialFailureWorkerSafety,
} from '../../scripts/lib/chatwoot-initial-failure-worker-safety.js';

const INSPECTOR = new URL(
  '../../scripts/chatwoot-initial-terminal-failure-inspector.mjs',
  import.meta.url,
);
const VERSION_A = '11111111-1111-4111-8111-111111111111';
const VERSION_B = '22222222-2222-4222-8222-222222222222';

function selectionHint(versionId = VERSION_A) {
  return Object.freeze({
    activeVersionFingerprint: fingerprintChatwootFinalSourceRecovery(versionId),
  });
}

test('inspector worker safety keeps ordinary all-false behavior', () => {
  const result = classifyChatwootInitialFailureWorkerSafety({
    versionId: VERSION_A,
    trueFlags: [],
  });
  assert.equal(
    result.mode,
    CHATWOOT_INITIAL_FAILURE_WORKER_SAFETY_MODES.allFlagsFalse,
  );
  assert.equal(result.allFlagsFalse, true);
  assert.equal(result.exactActiveResumeWindow, false);
});

test('exact Chatwoot active window requires the verified handoff fingerprint', () => {
  const result = classifyChatwootInitialFailureWorkerSafety({
    versionId: VERSION_A,
    trueFlags: [...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS],
    selectionHint: selectionHint(),
  });
  assert.equal(
    result.mode,
    CHATWOOT_INITIAL_FAILURE_WORKER_SAFETY_MODES
      .exactSafeBaselineResumeActiveWindow,
  );
  assert.equal(result.allFlagsFalse, false);
  assert.equal(result.exactActiveResumeWindow, true);
  assert.deepEqual(
    result.trueFlags,
    [...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS].sort(),
  );
});

test('active Chatwoot flags remain blocked without the safe-baseline handoff', () => {
  assert.throws(
    () => classifyChatwootInitialFailureWorkerSafety({
      versionId: VERSION_A,
      trueFlags: [...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS],
    }),
    (error) => error?.code === 'CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE'
      && error?.details?.selectionHandoffPresent === false,
  );
});

test('active Chatwoot flags remain blocked when the Worker version drifts', () => {
  assert.throws(
    () => classifyChatwootInitialFailureWorkerSafety({
      versionId: VERSION_B,
      trueFlags: [...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS],
      selectionHint: selectionHint(VERSION_A),
    }),
    (error) => error?.code === 'CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE'
      && error?.details?.activeVersionFingerprintMatches === false,
  );
});

test('any additional enabled flag remains unsafe during controller resume', () => {
  assert.throws(
    () => classifyChatwootInitialFailureWorkerSafety({
      versionId: VERSION_A,
      trueFlags: [
        ...CHATWOOT_FINAL_UAT_ACTIVE_TRUE_FLAGS,
        'MKT_SCHEDULE_CHATWOOT_ENABLED',
      ],
      selectionHint: selectionHint(),
    }),
    (error) => error?.code === 'CHATWOOT_INITIAL_FAILURE_WORKER_UNSAFE'
      && error?.details?.trueFlags?.includes('MKT_SCHEDULE_CHATWOOT_ENABLED'),
  );
});

test('inspector consumes only the exact current-head safe-baseline handoff', async () => {
  const source = await readFile(INSPECTOR, 'utf8');
  assert.match(source, /chatwoot-controller-safe-baseline-resume/u);
  assert.match(source, /01-active-window\.attempt\.json/u);
  assert.match(source, /validateChatwootSafeBaselineSelectionHint/u);
  assert.match(source, /classifyChatwootInitialFailureWorkerSafety/u);
  assert.match(source, /await verifyWorkerSafety/u);
  assert.match(source, /link\.isSymbolicLink\(\)/u);
  assert.match(source, /\(info\.mode & 0o077\) !== 0/u);
  assert.doesNotMatch(source, /function verifyAllFlagsFalse/u);
});
