#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';

import { sanitizeReportLiveClosureEvidence } from '../packages/application/src/report-live-closure/report-live-closure-framework.js';
import { writeDashboardMaterializationToLark } from '../packages/application/src/use-cases/write-dashboard-materialization-to-lark.js';
import { D1ReportMaterializationReader } from '../packages/connectors/src/d1-report-materialization-reader.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';
import { readDevVars } from './lib/dev-vars.js';
import {
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
  sha256,
  sqlText,
  stableJson,
  writePrivateJson,
  writeReviewedAttempt,
} from './lib/report-runtime-closeout-reviewed-process.js';
import {
  assertD1LarkIntegrity,
  createReviewedStateRuntime,
  summarizeLarkState,
} from './lib/report-runtime-closeout-reviewed-state.js';
import {
  loadReportRuntimeFinalizerEnvironment,
} from './lib/report-runtime-finalizer-environment.js';
import {
  CHATWOOT_1D_EXACT_INCIDENT,
  assertChatwoot1dContinuationCandidate,
  assertChatwoot1dExactIncident,
  assertChatwoot1dIncidentClosed,
  assertChatwoot1dIncidentPreflight,
  buildChatwoot1dClosureReadbackSql,
  buildChatwoot1dClosureStatements,
  buildChatwoot1dExactIncidentSql,
} from './lib/report-runtime-chatwoot-1d-incident-continuation.js';
import {
  CHATWOOT_1D_D1_LARK_RECOVERY_CONFIRMATION,
  CHATWOOT_1D_D1_LARK_RECOVERY_CONTRACT,
  assertChatwoot1dD1LarkRecoveredState,
  assertChatwoot1dD1LarkRecoveryPrestate,
  assertChatwoot1dD1LarkRecoveryWriteResult,
  assertChatwoot1dD1MaterializationUnchanged,
  normalizeChatwoot1dRetainedMaterializationForProjection,
} from './lib/report-runtime-chatwoot-1d-d1-lark-recovery.js';

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
  process.env.MKT_REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_EVIDENCE_DIR
    ?? 'outputs/chatwoot-1d-d1-complete-lark-incomplete-recovery',
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? incident.finalizerDefault,
);
const summaryPath = join(
  outputRoot,
  'report-runtime-chatwoot-1d-d1-lark-recovery-summary.json',
);
const REQUIRED_LARK_KEY_FIELDS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
  mktReportTopContent: 'report_content_key',
  mktReportTopAds: 'report_ad_key',
  mktSyncLog: 'sync_id',
  mktSystemAlerts: 'alert_id',
});

let currentStage = 'init';
let larkWriteAttempted = false;
let incidentClosureAttempted = false;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
    incidentKey: incident.key,
    reportId: incident.reportId,
    larkWriteAttempted,
    incidentClosureAttempted,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerRequestCount: 0,
    scheduleEnabled: false,
    notificationAdmissionEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  if (process.env.CONFIRM_REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY
    !== CHATWOOT_1D_D1_LARK_RECOVERY_CONFIRMATION) {
    throw closeoutFailure(
      `Execution requires CONFIRM_REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY=${CHATWOOT_1D_D1_LARK_RECOVERY_CONFIRMATION}`,
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_CONFIRMATION_REQUIRED',
    );
  }

  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const existingSummary = await readJsonIfExists(summaryPath);
  if (existingSummary) {
    assertCompletedSummary(existingSummary);
    process.stdout.write(`${JSON.stringify({ ...existingSummary, evidencePath: summaryPath }, null, 2)}\n`);
    return;
  }
  const priorAttempts = (await readdir(outputRoot)).filter((name) => name.endsWith('.attempt.json'));
  if (priorAttempts.length > 0) {
    throw closeoutFailure(
      'Chatwoot D1/Lark recovery evidence root was already started; inspect it and never rerun it',
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_ROOT_ALREADY_STARTED',
      { attemptCount: priorAttempts.length, attemptFiles: priorAttempts.sort() },
    );
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const runner = createCommandRunner({
    execFileAsync,
    cwd: repositoryRoot,
    baseEnv: process.env,
  });

  currentStage = 'repository-and-finalizer';
  const repository = await assertReviewedRepositoryState(runner);
  const expectedHead = String(
    process.env.MKT_REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_EXPECTED_HEAD ?? '',
  ).trim();
  if (expectedHead && repository.head !== expectedHead) {
    throw closeoutFailure(
      'Chatwoot D1/Lark recovery repository HEAD differs from the explicitly reviewed main',
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_HEAD_MISMATCH',
      { repositoryHead: repository.head, expectedHead },
    );
  }
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertReportRuntimeFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository?.head !== repository.head) {
    throw closeoutFailure(
      'Chatwoot D1/Lark recovery requires Finalizer evidence from exact current main',
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_FINALIZER_HEAD_MISMATCH',
      {
        evidenceHead: finalizerEvidence.repository?.head ?? null,
        repositoryHead: repository.head,
      },
    );
  }
  const finalizerAuthority = loadReportRuntimeFinalizerEnvironment({
    finalizerEvidencePath,
    expectedRepositoryHead: repository.head,
  });
  const env = Object.freeze({
    ...fileEnv,
    ...process.env,
    ...finalizerAuthority.tableEnvironment,
    MKT_ENV: 'development',
    MKT_CUSTOMER_PROFILE: 'integration_workspace',
    MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: incident.platformScope,
  });
  const tableIds = Object.freeze({
    mktReportSnapshots: finalizerAuthority.tableEnvironment.LARK_TABLE_MKT_REPORT_SNAPSHOTS,
    mktReportMetricValues: finalizerAuthority.tableEnvironment.LARK_TABLE_MKT_REPORT_METRIC_VALUES,
    mktReportTopContent: finalizerAuthority.tableEnvironment.LARK_TABLE_MKT_REPORT_TOP_CONTENT,
    mktReportTopAds: finalizerAuthority.tableEnvironment.LARK_TABLE_MKT_REPORT_TOP_ADS,
    mktSyncLog: finalizerAuthority.tableEnvironment.LARK_TABLE_MKT_SYNC_LOG
      ?? fileEnv.LARK_TABLE_MKT_SYNC_LOG,
    mktSystemAlerts: finalizerAuthority.tableEnvironment.LARK_TABLE_MKT_SYSTEM_ALERTS
      ?? fileEnv.LARK_TABLE_MKT_SYSTEM_ALERTS,
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
      'Pending migrations block Chatwoot D1/Lark recovery',
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_PENDING_MIGRATIONS',
      { pendingMigrationCount: pendingMigrations.length },
    );
  }
  const preflight = await state.readD1Row(
    buildReportRuntimePreflightSql({
      target: { ...target, customerKey: incident.customerKey },
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
  const selected = candidates.find((candidate) => candidate.windowDays === incident.windowDays);
  const candidateEvidence = assertChatwoot1dContinuationCandidate(selected, incident);
  const incidentRow = await state.readD1Row(buildChatwoot1dExactIncidentSql(incident));
  const incidentBinding = assertChatwoot1dExactIncident(incidentRow, selected, incident);

  const client = createLarkBitableClientFromEnv(env);
  const larkInventory = await state.verifyLarkInventory(client, tableIds);
  const d1Before = await state.readD1Snapshot(selected, incident.requestedAt);
  const larkBefore = await state.readLarkReportState(client, tableIds, incident.reportId);
  assertChatwoot1dD1LarkRecoveryPrestate({ d1: d1Before, lark: larkBefore }, incident);

  currentStage = 'backup-before-exact-lark-projection';
  const backup = await state.createD1Backup('chatwoot-1d-before-d1-complete-lark-recovery');

  currentStage = 'write-existing-d1-materialization-through-shared-lark-writer';
  await writeReviewedAttempt(outputRoot, 'chatwoot-1d-direct-lark-projection', {
    repositoryHead: repository.head,
    incidentKey: incident.key,
    reportId: incident.reportId,
    requestedAt: incident.requestedAt,
    jobSha256: candidateEvidence.jobSha256,
    payloadChecksum: d1Before.payload_checksum,
    expectedSnapshotCount: 1,
    expectedMetricCount: incident.expectedMetricCount,
    retainedDlqFingerprint: sha256(incidentBinding.dlqId),
    retainedAlertFingerprint: sha256(incidentBinding.alertId),
    retainedScopeCompatibility: 'period_end_snapshot_to_current_total_in_memory_only',
    queueActionCount: 0,
    workerDeploymentCount: 0,
    backup,
  });
  larkWriteAttempted = true;

  const retainedReader = new D1ReportMaterializationReader({
    db: createExactMaterializationD1Binding(state, incident.reportId),
  });
  let projectionCompatibility = null;
  const projectionReader = Object.freeze({
    async readById(reportId) {
      const retained = await retainedReader.readById(reportId);
      if (!retained) return null;
      const normalized = normalizeChatwoot1dRetainedMaterializationForProjection(
        retained,
        incident,
      );
      projectionCompatibility = normalized.compatibility;
      return normalized.materialization;
    },
  });

  const writeResult = await writeDashboardMaterializationToLark({
    reader: projectionReader,
    repository: new LarkRecordRepository({ client }),
    syncEngine: new TableSyncEngine(),
    reportId: incident.reportId,
    customerProfile: 'integration_workspace',
    utcOffset: '+07:00',
    tables: {
      mktReportSnapshots: tableIds.mktReportSnapshots,
      mktReportMetricValues: tableIds.mktReportMetricValues,
    },
  });
  assertChatwoot1dD1LarkRecoveryWriteResult(writeResult, incident);
  if (!projectionCompatibility || Number(projectionCompatibility.legacyScopeRewriteCount ?? 0) <= 0) {
    throw closeoutFailure(
      'Chatwoot D1/Lark recovery did not prove retained metric-scope compatibility projection',
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_SCOPE_PROJECTION_NOT_PROVED',
    );
  }

  currentStage = 'verify-retained-d1-unchanged';
  const d1AfterProjection = await state.readD1Snapshot(selected, incident.requestedAt);
  assertChatwoot1dD1MaterializationUnchanged(d1Before, d1AfterProjection);

  currentStage = 'verify-d1-lark-integrity';
  const verified = await state.pollLarkIntegrity(
    client,
    tableIds,
    incident.reportId,
    d1AfterProjection,
  );
  const larkAfter = verified.state;
  const integrity = verified.integrity ?? assertD1LarkIntegrity(d1AfterProjection, larkAfter);
  assertChatwoot1dD1LarkRecoveredState({ d1: d1AfterProjection, lark: larkAfter }, incident);
  const stableReadback = await state.readLarkReportState(client, tableIds, incident.reportId);
  if (stableJson(larkAfter) !== stableJson(stableReadback)) {
    throw closeoutFailure(
      'Chatwoot D1/Lark recovery readback changed between bounded verification reads',
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_READBACK_DRIFT',
      { first: summarizeLarkState(larkAfter), second: summarizeLarkState(stableReadback) },
    );
  }

  currentStage = 'close-exact-retained-chatwoot-dlq-and-alert';
  await writeReviewedAttempt(outputRoot, 'chatwoot-1d-close-exact-incident', {
    repositoryHead: repository.head,
    incidentKey: incident.key,
    reportId: incident.reportId,
    payloadChecksum: d1AfterProjection.payload_checksum,
    dlqFingerprint: sha256(incidentBinding.dlqId),
    alertFingerprint: sha256(incidentBinding.alertId),
    closureReference: incidentBinding.closureReference,
    d1LarkIntegrityVerified: true,
    d1MaterializationUnchanged: true,
    legacyScopeRewriteCount: projectionCompatibility.legacyScopeRewriteCount,
    queueActionCount: 0,
    workerDeploymentCount: 0,
  });
  incidentClosureAttempted = true;
  const closureAt = Date.now();
  for (const statement of buildChatwoot1dClosureStatements(
    incidentBinding,
    closureAt,
    incident,
  )) {
    await runner.runText('npx', [
      'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
      '--config', configPath, '--command', statement,
    ], { env });
  }
  const closureReadback = await state.readD1Row(
    buildChatwoot1dClosureReadbackSql(incidentBinding, incident),
  );
  assertChatwoot1dIncidentClosed(closureReadback, incidentBinding);

  currentStage = 'sanitized-recovery-summary';
  const summary = sanitizeReportLiveClosureEvidence({
    ok: true,
    contractVersion: CHATWOOT_1D_D1_LARK_RECOVERY_CONTRACT,
    decision: 'CHATWOOT_REPORT_1D_D1_COMPLETE_LARK_INCOMPLETE_RECOVERED',
    repository,
    incident: {
      incidentKey: incident.key,
      platformScope: incident.platformScope,
      windowDays: incident.windowDays,
      reportId: incident.reportId,
      jobSha256: candidateEvidence.jobSha256,
      retainedSyncRunFingerprint: sha256(incidentBinding.syncRunId),
      retainedDlqFingerprint: sha256(incidentBinding.dlqId),
      retainedAlertFingerprint: sha256(incidentBinding.alertId),
      firstJobResent: false,
      replaySent: false,
      replacementReportIdentityCreated: false,
      closedDlqCount: 1,
      resolvedAlertCount: 1,
      closureReference: incidentBinding.closureReference,
    },
    preflight: {
      finalizerContractVersion: finalizerEvidence.contractVersion,
      pendingMigrations,
      larkInventory,
      backup,
      sourceWatermark: preflight.source_watermark,
      conversationFactCount: Number(preflight.conversation_fact_count ?? 0),
      accountFactCount: Number(preflight.account_fact_count ?? 0),
      larkPrestate: summarizeLarkState(larkBefore),
    },
    materialization: {
      reportId: d1AfterProjection.report_id,
      payloadChecksum: d1AfterProjection.payload_checksum,
      dataStatus: d1AfterProjection.data_status,
      d1MaterializationCount: Number(d1AfterProjection.materialization_count),
      retainedSyncStatus: d1AfterProjection.sync_status,
      successfulSyncRunCount: Number(d1AfterProjection.successful_sync_count ?? 0),
      persistedMaterializationUnchanged: true,
      projectionCompatibility,
      larkRows: summarizeLarkState(larkAfter),
      integrity,
      executionMode: 'direct_shared_lark_projection_from_existing_d1_with_in_memory_scope_compatibility',
      writeResultRows: writeResult.rows ?? null,
    },
    closure: {
      dlqStatus: closureReadback.dlq_status,
      recoveryStatus: closureReadback.recovery_status,
      alertStatus: closureReadback.alert_status,
      openReportDlqCount: Number(closureReadback.open_report_dlq_count),
      openReportCriticalAlertCount: Number(closureReadback.open_report_critical_alert_count),
    },
    runtime: {
      notificationRuntimeState: finalizerAuthority.notificationRuntime.state,
      notificationAdmissionEnabled: false,
      aiSummaryEnabled: false,
      schedulesEnabled: false,
      queueMessagesSent: 0,
      workerDeploymentCount: 0,
      providerRequestCount: 0,
      directBusinessFactMutationCount: 0,
      larkProjectionRecoveryExecuted: true,
      incidentMetadataClosureExecuted: true,
      production: false,
    },
  });
  await writePrivateJson(summaryPath, summary);
  process.stdout.write(`${JSON.stringify({ ...summary, evidencePath: summaryPath }, null, 2)}\n`);
}

function createExactMaterializationD1Binding(state, reportId) {
  return Object.freeze({
    prepare(sql) {
      const normalized = String(sql).replace(/\s+/gu, ' ').trim();
      if (normalized !== 'SELECT * FROM report_materializations WHERE report_id = ?') {
        throw new TypeError('Exact Chatwoot recovery D1 binding permits only readById');
      }
      return Object.freeze({
        bind(...values) {
          if (values.length !== 1 || values[0] !== reportId) {
            throw new TypeError('Exact Chatwoot recovery D1 binding report identity mismatch');
          }
          return Object.freeze({
            first: () => state.readD1Row(
              `SELECT * FROM report_materializations WHERE report_id = '${sqlText(reportId)}';`,
            ),
          });
        },
      });
    },
  });
}

function assertCompletedSummary(value) {
  if (value.ok !== true
    || value.contractVersion !== CHATWOOT_1D_D1_LARK_RECOVERY_CONTRACT
    || value.decision !== 'CHATWOOT_REPORT_1D_D1_COMPLETE_LARK_INCOMPLETE_RECOVERED'
    || value.incident?.reportId !== incident.reportId
    || value.incident?.firstJobResent !== false
    || Number(value.incident?.closedDlqCount ?? 0) !== 1
    || Number(value.incident?.resolvedAlertCount ?? 0) !== 1
    || Number(value.materialization?.d1MaterializationCount ?? 0) !== 1
    || value.materialization?.persistedMaterializationUnchanged !== true
    || Number(value.materialization?.projectionCompatibility?.legacyScopeRewriteCount ?? 0) <= 0
    || Number(value.materialization?.larkRows?.snapshots ?? 0) !== 1
    || Number(value.materialization?.larkRows?.metrics ?? 0) !== incident.expectedMetricCount
    || Number(value.materialization?.larkRows?.duplicateMetricKeys ?? -1) !== 0
    || Number(value.runtime?.queueMessagesSent ?? -1) !== 0
    || Number(value.runtime?.workerDeploymentCount ?? -1) !== 0
    || value.runtime?.notificationAdmissionEnabled !== false
    || value.runtime?.schedulesEnabled !== false
    || value.runtime?.production !== false) {
    throw closeoutFailure(
      'Existing Chatwoot D1/Lark recovery summary is incomplete',
      'REPORT_RUNTIME_CHATWOOT_1D_D1_LARK_RECOVERY_SUMMARY_INVALID',
    );
  }
}

async function readJsonIfExists(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}
