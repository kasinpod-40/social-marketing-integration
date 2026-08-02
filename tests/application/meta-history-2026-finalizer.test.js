import assert from 'node:assert/strict';
import test from 'node:test';

import {
  META_HISTORY_2026_DECISION,
  META_HISTORY_2026_LEGACY_SESSION,
  createMetaHistory2026Plan,
  createMetaHistoryCloudflarePhaseEnvironment,
  createMetaHistoryPinnedContinuity,
  injectMetaHistoryConfig,
  readMetaLarkSummaryCompletion,
  shouldExpandMetaAdsHistory,
  validateMetaHistory2026Summary,
  validateMetaHistoryPinnedContinuity,
} from '../../scripts/lib/meta-history-2026-finalizer.js';

const HEAD = 'a'.repeat(40);

test('Cloudflare phase environment keeps explicit tokens and preserves refreshable OAuth sessions', () => {
  assert.deepEqual(createMetaHistoryCloudflarePhaseEnvironment({ KEEP: 'yes' }, {
    accountId: 'account-1',
    apiToken: 'explicit-token',
    authSource: 'environment',
  }), {
    KEEP: 'yes',
    CLOUDFLARE_ACCOUNT_ID: 'account-1',
    CLOUDFLARE_API_TOKEN: 'explicit-token',
  });
  assert.deepEqual(createMetaHistoryCloudflarePhaseEnvironment({
    KEEP: 'yes',
    CLOUDFLARE_API_TOKEN: 'stale-oauth-token',
  }, {
    accountId: 'account-1',
    apiToken: 'fresh-oauth-token',
    authSource: 'wrangler_auth_session',
  }), {
    KEEP: 'yes',
    CLOUDFLARE_ACCOUNT_ID: 'account-1',
  });
});

test('Meta history plan includes Facebook and Instagram July plus adaptive Ads windows', () => {
  const plan = createMetaHistory2026Plan(HEAD);
  assert.equal(plan.facebook.existingOperationReplay, false);
  assert.equal(plan.facebook.replacementOperation, false);
  assert.equal(plan.facebook.legacyLocalArtifactsRequired, false);
  assert.equal(
    plan.facebook.pinnedCompletionAction,
    'verify_fresh_facebook_identity_and_no_replay_continuity',
  );
  assert.deepEqual(plan.operations.map((item) => [item.target, item.periodStart, item.periodEnd, item.mode]), [
    ['facebook', '2026-07-01', '2026-07-31', 'required'],
    ['instagram', '2026-07-01', '2026-07-31', 'required'],
    ['chemistry_k2', '2026-05-01', '2026-07-31', 'required'],
    ['chemistry_k3', '2026-05-01', '2026-07-31', 'required'],
    ['chemistry_k2', '2026-01-01', '2026-04-30', 'conditional'],
    ['chemistry_k3', '2026-01-01', '2026-04-30', 'conditional'],
  ]);
  assert.equal(new Set(plan.operations.map((item) => item.operationId)).size, 6);
  assert.equal(
    plan.operations.some((item) => item.operationId === META_HISTORY_2026_LEGACY_SESSION.operationId),
    false,
  );
});

test('Meta pinned continuity uses fresh Facebook identity and exact no-replay plan', () => {
  const continuity = createMetaHistoryPinnedContinuity({
    repositoryHead: HEAD,
    plan: createMetaHistory2026Plan(HEAD),
    readOnlySummary: readOnlySummary(),
  });
  assert.equal(continuity.pinnedVerified, true);
  assert.equal(continuity.freshFacebookIdentityValidated, true);
  assert.equal(continuity.existingOperationReplay, false);
  assert.equal(continuity.replacementOperation, false);
  assert.equal(continuity.legacyLocalArtifactsRequired, false);
  assert.match(continuity.readOnlyEvidenceFingerprint, /^[0-9a-f]{64}$/u);
  assert.equal(validateMetaHistoryPinnedContinuity(continuity, HEAD).repositoryHead, HEAD);
});

test('Meta pinned continuity rejects missing Facebook identity evidence', () => {
  const invalid = readOnlySummary();
  invalid.details.validations = invalid.details.validations.filter(
    (item) => item.phase !== 'facebook',
  );
  invalid.details.validationCount = invalid.details.validations.length;
  assert.throws(
    () => createMetaHistoryPinnedContinuity({
      repositoryHead: HEAD,
      plan: createMetaHistory2026Plan(HEAD),
      readOnlySummary: invalid,
    }),
    (error) => error?.code === 'META_HISTORY_2026_PINNED_CONTINUITY_IDENTITY_INVALID',
  );
});

test('Meta pinned continuity rejects invalid read-only evidence envelope', () => {
  const invalid = readOnlySummary();
  invalid.mutationPerformed = true;
  assert.throws(
    () => createMetaHistoryPinnedContinuity({
      repositoryHead: HEAD,
      plan: createMetaHistory2026Plan(HEAD),
      readOnlySummary: invalid,
    }),
    (error) => error?.code === 'META_HISTORY_2026_PINNED_CONTINUITY_IDENTITY_INVALID',
  );
});

test('Meta pinned continuity rejects drift in any current operation', () => {
  const plan = structuredClone(createMetaHistory2026Plan(HEAD));
  plan.operations[4].periodStart = '2026-02-01';
  assert.throws(
    () => createMetaHistoryPinnedContinuity({
      repositoryHead: HEAD,
      plan,
      readOnlySummary: readOnlySummary(),
    }),
    (error) => error?.code === 'META_HISTORY_2026_PINNED_CONTINUITY_PLAN_INVALID',
  );
});

test('Meta pinned continuity rejects replay of the legacy operation identity', () => {
  const plan = structuredClone(createMetaHistory2026Plan(HEAD));
  plan.operations[0].operationId = META_HISTORY_2026_LEGACY_SESSION.operationId;
  assert.throws(
    () => createMetaHistoryPinnedContinuity({
      repositoryHead: HEAD,
      plan,
      readOnlySummary: readOnlySummary(),
    }),
    (error) => [
      'META_HISTORY_2026_PINNED_CONTINUITY_PLAN_INVALID',
      'META_HISTORY_2026_PINNED_CONTINUITY_OPERATION_INVALID',
    ].includes(error?.code),
  );
});

test('Meta Lark completion reads the canonical larkParityVerified summary field', () => {
  assert.deepEqual(readMetaLarkSummaryCompletion({
    data: {
      accepted: true,
      larkParityVerified: true,
      idempotentRerunVerified: true,
      restoredAllFalse: true,
    },
  }), {
    larkCompleted: true,
    idempotentRerunVerified: true,
    restoredAllFalse: true,
  });
  assert.equal(readMetaLarkSummaryCompletion({
    data: {
      accepted: true,
      larkVerified: true,
      idempotentRerunVerified: true,
      restoredAllFalse: true,
    },
  }).larkCompleted, false);
});

test('Meta history config injects inventory bounds and absolute runtime paths idempotently', () => {
  const initial = '{\n  "main": "apps/sync-worker/src/index.js",\n  "migrations_dir": "migrations",\n  "vars": {\n    "MKT_ENV": "development"\n  }\n}\n';
  const options = { baseDirectory: '/tmp/social-marketing-integration' };
  const once = injectMetaHistoryConfig(initial, undefined, options);
  const twice = injectMetaHistoryConfig(once, undefined, options);
  assert.equal(once, twice);
  assert.match(once, /"main": "\/tmp\/social-marketing-integration\/apps\/sync-worker\/src\/index\.js"/u);
  assert.match(once, /"migrations_dir": "\/tmp\/social-marketing-integration\/migrations"/u);
  assert.match(once, /"MKT_META_INSTAGRAM_CONTENT_SINCE": "2026-07-01"/u);
  assert.match(once, /"MKT_META_INSTAGRAM_CONTENT_UNTIL": "2026-07-31"/u);
});

test('Meta Ads expands to start of year only under bounded completed volume', () => {
  const safe = [summary(4000, 1000, 6000), summary(5000, 1000, 7000)];
  assert.equal(shouldExpandMetaAdsHistory(safe).allowed, true);
  const large = [summary(9000, 3000, 12000), summary(9000, 3000, 12000)];
  assert.equal(shouldExpandMetaAdsHistory(large).allowed, false);
});

test('Meta Ads expansion rejects incomplete or invalid Coverage summaries', () => {
  const invalid = summary(0, 0, 0);
  invalid.data.snapshotAfter.invalidCoverageCount = 1;
  assert.throws(
    () => shouldExpandMetaAdsHistory([invalid, summary(0, 0, 0)]),
    (error) => error?.code === 'META_HISTORY_2026_ADS_BASELINE_INVALID',
  );
});

test('Meta final summary accepts modern continuity and requires completed Facebook supplemental operation', () => {
  const continuity = createMetaHistoryPinnedContinuity({
    repositoryHead: HEAD,
    plan: createMetaHistory2026Plan(HEAD),
    readOnlySummary: readOnlySummary(),
  });
  const value = {
    ok: true,
    decision: META_HISTORY_2026_DECISION,
    facebook: { ...continuity, historyCompleted: true },
    instagram: { completed: true },
    metaAds: { baselineCompleted: true },
    operations: [{
      target: 'facebook',
      operationId: continuity.supplementalOperationId,
      periodStart: '2026-07-01',
      periodEnd: '2026-07-31',
      mode: 'required',
      d1Completed: true,
      larkCompleted: true,
    }],
    parityVerified: true,
    idempotentRerunsVerified: true,
    executionFlagsAllFalse: true,
    remote: { activeWork: 0, activeLocks: 0, activeQueueOperations: 0 },
    scheduleEnabled: false,
    production: false,
  };
  assert.equal(validateMetaHistory2026Summary(value), true);
  assert.throws(
    () => validateMetaHistory2026Summary({
      ...value,
      facebook: { ...continuity, historyCompleted: false },
      operations: [],
    }),
    (error) => error?.code === 'META_HISTORY_2026_SUMMARY_INVALID',
  );
});

function readOnlySummary() {
  return {
    phase: 'summary',
    status: 'passed',
    contractVersion: 'meta_read_only_validation_v1',
    mutationPerformed: false,
    businessWrites: 0,
    queueMessages: 0,
    details: {
      accepted: true,
      validationCount: 4,
      validations: [
        {
          phase: 'facebook',
          connectorKey: 'facebook',
          sourceAccountKey: null,
          status: 'identity_validated',
          requestAttempts: 1,
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
          requestAttempts: 1,
        },
        {
          phase: 'meta-ads-chemistry-k3',
          connectorKey: 'meta_ads',
          sourceAccountKey: 'chemistry_k3',
          status: 'identity_validated',
          requestAttempts: 1,
        },
      ],
    },
  };
}

function summary(adsDaily, adsEntities, coverageEntities) {
  return {
    data: {
      snapshotAfter: {
        syncRunStatus: 'success',
        activeLockCount: 0,
        invalidCoverageCount: 0,
        coverageEntityCount: coverageEntities,
        operationCounts: { adsDaily, adsEntities },
      },
    },
  };
}
