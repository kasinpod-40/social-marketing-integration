import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_D1_ONLY_OPERATOR_CONTRACT_VERSION,
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
  META_D1_ONLY_REQUIRED_TABLES,
  assertMetaD1OnlyConfirmation,
  buildMetaD1OnlyConfigWindow,
  buildMetaD1OnlyJob,
  buildMetaD1OnlySchemaSql,
  buildMetaD1OnlySnapshotSql,
  classifyMetaD1OnlyCompletion,
  compareMetaD1OnlySnapshots,
  createMetaD1OnlyEvidence,
  loadMetaD1OnlyTarget,
  parseMetaD1OnlyOperatorArgs,
  validateMetaD1OnlyContinuationRepositoryState,
  validateMetaD1OnlyEvidenceSequence,
  validateMetaD1OnlyReusableRestoreSequence,
  validateMetaD1OnlyTerminalRecoveryBaseline,
  validateMetaReadOnlySummary,
} from '../../scripts/lib/meta-d1-only-rollout-operator.js';

const SHA = 'a'.repeat(40);
const VERSION = '12345678-1234-4123-8123-123456789abc';
const SUMMARY_FINGERPRINT = 'b'.repeat(64);

test('Meta D1-only operator defaults to plan and rejects unknown phases', () => {
  assert.deepEqual(parseMetaD1OnlyOperatorArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseMetaD1OnlyOperatorArgs(['--phase=preflight', '--execute']),
    { phase: 'preflight', execute: true },
  );
  assert.throws(
    () => parseMetaD1OnlyOperatorArgs(['--phase=unknown']),
    (error) => error.code === 'META_D1_ONLY_OPERATOR_PHASE_INVALID',
  );
  assert.throws(
    () => parseMetaD1OnlyOperatorArgs(['--execute']),
    (error) => error.code === 'META_D1_ONLY_OPERATOR_PLAN_EXECUTE_INVALID',
  );
});

test('every executable phase requires its exact confirmation', () => {
  assert.throws(
    () => assertMetaD1OnlyConfirmation('preflight', {}),
    (error) => error.code === 'META_D1_ONLY_OPERATOR_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertMetaD1OnlyConfirmation('preflight', {
    CONFIRM_META_D1_ONLY_PREFLIGHT: 'PREFLIGHT_META_D1_ONLY_ROLLOUT',
  }), true);
  assert.equal(assertMetaD1OnlyConfirmation('plan', {}), true);
});

test('cross-head continuation is limited to evidence-closeout phases and operator-only diffs', () => {
  const operatorHead = 'c'.repeat(40);
  const env = {
    MKT_META_D1_ONLY_CONTINUATION_FROM_HEAD: SHA,
    MKT_META_D1_ONLY_CONTINUATION_OPERATOR_HEAD: operatorHead,
  };
  const accepted = validateMetaD1OnlyContinuationRepositoryState({
    phase: 'verify-idempotent-rerun',
    targetRepositoryHead: SHA,
    operatorRepositoryHead: operatorHead,
    clean: true,
    targetIsAncestor: true,
    changedPaths: [
      'scripts/lib/meta-d1-only-rollout-operator.js',
      'scripts/meta-d1-only-rollout-operator.mjs',
      'tests/application/meta-d1-only-rollout-operator.test.js',
    ],
  }, env);
  assert.equal(accepted.continuedAcrossRepositoryHead, true);
  assert.equal(accepted.changedPathCount, 3);

  assert.throws(
    () => validateMetaD1OnlyContinuationRepositoryState({
      phase: 'verify-idempotent-rerun',
      targetRepositoryHead: SHA,
      operatorRepositoryHead: operatorHead,
      clean: true,
      targetIsAncestor: true,
      changedPaths: ['apps/sync-worker/src/index.js'],
    }, env),
    (error) => error.code === 'META_D1_ONLY_CONTINUATION_REPOSITORY_INVALID',
  );
  assert.throws(
    () => validateMetaD1OnlyContinuationRepositoryState({
      phase: 'send-one-d1-only',
      targetRepositoryHead: SHA,
      operatorRepositoryHead: operatorHead,
      clean: true,
      targetIsAncestor: true,
      changedPaths: ['scripts/meta-d1-only-rollout-operator.mjs'],
    }, env),
    (error) => error.code === 'META_D1_ONLY_CONTINUATION_REPOSITORY_INVALID',
  );
});

test('reusable restore requires the complete prior chain and a verified all-false version', () => {
  const current = target('facebook');
  const phases = [
    'plan',
    'preflight',
    'backup',
    'deploy-safe-baseline',
    'verify-safe-baseline',
    'deploy-d1-only-gates',
    'verify-d1-only-deployment',
    'snapshot-before',
    'send-one-d1-only',
    'verify-d1-only',
    'resend-same-operation',
    'restore-all-false',
    'verify-restore',
  ];
  const build = (expectedTrueFlags = []) => {
    let previous = null;
    return phases.map((phase) => {
      const data = phase === 'restore-all-false'
        ? { mode: 'safe', deploymentVersionId: VERSION }
        : phase === 'verify-restore'
          ? { mode: 'safe', activeVersion: VERSION, expectedTrueFlags }
          : {};
      const evidence = createMetaD1OnlyEvidence({
        phase,
        capturedAt: '2026-07-28T00:00:00Z',
        repositoryHead: current.repositoryHead,
        targetFingerprint: current.targetFingerprint,
        targetKey: current.targetKey,
        operationId: current.operationId,
        previousEvidenceSha256: previous?.evidenceSha256 ?? null,
        data,
      });
      previous = evidence;
      return evidence;
    });
  };
  const accepted = validateMetaD1OnlyReusableRestoreSequence(build(), current);
  assert.equal(accepted.deploymentVersionId, VERSION);
  assert.throws(
    () => validateMetaD1OnlyReusableRestoreSequence(build(['MKT_META_D1_WRITE_ENABLED']), current),
    (error) => error.code === 'META_D1_ONLY_REUSABLE_RESTORE_INVALID',
  );
});

test('target loader creates exact stable identities for all four scopes', () => {
  const facebook = target('facebook');
  assert.equal(facebook.connectorKey, 'facebook');
  assert.equal(facebook.workKey, 'facebook:meta-d1-facebook');
  assert.equal(facebook.syncRunId, 'meta:facebook:facebook:meta-d1-facebook');
  assert.equal(facebook.requiredSecretName, 'META_FACEBOOK_PAGE_ACCESS_TOKEN');

  const instagram = target('instagram');
  assert.equal(instagram.workKey, 'instagram:meta-d1-instagram');
  assert.equal(instagram.requiredSecretName, 'META_INSTAGRAM_ACCESS_TOKEN');

  const k2 = target('chemistry_k2');
  assert.equal(k2.connectorKey, 'meta_ads');
  assert.equal(k2.sourceAccountKey, 'chemistry_k2');
  assert.equal(k2.workKey, 'meta_ads:chemistry_k2:meta-d1-chemistry_k2');
  assert.equal(k2.syncRunId, 'meta:meta_ads:chemistry_k2:meta-d1-chemistry_k2');

  const k3 = target('chemistry_k3');
  assert.equal(k3.workKey, 'meta_ads:chemistry_k3:meta-d1-chemistry_k3');
  assert.notEqual(k2.targetFingerprint, k3.targetFingerprint);

  const recovery = loadMetaD1OnlyTarget({
    ...targetEnv('instagram'),
    MKT_META_D1_ONLY_TERMINAL_RECOVERY: 'RECOVER_EXACT_FAILED_META_OPERATION',
  });
  assert.equal(recovery.terminalRecovery, true);
  assert.notEqual(recovery.targetFingerprint, instagram.targetFingerprint);
});

test('target loader rejects profile, target and date drift', () => {
  assert.throws(
    () => loadMetaD1OnlyTarget({ ...targetEnv('facebook'), MKT_CUSTOMER_PROFILE: 'chemistry_k' }),
    (error) => error.code === 'META_D1_ONLY_TARGET_INVALID',
  );
  assert.throws(
    () => loadMetaD1OnlyTarget({ ...targetEnv('facebook'), MKT_META_D1_ONLY_TARGET: 'other' }),
    (error) => error.code === 'META_D1_ONLY_TARGET_INVALID',
  );
  assert.throws(
    () => loadMetaD1OnlyTarget({
      ...targetEnv('facebook'),
      MKT_META_D1_ONLY_PERIOD_START: '2026-07-27',
      MKT_META_D1_ONLY_PERIOD_END: '2026-07-01',
    }),
    (error) => error.code === 'META_D1_ONLY_PERIOD_INVALID',
  );
});

test('read-only summary must prove all four accepted provider validations', () => {
  const result = validateMetaReadOnlySummary(readOnlySummary(), target('facebook'));
  assert.equal(result.validationCount, 4);
  assert.equal(result.targetFingerprint, SUMMARY_FINGERPRINT);
  assert.equal(result.nextGate, 'separate_d1_only_approval');

  const invalid = structuredClone(readOnlySummary());
  invalid.details.validations[2].status = 'failed';
  assert.throws(
    () => validateMetaReadOnlySummary(invalid, target('facebook')),
    (error) => error.code === 'META_D1_ONLY_READ_ONLY_SUMMARY_INVALID',
  );
});

test('config window changes exactly the selected connector, source-read and D1 gates', () => {
  const current = target('chemistry_k2');
  const result = buildMetaD1OnlyConfigWindow(safeConfig(), current);
  assert.deepEqual(result.safeTrueFlags, []);
  assert.deepEqual(result.activeTrueFlags, [
    'MKT_CONNECTOR_META_ADS_ENABLED',
    'MKT_META_D1_WRITE_ENABLED',
    'MKT_META_SOURCE_READ_ENABLED',
  ]);
  assert.match(result.activeText, /"MKT_CONNECTOR_META_ADS_ENABLED": "true"/u);
  assert.match(result.activeText, /"MKT_META_SOURCE_READ_ENABLED": "true"/u);
  assert.match(result.activeText, /"MKT_META_D1_WRITE_ENABLED": "true"/u);
  assert.match(result.activeText, /"MKT_META_LARK_WRITE_ENABLED": "false"/u);
  assert.match(result.activeText, /"MKT_META_REPORT_READ_ENABLED": "false"/u);
});

test('safe config rejects any pre-existing enabled execution flag', () => {
  const unsafe = safeConfig().replace(
    '"MKT_CONNECTOR_YOUTUBE_ENABLED": "false"',
    '"MKT_CONNECTOR_YOUTUBE_ENABLED": "true"',
  );
  assert.throws(
    () => buildMetaD1OnlyConfigWindow(unsafe, target('facebook')),
    (error) => error.code === 'META_D1_ONLY_SAFE_CONFIG_NOT_CLOSED',
  );
});

test('safe config rejects a target whose source identity mapping is missing', () => {
  const missingFacebook = safeConfig().replace(
    '    "META_FACEBOOK_PAGE_ID": "111111111111111",\n',
    '',
  );
  assert.throws(
    () => buildMetaD1OnlyConfigWindow(missingFacebook, target('facebook')),
    (error) => error.code === 'META_D1_ONLY_SOURCE_MAPPING_INVALID',
  );

  const missingAdsAlias = safeConfig().replace(
    'chemistry_k2=333333333333333,chemistry_k3=444444444444444',
    'chemistry_k3=444444444444444',
  );
  assert.throws(
    () => buildMetaD1OnlyConfigWindow(missingAdsAlias, target('chemistry_k2')),
    (error) => error.code === 'META_D1_ONLY_SOURCE_MAPPING_INVALID',
  );
});

test('job builder uses central stable operation contract and D1-only manual UAT body', () => {
  const facebook = buildMetaD1OnlyJob(target('facebook'));
  assert.equal(facebook.type, 'facebook.page.organic.sync');
  assert.equal(facebook.trigger, 'manual_uat');
  assert.equal(facebook.d1Only, true);
  assert.equal(facebook.dryRun, false);
  assert.equal(facebook.workKey, 'facebook:meta-d1-facebook');
  assert.equal(facebook.generation, facebook.originalRequestedAt);
  assert.equal(facebook.sourceAccountKey, undefined);

  const ads = buildMetaD1OnlyJob(target('chemistry_k2'));
  assert.equal(ads.type, 'meta.ads.sync');
  assert.equal(ads.sourceAccountKey, 'chemistry_k2');
  assert.equal(ads.workKey, 'meta_ads:chemistry_k2:meta-d1-chemistry_k2');
});

test('schema and snapshot SQL are scoped and contain no Lark write path', () => {
  const schemaSql = buildMetaD1OnlySchemaSql();
  for (const table of META_D1_ONLY_REQUIRED_TABLES) assert.match(schemaSql, new RegExp(table, 'u'));

  const snapshotSql = buildMetaD1OnlySnapshotSql(target('chemistry_k3'));
  assert.match(snapshotSql, /meta_end_to_end_d1_write_v1/u);
  assert.match(snapshotSql, /meta_end_to_end_lark_write_v1/u);
  assert.match(snapshotSql, /meta_end_to_end_completion_v1/u);
  assert.match(snapshotSql, /invalid_coverage_count/u);
  assert.match(snapshotSql, /meta:meta_ads:chemistry_k3:meta-d1-chemistry_k3/u);
});

test('completion requires D1, Coverage, no Lark phase and an active unfinished work boundary', () => {
  const accepted = completeSnapshot();
  const result = classifyMetaD1OnlyCompletion(accepted);
  assert.equal(result.complete, true);
  assert.equal(result.reason, 'd1_complete_lark_gate_disabled');

  assert.equal(classifyMetaD1OnlyCompletion({
    ...accepted,
    lark_phase_count: 1,
  }).complete, false);
  assert.equal(classifyMetaD1OnlyCompletion({
    ...accepted,
    invalid_coverage_count: 1,
  }).complete, false);
  assert.equal(classifyMetaD1OnlyCompletion({
    ...accepted,
    work_lifecycle_status: 'completed',
    work_completed_at: 123,
  }).complete, false);
});

test('initial verification accepts scoped D1 growth and rejects Lark or Coverage drift', () => {
  const before = emptySnapshot();
  const after = completeSnapshot();
  const compared = compareMetaD1OnlySnapshots(before, after);
  assert.equal(compared.accepted, true);
  assert.equal(compared.rerun, false);
  assert.equal(compared.targetCountDelta.organicState, 2);
  assert.equal(compared.coverageRunCount, 2);

  assert.throws(
    () => compareMetaD1OnlySnapshots(before, { ...after, lark_phase_count: 1 }),
    (error) => error.code === 'META_D1_ONLY_LARK_BOUNDARY_VIOLATED',
  );
  assert.throws(
    () => compareMetaD1OnlySnapshots(before, { ...after, invalid_coverage_count: 1 }),
    (error) => error.code === 'META_D1_ONLY_COVERAGE_INVALID',
  );
});

test('terminal recovery requires the exact failed pre-D1 boundary and a new main Queue attempt', () => {
  const before = {
    ...emptySnapshot(),
    sync_run_status: 'failed',
    sync_run_error_code: 'META_PERMANENT_API_ERROR',
    work_status: 'active',
    work_lifecycle_status: 'active',
    queue_operation_attempts: 1,
    main_queue_attempts: 3,
  };
  assert.equal(validateMetaD1OnlyTerminalRecoveryBaseline(before).accepted, true);
  assert.equal(validateMetaD1OnlyTerminalRecoveryBaseline({
    ...before,
    sync_run_error_code: 'UNHANDLED_SYNC_ERROR',
  }).accepted, true);
  assert.equal(validateMetaD1OnlyTerminalRecoveryBaseline({
    ...before,
    sync_run_error_code: 'MKT_ORGANIC_HISTORY_INPUT_INVALID',
  }).accepted, true);

  const after = { ...completeSnapshot(), main_queue_attempts: 4 };
  const compared = compareMetaD1OnlySnapshots(before, after, { terminalRecovery: true });
  assert.equal(compared.accepted, true);
  assert.throws(
    () => compareMetaD1OnlySnapshots(before, {
      ...after,
      main_queue_attempts: 3,
    }, { terminalRecovery: true }),
    (error) => error.code === 'META_D1_ONLY_RECOVERY_ATTEMPT_MISSING',
  );
  assert.throws(
    () => validateMetaD1OnlyTerminalRecoveryBaseline({
      ...before,
      target_organic_state_count: 1,
      operation_organic_state_count: 1,
    }),
    (error) => error.code === 'META_D1_ONLY_TERMINAL_RECOVERY_BASELINE_INVALID',
  );
});

test('same-operation rerun requires a new Queue attempt with zero Business and Coverage drift', () => {
  const before = completeSnapshot();
  const after = {
    ...completeSnapshot(),
    queue_operation_attempts: 1,
    main_queue_attempts: 2,
  };
  const compared = compareMetaD1OnlySnapshots(before, after, { rerun: true });
  assert.equal(compared.accepted, true);
  assert.equal(compared.businessCountDrift, false);
  assert.equal(compared.coverageCountDrift, false);

  assert.throws(
    () => compareMetaD1OnlySnapshots(before, {
      ...after,
      target_organic_state_count: 3,
    }, { rerun: true }),
    (error) => error.code === 'META_D1_ONLY_RERUN_COUNT_DRIFT',
  );
  assert.throws(
    () => compareMetaD1OnlySnapshots(before, {
      ...after,
      coverage_run_count: 3,
    }, { rerun: true }),
    (error) => error.code === 'META_D1_ONLY_RERUN_COVERAGE_DRIFT',
  );
});

test('evidence chain is hash-bound and rejects tampering', () => {
  const current = target('facebook');
  const plan = createMetaD1OnlyEvidence({
    phase: 'plan',
    capturedAt: '2026-07-27T00:00:00Z',
    repositoryHead: current.repositoryHead,
    targetFingerprint: current.targetFingerprint,
    targetKey: current.targetKey,
    operationId: current.operationId,
    data: { planOnly: true },
  });
  const preflight = createMetaD1OnlyEvidence({
    phase: 'preflight',
    capturedAt: '2026-07-27T00:01:00Z',
    repositoryHead: current.repositoryHead,
    targetFingerprint: current.targetFingerprint,
    targetKey: current.targetKey,
    operationId: current.operationId,
    previousEvidenceSha256: plan.evidenceSha256,
    data: { providerRequests: 0 },
  });
  assert.equal(
    validateMetaD1OnlyEvidenceSequence([plan, preflight], current).length,
    2,
  );

  const tampered = { ...preflight, data: { providerRequests: 1 } };
  assert.throws(
    () => validateMetaD1OnlyEvidenceSequence([plan, tampered], current),
    (error) => error.code === 'META_D1_ONLY_EVIDENCE_HASH_INVALID',
  );
});

test('evidence output strips secret-shaped fields and never enables Lark or schedules', () => {
  const current = target('instagram');
  const evidence = createMetaD1OnlyEvidence({
    phase: 'preflight',
    capturedAt: '2026-07-27T00:00:00Z',
    repositoryHead: current.repositoryHead,
    targetFingerprint: current.targetFingerprint,
    targetKey: current.targetKey,
    operationId: current.operationId,
    data: {
      secretValue: 'must-not-survive',
      authorizationHeader: 'must-not-survive',
      safe: 'retained',
    },
  });
  assert.equal(evidence.contractVersion, META_D1_ONLY_OPERATOR_CONTRACT_VERSION);
  assert.equal(evidence.data.secretValue, undefined);
  assert.equal(evidence.data.authorizationHeader, undefined);
  assert.equal(evidence.data.safe, 'retained');
  assert.equal(evidence.larkWritesAllowed, false);
  assert.equal(evidence.scheduleActivationAllowed, false);
  assert.equal(evidence.productionAllowed, false);
});

function target(targetKey) {
  return loadMetaD1OnlyTarget(targetEnv(targetKey));
}

function targetEnv(targetKey) {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_META_D1_ONLY_ACCOUNT_KEY: 'chemistry_k',
    MKT_META_D1_ONLY_TARGET: targetKey,
    MKT_META_D1_ONLY_REPOSITORY_HEAD: SHA,
    MKT_META_D1_ONLY_EXPECTED_ACTIVE_VERSION: VERSION,
    MKT_META_D1_ONLY_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_META_D1_ONLY_READ_ONLY_SUMMARY: 'outputs/meta-read-only-validation/summary.json',
    MKT_META_D1_ONLY_OPERATION_ID: `meta-d1-${targetKey}`,
    MKT_META_D1_ONLY_ORIGINAL_REQUESTED_AT: '2026-07-27T00:00:00Z',
    MKT_META_D1_ONLY_PERIOD_START: '2026-07-01',
    MKT_META_D1_ONLY_PERIOD_END: '2026-07-26',
    MKT_META_D1_ONLY_WORKER_NAME: 'social-mkt-sync-worker',
    MKT_META_D1_ONLY_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_META_D1_ONLY_MAIN_QUEUE: 'social-mkt-sync-jobs',
    MKT_META_D1_ONLY_DLQ: 'social-mkt-sync-dlq',
  };
}

function readOnlySummary() {
  return {
    phase: 'summary',
    status: 'passed',
    contractVersion: 'meta_read_only_validation_v1',
    targetFingerprint: SUMMARY_FINGERPRINT,
    target: {
      environment: 'development',
      customerProfile: 'integration_workspace',
      customerKey: 'chemistry_k',
      executionFlagsEnabled: false,
      schedulesEnabled: false,
    },
    details: {
      accepted: true,
      validationCount: 4,
      nextGate: 'separate_d1_only_approval',
      validations: [
        {
          phase: 'facebook',
          connectorKey: 'facebook',
          sourceAccountKey: null,
          status: 'identity_validated',
          requestAttempts: 2,
        },
        {
          phase: 'instagram',
          connectorKey: 'instagram',
          sourceAccountKey: null,
          status: 'identity_validated',
          requestAttempts: 1,
        },
        {
          phase: 'meta-ads-chemistry-k2',
          connectorKey: 'meta_ads',
          sourceAccountKey: 'chemistry_k2',
          status: 'identity_validated',
          requestAttempts: 2,
        },
        {
          phase: 'meta-ads-chemistry-k3',
          connectorKey: 'meta_ads',
          sourceAccountKey: 'chemistry_k3',
          status: 'identity_validated',
          requestAttempts: 2,
        },
      ],
    },
    mutationPerformed: false,
    businessWrites: 0,
    queueMessages: 0,
  };
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

function emptySnapshot() {
  return {
    sync_run_status: null,
    sync_run_finished_at: null,
    sync_run_error_code: null,
    work_status: null,
    work_lifecycle_status: null,
    work_completed_at: null,
    d1_phase_complete: 0,
    d1_state_json: null,
    lark_phase_count: 0,
    completion_phase_count: 0,
    active_lock_count: 0,
    queue_operation_attempts: 0,
    main_queue_attempts: 0,
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

function completeSnapshot() {
  return {
    ...emptySnapshot(),
    sync_run_status: 'success',
    sync_run_finished_at: 1785081600000,
    work_status: 'active',
    work_lifecycle_status: 'active',
    d1_phase_complete: 1,
    d1_state_json: JSON.stringify({
      organicHistoryDone: true,
      nextIndex: 2,
      counts: { written: 2 },
    }),
    queue_operation_attempts: 1,
    main_queue_attempts: 1,
    coverage_run_count: 2,
    coverage_entity_count: 2,
    target_organic_state_count: 2,
    target_organic_observation_count: 2,
    target_account_daily_count: 1,
    operation_organic_state_count: 2,
    operation_organic_observation_count: 2,
    operation_account_daily_count: 1,
  };
}
