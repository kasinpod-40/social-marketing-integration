import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmod, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import {
  MULTICHANNEL_REPORT_LIVE_CLOSURE_CONFIRMATION,
  MULTICHANNEL_REPORT_LIVE_CLOSURE_EXIT_CODE_CONTRACT,
  buildYouTubeFirstAdopterPlan,
  loadReviewedHandoff,
  resolveChildDevVarsPath,
} from '../../scripts/multichannel-report-live-closure-terminal.mjs';
import {
  OPERATOR_TERMINAL_EXIT_CODES,
} from '../../scripts/lib/operator-terminal-reliability.js';

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
  assert.equal(plan.localAcceptanceCommand, 'node scripts/multichannel-report-live-closure-acceptance.mjs');
  assert.equal(plan.readOnlyAssessmentCommand.shell, false);
  assert.equal(plan.sharedOperatorReviewCommand.shell, false);
  assert.equal(plan.liveCommand.shell, false);
  assert.equal(plan.liveCommandAuthorized, false);
  assert.equal(plan.exitCodeContract['0'], 'success_with_reviewed_completion_evidence');
  assert.equal(plan.exitCodeContract['2'], 'precheck_blocked_before_shared_operator_execution');
  assert.equal(plan.exitCodeContract['1'], 'shared_operator_execution_failure_with_safe_restore_evidence');
  assert.equal(plan.completionAuthorities.sameInputReplay,
    'shared_reviewed_multiwindow_same_input_replay_zero_drift');
  assert.equal(plan.completionAuthorities.safeRestore,
    'shared_reviewed_multiwindow_finally_all_false_restore');
  assert.equal(plan.remoteWriteCount, 0);
  assert.equal(plan.queueActionCount, 0);
  assert.equal(plan.workerDeploymentCount, 0);
  assert.equal(plan.scheduleEnabled, false);
  assert.equal(plan.production, 'BLOCKED');
});

test('spawned terminal blocks before delegation with exact exit 2', () => {
  const result = spawnSync(process.execPath, [
    TERMINAL_PATH,
    '--platform=youtube',
    '--capability=organic',
    '--execute',
  ], {
    encoding: 'utf8',
    shell: false,
    env: {
      ...process.env,
      CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE: '',
    },
  });
  assert.equal(result.status, OPERATOR_TERMINAL_EXIT_CODES.precheckBlocked, result.stdout);
  const failure = JSON.parse(result.stderr);
  assert.equal(failure.ok, false);
  assert.equal(failure.stage, 'confirmation');
  assert.equal(failure.code, 'REPORT_LIVE_CLOSURE_CONFIRMATION_REQUIRED');
  assert.equal(failure.exitClass, 'PRECHECK_BLOCKED');
  assert.equal(failure.sharedOperatorStarted, false);
  assert.deepEqual(failure.exitCodeContract, MULTICHANNEL_REPORT_LIVE_CLOSURE_EXIT_CODE_CONTRACT);
  assert.equal(failure.remoteWriteCount, 0);
  assert.equal(failure.queueActionCount, 0);
  assert.equal(failure.workerDeploymentCount, 0);
});

test('default plan performs zero reads and exposes reviewed prerequisites', async () => {
  const plan = await buildYouTubeFirstAdopterPlan({ env: {}, argv: [] });
  assert.equal(plan.frameworkStatus, 'READY');
  assert.equal(plan.firstAdopter, 'youtube');
  assert.equal(plan.youtubeStatus, 'READY_FOR_LIVE_AUDIT');
  assert.equal(plan.reviewedReadinessRequired, true);
  assert.equal(plan.exactSourceWatermarkRequired, true);
  assert.deepEqual(plan.identities, []);
  assert.equal(plan.readOnlyAssessmentCommand.executable, 'node');
  assert.ok(plan.readOnlyAssessmentCommand.args.includes(
    'scripts/youtube-report-remote-readiness-reviewed-terminal.mjs'));
  assert.ok(plan.sharedOperatorReviewCommand.args.includes(
    'scripts/youtube-shared-report-closeout-review.mjs'));
  assert.ok(plan.liveCommand.args.includes(
    'scripts/multichannel-report-live-closure-terminal.mjs'));
  assert.ok(plan.liveCommand.requiredEnv.includes('MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE'));
  assert.ok(plan.liveCommand.requiredEnv.includes('MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF'));
  assert.ok(plan.liveCommand.requiredEnv.includes('CONFIRM_MULTICHANNEL_REPORT_LIVE_CLOSURE'));
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
  assert.equal(result.sharedOperator, 'scripts/report-runtime-closeout-reviewed-multiwindow.mjs');
  assert.equal(result.decision, 'YOUTUBE_REPORT_1_3_7_30_CLOSED');
  assert.equal(Object.hasOwn(result, 'token'), false);
  assert.deepEqual(result.exitCodeContract, MULTICHANNEL_REPORT_LIVE_CLOSURE_EXIT_CODE_CONTRACT);
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

test('retained handoff loader rejects nested credential fields after private-mode validation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'report-closure-handoff-'));
  const path = join(directory, 'handoff.json');
  try {
    await writeFile(path, JSON.stringify({
      ...reviewedHandoff(), nested: { values: [{ authorization: 'Bearer secret' }] },
    }), { mode: 0o600 });
    await chmod(path, 0o600);
    await assert.rejects(
      loadReviewedHandoff({ MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: path }),
      (error) => error.code === 'REPORT_LIVE_CLOSURE_HANDOFF_NOT_SANITIZED',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('retained handoff loader rejects a non-private evidence file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'report-closure-handoff-mode-'));
  const path = join(directory, 'handoff.json');
  try {
    await writeFile(path, JSON.stringify(reviewedHandoff()), { mode: 0o644 });
    await chmod(path, 0o644);
    await assert.rejects(
      loadReviewedHandoff({ MKT_MULTICHANNEL_REPORT_LIVE_CLOSURE_HANDOFF: path }),
      (error) => error.code === 'REPORT_LIVE_CLOSURE_HANDOFF_LOAD_FAILED'
        && error.details.sourceCode === 'OPERATOR_TERMINAL_FILE_MODE_INVALID',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('missing child .dev.vars becomes one temporary private empty file', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'report-closure-child-env-'));
  try {
    const path = await resolveChildDevVarsPath({
      DEV_VARS_FILE: join(directory, 'missing.dev.vars'),
    }, directory);
    assert.equal(await readFile(path, 'utf8'), '');
    const file = await stat(path);
    assert.equal(file.mode & 0o777, 0o600);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test('existing child .dev.vars must use exact private mode 0600', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'report-closure-child-env-mode-'));
  const path = join(directory, '.dev.vars');
  try {
    await writeFile(path, 'LARK_APP_ID=value\n', { mode: 0o644 });
    await chmod(path, 0o644);
    await assert.rejects(
      resolveChildDevVarsPath({ DEV_VARS_FILE: path }, directory),
      (error) => error.code === 'REPORT_LIVE_CLOSURE_DEV_VARS_MODE_INVALID',
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});