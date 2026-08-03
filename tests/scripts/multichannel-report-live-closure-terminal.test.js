import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
  buildYouTubeFirstAdopterPlan,
  loadReviewedHandoff,
} from '../../scripts/multichannel-report-live-closure-terminal.mjs';

const HEAD = 'b'.repeat(40);
const REQUESTED_AT = Date.parse('2026-08-02T12:00:00Z');
const TERMINAL_PATH = resolve('scripts/multichannel-report-live-closure-terminal.mjs');

function reviewedReadiness({ includeSourceWatermark = true } = {}) {
  return Object.freeze({
    contractVersion: 'youtube_report_remote_readiness_reviewed_terminal_v1',
    ok: true,
    evidence: Object.freeze({
      target: Object.freeze({
        environment: 'development',
        customerProfile: 'integration_workspace',
        accountKey: 'chemistry_k',
        platformScope: 'youtube',
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
        contentCoverageStatus: 'completed',
        failureCount: 0,
        contentEntityCount: 837,
        watermarkDate: '2026-08-01',
        ...(includeSourceWatermark ? { sourceWatermark: 'youtube-watermark-2026-08-01' } : {}),
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

function reviewedHandoff({ includeSourceWatermark = true } = {}) {
  return Object.freeze({
    contractVersion: 'multichannel_report_live_closure_handoff_v1',
    liveMaterializationAuthorized: true,
    repository: Object.freeze({ branch: 'main', clean: true, head: HEAD, reviewedHead: HEAD }),
    metaRemoteLock: Object.freeze({ released: true, auditHead: HEAD }),
    youtubeIdentity: Object.freeze({ accountId: 'UCAwEENovvqZWosKhJWTS5Kg' }),
    youtubeReadiness: reviewedReadiness({ includeSourceWatermark }),
    closeoutAuthority: Object.freeze({
      operator: 'scripts/report-runtime-closeout-operator.mjs',
      contractVersion: 'report_runtime_closeout_uat_v1',
      platformScope: 'youtube',
      capability: 'organic',
    }),
  });
}

test('spawned terminal defaults to JSON plan-only with zero Remote actions', () => {
  const result = spawnSync(process.execPath, [TERMINAL_PATH], {
    encoding: 'utf8',
    shell: false,
  });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.mode, 'PLAN_ONLY');
  assert.equal(plan.frameworkStatus, 'READY');
  assert.equal(plan.reviewedReadinessRequired, true);
  assert.equal(plan.remoteWriteCount, 0);
  assert.equal(plan.queueActionCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
});

test('default plan performs zero reads and exposes reviewed prerequisites', async () => {
  const plan = await buildYouTubeFirstAdopterPlan({ env: {}, argv: [] });
  assert.equal(plan.frameworkStatus, 'READY');
  assert.equal(plan.firstAdopter, 'youtube');
  assert.equal(plan.youtubeStatus, 'READY_FOR_LIVE_AUDIT');
  assert.equal(plan.reviewedReadinessRequired, true);
  assert.equal(plan.exactSourceWatermarkRequired, true);
  assert.deepEqual(plan.identities, []);
  assert.match(plan.readOnlyAssessmentCommand, /youtube-report-remote-readiness-reviewed-terminal/u);
  assert.match(plan.sharedOperatorReviewCommand, /youtube-shared-report-closeout-review/u);
  assert.match(plan.exactLiveCommand, /MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE=youtube/u);
  assert.doesNotMatch(plan.exactLiveCommand, /MKT_META_REMOTE_LOCK_RELEASED/u);
  assert.equal(plan.remoteWriteCount, 0);
  assert.equal(plan.queueActionCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
});

test('reviewed readiness produces exact existing 1/3/7/30 identities without writes', async () => {
  const plan = await buildYouTubeFirstAdopterPlan({
    env: {},
    argv: [],
    reviewedReadiness: reviewedReadiness(),
    accountId: 'UCAwEENovvqZWosKhJWTS5Kg',
    requestedAt: REQUESTED_AT,
    periodEnd: '2026-08-01',
  });
  assert.equal(plan.youtubeStatus, 'READY_FOR_LIVE_AUDIT');
  assert.deepEqual(plan.identities.map((identity) => identity.windowDays), [1, 3, 7, 30]);
});

test('watermarkDate is never substituted for exact sourceWatermark', async () => {
  await assert.rejects(
    buildYouTubeFirstAdopterPlan({
      env: {}, argv: [], reviewedReadiness: reviewedReadiness({ includeSourceWatermark: false }),
      accountId: 'UCAwEENovvqZWosKhJWTS5Kg', requestedAt: REQUESTED_AT, periodEnd: '2026-08-01',
    }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_TARGET_INVALID'
      && error.details.field === 'source.sourceWatermark',
  );
});

test('execute requires explicit confirmation before shared delegation', async () => {
  await assert.rejects(
    buildYouTubeFirstAdopterPlan({ env: {}, argv: ['--execute'], reviewedHandoff: reviewedHandoff() }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_CONFIRMATION_REQUIRED',
  );
});

test('valid retained handoff delegates to the reviewed shared operator', async () => {
  let calls = 0;
  const result = await buildYouTubeFirstAdopterPlan({
    env: { CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE: MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION },
    argv: ['--platform=youtube', '--capability=organic', '--execute'],
    reviewedHandoff: reviewedHandoff(),
    executeSharedOperator: async ({ handoff }) => {
      calls += 1;
      assert.equal(handoff.metaRemoteLock.released, true);
      return { ok: true, decision: 'YOUTUBE_REPORT_1_3_7_30_CLOSED', token: 'removed' };
    },
  });
  assert.equal(calls, 1);
  assert.equal(result.delegatedToSharedOperator, true);
  assert.equal(result.sharedOperator, 'scripts/report-runtime-closeout-operator.mjs');
  assert.equal(result.decision, 'YOUTUBE_REPORT_1_3_7_30_CLOSED');
  assert.equal(Object.hasOwn(result, 'token'), false);
});

test('execute rejects retained handoff without exact sourceWatermark before delegation', async () => {
  await assert.rejects(
    buildYouTubeFirstAdopterPlan({
      env: { CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE: MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION },
      argv: ['--platform=youtube', '--capability=organic', '--execute'],
      reviewedHandoff: reviewedHandoff({ includeSourceWatermark: false }),
      executeSharedOperator: async () => ({ ok: true }),
    }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_TARGET_INVALID'
      && error.details.field === 'youtubeReadiness.evidence.source.sourceWatermark',
  );
});

test('retained handoff loader rejects nested credential fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'report-closure-handoff-'));
  const path = join(directory, 'handoff.json');
  try {
    await writeFile(path, JSON.stringify({
      ...reviewedHandoff(), nested: { values: [{ authorization: 'Bearer secret' }] },
    }));
    await assert.rejects(
      loadReviewedHandoff({ MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: path }),
      (error) => error.code === 'REPORT_LIVE_CLOSURE_HANDOFF_NOT_SANITIZED',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});