#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import {
  sanitizeReportLiveClosureEvidence,
} from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import {
  createLarkBitableClientFromEnv,
} from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  REPORT_RUNTIME_CLOSEOUT_REQUIRED_TABLES,
  assertReportRuntimeCloseoutCompletion,
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
  CHATWOOT_1D_EXACT_INCIDENT,
  CHATWOOT_1D_EXACT_INCIDENT_CONTINUATION_CONTRACT,
  assertChatwoot1dContinuationCandidate,
  assertChatwoot1dExactIncident,
  assertChatwoot1dIncidentClosed,
  assertChatwoot1dIncidentPreflight,
  assertChatwoot1dInitialState,
  assertChatwoot1dMaterialization,
  buildChatwoot1dClosureReadbackSql,
  buildChatwoot1dClosureStatements,
  buildChatwoot1dContinuationPollSql,
  buildChatwoot1dExactIncidentSql,
} from './lib/report-runtime-chatwoot-1d-incident-continuation.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const incident = CHATWOOT_1D_EXACT_INCIDENT;
const target = resolveReviewedReportRuntimeCloseoutTarget({
  MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: incident.platformScope,
});
const configPath = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const outputRoot = resolve(
  process.env.MKT_REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_EVIDENCE_DIR
    ?? incident.evidenceDirectory,
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? incident.finalizerDefault,
);
const summaryPath = join(
  outputRoot,
  'report-runtime-chatwoot-1d-continuation-summary.json',
);
const ATTEMPT_PREFIX = 'chatwoot-1d-exact-incident';
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
    code: error?.code ?? 'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_FAILED',
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
  if (process.env.CONFIRM_REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION
    !== incident.confirmation) {
    throw closeoutFailure(
      `Execution requires CONFIRM_REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION=${incident.confirmation}`,
      'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_CONFIRMATION_REQUIRED',
      { incidentKey: incident.key },
    );
  }

  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const existingSummary = await readJsonIfExists(summaryPath);
  if (existingSummary) {
    if (existingSummary.ok !== true
      || existingSummary.contractVersion
        !== CHATWOOT_1D_EXACT_INCIDENT_CONTINUATION_CONTRACT
      || existingSummary.incident?.incidentKey !== incident.key
      || existingSummary.incident?.closedDlqCount !== 1
      || existingSummary.incident?.resolvedAlertCount !== 1
      || existingSummary.runtime?.restoredBaseline !== true
      || existingSummary.runtime?.notificationAdmissionEnabled !== false) {
      throw closeoutFailure(
        'Existing Chatwoot 1D continuation summary is incomplete',
        'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_SUMMARY_INVALID',
      );
    }
    process.stdout.write(
      `${JSON.stringify({ ...existingSummary, evidencePath: summaryPath }, null, 2)}\n`,
    );
    return;
  }

  const priorAttempts = (await readdir(outputRoot))
    .filter((name) => name.endsWith('.attempt.json'));
  if (priorAttempts.length > 0) {
    throw closeoutFailure(
      'Chatwoot 1D continuation evidence root was already started; inspect it and never rerun it',
      'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_ROOT_ALREADY_STARTED',
      { attemptCount: priorAttempts.length, attemptFiles: priorAttempts.sort() },
    );
  }

  const fileEnv = await readDevVars(
    process.env.DEV_VARS_FILE ?? '.dev.vars',
  );
  const env = Object.freeze({
    ...fileEnv,
    ...process.env,
    MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS:
      process.env.MKT_REPORT_RUNTIME_CLOSEOUT_MAX_POLLS ?? '120',
  });
  const runner = createCommandRunner({
    execFileAsync,
    cwd: repositoryRoot,
    baseEnv: process.env,
  });

  currentStage = 'repository-and-finalizer';
  const repository = await assertReviewedRepositoryState(runner);
  if (repository.head !== incident.requiredRepositoryHead) {
    throw closeoutFailure(
      'Chatwoot 1D continuation requires the exact merged metric-scope hotfix main',
      'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_HEAD_MISMATCH',
      {
        repositoryHead: repository.head,
        expectedHead: incident.requiredRepositoryHead,
      },
    );
  }
  const finalizerEvidence = JSON.parse(
    await readFile(finalizerEvidencePath, 'utf8'),
  );
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository?.head !== repository.head) {
    throw closeoutFailure(
      'Chatwoot 1D continuation requires Finalizer evidence from exact current main',
      'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_FINALIZER_HEAD_MISMATCH',
      {
        evidenceHead: finalizerEvidence.repository?.head ?? null,
        repositoryHead: repository.head,
      },
    );
  }

  const sourceText = await readFile(configPath, 'utf8');
  const config = buildNotificationPreservingReportRuntimeConfigWindow(
    sourceText,
    {
      activeTrueFlags: target.activeTrueFlags,
      finalizerEvidencePath,
      expectedRepositoryHead: repository.head,
    },
  );
  const auth = await resolveReviewedCloudflareSession({
    env,
    sourceText,
    runText: runner.runText,
  });
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
    config: Object.freeze({
      ...config,
      tableIds: config.workerTableIds,
    }),
  };
  const baselineRemote = createReviewedRemoteRuntime({
    ...remoteInput,
    target: Object.freeze({
      ...target,
      activeTrueFlags: config.safeTrueFlags,
    }),
  });
  const activeRemote = createReviewedRemoteRuntime({
    ...remoteInput,
    target: Object.freeze({
      ...target,
      activeTrueFlags: config.activeTrueFlags,
    }),
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

  currentStage = 'exact-incident-read-only-preflight';
  const pendingMigrations = await state.readPendingMigrations();
  if (pendingMigrations.length !== 0) {
    throw closeoutFailure(
      'Pending migrations block Chatwoot 1D continuation',
      'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_PENDING_MIGRATIONS',
      { pendingMigrationCount: pendingMigrations.length },
    );
  }
  const preflight = await state.readD1Row(
    buildReportRuntimePreflightSql({
      target: {
        ...target,
        customerKey: incident.customerKey,
      },
    }),
  );
  assertChatwoot1dIncidentPreflight(preflight, incident);

  const candidates = buildReportRuntimeCloseoutCandidates({
    requestedAt: incident.requestedAt,
    periodEnd: incident.periodEnd,
    sourceWatermark: incident.sourceWatermark,
    timeZone: 'Asia/Bangkok',
    platformScope: incident.platformScope,
    accountKey: incident.accountKey,
    formulaVersion: incident.formulaVersion,
  });
  const selected = candidates.find(
    (candidate) => candidate.windowDays === incident.windowDays,
  );
  const candidateEvidence = assertChatwoot1dContinuationCandidate(
    selected,
    incident,
  );
  const incidentRow = await state.readD1Row(
    buildChatwoot1dExactIncidentSql(incident),
  );
  const incidentBinding = assertChatwoot1dExactIncident(
    incidentRow,
    selected,
    incident,
  );

  const client = createLarkBitableClientFromEnv(env);
  const larkPreflight = await state.verifyLarkInventory(
    client,
    config.tableIds,
  );
  const initialD1 = await state.readD1Snapshot(
    selected,
    incident.requestedAt,
  );
  const initialLark = await state.readLarkReportState(
    client,
    config.tableIds,
    selected.reportId,
  );
  assertChatwoot1dInitialState({
    d1: initialD1,
    lark: initialLark,
  }, incident);
  const remoteBaseline = await baselineRemote.verifyDeployment('active');
  const backup = await state.createD1Backup(
    'chatwoot-1d-before-exact-incident-continuation',
  );

  let activeDeployment = null;
  let activeStability = null;
  let restoreDeployment = null;
  let completed = null;
  let completedLark = null;
  let completedIntegrity = null;
  let primaryError = null;
  const continuationRequestedAt = Date.now();

  try {
    currentStage = 'deploy-and-stabilize-reviewed-chatwoot-report-window';
    await writeReviewedAttempt(outputRoot, `${ATTEMPT_PREFIX}-deploy-active`, {
      incidentKey: incident.key,
      repositoryHead: repository.head,
      reportId: selected.reportId,
      configSha256: config.activeSha256,
      jobSha256: candidateEvidence.jobSha256,
      retainedDlqFingerprint: sha256(incidentBinding.dlqId),
      retainedAlertFingerprint: sha256(incidentBinding.alertId),
      backup,
    });
    activeDeployment = await activeRemote.deployConfig(
      config.activeText,
      `${ATTEMPT_PREFIX}-active`,
      CHATWOOT_1D_EXACT_INCIDENT_CONTINUATION_CONTRACT,
    );
    activeDeploymentAttempted = true;
    activeStability = await activeRemote.verifyDeployment(
      'active',
      activeDeployment.versionId,
    );
    if (activeStability.stabilitySampleCount !== 3) {
      throw closeoutFailure(
        'Chatwoot 1D continuation requires three stable Active Worker samples',
        'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_ACTIVE_NOT_STABLE',
        { sampleCount: activeStability.stabilitySampleCount ?? 0 },
      );
    }

    currentStage = 'send-exact-chatwoot-1d-continuation-once';
    await writeReviewedAttempt(outputRoot, `${ATTEMPT_PREFIX}-send-first`, {
      incidentKey: incident.key,
      reportId: selected.reportId,
      jobSha256: candidateEvidence.jobSha256,
      continuationRequestedAt,
      retainedSyncRunFingerprint: sha256(incidentBinding.syncRunId),
      retainedDlqFingerprint: sha256(incidentBinding.dlqId),
      retainedAlertFingerprint: sha256(incidentBinding.alertId),
      activeVersionFingerprint: sha256(activeDeployment.versionId),
    });
    await sendReviewedQueueMessage({
      auth,
      queueId: queue.queueId,
      job: selected.job,
    });
    completed = await pollExactContinuationCompletion({
      state,
      selected,
      continuationRequestedAt,
      env,
    });
    assertReportRuntimeCloseoutCompletion(completed, {
      reportId: selected.reportId,
    });
    assertReportRuntimeWindowChanged({
      operation: 'fresh',
      before: initialD1,
      after: completed,
    });
    const verified = await state.pollLarkIntegrity(
      client,
      config.tableIds,
      selected.reportId,
      completed,
    );
    completedLark = verified.state;
    completedIntegrity = verified.integrity;
    assertChatwoot1dMaterialization({
      d1: completed,
      lark: completedLark,
    }, incident);
  } catch (error) {
    primaryError = error;
  } finally {
    if (activeDeploymentAttempted) {
      currentStage = 'restore-preserved-notification-worker-baseline';
      try {
        await writeReviewedAttempt(
          outputRoot,
          `${ATTEMPT_PREFIX}-restore-baseline`,
          {
            incidentKey: incident.key,
            repositoryHead: repository.head,
            reportId: selected.reportId,
            configSha256: config.safeSha256,
            notificationRuntimeState: config.notificationRuntime.state,
            activeVersionFingerprint:
              activeDeployment ? sha256(activeDeployment.versionId) : null,
          },
        );
        restoreDeployment = await baselineRemote.deployConfig(
          config.safeText,
          `${ATTEMPT_PREFIX}-baseline`,
          CHATWOOT_1D_EXACT_INCIDENT_CONTINUATION_CONTRACT,
        );
        const restoreStability = await baselineRemote.verifyDeployment(
          'active',
          restoreDeployment.versionId,
        );
        baselineRestoreVerified =
          restoreStability.stabilitySampleCount === 3;
      } catch (restoreError) {
        if (primaryError) {
          throw closeoutFailure(
            'Chatwoot 1D continuation failed and preserved baseline restore also failed',
            'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_RESTORE_FAILED_AFTER_PRIMARY',
            {
              primaryCode: primaryError?.code ?? 'UNKNOWN',
              restoreCode: restoreError?.code ?? 'UNKNOWN',
            },
          );
        }
        throw restoreError;
      }
    }
  }

  if (primaryError) throw primaryError;
  if (!baselineRestoreVerified) {
    throw closeoutFailure(
      'Chatwoot 1D continuation requires verified preserved Worker baseline restore',
      'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_RESTORE_NOT_VERIFIED',
    );
  }

  currentStage = 'close-exact-retained-chatwoot-dlq-and-alert';
  await writeReviewedAttempt(outputRoot, `${ATTEMPT_PREFIX}-close-incident`, {
    incidentKey: incident.key,
    repositoryHead: repository.head,
    reportId: selected.reportId,
    payloadChecksum: completed.payload_checksum,
    dlqFingerprint: sha256(incidentBinding.dlqId),
    alertFingerprint: sha256(incidentBinding.alertId),
    closureReference: incidentBinding.closureReference,
  });
  const closureAt = Date.now();
  for (const statement of buildChatwoot1dClosureStatements(
    incidentBinding,
    closureAt,
    incident,
  )) {
    await runner.runText('npx', [
      'wrangler',
      'd1',
      'execute',
      'MKT_STATE_DB',
      '--remote',
      '--json',
      '--config',
      configPath,
      '--command',
      statement,
    ], { env });
  }
  const closureReadback = await state.readD1Row(
    buildChatwoot1dClosureReadbackSql(
      incidentBinding,
      incident,
    ),
  );
  assertChatwoot1dIncidentClosed(
    closureReadback,
    incidentBinding,
  );

  currentStage = 'sanitized-continuation-summary';
  const summary = sanitizeReportLiveClosureEvidence({
    ok: true,
    contractVersion:
      CHATWOOT_1D_EXACT_INCIDENT_CONTINUATION_CONTRACT,
    decision: incident.decision,
    repository,
    incident: {
      incidentKey: incident.key,
      platformScope: incident.platformScope,
      windowDays: incident.windowDays,
      reportId: selected.reportId,
      jobSha256: candidateEvidence.jobSha256,
      retainedSyncRunFingerprint: sha256(incidentBinding.syncRunId),
      retainedDlqFingerprint: sha256(incidentBinding.dlqId),
      retainedAlertFingerprint: sha256(incidentBinding.alertId),
      firstMaterializationSent: true,
      closedDlqCount: 1,
      resolvedAlertCount: 1,
      closureReference: incidentBinding.closureReference,
    },
    preflight: {
      coverageStatus: preflight.coverage_status,
      coverageDatasetKey: preflight.coverage_dataset_key,
      sourceScope: preflight.source_scope,
      sourceWatermark: preflight.source_watermark,
      conversationFactCount:
        Number(preflight.conversation_fact_count ?? 0),
      accountFactCount: Number(preflight.account_fact_count ?? 0),
      pendingMigrations,
      lark: larkPreflight,
      backup,
      remoteBaselineVersionFingerprint:
        sha256(remoteBaseline.activeVersion),
      activeStabilitySampleCount:
        activeStability.stabilitySampleCount,
      activeStabilityWindowMs:
        activeStability.stabilityWindowMs,
    },
    materialization: {
      reportId: completed.report_id,
      payloadChecksum: completed.payload_checksum,
      dataStatus: completed.data_status,
      d1MaterializationCount:
        Number(completed.materialization_count),
      successfulSyncRunCount:
        Number(completed.successful_sync_count),
      larkRows: summarizeLarkState(completedLark),
      integrity: completedIntegrity,
    },
    closure: {
      dlqStatus: closureReadback.dlq_status,
      recoveryStatus: closureReadback.recovery_status,
      alertStatus: closureReadback.alert_status,
      openReportDlqCount:
        Number(closureReadback.open_report_dlq_count),
      openReportCriticalAlertCount:
        Number(closureReadback.open_report_critical_alert_count),
    },
    runtime: {
      notificationRuntimeState: config.notificationRuntime.state,
      baselineTrueFlags: config.safeTrueFlags,
      activeTrueFlags: config.activeTrueFlags,
      restoredBaseline: true,
      finalWorkerVersionFingerprint:
        sha256(restoreDeployment.versionId),
      queueMessagesSent: 1,
      providerRequestCount: 0,
      notificationAdmissionEnabled: false,
      aiSummaryEnabled: false,
      schedulesEnabled: false,
      production: false,
    },
  });
  await writePrivateJson(summaryPath, summary);
  process.stdout.write(
    `${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`,
  );
}

async function pollExactContinuationCompletion(input) {
  const {
    state,
    selected,
    continuationRequestedAt,
    env,
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

  for (let attempt = 1; attempt <= maxPolls; attempt += 1) {
    row = await state.readD1Snapshot(
      selected,
      continuationRequestedAt,
    );
    diagnostic = await state.readD1Row(
      buildChatwoot1dContinuationPollSql(
        continuationRequestedAt,
        incident,
      ),
    );
    if (row.report_id === selected.reportId
      && row.sync_status === 'success'
      && Number(row.successful_sync_count ?? 0) >= 1
      && Number(row.active_lock_count ?? 0) === 0) {
      return row;
    }

    const failedSyncCount =
      Number(diagnostic.failed_sync_count ?? 0);
    const exactNewDlqCount =
      Number(diagnostic.exact_new_dlq_count ?? 0);
    if (failedSyncCount > 0 || exactNewDlqCount > 0) {
      throw closeoutFailure(
        'Chatwoot 1D continuation reached a new failed Sync Run or exact DLQ',
        'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_NEW_FAILURE',
        {
          failedSyncCount,
          latestErrorCode:
            diagnostic.latest_error_code ?? null,
          latestErrorMessage:
            diagnostic.latest_error_message ?? null,
          exactNewDlqCount,
          attempt,
        },
      );
    }

    if (attempt === 1 || attempt % 6 === 0) {
      process.stdout.write(`${JSON.stringify({
        ok: true,
        stage: 'chatwoot-1d-continuation-progress',
        attempt,
        maxPolls,
        syncStatus: row.sync_status ?? null,
        successfulSyncCount:
          Number(row.successful_sync_count ?? 0),
        activeLockCount:
          Number(row.active_lock_count ?? 0),
        exactNewDlqCount,
        production: 'BLOCKED',
      })}\n`);
    }
    if (attempt < maxPolls) await sleep(intervalMs);
  }

  throw closeoutFailure(
    'Bounded verification did not observe completed Chatwoot 1D continuation',
    'REPORT_RUNTIME_CHATWOOT_1D_CONTINUATION_VERIFY_TIMEOUT',
    {
      rowPresent: row !== null,
      syncStatus: row?.sync_status ?? null,
      successfulSyncCount:
        Number(row?.successful_sync_count ?? 0),
      activeLockCount:
        Number(row?.active_lock_count ?? 0),
      failedSyncCount:
        Number(diagnostic?.failed_sync_count ?? 0),
      latestErrorCode:
        diagnostic?.latest_error_code ?? null,
      latestErrorMessage:
        diagnostic?.latest_error_message ?? null,
      exactNewDlqCount:
        Number(diagnostic?.exact_new_dlq_count ?? 0),
    },
  );
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
