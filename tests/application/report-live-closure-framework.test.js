import test from 'node:test';
import assert from 'node:assert/strict';
import {
  REPORT_LIVE_CLOSURE_CHANNELS,
  REPORT_LIVE_CLOSURE_WINDOWS,
  getReportLiveClosureDescriptor,
} from '../../packages/application/src/report-live-closure/channel-descriptors.js';
import {
  buildReportIdentities,
  buildStableReportKeys,
  runReportLiveClosureFramework,
} from '../../packages/application/src/report-live-closure/report-live-closure-framework.js';

test('registers every required channel through descriptors with exact dashboard windows', () => {
  assert.equal(REPORT_LIVE_CLOSURE_CHANNELS.length, 11);
  assert.deepEqual(REPORT_LIVE_CLOSURE_WINDOWS, [1, 3, 7, 30]);
  for (const descriptor of REPORT_LIVE_CLOSURE_CHANNELS) {
    assert.deepEqual(descriptor.supportedWindows, [1, 3, 7, 30]);
    assert.ok(descriptor.sourceReader);
    assert.ok(descriptor.readinessAuthority);
    assert.ok(descriptor.coverageAuthority);
    assert.ok(descriptor.metricProjection);
  }
});

test('builds exact YouTube 1/3/7/30 report identities and stable keys', () => {
  const descriptor = getReportLiveClosureDescriptor('youtube', 'organic');
  const identities = buildReportIdentities({
    customerKey: 'chemistry_k',
    customerProfile: 'integration_workspace',
    accountId: 'youtube-account',
    descriptor,
  });
  assert.deepEqual(identities.map((identity) => identity.window_days), [1, 3, 7, 30]);
  assert.equal(identities[0].metric_scope, 'youtube_organic');
  const keys = buildStableReportKeys(identities[0], { metricKey: 'views', entityKey: 'video-1', rank: 1 });
  assert.match(keys.report_id, /^report:/u);
  assert.match(keys.report_metric_key, /^report_metric:/u);
  assert.match(keys.report_content_key, /^report_content:/u);
  assert.match(keys.report_ad_key, /^report_ad:/u);
});

test('plans YouTube closure without remote writes while Meta lock is active', async () => {
  const calls = [];
  const pass = (name, extra = {}) => async () => {
    calls.push(name);
    return { ok: true, ...extra };
  };
  const result = await runReportLiveClosureFramework({
    descriptor: getReportLiveClosureDescriptor('youtube', 'organic'),
    target: {
      customerKey: 'chemistry_k',
      customerProfile: 'integration_workspace',
      accountId: 'youtube-account',
    },
    execute: false,
    adapters: {
      repositoryGate: pass('repository'),
      runtimeGate: pass('runtime', { allExecutionFlagsFalse: true }),
      sourceReadiness: pass('source', { readiness: 'ready' }),
      coverageValidation: pass('coverage', { status: 'completed' }),
      materializationPlan: pass('plan', { windows: [1, 3, 7, 30] }),
      d1Persistence: pass('d1'),
      larkWrite: pass('lark'),
      parity: pass('parity'),
      sameInputReplay: pass('replay'),
      zeroDrift: pass('zero-drift'),
      safeRestore: pass('restore'),
      sanitizedEvidence: pass('evidence'),
    },
  });
  assert.equal(result.status, 'READY_FOR_LIVE');
  assert.equal(result.frameworkStatus, 'READY');
  assert.equal(result.firstAdopter, 'youtube');
  assert.equal(result.remoteWriteCount, 0);
  assert.equal(result.queueActionCount, 0);
  assert.equal(result.workerDeploymentCount, 0);
  assert.equal(result.scheduleEnabled, false);
  assert.equal(result.production, 'BLOCKED');
  assert.deepEqual(calls, ['repository', 'runtime', 'source', 'coverage', 'plan']);
});

test('execute path uses injected shared adapters in the exact closure sequence', async () => {
  const calls = [];
  const pass = (name) => async () => {
    calls.push(name);
    return { ok: true };
  };
  const adapters = {
    repositoryGate: pass('repository'), runtimeGate: pass('runtime'),
    sourceReadiness: pass('source'), coverageValidation: pass('coverage'),
    materializationPlan: pass('plan'), d1Persistence: pass('d1'),
    larkWrite: pass('lark'), parity: pass('parity'),
    sameInputReplay: pass('replay'), zeroDrift: pass('zero-drift'),
    safeRestore: pass('restore'), sanitizedEvidence: pass('evidence'),
  };
  const result = await runReportLiveClosureFramework({
    descriptor: getReportLiveClosureDescriptor('youtube', 'organic'),
    target: { customerKey: 'c', customerProfile: 'p', accountId: 'a' },
    adapters,
    execute: true,
  });
  assert.equal(result.status, 'CLOSED');
  assert.deepEqual(calls, [
    'repository', 'runtime', 'source', 'coverage', 'plan', 'd1', 'lark',
    'parity', 'replay', 'zero-drift', 'restore', 'evidence',
  ]);
});
