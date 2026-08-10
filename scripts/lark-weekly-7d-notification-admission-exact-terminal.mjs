#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { listCloudflareQueuesViaApi } from './lib/cloudflare-queue-list-rest.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  assertLarkNotificationRuntimeSettingsState,
  buildLarkNotificationRuntimeActivationWranglerConfig,
  resolveLarkNotificationRuntimeActivationSettings,
  selectLarkNotificationRuntimeExecutivePreviews,
} from './lib/lark-notification-runtime-activation.js';
import {
  extractLarkNotificationWranglerD1Rows,
} from './lib/lark-notification-remote-rollout-operator.js';
import {
  parseLarkNotificationDeploymentStatus,
} from './lib/lark-notification-safe-worker-deploy.js';
import { rebaseGeneratedWranglerConfigPaths } from './lib/rebase-generated-wrangler-config-paths.js';
import { parseWranglerDeploymentOutput } from './lib/tiktok-post-lark-rollout-operator.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
  resolveWooCommerceQueueId,
} from './lib/woocommerce-final-one-command.js';
import {
  LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONFIRMATION,
  LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
  assertLarkWeekly7dNotificationAdmissionBaseline,
  assertLarkWeekly7dNotificationAdmissionConfirmation,
  assertLarkWeekly7dNotificationAdmissionDelivered,
  assertLarkWeekly7dNotificationAdmissionStable,
  buildLarkWeekly7dNotificationAdmissionJob,
  buildLarkWeekly7dNotificationAdmissionReadbackSql,
  normalizeLarkWeekly7dNotificationAdmissionReadback,
} from './lib/lark-weekly-7d-notification-admission.js';
import {
  loadFreshWeekly7dExecutiveDecisionNotificationSource,
} from './lib/lark-weekly-7d-fresh-decision-notification-source.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS,
} from '../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../packages/config/src/lark-notification-runtime-config.js';
import {
  buildLarkExecutiveNotificationMessage,
} from '../packages/application/src/notifications/deliver-lark-executive-notification.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { loadLarkNotificationDeliveryRequest } from '../packages/connectors/src/lark/lark-notification-delivery-source.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';
import {
  parseSourceReportIds,
  resolveLarkNotificationControlledUatTables,
} from './lib/lark-notification-controlled-uat.js';

const ROOT = resolve(process.cwd());
const WORKER_NAME = 'social-mkt-sync-worker';
const SOURCE_CONFIG = resolve(
  process.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const OUTPUT_ROOT = resolve(
  process.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_EVIDENCE_ROOT
    ?? 'outputs/lark-weekly-7d-notification-admission',
);
const RECOVERY_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_WEEKLY_7D_NOTIFICATION_RECOVERY',
  value: 'RECOVER_ACCEPTED_WEEKLY_7D_NOTIFICATION_WITHOUT_RESEND',
});
const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';
const ACTIVE = new Set(['enable', 'enabled', 'active', 'on']);
const INACTIVE = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 90;
const OBSERVATION_MS = 15_000;
const SOURCE_HASH_FIELDS = Object.freeze([
  'ai_run_key',
  'report_id',
  'template_version',
  'scope_type',
  'channel_key',
  'window_days',
  'readiness_status',
  'generation_status',
  'failure_code',
  'preview_mode',
  'notification_eligible',
  'sent_to_group',
  'dedupe_key',
  'source_report_ids_json',
  'source_report_checksum',
  'metric_summary_json',
  'channel_status_vector_json',
  'insight_summary',
  'strengths',
  'weaknesses',
  'recommendations',
  'generated_at',
]);

let stage = 'init';
let action = 'plan';
let repository = null;
let queueAttemptRecorded = false;
let queueAdmissionConfirmed = false;
let workerDeploymentCount = 0;

try {
  action = parseArgs(process.argv.slice(2));
  if (action === 'plan') printPlan();
  else if (action === 'preview') await previewAdmission();
  else if (action === 'execute') await executeAdmission();
  else await recoverAdmission();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    action,
    stage,
    code: error?.code ?? 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_FAILED',
    message: sanitize(error?.message ?? String(error)),
    details: scrub(error?.details ?? {}),
    repository,
    queueAttemptRecorded,
    queueAdmissionCount: queueAdmissionConfirmed ? 1 : 0,
    queueOutcomeUncertain: queueAttemptRecorded && !queueAdmissionConfirmed,
    blindRerunAllowed: !queueAttemptRecorded,
    workerDeploymentCount,
    reportSettingWriteCount: 0,
    sourceDecisionMutationCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function previewAdmission() {
  const context = await prepare('preview');

  stage = 'verify-automation-state-read-only';
  const automation = await verifyAutomationState(context.client);

  stage = 'remote-read-only-preflight';
  const beforeD1 = assertLarkWeekly7dNotificationAdmissionBaseline(readD1State(context));
  const beforeLark = await readLarkBaseline(context);
  await assertSettingsActive(context);
  await assertSourceUnchanged(context);

  stage = 'validate-reviewed-fresh-decision-message';
  assertBusinessFirstMessage(context, context.admission.reviewedMessage);
  assertReviewedMessageParity(context, context.admission.reviewedMessage);

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    action: 'preview',
    mode: 'READ_ONLY',
    stage: 'complete',
    status: 'weekly_7d_notification_admission_read_only_passed',
    repository,
    sourceAiRunKeySha256: sha256(context.admission.sourceAiRunKey),
    admissionAiRunKeySha256: sha256(context.admission.aiRunKey),
    sourcePromptShape: context.admission.evidence.promptShape,
    qualityGatePassed: context.admission.qualityGate.passed,
    reviewedMessageSha256: context.admission.reviewedMessageSha256,
    reviewedMessageBytes: context.admission.reviewedMessageBytes,
    deliveryRowsBefore: beforeD1.totalDeliveryRows,
    sentMirroredRowsBefore: beforeD1.sentMirroredRows,
    notificationLogRowsBefore: beforeLark.totalSentNotificationLogRows,
    admissionAiRowsBefore: beforeLark.admissionAiRowsBefore,
    admissionLogRowsBefore: beforeLark.admissionLogRowsBefore,
    queueAdmissionCount: 0,
    messageSendCount: 0,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    sourceDecisionMutationCount: 0,
    aiAutomationStatus: automation.aiMaterialization.status,
    notificationAutomationStatus: automation.notification.status,
    notificationProducerEnabled: false,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
    nextGate: 'execute_requires_exact_confirmation',
  });
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function executeAdmission() {
  const context = await prepare('execute');

  stage = 'assert-fresh-admission-attempt';
  await assertNoFile(join(context.evidenceDir, '03-queue-send.attempt.json'), true);
  await assertNoFile(join(context.evidenceDir, 'notification-admission-summary.json'), true);

  stage = 'verify-automation-state-before-refresh';
  const automationBefore = await verifyAutomationState(context.client);

  stage = 'remote-read-only-preflight';
  const beforeD1 = assertLarkWeekly7dNotificationAdmissionBaseline(readD1State(context));
  const beforeLark = await readLarkBaseline(context);
  await privateJson(join(context.evidenceDir, '01-read-only-preflight.json'), {
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    repositoryHead: context.repositoryHead,
    sourceRecordId: context.sourceRecord.recordId ?? context.sourceRecord.record_id ?? null,
    sourceAiRunKey: context.admission.sourceAiRunKey,
    sourceStateSha256: context.sourceStateSha256,
    admissionAiRunKey: context.admission.aiRunKey,
    admissionAiRunKeySha256: sha256(context.admission.aiRunKey),
    admissionAttemptKeySha256: sha256(context.admission.notificationAttemptKey),
    sourceReportIds: context.admission.sourceReportIds,
    promptShape: context.admission.evidence.promptShape,
    qualityGatePassed: context.admission.qualityGate.passed,
    contentCandidateNames: context.admission.evidence.contentCandidateNames,
    adCandidateNames: context.admission.evidence.adCandidateNames,
    funnelDivergences: context.admission.evidence.funnelDivergences,
    reviewedMessageSha256: context.admission.reviewedMessageSha256,
    reviewedMessageBytes: context.admission.reviewedMessageBytes,
    deliveryRowsBefore: beforeD1.totalDeliveryRows,
    notificationLogRowsBefore: beforeLark.totalSentNotificationLogRows,
    controlledUatStable: true,
    runtimeSmokeStable: true,
    automationState: automationBefore,
    queueAdmissionCount: 0,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });

  stage = 'record-runtime-refresh-attempt';
  await privateJson(join(context.evidenceDir, '02-runtime-refresh.attempt.json'), {
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    repositoryHead: context.repositoryHead,
    attemptedAt: new Date().toISOString(),
    purpose: 'deploy_current_main_business_first_notification_renderer_v2',
    queueAdmissionCount: 0,
    reportSettingWriteCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });

  stage = 'deploy-current-main-notification-runtime';
  const deployedVersion = await deployAndVerifyCurrentRuntime(context);
  workerDeploymentCount = 1;
  await privateJson(join(context.evidenceDir, '02-runtime-refresh.result.json'), {
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    repositoryHead: context.repositoryHead,
    deployedVersion,
    trafficPercentage: 100,
    runtimeMode: 'runtime',
    notificationFlagsActive: true,
    reportSettingWriteCount: 0,
    queueAdmissionCount: 0,
    production: 'BLOCKED',
  });

  stage = 'verify-runtime-refresh-no-admission-drift';
  await assertSettingsActive(context);
  await verifyAutomationState(context.client);
  const postDeployD1 = assertLarkWeekly7dNotificationAdmissionBaseline(readD1State(context));
  if (JSON.stringify(beforeD1) !== JSON.stringify(postDeployD1)) {
    fail(
      'Current-main Runtime refresh changed notification delivery evidence before admission',
      'LARK_WEEKLY_7D_NOTIFICATION_RUNTIME_REFRESH_DRIFT',
    );
  }
  await assertSourceUnchanged(context);

  stage = 'reconcile-dedicated-notification-ai-run';
  await reconcileAdmissionRow(context);

  stage = 'validate-exact-delivery-request-and-message';
  const request = await loadLarkNotificationDeliveryRequest({
    repository: context.larkRepository,
    tables: context.tableIds,
    aiRunKey: context.admission.aiRunKey,
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });
  assertDeliveryChain(context, request);
  const message = buildLarkExecutiveNotificationMessage(request);
  assertBusinessFirstMessage(context, message);
  assertReviewedMessageParity(context, message);
  await privateJson(join(context.evidenceDir, '02-message-preview.json'), {
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    title: message.title,
    messageSha256: sha256(message.text),
    reviewedMessageSha256: context.admission.reviewedMessageSha256,
    exactReviewedMessageParity: true,
    messageBytes: Buffer.byteLength(message.text, 'utf8'),
    containsInternalReadinessLabel: hasInternalReadiness(message.text),
    rawDestinationPersisted: false,
  });

  stage = 'build-exact-runtime-job';
  const requestedAt = Date.now();
  const operationId = `lark_weekly_7d_notification_${sha256(context.admission.aiRunKey).slice(0, 32)}`;
  const job = buildLarkWeekly7dNotificationAdmissionJob({
    aiRunKey: context.admission.aiRunKey,
    operationId,
    requestedAt,
  });
  const jobHash = sha256(JSON.stringify(job));

  stage = 'record-one-queue-attempt';
  await privateJson(join(context.evidenceDir, '03-queue-send.attempt.json'), {
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    repositoryHead: context.repositoryHead,
    deployedVersion,
    aiRunKey: context.admission.aiRunKey,
    aiRunKeySha256: sha256(context.admission.aiRunKey),
    operationId,
    operationIdSha256: sha256(operationId),
    jobSha256: jobHash,
    sourceStateSha256: context.sourceStateSha256,
    reviewedMessageSha256: context.admission.reviewedMessageSha256,
    attemptedAt: new Date().toISOString(),
    maximumQueueAdmissionCount: 1,
    blindRerunAllowedAfterThisFile: false,
  });
  queueAttemptRecorded = true;

  stage = 'send-one-weekly-runtime-queue-job';
  await sendQueueOnce(context, job);
  queueAdmissionConfirmed = true;

  stage = 'poll-sent-and-mirrored';
  const delivered = await pollDelivered(context, beforeD1);

  stage = 'verify-lark-mirror-and-source-immutability';
  const afterLark = await verifyLarkDelivery(context, beforeLark);
  await assertSourceUnchanged(context);

  stage = 'bounded-no-additional-admission-observation';
  await sleep(readObservationMs(context.env));
  const observed = readD1State(context);
  const stability = assertLarkWeekly7dNotificationAdmissionStable(delivered, observed);
  const observedLark = await verifyLarkDelivery(context, beforeLark);
  if (JSON.stringify(afterLark) !== JSON.stringify(observedLark)) {
    fail(
      'Weekly 7D Lark mirror changed during the no-admission observation window',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_LARK_STABILITY_FAILED',
    );
  }
  await assertSourceUnchanged(context);
  await assertSettingsActive(context);
  const automationAfter = await verifyAutomationState(context.client);
  assertSameAutomationState(automationBefore, automationAfter);
  verifyDeployedVersion(context, deployedVersion);

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    action: 'execute',
    stage: 'complete',
    status: 'weekly_7d_notification_admission_sent_and_verified',
    repository,
    activeVersion: deployedVersion,
    trafficPercentage: 100,
    notificationTemplateVersion: 'executive_report_notification_v2',
    sourcePromptShape: context.admission.evidence.promptShape,
    qualityGatePassed: context.admission.qualityGate.passed,
    reviewedMessageSha256: context.admission.reviewedMessageSha256,
    sourceDecisionMutationCount: 0,
    sourceAiRunKeySha256: sha256(context.admission.sourceAiRunKey),
    admissionAiRunKeySha256: sha256(context.admission.aiRunKey),
    queueAdmissionCount: 1,
    messageSendCount: 1,
    deliveryRowsBefore: delivered.deliveryRowsBefore,
    deliveryRowsAfter: delivered.deliveryRowsAfter,
    additionalDeliveryRows: delivered.additionalDeliveryRows,
    deliveryStatus: delivered.admissionDeliveryStatus,
    mirrorStatus: delivered.admissionMirrorStatus,
    notificationLogRowsBefore: beforeLark.totalSentNotificationLogRows,
    notificationLogRowsAfter: afterLark.totalSentNotificationLogRows,
    additionalNotificationLogRows: 1,
    sentToGroup: afterLark.admissionAiRunMarkedSent,
    exactDeliveryRows: stability.exactDeliveryRows,
    duplicateDeliveryRows: stability.duplicateDeliveryRows,
    additionalMessageSendCountDuringObservation:
      stability.additionalMessageSendCountDuringObservation,
    workerDeploymentCount: 1,
    reportSettingWriteCount: 0,
    runtimeRemainsActive: true,
    reportSettingsRemainActive: true,
    aiAutomationStatus: automationAfter.aiMaterialization.status,
    notificationAutomationStatus: automationAfter.notification.status,
    notificationProducerEnabled: false,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
    nextGate: 'automatic_weekly_notification_schedule_requires_separate_approval',
  });
  await privateJson(join(context.evidenceDir, 'notification-admission-summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function recoverAdmission() {
  const context = await prepare('recover');
  stage = 'verify-retained-queue-attempt';
  const attemptPath = join(context.evidenceDir, '03-queue-send.attempt.json');
  await requireFile(attemptPath);
  await assertNoFile(join(context.evidenceDir, 'notification-admission-summary.json'), false);
  const attempt = JSON.parse(await readFile(attemptPath, 'utf8'));
  if (attempt.aiRunKey !== context.admission.aiRunKey
      || attempt.sourceStateSha256 !== context.sourceStateSha256
      || attempt.reviewedMessageSha256 !== context.admission.reviewedMessageSha256) {
    fail(
      'Recovery evidence does not match the retained Fresh Weekly Executive Decision source',
      'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_EVIDENCE_INVALID',
    );
  }
  queueAttemptRecorded = true;
  queueAdmissionConfirmed = true;

  stage = 'verify-recovery-safety-boundary';
  const beforeLark = await readLarkBaseline(context, { allowAdmissionRow: true });
  await assertSettingsActive(context);
  const automationBefore = await verifyAutomationState(context.client);

  stage = 'poll-existing-admission-without-resend';
  const delivered = await pollExistingDelivered(context);

  stage = 'verify-recovered-lark-mirror';
  const afterLark = await verifyRecoveredLarkDelivery(context, beforeLark);
  await assertSourceUnchanged(context);

  stage = 'recovery-no-admission-observation';
  await sleep(readObservationMs(context.env));
  const observed = readD1State(context);
  const stability = assertLarkWeekly7dNotificationAdmissionStable(delivered, observed);
  const observedLark = await verifyRecoveredLarkDelivery(context, beforeLark);
  if (JSON.stringify(afterLark) !== JSON.stringify(observedLark)) {
    fail(
      'Recovered weekly Notification state changed without a new admission',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_LARK_STABILITY_FAILED',
    );
  }
  const automationAfter = await verifyAutomationState(context.client);
  assertSameAutomationState(automationBefore, automationAfter);
  await assertSettingsActive(context);

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    action: 'recover',
    stage: 'complete',
    status: 'weekly_7d_notification_admission_recovered_without_resend',
    repository,
    mode: 'POLL_ONLY_RECOVERY',
    sourceDecisionMutationCount: 0,
    reviewedMessageSha256: context.admission.reviewedMessageSha256,
    queueAdmissionCountByRecovery: 0,
    messageSendCountByRecovery: 0,
    deliveryStatus: delivered.admissionDeliveryStatus,
    mirrorStatus: delivered.admissionMirrorStatus,
    sentToGroup: afterLark.admissionAiRunMarkedSent,
    exactDeliveryRows: stability.exactDeliveryRows,
    duplicateDeliveryRows: stability.duplicateDeliveryRows,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    notificationAutomationStatus: automationAfter.notification.status,
    notificationProducerEnabled: false,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });
  await privateJson(join(context.evidenceDir, 'notification-admission-summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function prepare(mode) {
  stage = 'load-local-environment';
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  if (mode === 'execute') assertLarkWeekly7dNotificationAdmissionConfirmation(env);
  else if (mode === 'recover') assertRecoveryConfirmation(env);
  exact(env.MKT_ENV, 'development', 'MKT_ENV');
  exact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  exact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  stage = 'repository-preflight';
  const repositoryHead = exactMainHead();

  stage = 'local-focused-gates';
  if (mode === 'execute') {
    run('node', ['--test',
      'tests/application/lark-weekly-7d-notification-admission.test.js',
      'tests/application/lark-weekly-7d-fresh-decision-notification-source.test.js',
      'tests/application/deliver-lark-executive-notification.test.js',
      'tests/application/lark-notification-active-job-router.test.js',
      'tests/connectors/lark-notification-delivery-source.test.js',
      'tests/connectors/d1-lark-notification-delivery-store.test.js',
    ], { stdio: 'inherit' });
    run('npm', ['run', 'check'], { stdio: 'inherit' });
  }

  stage = 'assert-no-automatic-notification-producer';
  const scheduledJobsSource = await readFile(
    resolve('apps/sync-worker/src/scheduled-jobs.js'),
    'utf8',
  );
  if (/LARK_NOTIFICATION_SEND/u.test(scheduledJobsSource)) {
    fail(
      'Weekly Notification Admission requires automatic schedule admission to remain absent',
      'LARK_WEEKLY_7D_NOTIFICATION_SCHEDULE_PRESENT',
    );
  }

  stage = 'resolve-lark-authority';
  const client = createLarkBitableClientFromEnv(Object.freeze({
    ...env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_MAX_PAGES: '5',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  }));
  const tableIds = resolveLarkNotificationControlledUatTables(await client.listTables());
  const larkRepository = new LarkRecordRepository({ client });
  const syncEngine = new TableSyncEngine();

  stage = 'load-exact-fresh-executive-decision-source';
  const admission = await loadFreshWeekly7dExecutiveDecisionNotificationSource({
    client,
    repository: larkRepository,
    aiRunsTableId: tableIds.aiRuns,
  });
  const sourceRecord = admission.sourceRecord;
  const sourceStateSha256 = hashSourceState(sourceRecord.fields);
  const evidenceDir = resolve(OUTPUT_ROOT, sha256(admission.aiRunKey));
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);

  stage = 'resolve-runtime-settings-authority';
  const executiveRows = await larkRepository.listByFieldValues(
    tableIds.aiRuns,
    'scope_type',
    ['executive'],
  );
  const previews = selectLarkNotificationRuntimeExecutivePreviews(executiveRows);
  const runtimeSourceReportIds = [...new Set(previews.flatMap((record) => (
    parseSourceReportIds(record.fields.source_report_ids_json)
  )))].sort();
  const allSourceReportIds = [...new Set([
    ...runtimeSourceReportIds,
    ...admission.sourceReportIds,
  ])].sort();
  const snapshotRows = await larkRepository.listByFieldValues(
    tableIds.reportSnapshots,
    'report_id',
    allSourceReportIds,
  );
  const settingKeys = [...new Set(runtimeSourceReportIds.map((reportId) => {
    const matchesForReport = snapshotRows.filter((record) => (
      String(scalar(record?.fields?.report_id) ?? '') === reportId
    ));
    if (matchesForReport.length !== 1) {
      fail(
        'Could not resolve exact Runtime source Report Snapshot',
        'LARK_WEEKLY_7D_NOTIFICATION_RUNTIME_SOURCE_INVALID',
        { matchCount: matchesForReport.length },
      );
    }
    return requireText(scalar(matchesForReport[0].fields.report_setting_key), 'report_setting_key');
  }))].sort();
  const sourceSettingKeys = [...new Set(admission.sourceReportIds.map((reportId) => {
    const matchesForReport = snapshotRows.filter((record) => (
      String(scalar(record?.fields?.report_id) ?? '') === reportId
    ));
    if (matchesForReport.length !== 1) {
      fail(
        'Could not resolve exact Fresh Weekly Executive Decision source Report Snapshot',
        'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_REPORT_INVALID',
        { matchCount: matchesForReport.length },
      );
    }
    return requireText(scalar(matchesForReport[0].fields.report_setting_key), 'report_setting_key');
  }))].sort();
  const settingRows = await larkRepository.listByFieldValues(
    tableIds.reportSettings,
    'report_setting_key',
    [...new Set([...settingKeys, ...sourceSettingKeys])],
  );
  const settingsAuthority = resolveLarkNotificationRuntimeActivationSettings({
    previews,
    snapshots: snapshotRows,
    settings: settingRows,
    expectedState: 'active',
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });
  const missingSourceSettings = sourceSettingKeys.filter(
    (key) => !settingsAuthority.settingKeys.includes(key),
  );
  if (missingSourceSettings.length > 0) {
    fail(
      'Fresh Weekly Executive Decision source Reports are outside the active Notification Runtime Settings authority',
      'LARK_WEEKLY_7D_NOTIFICATION_RUNTIME_SOURCE_INVALID',
      { missingSourceSettingCount: missingSourceSettings.length },
    );
  }

  stage = 'resolve-local-runtime-topology';
  const sourceText = await readFile(SOURCE_CONFIG, 'utf8');
  const sourceConfig = parseJsoncObject(sourceText);
  const activeConfig = buildLarkNotificationRuntimeActivationWranglerConfig(
    sourceText,
    tableIds,
    { active: true },
  );
  if (!activeConfig.scheduleConfigPreserved) {
    fail(
      'Generated Notification Runtime config changed Worker trigger configuration',
      'LARK_WEEKLY_7D_NOTIFICATION_RUNTIME_CONFIG_INVALID',
    );
  }
  const generatedDir = resolve(evidenceDir, 'generated-config');
  await mkdir(generatedDir, { recursive: true, mode: 0o700 });
  const activeConfigPath = resolve(generatedDir, 'runtime-active-current-main.json');
  await writeGeneratedConfig(activeConfigPath, activeConfig.text);

  const cloudflare = resolveCloudflareTarget(env, sourceText);
  const databaseName = resolveDatabaseName(sourceConfig);
  const queueName = resolveQueueName(sourceConfig);
  const queueId = resolveWooCommerceQueueId(
    JSON.stringify(await listCloudflareQueuesViaApi({
      accountId: cloudflare.accountId,
      bearerToken: freshQueueBearer(cloudflare),
    })),
    queueName,
  );

  if (mode === 'execute') {
    stage = 'dry-run-current-main-runtime';
    run('npx', ['wrangler', 'deploy', '--dry-run', '--config', activeConfigPath], {
      env: cloudflare.wranglerEnv,
      stdio: 'inherit',
    });
  }

  repository = Object.freeze({
    branch: 'main',
    head: repositoryHead,
    originMain: repositoryHead,
    clean: true,
  });
  return Object.freeze({
    env,
    mode,
    repositoryHead,
    evidenceDir,
    sourceText,
    sourceConfig,
    activeConfigPath,
    cloudflare,
    databaseName,
    queueName,
    queueId,
    client,
    tableIds,
    larkRepository,
    syncEngine,
    sourceRecord,
    sourceStateSha256,
    admission,
    previews,
    snapshotRows,
    settingsAuthority,
  });
}

async function reconcileAdmissionRow(context) {
  const plan = await context.syncEngine.planByKey({
    repository: context.larkRepository,
    tableId: context.tableIds.aiRuns,
    keyField: 'ai_run_key',
    rows: [context.admission.fields],
  });
  if (plan.updateRows.length !== 0) {
    fail(
      'Existing weekly Notification Admission row differs from accepted source identity',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_ROW_DRIFT',
      { updateRows: plan.updateRows.length },
    );
  }
  const result = await context.syncEngine.executePlan(plan);
  if (result.created + result.skipped !== 1 || result.updated !== 0) {
    fail(
      'Weekly Notification Admission row did not reconcile exactly once',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_ROW_WRITE_FAILED',
    );
  }
}

function assertDeliveryChain(context, request) {
  if (!request.settings.enabled
      || !request.settings.aiEnabled
      || !request.settings.notificationEnabled
      || request.snapshot.customerProfile !== 'integration_workspace'
      || Number(request.aiRun.windowDays) !== 7
      || request.aiRun.aiRunKey !== context.admission.aiRunKey
      || request.aiRun.notificationEligible !== true
      || request.aiRun.previewMode !== false
      || request.aiRun.sentToGroup !== false
      || JSON.stringify([...request.snapshot.sourceReportIds].sort())
        !== JSON.stringify([...context.admission.sourceReportIds].sort())) {
    fail(
      'Weekly Notification Admission delivery chain is not exact or active',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_DELIVERY_CHAIN_INVALID',
    );
  }
}

function assertBusinessFirstMessage(context, message) {
  const invalid = [];
  if (message.title !== '📊 Social MKT Weekly Executive Report — 7D') invalid.push('title');
  if (!message.text.includes('ภาพรวมสัปดาห์นี้')) invalid.push('overviewHeading');
  if (!message.text.includes('🏆 สิ่งที่เด่นที่สุดประจำสัปดาห์')) invalid.push('strengthsHeading');
  if (!message.text.includes('⚠️ สิ่งที่ต้องจับตา')) invalid.push('weaknessesHeading');
  if (!message.text.includes('🎯 สิ่งที่ควรทำสัปดาห์หน้า')) invalid.push('recommendationsHeading');
  if (hasInternalReadiness(message.text)) invalid.push('internalReadinessLeak');
  for (const output of [
    context.admission.fields.insight_summary,
    context.admission.fields.strengths,
    context.admission.fields.weaknesses,
    context.admission.fields.recommendations,
  ]) {
    if (!message.text.includes(String(scalar(output) ?? '').trim())) {
      invalid.push('acceptedOutputMissing');
      break;
    }
  }
  if (invalid.length > 0) {
    fail(
      'Business-first weekly Notification message preview failed',
      'LARK_WEEKLY_7D_NOTIFICATION_MESSAGE_INVALID',
      { invalid },
    );
  }
}

function assertReviewedMessageParity(context, message) {
  const observedSha256 = sha256(message.text);
  if (message.text !== context.admission.reviewedMessage.text
      || observedSha256 !== context.admission.reviewedMessageSha256) {
    fail(
      'Weekly Notification runtime message differs from the reviewed Fresh Executive Decision Preview',
      'LARK_WEEKLY_7D_NOTIFICATION_MESSAGE_PARITY_FAILED',
      {
        expectedMessageSha256: context.admission.reviewedMessageSha256,
        observedMessageSha256: observedSha256,
      },
    );
  }
  return true;
}

function hasInternalReadiness(textValue) {
  return /report_partial|report_available|readiness_status|data_status|สถานะข้อมูล|ระดับ:\s*(?:info|warning|critical)/iu
    .test(String(textValue ?? ''));
}

async function assertSourceUnchanged(context) {
  const rows = await context.larkRepository.listByFieldValues(
    context.tableIds.aiRuns,
    'ai_run_key',
    [context.admission.sourceAiRunKey],
  );
  const exact = rows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.sourceAiRunKey
  ));
  if (exact.length !== 1 || hashSourceState(exact[0].fields) !== context.sourceStateSha256) {
    fail(
      'Fresh Weekly Executive Decision source row changed during Notification Admission',
      'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_MUTATED',
      { matchCount: exact.length },
    );
  }
  return true;
}

function hashSourceState(fields) {
  const normalized = Object.fromEntries(SOURCE_HASH_FIELDS.map((name) => [
    name,
    name === 'preview_mode' || name === 'notification_eligible' || name === 'sent_to_group'
      ? booleanValue(fields?.[name])
      : optionalText(fields?.[name]),
  ]));
  return sha256(JSON.stringify(normalized));
}

async function readLarkBaseline(context, options = {}) {
  const [sentLogRows, controlledAiRows, smokeAiRows, admissionAiRows, admissionLogRows] = await Promise.all([
    context.larkRepository.listByFieldValues(
      context.tableIds.notificationLog,
      'attempt_status',
      ['sent'],
    ),
    context.larkRepository.listByFieldValues(
      context.tableIds.aiRuns,
      'scope_type',
      ['executive'],
    ),
    context.larkRepository.listByFieldValues(
      context.tableIds.aiRuns,
      'scope_type',
      ['executive'],
    ),
    context.larkRepository.listByFieldValues(
      context.tableIds.aiRuns,
      'ai_run_key',
      [context.admission.aiRunKey],
    ),
    context.larkRepository.listByFieldValues(
      context.tableIds.notificationLog,
      'ai_run_key',
      [context.admission.aiRunKey],
    ),
  ]);
  const controlledAi = controlledAiRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  const smokeAi = smokeAiRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-runtime-smoke:')
  ));
  const controlledLogs = sentLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  const smokeLogs = sentLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-runtime-smoke:')
  ));
  if (controlledAi.length !== 1
      || controlledLogs.length !== 1
      || smokeAi.length !== 1
      || smokeLogs.length !== 1
      || booleanValue(controlledAi[0].fields.sent_to_group) !== true
      || booleanValue(smokeAi[0].fields.sent_to_group) !== true) {
    fail(
      'Weekly Notification Admission requires retained Controlled UAT and Runtime Smoke Lark closeout',
      'LARK_WEEKLY_7D_NOTIFICATION_LARK_BASELINE_INVALID',
      {
        controlledAiRows: controlledAi.length,
        controlledLogRows: controlledLogs.length,
        runtimeSmokeAiRows: smokeAi.length,
        runtimeSmokeLogRows: smokeLogs.length,
      },
    );
  }
  const exactAdmissionAi = admissionAiRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey
  ));
  const exactAdmissionLog = admissionLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey
  ));
  if (options.allowAdmissionRow === true) {
    if (exactAdmissionAi.length !== 1 || exactAdmissionLog.length > 1) {
      fail(
        'Recovery requires one exact retained admission AI row and at most one mirror row',
        'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_LARK_STATE_INVALID',
        { aiRows: exactAdmissionAi.length, logRows: exactAdmissionLog.length },
      );
    }
  } else if (exactAdmissionLog.length !== 0
      || exactAdmissionAi.length > 1
      || (exactAdmissionAi.length === 1
        && booleanValue(exactAdmissionAi[0].fields.sent_to_group) !== false)) {
    fail(
      'Weekly Notification Admission identity already has sent/mirror evidence',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_ALREADY_ATTEMPTED',
      { aiRows: exactAdmissionAi.length, logRows: exactAdmissionLog.length },
    );
  }
  return Object.freeze({
    totalSentNotificationLogRows: sentLogRows.length,
    controlledUatAiRows: 1,
    controlledUatNotificationLogRows: 1,
    runtimeSmokeAiRows: 1,
    runtimeSmokeNotificationLogRows: 1,
    controlledUatStable: true,
    runtimeSmokeStable: true,
    admissionAiRowsBefore: exactAdmissionAi.length,
    admissionLogRowsBefore: exactAdmissionLog.length,
  });
}

async function verifyLarkDelivery(context, baseline) {
  const [sentLogRows, admissionAiRows, admissionLogRows] = await Promise.all([
    context.larkRepository.listByFieldValues(
      context.tableIds.notificationLog,
      'attempt_status',
      ['sent'],
    ),
    context.larkRepository.listByFieldValues(
      context.tableIds.aiRuns,
      'ai_run_key',
      [context.admission.aiRunKey],
    ),
    context.larkRepository.listByFieldValues(
      context.tableIds.notificationLog,
      'ai_run_key',
      [context.admission.aiRunKey],
    ),
  ]);
  const exactAi = admissionAiRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey
  ));
  const exactLog = admissionLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey
  ));
  const controlledLogs = sentLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  const smokeLogs = sentLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-runtime-smoke:')
  ));
  if (exactAi.length !== 1
      || exactLog.length !== 1
      || sentLogRows.length !== baseline.totalSentNotificationLogRows + 1
      || controlledLogs.length !== 1
      || smokeLogs.length !== 1
      || booleanValue(exactAi[0].fields.sent_to_group) !== true
      || String(scalar(exactLog[0].fields.attempt_status) ?? '') !== 'sent') {
    fail(
      'Weekly Notification Admission Lark mirror parity failed',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_LARK_PARITY_FAILED',
      {
        admissionAiRows: exactAi.length,
        admissionNotificationLogRows: exactLog.length,
        totalSentNotificationLogRows: sentLogRows.length,
      },
    );
  }
  return Object.freeze({
    totalSentNotificationLogRows: sentLogRows.length,
    admissionNotificationLogRows: 1,
    admissionAiRunMarkedSent: true,
    controlledUatStable: true,
    runtimeSmokeStable: true,
  });
}

async function verifyRecoveredLarkDelivery(context, baseline) {
  const [sentLogRows, admissionAiRows, admissionLogRows] = await Promise.all([
    context.larkRepository.listByFieldValues(
      context.tableIds.notificationLog,
      'attempt_status',
      ['sent'],
    ),
    context.larkRepository.listByFieldValues(
      context.tableIds.aiRuns,
      'ai_run_key',
      [context.admission.aiRunKey],
    ),
    context.larkRepository.listByFieldValues(
      context.tableIds.notificationLog,
      'ai_run_key',
      [context.admission.aiRunKey],
    ),
  ]);
  const exactAi = admissionAiRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey
  ));
  const exactLog = admissionLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey
  ));
  if (exactAi.length !== 1
      || exactLog.length !== 1
      || booleanValue(exactAi[0].fields.sent_to_group) !== true
      || String(scalar(exactLog[0].fields.attempt_status) ?? '') !== 'sent') {
    fail(
      'Recovery has not reached exact Lark sent/mirror parity',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_LARK_PARITY_FAILED',
      { aiRows: exactAi.length, logRows: exactLog.length },
    );
  }
  if (sentLogRows.length < baseline.totalSentNotificationLogRows) {
    fail(
      'Recovery observed Notification Log loss',
      'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_LARK_PARITY_FAILED',
    );
  }
  return Object.freeze({
    totalSentNotificationLogRows: sentLogRows.length,
    admissionNotificationLogRows: 1,
    admissionAiRunMarkedSent: true,
  });
}

function readD1State(context) {
  const output = text('npx', [
    'wrangler', 'd1', 'execute', context.databaseName,
    '--remote',
    '--config', context.activeConfigPath,
    '--command', buildLarkWeekly7dNotificationAdmissionReadbackSql(context.admission.aiRunKey),
    '--json',
  ], { env: context.cloudflare.wranglerEnv });
  const row = extractLarkNotificationWranglerD1Rows(output)[0];
  return normalizeLarkWeekly7dNotificationAdmissionReadback(row);
}

async function pollDelivered(context, before) {
  const maxPolls = positiveInteger(
    context.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_MAX_POLLS ?? MAX_POLLS,
    'maxPolls',
  );
  const interval = positiveInteger(
    context.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_POLL_INTERVAL_MS ?? POLL_INTERVAL_MS,
    'pollIntervalMs',
  );
  let last = null;
  for (let index = 1; index <= maxPolls; index += 1) {
    last = readD1State(context);
    process.stdout.write(`${JSON.stringify({
      event: 'lark_weekly_7d_notification_progress',
      poll: index,
      totalDeliveryRows: last.totalDeliveryRows,
      admissionDeliveryRows: last.admissionDeliveryRows,
      admissionDeliveryStatus: last.admissionDeliveryStatus,
      admissionMirrorStatus: last.admissionMirrorStatus,
      unrelatedUnsafeDeliveryRows: last.unrelatedUnsafeDeliveryRows,
    })}\n`);
    try {
      return assertLarkWeekly7dNotificationAdmissionDelivered(before, last);
    } catch (error) {
      if (error?.code !== 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_NOT_CONFIRMED') throw error;
    }
    if (index < maxPolls) await sleep(interval);
  }
  fail(
    'Weekly Notification Admission delivery verification timed out',
    'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_VERIFY_TIMEOUT',
    {
      admissionDeliveryRows: last?.admissionDeliveryRows ?? null,
      admissionDeliveryStatus: last?.admissionDeliveryStatus ?? null,
      admissionMirrorStatus: last?.admissionMirrorStatus ?? null,
    },
  );
}

async function pollExistingDelivered(context) {
  const first = readD1State(context);
  if (first.admissionDeliveryRows === 0) {
    fail(
      'Recovery found no retained admitted D1 delivery; automatic resend is forbidden',
      'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_DELIVERY_MISSING',
    );
  }
  const syntheticBefore = Object.freeze({
    ...first,
    totalDeliveryRows: first.totalDeliveryRows - 1,
    sentMirroredRows: Math.max(0, first.sentMirroredRows - (
      first.admissionDeliveryStatus === 'sent' && first.admissionMirrorStatus === 'mirrored' ? 1 : 0
    )),
    unsafeDeliveryRows: 0,
    admissionDeliveryRows: 0,
    admissionDeliveryStatus: null,
    admissionMirrorStatus: null,
    admissionClaimCount: 0,
    admissionSentAt: null,
    admissionMessageIdHash: null,
  });
  return pollDelivered(context, syntheticBefore);
}

async function sendQueueOnce(context, job) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(context.cloudflare.accountId)}`
      + `/queues/${encodeURIComponent(context.queueId)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${freshQueueBearer(context.cloudflare)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    fail(
      'Cloudflare Queue did not confirm weekly Notification admission',
      'LARK_WEEKLY_7D_NOTIFICATION_QUEUE_SEND_FAILED',
      { status: response.status },
    );
  }
}

async function deployAndVerifyCurrentRuntime(context) {
  const outputPath = resolve(
    context.evidenceDir,
    `.wrangler-weekly-runtime-refresh-${randomUUID()}.ndjson`,
  );
  try {
    run('npx', ['wrangler', 'deploy', '--config', context.activeConfigPath], {
      env: { ...context.cloudflare.wranglerEnv, WRANGLER_OUTPUT_FILE_PATH: outputPath },
      stdio: 'inherit',
    });
    const output = await readFile(outputPath, 'utf8');
    const versionId = parseWranglerDeploymentOutput(output, { workerName: WORKER_NAME })
      .deploymentVersionId;
    verifyDeployedVersion(context, versionId);
    return versionId;
  } finally {
    await rm(outputPath, { force: true });
  }
}

function verifyDeployedVersion(context, versionId) {
  const status = text('npx', [
    'wrangler', 'deployments', 'status', '--config', context.activeConfigPath, '--json',
  ], { env: context.cloudflare.wranglerEnv });
  const verified = parseLarkNotificationDeploymentStatus(status, versionId);
  if (verified.trafficPercentage !== 100) {
    fail(
      'Current-main Notification Runtime is not serving 100 percent of traffic',
      'LARK_WEEKLY_7D_NOTIFICATION_RUNTIME_DEPLOYMENT_INVALID',
    );
  }
  return verified;
}

async function assertSettingsActive(context) {
  const records = await context.larkRepository.listByFieldValues(
    context.tableIds.reportSettings,
    'report_setting_key',
    context.settingsAuthority.settingKeys,
  );
  return assertLarkNotificationRuntimeSettingsState(
    records,
    context.settingsAuthority,
    true,
  );
}

async function verifyAutomationState(client) {
  const workflowResponse = await client.requestBitableJson(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}/workflows`,
    { method: 'GET' },
  );
  const workflows = workflowResponse?.data?.workflows
    ?? workflowResponse?.data?.items
    ?? workflowResponse?.workflows
    ?? [];
  const ai = exactWorkflow(workflows, AI_TITLE);
  const notification = exactWorkflow(workflows, NOTIFICATION_TITLE);
  const expectedAi = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS
    .find((item) => item.title === AI_TITLE);
  const expectedNotification = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS
    .find((item) => item.title === NOTIFICATION_TITLE);
  const aiHash = sha256(workflowId(ai));
  const notificationHash = sha256(workflowId(notification));
  const aiStatus = requireText(ai.status ?? ai.state, 'AI automation status').toLowerCase();
  const notificationStatus = requireText(
    notification.status ?? notification.state,
    'Notification automation status',
  ).toLowerCase();
  if (aiHash !== expectedAi?.workflowIdSha256 || !ACTIVE.has(aiStatus)) {
    fail(
      'Exact AI Materialization Automation must remain active',
      'LARK_WEEKLY_7D_NOTIFICATION_AI_AUTOMATION_INVALID',
      { identityMatches: aiHash === expectedAi?.workflowIdSha256, status: aiStatus },
    );
  }
  if (notificationHash !== expectedNotification?.workflowIdSha256
      || !INACTIVE.has(notificationStatus)) {
    fail(
      'Exact Base Notification Automation must remain inactive',
      'LARK_WEEKLY_7D_NOTIFICATION_BASE_AUTOMATION_UNSAFE',
      {
        identityMatches: notificationHash === expectedNotification?.workflowIdSha256,
        status: notificationStatus,
      },
    );
  }
  return Object.freeze({
    aiMaterialization: Object.freeze({ status: aiStatus, identitySha256: aiHash }),
    notification: Object.freeze({ status: notificationStatus, identitySha256: notificationHash }),
  });
}

function assertSameAutomationState(before, after) {
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    fail(
      'Automation identity/status changed during weekly Notification Admission',
      'LARK_WEEKLY_7D_NOTIFICATION_AUTOMATION_DRIFT',
    );
  }
}
function exactWorkflow(workflows, title) {
  const matches = workflows.filter((item) => optionalText(item?.title ?? item?.name) === title);
  if (matches.length !== 1) {
    fail(
      `Expected one exact Automation: ${title}`,
      'LARK_WEEKLY_7D_NOTIFICATION_AUTOMATION_IDENTITY_INVALID',
      { title, count: matches.length },
    );
  }
  return matches[0];
}
function workflowId(workflow) {
  return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id');
}

function resolveCloudflareTarget(env, configText) {
  const wranglerEnv = buildWranglerOAuthEnvironment(env);
  const whoami = text('npx', ['wrangler', 'whoami', '--json'], { env: wranglerEnv });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    preferredAccount: env.MKT_LARK_WEEKLY_7D_NOTIFICATION_ACCOUNT
      ?? env.MKT_LARK_NOTIFICATION_RUNTIME_ACCOUNT,
    configText,
    whoamiOutput: whoami,
  });
  const selected = Object.freeze({ ...wranglerEnv, CLOUDFLARE_ACCOUNT_ID: accountId });
  const auth = resolveCloudflareBearerAuth({
    authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], { env: selected }),
  });
  return Object.freeze({ accountId, wranglerEnv: selected, authType: auth.type });
}
function freshQueueBearer(cloudflare) {
  const auth = resolveCloudflareBearerAuth({
    authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], {
      env: cloudflare.wranglerEnv,
    }),
  });
  if (auth.type !== cloudflare.authType) {
    fail(
      'Cloudflare authentication type changed during weekly Notification Admission',
      'LARK_WEEKLY_7D_NOTIFICATION_AUTH_DRIFT',
    );
  }
  return auth.token;
}
function resolveDatabaseName(config) {
  const matches = Array.isArray(config?.d1_databases)
    ? config.d1_databases.filter((item) => item?.binding === 'MKT_STATE_DB')
    : [];
  if (matches.length !== 1) {
    fail(
      'Weekly Notification Admission requires one MKT_STATE_DB binding',
      'LARK_WEEKLY_7D_NOTIFICATION_CONFIG_INVALID',
      { bindingCount: matches.length },
    );
  }
  return requireText(matches[0].database_name, 'database_name');
}
function resolveQueueName(config) {
  const matches = Array.isArray(config?.queues?.producers)
    ? config.queues.producers.filter((item) => item?.binding === 'MKT_SYNC_QUEUE')
    : [];
  if (matches.length !== 1) {
    fail(
      'Weekly Notification Admission requires one MKT_SYNC_QUEUE producer',
      'LARK_WEEKLY_7D_NOTIFICATION_CONFIG_INVALID',
      { producerCount: matches.length },
    );
  }
  return requireText(matches[0].queue, 'queue');
}

async function writeGeneratedConfig(path, configText) {
  const rebased = rebaseGeneratedWranglerConfigPaths(configText, {
    sourceDirectory: dirname(SOURCE_CONFIG),
    outputDirectory: dirname(path),
  });
  await writeFile(path, rebased.text, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
}
function exactMainHead() {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const branch = text('git', ['branch', '--show-current'], { raw: true }).trim();
  const head = text('git', ['rev-parse', 'HEAD']);
  const originMain = text('git', ['rev-parse', 'origin/main']);
  const dirty = text('git', ['status', '--porcelain', '--untracked-files=all'], {
    raw: true,
  }).trim();
  if (branch !== 'main' || head !== originMain || dirty) {
    fail(
      'Weekly Notification Admission requires clean exact current main',
      'LARK_WEEKLY_7D_NOTIFICATION_REPOSITORY_INVALID',
      {
        branch,
        head,
        originMain,
        dirtyPathCount: dirty ? dirty.split(/\r?\n/u).length : 0,
      },
    );
  }
  return head;
}

function parseArgs(args) {
  const modes = ['--preview', '--execute', '--recover'].filter((mode) => args.includes(mode));
  const unknown = args.filter((arg) => !['--preview', '--execute', '--recover'].includes(arg));
  if (unknown.length > 0 || modes.length > 1) {
    fail(
      'Weekly Notification terminal accepts one of --preview, --execute, or --recover',
      'LARK_WEEKLY_7D_NOTIFICATION_ARGUMENT_INVALID',
      { unknown },
    );
  }
  if (modes[0] === '--preview') return 'preview';
  if (modes[0] === '--execute') return 'execute';
  if (modes[0] === '--recover') return 'recover';
  return 'plan';
}
function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    admissionConfirmation: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONFIRMATION,
    recoveryConfirmation: RECOVERY_CONFIRMATION,
    sequence: [
      'revalidate exact generated Fresh Weekly Executive Decision v4 and unchanged Decision Quality Gate',
      'rebuild the exact reviewed full-channel message and require SHA-256 parity before admission',
      'verify AI Automation active and Base Notification Automation inactive',
      'verify Controlled UAT and Runtime Smoke are sent/mirrored and Settings remain active',
      'deploy current-main Notification Runtime renderer v2 at 100 percent traffic',
      'reconcile one dedicated weekly notification identity without mutating the Fresh Decision source',
      'record immutable Queue-attempt evidence before exactly one Runtime Queue admission',
      'verify one sent/mirrored D1 delivery, one Notification Log row and sent_to_group=true',
      'observe without another admission and prove duplicate delivery zero',
    ],
    readOnlyPreviewAvailable: true,
    afterQueueAttemptFailure: 'use --recover only; never rerun --execute',
    maximumWorkerDeploymentCount: 1,
    maximumQueueAdmissionCount: 1,
    maximumMessageSendCount: 1,
    reportSettingWriteCount: 0,
    sourceDecisionMutationCount: 0,
    baseNotificationAutomationActivationCount: 0,
    automaticNotificationProducerEnabled: false,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}
function assertRecoveryConfirmation(env) {
  if (env?.[RECOVERY_CONFIRMATION.envName] !== RECOVERY_CONFIRMATION.value) {
    fail(
      `Weekly Notification recovery requires ${RECOVERY_CONFIRMATION.envName}=${RECOVERY_CONFIRMATION.value}`,
      'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_CONFIRMATION_REQUIRED',
      { envName: RECOVERY_CONFIRMATION.envName },
    );
  }
}

async function assertNoFile(path, failIfExists) {
  try {
    await stat(path);
    if (failIfExists) {
      fail(
        'Weekly Notification Admission retained evidence already exists; blind rerun is forbidden',
        'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_ALREADY_ATTEMPTED',
        { evidenceName: path.split('/').pop() },
      );
    }
    return false;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}
async function requireFile(path) {
  try { await stat(path); } catch (error) {
    if (error?.code === 'ENOENT') {
      fail(
        'Weekly Notification recovery requires retained Queue-attempt evidence',
        'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_EVIDENCE_MISSING',
      );
    }
    throw error;
  }
}
async function privateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(path, 0o600);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: { ...process.env, ...(options.env ?? {}) },
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    fail(
      `Command failed: ${command}`,
      'LARK_WEEKLY_7D_NOTIFICATION_COMMAND_FAILED',
      {
        command,
        args: args.map((arg, index) => args[index - 1] === '--command'
          ? '[READ_ONLY_SQL_REDACTED]'
          : arg),
        status: result.status,
      },
    );
  }
  return Object.freeze({
    stdout: result.stdout?.trim() ?? '',
    stderr: result.stderr?.trim() ?? '',
  });
}
function text(command, args, options = {}) { return run(command, args, options).stdout; }
function readObservationMs(env) {
  const value = Number(env.MKT_LARK_WEEKLY_7D_NOTIFICATION_OBSERVATION_MS ?? OBSERVATION_MS);
  if (!Number.isSafeInteger(value) || value < 10_000 || value > 120_000) {
    fail(
      'Weekly Notification observation must be 10-120 seconds',
      'LARK_WEEKLY_7D_NOTIFICATION_INPUT_REQUIRED',
      { fieldName: 'MKT_LARK_WEEKLY_7D_NOTIFICATION_OBSERVATION_MS' },
    );
  }
  return value;
}
function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    fail(
      `${fieldName} must be a positive integer`,
      'LARK_WEEKLY_7D_NOTIFICATION_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return number;
}
function exact(value, expected, fieldName) {
  if (value !== expected) {
    fail(
      `Weekly Notification Admission requires ${fieldName}=${expected}`,
      'LARK_WEEKLY_7D_NOTIFICATION_ENVIRONMENT_INVALID',
      { fieldName },
    );
  }
}
function requireText(value, fieldName) {
  const textValue = optionalText(value);
  if (!textValue) {
    fail(
      `${fieldName} is required`,
      'LARK_WEEKLY_7D_NOTIFICATION_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return textValue;
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const textValue = String(scalar(value) ?? '').trim();
  return textValue || null;
}
function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join(',');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) {
      if (value[key] !== undefined) return scalar(value[key]);
    }
  }
  return value;
}
function booleanValue(value) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  return null;
}
function sanitize(value) { return String(value).replace(/[\r\n\t]+/gu, ' ').slice(0, 500); }
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitize(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    /(?:token|secret|password|authorization|tableId|queueId|accountId|groupId)/iu.test(key)
      ? `${key}Redacted`
      : key,
    /(?:token|secret|password|authorization|tableId|queueId|accountId|groupId)/iu.test(key)
      ? true
      : scrub(nested),
  ]));
}
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function fail(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dNotificationAdmissionTerminalError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}
function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
