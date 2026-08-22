import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_LARK_OPERATOR_CONTRACT_VERSION,
  META_LARK_OPERATOR_PHASES,
  assertMetaLarkConfirmation,
  buildMetaLarkConfigWindow,
  buildMetaLarkContinuationJob,
  buildMetaLarkSnapshotSql,
  classifyMetaLarkCompletion,
  classifyMetaLarkPostCompletionOrphan,
  classifyMetaLarkPollingSnapshot,
  compareMetaLarkSnapshots,
  createMetaLarkEvidence,
  expectedLarkContracts,
  loadMetaLarkTarget,
  normalizeMetaLarkSnapshot,
  parseMetaLarkOperatorArgs,
  validateMetaD1OnlySummaryForLark,
  validateMetaLarkCompletedStability,
  validateMetaLarkD1ReadyBoundary,
  validateMetaLarkOrphanedRunningStability,
  validateMetaLarkPostCompletionOrphanStability,
  validateMetaLarkEvidenceSequence,
  validateMetaLarkInventory,
} from '../../scripts/lib/meta-lark-parity-rollout-operator.js';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from '../../scripts/lib/meta-d1-only-rollout-operator.js';
import {
  META_ADS_JULY_ACTIVITY_LARK_TABLE_KEYS,
  META_END_TO_END_LARK_TABLES,
} from '../../packages/config/src/meta-end-to-end-runtime-config.js';

const SHA = 'a'.repeat(40);
const VERSION = '12345678-1234-4123-8123-123456789abc';
const HASH = 'b'.repeat(64);

test('Meta Lark operator is plan-only by default and requires exact confirmations', () => {
  assert.deepEqual(parseMetaLarkOperatorArgs([]), { phase: 'plan', execute: false });
  assert.deepEqual(
    parseMetaLarkOperatorArgs(['--phase=lark-preflight', '--execute']),
    { phase: 'lark-preflight', execute: true },
  );
  assert.throws(
    () => parseMetaLarkOperatorArgs(['--phase=unknown']),
    (error) => error.code === 'META_LARK_OPERATOR_PHASE_INVALID',
  );
  assert.throws(
    () => assertMetaLarkConfirmation('lark-preflight', {}),
    (error) => error.code === 'META_LARK_OPERATOR_CONFIRMATION_REQUIRED',
  );
  assert.equal(assertMetaLarkConfirmation('lark-preflight', {
    CONFIRM_META_LARK_PREFLIGHT: 'READ_ONLY_META_LARK_PREFLIGHT',
  }), true);
  assert.equal(META_LARK_OPERATOR_PHASES.includes('verify-late-completion'), true);
  assert.equal(assertMetaLarkConfirmation('verify-late-completion', {
    CONFIRM_META_LARK_VERIFY_LATE_COMPLETION:
      'VERIFY_META_LARK_LATE_COMPLETION_AFTER_RESTORE',
  }), true);
});

test('target loader preserves the exact D1 operation identity for each target', () => {
  const facebook = target('facebook');
  assert.equal(facebook.workKey, 'facebook:meta-lark-facebook');
  assert.equal(facebook.syncRunId, 'meta:facebook:facebook:meta-lark-facebook');
  assert.equal(facebook.expectedLarkTableCount, 4);

  const instagram = target('instagram');
  assert.equal(instagram.workKey, 'instagram:meta-lark-instagram');
  assert.equal(instagram.expectedLarkTableCount, 4);

  const k2 = target('chemistry_k2');
  assert.equal(k2.workKey, 'meta_ads:chemistry_k2:meta-lark-chemistry_k2');
  assert.equal(k2.expectedLarkTableCount, 4);

  const k3 = target('chemistry_k3');
  assert.equal(k3.workKey, 'meta_ads:chemistry_k3:meta-lark-chemistry_k3');
  assert.equal(k3.expectedLarkTableCount, 4);
  assert.notEqual(k2.targetFingerprint, k3.targetFingerprint);
});

test('active config changes only connector, Meta source, D1 and Lark gates', () => {
  const current = target('chemistry_k2');
  const result = buildMetaLarkConfigWindow(safeConfig(), current);
  assert.deepEqual(result.safeTrueFlags, []);
  assert.deepEqual(result.activeTrueFlags, [
    'MKT_CONNECTOR_META_ADS_ENABLED',
    'MKT_META_D1_WRITE_ENABLED',
    'MKT_META_LARK_WRITE_ENABLED',
    'MKT_META_SOURCE_READ_ENABLED',
  ]);
  assert.match(result.activeText, /"MKT_CONNECTOR_META_ADS_ENABLED": "true"/u);
  assert.match(result.activeText, /"MKT_META_SOURCE_READ_ENABLED": "true"/u);
  assert.match(result.activeText, /"MKT_META_D1_WRITE_ENABLED": "true"/u);
  assert.match(result.activeText, /"MKT_META_LARK_WRITE_ENABLED": "true"/u);
  assert.match(result.activeText, /"MKT_META_REPORT_READ_ENABLED": "false"/u);
});

test('continuation job reuses the same stable operation without d1Only or a provider reset', () => {
  const facebook = buildMetaLarkContinuationJob(target('facebook'));
  assert.equal(facebook.type, 'facebook.page.organic.sync');
  assert.equal(facebook.trigger, 'manual_uat');
  assert.equal(facebook.workKey, 'facebook:meta-lark-facebook');
  assert.equal(facebook.d1Only, undefined);
  assert.equal(facebook.dryRun, false);
  assert.equal(facebook.generation, facebook.originalRequestedAt);

  const ads = buildMetaLarkContinuationJob(target('chemistry_k3'));
  assert.equal(ads.type, 'meta.ads.sync');
  assert.equal(ads.sourceAccountKey, 'chemistry_k3');
  assert.equal(ads.workKey, 'meta_ads:chemistry_k3:meta-lark-chemistry_k3');
});

test('Lark inventory requires all 10 customer-facing destinations and every stable key field', () => {
  const tableIds = {};
  const remoteTables = [];
  const fieldsByKey = {};
  for (const [index, contract] of META_END_TO_END_LARK_TABLES.entries()) {
    const tableId = `tbl_${index}`;
    tableIds[contract.tableKey] = tableId;
    remoteTables.push({ tableId });
    fieldsByKey[contract.tableKey] = [{ fieldName: contract.keyField }];
  }
  const result = validateMetaLarkInventory({ tableIds, remoteTables, fieldsByKey });
  assert.equal(result.tableCount, 10);
  assert.equal(result.allTablesPresent, true);
  assert.equal(result.allStableKeyFieldsPresent, true);

  const duplicate = { ...tableIds, mktContent: tableIds.mktAccounts };
  assert.throws(
    () => validateMetaLarkInventory({ tableIds: duplicate, remoteTables, fieldsByKey }),
    (error) => error.code === 'META_LARK_PREFLIGHT_DUPLICATE_TABLE_ID',
  );

  const missingKey = structuredClone(fieldsByKey);
  missingKey.mktContent = [{ fieldName: 'wrong_key' }];
  assert.throws(
    () => validateMetaLarkInventory({ tableIds, remoteTables, fieldsByKey: missingKey }),
    (error) => error.code === 'META_LARK_PREFLIGHT_INCOMPLETE',
  );
});

test('D1 summary must prove accepted idempotent D1-only processing and all-false restore', () => {
  const current = target('facebook');
  const result = validateMetaD1OnlySummaryForLark(d1Summary(current), current);
  assert.equal(result.targetKey, 'facebook');
  assert.equal(result.operationId, current.operationId);

  const invalid = structuredClone(d1Summary(current));
  invalid.data.idempotentRerunVerified = false;
  assert.throws(
    () => validateMetaD1OnlySummaryForLark(invalid, current),
    (error) => error.code === 'META_LARK_D1_SUMMARY_INVALID',
  );
});

test('D1-ready recovery accepts only an exact failed Lark preflight boundary', () => {
  const normalTarget = target('instagram');
  const failed = {
    ...d1ReadySnapshot(),
    sync_run_status: 'failed',
    sync_run_finished_at: 123,
    sync_run_error_code: 'LARK_PREFLIGHT_FAILED',
  };
  assert.throws(
    () => validateMetaLarkD1ReadyBoundary(failed, normalTarget),
    (error) => error.code === 'META_LARK_D1_BOUNDARY_INVALID',
  );
  const recoveryTarget = { ...normalTarget, terminalRecovery: true };
  const accepted = validateMetaLarkD1ReadyBoundary(failed, recoveryTarget);
  assert.equal(accepted.terminalRecovery, true);
  assert.throws(
    () => validateMetaLarkD1ReadyBoundary({
      ...failed,
      sync_run_error_code: 'UNHANDLED_SYNC_ERROR',
    }, recoveryTarget),
    (error) => error.code === 'META_LARK_D1_BOUNDARY_INVALID',
  );
  assert.throws(
    () => validateMetaLarkD1ReadyBoundary({
      ...failed,
      lark_phase_complete: 1,
    }, recoveryTarget),
    (error) => error.code === 'META_LARK_D1_BOUNDARY_INVALID',
  );
});

test('D1-ready recovery accepts an orphaned running invocation only after a stable platform-limit window', () => {
  const current = {
    ...target('instagram'),
    orphanedRunningRecovery: true,
  };
  const observedAt = 1785082800000;
  const orphaned = {
    ...d1ReadySnapshot(),
    sync_run_status: 'running',
    sync_run_started_at: observedAt - (17 * 60 * 1000),
    sync_run_finished_at: null,
    sync_run_error_code: null,
    sync_run_updated_at: observedAt - (17 * 60 * 1000),
    queue_operation_updated_at: observedAt - (16 * 60 * 1000),
    observed_at: observedAt,
  };
  const boundary = validateMetaLarkD1ReadyBoundary(orphaned, current);
  assert.equal(boundary.orphanedRunningRecovery, true);
  const stable = validateMetaLarkOrphanedRunningStability(orphaned, {
    ...orphaned,
    observed_at: observedAt + 30_000,
  }, current);
  assert.equal(stable.accepted, true);
  assert.equal(stable.elapsedMs, 30_000);

  assert.throws(
    () => validateMetaLarkD1ReadyBoundary(orphaned, {
      ...current,
      orphanedRunningRecovery: false,
    }),
    (error) => error.code === 'META_LARK_D1_BOUNDARY_INVALID',
  );
  assert.throws(
    () => validateMetaLarkOrphanedRunningStability(orphaned, {
      ...orphaned,
      main_queue_attempts: 39,
      observed_at: observedAt + 30_000,
    }, current),
    (error) => error.code === 'META_LARK_ORPHANED_RUNNING_PROGRESS_OBSERVED',
  );
  assert.throws(
    () => validateMetaLarkD1ReadyBoundary({
      ...orphaned,
      queue_operation_updated_at: observedAt - (15 * 60 * 1000),
    }, current),
    (error) => error.code === 'META_LARK_D1_BOUNDARY_INVALID',
  );
});

test('snapshot SQL binds the same operation and reads D1, preflight, Lark and completion phases', () => {
  const sql = buildMetaLarkSnapshotSql(target('chemistry_k2'));
  assert.match(sql, /meta_end_to_end_d1_write_v1/u);
  assert.match(sql, /meta_end_to_end_destination_preflight_v1/u);
  assert.match(sql, /meta_end_to_end_lark_write_v1/u);
  assert.match(sql, /meta_end_to_end_completion_v1/u);
  assert.match(sql, /completion_json/u);
  assert.match(sql, /sync_run_started_at/u);
  assert.match(sql, /sync_run_updated_at/u);
  assert.match(sql, /queue_operation_updated_at/u);
  assert.match(sql, /observed_at/u);
  assert.match(sql, /meta:meta_ads:chemistry_k2:meta-lark-chemistry_k2/u);
});

test('completion survives durable phase cleanup without fabricating a different operation', () => {
  const current = target('facebook');
  const results = larkResults(current);
  const cleared = {
    ...larkCompleteSnapshot(current),
    d1_phase_complete: null,
    preflight_phase_complete: null,
    preflight_state_json: null,
    lark_phase_complete: null,
    lark_state_json: null,
    completion_phase_complete: null,
    completion_state_json: null,
    work_completion_json: JSON.stringify({
      schemaVersion: 'meta_end_to_end_reconciliation_v1',
      operationId: current.operationId,
      connectorKey: current.connectorKey,
      preflight: results,
      d1: { expectedOperations: 2, processedOperations: 2 },
      lark: results,
      failed: 0,
    }),
  };

  const normalized = normalizeMetaLarkSnapshot(cleared);
  assert.equal(normalized.clearedPhaseCompletion, true);
  assert.equal(classifyMetaLarkCompletion(normalized, current).complete, true);

  const wrongOperation = {
    ...cleared,
    work_completion_json: cleared.work_completion_json.replace(
      current.operationId,
      'different-operation',
    ),
  };
  assert.equal(classifyMetaLarkCompletion(wrongOperation, current).complete, false);
});

test('completion requires Lark parity, final reconciliation, completed work and no D1 drift', () => {
  const current = target('facebook');
  const before = d1ReadySnapshot();
  const after = larkCompleteSnapshot(current);
  const classified = classifyMetaLarkCompletion(after, current);
  assert.equal(classified.complete, true);
  assert.equal(classified.expectedLarkTableCount, 4);

  const compared = compareMetaLarkSnapshots(before, after, current);
  assert.equal(compared.accepted, true);
  assert.equal(compared.d1CountDrift, false);
  assert.equal(compared.coverageCountDrift, false);

  assert.throws(
    () => compareMetaLarkSnapshots(before, {
      ...after,
      target_organic_state_count: 3,
    }, current),
    (error) => error.code === 'META_LARK_D1_COUNT_DRIFT',
  );
});

test('completed stability ignores only the observation timestamp', () => {
  const current = target('facebook');
  const before = {
    ...larkCompleteSnapshot(current),
    observed_at: 10_000,
  };
  const after = { ...before, observed_at: 15_000 };
  assert.equal(
    validateMetaLarkCompletedStability(before, after, current).accepted,
    true,
  );
  assert.throws(
    () => validateMetaLarkCompletedStability(before, {
      ...after,
      main_queue_attempts: Number(after.main_queue_attempts) + 1,
    }, current),
    (error) => error.code === 'META_LARK_COMPLETED_PROGRESS_OBSERVED',
  );
});

test('late proof accepts a stable post-completion orphan without fabricating Sync success', () => {
  const current = { ...target('instagram'), orphanedRunningRecovery: true };
  const completed = larkCompleteSnapshot(current);
  const observedAt = 1785082800000;
  const orphaned = {
    ...completed,
    sync_run_status: 'running',
    sync_run_started_at: observedAt - (17 * 60 * 1000),
    sync_run_finished_at: null,
    sync_run_error_code: null,
    sync_run_updated_at: observedAt - (17 * 60 * 1000),
    queue_operation_updated_at: observedAt - (16 * 60 * 1000),
    observed_at: observedAt,
  };
  assert.equal(classifyMetaLarkCompletion(orphaned, current).complete, false);
  assert.equal(classifyMetaLarkCompletion(orphaned, current).durableComplete, true);
  assert.equal(classifyMetaLarkPostCompletionOrphan(orphaned, current).accepted, true);
  const stableAfter = { ...orphaned, observed_at: observedAt + 30_000 };
  assert.equal(
    validateMetaLarkPostCompletionOrphanStability(orphaned, stableAfter, current).accepted,
    true,
  );
  const compared = compareMetaLarkSnapshots(d1ReadySnapshot(), stableAfter, current, {
    postCompletionOrphanVerified: true,
  });
  assert.equal(compared.accepted, true);
  assert.equal(compared.postCompletionOrphanAccepted, true);
  assert.equal(compared.snapshotAfter, undefined);

  assert.equal(classifyMetaLarkPostCompletionOrphan({
    ...orphaned,
    active_lock_count: 1,
  }, current).accepted, false);
  assert.throws(
    () => validateMetaLarkPostCompletionOrphanStability(orphaned, {
      ...stableAfter,
      main_queue_attempts: completed.main_queue_attempts + 2,
    }, current),
    (error) => error.code === 'META_LARK_POST_COMPLETION_ORPHAN_PROGRESS_OBSERVED',
  );
});

test('polling waits for a new attempt and then surfaces terminal sync failure', () => {
  const current = target('instagram');
  const stale = {
    ...larkCompleteSnapshot(current),
    sync_run_finished_at: 123,
    main_queue_attempts: 5,
  };
  assert.equal(
    classifyMetaLarkPollingSnapshot(stale, current, 6).state,
    'pending',
  );
  assert.equal(
    classifyMetaLarkPollingSnapshot({ ...stale, main_queue_attempts: 6 }, current, 6, 123).state,
    'pending',
  );
  assert.equal(
    classifyMetaLarkPollingSnapshot({
      ...stale,
      sync_run_finished_at: 124,
      main_queue_attempts: 6,
    }, current, 6, 123).state,
    'complete',
  );
  const failed = {
    ...stale,
    sync_run_status: 'failed',
    sync_run_finished_at: 123,
    sync_run_error_code: 'LARK_PREFLIGHT_FAILED',
    main_queue_attempts: 6,
  };
  assert.equal(
    classifyMetaLarkPollingSnapshot(failed, current, 6, 123).state,
    'pending',
  );
  const classified = classifyMetaLarkPollingSnapshot(
    { ...failed, sync_run_finished_at: 124 },
    current,
    6,
    123,
  );
  assert.equal(classified.state, 'terminal_failure');
  assert.equal(classified.errorCode, 'LARK_PREFLIGHT_FAILED');
});

test('same-operation rerun requires another Queue attempt and immutable reconciliation', () => {
  const current = target('facebook');
  const before = larkCompleteSnapshot(current);
  const after = { ...larkCompleteSnapshot(current), main_queue_attempts: 3 };
  const result = compareMetaLarkSnapshots(before, after, current, { rerun: true });
  assert.equal(result.accepted, true);
  assert.equal(result.larkReconciliationDrift, false);

  const changed = structuredClone(after);
  changed.lark_state_json = JSON.stringify({
    results: larkResults(current).map((entry, index) => index === 0
      ? { ...entry, created: entry.created + 1, skipped: entry.skipped - 1 }
      : entry),
  });
  assert.throws(
    () => compareMetaLarkSnapshots(before, changed, current, { rerun: true }),
    (error) => error.code === 'META_LARK_RERUN_RECONCILIATION_DRIFT',
  );
});

test('evidence chain is target-bound, hash-bound and never authorizes Provider or schedule actions', () => {
  const current = target('instagram');
  const preflight = createMetaLarkEvidence({
    phase: 'lark-preflight',
    capturedAt: '2026-07-27T00:00:00Z',
    repositoryHead: current.repositoryHead,
    targetFingerprint: current.targetFingerprint,
    targetKey: current.targetKey,
    operationId: current.operationId,
    data: { larkMutationCount: 0, secretValue: 'not-persisted' },
  });
  const ready = createMetaLarkEvidence({
    phase: 'd1-ready',
    capturedAt: '2026-07-27T00:01:00Z',
    repositoryHead: current.repositoryHead,
    targetFingerprint: current.targetFingerprint,
    targetKey: current.targetKey,
    operationId: current.operationId,
    previousEvidenceSha256: preflight.evidenceSha256,
    data: { providerRequestCount: 0 },
  });
  assert.equal(validateMetaLarkEvidenceSequence([preflight, ready], current).length, 2);
  assert.equal(preflight.data.secretValue, '[REDACTED]');
  assert.equal(preflight.providerRequestsAllowed, false);
  assert.equal(preflight.scheduleActivationAllowed, false);
  assert.equal(preflight.productionAllowed, false);

  const tampered = { ...ready, data: { providerRequestCount: 1 } };
  assert.throws(
    () => validateMetaLarkEvidenceSequence([preflight, tampered], current),
    (error) => error.code === 'META_LARK_EVIDENCE_HASH_INVALID',
  );
});

test('organic and historical Ads contracts remain isolated', () => {
  const facebookContracts = expectedLarkContracts('facebook');
  const instagramContracts = expectedLarkContracts('instagram');
  const adsContracts = expectedLarkContracts('meta_ads');
  assert.equal(facebookContracts.length, 4);
  assert.equal(instagramContracts.length, 4);
  assert.deepEqual(
    adsContracts.map((entry) => entry.tableKey),
    META_ADS_JULY_ACTIVITY_LARK_TABLE_KEYS,
  );
  assert.equal(
    facebookContracts.every((entry) => !entry.path.startsWith('raw.ads')),
    true,
  );
  assert.equal(
    adsContracts.every((entry) => !entry.path.startsWith('raw.organic')),
    true,
  );
  assert.equal(adsContracts.some((entry) => entry.path.startsWith('raw.ads')), false);
  assert.equal(adsContracts.some((entry) => entry.path.endsWith('adsCreatives')), false);
  assert.equal(adsContracts.some((entry) => entry.path.endsWith('adsDaily')), false);
});

function target(targetKey) {
  return loadMetaLarkTarget(targetEnv(targetKey));
}

function targetEnv(targetKey) {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_META_LARK_ACCOUNT_KEY: 'chemistry_k',
    MKT_META_LARK_TARGET: targetKey,
    MKT_META_LARK_REPOSITORY_HEAD: SHA,
    MKT_META_LARK_EXPECTED_ACTIVE_VERSION: VERSION,
    MKT_META_LARK_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_META_LARK_READ_ONLY_SUMMARY: 'outputs/meta-read-only-validation/summary.json',
    MKT_META_LARK_D1_SUMMARY: `outputs/meta-d1-only-rollout/${targetKey}/summary.json`,
    MKT_META_LARK_OPERATION_ID: `meta-lark-${targetKey}`,
    MKT_META_LARK_ORIGINAL_REQUESTED_AT: '2026-07-27T00:00:00Z',
    MKT_META_LARK_PERIOD_START: '2026-07-01',
    MKT_META_LARK_PERIOD_END: '2026-07-26',
    MKT_META_LARK_WORKER_NAME: 'social-mkt-sync-worker',
    MKT_META_LARK_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_META_LARK_MAIN_QUEUE: 'social-mkt-sync-jobs',
    MKT_META_LARK_DLQ: 'social-mkt-sync-dlq',
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

function d1Summary(current) {
  return {
    phase: 'summary',
    status: 'passed',
    contractVersion: 'meta-d1-only-rollout-v1',
    repositoryHead: current.repositoryHead,
    targetFingerprint: HASH,
    targetKey: current.targetKey,
    operationId: current.operationId,
    previousEvidenceSha256: HASH,
    data: {
      accepted: true,
      targetKey: current.targetKey,
      operationId: current.operationId,
      evidenceChainHeadSha256: HASH,
      d1OnlyVerified: true,
      idempotentRerunVerified: true,
      restoredAllFalse: true,
      larkMutationCount: 0,
      scheduleActivationCount: 0,
    },
    remoteMutationPerformed: false,
    providerRequestMode: null,
    businessWritesAllowed: false,
    larkWritesAllowed: false,
    scheduleActivationAllowed: false,
    productionAllowed: false,
    evidenceSha256: HASH,
  };
}

function d1ReadySnapshot() {
  return {
    sync_run_status: 'success',
    sync_run_started_at: 1785081500000,
    sync_run_finished_at: 1785081600000,
    sync_run_error_code: null,
    sync_run_updated_at: 1785081600000,
    work_status: 'active',
    work_lifecycle_status: 'active',
    work_completed_at: null,
    d1_phase_complete: 1,
    preflight_phase_complete: 0,
    preflight_state_json: null,
    lark_phase_complete: 0,
    lark_state_json: null,
    completion_phase_complete: 0,
    completion_state_json: null,
    active_lock_count: 0,
    queue_operation_attempts: 1,
    main_queue_attempts: 1,
    queue_operation_updated_at: 1785081600000,
    observed_at: 1785081700000,
    coverage_run_count: 2,
    invalid_coverage_count: 0,
    coverage_entity_count: 2,
    target_organic_state_count: 2,
    target_organic_observation_count: 2,
    target_account_daily_count: 1,
    target_ads_entity_count: 0,
    target_ads_daily_count: 0,
  };
}

function larkCompleteSnapshot(current) {
  const results = larkResults(current);
  return {
    ...d1ReadySnapshot(),
    sync_run_finished_at: 1785081601000,
    work_status: 'completed',
    work_lifecycle_status: 'completed',
    work_completed_at: 1785081601000,
    preflight_phase_complete: 1,
    preflight_state_json: JSON.stringify({ summaries: results }),
    lark_phase_complete: 1,
    lark_state_json: JSON.stringify({ results }),
    completion_phase_complete: 1,
    completion_state_json: JSON.stringify({
      reconciliation: { lark: results, failed: 0 },
    }),
    queue_operation_attempts: 1,
    main_queue_attempts: 2,
  };
}

function larkResults(current) {
  return expectedLarkContracts(current.connectorKey).map((entry) => ({
    tableKey: entry.tableKey,
    expected: 2,
    created: 1,
    updated: 0,
    skipped: 1,
  }));
}
