#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { mkdir, readFile } from 'node:fs/promises';
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
  resolveReviewedReportRuntimeCloseoutTarget,
} from './lib/report-runtime-closeout-channel-binding.js';
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
  WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT,
  WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY_CONFIRMATION,
  WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY_CONTRACT,
  assertWooCommerceReportD1Prestate,
  assertWooCommerceReportDimensionOptions,
  assertWooCommerceReportDlqClosed,
  assertWooCommerceReportFailedSync,
  assertWooCommerceReportFinalizerEvidence,
  assertWooCommerceReportOpenDlq,
  assertWooCommerceReportRetainedAttempt,
  assertWooCommerceReportWindowParity,
  buildWooCommerceReportDlqClosureStatements,
  buildWooCommerceReportDlqReadbackSql,
  buildWooCommerceReportFailedSyncSql,
  buildWooCommerceReportOpenDlqSql,
  classifyWooCommerceReportLarkState,
} from './lib/woocommerce-report-lark-incomplete-recovery.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const incident = WOOCOMMERCE_REPORT_LARK_INCOMPLETE_INCIDENT;
const outputRoot = resolve(
  process.env.MKT_WOOCOMMERCE_REPORT_LARK_RECOVERY_EVIDENCE_DIR
    ?? 'outputs/woocommerce-report-lark-incomplete-recovery',
);
const summaryPath = join(outputRoot, 'woocommerce-report-lark-incomplete-recovery-summary.json');
const originalOutputRoot = resolve(
  process.env.MKT_WOOCOMMERCE_REPORT_LARK_RECOVERY_ORIGINAL_ROOT
    ?? incident.originalOutputRoot,
);
const finalizerEvidencePath = resolve(
  process.env.MKT_REPORT_RUNTIME_FINALIZER_EVIDENCE
    ?? 'outputs/report-runtime-finalize/report-runtime-finalize-summary.json',
);
const configPath = resolve(
  process.env.MKT_REPORT_RUNTIME_CLOSEOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const target = resolveReviewedReportRuntimeCloseoutTarget({
  MKT_REPORT_RUNTIME_CLOSEOUT_PLATFORM_SCOPE: incident.platformScope,
});
const REQUIRED_LARK_KEY_FIELDS = Object.freeze({
  mktReportSnapshots: 'report_id',
  mktReportMetricValues: 'report_metric_key',
  mktReportTopContent: 'report_content_key',
  mktReportTopAds: 'report_ad_key',
});

let currentStage = 'init';
let larkWriteAttempted = false;
let dlqClosureAttempted = false;

try {
  await main();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'WOOCOMMERCE_REPORT_LARK_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeReportLiveClosureEvidence(error?.details ?? {}),
    reportId: incident.reportId,
    larkWriteAttempted,
    dlqClosureAttempted,
    firstJobResent: false,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerRequestCount: 0,
    notificationAdmissionEnabled: false,
    schedulesEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function main() {
  if (process.env.CONFIRM_WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY
    !== WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY_CONFIRMATION) {
    throw closeoutFailure(
      `Execution requires CONFIRM_WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY=${WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY_CONFIRMATION}`,
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_CONFIRMATION_REQUIRED',
    );
  }
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  const existingSummary = await readJsonIfExists(summaryPath);
  if (existingSummary) {
    assertCompletedSummary(existingSummary);
    process.stdout.write(`${JSON.stringify({ ...existingSummary, evidencePath: summaryPath }, null, 2)}\n`);
    return;
  }

  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const runner = createCommandRunner({
    execFileAsync,
    cwd: repositoryRoot,
    baseEnv: process.env,
  });

  currentStage = 'repository-finalizer-and-retained-attempt';
  const repository = await assertReviewedRepositoryState(runner);
  await runner.run('git', [
    'merge-base', '--is-ancestor',
    incident.originalRepositoryHead,
    repository.head,
  ]);
  const finalizerEvidence = JSON.parse(await readFile(finalizerEvidencePath, 'utf8'));
  assertWooCommerceReportFinalizerEvidence(finalizerEvidence);
  if (finalizerEvidence.repository?.head !== repository.head) {
    throw closeoutFailure(
      'WooCommerce Lark recovery requires Finalizer evidence from current main',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_FINALIZER_HEAD_MISMATCH',
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
  const originalAttempt = JSON.parse(await readFile(
    join(originalOutputRoot, incident.originalAttemptFile),
    'utf8',
  ));
  assertWooCommerceReportRetainedAttempt(originalAttempt);
  if (await readJsonIfExists(join(originalOutputRoot, incident.originalReplayFile))) {
    throw closeoutFailure(
      'Retained WooCommerce root unexpectedly contains a replay attempt',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_REPLAY_ALREADY_RECORDED',
    );
  }
  if (await readJsonIfExists(join(originalOutputRoot, incident.originalSummaryFile))) {
    throw closeoutFailure(
      'Retained WooCommerce root already contains a closeout summary',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_ORIGINAL_SUMMARY_EXISTS',
    );
  }

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

  currentStage = 'exact-read-only-incident-preflight';
  const pendingMigrations = await state.readPendingMigrations();
  if (pendingMigrations.length !== 0) {
    throw closeoutFailure(
      'Pending migrations block WooCommerce Lark recovery',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_PENDING_MIGRATIONS',
      { pendingMigrationCount: pendingMigrations.length },
    );
  }
  const client = createLarkBitableClientFromEnv(env);
  const larkInventory = await state.verifyLarkInventory(client, tableIds);
  const metricFields = await client.listFields({ tableId: tableIds.mktReportMetricValues });
  const dimensionOptions = assertWooCommerceReportDimensionOptions(metricFields);
  const selected = Object.freeze({ reportId: incident.reportId });
  const d1 = await state.readD1Snapshot(selected, incident.requestedAt);
  assertWooCommerceReportD1Prestate(d1);
  const failedSync = assertWooCommerceReportFailedSync([
    await state.readD1Row(buildWooCommerceReportFailedSyncSql()),
  ]);
  const dlq = assertWooCommerceReportOpenDlq([
    await state.readD1Row(buildWooCommerceReportOpenDlqSql()),
  ]);
  const larkBefore = await state.readLarkReportState(client, tableIds, incident.reportId);
  const larkPrestate = classifyWooCommerceReportLarkState(larkBefore);

  currentStage = 'backup-before-exact-repair';
  const backup = await state.createD1Backup('woocommerce-1d-before-lark-incomplete-recovery');

  let writeResult = null;
  let larkAfter = larkBefore;
  let integrity = null;
  let windowParity = null;
  let executionMode = 'verify_existing_completed_projection';

  if (larkPrestate === 'empty') {
    currentStage = 'write-existing-d1-materialization-through-shared-lark-writer';
    await writeReviewedAttempt(outputRoot, 'woocommerce-1d-direct-lark-write', {
      repositoryHead: repository.head,
      originalRepositoryHead: incident.originalRepositoryHead,
      reportId: incident.reportId,
      requestedAt: incident.requestedAt,
      jobSha256: incident.jobSha256,
      payloadChecksum: d1.payload_checksum,
      expectedSnapshotCount: incident.expectedSnapshotCount,
      expectedMetricCount: incident.expectedMetricCount,
      firstJobResent: false,
      queueActionCount: 0,
      workerDeploymentCount: 0,
      backup,
    });
    larkWriteAttempted = true;
    writeResult = await writeDashboardMaterializationToLark({
      reader: new D1ReportMaterializationReader({
        db: createExactMaterializationD1Binding(state, incident.reportId),
      }),
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
    if (writeResult.rows?.snapshots !== incident.expectedSnapshotCount
      || writeResult.rows?.metrics !== incident.expectedMetricCount
      || writeResult.rows?.topContent !== 0
      || writeResult.rows?.topAds !== 0) {
      throw closeoutFailure(
        'Shared Lark writer did not emit the reviewed WooCommerce row contract',
        'WOOCOMMERCE_REPORT_LARK_RECOVERY_WRITE_RESULT_INVALID',
        { rows: writeResult.rows ?? null },
      );
    }
    executionMode = 'direct_shared_lark_projection';
  }

  currentStage = 'verify-d1-lark-integrity-and-dashboard-window-parity';
  larkAfter = await state.readLarkReportState(client, tableIds, incident.reportId);
  classifyWooCommerceReportLarkState(larkAfter);
  integrity = assertD1LarkIntegrity(d1, larkAfter);
  const metricRecords = await client.searchRecords({
    tableId: tableIds.mktReportMetricValues,
    filter: {
      conjunction: 'and',
      conditions: [{ field_name: 'report_id', operator: 'is', value: [incident.reportId] }],
    },
    pageSize: 500,
    maxPages: 1_000,
  });
  windowParity = assertWooCommerceReportWindowParity(metricRecords);
  const stableReadback = await state.readLarkReportState(client, tableIds, incident.reportId);
  if (stableJson(larkAfter) !== stableJson(stableReadback)) {
    throw closeoutFailure(
      'WooCommerce Lark recovery readback changed between bounded verification reads',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_READBACK_DRIFT',
      {
        first: summarizeLarkState(larkAfter),
        second: summarizeLarkState(stableReadback),
      },
    );
  }

  currentStage = 'close-exact-retained-report-dlq';
  await writeReviewedAttempt(outputRoot, 'woocommerce-1d-close-exact-dlq', {
    repositoryHead: repository.head,
    reportId: incident.reportId,
    dlqIdFingerprint: dlq.dlqIdFingerprint,
    messageIdFingerprint: dlq.messageIdFingerprint,
    closureReference: dlq.closureReference,
    payloadChecksum: d1.payload_checksum,
    d1LarkIntegrityVerified: true,
    windowParityVerified: true,
  });
  dlqClosureAttempted = true;
  for (const statement of buildWooCommerceReportDlqClosureStatements(dlq, Date.now())) {
    await runner.runText('npx', [
      'wrangler', 'd1', 'execute', 'MKT_STATE_DB', '--remote', '--json',
      '--config', configPath, '--command', statement,
    ], { env });
  }
  const closedDlq = await state.readD1Row(buildWooCommerceReportDlqReadbackSql(dlq));
  assertWooCommerceReportDlqClosed(closedDlq, dlq);

  currentStage = 'sanitized-recovery-summary';
  const summary = sanitizeReportLiveClosureEvidence({
    ok: true,
    contractVersion: WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY_CONTRACT,
    decision: 'WOOCOMMERCE_REPORT_1D_LARK_INCOMPLETE_RECOVERED',
    repository,
    incident: {
      reportId: incident.reportId,
      originalRepositoryHead: incident.originalRepositoryHead,
      requestedAt: incident.requestedAt,
      jobSha256: incident.jobSha256,
      errorCode: incident.errorCode,
      rejectedDimensionType: incident.rejectedValue,
      dlqIdFingerprint: dlq.dlqIdFingerprint,
      messageIdFingerprint: dlq.messageIdFingerprint,
      closureReference: dlq.closureReference,
      firstJobResent: false,
      replacementReportIdentityCreated: false,
      closed: true,
    },
    preflight: {
      finalizerContractVersion: finalizerEvidence.contractVersion,
      finalizerSchemaVersion: finalizerEvidence.schema?.version ?? null,
      pendingMigrations,
      larkInventory,
      dimensionOptions,
      failedSync,
      backup,
      larkPrestate,
    },
    materialization: {
      reportId: d1.report_id,
      payloadChecksum: d1.payload_checksum,
      dataStatus: d1.data_status,
      d1MaterializationCount: Number(d1.materialization_count),
      larkRows: summarizeLarkState(larkAfter),
      integrity,
      windowParity,
      executionMode,
      writeResultRows: writeResult?.rows ?? null,
    },
    runtime: {
      notificationRuntimeState: finalizerAuthority.notificationRuntime.state,
      notificationAdmissionEnabled: false,
      schedulesEnabled: false,
      firstJobResent: false,
      replaySent: false,
      queueMessagesSent: 0,
      workerDeploymentCount: 0,
      providerRequestCount: 0,
      directBusinessFactMutationCount: 0,
      larkProjectionRecoveryExecuted: larkWriteAttempted,
      dlqMetadataClosureExecuted: true,
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
        throw new TypeError('Exact WooCommerce recovery D1 binding permits only readById');
      }
      return Object.freeze({
        bind(...values) {
          if (values.length !== 1 || values[0] !== reportId) {
            throw new TypeError('Exact WooCommerce recovery D1 binding report identity mismatch');
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
    || value.contractVersion !== WOOCOMMERCE_REPORT_LARK_INCOMPLETE_RECOVERY_CONTRACT
    || value.decision !== 'WOOCOMMERCE_REPORT_1D_LARK_INCOMPLETE_RECOVERED'
    || value.incident?.reportId !== incident.reportId
    || value.incident?.firstJobResent !== false
    || value.incident?.closed !== true
    || Number(value.materialization?.d1MaterializationCount ?? 0) !== 1
    || Number(value.materialization?.larkRows?.snapshots ?? 0) !== 1
    || Number(value.materialization?.larkRows?.metrics ?? 0) !== 58
    || Number(value.materialization?.larkRows?.duplicateMetricKeys ?? -1) !== 0
    || value.runtime?.queueMessagesSent !== 0
    || value.runtime?.workerDeploymentCount !== 0
    || value.runtime?.notificationAdmissionEnabled !== false
    || value.runtime?.schedulesEnabled !== false
    || value.runtime?.production !== false) {
    throw closeoutFailure(
      'Existing WooCommerce Lark recovery summary is incomplete',
      'WOOCOMMERCE_REPORT_LARK_RECOVERY_SUMMARY_INVALID',
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
