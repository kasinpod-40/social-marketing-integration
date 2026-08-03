import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_LIVE_CLOSURE_CHANNELS,
  REPORT_LIVE_CLOSURE_LARK_OUTPUTS,
  REPORT_LIVE_CLOSURE_WINDOWS,
  getReportLiveClosureDescriptor,
} from '../../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  REPORT_LIVE_CLOSURE_ADAPTER_AUTHORITIES,
  resolveReportMissingValue,
  runReportLiveClosureFramework,
  sanitizeReportLiveClosureEvidence,
  validateReportLiveClosureCandidates,
} from '../../packages/application/src/report-live-closure/report-live-closure-framework.js';
import {
  buildReportMetricValueRows,
  buildReportTopAdsRows,
  buildReportTopContentRows,
} from '../../packages/application/src/reports/build-report-output-rows.js';
import { createReportLiveClosurePlanAdapters } from '../../scripts/lib/multichannel-report-live-closure-adapters.js';
import { buildReportRuntimeCloseoutCandidates } from '../../scripts/lib/report-runtime-closeout-operator.js';

const REVIEWED_HEAD = 'a'.repeat(40);
const REQUESTED_AT = Date.parse('2026-08-02T12:00:00Z');
const PERIOD_END = '2026-08-01';
const SOURCE_WATERMARK = 'youtube-watermark-2026-08-01';
const TARGET = Object.freeze({
  customerKey: 'chemistry_k',
  customerProfile: 'integration_workspace',
  accountId: 'UCAwEENovvqZWosKhJWTS5Kg',
});

function candidatesFor(platform = 'youtube', formulaVersion = 'youtube-organic-v1') {
  return buildReportRuntimeCloseoutCandidates({
    requestedAt: REQUESTED_AT,
    periodEnd: PERIOD_END,
    sourceWatermark: SOURCE_WATERMARK,
    timeZone: 'Asia/Bangkok',
    platformScope: platform,
    accountKey: 'chemistry_k',
    formulaVersion,
  }).filter((candidate) => REPORT_LIVE_CLOSURE_WINDOWS.includes(candidate.windowDays));
}

function binding(key, run) {
  return Object.freeze({ authority: REPORT_LIVE_CLOSURE_ADAPTER_AUTHORITIES[key], run });
}

function planAdapters(overrides = {}) {
  const candidates = candidatesFor();
  const defaults = {
    repositoryGate: binding('repositoryGate', async () => ({
      ok: true, branch: 'main', clean: true, head: REVIEWED_HEAD, reviewedHead: REVIEWED_HEAD,
    })),
    runtimeGate: binding('runtimeGate', async () => ({
      ok: true,
      allExecutionFlagsFalse: true,
      activeReportWorkCount: 0,
      activeReportLockCount: 0,
      openReportDlqCount: 0,
      openReportCriticalAlertCount: 0,
    })),
    sourceReadiness: binding('sourceReadiness', async () => ({ ok: true, ready: true })),
    coverageValidation: binding('coverageValidation', async () => ({
      ok: true, status: 'complete', failureCount: 0,
    })),
    identityPlanning: binding('identityPlanning', async () => ({ ok: true, candidates })),
    materializationPlan: binding('materializationPlan', async () => ({
      ok: true,
      windows: REPORT_LIVE_CLOSURE_WINDOWS.map((windowDays) => ({
        windowDays,
        action: 'create_materialization',
      })),
    })),
  };
  return { ...defaults, ...overrides };
}

function executeAdapters(calls, overrides = {}) {
  return {
    ...planAdapters(),
    d1Persistence: binding('d1Persistence', async () => {
      calls.push('d1');
      return { ok: true, materializationCount: 4, payloadsValid: true };
    }),
    larkWrite: binding('larkWrite', async () => {
      calls.push('lark');
      return { ok: true, usedExistingWriter: true };
    }),
    parity: binding('parity', async () => {
      calls.push('parity');
      return { ok: true, parity: true, driftCount: 0 };
    }),
    sameInputReplay: binding('sameInputReplay', async () => {
      calls.push('replay');
      return {
        ok: true, sameInput: true, sameReportIds: true, samePayloadChecksums: true,
      };
    }),
    zeroDrift: binding('zeroDrift', async () => {
      calls.push('zero-drift');
      return { ok: true, driftCount: 0 };
    }),
    safeRestore: binding('safeRestore', async () => {
      calls.push('restore');
      return { ok: true, allExecutionFlagsFalse: true };
    }),
    sanitizedEvidence: binding('sanitizedEvidence', async () => {
      calls.push('evidence');
      return { ok: true, sanitized: true };
    }),
    ...overrides,
  };
}

function reviewedHandoff() {
  return Object.freeze({
    contractVersion: 'multichannel_report_live_closure_handoff_v1',
    liveMaterializationAuthorized: true,
    repository: Object.freeze({
      branch: 'main', clean: true, head: REVIEWED_HEAD, reviewedHead: REVIEWED_HEAD,
    }),
    metaRemoteLock: Object.freeze({ released: true, auditHead: REVIEWED_HEAD }),
    youtubeIdentity: Object.freeze({ accountId: TARGET.accountId }),
    youtubeReadiness: Object.freeze({
      contractVersion: 'youtube_report_remote_readiness_reviewed_terminal_v1',
      ok: true,
      assessment: Object.freeze({
        readyForLive: true,
        repositoryReady: true,
        windows: Object.freeze(REPORT_LIVE_CLOSURE_WINDOWS.map((windowDays) => Object.freeze({
          windowDays,
          action: 'create_materialization',
        }))),
      }),
    }),
    closeoutAuthority: Object.freeze({
      operator: 'scripts/report-runtime-closeout-operator.mjs',
      contractVersion: 'report_runtime_closeout_uat_v1',
      platformScope: 'youtube',
      capability: 'organic',
    }),
  });
}

test('derives every source descriptor from the shared registry and keeps aggregations structural', () => {
  assert.equal(REPORT_LIVE_CLOSURE_CHANNELS.length, 11);
  assert.deepEqual(REPORT_LIVE_CLOSURE_WINDOWS, [1, 3, 7, 30]);
  const keys = REPORT_LIVE_CLOSURE_CHANNELS.map((entry) => `${entry.platform}:${entry.capability}`);
  for (const required of [
    'tiktok:organic', 'youtube:organic', 'instagram:organic', 'facebook:organic',
    'meta_ads:paid_ads', 'google_ads:paid_ads', 'tiktok_ads:paid_ads',
    'woocommerce:commerce', 'chatwoot:customer_service',
    'operations:operations', 'executive:aggregation',
  ]) assert.ok(keys.includes(required));
  for (const descriptor of REPORT_LIVE_CLOSURE_CHANNELS) {
    assert.deepEqual(descriptor.supportedWindows, [1, 3, 7, 30]);
    assert.equal(descriptor.metricProjection.summary, 'buildReportMetricValueRows');
    assert.ok(descriptor.safeRuntimeFlags.length > 0);
    assert.ok(descriptor.mustRemainFalseRuntimeFlags.length > 0);
    assert.ok(descriptor.requiredLarkOutputs.every((output) => Object.values(
      REPORT_LIVE_CLOSURE_LARK_OUTPUTS,
    ).includes(output)));
  }
  assert.deepEqual(getReportLiveClosureDescriptor('meta_ads', 'paid_ads').requiredLarkOutputs, [
    'mktReportSnapshots', 'mktReportMetricValues', 'mktReportTopAds',
  ]);
  assert.throws(
    () => getReportLiveClosureDescriptor('meta', 'ads'),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_DESCRIPTOR_NOT_FOUND',
  );
});

test('uses existing candidate and output-row authorities for exact identities and Stable keys', () => {
  const descriptor = getReportLiveClosureDescriptor('youtube', 'organic');
  const candidates = validateReportLiveClosureCandidates(candidatesFor(), { descriptor, target: TARGET });
  assert.deepEqual(candidates.map((candidate) => candidate.windowDays), [1, 3, 7, 30]);
  assert.deepEqual(candidates.map((candidate) => candidate.period.periodKind), [
    'rolling_days', 'rolling_days', 'rolling_days', 'rolling_days',
  ]);
  assert.deepEqual(candidates.map((candidate) => candidate.reportSettingKey), [
    'integration_workspace:youtube:rolling:1d',
    'integration_workspace:youtube:rolling:3d',
    'integration_workspace:youtube:rolling:7d',
    'integration_workspace:youtube:rolling:30d',
  ]);

  const candidate = candidates[0];
  const metric = buildReportMetricValueRows({
    reportId: candidate.reportId,
    platform: 'youtube',
    customerProfile: 'integration_workspace',
    accountId: TARGET.accountId,
    reportType: 'dashboard_performance_report',
    reportSettingKey: candidate.reportSettingKey,
    metrics: [{
      metricKey: 'views', stableMetricKey: 'views', displayName: 'Views', current: 0,
      unit: 'count', formulaVersion: 'youtube-organic-v1', clientVisible: true,
    }],
    period: candidate.period,
    generatedAt: REQUESTED_AT,
    utcOffset: '+07:00',
    dataStatus: 'complete',
    sourceSnapshotCount: 1,
  })[0];
  assert.equal(metric.report_metric_key, `${candidate.reportId}::views::summary::all`);
  assert.equal(metric.current_value, 0);

  const content = buildReportTopContentRows({
    reportId: candidate.reportId,
    platform: 'youtube',
    customerProfile: 'integration_workspace',
    accountId: TARGET.accountId,
    reportType: 'dashboard_performance_report',
    reportSettingKey: candidate.reportSettingKey,
    contentRows: [],
    limit: 1,
    period: candidate.period,
    generatedAt: REQUESTED_AT,
    utcOffset: '+07:00',
  })[0];
  assert.equal(content.report_content_key, `${candidate.reportId}::rank:1`);

  const adsCandidate = candidatesFor('meta_ads', 'meta-ads-v1')[0];
  const ad = buildReportTopAdsRows({
    reportId: adsCandidate.reportId,
    platform: 'meta_ads',
    customerProfile: 'integration_workspace',
    accountId: 'act-reviewed',
    reportType: 'dashboard_performance_report',
    reportSettingKey: adsCandidate.reportSettingKey,
    adRows: [],
    limit: 1,
    period: adsCandidate.period,
    generatedAt: REQUESTED_AT,
    utcOffset: '+07:00',
  })[0];
  assert.equal(ad.report_ad_key, `${adsCandidate.reportId}::rank:1`);
});

test('hard rejects 9/15/90 from the closure Metric path without changing shared presets', () => {
  const descriptor = getReportLiveClosureDescriptor('youtube', 'organic');
  const allCandidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: REQUESTED_AT,
    periodEnd: PERIOD_END,
    sourceWatermark: SOURCE_WATERMARK,
    platformScope: 'youtube',
    accountKey: 'chemistry_k',
    formulaVersion: 'youtube-organic-v1',
  });
  assert.ok(allCandidates.some((candidate) => candidate.windowDays === 9));
  assert.throws(
    () => validateReportLiveClosureCandidates(allCandidates, { descriptor, target: TARGET }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_WINDOWS_INVALID',
  );
});

test('preserves missing, partial, covered-empty and observed-zero semantics', () => {
  assert.deepEqual(resolveReportMissingValue('unavailable'), {
    value: null,
    display: 'N/A',
    data_status: 'source_unavailable',
    availability_status: 'source_unavailable',
    availability_message: 'N/A — แหล่งข้อมูลยังไม่พร้อม',
    partial_metadata: null,
  });
  const partial = resolveReportMissingValue('incomplete', { coveredDays: 2, expectedDays: 7 });
  assert.equal(partial.value, null);
  assert.equal(partial.availability_status, 'baseline_incomplete');
  assert.deepEqual(partial.partial_metadata, { coveredDays: 2, expectedDays: 7 });
  assert.equal(resolveReportMissingValue('covered_empty').data_status, 'no_data_confirmed');
  assert.equal(resolveReportMissingValue('observed_zero').value, 0);
});

test('binds Organic, Paid Ads, Commerce and Chatwoot planning to reviewed authorities', async () => {
  for (const [platform, capability, formulaVersion] of [
    ['youtube', 'organic', 'youtube-organic-v1'],
    ['meta_ads', 'paid_ads', 'meta-ads-v1'],
    ['woocommerce', 'commerce', 'woocommerce-commerce-v1'],
    ['chatwoot', 'customer_service', 'chatwoot-customer-service-v1'],
  ]) {
    const descriptor = getReportLiveClosureDescriptor(platform, capability);
    assert.equal(descriptor.formulaVersion, formulaVersion);
    const readiness = reviewedReadiness(platform, capability);
    const target = { ...TARGET, accountId: `${platform}-account` };
    const adapters = createReportLiveClosurePlanAdapters({
      descriptor,
      target,
      reviewedReadiness: readiness,
      requestedAt: REQUESTED_AT,
      periodEnd: PERIOD_END,
      sourceWatermark: SOURCE_WATERMARK,
    });
    const identities = await adapters.identityPlanning.run({});
    assert.deepEqual(identities.candidates.map((candidate) => candidate.windowDays), [1, 3, 7, 30]);
    assert.equal(adapters.identityPlanning.authority, 'buildReportRuntimeCloseoutCandidates');
  }
});

test('plan mode stays readiness-pending and never invokes write adapters', async () => {
  const calls = [];
  const adapters = planAdapters();
  for (const key of ['d1Persistence', 'larkWrite', 'parity', 'sameInputReplay', 'zeroDrift', 'safeRestore']) {
    adapters[key] = binding(key, async () => {
      calls.push(key);
      throw new Error('must not run');
    });
  }
  const result = await runReportLiveClosureFramework({
    descriptor: getReportLiveClosureDescriptor('youtube', 'organic'),
    target: TARGET,
    adapters,
    execute: false,
  });
  assert.equal(result.status, 'READINESS_PENDING');
  assert.equal(result.remoteWriteCount, 0);
  assert.deepEqual(calls, []);
});

test('bare no-op functions cannot satisfy reviewed adapter bindings', async () => {
  await assert.rejects(
    runReportLiveClosureFramework({
      descriptor: getReportLiveClosureDescriptor('youtube', 'organic'),
      target: TARGET,
      adapters: { repositoryGate: async () => ({ ok: true }) },
      execute: false,
    }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_ADAPTER_MISSING',
  );
});

test('execute path verifies parity, replay and zero drift then restores all flags false', async () => {
  const calls = [];
  const result = await runReportLiveClosureFramework({
    descriptor: getReportLiveClosureDescriptor('youtube', 'organic'),
    target: TARGET,
    adapters: executeAdapters(calls),
    reviewedHandoff: reviewedHandoff(),
    execute: true,
  });
  assert.equal(result.status, 'CLOSED');
  assert.deepEqual(calls, ['d1', 'lark', 'parity', 'replay', 'zero-drift', 'restore', 'evidence']);
});

test('every active-stage failure still runs safe restore and sanitized evidence', async (t) => {
  for (const [adapterKey, expectedCallsBeforeRestore] of [
    ['d1Persistence', []],
    ['larkWrite', ['d1']],
    ['parity', ['d1', 'lark']],
    ['sameInputReplay', ['d1', 'lark', 'parity']],
    ['zeroDrift', ['d1', 'lark', 'parity', 'replay']],
  ]) await t.test(adapterKey, async () => {
    const calls = [];
    const adapters = executeAdapters(calls, {
      [adapterKey]: binding(adapterKey, async () => {
        calls.push(`fail:${adapterKey}`);
        const error = new Error(`${adapterKey} failed`);
        error.code = `FAIL_${adapterKey}`;
        throw error;
      }),
    });
    await assert.rejects(
      runReportLiveClosureFramework({
        descriptor: getReportLiveClosureDescriptor('youtube', 'organic'),
        target: TARGET,
        adapters,
        reviewedHandoff: reviewedHandoff(),
        execute: true,
      }),
      (error) => error.code === `FAIL_${adapterKey}`,
    );
    assert.deepEqual(calls, [
      ...expectedCallsBeforeRestore,
      `fail:${adapterKey}`,
      'restore',
      'evidence',
    ]);
  });
});

test('preserves primary and restore failures in combined sanitized evidence', async () => {
  const adapters = executeAdapters([], {
    d1Persistence: binding('d1Persistence', async () => {
      const error = new Error('D1 failed');
      error.code = 'D1_FAILED';
      throw error;
    }),
    safeRestore: binding('safeRestore', async () => {
      const error = new Error('restore failed');
      error.code = 'RESTORE_FAILED';
      throw error;
    }),
  });
  await assert.rejects(
    runReportLiveClosureFramework({
      descriptor: getReportLiveClosureDescriptor('youtube', 'organic'),
      target: TARGET,
      adapters,
      reviewedHandoff: reviewedHandoff(),
      execute: true,
    }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_RESTORE_FAILED_AFTER_PRIMARY_ERROR'
      && error.details.primaryCode === 'D1_FAILED'
      && error.details.restoreCode === 'RESTORE_FAILED',
  );
});

test('recursively sanitizes nested objects and arrays', () => {
  assert.deepEqual(sanitizeReportLiveClosureEvidence({
    ok: true,
    authorization: 'Bearer secret',
    nested: {
      token: 'secret',
      values: [
        { databaseId: 'db-secret', status: 'safe' },
        { child: { consumer_secret: 'secret', count: 0 } },
      ],
    },
  }), {
    ok: true,
    nested: {
      values: [
        { status: 'safe' },
        { child: { count: 0 } },
      ],
    },
  });
});

function reviewedReadiness(platform, capability) {
  return Object.freeze({
    contractVersion: 'youtube_report_remote_readiness_reviewed_terminal_v1',
    evidence: Object.freeze({
      target: Object.freeze({
        platformScope: platform,
        customerProfile: 'integration_workspace',
        accountKey: 'chemistry_k',
      }),
      repository: Object.freeze({
        branch: 'main', clean: true, head: REVIEWED_HEAD, reviewedHead: REVIEWED_HEAD,
      }),
      runtime: Object.freeze({
        allExecutionFlagsFalse: true,
        activeReportWorkCount: 0,
        activeReportLockCount: 0,
        openReportDlqCount: 0,
        openReportCriticalAlertCount: 0,
      }),
      source: Object.freeze({
        contentCoverageStatus: 'completed',
        failureCount: 0,
        contentEntityCount: 10,
        watermarkDate: PERIOD_END,
        reportingTimezone: 'Asia/Bangkok',
      }),
    }),
    assessment: Object.freeze({
      sourceReady: true,
      windows: Object.freeze(REPORT_LIVE_CLOSURE_WINDOWS.map((windowDays) => Object.freeze({
        windowDays,
        action: 'create_materialization',
      }))),
      capability,
    }),
  });
}
