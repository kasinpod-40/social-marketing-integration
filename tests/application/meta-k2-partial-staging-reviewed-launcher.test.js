import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import {
  META_K2_EXACT_RECOVERY_PATH,
  META_K2_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE,
} from '../../packages/config/src/meta-k2-exact-recovery-contract.js';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from '../../scripts/lib/meta-d1-only-rollout-operator.js';
import {
  createMetaK2RecoveryEvidence,
} from '../../scripts/lib/meta-k2-partial-staging-finalizer.js';
import {
  META_K2_POST_ACTIVATION_FAILURE_FILES,
  META_K2_POST_ACTIVATION_RETRY_CONFIRMATION,
  META_K2_PREACTIVATION_FAILURE_FILES,
  META_K2_PREACTIVATION_RETRY_CONFIRMATION,
  injectMetaK2ReviewedRuntimeConfig,
  injectMetaK2ReviewedSourceMappings,
  resolveMetaK2ExactRecoveryUrl,
  validateMetaK2PostActivationRetry,
  validateMetaK2PreactivationRetry,
  validateMetaK2SafeRouteProbe,
} from '../../scripts/lib/meta-k2-partial-staging-reviewed-launcher.js';

const OBSERVED_AT = 1785649200000;
const ACTIVE_VERSION = '11111111-1111-4111-8111-111111111111';
const SAFE_VERSION = '22222222-2222-4222-8222-222222222222';

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

test('derives one Worker origin from the exact Google Ads and YouTube callbacks', () => {
  assert.equal(
    resolveMetaK2ExactRecoveryUrl({
      googleAdsRedirectUri:
        'https://worker.example.test/oauth/google-ads/callback',
      youtubeRedirectUri:
        'https://worker.example.test/oauth/youtube/callback',
    }),
    `https://worker.example.test${META_K2_EXACT_RECOVERY_PATH}`,
  );
});

test('accepts an explicit exact URL only when every available origin authority agrees', () => {
  const explicitUrl = `https://worker.example.test${META_K2_EXACT_RECOVERY_PATH}`;
  assert.equal(
    resolveMetaK2ExactRecoveryUrl({
      explicitUrl,
      publicOrigin: 'https://worker.example.test',
      googleAdsRedirectUri:
        'https://worker.example.test/oauth/google-ads/callback',
    }),
    explicitUrl,
  );
  assert.throws(
    () => resolveMetaK2ExactRecoveryUrl({
      explicitUrl: `https://wrong.example.test${META_K2_EXACT_RECOVERY_PATH}`,
      googleAdsRedirectUri:
        'https://worker.example.test/oauth/google-ads/callback',
    }),
    (error) => error.code
      === 'META_K2_REVIEWED_LAUNCHER_RECOVERY_ORIGIN_CONFLICT',
  );
});

test('rejects missing origin authority or invalid callback paths', () => {
  assert.throws(
    () => resolveMetaK2ExactRecoveryUrl({}),
    (error) => error.code
      === 'META_K2_REVIEWED_LAUNCHER_RECOVERY_ORIGIN_REQUIRED',
  );
  for (const googleAdsRedirectUri of [
    'http://worker.example.test/oauth/google-ads/callback',
    'https://worker.example.test/oauth/google-ads/wrong',
    'https://worker.example.test/oauth/google-ads/callback?query=1',
  ]) {
    assert.throws(
      () => resolveMetaK2ExactRecoveryUrl({ googleAdsRedirectUri }),
      (error) => error.code
        === 'META_K2_REVIEWED_LAUNCHER_REDIRECT_URI_INVALID',
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

test('safe route probe accepts only the exact all-false recovery handler response', () => {
  const result = validateMetaK2SafeRouteProbe({
    status: 400,
    redirected: false,
    body: {
      ok: false,
      stage: 'meta-exact-operation-continuation',
      phase: null,
      code: 'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID',
      directUseCaseInvocationCount: 0,
      queueMessageCount: 0,
      queueOperationAttemptMutationCount: 0,
      larkWriteEnabled: false,
      scheduleEnabled: false,
      production: false,
    },
  });
  assert.equal(result.accepted, true);
  assert.equal(result.remoteMutationCount, 0);
  assert.match(result.routeResponseFingerprint, /^[0-9a-f]{64}$/u);

  assert.throws(
    () => validateMetaK2SafeRouteProbe({
      status: 404,
      redirected: false,
      body: { ok: false, error: 'Route not found' },
    }),
    (error) => error.code
      === 'META_K2_REVIEWED_LAUNCHER_SAFE_ROUTE_PROBE_INVALID',
  );
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

test('materializes the complete all-false safe baseline instead of failing one flag at a time', () => {
  const result = injectMetaK2ReviewedRuntimeConfig(
    '{\n  "vars": {\n    "MKT_ENV": "development",\n    "MKT_CONNECTOR_META_ADS_ENABLED": true,\n    "MKT_WOOCOMMERCE_D1_WRITE_ENABLED": true\n  },\n  "env": {\n    "development": {\n      "vars": {\n        "MKT_CONNECTOR_META_ADS_ENABLED": true\n      }\n    }\n  }\n}\n',
    {
      META_GRAPH_API_VERSION: 'v23.0',
      META_AD_ACCOUNT_MAPPINGS: 'chemistry_k2=act_123,chemistry_k3=act_456',
      META_ACCESS_TOKEN: 'must-not-be-materialized',
    },
  );
  assert.equal(result.allFalseFlagCount, META_D1_ONLY_REQUIRED_FALSE_FLAGS.length);
  assert.match(result.allFalseFlagFingerprint, /^[0-9a-f]{64}$/u);
  assert.doesNotMatch(result.configText, /must-not-be-materialized/u);
  for (const flag of META_D1_ONLY_REQUIRED_FALSE_FLAGS) {
    const matches = [...result.configText.matchAll(new RegExp(
      `["']?${escapeRegex(flag)}["']?\\s*:\\s*(true|false)`,
      'gu',
    ))];
    assert.ok(matches.length > 0, flag);
    assert.ok(matches.every((match) => match[1] === 'false'), flag);
  }
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
  const evidence = createPreactivationEvidence();
  const env = {
    [META_K2_PREACTIVATION_RETRY_CONFIRMATION.envName]:
      META_K2_PREACTIVATION_RETRY_CONFIRMATION.value,
  };
  const result = validateMetaK2PreactivationRetry({
    fileNames: META_K2_PREACTIVATION_FAILURE_FILES,
    ...evidence,
  }, env);
  assert.equal(result.accepted, true);
  assert.equal(result.retryClass, 'preactivation_no_mutation');
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.activeDeploymentCount, 0);
  assert.equal(result.directUseCaseInvocationCount, 0);
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

test('accepts the exact post-activation no-Business footprint after verified safe restore', () => {
  const evidence = createPostActivationEvidence();
  const safeRouteProbe = validateMetaK2SafeRouteProbe({
    status: 400,
    redirected: false,
    body: {
      ok: false,
      stage: 'meta-exact-operation-continuation',
      phase: null,
      code: 'META_PARTIAL_STAGING_RECOVERY_CONFIG_INVALID',
      directUseCaseInvocationCount: 0,
      queueMessageCount: 0,
      queueOperationAttemptMutationCount: 0,
      larkWriteEnabled: false,
      scheduleEnabled: false,
      production: false,
    },
  });
  const result = validateMetaK2PostActivationRetry({
    fileNames: META_K2_POST_ACTIVATION_FAILURE_FILES,
    ...evidence,
    currentSnapshot: currentExactPartialSnapshot(),
    currentActiveTrueFlags: [],
    safeRouteProbe,
  }, {
    [META_K2_POST_ACTIVATION_RETRY_CONFIRMATION.envName]:
      META_K2_POST_ACTIVATION_RETRY_CONFIRMATION.value,
  });
  assert.equal(result.accepted, true);
  assert.equal(
    result.retryClass,
    'postactivation_no_business_after_verified_restore',
  );
  assert.equal(result.activeDeploymentCount, 1);
  assert.equal(result.safeRestoreDeploymentCount, 1);
  assert.equal(result.continuationHttpAttemptCount, 1);
  assert.equal(result.directUseCaseInvocationCount, 0);
  assert.equal(result.d1BusinessWriteCount, 0);
  assert.equal(result.coverageWriteCount, 0);
  assert.equal(result.queueMessageCount, 0);
});

test('blocks post-activation retry when Worker flags or exact D1 checkpoint drift', () => {
  const evidence = createPostActivationEvidence();
  const safeRouteProbe = {
    accepted: true,
    directUseCaseInvocationCount: 0,
    queueMessageCount: 0,
  };
  const env = {
    [META_K2_POST_ACTIVATION_RETRY_CONFIRMATION.envName]:
      META_K2_POST_ACTIVATION_RETRY_CONFIRMATION.value,
  };
  assert.throws(
    () => validateMetaK2PostActivationRetry({
      fileNames: META_K2_POST_ACTIVATION_FAILURE_FILES,
      ...evidence,
      currentSnapshot: currentExactPartialSnapshot(),
      currentActiveTrueFlags: ['MKT_META_D1_WRITE_ENABLED'],
      safeRouteProbe,
    }, env),
    (error) => error.code
      === 'META_K2_REVIEWED_LAUNCHER_POST_ACTIVATION_RETRY_INVALID',
  );
  assert.throws(
    () => validateMetaK2PostActivationRetry({
      fileNames: META_K2_POST_ACTIVATION_FAILURE_FILES,
      ...evidence,
      currentSnapshot: {
        ...currentExactPartialSnapshot(),
        main_queue_attempts: 30,
      },
      currentActiveTrueFlags: [],
      safeRouteProbe,
    }, env),
    (error) => [
      'META_K2_PARTIAL_STAGING_EXACT_STATE_INVALID',
      'META_D1_ONLY_PARTIAL_STAGING_PROGRESS_OBSERVED',
    ].includes(error.code),
  );
});

function createPreactivationEvidence() {
  const repositoryHead = 'b'.repeat(40);
  const retainedAnchor = 'a'.repeat(64);
  const backupBytes = Buffer.from('exact remote D1 backup');
  const backupFile = backupPath();
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
      stability: {
        accepted: true,
        snapshot: exactPartialSnapshot(),
      },
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
  return {
    retainedEvidence,
    stabilityEvidence,
    backupEvidence,
    backupBytes,
    expectedBackupFile: backupFile,
  };
}

function createPostActivationEvidence() {
  const repositoryHead = 'b'.repeat(40);
  const preactivation = createPreactivationEvidence();
  const expectedD1Flags = [...META_K2_EXACT_RECOVERY_TRUE_FLAGS_BY_PHASE.d1].sort();
  const deployEvidence = createMetaK2RecoveryEvidence({
    phase: 'deploy-d1-continuation',
    repositoryHead,
    previousEvidenceSha256: preactivation.backupEvidence.evidenceSha256,
    data: {
      activeVersion: ACTIVE_VERSION,
      repositoryHead,
      commandExitCode: 0,
      configSha256: 'c'.repeat(64),
      trueFlags: expectedD1Flags,
      queueMessageCount: 0,
    },
  });
  const verifyDeployEvidence = createMetaK2RecoveryEvidence({
    phase: 'verify-d1-continuation',
    repositoryHead,
    previousEvidenceSha256: deployEvidence.evidenceSha256,
    data: {
      activeVersion: ACTIVE_VERSION,
      expectedTrueFlags: expectedD1Flags,
      routeAttestation: 'd'.repeat(64),
      queueMessageCount: 0,
    },
  });
  const restoreEvidence = createMetaK2RecoveryEvidence({
    phase: 'restore-after-d1',
    repositoryHead,
    previousEvidenceSha256: verifyDeployEvidence.evidenceSha256,
    data: {
      activeVersion: SAFE_VERSION,
      repositoryHead,
      commandExitCode: 0,
      mode: 'safe',
      expectedTrueFlags: [],
    },
  });
  const verifyRestoreEvidence = createMetaK2RecoveryEvidence({
    phase: 'verify-restore-after-d1',
    repositoryHead,
    previousEvidenceSha256: restoreEvidence.evidenceSha256,
    data: {
      activeVersion: SAFE_VERSION,
      mode: 'safe',
      expectedTrueFlags: [],
      executionFlagsAllFalse: true,
    },
  });
  return {
    ...preactivation,
    deployEvidence,
    verifyDeployEvidence,
    restoreEvidence,
    verifyRestoreEvidence,
  };
}

function currentExactPartialSnapshot() {
  return {
    ...exactPartialSnapshot(),
    observed_at: OBSERVED_AT + 120_000,
  };
}

function exactPartialSnapshot(observedAt = OBSERVED_AT) {
  return {
    sync_run_status: 'success',
    sync_run_started_at: observedAt - (35 * 60 * 1000),
    sync_run_finished_at: observedAt - (20 * 60 * 1000),
    sync_run_error_code: null,
    sync_run_records_written: 0,
    sync_run_updated_at: observedAt - (20 * 60 * 1000),
    work_status: 'active',
    work_lifecycle_status: 'active',
    work_completed_at: null,
    d1_phase_complete: 0,
    d1_state_json: null,
    d1_phase_updated_at: null,
    source_staging_complete: 0,
    source_staging_updated_at: observedAt - (20 * 60 * 1000),
    source_staging_stage: 'daily',
    source_staging_unit_count: 27,
    source_staging_row_count: 2601,
    source_staging_page_number: 27,
    source_staging_content_index: 0,
    lark_phase_count: 0,
    completion_phase_count: 0,
    active_lock_count: 0,
    queue_operation_attempts: 1,
    main_queue_attempts: 29,
    queue_operation_updated_at: observedAt - (16 * 60 * 1000),
    observed_at: observedAt,
    coverage_run_count: 0,
    invalid_coverage_count: 0,
    coverage_entity_count: 0,
    target_organic_state_count: 0,
    target_organic_observation_count: 0,
    target_account_daily_count: 0,
    target_ads_entity_count: 0,
    target_ads_daily_count: 0,
    operation_organic_state_count: 0,
    operation_organic_observation_count: 0,
    operation_account_daily_count: 0,
    operation_ads_entity_count: 0,
    operation_ads_daily_count: 0,
  };
}

function backupPath() {
  return 'outputs/meta-d1-only-rollout/chemistry_k2/meta-chemistry_k2-history-20260701-20260731-f741090d1d8a/exact-partial-staging-recovery-v1/meta-k2-before-recovery.sql';
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
}
