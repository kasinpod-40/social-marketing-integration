import assert from 'node:assert/strict';
import test from 'node:test';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
  createMetaD1OnlyEvidence,
  loadMetaD1OnlyTarget,
} from '../../scripts/lib/meta-d1-only-rollout-operator.js';
import {
  validateMetaD1OnlySummaryForLark,
} from '../../scripts/lib/meta-lark-parity-rollout-operator.js';
import {
  META_K2_EXACT_LARK_TABLE_KEYS,
  META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION,
  META_K2_PARTIAL_STAGING_FINALIZER_PHASES,
  META_K2_RETAINED_OPERATION_HEAD,
  assertMetaK2PartialStagingFinalizerConfirmation,
  buildMetaK2ExactContinuationConfig,
  compareMetaK2DirectLarkSnapshots,
  createMetaK2CanonicalD1Summary,
  createMetaK2RecoveryEvidence,
  parseMetaK2PartialStagingFinalizerArgs,
  validateMetaK2ContinuationHttpResponse,
  validateMetaK2RecoveryEvidenceSequence,
  validateMetaK2RetainedEvidence,
  validateMetaK2ReviewedRepositoryState,
} from '../../scripts/lib/meta-k2-partial-staging-finalizer.js';

const HEAD = 'b'.repeat(40);
const VERSION = '12345678-1234-4123-8123-123456789abc';
const OPERATION_ID = 'meta-chemistry_k2-history-20260701-20260731-f741090d1d8a';
const WORK_KEY = `meta_ads:chemistry_k2:${OPERATION_ID}`;
const SYNC_RUN_ID = `meta:meta_ads:chemistry_k2:${OPERATION_ID}`;
const ORIGINAL_REQUESTED_AT = Date.parse('2026-08-02T08:00:00Z');
const TOKEN_SHA256 = 'c'.repeat(64);
const ATTESTATION = 'd'.repeat(64);

function target() {
  return loadMetaD1OnlyTarget({
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_META_D1_ONLY_ACCOUNT_KEY: 'chemistry_k',
    MKT_META_D1_ONLY_TARGET: 'chemistry_k2',
    MKT_META_D1_ONLY_REPOSITORY_HEAD: HEAD,
    MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION: VERSION,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_META_D1_ONLY_READ_ONLY_SUMMARY: 'outputs/meta-read-only-validation/summary.json',
    MKT_META_D1_ONLY_OPERATION_ID: OPERATION_ID,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: String(ORIGINAL_REQUESTED_AT),
    MKT_META_D1_ONLY_PERIOD_START: '2026-07-01',
    MKT_META_D1_ONLY_PERIOD_END: '2026-07-31',
    MKT_META_D1_ONLY_WORKER_NAME: 'social-mkt-sync-worker',
    MKT_META_D1_ONLY_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_META_D1_ONLY_MAIN_QUEUE: 'social-mkt-sync-jobs',
    MKT_META_D1_ONLY_DLQ: 'social-mkt-sync-dlq',
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY:
      'RECOVER_EXACT_PARTIAL_META_ADS_STAGING',
  });
}

function safeConfig() {
  const flags = [...new Set(META_D1_ONLY_REQUIRED_FALSE_FLAGS)]
    .map((name) => `    "${name}": "false"`)
    .join(',\n');
  return `{
  "name": "social-mkt-sync-worker",
  "main": "./apps/sync-worker/src/index.js",
  "workers_dev": false,
  "d1_databases": [{
    "binding": "MKT_STATE_DB",
    "database_name": "social-mkt-state-dev",
    "database_id": "11111111-1111-4111-8111-111111111111"
  }],
  "queues": {
    "producers": [{"binding": "MKT_SYNC_QUEUE", "queue": "social-mkt-sync-jobs"}],
    "consumers": [
      {"queue": "social-mkt-sync-jobs", "dead_letter_queue": "social-mkt-sync-dlq"},
      {"queue": "social-mkt-sync-dlq"}
    ]
  },
  "vars": {
    "MKT_ENV": "development",
    "MKT_CUSTOMER_PROFILE": "integration_workspace",
    "MKT_CONNECTION_CUSTOMER_KEY": "chemistry_k",
    "META_GRAPH_API_VERSION": "v25.0",
    "META_FACEBOOK_PAGE_ID": "111111111111111",
    "META_INSTAGRAM_ACCOUNT_ID": "222222222222222",
    "META_AD_ACCOUNT_MAPPINGS": "chemistry_k2=333333333333333,chemistry_k3=444444444444444",
${flags}
  }
}`;
}

function retainedEvidence() {
  const retainedTarget = {
    ...target(),
    repositoryHead: META_K2_RETAINED_OPERATION_HEAD,
    targetFingerprint: 'a'.repeat(64),
  };
  const send = createMetaD1OnlyEvidence({
    phase: 'send-one-d1-only',
    repositoryHead: retainedTarget.repositoryHead,
    targetFingerprint: retainedTarget.targetFingerprint,
    targetKey: 'chemistry_k2',
    operationId: OPERATION_ID,
    previousEvidenceSha256: '1'.repeat(64),
    data: {
      accepted: true,
      queueSendCommandCount: 1,
      automaticResend: false,
      workKey: WORK_KEY,
    },
    remoteMutationPerformed: true,
    providerRequestMode: 'GET_only',
    businessWritesAllowed: true,
  });
  const restore = createMetaD1OnlyEvidence({
    phase: 'restore-all-false',
    repositoryHead: retainedTarget.repositoryHead,
    targetFingerprint: retainedTarget.targetFingerprint,
    targetKey: 'chemistry_k2',
    operationId: OPERATION_ID,
    previousEvidenceSha256: send.evidenceSha256,
    data: { mode: 'safe', deploymentVersionId: VERSION },
    remoteMutationPerformed: true,
  });
  const verifyRestore = createMetaD1OnlyEvidence({
    phase: 'verify-restore',
    repositoryHead: retainedTarget.repositoryHead,
    targetFingerprint: retainedTarget.targetFingerprint,
    targetKey: 'chemistry_k2',
    operationId: OPERATION_ID,
    previousEvidenceSha256: restore.evidenceSha256,
    data: { mode: 'safe', activeVersion: VERSION, expectedTrueFlags: [] },
  });
  return {
    sendAttempt: {
      operationId: OPERATION_ID,
      workKey: WORK_KEY,
      generation: ORIGINAL_REQUESTED_AT,
    },
    send,
    restore,
    verifyRestore,
  };
}

function d1BoundarySnapshot() {
  return {
    syncRunStatus: 'success',
    syncRunStartedAt: 1,
    syncRunFinishedAt: 2,
    syncRunErrorCode: null,
    syncRunUpdatedAt: 2,
    workStatus: 'active',
    workLifecycleStatus: 'active',
    workCompletedAt: null,
    d1PhaseComplete: true,
    preflightPhaseComplete: false,
    preflightSummaries: [],
    larkPhaseComplete: false,
    larkResults: [],
    completionPhaseComplete: false,
    completionReconciliation: null,
    clearedPhaseCompletion: false,
    completionOperationId: null,
    completionConnectorKey: null,
    activeLockCount: 0,
    queueOperationAttempts: 1,
    mainQueueAttempts: 29,
    queueOperationUpdatedAt: 1,
    observedAt: 10,
    coverageRunCount: 5,
    invalidCoverageCount: 0,
    coverageEntityCount: 2748,
    targetCounts: {
      organicState: 0,
      organicObservations: 0,
      accountDaily: 0,
      adsEntities: 147,
      adsDaily: 2601,
    },
  };
}

function completedLarkSnapshot(observedAt = 20) {
  const larkResults = META_K2_EXACT_LARK_TABLE_KEYS.map((tableKey) => ({
    tableKey,
    expected: 1,
    created: 1,
    updated: 0,
    skipped: 0,
  }));
  const completion = {
    schemaVersion: 'meta_end_to_end_reconciliation_v1',
    operationId: OPERATION_ID,
    connectorKey: 'meta_ads',
    preflight: larkResults.map((entry) => ({
      tableKey: entry.tableKey,
      expected: entry.expected,
      create: entry.created,
      update: entry.updated,
      skipped: entry.skipped,
    })),
    d1: { expectedOperations: 2748, processedOperations: 2748 },
    lark: larkResults,
    failed: 0,
  };
  return {
    ...d1BoundarySnapshot(),
    syncRunFinishedAt: 3,
    syncRunUpdatedAt: 3,
    workStatus: 'completed',
    workLifecycleStatus: 'completed',
    workCompletedAt: 3,
    preflightPhaseComplete: true,
    preflightSummaries: completion.preflight,
    larkPhaseComplete: true,
    larkResults,
    completionPhaseComplete: true,
    completionReconciliation: completion,
    observedAt,
  };
}

test('finalizer defaults to plan and requires both exact confirmations', () => {
  assert.deepEqual(parseMetaK2PartialStagingFinalizerArgs([]), { execute: false });
  assert.deepEqual(parseMetaK2PartialStagingFinalizerArgs(['--execute']), { execute: true });
  assert.throws(
    () => parseMetaK2PartialStagingFinalizerArgs(['--target=chemistry_k3']),
    (error) => error.code === 'META_K2_PARTIAL_STAGING_FINALIZER_ARGUMENT_INVALID',
  );
  assert.equal(assertMetaK2PartialStagingFinalizerConfirmation({
    [META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION.envName]:
      META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION.value,
    MKT_META_D1_ONLY_PARTIAL_STAGING_RECOVERY:
      'RECOVER_EXACT_PARTIAL_META_ADS_STAGING',
  }), true);
  assert.throws(
    () => assertMetaK2PartialStagingFinalizerConfirmation({}),
    (error) => error.code
      === 'META_K2_PARTIAL_STAGING_FINALIZER_CONFIRMATION_REQUIRED',
  );
});

test('reviewed repository continuation is pinned to retained operation ancestry', () => {
  const accepted = validateMetaK2ReviewedRepositoryState({
    branch: 'integration/all-meta-end-to-end-completion-v1',
    repositoryHead: HEAD,
    reviewedHead: HEAD,
    originReviewedHead: HEAD,
    retainedHead: META_K2_RETAINED_OPERATION_HEAD,
    retainedHeadIsAncestor: true,
    reviewBaseIsAncestor: true,
    clean: true,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.continuedExactOperationAcrossReviewedHead, true);
  assert.throws(
    () => validateMetaK2ReviewedRepositoryState({
      branch: 'main',
      repositoryHead: HEAD,
      reviewedHead: HEAD,
      originReviewedHead: HEAD,
      retainedHead: META_K2_RETAINED_OPERATION_HEAD,
      retainedHeadIsAncestor: true,
      reviewBaseIsAncestor: true,
      clean: true,
    }),
    (error) => error.code === 'META_K2_PARTIAL_STAGING_REPOSITORY_INVALID',
  );
});

test('retained Queue acceptance and all-false evidence are hash-bound', () => {
  const retained = retainedEvidence();
  const accepted = validateMetaK2RetainedEvidence(retained);
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.queueSendCommandCount, 1);
  assert.equal(accepted.automaticResend, false);
  assert.equal(accepted.retainedEvidenceSha256, retained.verifyRestore.evidenceSha256);
  assert.throws(
    () => validateMetaK2RetainedEvidence({
      ...retained,
      send: { ...retained.send, data: { ...retained.send.data, queueSendCommandCount: 2 } },
    }),
    (error) => error.code === 'META_K2_RETAINED_EVIDENCE_INVALID',
  );
});

test('generated D1 continuation config keeps safe all-false and binds exact operation', () => {
  const config = buildMetaK2ExactContinuationConfig(safeConfig(), target(), {
    phase: 'd1',
    tokenSha256: TOKEN_SHA256,
    attestation: ATTESTATION,
  });
  assert.deepEqual(config.activeTrueFlags, [
    'MKT_CONNECTOR_META_ADS_ENABLED',
    'MKT_META_D1_WRITE_ENABLED',
    'MKT_META_SOURCE_READ_ENABLED',
  ]);
  assert.equal(config.safeText.includes(TOKEN_SHA256), false);
  assert.equal(config.safeText.includes(OPERATION_ID), false);
  assert.match(config.activeText, /MKT_META_K2_EXACT_CONTINUATION_PHASE"?:\s*"d1"/u);
  assert.match(config.activeText, new RegExp(OPERATION_ID, 'u'));
  assert.match(config.activeText, /MKT_META_D1_ONLY_MAIN_QUEUE_ATTEMPTS"?:\s*"29"/u);
});

test('generated Lark continuation config enables only exact Meta and Lark gates', () => {
  const config = buildMetaK2ExactContinuationConfig(safeConfig(), target(), {
    phase: 'lark',
    tokenSha256: TOKEN_SHA256,
    attestation: ATTESTATION,
  });
  assert.deepEqual(config.activeTrueFlags, [
    'MKT_CONNECTOR_META_ADS_ENABLED',
    'MKT_META_D1_WRITE_ENABLED',
    'MKT_META_LARK_WRITE_ENABLED',
    'MKT_META_SOURCE_READ_ENABLED',
  ]);
  assert.match(config.activeText, /MKT_META_K2_EXACT_CONTINUATION_PHASE"?:\s*"lark"/u);
  assert.doesNotMatch(config.activeText, /MKT_META_REPORT_READ_ENABLED"?:\s*"true"/u);
});

test('HTTP continuation response proves direct invocation and zero Queue mutation', () => {
  const accepted = validateMetaK2ContinuationHttpResponse({
    ok: true,
    stage: 'meta-exact-operation-continuation',
    phase: 'd1',
    target: 'chemistry_k2',
    operationId: OPERATION_ID,
    workKey: WORK_KEY,
    syncRunId: SYNC_RUN_ID,
    status: 'd1_continuation',
    continuationSuppressed: true,
    directUseCaseInvocationCount: 1,
    queueMessageCount: 0,
    queueOperationAttemptMutationCount: 0,
    d1WriteEnabled: true,
    larkWriteEnabled: false,
    scheduleEnabled: false,
    production: false,
  }, { phase: 'd1' });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.queueMessageCount, 0);
  assert.throws(
    () => validateMetaK2ContinuationHttpResponse({
      ...accepted,
      ok: true,
      stage: 'meta-exact-operation-continuation',
      target: 'chemistry_k2',
      operationId: OPERATION_ID,
      workKey: WORK_KEY,
      syncRunId: SYNC_RUN_ID,
      directUseCaseInvocationCount: 1,
      queueMessageCount: 1,
      queueOperationAttemptMutationCount: 0,
      d1WriteEnabled: true,
      larkWriteEnabled: false,
      scheduleEnabled: false,
      production: false,
    }, { phase: 'd1' }),
    (error) => error.code === 'META_K2_PARTIAL_STAGING_HTTP_RESPONSE_INVALID',
  );
});

test('direct Lark continuation is exact four-table scope with no D1, Coverage or Queue drift', () => {
  const before = d1BoundarySnapshot();
  const after = completedLarkSnapshot();
  const accepted = compareMetaK2DirectLarkSnapshots(before, after, {
    connectorKey: 'meta_ads',
    operationId: OPERATION_ID,
  });
  assert.equal(accepted.accepted, true);
  assert.equal(accepted.queueAttemptsUnchanged, true);
  assert.equal(accepted.d1CountDrift, false);
  assert.deepEqual(accepted.larkTableKeys, META_K2_EXACT_LARK_TABLE_KEYS);

  assert.throws(
    () => compareMetaK2DirectLarkSnapshots(before, {
      ...after,
      mainQueueAttempts: 30,
    }, { connectorKey: 'meta_ads', operationId: OPERATION_ID }),
    (error) => error.code === 'META_K2_DIRECT_LARK_QUEUE_DRIFT',
  );
  assert.throws(
    () => compareMetaK2DirectLarkSnapshots(before, {
      ...after,
      larkResults: [
        ...after.larkResults,
        { tableKey: 'mktAdsDaily', expected: 0, created: 0, updated: 0, skipped: 0 },
      ],
    }, { connectorKey: 'meta_ads', operationId: OPERATION_ID }),
    (error) => ['META_K2_DIRECT_LARK_INCOMPLETE', 'META_K2_DIRECT_LARK_SCOPE_INVALID']
      .includes(error.code),
  );
});

test('recovery evidence starts from retained verify-restore and produces accepted canonical D1 summary', () => {
  const retained = validateMetaK2RetainedEvidence(retainedEvidence());
  const phases = META_K2_PARTIAL_STAGING_FINALIZER_PHASES.slice(0, -1);
  const evidence = [];
  let previousEvidenceSha256 = retained.retainedEvidenceSha256;
  for (const phase of phases) {
    const item = createMetaK2RecoveryEvidence({
      phase,
      repositoryHead: HEAD,
      previousEvidenceSha256,
      data: { phase, queueMessageCount: 0 },
    });
    evidence.push(item);
    previousEvidenceSha256 = item.evidenceSha256;
  }
  const chain = validateMetaK2RecoveryEvidenceSequence(
    evidence,
    retained.retainedEvidenceSha256,
  );
  assert.equal(chain.accepted, true);
  assert.equal(chain.retainedAnchorSha256, retained.retainedEvidenceSha256);

  const currentTarget = target();
  const summary = createMetaK2CanonicalD1Summary({
    target: currentTarget,
    recovery: chain,
  });
  const acceptedForLark = validateMetaD1OnlySummaryForLark(summary, {
    targetKey: 'chemistry_k2',
    operationId: OPERATION_ID,
  });
  assert.equal(summary.data.accepted, true);
  assert.equal(summary.data.queueSendCommandCount, 0);
  assert.equal(summary.data.queueAttemptsUnchanged, true);
  assert.equal(summary.data.retainedEvidenceSha256, retained.retainedEvidenceSha256);
  assert.equal(acceptedForLark.operationId, OPERATION_ID);
});
