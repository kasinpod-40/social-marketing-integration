import assert from 'node:assert/strict';
import test from 'node:test';
import {
  FACEBOOK_ORGANIC_LIVE_WINDOWS,
  assertExactRuntimeFlagRestoration,
  assertNoRecordedMutationForExecute,
  assertRecoveryIsReadOnlyForReports,
  buildExactRuntimePreservingConfigs,
  buildFacebookRefreshPlan,
  diffExecutionFlagMaps,
  extractActiveWorkerVersion,
  extractRemoteExecutionFlagMap,
  parseFacebookOrganicLiveRolloutArgs,
} from '../../scripts/lib/facebook-organic-live-rematerialization-rollout.js';

const SOURCE = `{
  // current Integration Workspace config
  "name": "social-mkt-sync-worker",
  "workers_dev": false,
  "vars": {
    "MKT_ENV": "development",
    "MKT_CUSTOMER_PROFILE": "integration_workspace",
    "MKT_REPORT_D1_READ_ENABLED": "false",
    "MKT_REPORT_PRESET_MATERIALIZATION_ENABLED": "false",
    "MKT_SCHEDULE_DAILY_REPORT_ENABLED": "false",
    "MKT_SCHEDULE_WEEKLY_REPORT_ENABLED": "false",
    "MKT_FACEBOOK_SYNC_ENABLED": "false",
    "MKT_NEW_LOCAL_ONLY_ENABLED": "false"
  }
}`;

test('plan mode is default and execute/recover are mutually exclusive', () => {
  assert.deepEqual(parseFacebookOrganicLiveRolloutArgs([]), {
    execute: false,
    recover: false,
    planOnly: true,
  });
  assert.equal(parseFacebookOrganicLiveRolloutArgs(['--execute']).execute, true);
  assert.equal(parseFacebookOrganicLiveRolloutArgs(['--recover']).recover, true);
  assert.throws(
    () => parseFacebookOrganicLiveRolloutArgs(['--execute', '--recover']),
    { code: 'FACEBOOK_ORGANIC_LIVE_ROLLOUT_ARGUMENT_INVALID' },
  );
});

test('active Worker version requires exactly one 100-percent deployment', () => {
  const id = '11111111-1111-4111-8111-111111111111';
  assert.equal(extractActiveWorkerVersion({ deployments: [{ version_id: id, percentage: 100 }] }), id);
  assert.throws(
    () => extractActiveWorkerVersion({ deployments: [
      { version_id: id, percentage: 50 },
      { version_id: '22222222-2222-4222-8222-222222222222', percentage: 50 },
    ] }),
    { code: 'FACEBOOK_ORGANIC_LIVE_ROLLOUT_ACTIVE_VERSION_INVALID' },
  );
});

test('remote flag extraction reads only MKT enabled plain-text bindings', () => {
  const flags = extractRemoteExecutionFlagMap([
    { type: 'plain_text', name: 'MKT_REPORT_D1_READ_ENABLED', text: 'true' },
    { type: 'plain_text', name: 'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED', text: 'false' },
    { type: 'plain_text', name: 'MKT_SCHEDULE_DAILY_REPORT_ENABLED', text: 'true' },
    { type: 'plain_text', name: 'MKT_ENV', text: 'development' },
    { type: 'secret_text', name: 'LARK_APP_SECRET' },
  ]);
  assert.deepEqual(flags, {
    MKT_REPORT_D1_READ_ENABLED: true,
    MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: false,
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: true,
  });
});

test('baseline preserves exact remote flags and overlay changes Report flags only', () => {
  const result = buildExactRuntimePreservingConfigs(SOURCE, {
    MKT_FACEBOOK_SYNC_ENABLED: true,
    MKT_REPORT_D1_READ_ENABLED: false,
    MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: false,
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: true,
    MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: true,
  });
  assert.deepEqual(result.baselineFlagMap, {
    MKT_FACEBOOK_SYNC_ENABLED: true,
    MKT_NEW_LOCAL_ONLY_ENABLED: false,
    MKT_REPORT_D1_READ_ENABLED: false,
    MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: false,
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: true,
    MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: true,
  });
  assert.equal(result.overlayFlagMap.MKT_FACEBOOK_SYNC_ENABLED, true);
  assert.equal(result.overlayFlagMap.MKT_SCHEDULE_DAILY_REPORT_ENABLED, true);
  assert.equal(result.overlayFlagMap.MKT_SCHEDULE_WEEKLY_REPORT_ENABLED, true);
  assert.equal(result.overlayFlagMap.MKT_REPORT_D1_READ_ENABLED, true);
  assert.equal(result.overlayFlagMap.MKT_REPORT_PRESET_MATERIALIZATION_ENABLED, true);
  assert.equal(result.overlayRequired, true);
  assert.deepEqual(diffExecutionFlagMaps(result.baselineFlagMap, result.overlayFlagMap).map((row) => row.name), [
    'MKT_REPORT_D1_READ_ENABLED',
    'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
  ]);
});

test('already-active Report runtime needs no temporary overlay deploy', () => {
  const result = buildExactRuntimePreservingConfigs(SOURCE, {
    MKT_FACEBOOK_SYNC_ENABLED: false,
    MKT_REPORT_D1_READ_ENABLED: true,
    MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: true,
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: true,
    MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: true,
  });
  assert.equal(result.overlayRequired, false);
  assert.deepEqual(result.baselineFlagMap, result.overlayFlagMap);
});

test('remote-only flags and unsafe local-only flags fail closed', () => {
  assert.throws(
    () => buildExactRuntimePreservingConfigs(SOURCE, {
      MKT_REPORT_D1_READ_ENABLED: false,
      MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: false,
      MKT_REMOTE_UNKNOWN_ENABLED: true,
    }),
    { code: 'FACEBOOK_ORGANIC_LIVE_ROLLOUT_REMOTE_FLAG_MISSING_LOCAL' },
  );
  const unsafeSource = SOURCE.replace(
    '"MKT_NEW_LOCAL_ONLY_ENABLED": "false"',
    '"MKT_NEW_LOCAL_ONLY_ENABLED": "true"',
  );
  assert.throws(
    () => buildExactRuntimePreservingConfigs(unsafeSource, {
      MKT_FACEBOOK_SYNC_ENABLED: false,
      MKT_REPORT_D1_READ_ENABLED: false,
      MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: false,
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: false,
      MKT_SCHEDULE_WEEKLY_REPORT_ENABLED: false,
    }),
    { code: 'FACEBOOK_ORGANIC_LIVE_ROLLOUT_LOCAL_ONLY_FLAG_UNSAFE' },
  );
});

test('Facebook rollout is refresh-only for exact stable 1/3/7/30 report identities', () => {
  const candidates = FACEBOOK_ORGANIC_LIVE_WINDOWS.map((windowDays) => ({
    windowDays,
    reportId: `facebook-${windowDays}d`,
    job: { type: 'report.materialization.generate', windowDays },
  }));
  const plan = buildFacebookRefreshPlan(candidates, candidates.map((row) => row.reportId));
  assert.deepEqual(plan.map((row) => row.windowDays), [1, 3, 7, 30]);
  assert.ok(plan.every((row) => row.operation === 'refresh'));
  assert.ok(plan.every((row) => row.job.type === 'report.materialization.generate'));
  assert.throws(
    () => buildFacebookRefreshPlan(candidates, candidates.slice(0, 3).map((row) => row.reportId)),
    { code: 'FACEBOOK_ORGANIC_LIVE_ROLLOUT_STABLE_REPORT_MISSING' },
  );
});

test('recorded mutations block blind rerun and recovery cannot resend reports', () => {
  assert.equal(assertNoRecordedMutationForExecute({ sendWindows: [] }), true);
  assert.throws(
    () => assertNoRecordedMutationForExecute({ deployBaseline: { attemptedAt: 1 }, sendWindows: [] }),
    { code: 'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECORDED_ATTEMPT' },
  );
  assert.equal(assertRecoveryIsReadOnlyForReports({ queueSendCount: 0, providerRequestCount: 0 }), true);
  assert.throws(
    () => assertRecoveryIsReadOnlyForReports({ queueSendCount: 1, providerRequestCount: 0 }),
    { code: 'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RECOVERY_MUTATION_INVALID' },
  );
});

test('final runtime restoration compares the complete flag vector', () => {
  const baseline = {
    MKT_FACEBOOK_SYNC_ENABLED: true,
    MKT_REPORT_D1_READ_ENABLED: false,
    MKT_REPORT_PRESET_MATERIALIZATION_ENABLED: false,
    MKT_SCHEDULE_DAILY_REPORT_ENABLED: true,
  };
  assert.equal(assertExactRuntimeFlagRestoration(baseline, { ...baseline }), true);
  assert.throws(
    () => assertExactRuntimeFlagRestoration(baseline, {
      ...baseline,
      MKT_SCHEDULE_DAILY_REPORT_ENABLED: false,
    }),
    { code: 'FACEBOOK_ORGANIC_LIVE_ROLLOUT_RUNTIME_RESTORE_DRIFT' },
  );
});
