#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { listCloudflareQueuesViaApi } from './lib/cloudflare-queue-list-rest.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { assertLarkNotificationRuntimeSettingsState } from './lib/lark-notification-runtime-activation.js';
import { extractLarkNotificationWranglerD1Rows } from './lib/lark-notification-remote-rollout-operator.js';
import { parseLarkNotificationDeploymentStatus } from './lib/lark-notification-safe-worker-deploy.js';
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
import { loadFreshWeekly7dExecutiveDecisionNotificationSource } from './lib/lark-weekly-7d-fresh-decision-notification-source.js';
import {
  assertLarkWeekly7dNotificationSourceSettingsBaseline,
  normalizeLarkWeekly7dNotificationRestorableBaseline,
  resolveLarkWeekly7dNotificationSourceSettings,
  summarizeLarkWeekly7dNotificationSettingsBaseline,
} from './lib/lark-weekly-7d-notification-source-settings.js';
import { buildLarkWeekly7dNotificationRuntimeWindow } from './lib/lark-weekly-7d-notification-runtime-window.js';
import { LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS } from '../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { LARK_EXECUTIVE_DESTINATION_KEY_HASH } from '../packages/config/src/lark-notification-runtime-config.js';
import { buildLarkExecutiveNotificationMessage } from '../packages/application/src/notifications/deliver-lark-executive-notification.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { loadLarkNotificationDeliveryRequest } from '../packages/connectors/src/lark/lark-notification-delivery-source.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';
import { resolveLarkNotificationControlledUatTables } from './lib/lark-notification-controlled-uat.js';

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
const QUIESCENCE_REQUIRED_ZERO_SAMPLES = 3;
const QUIESCENT_READ_MAX_BOUNDARY_ATTEMPTS = 3;
const SOURCE_HASH_FIELDS = Object.freeze([
  'ai_run_key', 'report_id', 'template_version', 'scope_type', 'channel_key', 'window_days',
  'readiness_status', 'generation_status', 'failure_code', 'preview_mode',
  'notification_eligible', 'sent_to_group', 'dedupe_key', 'source_report_ids_json',
  'source_report_checksum', 'metric_summary_json', 'channel_status_vector_json',
  'insight_summary', 'strengths', 'weaknesses', 'recommendations', 'generated_at',
]);

let stage = 'init';
let action = 'plan';
let repository = null;
let queueAttemptRecorded = false;
let queueAdmissionConfirmed = false;
let workerDeploymentCount = 0;
let reportSettingWriteCount = 0;
let runtimeRestoreVerified = false;
let settingsRestoreVerified = false;

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
    reportSettingWriteCount,
    runtimeRestoreVerified,
    settingsRestoreVerified,
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
  const previewBoundary = await readD1StateAtQuiescence(context, 'preview');
  const quiescence = previewBoundary.quiescence;
  const beforeD1 = assertLarkWeekly7dNotificationAdmissionBaseline(previewBoundary.state);
  const beforeLark = await readLarkBaseline(context);
  await assertSettingsBaseline(context);
  await assertSourceUnchanged(context);
  stage = 'validate-reviewed-fresh-decision-message';
  assertBusinessFirstMessage(context, context.admission.reviewedMessage);
  assertReviewedMessageParity(context, context.admission.reviewedMessage);

  process.stdout.write(`${JSON.stringify(Object.freeze({
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
    sourceSettingsState: context.settingsAuthority.state,
    sourceSettingCount: context.settingsAuthority.settingKeys.length,
    activeSourceSettingCount: context.settingsAuthority.activeSettingCount,
    inactiveSourceSettingCount: context.settingsAuthority.inactiveSettingCount,
    settingsMutationRequiredForExecute: context.settingsAuthority.inactiveSettingCount > 0,
    currentExecutionTrueFlagCount: context.runtimeWindow.sourceTrueFlags.length,
    currentExecutionFlagsPreserved: true,
    remoteQuiescenceVerified: quiescence.verified,
    remoteQuiescencePollCount: quiescence.pollCount,
    remoteQuiescenceRequiredZeroSamples: quiescence.requiredZeroSamples,
    remoteQuiescentReadBoundaryAttempt: previewBoundary.boundaryAttempt,
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
  }), null, 2)}\n`);
}

async function executeAdmission() {
  const context = await prepare('execute');
  let primaryError = null;
  let runtimeRestoreError = null;
  let settingsRestoreError = null;
  let activeRuntimeAttempted = false;
  let settingsActivationAttempted = false;
  let activeVersion = null;
  let restoredVersion = null;
  let beforeD1 = null;
  let beforeLark = null;
  let delivered = null;
  let afterLark = null;
  let stability = null;
  let automationBefore = null;

  try {
    stage = 'assert-fresh-admission-attempt';
    await assertNoFile(join(context.evidenceDir, '03-queue-send.attempt.json'), true);
    await assertNoFile(join(context.evidenceDir, 'notification-admission-summary.json'), true);
    stage = 'verify-automation-state-before-window';
    automationBefore = await verifyAutomationState(context.client);
    stage = 'remote-read-only-preflight';
    const preflightBoundary = await readD1StateAtQuiescence(context, 'execute-preflight');
    const preflightQuiescence = preflightBoundary.quiescence;
    beforeD1 = assertLarkWeekly7dNotificationAdmissionBaseline(preflightBoundary.state);
    beforeLark = await readLarkBaseline(context);
    await assertSettingsBaseline(context);
    await assertSourceUnchanged(context);
    assertBusinessFirstMessage(context, context.admission.reviewedMessage);
    assertReviewedMessageParity(context, context.admission.reviewedMessage);

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
      sourceSettingCount: context.settingsAuthority.settingKeys.length,
      sourceSettingsState: context.settingsAuthority.state,
      activeSourceSettingCount: context.settingsAuthority.activeSettingCount,
      inactiveSourceSettingCount: context.settingsAuthority.inactiveSettingCount,
      sourceSettingsBaseline: context.settingsAuthority.restorableBaseline,
      sourceSettingsBaselineSha256: sha256(JSON.stringify(context.settingsAuthority.restorableBaseline)),
      currentExecutionTrueFlags: context.runtimeWindow.sourceTrueFlags,
      activeExecutionTrueFlags: context.runtimeWindow.activeTrueFlags,
      scheduleConfigPreserved: context.runtimeWindow.scheduleConfigPreserved,
      promptShape: context.admission.evidence.promptShape,
      qualityGatePassed: context.admission.qualityGate.passed,
      reviewedMessageSha256: context.admission.reviewedMessageSha256,
      reviewedMessageBytes: context.admission.reviewedMessageBytes,
      remoteQuiescenceVerified: preflightQuiescence.verified,
      remoteQuiescencePollCount: preflightQuiescence.pollCount,
      remoteQuiescenceRequiredZeroSamples: preflightQuiescence.requiredZeroSamples,
      remoteQuiescentReadBoundaryAttempt: preflightBoundary.boundaryAttempt,
      deliveryRowsBefore: beforeD1.totalDeliveryRows,
      notificationLogRowsBefore: beforeLark.totalSentNotificationLogRows,
      automationState: automationBefore,
      queueAdmissionCount: 0,
      workerDeploymentCount: 0,
      reportSettingWriteCount: 0,
      scheduleActivationCount: 0,
      production: 'BLOCKED',
    });

    stage = 'ensure-exact-source-report-settings-active';
    settingsActivationAttempted = context.settingsAuthority.inactiveSettingCount > 0;
    if (settingsActivationAttempted) {
      reportSettingWriteCount += await writeSettingsActive(context);
    }
    await assertSettingsActive(context);

    stage = 'verify-pre-deploy-strict-baseline';
    const preDeployD1 = assertLarkWeekly7dNotificationAdmissionBaseline(
      (await readD1StateAtQuiescence(context, 'execute-pre-deploy')).state,
    );
    if (JSON.stringify(beforeD1) !== JSON.stringify(preDeployD1)) {
      fail(
        'Weekly Notification Remote delivery baseline changed before bounded Runtime deploy',
        'LARK_WEEKLY_7D_NOTIFICATION_PRE_DEPLOY_DRIFT',
      );
    }

    stage = 'deploy-bounded-notification-runtime-window';
    activeRuntimeAttempted = true;
    activeVersion = await deployAndVerifyRuntimeConfig(context, context.activeConfigPath, 'active-window');
    workerDeploymentCount += 1;
    await privateJson(join(context.evidenceDir, '02-runtime-window.result.json'), {
      contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
      repositoryHead: context.repositoryHead,
      activeVersion,
      trafficPercentage: 100,
      notificationFlagsActive: true,
      currentExecutionFlagsPreserved: true,
      scheduleConfigPreserved: true,
      reportSettingWriteCount,
      queueAdmissionCount: 0,
      production: 'BLOCKED',
    });

    stage = 'verify-active-window-no-admission-drift';
    await assertSettingsActive(context);
    await verifyAutomationState(context.client);
    const postDeployD1 = assertLarkWeekly7dNotificationAdmissionBaseline(
      (await readD1StateAtQuiescence(context, 'execute-post-deploy')).state,
    );
    if (JSON.stringify(beforeD1) !== JSON.stringify(postDeployD1)) {
      fail('Bounded Notification Runtime window changed delivery evidence before admission', 'LARK_WEEKLY_7D_NOTIFICATION_RUNTIME_WINDOW_DRIFT');
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
    const operationId = `lark_weekly_7d_notification_${sha256(context.admission.aiRunKey).slice(0, 32)}`;
    const job = buildLarkWeekly7dNotificationAdmissionJob({
      aiRunKey: context.admission.aiRunKey,
      operationId,
      requestedAt: Date.now(),
    });
    const jobHash = sha256(JSON.stringify(job));

    stage = 'verify-pre-admission-strict-baseline';
    const preAdmissionD1 = assertLarkWeekly7dNotificationAdmissionBaseline(
      (await readD1StateAtQuiescence(context, 'execute-pre-admission')).state,
    );
    if (JSON.stringify(beforeD1) !== JSON.stringify(preAdmissionD1)) {
      fail(
        'Weekly Notification Remote delivery baseline changed before exact Queue admission',
        'LARK_WEEKLY_7D_NOTIFICATION_PRE_ADMISSION_DRIFT',
      );
    }
    await assertSettingsActive(context);
    await verifyAutomationState(context.client);
    await assertSourceUnchanged(context);

    stage = 'record-one-queue-attempt';
    await privateJson(join(context.evidenceDir, '03-queue-send.attempt.json'), {
      contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
      repositoryHead: context.repositoryHead,
      activeVersion,
      aiRunKey: context.admission.aiRunKey,
      aiRunKeySha256: sha256(context.admission.aiRunKey),
      operationId,
      operationIdSha256: sha256(operationId),
      jobSha256: jobHash,
      sourceStateSha256: context.sourceStateSha256,
      sourceSettingsState: context.settingsAuthority.state,
      sourceSettingsBaseline: context.settingsAuthority.restorableBaseline,
      sourceSettingsBaselineSha256: sha256(JSON.stringify(context.settingsAuthority.restorableBaseline)),
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
    delivered = await pollDelivered(context, beforeD1);
    stage = 'verify-lark-mirror-and-source-immutability';
    afterLark = await verifyLarkDelivery(context, beforeLark);
    await assertSourceUnchanged(context);
    stage = 'bounded-no-additional-admission-observation';
    await sleep(readObservationMs(context.env));
    const observed = (await readD1StateAtQuiescence(context, 'execute-stability')).state;
    stability = assertLarkWeekly7dNotificationAdmissionStable(delivered, observed);
    const observedLark = await verifyLarkDelivery(context, beforeLark);
    if (JSON.stringify(afterLark) !== JSON.stringify(observedLark)) {
      fail('Weekly 7D Lark mirror changed during the no-admission observation window', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_LARK_STABILITY_FAILED');
    }
    await assertSourceUnchanged(context);
  } catch (error) {
    primaryError = error;
  }

  if (activeRuntimeAttempted) {
    try {
      stage = 'restore-current-worker-runtime-baseline';
      restoredVersion = await deployAndVerifyRuntimeConfig(context, context.restoreConfigPath, 'restore-baseline');
      workerDeploymentCount += 1;
      runtimeRestoreVerified = true;
    } catch (error) {
      runtimeRestoreError = error;
    }
  } else {
    runtimeRestoreVerified = true;
  }

  if (settingsActivationAttempted) {
    try {
      stage = 'restore-exact-source-report-settings';
      reportSettingWriteCount += await writeSettingsBaseline(
        context,
        context.settingsAuthority.restorableBaseline,
      );
      await assertSettingsBaseline(context);
      settingsRestoreVerified = true;
    } catch (error) {
      settingsRestoreError = error;
    }
  } else {
    settingsRestoreVerified = true;
  }

  if (primaryError || runtimeRestoreError || settingsRestoreError) {
    const selected = primaryError ?? runtimeRestoreError ?? settingsRestoreError;
    const wrapped = new Error(selected?.message ?? 'Weekly Notification bounded execution failed');
    wrapped.name = selected?.name ?? 'LarkWeekly7dNotificationAdmissionTerminalError';
    wrapped.code = selected?.code ?? 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_FAILED';
    wrapped.details = Object.freeze({
      ...(selected?.details ?? {}),
      primaryFailureCode: primaryError?.code ?? null,
      runtimeRestoreFailureCode: runtimeRestoreError?.code ?? null,
      settingsRestoreFailureCode: settingsRestoreError?.code ?? null,
      runtimeRestoreVerified,
      settingsRestoreVerified,
    });
    throw wrapped;
  }

  stage = 'verify-restored-safe-boundary';
  await assertSettingsBaseline(context);
  const automationAfter = await verifyAutomationState(context.client);
  assertSameAutomationState(automationBefore, automationAfter);
  await assertSourceUnchanged(context);
  verifyDeployedVersion(context, restoredVersion, context.restoreConfigPath);

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    action: 'execute',
    stage: 'complete',
    status: 'weekly_7d_notification_admission_sent_verified_and_restored',
    repository,
    activeVersion,
    restoredVersion,
    trafficPercentage: 100,
    notificationTemplateVersion: 'executive_report_notification_v2',
    sourcePromptShape: context.admission.evidence.promptShape,
    qualityGatePassed: context.admission.qualityGate.passed,
    reviewedMessageSha256: context.admission.reviewedMessageSha256,
    sourceDecisionMutationCount: 0,
    sourceAiRunKeySha256: sha256(context.admission.sourceAiRunKey),
    admissionAiRunKeySha256: sha256(context.admission.aiRunKey),
    sourceSettingsState: context.settingsAuthority.state,
    activeSourceSettingCount: context.settingsAuthority.activeSettingCount,
    inactiveSourceSettingCount: context.settingsAuthority.inactiveSettingCount,
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
    additionalMessageSendCountDuringObservation: stability.additionalMessageSendCountDuringObservation,
    workerDeploymentCount,
    reportSettingWriteCount,
    runtimeRemainsActive: false,
    runtimeRestoredBlockedOff: true,
    reportSettingsRemainActive: context.settingsAuthority.state === 'active',
    reportSettingsRemainMixed: context.settingsAuthority.state === 'mixed',
    reportSettingsRestoredInactive: context.settingsAuthority.state === 'inactive',
    reportSettingsRestoredBaseline: true,
    currentExecutionFlagsPreserved: true,
    aiAutomationStatus: automationAfter.aiMaterialization.status,
    notificationAutomationStatus: automationAfter.notification.status,
    notificationProducerEnabled: false,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
    nextGate: 'automatic_weekly_notification_requires_separate_approval',
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
    fail('Recovery evidence does not match the retained Fresh Weekly Executive Decision source', 'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_EVIDENCE_INVALID');
  }
  const retainedBaseline = normalizeLarkWeekly7dNotificationRestorableBaseline(
    attempt.sourceSettingsBaseline,
  );
  const retainedSettingsSummary = summarizeLarkWeekly7dNotificationSettingsBaseline(
    retainedBaseline,
  );
  if (attempt.sourceSettingsState !== retainedSettingsSummary.state
      || attempt.sourceSettingsBaselineSha256 !== sha256(JSON.stringify(retainedBaseline))) {
    fail(
      'Recovery Settings baseline evidence does not match its retained state/hash',
      'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_EVIDENCE_INVALID',
    );
  }
  assertRecoverySettingsRestoreBoundary(context, retainedBaseline);
  queueAttemptRecorded = true;
  queueAdmissionConfirmed = true;
  stage = 'verify-recovery-safe-boundary';
  const beforeLark = await readLarkBaseline(context, { allowAdmissionRow: true });
  stage = 'restore-retained-source-settings-baseline';
  reportSettingWriteCount += await writeSettingsBaseline(context, retainedBaseline);
  await assertSettingsBaseline(context, retainedBaseline);
  settingsRestoreVerified = true;
  const automationBefore = await verifyAutomationState(context.client);
  stage = 'poll-existing-admission-without-resend';
  const delivered = await pollExistingDelivered(context);
  stage = 'verify-recovered-lark-mirror';
  const afterLark = await verifyRecoveredLarkDelivery(context, beforeLark);
  await assertSourceUnchanged(context);
  stage = 'recovery-no-admission-observation';
  await sleep(readObservationMs(context.env));
  const recoveryObserved = (await readD1StateAtQuiescence(context, 'recovery-stability')).state;
  const stability = assertLarkWeekly7dNotificationAdmissionStable(delivered, recoveryObserved);
  const observedLark = await verifyRecoveredLarkDelivery(context, beforeLark);
  if (JSON.stringify(afterLark) !== JSON.stringify(observedLark)) {
    fail('Recovered weekly Notification state changed without a new admission', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_LARK_STABILITY_FAILED');
  }
  const automationAfter = await verifyAutomationState(context.client);
  assertSameAutomationState(automationBefore, automationAfter);
  await assertSettingsBaseline(context, retainedBaseline);
  await assertSourceUnchanged(context);

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
    sourceSettingsState: retainedSettingsSummary.state,
    activeSourceSettingCount: retainedSettingsSummary.activeSettingCount,
    inactiveSourceSettingCount: retainedSettingsSummary.inactiveSettingCount,
    queueAdmissionCountByRecovery: 0,
    messageSendCountByRecovery: 0,
    deliveryStatus: delivered.admissionDeliveryStatus,
    mirrorStatus: delivered.admissionMirrorStatus,
    sentToGroup: afterLark.admissionAiRunMarkedSent,
    exactDeliveryRows: stability.exactDeliveryRows,
    duplicateDeliveryRows: stability.duplicateDeliveryRows,
    workerDeploymentCount: 0,
    reportSettingWriteCount,
    runtimeRestoredBlockedOff: true,
    reportSettingsRemainActive: retainedSettingsSummary.state === 'active',
    reportSettingsRemainMixed: retainedSettingsSummary.state === 'mixed',
    reportSettingsRestoredInactive: retainedSettingsSummary.state === 'inactive',
    reportSettingsRestoredBaseline: true,
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
      'tests/application/lark-weekly-7d-notification-source-settings.test.js',
      'tests/scripts/lark-weekly-7d-notification-runtime-window.test.js',
      'tests/application/deliver-lark-executive-notification.test.js',
      'tests/application/lark-notification-active-job-router.test.js',
      'tests/connectors/lark-notification-delivery-source.test.js',
      'tests/connectors/lark-notification-delivery-source-weekly-snapshotless.test.js',
      'tests/connectors/d1-lark-notification-delivery-store.test.js',
    ], { stdio: 'inherit' });
    run('npm', ['run', 'check'], { stdio: 'inherit' });
  }

  stage = 'assert-no-automatic-notification-producer';
  const scheduledJobsSource = await readFile(resolve('apps/sync-worker/src/scheduled-jobs.js'), 'utf8');
  if (/LARK_NOTIFICATION_SEND/u.test(scheduledJobsSource)) {
    fail('Weekly Notification Admission requires automatic schedule admission to remain absent', 'LARK_WEEKLY_7D_NOTIFICATION_SCHEDULE_PRESENT');
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
  const sourceSettingKeys = [...admission.sourceReportSettingKeys];
  const settingRows = await larkRepository.listByFieldValues(
    tableIds.reportSettings,
    'report_setting_key',
    sourceSettingKeys,
  );
  const settingsAuthority = resolveLarkWeekly7dNotificationSourceSettings({
    sourceReportIds: admission.sourceReportIds,
    sourceAuthorities: admission.sourceAuthorities,
    settings: settingRows,
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });

  stage = 'resolve-local-runtime-topology';
  const sourceText = await readFile(SOURCE_CONFIG, 'utf8');
  const sourceConfig = parseJsoncObject(sourceText);
  const runtimeWindow = buildLarkWeekly7dNotificationRuntimeWindow(sourceText, tableIds);
  const generatedDir = resolve(evidenceDir, 'generated-config');
  await mkdir(generatedDir, { recursive: true, mode: 0o700 });
  const activeConfigPath = resolve(generatedDir, 'runtime-active-bounded.json');
  const restoreConfigPath = resolve(generatedDir, 'runtime-restore-current.json');
  await writeGeneratedConfig(activeConfigPath, runtimeWindow.activeText);
  await writeGeneratedConfig(restoreConfigPath, runtimeWindow.restoreText);

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
    stage = 'dry-run-bounded-runtime-window';
    run('npx', ['wrangler', 'deploy', '--dry-run', '--config', activeConfigPath], { env: cloudflare.wranglerEnv, stdio: 'inherit' });
    run('npx', ['wrangler', 'deploy', '--dry-run', '--config', restoreConfigPath], { env: cloudflare.wranglerEnv, stdio: 'inherit' });
  }

  repository = Object.freeze({ branch: 'main', head: repositoryHead, originMain: repositoryHead, clean: true });
  return Object.freeze({
    env, mode, repositoryHead, evidenceDir, sourceText, sourceConfig,
    activeConfigPath, restoreConfigPath, runtimeWindow,
    cloudflare, databaseName, queueName, queueId,
    client, tableIds, larkRepository, syncEngine,
    sourceRecord, sourceStateSha256, admission, settingsAuthority,
  });
}

async function writeSettingsActive(context) {
  const rows = context.settingsAuthority.settingKeys.map((reportSettingKey) => Object.freeze({
    report_setting_key: reportSettingKey,
    ai_enabled: true,
    notification_enabled: true,
  }));
  return writeSettingsRows(context, rows);
}

async function writeSettingsBaseline(context, baselineInput) {
  const baseline = normalizeLarkWeekly7dNotificationRestorableBaseline(baselineInput);
  const rows = baseline.map((setting) => Object.freeze({
    report_setting_key: setting.reportSettingKey,
    ai_enabled: setting.aiEnabled,
    notification_enabled: setting.notificationEnabled,
  }));
  return writeSettingsRows(context, rows);
}

async function writeSettingsRows(context, rows) {
  const plan = await context.syncEngine.planByKey({
    repository: context.larkRepository,
    tableId: context.tableIds.reportSettings,
    keyField: 'report_setting_key',
    rows,
  });
  if (plan.createRows.length !== 0 || plan.updateRows.length + plan.skipped !== rows.length) {
    fail('Weekly Notification bounded Settings transition is not exact', 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_WRITE_FAILED', { createRows: plan.createRows.length, updateRows: plan.updateRows.length, skipped: plan.skipped });
  }
  const result = await context.syncEngine.executePlan(plan);
  if (result.created !== 0 || result.updated + result.skipped !== rows.length) {
    fail('Weekly Notification bounded Settings transition did not reconcile every row', 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_SETTINGS_WRITE_FAILED');
  }
  return result.updated;
}

async function reconcileAdmissionRow(context) {
  const plan = await context.syncEngine.planByKey({
    repository: context.larkRepository,
    tableId: context.tableIds.aiRuns,
    keyField: 'ai_run_key',
    rows: [context.admission.fields],
  });
  if (plan.updateRows.length !== 0) fail('Existing weekly Notification Admission row differs from accepted source identity', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_ROW_DRIFT', { updateRows: plan.updateRows.length });
  const result = await context.syncEngine.executePlan(plan);
  if (result.created + result.skipped !== 1 || result.updated !== 0) fail('Weekly Notification Admission row did not reconcile exactly once', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_ROW_WRITE_FAILED');
}

function assertDeliveryChain(context, request) {
  if (!request.settings.enabled || !request.settings.aiEnabled || !request.settings.notificationEnabled
      || request.snapshot.customerProfile !== 'integration_workspace'
      || Number(request.aiRun.windowDays) !== 7
      || request.aiRun.aiRunKey !== context.admission.aiRunKey
      || request.aiRun.notificationEligible !== true
      || request.aiRun.previewMode !== false
      || request.aiRun.sentToGroup !== false
      || JSON.stringify([...request.snapshot.sourceReportIds].sort()) !== JSON.stringify([...context.admission.sourceReportIds].sort())) {
    fail('Weekly Notification Admission delivery chain is not exact or active', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_DELIVERY_CHAIN_INVALID');
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
  for (const output of [context.admission.fields.insight_summary, context.admission.fields.strengths, context.admission.fields.weaknesses, context.admission.fields.recommendations]) {
    if (!message.text.includes(String(scalar(output) ?? '').trim())) { invalid.push('acceptedOutputMissing'); break; }
  }
  if (invalid.length > 0) fail('Business-first weekly Notification message preview failed', 'LARK_WEEKLY_7D_NOTIFICATION_MESSAGE_INVALID', { invalid });
}
function assertReviewedMessageParity(context, message) {
  const observedSha256 = sha256(message.text);
  if (message.text !== context.admission.reviewedMessage.text || observedSha256 !== context.admission.reviewedMessageSha256) {
    fail('Weekly Notification runtime message differs from the reviewed Fresh Executive Decision Preview', 'LARK_WEEKLY_7D_NOTIFICATION_MESSAGE_PARITY_FAILED', { expectedMessageSha256: context.admission.reviewedMessageSha256, observedMessageSha256 });
  }
  return true;
}
function hasInternalReadiness(textValue) {
  return /report_partial|report_available|readiness_status|data_status|สถานะข้อมูล|ระดับ:\s*(?:info|warning|critical)/iu.test(String(textValue ?? ''));
}

async function assertSourceUnchanged(context) {
  const rows = await context.larkRepository.listByFieldValues(context.tableIds.aiRuns, 'ai_run_key', [context.admission.sourceAiRunKey]);
  const exact = rows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.sourceAiRunKey);
  if (exact.length !== 1 || hashSourceState(exact[0].fields) !== context.sourceStateSha256) {
    fail('Fresh Weekly Executive Decision source row changed during Notification Admission', 'LARK_WEEKLY_7D_NOTIFICATION_SOURCE_MUTATED', { matchCount: exact.length });
  }
  return true;
}
function hashSourceState(fields) {
  const normalized = Object.fromEntries(SOURCE_HASH_FIELDS.map((name) => [name, name === 'preview_mode' || name === 'notification_eligible' || name === 'sent_to_group' ? booleanValue(fields?.[name]) : optionalText(fields?.[name])]));
  return sha256(JSON.stringify(normalized));
}

async function readLarkBaseline(context, options = {}) {
  const [sentLogRows, executiveRows, admissionAiRows, admissionLogRows] = await Promise.all([
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'attempt_status', ['sent']),
    context.larkRepository.listByFieldValues(context.tableIds.aiRuns, 'scope_type', ['executive']),
    context.larkRepository.listByFieldValues(context.tableIds.aiRuns, 'ai_run_key', [context.admission.aiRunKey]),
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'ai_run_key', [context.admission.aiRunKey]),
  ]);
  const controlledAi = executiveRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:'));
  const smokeAi = executiveRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-runtime-smoke:'));
  const controlledLogs = sentLogRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:'));
  const smokeLogs = sentLogRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-runtime-smoke:'));
  if (controlledAi.length !== 1 || controlledLogs.length !== 1 || smokeAi.length !== 1 || smokeLogs.length !== 1
      || booleanValue(controlledAi[0].fields.sent_to_group) !== true || booleanValue(smokeAi[0].fields.sent_to_group) !== true) {
    fail('Weekly Notification Admission requires retained Controlled UAT and Runtime Smoke Lark closeout', 'LARK_WEEKLY_7D_NOTIFICATION_LARK_BASELINE_INVALID', { controlledAiRows: controlledAi.length, controlledLogRows: controlledLogs.length, runtimeSmokeAiRows: smokeAi.length, runtimeSmokeLogRows: smokeLogs.length });
  }
  const exactAdmissionAi = admissionAiRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey);
  const exactAdmissionLog = admissionLogRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey);
  if (options.allowAdmissionRow === true) {
    if (exactAdmissionAi.length !== 1 || exactAdmissionLog.length > 1) fail('Recovery requires one exact retained admission AI row and at most one mirror row', 'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_LARK_STATE_INVALID', { aiRows: exactAdmissionAi.length, logRows: exactAdmissionLog.length });
  } else if (exactAdmissionLog.length !== 0 || exactAdmissionAi.length > 1 || (exactAdmissionAi.length === 1 && booleanValue(exactAdmissionAi[0].fields.sent_to_group) !== false)) {
    fail('Weekly Notification Admission identity already has sent/mirror evidence', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_ALREADY_ATTEMPTED', { aiRows: exactAdmissionAi.length, logRows: exactAdmissionLog.length });
  }
  return Object.freeze({ totalSentNotificationLogRows: sentLogRows.length, controlledUatAiRows: 1, controlledUatNotificationLogRows: 1, runtimeSmokeAiRows: 1, runtimeSmokeNotificationLogRows: 1, controlledUatStable: true, runtimeSmokeStable: true, admissionAiRowsBefore: exactAdmissionAi.length, admissionLogRowsBefore: exactAdmissionLog.length });
}
async function verifyLarkDelivery(context, baseline) {
  const [sentLogRows, admissionAiRows, admissionLogRows] = await Promise.all([
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'attempt_status', ['sent']),
    context.larkRepository.listByFieldValues(context.tableIds.aiRuns, 'ai_run_key', [context.admission.aiRunKey]),
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'ai_run_key', [context.admission.aiRunKey]),
  ]);
  const exactAi = admissionAiRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey);
  const exactLog = admissionLogRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey);
  const controlledLogs = sentLogRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:'));
  const smokeLogs = sentLogRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-runtime-smoke:'));
  if (exactAi.length !== 1 || exactLog.length !== 1 || sentLogRows.length !== baseline.totalSentNotificationLogRows + 1 || controlledLogs.length !== 1 || smokeLogs.length !== 1 || booleanValue(exactAi[0].fields.sent_to_group) !== true || String(scalar(exactLog[0].fields.attempt_status) ?? '') !== 'sent') {
    fail('Weekly Notification Admission Lark mirror parity failed', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_LARK_PARITY_FAILED', { admissionAiRows: exactAi.length, admissionNotificationLogRows: exactLog.length, totalSentNotificationLogRows: sentLogRows.length });
  }
  return Object.freeze({ totalSentNotificationLogRows: sentLogRows.length, admissionNotificationLogRows: 1, admissionAiRunMarkedSent: true });
}
async function verifyRecoveredLarkDelivery(context, baseline) {
  const [sentLogRows, admissionAiRows, admissionLogRows] = await Promise.all([
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'attempt_status', ['sent']),
    context.larkRepository.listByFieldValues(context.tableIds.aiRuns, 'ai_run_key', [context.admission.aiRunKey]),
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'ai_run_key', [context.admission.aiRunKey]),
  ]);
  const exactAi = admissionAiRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey);
  const exactLog = admissionLogRows.filter((record) => String(scalar(record?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey);
  if (exactAi.length !== 1 || exactLog.length !== 1 || booleanValue(exactAi[0].fields.sent_to_group) !== true || String(scalar(exactLog[0].fields.attempt_status) ?? '') !== 'sent') {
    fail('Recovery has not reached exact Lark sent/mirror parity', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_LARK_PARITY_FAILED', { aiRows: exactAi.length, logRows: exactLog.length });
  }
  if (sentLogRows.length < baseline.totalSentNotificationLogRows) fail('Recovery observed Notification Log loss', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_LARK_PARITY_FAILED');
  return Object.freeze({ totalSentNotificationLogRows: sentLogRows.length, admissionNotificationLogRows: 1, admissionAiRunMarkedSent: true });
}

function readActiveLockCount(context) {
  const output = text('npx', [
    'wrangler', 'd1', 'execute', context.databaseName,
    '--remote', '--config', context.restoreConfigPath,
    '--command', "SELECT COUNT(*) AS active_locks FROM sync_locks WHERE expires_at > unixepoch('now') * 1000;",
    '--json',
  ], { env: context.cloudflare.wranglerEnv });
  const row = extractLarkNotificationWranglerD1Rows(output)[0];
  const activeLocks = Number(row?.active_locks);
  if (!Number.isSafeInteger(activeLocks) || activeLocks < 0) {
    fail(
      'Weekly Notification Admission could not read the active Remote lock count safely',
      'LARK_WEEKLY_7D_NOTIFICATION_ACTIVE_LOCK_READ_INVALID',
    );
  }
  return activeLocks;
}
async function awaitRemoteQuiescence(context, label) {
  const maxPolls = positiveInteger(
    context.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_QUIESCENCE_MAX_POLLS ?? MAX_POLLS,
    'quiescenceMaxPolls',
  );
  const interval = positiveInteger(
    context.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_QUIESCENCE_INTERVAL_MS ?? POLL_INTERVAL_MS,
    'quiescenceIntervalMs',
  );
  let consecutiveZeroSamples = 0;
  let maximumObservedActiveLocks = 0;
  for (let poll = 1; poll <= maxPolls; poll += 1) {
    const activeLocks = readActiveLockCount(context);
    maximumObservedActiveLocks = Math.max(maximumObservedActiveLocks, activeLocks);
    consecutiveZeroSamples = activeLocks === 0 ? consecutiveZeroSamples + 1 : 0;
    process.stdout.write(`${JSON.stringify({
      event: 'lark_weekly_7d_remote_quiescence',
      label,
      poll,
      activeLocks,
      consecutiveZeroSamples,
      requiredZeroSamples: QUIESCENCE_REQUIRED_ZERO_SAMPLES,
    })}\n`);
    if (consecutiveZeroSamples >= QUIESCENCE_REQUIRED_ZERO_SAMPLES) {
      return Object.freeze({
        verified: true,
        pollCount: poll,
        requiredZeroSamples: QUIESCENCE_REQUIRED_ZERO_SAMPLES,
        maximumObservedActiveLocks,
      });
    }
    if (poll < maxPolls) await sleep(interval);
  }
  fail(
    'Weekly Notification Admission could not prove a quiescent Remote lock boundary',
    'LARK_WEEKLY_7D_NOTIFICATION_REMOTE_QUIESCENCE_TIMEOUT',
    {
      maximumPolls: maxPolls,
      requiredZeroSamples: QUIESCENCE_REQUIRED_ZERO_SAMPLES,
      maximumObservedActiveLocks,
    },
  );
}
function isActiveLockOnlyRemoteStateError(error) {
  return error?.code === 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_REMOTE_STATE_INVALID'
    && Array.isArray(error?.details?.invalid)
    && error.details.invalid.length === 1
    && error.details.invalid[0] === 'activeLocks';
}
async function readD1StateAtQuiescence(context, label) {
  for (let boundaryAttempt = 1; boundaryAttempt <= QUIESCENT_READ_MAX_BOUNDARY_ATTEMPTS; boundaryAttempt += 1) {
    const quiescence = await awaitRemoteQuiescence(context, `${label}-boundary-${boundaryAttempt}`);
    try {
      return Object.freeze({
        state: readD1State(context),
        quiescence,
        boundaryAttempt,
      });
    } catch (error) {
      if (!isActiveLockOnlyRemoteStateError(error)) throw error;
      process.stdout.write(`${JSON.stringify({
        event: 'lark_weekly_7d_quiescent_read_race',
        label,
        boundaryAttempt,
        retrying: boundaryAttempt < QUIESCENT_READ_MAX_BOUNDARY_ATTEMPTS,
      })}\n`);
    }
  }
  fail(
    'Weekly Notification Admission could not hold a strict zero-lock boundary through Remote readback',
    'LARK_WEEKLY_7D_NOTIFICATION_QUIESCENT_READ_RACE_EXHAUSTED',
    { maximumBoundaryAttempts: QUIESCENT_READ_MAX_BOUNDARY_ATTEMPTS },
  );
}
function readD1State(context) {
  const output = text('npx', ['wrangler', 'd1', 'execute', context.databaseName, '--remote', '--config', context.restoreConfigPath, '--command', buildLarkWeekly7dNotificationAdmissionReadbackSql(context.admission.aiRunKey), '--json'], { env: context.cloudflare.wranglerEnv });
  return normalizeLarkWeekly7dNotificationAdmissionReadback(extractLarkNotificationWranglerD1Rows(output)[0]);
}
async function pollDelivered(context, before) {
  const maxPolls = positiveInteger(context.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_MAX_POLLS ?? MAX_POLLS, 'maxPolls');
  const interval = positiveInteger(context.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_POLL_INTERVAL_MS ?? POLL_INTERVAL_MS, 'pollIntervalMs');
  let last = null;
  for (let index = 1; index <= maxPolls; index += 1) {
    last = (await readD1StateAtQuiescence(context, `delivery-poll-${index}`)).state;
    process.stdout.write(`${JSON.stringify({ event: 'lark_weekly_7d_notification_progress', poll: index, totalDeliveryRows: last.totalDeliveryRows, admissionDeliveryRows: last.admissionDeliveryRows, admissionDeliveryStatus: last.admissionDeliveryStatus, admissionMirrorStatus: last.admissionMirrorStatus, unrelatedUnsafeDeliveryRows: last.unrelatedUnsafeDeliveryRows })}\n`);
    try { return assertLarkWeekly7dNotificationAdmissionDelivered(before, last); } catch (error) { if (error?.code !== 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_NOT_CONFIRMED') throw error; }
    if (index < maxPolls) await sleep(interval);
  }
  fail('Weekly Notification Admission delivery verification timed out', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_VERIFY_TIMEOUT', { admissionDeliveryRows: last?.admissionDeliveryRows ?? null, admissionDeliveryStatus: last?.admissionDeliveryStatus ?? null, admissionMirrorStatus: last?.admissionMirrorStatus ?? null });
}
async function pollExistingDelivered(context) {
  const first = (await readD1StateAtQuiescence(context, 'recovery-initial-delivery')).state;
  if (first.admissionDeliveryRows === 0) fail('Recovery found no retained admitted D1 delivery; automatic resend is forbidden', 'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_DELIVERY_MISSING');
  const syntheticBefore = Object.freeze({ ...first, totalDeliveryRows: first.totalDeliveryRows - 1, sentMirroredRows: Math.max(0, first.sentMirroredRows - (first.admissionDeliveryStatus === 'sent' && first.admissionMirrorStatus === 'mirrored' ? 1 : 0)), unsafeDeliveryRows: 0, admissionDeliveryRows: 0, admissionDeliveryStatus: null, admissionMirrorStatus: null, admissionClaimCount: 0, admissionSentAt: null, admissionMessageIdHash: null });
  return pollDelivered(context, syntheticBefore);
}
async function sendQueueOnce(context, job) {
  const response = await fetch(`https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(context.cloudflare.accountId)}/queues/${encodeURIComponent(context.queueId)}/messages`, { method: 'POST', headers: { authorization: `Bearer ${freshQueueBearer(context.cloudflare)}`, 'content-type': 'application/json' }, body: JSON.stringify({ body: job, content_type: 'json' }), signal: AbortSignal.timeout(30_000) });
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) fail('Cloudflare Queue did not confirm weekly Notification admission', 'LARK_WEEKLY_7D_NOTIFICATION_QUEUE_SEND_FAILED', { status: response.status });
}
async function deployAndVerifyRuntimeConfig(context, configPath, label) {
  const outputPath = resolve(context.evidenceDir, `.wrangler-weekly-${label}-${randomUUID()}.ndjson`);
  try {
    run('npx', ['wrangler', 'deploy', '--config', configPath], { env: { ...context.cloudflare.wranglerEnv, WRANGLER_OUTPUT_FILE_PATH: outputPath }, stdio: 'inherit' });
    const versionId = parseWranglerDeploymentOutput(await readFile(outputPath, 'utf8'), { workerName: WORKER_NAME }).deploymentVersionId;
    verifyDeployedVersion(context, versionId, configPath);
    return versionId;
  } finally { await rm(outputPath, { force: true }); }
}
function verifyDeployedVersion(context, versionId, configPath) {
  const verified = parseLarkNotificationDeploymentStatus(text('npx', ['wrangler', 'deployments', 'status', '--config', configPath, '--json'], { env: context.cloudflare.wranglerEnv }), versionId);
  if (verified.trafficPercentage !== 100) fail('Weekly Notification Runtime version is not serving 100 percent of traffic', 'LARK_WEEKLY_7D_NOTIFICATION_RUNTIME_DEPLOYMENT_INVALID');
  return verified;
}

async function settingsRows(context) { return context.larkRepository.listByFieldValues(context.tableIds.reportSettings, 'report_setting_key', context.settingsAuthority.settingKeys); }
async function assertSettingsState(context, active) { return assertLarkNotificationRuntimeSettingsState(await settingsRows(context), context.settingsAuthority, active); }
async function assertSettingsActive(context) { return assertSettingsState(context, true); }
async function assertSettingsBaseline(context, baseline = context.settingsAuthority.restorableBaseline) { return assertLarkWeekly7dNotificationSourceSettingsBaseline(await settingsRows(context), context.settingsAuthority, baseline); }

function assertRecoverySettingsRestoreBoundary(context, retainedBaselineInput) {
  const retainedBaseline = normalizeLarkWeekly7dNotificationRestorableBaseline(retainedBaselineInput);
  const currentBaseline = normalizeLarkWeekly7dNotificationRestorableBaseline(
    context.settingsAuthority.restorableBaseline,
  );
  if (JSON.stringify(retainedBaseline.map(({ reportSettingKey }) => reportSettingKey))
      !== JSON.stringify(currentBaseline.map(({ reportSettingKey }) => reportSettingKey))) {
    fail(
      'Recovery Settings baseline identities differ from the current canonical source Settings',
      'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_SETTINGS_DRIFT',
    );
  }
  const currentByKey = new Map(currentBaseline.map((row) => [row.reportSettingKey, row]));
  const unsafeReactivationRows = retainedBaseline.filter((row) => (
    row.aiEnabled === true
    && currentByKey.get(row.reportSettingKey)?.aiEnabled !== true
  ));
  if (unsafeReactivationRows.length > 0) {
    fail(
      'Recovery will not reactivate Report Settings that became inactive after admission',
      'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_SETTINGS_DRIFT',
      { unsafeReactivationCount: unsafeReactivationRows.length },
    );
  }
  return true;
}

async function verifyAutomationState(client) {
  const workflowResponse = await client.requestBitableJson(`/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}/workflows`, { method: 'GET' });
  const workflows = workflowResponse?.data?.workflows ?? workflowResponse?.data?.items ?? workflowResponse?.workflows ?? [];
  const ai = exactWorkflow(workflows, AI_TITLE);
  const notification = exactWorkflow(workflows, NOTIFICATION_TITLE);
  const expectedAi = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS.find((item) => item.title === AI_TITLE);
  const expectedNotification = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS.find((item) => item.title === NOTIFICATION_TITLE);
  const aiHash = sha256(workflowId(ai));
  const notificationHash = sha256(workflowId(notification));
  const aiStatus = requireText(ai.status ?? ai.state, 'AI automation status').toLowerCase();
  const notificationStatus = requireText(notification.status ?? notification.state, 'Notification automation status').toLowerCase();
  if (aiHash !== expectedAi?.workflowIdSha256 || !ACTIVE.has(aiStatus)) fail('Exact AI Materialization Automation must remain active', 'LARK_WEEKLY_7D_NOTIFICATION_AI_AUTOMATION_INVALID', { identityMatches: aiHash === expectedAi?.workflowIdSha256, status: aiStatus });
  if (notificationHash !== expectedNotification?.workflowIdSha256 || !INACTIVE.has(notificationStatus)) fail('Exact Base Notification Automation must remain inactive', 'LARK_WEEKLY_7D_NOTIFICATION_BASE_AUTOMATION_UNSAFE', { identityMatches: notificationHash === expectedNotification?.workflowIdSha256, status: notificationStatus });
  return Object.freeze({ aiMaterialization: Object.freeze({ status: aiStatus, identitySha256: aiHash }), notification: Object.freeze({ status: notificationStatus, identitySha256: notificationHash }) });
}
function assertSameAutomationState(before, after) { if (JSON.stringify(before) !== JSON.stringify(after)) fail('Automation identity/status changed during weekly Notification Admission', 'LARK_WEEKLY_7D_NOTIFICATION_AUTOMATION_DRIFT'); }
function exactWorkflow(workflows, title) { const matches = workflows.filter((item) => optionalText(item?.title ?? item?.name) === title); if (matches.length !== 1) fail(`Expected one exact Automation: ${title}`, 'LARK_WEEKLY_7D_NOTIFICATION_AUTOMATION_IDENTITY_INVALID', { title, count: matches.length }); return matches[0]; }
function workflowId(workflow) { return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id'); }

function resolveCloudflareTarget(env, configText) {
  const wranglerEnv = buildWranglerOAuthEnvironment(env);
  const whoami = text('npx', ['wrangler', 'whoami', '--json'], { env: wranglerEnv });
  const accountId = resolveCloudflareAccountId({ explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID, preferredAccount: env.MKT_LARK_WEEKLY_7D_NOTIFICATION_ACCOUNT ?? env.MKT_LARK_NOTIFICATION_RUNTIME_ACCOUNT, configText, whoamiOutput: whoami });
  const selected = Object.freeze({ ...wranglerEnv, CLOUDFLARE_ACCOUNT_ID: accountId });
  const auth = resolveCloudflareBearerAuth({ authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], { env: selected }) });
  return Object.freeze({ accountId, wranglerEnv: selected, authType: auth.type });
}
function freshQueueBearer(cloudflare) { const auth = resolveCloudflareBearerAuth({ authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], { env: cloudflare.wranglerEnv }) }); if (auth.type !== cloudflare.authType) fail('Cloudflare authentication type changed during weekly Notification Admission', 'LARK_WEEKLY_7D_NOTIFICATION_AUTH_DRIFT'); return auth.token; }
function resolveDatabaseName(config) { const matches = Array.isArray(config?.d1_databases) ? config.d1_databases.filter((item) => item?.binding === 'MKT_STATE_DB') : []; if (matches.length !== 1) fail('Weekly Notification Admission requires one MKT_STATE_DB binding', 'LARK_WEEKLY_7D_NOTIFICATION_CONFIG_INVALID', { bindingCount: matches.length }); return requireText(matches[0].database_name, 'database_name'); }
function resolveQueueName(config) { const matches = Array.isArray(config?.queues?.producers) ? config.queues.producers.filter((item) => item?.binding === 'MKT_SYNC_QUEUE') : []; if (matches.length !== 1) fail('Weekly Notification Admission requires one MKT_SYNC_QUEUE producer', 'LARK_WEEKLY_7D_NOTIFICATION_CONFIG_INVALID', { producerCount: matches.length }); return requireText(matches[0].queue, 'queue'); }

async function writeGeneratedConfig(path, configText) { const rebased = rebaseGeneratedWranglerConfigPaths(configText, { sourceDirectory: dirname(SOURCE_CONFIG), outputDirectory: dirname(path) }); await writeFile(path, rebased.text, { encoding: 'utf8', mode: 0o600 }); await chmod(path, 0o600); }
function exactMainHead() { run('git', ['fetch', '--quiet', 'origin', 'main']); const branch = text('git', ['branch', '--show-current'], { raw: true }).trim(); const head = text('git', ['rev-parse', 'HEAD']); const originMain = text('git', ['rev-parse', 'origin/main']); const dirty = text('git', ['status', '--porcelain', '--untracked-files=all'], { raw: true }).trim(); if (branch !== 'main' || head !== originMain || dirty) fail('Weekly Notification Admission requires clean exact current main', 'LARK_WEEKLY_7D_NOTIFICATION_REPOSITORY_INVALID', { branch, head, originMain, dirtyPathCount: dirty ? dirty.split(/\r?\n/u).length : 0 }); return head; }
function parseArgs(args) { const modes = ['--preview', '--execute', '--recover'].filter((mode) => args.includes(mode)); const unknown = args.filter((arg) => !['--preview', '--execute', '--recover'].includes(arg)); if (unknown.length > 0 || modes.length > 1) fail('Weekly Notification terminal accepts one of --preview, --execute, or --recover', 'LARK_WEEKLY_7D_NOTIFICATION_ARGUMENT_INVALID', { unknown }); if (modes[0] === '--preview') return 'preview'; if (modes[0] === '--execute') return 'execute'; if (modes[0] === '--recover') return 'recover'; return 'plan'; }
function printPlan() { process.stdout.write(`${JSON.stringify({ ok: true, executed: false, contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION, admissionConfirmation: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONFIRMATION, recoveryConfirmation: RECOVERY_CONFIRMATION, sequence: ['revalidate exact generated Fresh Weekly Executive Decision v4 and unchanged Decision Quality Gate', 'require every exact Fresh source Report Setting to be enabled and internally consistent while preserving its observed per-row active/inactive baseline', 'prove a multi-sample Remote lock quiescence boundary and hold that boundary through every strict Remote D1 readback', 'build a bounded active Worker window that preserves all current source/report execution flags and triggers', 'activate only source Report Settings that are inactive in the observed baseline', 'rebuild the exact reviewed full-channel message and require SHA-256 parity before admission', 'record immutable Queue-attempt evidence including the exact non-secret per-row Settings baseline before exactly one Runtime Queue admission', 'verify one sent/mirrored D1 delivery, one Notification Log row and sent_to_group=true', 'restore the exact current Worker baseline and each Report Setting to its exact observed pre-admission state', 'observe without another admission and prove duplicate delivery zero'], readOnlyPreviewAvailable: true, afterQueueAttemptFailure: 'use --recover only; never rerun --execute', maximumWorkerDeploymentCount: 2, maximumQueueAdmissionCount: 1, maximumMessageSendCount: 1, reportSettingWriteMode: 'activate_only_inactive_rows_then_restore_exact_per_row_baseline', remoteLockQuiescenceRequiredZeroSamples: QUIESCENCE_REQUIRED_ZERO_SAMPLES, remoteLockQuiescentReadBoundaryAttempts: QUIESCENT_READ_MAX_BOUNDARY_ATTEMPTS, sourceDecisionMutationCount: 0, baseNotificationAutomationActivationCount: 0, automaticNotificationProducerEnabled: false, scheduleActivationCount: 0, production: 'BLOCKED' }, null, 2)}\n`); }
function assertRecoveryConfirmation(env) { if (env?.[RECOVERY_CONFIRMATION.envName] !== RECOVERY_CONFIRMATION.value) fail(`Weekly Notification recovery requires ${RECOVERY_CONFIRMATION.envName}=${RECOVERY_CONFIRMATION.value}`, 'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_CONFIRMATION_REQUIRED', { envName: RECOVERY_CONFIRMATION.envName }); }

async function assertNoFile(path, failIfExists) { try { await stat(path); if (failIfExists) fail('Weekly Notification Admission retained evidence already exists; blind rerun is forbidden', 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_ALREADY_ATTEMPTED', { evidenceName: path.split('/').pop() }); return false; } catch (error) { if (error?.code === 'ENOENT') return true; throw error; } }
async function requireFile(path) { try { await stat(path); } catch (error) { if (error?.code === 'ENOENT') fail('Weekly Notification recovery requires retained Queue-attempt evidence', 'LARK_WEEKLY_7D_NOTIFICATION_RECOVERY_EVIDENCE_MISSING'); throw error; } }
async function privateJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); await chmod(path, 0o600); }
function run(command, args, options = {}) { const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...(options.env ?? {}) }, stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 }); if (result.error) throw result.error; if (result.status !== 0) fail(`Command failed: ${command}`, 'LARK_WEEKLY_7D_NOTIFICATION_COMMAND_FAILED', { command, args: args.map((arg, index) => args[index - 1] === '--command' ? '[READ_ONLY_SQL_REDACTED]' : arg), status: result.status }); return Object.freeze({ stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' }); }
function text(command, args, options = {}) { return run(command, args, options).stdout; }
function readObservationMs(env) { const value = Number(env.MKT_LARK_WEEKLY_7D_NOTIFICATION_OBSERVATION_MS ?? OBSERVATION_MS); if (!Number.isSafeInteger(value) || value < 10_000 || value > 120_000) fail('Weekly Notification observation must be 10-120 seconds', 'LARK_WEEKLY_7D_NOTIFICATION_INPUT_REQUIRED', { fieldName: 'MKT_LARK_WEEKLY_7D_NOTIFICATION_OBSERVATION_MS' }); return value; }
function positiveInteger(value, fieldName) { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) fail(`${fieldName} must be a positive integer`, 'LARK_WEEKLY_7D_NOTIFICATION_INPUT_REQUIRED', { fieldName }); return number; }
function exact(value, expected, fieldName) { if (value !== expected) fail(`Weekly Notification Admission requires ${fieldName}=${expected}`, 'LARK_WEEKLY_7D_NOTIFICATION_ENVIRONMENT_INVALID', { fieldName }); }
function requireText(value, fieldName) { const textValue = optionalText(value); if (!textValue) fail(`${fieldName} is required`, 'LARK_WEEKLY_7D_NOTIFICATION_INPUT_REQUIRED', { fieldName }); return textValue; }
function optionalText(value) { if (value === null || value === undefined) return null; const textValue = String(scalar(value) ?? '').trim(); return textValue || null; }
function scalar(value) { if (value === null || value === undefined) return null; if (Array.isArray(value)) { if (value.length === 0) return null; if (value.length === 1) return scalar(value[0]); return value.map(scalar).join(','); } if (typeof value === 'object') { for (const key of ['text', 'name', 'value']) if (value[key] !== undefined) return scalar(value[key]); } return value; }
function booleanValue(value) { const item = scalar(value); if (item === true || item === false) return item; if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true; if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false; return null; }
function sanitize(value) { return String(value).replace(/[\r\n\t]+/gu, ' ').slice(0, 500); }
function scrub(value) { if (Array.isArray(value)) return value.map(scrub); if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitize(value) : value; return Object.fromEntries(Object.entries(value).map(([key, nested]) => [/(?:token|secret|password|authorization|tableId|queueId|accountId|groupId)/iu.test(key) ? `${key}Redacted` : key, /(?:token|secret|password|authorization|tableId|queueId|accountId|groupId)/iu.test(key) ? true : scrub(nested)])); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function fail(message, code, details = {}) { const error = new Error(message); error.name = 'LarkWeekly7dNotificationAdmissionTerminalError'; error.code = code; error.details = Object.freeze({ ...details }); throw error; }
function sleep(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }
