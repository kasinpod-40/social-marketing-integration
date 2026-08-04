import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_K3_RECOVERY_RESUME_PROFILES,
  META_K3_RECOVERY_RESUME_TRANSIENT_DIRECTORIES,
  identifyMetaK3RecoveryResumeProfile,
} from '../../scripts/lib/meta-k3-recovery-resume-boundary.js';

test('K3 resume inventory accepts only the exact Wrangler transient cache directory', () => {
  const expectedProfile = 'post_d1_preview_http_404_safe_restored';
  const observedFiles = META_K3_RECOVERY_RESUME_PROFILES[expectedProfile];

  assert.deepEqual(META_K3_RECOVERY_RESUME_TRANSIENT_DIRECTORIES, ['.wrangler']);
  assert.equal(
    identifyMetaK3RecoveryResumeProfile(observedFiles, ['.wrangler']),
    expectedProfile,
  );

  assert.throws(
    () => identifyMetaK3RecoveryResumeProfile(observedFiles, ['unexpected-cache']),
    {
      code: 'META_K3_PRE_MUTATION_EVIDENCE_INVALID',
      message: 'K3 recovery resume root contains unsupported directories',
    },
  );
});

test('K3 resume inventory still rejects evidence file drift when Wrangler cache is present', () => {
  const expectedProfile = 'post_d1_preview_http_404_safe_restored';
  const observedFiles = [
    ...META_K3_RECOVERY_RESUME_PROFILES[expectedProfile],
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
