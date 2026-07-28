import test from 'node:test';
import assert from 'node:assert/strict';
import {
  META_LARK_OPERATOR_CONTRACT_VERSION,
  assertMetaLarkConfirmation,
  buildMetaLarkConfigWindow,
  buildMetaLarkContinuationJob,
  buildMetaLarkSnapshotSql,
  classifyMetaLarkCompletion,
  compareMetaLarkSnapshots,
  createMetaLarkEvidence,
  expectedLarkContracts,
  loadMetaLarkTarget,
  parseMetaLarkOperatorArgs,
  validateMetaD1OnlySummaryForLark,
  validateMetaLarkEvidenceSequence,
  validateMetaLarkInventory,
} from '../../scripts/lib/meta-lark-parity-rollout-operator.js';
import {
  META_D1_ONLY_REQUIRED_FALSE_FLAGS,
} from '../../scripts/lib/meta-d1-only-rollout-operator.js';
import {
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
});

test('target loader preserves the exact D1 operation identity for each target', () => {
  const facebook = target('facebook');
  assert.equal(facebook.workKey, 'facebook:meta-lark-facebook');
  assert.equal(facebook.syncRunId, 'meta:facebook:facebook:meta-lark-facebook');
  assert.equal(facebook.expectedLarkTableCount, 7);

  const instagram = target('instagram');
  assert.equal(instagram.workKey, 'instagram:meta-lark-instagram');
  assert.equal(instagram.expectedLarkTableCount, 7);

  const k2 = target('chemistry_k2');
  assert.equal(k2.workKey, 'meta_ads:chemistry_k2:meta-lark-chemistry_k2');
  assert.equal(k2.expectedLarkTableCount, 8);

  const k3 = target('chemistry_k3');
  assert.equal(k3.workKey, 'meta_ads:chemistry_k3:meta-lark-chemistry_k3');
  assert.equal(k3.expectedLarkTableCount, 8);
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

test('Lark inventory requires all 15 unique destinations and every stable key field', () => {
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
  assert.equal(result.tableCount, 15);
  assert.equal(result.allTablesPresent, true);
  assert.equal(result.allStableKeyFieldsPresent, true);

  const duplicate = { ...tableIds, rawMetaOrganicContent: tableIds.rawMetaOrganicAccounts };
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

test('snapshot SQL binds the same operation and reads D1, preflight, Lark and completion phases', () => {
  const sql = buildMetaLarkSnapshotSql(target('chemistry_k2'));
  assert.match(sql, /meta_end_to_end_d1_write_v1/u);
  assert.match(sql, /meta_end_to_end_destination_preflight_v1/u);
  assert.match(sql, /meta_end_to_end_lark_write_v1/u);
  assert.match(sql, /meta_end_to_end_completion_v1/u);
  assert.match(sql, /meta:meta_ads:chemistry_k2:meta-lark-chemistry_k2/u);
});

test('completion requires Lark parity, final reconciliation, completed work and no D1 drift', () => {
  const current = target('facebook');
  const before = d1ReadySnapshot();
  const after = larkCompleteSnapshot(current);
  const classified = classifyMetaLarkCompletion(after, current);
  assert.equal(classified.complete, true);
  assert.equal(classified.expectedLarkTableCount, 7);

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

test('same-operation rerun requires another Queue attempt and immutable reconciliation', () => {
  const current = target('facebook');
  const before = larkCompleteSnapshot(current);
  const after = { ...larkCompleteSnapshot(current), queue_operation_attempts: 3 };
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

test('organic and Ads contracts remain isolated', () => {
  assert.equal(expectedLarkContracts('facebook').length, 7);
  assert.equal(expectedLarkContracts('instagram').length, 7);
  assert.equal(expectedLarkContracts('meta_ads').length, 8);
  assert.equal(expectedLarkContracts('facebook').every((entry) => !entry.path.startsWith('raw.ads')), true);
  assert.equal(expectedLarkContracts('meta_ads').every((entry) => !entry.path.startsWith('raw.organic')), true);
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
    sync_run_finished_at: 1785081600000,
    sync_run_error_code: null,
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
    queue_operation_attempts: 2,
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
