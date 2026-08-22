import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildMetaLarkContinuationJob,
  classifyMetaLarkCompletion,
  expectedLarkContracts,
  loadMetaLarkTarget,
} from '../../scripts/lib/meta-lark-parity-rollout-operator.js';

const SHA = 'a'.repeat(40);
const VERSION = '12345678-1234-4123-8123-123456789abc';

function targetEnv(overrides = {}) {
  return {
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_CONNECTION_CUSTOMER_KEY: 'chemistry_k',
    MKT_META_LARK_ACCOUNT_KEY: 'chemistry_k',
    MKT_META_LARK_TARGET: 'chemistry_k2',
    MKT_META_LARK_REPOSITORY_HEAD: SHA,
    MKT_META_LARK_EXPECTED_ACTIVE_VERSION: VERSION,
    MKT_META_LARK_WRANGLER_CONFIG: 'wrangler.sync.jsonc',
    MKT_META_LARK_READ_ONLY_SUMMARY: 'outputs/meta-read-only-validation/summary.json',
    MKT_META_LARK_D1_SUMMARY: 'outputs/meta-d1-only-rollout/chemistry_k2/summary.json',
    MKT_META_LARK_OPERATION_ID: 'meta-lark-chemistry_k2',
    MKT_META_LARK_ORIGINAL_REQUESTED_AT: '2026-07-27T00:00:00Z',
    MKT_META_LARK_PERIOD_START: '2026-07-01',
    MKT_META_LARK_PERIOD_END: '2026-07-26',
    MKT_META_LARK_WORKER_NAME: 'social-mkt-sync-worker',
    MKT_META_LARK_DATABASE_NAME: 'social-mkt-state-dev',
    MKT_META_LARK_MAIN_QUEUE: 'social-mkt-sync-jobs',
    MKT_META_LARK_DLQ: 'social-mkt-sync-dlq',
    ...overrides,
  };
}

function completedSnapshot(target) {
  const results = expectedLarkContracts(target.connectorKey, target.larkTableKeys).map((entry) => ({
    tableKey: entry.tableKey,
    expected: 2,
    created: 1,
    updated: 0,
    skipped: 1,
  }));
  return {
    sync_run_status: 'success',
    sync_run_started_at: 1,
    sync_run_finished_at: 2,
    sync_run_error_code: null,
    sync_run_updated_at: 2,
    work_status: 'completed',
    work_lifecycle_status: 'completed',
    work_completed_at: 2,
    d1_phase_complete: 1,
    preflight_phase_complete: 1,
    preflight_state_json: JSON.stringify({ summaries: results }),
    lark_phase_complete: 1,
    lark_state_json: JSON.stringify({ results }),
    completion_phase_complete: 1,
    completion_state_json: JSON.stringify({ reconciliation: { lark: results, failed: 0 } }),
    active_lock_count: 0,
    queue_operation_attempts: 1,
    main_queue_attempts: 2,
    queue_operation_updated_at: 2,
    observed_at: 3,
    coverage_run_count: 1,
    invalid_coverage_count: 0,
    coverage_entity_count: 1,
    target_organic_state_count: 0,
    target_organic_observation_count: 0,
    target_account_daily_count: 0,
    target_ads_entity_count: 1,
    target_ads_daily_count: 1,
  };
}

test('targeted Meta Ads operator emits and verifies only Creatives and Daily', () => {
  const target = loadMetaLarkTarget(targetEnv({
    MKT_META_LARK_TABLE_KEYS: 'mktAdsCreatives,mktAdsDaily',
  }));
  assert.deepEqual(target.larkTableKeys, ['mktAdsCreatives', 'mktAdsDaily']);
  assert.equal(target.expectedLarkTableCount, 2);
  assert.deepEqual(
    expectedLarkContracts('meta_ads', target.larkTableKeys).map((entry) => entry.tableKey),
    ['mktAdsCreatives', 'mktAdsDaily'],
  );

  const job = buildMetaLarkContinuationJob(target);
  assert.deepEqual(job.larkTableKeys, ['mktAdsCreatives', 'mktAdsDaily']);
  assert.equal(job.type, 'meta.ads.sync');
  assert.equal(job.trigger, 'manual_uat');

  const classified = classifyMetaLarkCompletion(completedSnapshot(target), target);
  assert.equal(classified.complete, true);
  assert.equal(classified.expectedLarkTableCount, 2);
});

test('targeted Meta Lark scope changes the target fingerprint and rejects cross-connector tables', () => {
  const unscoped = loadMetaLarkTarget(targetEnv());
  const scoped = loadMetaLarkTarget(targetEnv({
    MKT_META_LARK_TABLE_KEYS: 'mktAdsCreatives,mktAdsDaily',
  }));
  assert.notEqual(scoped.targetFingerprint, unscoped.targetFingerprint);

  assert.throws(
    () => loadMetaLarkTarget(targetEnv({ MKT_META_LARK_TABLE_KEYS: 'mktContent' })),
    (error) => error.code === 'META_LARK_TABLE_SCOPE_INVALID',
  );
  assert.throws(
    () => loadMetaLarkTarget(targetEnv({
      MKT_META_LARK_TABLE_KEYS: 'mktAdsDaily,mktAdsDaily',
    })),
    (error) => error.code === 'META_LARK_TABLE_SCOPE_INVALID',
  );
});