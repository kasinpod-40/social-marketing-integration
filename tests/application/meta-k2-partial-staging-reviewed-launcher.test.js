import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  META_K2_EXACT_RECOVERY_PATH,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import {
  createMetaK2RecoveryEvidence,
} from '../../scripts/lib/meta-k2-partial-staging-finalizer.js';
import {
  META_K2_PREACTIVATION_FAILURE_FILES,
  META_K2_PREACTIVATION_RETRY_CONFIRMATION,
  injectMetaK2ReviewedSourceMappings,
  resolveMetaK2ExactRecoveryUrl,
  validateMetaK2PreactivationRetry,
} from '../../scripts/lib/meta-k2-partial-staging-reviewed-launcher.js';

test('derives the exact recovery URL from the existing HTTPS public origin', () => {
  assert.equal(
    resolveMetaK2ExactRecoveryUrl({
      publicOrigin: 'https://worker.example.test',
    }),
    `https://worker.example.test${META_K2_EXACT_RECOVERY_PATH}`,
  );
  assert.equal(
    resolveMetaK2ExactRecoveryUrl({
      publicOrigin: 'https://worker.example.test/',
    }),
    `https://worker.example.test${META_K2_EXACT_RECOVERY_PATH}`,
  );
});

test('accepts an exact explicit recovery URL and gives it precedence over public origin', () => {
  const explicitUrl = `https://reviewed-worker.example.test${META_K2_EXACT_RECOVERY_PATH}`;
  assert.equal(
    resolveMetaK2ExactRecoveryUrl({
      explicitUrl,
      publicOrigin: 'https://ignored.example.test',
    }),
    explicitUrl,
  );
});

test('rejects missing, non-HTTPS or non-origin public origin values', () => {
  for (const publicOrigin of [
    undefined,
    '',
    'http://worker.example.test',
    'https://worker.example.test/base',
    'https://worker.example.test/?query=1',
    'https://worker.example.test/#fragment',
  ]) {
    assert.throws(
      () => resolveMetaK2ExactRecoveryUrl({ publicOrigin }),
      (error) => [
        'META_K2_REVIEWED_LAUNCHER_INPUT_INVALID',
        'META_K2_REVIEWED_LAUNCHER_PUBLIC_ORIGIN_INVALID',
      ].includes(error.code),
      String(publicOrigin),
    );
  }
});

test('rejects explicit URL protocol, path, query and fragment drift', () => {
  for (const explicitUrl of [
    `http://worker.example.test${META_K2_EXACT_RECOVERY_PATH}`,
    'https://worker.example.test/operator/meta/other-recovery',
    `https://worker.example.test${META_K2_EXACT_RECOVERY_PATH}?mode=d1`,
    `https://worker.example.test${META_K2_EXACT_RECOVERY_PATH}#fragment`,
  ]) {
    assert.throws(
      () => resolveMetaK2ExactRecoveryUrl({ explicitUrl }),
      (error) => error.code === 'META_K2_REVIEWED_LAUNCHER_RECOVERY_URL_INVALID',
      explicitUrl,
    );
  }
});

test('materializes only the reviewed non-secret Meta source mappings', () => {
  const result = injectMetaK2ReviewedSourceMappings(
    '{\n  "vars": {\n    "MKT_ENV": "development"\n  }\n}\n',
    {
      META_GRAPH_API_VERSION: 'v23.0',
      META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=act_123,chemistry_k3=act_456',
      META_ACCESS_TOKEN: 'must-not-be-materialized',
    },
  );
  assert.deepEqual(result.materializedKeys, [
    'META_GRAPH_API_VERSION',
    'META_AD_ACCOUNT_MAPPINGS',
  ]);
  assert.match(result.configText, /"META_GRAPH_API_VERSION": "v23\.0"/u);
  assert.match(result.configText, /"META_AD_ACCOUNT_MAPPINGS": "chemistry_k2=act_123,chemistry_k3=act_456"/u);
  assert.doesNotMatch(result.configText, /must-not-be-materialized/u);
  assert.match(result.sourceMappingFingerprint, /^[0-9a-f]{64}$/u);
});

test('rejects an unpinned version or a mapping without chemistry_k2', () => {
  const config = '{ "vars": {} }';
  assert.throws(
    () => injectMetaK2ReviewedSourceMappings(config, {
      META_GRAPH_API_VERSION: 'latest',
      META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=act_123',
    }),
    (error) => error.code === 'META_K2_REVIEWED_LAUNCHER_SOURCE_MAPPING_INVALID'
      && error.details.fieldName === 'META_GRAPH_API_VERSION',
  );
  assert.throws(
    () => injectMetaK2ReviewedSourceMappings(config, {
      META_GRAPH_API_VERSION: 'v23.0',
      META_AD_ACCOUNT_MAPPINGS: 'chemistry_k3=act_456',
    }),
    (error) => error.code === 'META_K2_REVIEWED_LAUNCHER_SOURCE_MAPPING_INVALID'
      && error.details.fieldName === 'META_AD_ACCOUNT_MAPPINGS',
  );
});

test('accepts only the exact no-mutation preactivation retry footprint', () => {
  const repositoryHead = 'b'.repeat(40);
  const retainedAnchor = 'a'.repeat(64);
  const backupBytes = Buffer.from('exact remote D1 backup');
  const backupFile = 'outputs/meta-d1-only-rollout/chemistry_k2/meta-chemistry_k2-history-20260701-20260731-f741090d1d8a/exact-partial-staging-recovery-v1/meta-k2-before-recovery.sql';
  const retainedEvidence = createMetaK2RecoveryEvidence({
    phase: 'retained-evidence-admission',
    repositoryHead,
    previousEvidenceSha256: retainedAnchor,
    data: {
      queueMessageCount: 0,
      lifecycleSqlRepairCount: 0,
    },
  });
  const stabilityEvidence = createMetaK2RecoveryEvidence({
    phase: 'read-only-stability',
    repositoryHead,
    previousEvidenceSha256: retainedEvidence.evidenceSha256,
    data: {
      executionFlagsAllFalse: true,
    },
  });
  const backupEvidence = createMetaK2RecoveryEvidence({
    phase: 'backup',
    repositoryHead,
    previousEvidenceSha256: stabilityEvidence.evidenceSha256,
    data: {
      backupFile,
      backupBytes: backupBytes.length,
      backupSha256: sha256(backupBytes),
      remoteMutationCount: 0,
    },
  });
  const env = {
    [META_K2_PREACTIVATION_RETRY_CONFIRMATION.envName]:
      META_K2_PREACTIVATION_RETRY_CONFIRMATION.value,
  };
  const result = validateMetaK2PreactivationRetry({
    fileNames: META_K2_PREACTIVATION_FAILURE_FILES,
    retainedEvidence,
    stabilityEvidence,
    backupEvidence,
    backupBytes,
    expectedBackupFile: backupFile,
  }, env);
  assert.equal(result.accepted, true);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.activeDeploymentCount, 0);
  assert.equal(result.continuationCallCount, 0);
  assert.equal(result.queueMessageCount, 0);
});

test('blocks preactivation retry without exact confirmation or with an extra file', () => {
  const baseInput = {
    fileNames: [...META_K2_PREACTIVATION_FAILURE_FILES, 'wrangler.meta-k2-d1.active.jsonc'],
  };
  assert.throws(
    () => validateMetaK2PreactivationRetry(baseInput, {}),
    (error) => error.code
      === 'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_CONFIRMATION_REQUIRED',
  );
  assert.throws(
    () => validateMetaK2PreactivationRetry(baseInput, {
      [META_K2_PREACTIVATION_RETRY_CONFIRMATION.envName]:
        META_K2_PREACTIVATION_RETRY_CONFIRMATION.value,
    }),
    (error) => error.code === 'META_K2_REVIEWED_LAUNCHER_PREACTIVATION_RETRY_INVALID',
  );
});

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}
