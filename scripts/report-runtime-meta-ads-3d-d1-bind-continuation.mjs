#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { sanitizeReportLiveClosureEvidence } from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  assertReportRuntimeCloseoutCompletion,
  assertReportRuntimeCloseoutReplay,
  assertReportRuntimeFinalizerEvidence,
  buildReportRuntimeCloseoutCandidates,
} from './lib/report-runtime-closeout-operator.js';
import {
  resolveReviewedReportRuntimeCloseoutTarget,
} from './lib/report-runtime-closeout-channel-binding.js';
import {
  buildReportRuntimePreflightSql,
} from './lib/report-runtime-closeout-reviewed-binding.js';
import {
  assertReviewedRepositoryState,
  closeoutFailure,
  createCommandRunner,
  positiveInteger,
  sha256,
  sleep,
  stableJson,
  writePrivateJson,
  writeReviewedAttempt,
} from './lib/report-runtime-closeout-reviewed-process.js';
import {
  createReviewedRemoteRuntime,
  resolveReviewedCloudflareSession,
  resolveReviewedQueue,
  sendReviewedQueueMessage,
} from './lib/report-runtime-closeout-reviewed-remote.js';
import {
  assertD1LarkIntegrity,
  assertLarkReplay,
  createReviewedStateRuntime,
  summarizeLarkState,
} from './lib/report-runtime-closeout-reviewed-state.js';
import {
  assertReportRuntimeWindowChanged,
} from './lib/report-runtime-window-repair.js';
import {
  buildNotificationPreservingReportRuntimeConfigWindow,
} from './lib/report-runtime-notification-preserving-config.js';
import {
  META_ADS_3D_D1_BIND_CONTINUATION,
  META_ADS_3D_D1_BIND_CONTINUATION_CONTRACT,
  assertMetaAds3dContinuationCandidate,
  assertMetaAds3dContinuationPreflight,
  assertMetaAds3dDlqClosed,
  assertMetaAds3dDlqRow,
  assertMetaAds3dInitialState,
  assertMetaAds3dRetainedAttempt,
  assertMetaAds3dRootCauseEvidence,
  buildMetaAds3dClosureStatements,
  buildMetaAds3dContinuationPollSql,
  buildMetaAds3dDlqSql,
  buildMetaAds3dFailedRecoveryStateSql,
} from './lib/report-runtime-meta-ads-3d-d1-bind-continuation.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const incident = META_ADS_3D_D1_BIND_CONTINUATION;
const target = resolveReviewedReportRuntimeCloseoutTarget({
  MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: incident.platformScope,
});
const configPath = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_META_ADS_3D_CONTINUATION_EVIDENCE_DIR
    ?? incident.evidenceDirectory,
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? incident.finalizerDefault,
);
const retainedAttemptPath = resolve(incident.retainedAttemptPath);
const inspectorEntityPath = resolve(incident.inspectorEntityPath);
const inspectorDlqPath = resolve(incident.inspectorDlqPath);
const summaryPath = join(outputRoot, 'report-runtime-meta-ads-3d-continuation-summary.json');
const REQUIRED_LARK_KEY_FIELDS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
  mktReportTopContent: 'report_content_key',
  mktReportTopAds: 'report_ad_key',
  mktSyncLog: 'sync_id',
  mktSystemAlerts: 'alert_id',
});

let currentStage = 'init';
let activeDeploymentAttempted = false;
let baselineRestoreVerified = false;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
    incidentKey: incident.key,
    platformScope: incident.platformScope,
    windowDays: incident.windowDays,
    activeDeploymentAttempted,
    baselineRestoreVerified,
    providerRequestCount: 0,
    scheduleEnabled: false,
    notificationAdmissionEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  if (process.env.CONFIRM_REPORT_RUNTIME_META_ADS_3D_CONTINUATION !== incident.confirmation) {
    throw closeoutFailure(
      `Execution requires CONFIRM_REPORT_RUNTIME_META_ADS_3D_CONTINUATION=${incident.confirmation}`,
      'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_CONFIRMATION_REQUIRED',
      { incidentKey: incident.key },
    );
  }

  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const existingSummary = await readJsonIfExists(summaryPath);
  if (existingSummary) {
    if (existingSummary.ok !== true
      || existingSummary.contractVersion !== META_ADS_3D_D1_BIND_CONTINUATION_CONTRACT
      || existingSummary.incident?.incidentKey !== incident.key
      || existingSummary.incident?.closedDlqCount !== 2
      || existingSummary.runtime?.restoredBaseline !== true
      || existingSummary.runtime?.notificationAdmissionEnabled !== false) throw closeoutFailure(
      'Existing Meta Ads 3D continuation summary is incomplete',
      'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_SUMMARY_INVALID',
    );
    process.stdout.write(`${JSON.stringify({ ...existingSummary, evidencePath: summaryPath }, null, 2)}\n`);
    return;
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({
    ...fileEnv,
    ...process.env,
    MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS:
      process.env.MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS ?? '120',
  });
  const runner = createCommandRunner({ execFileAsync, cwd: repositoryRoot, baseEnv: process.env });

  currentStage = 'repository-finalizer-and-retained-evidence';
  const repository = await assertReviewedRepositoryState(runner);
  if (repository.head !== incident.requiredRepositoryHead) throw closeoutFailure(
    'Meta Ads 3D continuation requires the exact merged D1 projection and bind-chunk main',
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_HEAD_MISMATCH',
    { repositoryHead: repository.head, expectedHead: incident.requiredRepositoryHead },
  );
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository?.head !== repository.head) throw closeoutFailure(
    'Meta Ads 3D continuation requires Finalizer evidence from exact current main',
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_FINALIZER_HEAD_MISMATCH',
    {
      evidenceHead: finalizerEvidence.repository?.head ?? null,
      repositoryHead: repository.head,
    },
  );

  const retainedAttempt = JSON.parse(await readFile(retainedAttemptPath, 'utf8'));
  assertMetaAds3dRetainedAttempt(retainedAttempt, incident);
  const inspectorEntityText = await readFile(inspectorEntityPath, 'utf8');
  const inspectorDlqText = await readFile(inspectorDlqPath, 'utf8');
  const inspectorEntity = readSingleWranglerRow(inspectorEntityText, 'entity-bind inspector');
  const inspectorDlq = readSingleWranglerRow(inspectorDlqText, 'new-DLQ inspector');
  assertMetaAds3dRootCauseEvidence({ entity: inspectorEntity, dlq: inspectorDlq }, incident);

  const sourceText = await readFile(configPath, 'utf8');
  const config = buildNotificationPreservingReportRuntimeConfigWindow(sourceText, {
    activeTrueFlags: target.activeTrueFlags,
    finalizerEvidencePath,
    expectedRepositoryHead: repository.head,
  });
  const auth = await resolveReviewedCloudflareSession({ env, sourceText, runText: runner.runText });
  const queue = await resolveReviewedQueue({
    accountId: auth.accountId,
    token: auth.token,
    expectedName: config.mainQueueName,
  });
  const remoteInput = {
    ...runner,
    configPath,
    repositoryRoot,
    env,
    repositoryHead: repository.head,
    requiredTables: Object.freeze({
      ...REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
      ...config.workerRequiredTables,
    }),
    config: Object.freeze({ ...config, tableIds: config.workerTableIds }),
  };
  const baselineRemote = createReviewedRemoteRuntime({
    ...remoteInput,
    target: Object.freeze({ ...target, activeTrueFlags: config.safeTrueFlags }),
  });
  const activeRemote = createReviewedRemoteRuntime({
    ...remoteInput,
    target: Object.freeze({ ...target, activeTrueFlags: config.activeTrueFlags }),
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

  currentStage = 'exact-remote-continuation-read-only-preflight';
  const pendingMigrations = await state.readPendingMigrations();
  if (pendingMigrations.length !== 0) throw closeoutFailure(
    'Pending migrations block Meta Ads 3D continuation',
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_PENDING_MIGRATIONS',
    { pendingMigrationCount: pendingMigrations.length },
  );
  const preflight = await state.readD1Row(buildReportRuntimePreflightSql({
    target: { ...target, customerKey: 'chemistry_k' },
  }));
  assertMetaAds3dContinuationPreflight(preflight, incident);

  const dlqEvidence = [];
  for (const binding of incident.dlqs) {
    const row = await state.readD1Row(buildMetaAds3dDlqSql(binding));
    dlqEvidence.push(assertMetaAds3dDlqRow(row, binding, incident));
  }

  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: incident.requestedAt,
    periodEnd: incident.periodEnd,
    sourceWatermark: incident.sourceWatermark,
    timeZone: 'Asia/Bangkok',
    platformScope: incident.platformScope,
    accountKey: incident.accountKey,
    formulaVersion: incident.formulaVersion,
  });
  const selected = candidates.find((candidate) => candidate.windowDays === incident.windowDays);
  assertMetaAds3dContinuationCandidate(selected, incident);
  for (const evidence of dlqEvidence) {
    if (stableJson(selected.job) !== stableJson(evidence.replayPayload)) throw closeoutFailure(
      `Regenerated Meta Ads 3D Queue job differs from ${evidence.binding.role} replay payload`,
      'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_REPLAY_PAYLOAD_MISMATCH',
      { role: evidence.binding.role },
    );
  }

  const client = createLarkBitableClientFromEnv(env);
  const larkPreflight = await state.verifyLarkInventory(client, config.tableIds);
  const initialD1 = await state.readD1Snapshot(selected, incident.requestedAt);
  const initialLark = await state.readLarkReportState(client, config.tableIds, selected.reportId);
  const failedRecovery = await state.readD1Row(buildMetaAds3dFailedRecoveryStateSql(incident));
  assertMetaAds3dInitialState({ d1: initialD1, lark: initialLark, failed: failedRecovery }, incident);
  const remoteBaseline = await baselineRemote.verifyDeployment('active');
  const backup = await state.createD1Backup('meta-ads-3d-before-d1-bind-continuation');

  let activeDeployment = null;
  let activeStability = null;
  let restoreDeployment = null;
  let first = null;
  let firstLark = null;
  let firstIntegrity = null;
  let replay = null;
  let replayLark = null;
  let replayIntegrity = null;
  let primaryError = null;
  const continuationRequestedAt = Date.now();
  const attemptPrefix = 'meta_ads-3d-d1-bind-continuation';

  try {
    currentStage = 'deploy-and-stabilize-reviewed-report-window';
    await writeReviewedAttempt(outputRoot, `${attemptPrefix}-deploy-active`, {
      incidentKey: incident.key,
      repositoryHead: repository.head,
      reportId: selected.reportId,
      configSha256: config.activeSha256,
      jobSha256: incident.jobSha256,
      rootCauseClassification: incident.rootCause.classification,
      uniqueAds3d: incident.rootCause.uniqueAds3d,
      preFixBindings3d: incident.rootCause.preFixBindings3d,
      backup,
    });
    activeDeployment = await activeRemote.deployConfig(
      config.activeText,
      `${attemptPrefix}-active`,
      META_ADS_3D_D1_BIND_CONTINUATION_CONTRACT,
    );
    activeDeploymentAttempted = true;
    activeStability = await activeRemote.verifyDeployment('active', activeDeployment.versionId);
    if (activeStability.stabilitySampleCount !== 3) throw closeoutFailure(
      'Meta Ads 3D continuation requires three stable Active Worker samples',
      'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_ACTIVE_NOT_STABLE',
      { sampleCount: activeStability.stabilitySampleCount ?? 0 },
    );

    currentStage = 'send-exact-meta-ads-3d-continuation-once';
    await writeReviewedAttempt(outputRoot, `${attemptPrefix}-send-first`, {
      incidentKey: incident.key,
      reportId: selected.reportId,
      jobSha256: incident.jobSha256,
      continuationRequestedAt,
      retainedDlqIds: incident.dlqs.map((binding) => binding.dlqId),
      activeVersionFingerprint: sha256(activeDeployment.versionId),
    });
    await sendReviewedQueueMessage({ auth, queueId: queue.queueId, job: selected.job });
    first = await pollExactContinuationCompletion({
      state,
      selected,
      continuationRequestedAt,
      minimumSuccessfulRuns: 1,
      env,
      phase: 'first',
    });
    assertReportRuntimeCloseoutCompletion(first, { reportId: selected.reportId });
    assertReportRuntimeWindowChanged({ operation: 'fresh', before: initialD1, after: first });
    const firstVerified = await state.pollLarkIntegrity(
      client,
      config.tableIds,
      selected.reportId,
      first,
    );
    firstLark = firstVerified.state;
    firstIntegrity = firstVerified.integrity;

    currentStage = 'send-exact-meta-ads-3d-replay-once';
    await writeReviewedAttempt(outputRoot, `${attemptPrefix}-send-replay`, {
      incidentKey: incident.key,
      reportId: selected.reportId,
      jobSha256: incident.jobSha256,
      continuationRequestedAt,
      firstPayloadChecksum: first.payload_checksum,
    });
    await sendReviewedQueueMessage({ auth, queueId: queue.queueId, job: selected.job });
    replay = await pollExactContinuationCompletion({
      state,
      selected,
      continuationRequestedAt,
      minimumSuccessfulRuns: 2,
      env,
      phase: 'replay',
    });
    assertReportRuntimeCloseoutCompletion(replay, { reportId: selected.reportId });
    assertReportRuntimeCloseoutReplay(first, replay);
    const replayVerified = await state.pollLarkIntegrity(
      client,
      config.tableIds,
      selected.reportId,
      replay,
    );
    replayLark = replayVerified.state;
    replayIntegrity = replayVerified.integrity;
    assertLarkReplay(firstLark, replayLark);
    if (stableJson(firstIntegrity) !== stableJson(replayIntegrity)) throw closeoutFailure(
      'Meta Ads 3D continuation replay changed D1/Lark integrity evidence',
      'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_INTEGRITY_DRIFT',
    );
  } catch (error) {
    primaryError = error;
  } finally {
    if (activeDeploymentAttempted) {
      currentStage = 'restore-preserved-notification-worker-baseline';
      try {
        await writeReviewedAttempt(outputRoot, `${attemptPrefix}-restore-baseline`, {
          incidentKey: incident.key,
          repositoryHead: repository.head,
          reportId: selected.reportId,
          configSha256: config.safeSha256,
          notificationRuntimeState: config.notificationRuntime.state,
          activeVersionFingerprint: activeDeployment ? sha256(activeDeployment.versionId) : null,
        });
        restoreDeployment = await baselineRemote.deployConfig(
          config.safeText,
          `${attemptPrefix}-baseline`,
          META_ADS_3D_D1_BIND_CONTINUATION_CONTRACT,
        );
        const restoreStability = await baselineRemote.verifyDeployment(
          'active',
          restoreDeployment.versionId,
        );
        baselineRestoreVerified = restoreStability.stabilitySampleCount === 3;
      } catch (restoreError) {
        if (primaryError) throw closeoutFailure(
          'Meta Ads 3D continuation failed and preserved baseline restore also failed',
          'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_RESTORE_FAILED_AFTER_PRIMARY',
          {
            primaryCode: primaryError?.code ?? 'UNKNOWN',
            restoreCode: restoreError?.code ?? 'UNKNOWN',
          },
        );
        throw restoreError;
      }
    }
  }

  if (primaryError) throw primaryError;
  if (!baselineRestoreVerified) throw closeoutFailure(
    'Meta Ads 3D continuation requires verified preserved Worker baseline restore',
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_RESTORE_NOT_VERIFIED',
  );

  currentStage = 'close-both-exact-retained-dlqs';
  await writeReviewedAttempt(outputRoot, `${attemptPrefix}-close-dlqs`, {
    incidentKey: incident.key,
    repositoryHead: repository.head,
    reportId: selected.reportId,
    payloadChecksum: replay.payload_checksum,
    dlqClosures: incident.dlqs.map((binding) => ({
      role: binding.role,
      dlqId: binding.dlqId,
      closureReference: binding.closureReference,
    })),
  });
  const closedDlqs = [];
  const closureAt = Date.now();
  for (const binding of incident.dlqs) {
    for (const statement of buildMetaAds3dClosureStatements(binding, closureAt)) {
      await runner.runText('npx', [
        'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
        '--config', configPath, '--command', statement,
      ], { env });
    }
    const closed = await state.readD1Row(buildMetaAds3dDlqSql(binding));
    assertMetaAds3dDlqClosed(closed, binding);
    closedDlqs.push(Object.freeze({
      role: binding.role,
      dlqId: binding.dlqId,
      closureReference: binding.closureReference,
    }));
  }

  currentStage = 'sanitized-continuation-summary';
  const summary = sanitizeReportLiveClosureEvidence({
    ok: true,
    contractVersion: META_ADS_3D_D1_BIND_CONTINUATION_CONTRACT,
    decision: incident.decision,
    repository,
    incident: {
      incidentKey: incident.key,
      platformScope: incident.platformScope,
      windowDays: incident.windowDays,
      reportId: selected.reportId,
      jobSha256: incident.jobSha256,
      rootCauseClassification: incident.rootCause.classification,
      uniqueAds1d: incident.rootCause.uniqueAds1d,
      uniqueAds3d: incident.rootCause.uniqueAds3d,
      preFixBindings1d: incident.rootCause.preFixBindings1d,
      preFixBindings3d: incident.rootCause.preFixBindings3d,
      firstMaterializationSent: true,
      replaySent: true,
      closedDlqCount: closedDlqs.length,
      closedDlqs,
    },
    retainedEvidence: {
      attemptSha256: sha256(stableJson(retainedAttempt)),
      inspectorEntitySha256: sha256(inspectorEntityText),
      inspectorDlqSha256: sha256(inspectorDlqText),
    },
    preflight: {
      coverageStatus: preflight.coverage_status,
      coverageDatasetKey: preflight.coverage_dataset_key,
      sourceScope: preflight.source_scope,
      sourceWatermark: preflight.source_watermark,
      sourceFactCount: Number(preflight[incident.sourceFactField] ?? 0),
      priorFailedSyncCount: Number(failedRecovery.failed_sync_count),
      pendingMigrations,
      lark: larkPreflight,
      backup,
      remoteBaselineVersionFingerprint: sha256(remoteBaseline.activeVersion),
      activeStabilitySampleCount: activeStability.stabilitySampleCount,
      activeStabilityWindowMs: activeStability.stabilityWindowMs,
    },
    materialization: {
      reportId: first.report_id,
      payloadChecksum: first.payload_checksum,
      dataStatus: first.data_status,
      d1MaterializationCount: Number(first.materialization_count),
      larkRows: summarizeLarkState(firstLark),
      integrity: firstIntegrity,
    },
    replay: {
      sameInput: true,
      sameReportId: first.report_id === replay.report_id,
      samePayloadChecksum: first.payload_checksum === replay.payload_checksum,
      d1MaterializationCount: Number(replay.materialization_count),
      successfulSyncRunCount: Number(replay.successful_sync_count),
      larkRowsUnchanged: stableJson(firstLark) === stableJson(replayLark),
      integrityUnchanged: stableJson(firstIntegrity) === stableJson(replayIntegrity),
    },
    runtime: {
      notificationRuntimeState: config.notificationRuntime.state,
      baselineTrueFlags: config.safeTrueFlags,
      activeTrueFlags: config.activeTrueFlags,
      restoredBaseline: true,
      finalWorkerVersionFingerprint: sha256(restoreDeployment.versionId),
      queueMessagesSent: 2,
      providerRequestCount: 0,
      notificationAdmissionEnabled: false,
      aiSummaryEnabled: false,
      schedulesEnabled: false,
      production: false,
    },
  });
  await writePrivateJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`);
}

async function pollExactContinuationCompletion(input) {
  const {
    state,
    selected,
    continuationRequestedAt,
    minimumSuccessfulRuns,
    env,
    phase,
  } = input;
  const maxPolls = positiveInteger(
    env.MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS ?? 120,
    'maxPolls',
  );
  const intervalMs = positiveInteger(
    env.MKT_REPORT_RUNTIME_CLOSEOUT_POLL_INTERVAL_MS ?? 5_000,
    'pollIntervalMs',
  );
  let row = null;
  let diagnostic = null;
  let lastReportedFailureCount = -1;

  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    row = await state.readD1Snapshot(selected, continuationRequestedAt);
    diagnostic = await state.readD1Row(
      buildMetaAds3dContinuationPollSql(continuationRequestedAt, incident),
    );
    if (row.report_id === selected.reportId
      && row.sync_status === 'success'
      && Number(row.successful_sync_count ?? 0) >= minimumSuccessfulRuns
      && Number(row.active_lock_count ?? 0) === 0) return row;

    const exactNewDlqCount = Number(diagnostic.exact_new_dlq_count ?? 0);
    if (exactNewDlqCount > 0) throw closeoutFailure(
      `Meta Ads 3D ${phase} reached a new exact DLQ`,
      'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_NEW_DLQ',
      {
        phase,
        failedSyncCount: Number(diagnostic.failed_sync_count ?? 0),
        latestErrorCode: diagnostic.latest_error_code ?? null,
        latestErrorMessage: diagnostic.latest_error_message ?? null,
        exactNewDlqCount,
      },
    );

    const failureCount = Number(diagnostic.failed_sync_count ?? 0);
    if (failureCount !== lastReportedFailureCount && failureCount > 0) {
      lastReportedFailureCount = failureCount;
      process.stdout.write(`${JSON.stringify({
        ok: true,
        stage: 'meta-ads-3d-continuation-queue-progress',
        phase,
        failedSyncCount: failureCount,
        latestErrorCode: diagnostic.latest_error_code ?? null,
        activeLockCount: Number(row.active_lock_count ?? 0),
        exactNewDlqCount,
        production: 'BLOCKED',
      })}\n`);
    }
    if (attempt < maxPolls) await sleep(intervalMs);
  }

  throw closeoutFailure(
    `Bounded verification did not observe completed Meta Ads 3D ${phase}`,
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_VERIFY_TIMEOUT',
    {
      phase,
      minimumSuccessfulRuns,
      rowPresent: row !== null,
      syncStatus: row?.sync_status ?? null,
      successfulSyncCount: Number(row?.successful_sync_count ?? 0),
      activeLockCount: Number(row?.active_lock_count ?? 0),
      failedSyncCount: Number(diagnostic?.failed_sync_count ?? 0),
      latestErrorCode: diagnostic?.latest_error_code ?? null,
      latestErrorMessage: diagnostic?.latest_error_message ?? null,
      exactNewDlqCount: Number(diagnostic?.exact_new_dlq_count ?? 0),
    },
  );
}

function readSingleWranglerRow(text, label) {
  let parsed;
  try { parsed = JSON.parse(text); } catch {
    throw closeoutFailure(
      `${label} is not valid JSON`,
      'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_INSPECTOR_JSON_INVALID',
      { label },
    );
  }
  const rows = Array.isArray(parsed)
    ? parsed.flatMap((item) => item?.results ?? [])
    : (parsed?.results ?? []);
  if (rows.length !== 1) throw closeoutFailure(
    `${label} must contain exactly one row`,
    'REPORT_RUNTIME_META_ADS_3D_CONTINUATION_INSPECTOR_SHAPE_INVALID',
    { label, rowCount: rows.length },
  );
  return Object.freeze({ ...rows[0] });
}

async function readJsonIfExists(path) {
  try { return JSON.parse(await readFile(path, 'utf8')); } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
