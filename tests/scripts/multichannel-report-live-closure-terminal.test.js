import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
  buildReadyChannelPlan,
  buildYouTubeFirstAdopterPlan,
  loadReviewedHandoff,
  parseReportLiveClosureArgs,
} from '../../scripts/multichannel-report-live-closure-terminal.mjs';

const HEAD = 'b'.repeat(40);
const REQUESTED_AT = Date.parse('2026-08-02T12:00:00Z');

const CAPABILITIES = Object.freeze({
  facebook: 'organic',
  instagram: 'organic',
  youtube: 'organic',
  woocommerce: 'commerce',
  chatwoot: 'customer_service',
});

function reviewedReadiness(platformScope = 'youtube', { includeSourceWatermark = true } = {}) {
  return Object.freeze({
    contractVersion: platformScope === 'youtube'
      ? 'youtube_report_remote_readiness_reviewed_terminal_v1'
      : 'report_channel_remote_readiness_reviewed_terminal_v1',
    ok: true,
    evidence: Object.freeze({
      target: Object.freeze({
        environment: 'development',
        customerProfile: 'integration_workspace',
        accountKey: 'chemistry_k',
        platformScope,
      }),
      repository: Object.freeze({ branch: 'main', clean: true, head: HEAD, reviewedHead: HEAD }),
      runtime: Object.freeze({
        allExecutionFlagsFalse: true,
        activeReportWorkCount: 0,
        activeReportLockCount: 0,
        openReportDlqCount: 0,
        openReportCriticalAlertCount: 0,
      }),
      source: Object.freeze({
        coverageStatus: 'complete',
        contentCoverageStatus: 'completed',
        failureCount: 0,
        entityCount: 10,
        contentEntityCount: 10,
        watermarkDate: '2026-08-01',
        ...(includeSourceWatermark ? { sourceWatermark: `${platformScope}-watermark-2026-08-01` } : {}),
        reportingTimezone: 'Asia/Bangkok',
      }),
    }),
    assessment: Object.freeze({
      readyForLive: true,
      repositoryReady: true,
      sourceReady: true,
      windows: Object.freeze([1, 3, 7, 30].map((windowDays) => Object.freeze({
        windowDays,
        action: 'create_materialization',
      }))),
    }),
  });
}

function reviewedHandoff(platformScope = 'youtube') {
  return Object.freeze({
    contractVersion: 'multichannel_report_live_closure_handoff_v1',
    liveMaterializationAuthorized: true,
    repository: Object.freeze({ branch: 'main', clean: true, head: HEAD, reviewedHead: HEAD }),
    metaRemoteLock: Object.freeze({ released: true, auditHead: HEAD }),
    channelReadiness: Object.freeze({
      [platformScope]: reviewedReadiness(platformScope),
    }),
    closeoutAuthority: Object.freeze({
      operator: 'scripts/report-runtime-closeout-reviewed-multiwindow.mjs',
      contractVersion: 'report_runtime_closeout_uat_v1',
      platformScope,
      capability: CAPABILITIES[platformScope],
    }),
  });
}

test('argument parser accepts exactly the five ready channels and their capabilities', () => {
  for (const [platformScope, capability] of Object.entries(CAPABILITIES)) {
    assert.deepEqual(parseReportLiveClosureArgs([
      `--platform=${platformScope}`,
      `--capability=${capability}`,
    ]), { execute: false, platformScope, capability });
  }
  assert.throws(
    () => parseReportLiveClosureArgs(['--platform=meta_ads']),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_PLATFORM_INVALID',
  );
  assert.throws(
    () => parseReportLiveClosureArgs(['--platform=woocommerce', '--capability=organic']),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_CAPABILITY_INVALID',
  );
});

test('default plan performs zero reads and exposes reviewed prerequisites', async () => {
  const plan = await buildReadyChannelPlan({ env: {}, argv: ['--platform=facebook'] });
  assert.equal(plan.frameworkStatus, 'READY');
  assert.equal(plan.platformScope, 'facebook');
  assert.equal(plan.capability, 'organic');
  assert.equal(plan.channelStatus, 'READY_FOR_LIVE_AUDIT');
  assert.equal(plan.reviewedReadinessRequired, true);
  assert.equal(plan.exactSourceWatermarkRequired, true);
  assert.deepEqual(plan.identities, []);
  assert.match(plan.exactLiveCommand, /MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE=facebook/u);
  assert.equal(plan.remoteWriteCount, 0);
  assert.equal(plan.queueActionCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
});

test('reviewed readiness produces exact 1/3/7/30 identities for every ready channel', async () => {
  for (const [platformScope, capability] of Object.entries(CAPABILITIES)) {
    const plan = await buildReadyChannelPlan({
      env: {},
      argv: [`--platform=${platformScope}`, `--capability=${capability}`],
      reviewedReadiness: reviewedReadiness(platformScope),
      requestedAt: REQUESTED_AT,
      periodEnd: '2026-08-01',
    });
    assert.equal(plan.platformScope, platformScope);
    assert.deepEqual(plan.identities.map((identity) => identity.windowDays), [1, 3, 7, 30]);
  }
});

test('watermarkDate is never substituted for exact sourceWatermark', async () => {
  await assert.rejects(
    buildReadyChannelPlan({
      env: {},
      argv: ['--platform=chatwoot'],
      reviewedReadiness: reviewedReadiness('chatwoot', { includeSourceWatermark: false }),
      requestedAt: REQUESTED_AT,
      periodEnd: '2026-08-01',
    }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_TARGET_INVALID'
      && error.details.field === 'source.sourceWatermark',
  );
});

test('execute requires explicit confirmation before shared delegation', async () => {
  await assert.rejects(
    buildReadyChannelPlan({
      env: {},
      argv: ['--platform=woocommerce', '--execute'],
      reviewedHandoff: reviewedHandoff('woocommerce'),
    }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_CONFIRMATION_REQUIRED',
  );
});

test('valid retained handoff delegates selected channel to the reviewed shared operator', async () => {
  let calls = 0;
  const result = await buildReadyChannelPlan({
    env: { CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE: MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION },
    argv: ['--platform=chatwoot', '--capability=customer_service', '--execute'],
    reviewedHandoff: reviewedHandoff('chatwoot'),
    executeSharedOperator: async ({ handoff, platformScope }) => {
      calls += 1;
      assert.equal(handoff.metaRemoteLock.released, true);
      assert.equal(platformScope, 'chatwoot');
      return { ok: true, decision: 'CHATWOOT_REPORT_1_3_7_30_CLOSED', token: 'removed' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.delegatedToSharedOperator, true);
  assert.equal(result.sharedOperator, 'scripts/report-runtime-closeout-reviewed-multiwindow.mjs');
  assert.equal(result.decision, 'CHATWOOT_REPORT_1_3_7_30_CLOSED');
  assert.equal(Object.hasOwn(result, 'token'), false);
});

test('YouTube compatibility export keeps the original first-adopter default', async () => {
  const plan = await buildYouTubeFirstAdopterPlan({ env: {}, argv: [] });
  assert.equal(plan.platformScope, 'youtube');
  assert.equal(plan.capability, 'organic');
});

test('retained handoff loader rejects nested credential fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'report-closure-handoff-'));
  const path = join(directory, 'handoff.json');
  try {
    await writeFile(path, JSON.stringify({
      ...reviewedHandoff('facebook'), nested: { values: [{ authorization: 'Bearer secret' }] },
    }));
    await assert.rejects(
      loadReviewedHandoff({ MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: path }),
      (error) => error.code === 'REPORT_LIVE_CLOSURE_HANDOFF_NOT_SANITIZED',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
