import test from 'node:test';
import assert from 'node:assert/strict';
import {
  reviewYouTubeSharedReportCloseoutOperator,
} from '../../scripts/lib/youtube-shared-report-closeout-review.js';
import {
  runYouTubeSharedCloseoutReview,
} from '../../scripts/youtube-shared-report-closeout-review.mjs';

const HEAD = 'c'.repeat(40);
const REQUESTED_AT = Date.parse('2026-08-03T04:00:00Z');

function handoff({ includeSourceWatermark = true } = {}) {
  return Object.freeze({
    contractVersion: 'multichannel_report_live_closure_handoff_v1',
    liveMaterializationAuthorized: true,
    repository: Object.freeze({ branch: 'main', clean: true, head: HEAD, reviewedHead: HEAD }),
    metaRemoteLock: Object.freeze({ released: true, auditHead: HEAD }),
    youtubeIdentity: Object.freeze({ accountId: 'UCAwEENovvqZWosKhJWTS5Kg' }),
    youtubeReadiness: Object.freeze({
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
          accountCoverageStatus: 'completed',
          failureCount: 0,
          contentEntityCount: 837,
          contentStateCount: 837,
          observationCount: 837,
          accountFactCount: 1,
          watermarkDate: '2026-08-01',
          ...(includeSourceWatermark ? { sourceWatermark: 'youtube-coverage-2026-08-01' } : {}),
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
    }),
    closeoutAuthority: Object.freeze({
      operator: 'scripts/report-runtime-closeout-operator.mjs',
      contractVersion: 'report_runtime_closeout_uat_v1',
      platformScope: 'youtube',
      capability: 'organic',
    }),
  });
}

test('reviews exact shared identities but keeps executable YouTube extension blocked', () => {
  const result = reviewYouTubeSharedReportCloseoutOperator({
    handoff: handoff(),
    requestedAt: REQUESTED_AT,
  });
  assert.equal(result.ok, true);
  assert.equal(result.contractCompatible, true);
  assert.equal(result.executableReady, false);
  assert.equal(result.reviewStatus, 'OPERATOR_EXTENSION_REQUIRED');
  assert.deepEqual(result.reviewedWindows.map((row) => row.windowDays), [1, 3, 7, 30]);
  assert.deepEqual(result.candidateWindows.map((row) => row.windowDays), [1, 3, 7, 30]);
  assert.deepEqual(result.candidateWindows.map((row) => row.reportSettingKey), [
    'integration_workspace:youtube:rolling:1d',
    'integration_workspace:youtube:rolling:3d',
    'integration_workspace:youtube:rolling:7d',
    'integration_workspace:youtube:rolling:30d',
  ]);
  assert.deepEqual(result.blockers.map((row) => row.code), [
    'REPORT_RUNTIME_CLOSEOUT_YOUTUBE_TARGET_SELECTOR_UNBOUND',
    'REPORT_RUNTIME_CLOSEOUT_YOUTUBE_D1_PREFLIGHT_UNBOUND',
    'REPORT_RUNTIME_CLOSEOUT_REVIEWED_HANDOFF_UNBOUND',
    'REPORT_RUNTIME_CLOSEOUT_MULTIWINDOW_EXECUTION_UNBOUND',
  ]);
  assert.equal(result.remoteMutationCount, 0);
  assert.equal(result.queueActionCount, 0);
  assert.equal(result.workerDeploymentCount, 0);
});

test('does not substitute watermarkDate for exact sourceWatermark', () => {
  const result = reviewYouTubeSharedReportCloseoutOperator({
    handoff: handoff({ includeSourceWatermark: false }),
    requestedAt: REQUESTED_AT,
  });
  assert.equal(result.contractCompatible, false);
  assert.equal(result.candidateWindows.length, 0);
  assert.equal(result.blockers[0].code, 'REPORT_RUNTIME_CLOSEOUT_REVIEWED_SOURCE_WATERMARK_MISSING');
});

test('rejects non-reviewed handoff before compatibility claims', () => {
  assert.throws(
    () => reviewYouTubeSharedReportCloseoutOperator({
      handoff: { ...handoff(), metaRemoteLock: { released: false, auditHead: HEAD } },
      requestedAt: REQUESTED_AT,
    }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_REVIEWED_HANDOFF_INVALID',
  );
});

test('review terminal defaults to zero-Remote plan', async () => {
  const plan = await runYouTubeSharedCloseoutReview({ env: {}, argv: [] });
  assert.equal(plan.planOnly, true);
  assert.match(plan.command, /youtube-shared-report-closeout-review\.mjs --execute/u);
  assert.equal(plan.remoteReadCount, 0);
  assert.equal(plan.remoteMutationCount, 0);
  assert.equal(plan.queueActionCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
  assert.equal(plan.production, 'BLOCKED');
});

test('review terminal requires explicit confirmation', async () => {
  await assert.rejects(
    runYouTubeSharedCloseoutReview({ env: {}, argv: ['--execute'] }),
    (error) => error.code === 'YOUTUBE_SHARED_REPORT_CLOSEOUT_REVIEW_CONFIRMATION_REQUIRED',
  );
});
