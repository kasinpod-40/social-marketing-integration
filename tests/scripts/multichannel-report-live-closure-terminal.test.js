import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
  buildYouTubeFirstAdopterPlan,
  loadReviewedHandoff,
} from '../../scripts/multichannel-report-live-closure-terminal.mjs';

const HEAD = 'b'.repeat(40);
const REQUESTED_AT = Date.parse('2026-08-02T12:00:00Z');

function reviewedReadiness() {
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

function reviewedHandoff() {
  return Object.freeze({
    contractVersion: 'multichannel_report_live_closure_handoff_v1',
    liveMaterializationAuthorized: true,
    repository: Object.freeze({ branch: 'main', clean: true, head: HEAD, reviewedHead: HEAD }),
    metaRemoteLock: Object.freeze({ released: true, auditHead: HEAD }),
    youtubeIdentity: Object.freeze({ accountId: 'UCAwEENovvqZWosKhJWTS5Kg' }),
    youtubeReadiness: reviewedReadiness(),
    closeoutAuthority: Object.freeze({
      operator: 'scripts/report-runtime-closeout-operator.mjs',
      contractVersion: 'report_runtime_closeout_uat_v1',
      platformScope: 'youtube',
      capability: 'organic',
    }),
  });
}

test('default plan performs zero reads and exposes the reviewed read-only prerequisite', async () => {
  const plan = await buildYouTubeFirstAdopterPlan({ env: {}, argv: [] });
  assert.equal(plan.frameworkStatus, 'READY');
  assert.equal(plan.firstAdopter, 'youtube');
  assert.equal(plan.youtubeStatus, 'READY_FOR_LIVE_AUDIT');
  assert.equal(plan.reviewedReadinessRequired, true);
  assert.deepEqual(plan.identities, []);
  assert.match(plan.readOnlyAssessmentCommand, /youtube-report-remote-readiness-reviewed-terminal/u);
  assert.doesNotMatch(plan.exactLiveCommand, /MKT_META_REMOTE_LOCK_RELEASED/u);
  assert.match(plan.exactLiveCommand, /MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF/u);
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
    sourceWatermark: 'youtube-watermark-2026-08-01',
  });
  assert.equal(plan.youtubeStatus, 'READY_FOR_LIVE_AUDIT');
  assert.deepEqual(plan.identities.map((identity) => identity.windowDays), [1, 3, 7, 30]);
  assert.deepEqual(plan.identities.map((identity) => identity.reportSettingKey), [
    'integration_workspace:youtube:rolling:1d',
    'integration_workspace:youtube:rolling:3d',
    'integration_workspace:youtube:rolling:7d',
    'integration_workspace:youtube:rolling:30d',
  ]);
});

test('execute requires explicit confirmation before reading retained handoff', async () => {
  await assert.rejects(
    buildYouTubeFirstAdopterPlan({
      env: {},
      argv: ['--execute'],
      reviewedHandoff: reviewedHandoff(),
    }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_CONFIRMATION_REQUIRED',
  );
});

test('valid retained handoff still blocks Live until shared YouTube closeout authority is reviewed', async () => {
  await assert.rejects(
    buildYouTubeFirstAdopterPlan({
      env: {
        CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE: MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
      },
      argv: ['--platform=youtube', '--capability=organic', '--execute'],
      reviewedHandoff: reviewedHandoff(),
    }),
    (error) => error.code === 'REPORT_LIVE_CLOSURE_SHARED_OPERATOR_YOUTUBE_NOT_REVIEWED',
  );
});

test('retained handoff loader rejects nested credential fields', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'report-closure-handoff-'));
  const path = join(directory, 'handoff.json');
  try {
    await writeFile(path, JSON.stringify({
      ...reviewedHandoff(),
      nested: { values: [{ authorization: 'Bearer secret' }] },
    }));
    await assert.rejects(
      loadReviewedHandoff({ MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: path }),
      (error) => error.code === 'REPORT_LIVE_CLOSURE_HANDOFF_NOT_SANITIZED',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
