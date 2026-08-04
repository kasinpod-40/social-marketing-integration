import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_K3_RECOVERY_RESUME_PROFILES,
  META_K3_RECOVERY_RESUME_TRANSIENT_DIRECTORIES,
  identifyMetaK3RecoveryResumeProfile,
} from '../../scripts/lib/meta-k3-recovery-resume-boundary.js';

const exactSafeRestoredFiles = Object.freeze([
  'backup.json',
  'deploy-d1-continuation.json',
  'meta-k3-before-recovery.sql',
  'read-only-stability.json',
  'restore-after-d1.json',
  'retained-evidence-admission.json',
  'verify-d1-continuation.json',
  'verify-restore-after-d1.json',
]);

test('K3 resume inventory accepts the exact retained safe-restored footprint', () => {
  const expectedProfile = 'post_d1_preview_http_404_safe_restored';

  assert.deepEqual(
    META_K3_RECOVERY_RESUME_PROFILES[expectedProfile],
    exactSafeRestoredFiles,
  );
  assert.equal(
    identifyMetaK3RecoveryResumeProfile(exactSafeRestoredFiles, []),
    expectedProfile,
  );
  assert.equal(
    META_K3_RECOVERY_RESUME_PROFILES[expectedProfile]
      .includes('meta-k2-before-recovery.sql'),
    false,
  );
});

test('K3 resume inventory accepts only the exact Wrangler transient cache directory', () => {
  const expectedProfile = 'post_d1_preview_http_404_safe_restored';

  assert.deepEqual(META_K3_RECOVERY_RESUME_TRANSIENT_DIRECTORIES, ['.wrangler']);
  assert.equal(
    identifyMetaK3RecoveryResumeProfile(exactSafeRestoredFiles, ['.wrangler']),
    expectedProfile,
  );

  assert.throws(
    () => identifyMetaK3RecoveryResumeProfile(exactSafeRestoredFiles, ['unexpected-cache']),
    {
      code: 'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
      message: 'K3 recovery resume root contains unsupported directories',
    },
  );
});

test('K3 resume inventory still rejects evidence file drift when Wrangler cache is present', () => {
  const observedFiles = [
    ...exactSafeRestoredFiles,
    'unexpected-evidence.json',
  ];

  assert.throws(
    () => identifyMetaK3RecoveryResumeProfile(observedFiles, ['.wrangler']),
    {
      code: 'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
      message: 'K3 recovery evidence does not match an accepted safe resume profile',
    },
  );
});

test('K3 resume inventory rejects the obsolete K2 backup filename', () => {
  const obsoleteFiles = exactSafeRestoredFiles.map((name) => (
    name === 'meta-k3-before-recovery.sql'
      ? 'meta-k2-before-recovery.sql'
      : name
  ));

  assert.throws(
    () => identifyMetaK3RecoveryResumeProfile(obsoleteFiles, []),
    {
      code: 'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
      message: 'K3 recovery evidence does not match an accepted safe resume profile',
    },
  );
});
