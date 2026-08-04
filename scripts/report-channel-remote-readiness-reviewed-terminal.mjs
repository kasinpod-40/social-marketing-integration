#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { sanitizeReportLiveClosureEvidence } from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  assertReportRuntimeFinalizerEvidence,
  buildReportRuntimeCloseoutCandidates,
  buildReportRuntimeCloseoutConfigWindow,
} from './lib/report-runtime-closeout-operator.js';
import {
  REPORT_RUNTIME_REVIEWED_CHANNELS,
  REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS,
  assertReviewedReportRuntimeCloseoutPreflight,
  resolveReviewedReportRuntimeCloseoutTarget,
} from './lib/report-runtime-closeout-channel-binding.js';
import { buildReportRuntimePreflightSql } from './lib/report-runtime-closeout-reviewed-binding.js';
import {
  assertReviewedRepositoryState,
  createCommandRunner,
  sha256,
  writePrivateJson,
} from './lib/report-runtime-closeout-reviewed-process.js';
import {
  createReviewedRemoteRuntime,
  resolveReviewedCloudflareSession,
} from './lib/report-runtime-closeout-reviewed-remote.js';
import {
  assertD1LarkIntegrity,
  createReviewedStateRuntime,
} from './lib/report-runtime-closeout-reviewed-state.js';
import {
  REPORT_CHANNEL_REMOTE_READINESS_CONFIRMATION,
  REPORT_CHANNEL_REMOTE_READINESS_CONTRACT,
  assessReportChannelRemoteReadiness,
  buildReportChannelWindowAssessment,
  parseReportChannelReadinessArgs,
} from './lib/report-channel-remote-readiness.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? 'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
);
const REQUIRED_LARK_KEY_FIELDS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
  mktReportTopContent: 'report_content_key',
  mktSyncLog: 'sync_id',
  mktSystemAlerts: 'alert_id',
});

let stage = 'init';

try {
  const options = parseReportChannelReadinessArgs(process.argv.slice(2));
  const platformScope = options.platformScope
    ?? String(process.env.MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE ?? 'youtube').trim().toLowerCase();
  if (!REPORT_RUNTIME_REVIEWED_CHANNELS.includes(platformScope)) throw terminalError(
    `Unsupported ready Report channel: ${platformScope}`,
    'REPORT_CHANNEL_REMOTE_READINESS_PLATFORM_INVALID',
    { platformScope, supportedPlatforms: REPORT_RUNTIME_REVIEWED_CHANNELS },
  );
  const target = resolveReviewedReportRuntimeCloseoutTarget({
    ...process.env,
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: platformScope,
  });
  if (!options.execute) printPlan(target);
  else await executeReadiness(target);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage,
    code: error?.code ?? 'REPORT_CHANNEL_REMOTE_READINESS_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan(target) {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: REPORT_CHANNEL_REMOTE_READINESS_CONTRACT,
    platformScope: target.platformScope,
    capability: target.capability,
    command: [
      `MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE=${target.platformScope}`,
      `CONFIRM_REPORT_CHANNEL_REMOTE_READINESS=${REPORT_CHANNEL_REMOTE_READINESS_CONFIRMATION}`,
      `node scripts/report-channel-remote-readiness-reviewed-terminal.mjs --platform=${target.platformScope} --execute`,
    ].join(' \\\n'),
    stages: [
      'repository-and-finalizer',
      'remote-worker-safe-read-only',
      'd1-source-and-runtime-select-only',
      'lark-schema-and-report-read-only',
      '1-3-7-30-action-assessment',
      'sanitized-readiness-evidence',
    ],
    windows: REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS,
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    liveMaterializationAuthorized: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function executeReadiness(target) {
  stage = 'confirmation';
  if (process.env.CONFIRM_REPORT_CHANNEL_REMOTE_READINESS
    !== REPORT_CHANNEL_REMOTE_READINESS_CONFIRMATION) throw terminalError(
    `Execution requires CONFIRM_REPORT_CHANNEL_REMOTE_READINESS=${REPORT_CHANNEL_REMOTE_READINESS_CONFIRMATION}`,
    'REPORT_CHANNEL_REMOTE_READINESS_CONFIRMATION_REQUIRED',
  );

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  const outputRoot = resolve(
    env.MKT_REPORT_CHANNEL_REMOTE_READINESS_EVIDENCE_DIR
      ?? `outputs/${target.platformScope}-report-remote-readiness`,
  );
  const runner = createCommandRunner({ execFileAsync, cwd: repositoryRoot, baseEnv: process.env });

  stage = 'repository-and-finalizer';
  const repository = await assertReviewedRepositoryState(runner);
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository.head !== repository.head) throw terminalError(
    'Report readiness requires finalizer evidence from the current main HEAD',
    'REPORT_CHANNEL_REMOTE_READINESS_FINALIZER_HEAD_MISMATCH',
  );

  const sourceText = await readFile(configPath, 'utf8');
  const config = buildReportRuntimeCloseoutConfigWindow(sourceText, {
    activeTrueFlags: target.activeTrueFlags,
  });
  const auth = await resolveReviewedCloudflareSession({ env, sourceText, runText: runner.runText });
  const remote = createReviewedRemoteRuntime({
    ...runner,
    configPath,
    repositoryRoot,
    env,
    repositoryHead: repository.head,
    target,
    requiredTables: REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
    config,
  });
  const state = createReviewedStateRuntime({
    ...runner,
    repositoryRoot,
    outputRoot,
    configPath,
    env,
    target,
    requiredLarkKeyFields: REQUIRED_LARK_KEY_FIELDS,
  });

  stage = 'remote-worker-safe-read-only';
  const remoteSafe = await remote.verifyDeployment('safe');

  stage = 'd1-source-and-runtime-select-only';
  const d1Preflight = await state.readD1Row(buildReportRuntimePreflightSql({
    target: { ...target, customerKey: 'chemistry_k' },
  }));
  let sourceReady = true;
  let sourceFailureCode = null;
  try {
    assertReviewedReportRuntimeCloseoutPreflight(d1Preflight, target);
  } catch (error) {
    sourceReady = false;
    sourceFailureCode = error?.code ?? 'REPORT_RUNTIME_CLOSEOUT_D1_PREFLIGHT_NOT_READY';
  }
  const pendingMigrations = await state.readPendingMigrations();

  stage = 'lark-schema-and-report-read-only';
  const client = createLarkBitableClientFromEnv(env);
  const larkInventory = await state.verifyLarkInventory(client, config.tableIds);
  const requestedAt = Date.now();
  const periodEnd = String(d1Preflight.period_end ?? '');
  const sourceWatermark = String(d1Preflight.source_watermark ?? '');
  const candidates = sourceReady
    ? buildReportRuntimeCloseoutCandidates({
      requestedAt,
      periodEnd,
      sourceWatermark,
      timeZone: 'Asia/Bangkok',
      platformScope: target.platformScope,
      accountKey: target.accountKey,
      formulaVersion: target.formulaVersion,
    }).filter((candidate) => REPORT_RUNTIME_REVIEWED_MULTIWINDOW_DAYS.includes(candidate.windowDays))
    : [];

  const windows = [];
  for (const candidate of candidates) {
    const d1 = await state.readD1Snapshot(candidate, requestedAt);
    const lark = await state.readLarkReportState(client, config.tableIds, candidate.reportId);
    let integrityOk = false;
    if (Number(d1.materialization_count ?? 0) === 1) {
      try {
        assertD1LarkIntegrity(d1, lark);
        integrityOk = true;
      } catch {
        integrityOk = false;
      }
    }
    windows.push(buildReportChannelWindowAssessment({
      windowDays: candidate.windowDays,
      d1,
      lark,
      integrityOk,
    }));
  }

  stage = '1-3-7-30-action-assessment';
  const runtime = Object.freeze({
    allExecutionFlagsFalse: remoteSafe.trueFlags.length === 0,
    pendingMigrationCount: pendingMigrations.length,
    activeReportWorkCount: 0,
    activeReportLockCount: Number(d1Preflight.active_report_locks ?? 0),
    openReportDlqCount: Number(d1Preflight.open_report_dlq ?? 0),
    openReportCriticalAlertCount: Number(d1Preflight.open_report_critical_alerts ?? 0),
  });
  const source = Object.freeze({
    ready: sourceReady,
    failureCode: sourceFailureCode,
    coverageStatus: d1Preflight.coverage_status ?? null,
    coverageScopeMode: d1Preflight.coverage_scope_mode ?? null,
    failureCount: sourceReady ? 0 : 1,
    sourceWatermark: sourceWatermark || null,
    watermarkDate: periodEnd || null,
    reportingTimezone: 'Asia/Bangkok',
    contentStateCount: Number(d1Preflight.content_state_count ?? 0),
    observationCount: Number(d1Preflight.observation_count ?? 0),
    dailyFactCount: Number(d1Preflight.daily_fact_count ?? 0),
    orderStateCount: Number(d1Preflight.order_state_count ?? 0),
    conversationFactCount: Number(d1Preflight.conversation_fact_count ?? 0),
    accountFactCount: Number(d1Preflight.account_fact_count ?? 0),
  });
  const lark = Object.freeze({
    tablesReady: true,
    stableKeysReady: true,
    tableCount: larkInventory.tableCount,
    fieldCountFingerprint: larkInventory.fieldCountFingerprint,
  });
  const assessment = assessReportChannelRemoteReadiness({
    repository,
    runtime,
    source,
    lark,
    windows,
  });

  stage = 'sanitized-readiness-evidence';
  const summary = sanitizeReportLiveClosureEvidence({
    ok: assessment.readyForLive,
    contractVersion: REPORT_CHANNEL_REMOTE_READINESS_CONTRACT,
    evidence: {
      target: {
        environment: 'development',
        customerProfile: 'integration_workspace',
        accountKey: target.accountKey,
        platformScope: target.platformScope,
        capability: target.capability,
      },
      repository,
      catalog: {
        datasetKey: target.datasetKey,
        formulaVersion: target.formulaVersion,
      },
      runtime,
      source,
      lark,
      windows,
      remoteSafeFingerprint: sha256(`${repository.head}:${target.platformScope}:${remoteSafe.mode}`),
    },
    assessment,
    providerRequestCount: 0,
    queueActionCount: 0,
    remoteMutationCount: 0,
    workerDeploymentCount: 0,
    liveMaterializationAuthorized: false,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  const evidencePath = join(outputRoot, 'readiness-summary.json');
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await writePrivateJson(evidencePath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath }, null, 2)}\n`);
  if (!assessment.readyForLive) process.exitCode = 2;
}

function terminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportChannelRemoteReadinessTerminalError';
  error.code = code;
  error.details = details;
  return error;
}
