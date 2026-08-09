#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { listCloudflareQueuesViaApi } from './lib/cloudflare-queue-list-rest.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  resolveLarkNotificationRuntimeActivationSettings,
  selectLarkNotificationRuntimeExecutivePreviews,
} from './lib/lark-notification-runtime-activation.js';
import { extractLarkNotificationWranglerD1Rows } from './lib/lark-notification-remote-rollout-operator.js';
import { collectLarkNativeAiWeekly7dControlledUatSource } from './lib/lark-native-ai-weekly-7d-controlled-uat.js';
import {
  assertLarkWeekly7dFullChannelAiGenerated,
  buildLarkWeekly7dFullChannelAiSynthesis,
} from './lib/lark-weekly-7d-full-channel-ai-synthesis.js';
import {
  assertFullChannelMessage,
  assertLarkWeekly7dFullChannelNotificationConfirmation,
  assertLarkWeekly7dFullChannelSourceAlignment,
  buildLarkWeekly7dFullChannelNotificationRow,
} from './lib/lark-weekly-7d-full-channel-notification.js';
import {
  assertLarkWeekly7dNotificationAdmissionBaseline,
  assertLarkWeekly7dNotificationAdmissionDelivered,
  assertLarkWeekly7dNotificationAdmissionStable,
  buildLarkWeekly7dNotificationAdmissionJob,
  buildLarkWeekly7dNotificationAdmissionReadbackSql,
  isExactAcceptedWeekly7dSource,
  normalizeLarkWeekly7dNotificationAdmissionReadback,
} from './lib/lark-weekly-7d-notification-admission.js';
import {
  parseSourceReportIds,
  resolveLarkNotificationControlledUatTables,
} from './lib/lark-notification-controlled-uat.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
  resolveWooCommerceQueueId,
} from './lib/woocommerce-final-one-command.js';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import { buildLarkExecutiveNotificationMessage } from '../packages/application/src/notifications/deliver-lark-executive-notification.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
} from '../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { LARK_EXECUTIVE_DESTINATION_KEY_HASH } from '../packages/config/src/lark-notification-runtime-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { loadLarkNotificationDeliveryRequest } from '../packages/connectors/src/lark/lark-notification-delivery-source.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';

const ROOT = resolve(process.cwd());
const SOURCE_CONFIG = resolve(
  process.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const OUTPUT_ROOT = resolve(
  process.env.MKT_LARK_WEEKLY_7D_FULL_CHANNEL_EVIDENCE_ROOT
    ?? 'outputs/lark-weekly-7d-full-channel-notification',
);
const CONTRACT_VERSION = 'lark_weekly_7d_full_channel_notification_terminal_v2';
const RECOVERY_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_WEEKLY_7D_FULL_CHANNEL_RECOVERY',
  value: 'RECOVER_CORRECTED_FULL_CHANNEL_WEEKLY_7D_WITHOUT_RESEND',
});
const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';
const ACTIVE = new Set(['enable', 'enabled', 'active', 'on']);
const INACTIVE = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const MAX_MESSAGE_BYTES = 18_000;
const MAX_POLLS = 90;
const POLL_INTERVAL_MS = 2_000;
const OBSERVATION_MS = 15_000;
const SOURCE_HASH_FIELDS = Object.freeze([
  'ai_run_key', 'report_id', 'template_version', 'scope_type', 'channel_key', 'window_days',
  'period_start', 'period_end', 'compare_start', 'compare_end', 'comparison_mode',
  'readiness_status', 'generation_status', 'failure_code', 'preview_mode',
  'notification_eligible', 'sent_to_group', 'dedupe_key', 'source_report_ids_json',
  'metric_summary_json', 'channel_status_vector_json', 'insight_summary', 'strengths',
  'weaknesses', 'recommendations',
]);
const SYNTHESIS_HASH_FIELDS = Object.freeze([
  ...SOURCE_HASH_FIELDS,
  'source_report_checksum', 'generated_at', 'notification_reason', 'sent_at', 'cooldown_until',
]);

let action = 'preview';
let stage = 'init';
let repositoryState = null;
let queueAttemptRecorded = false;
let queueAdmissionConfirmed = false;

try {
  action = parseArgs(process.argv.slice(2));
  if (action === 'preview') await preview();
  else if (action === 'execute') await execute();
  else await recover();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: CONTRACT_VERSION,
    action,
    stage,
    code: error?.code ?? 'LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_FAILED',
    message: sanitize(error?.message ?? String(error)),
    details: scrub(error?.details ?? {}),
    repository: repositoryState,
    queueAttemptRecorded,
    queueAdmissionCount: queueAdmissionConfirmed ? 1 : 0,
    queueOutcomeUncertain: queueAttemptRecorded && !queueAdmissionConfirmed,
    blindRerunAllowed: !queueAttemptRecorded,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    sourceV9MutationCount: 0,
    synthesisMutationCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function preview() {
  const context = await prepare('preview');
  stage = 'preview-current-d1-baseline';
  const d1 = assertLarkWeekly7dNotificationAdmissionBaseline(readD1State(context));
  stage = 'preview-current-lark-baseline';
  const lark = await readLarkBaseline(context);
  stage = 'build-read-only-message-preview';
  const request = buildPreviewRequest(context);
  const message = buildLarkExecutiveNotificationMessage(request);
  const accepted = assertFullChannelMessage({ admission: context.admission, messageText: message.text });
  const messageBytes = Buffer.byteLength(message.text, 'utf8');
  if (messageBytes > MAX_MESSAGE_BYTES) fail(
    'Corrected Weekly message exceeds the pre-send preview byte bound',
    'LARK_WEEKLY_7D_FULL_CHANNEL_MESSAGE_TOO_LARGE',
    { messageBytes, maximumBytes: MAX_MESSAGE_BYTES },
  );
  const result = Object.freeze({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    action: 'preview',
    mode: 'READ_ONLY',
    stage: 'complete',
    status: 'weekly_7d_full_channel_notification_preview_passed',
    repository: repositoryState,
    sourceV9MutationCount: 0,
    synthesisMutationCount: 0,
    sourceReportIds: context.admission.sourceReportIds,
    period: context.factualReport.period,
    channelSectionCount: accepted.channelSectionCount,
    businessFactChannelCount: accepted.businessFactChannelCount,
    comparisonEvidenceChannelCount: context.admission.evidence.comparisonEvidenceChannelCount,
    synthesisAiRunKeySha256: sha256(context.admission.synthesisAiRunKey),
    synthesisQualityGatePassed: context.admission.qualityGate.passed,
    factualReportSha256: context.admission.factualReportSha256,
    correctedAiRunKeySha256: sha256(context.admission.aiRunKey),
    messageBytes,
    messagePreview: message.text,
    existingDeliveryRows: d1.totalDeliveryRows,
    existingSentNotificationLogRows: lark.totalSentNotificationLogRows,
    queueAdmissionCount: 0,
    messageSendCount: 0,
    recordWriteCount: 0,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    notificationAutomationStatus: context.automation.notification.status,
    notificationProducerEnabled: false,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
    nextGate: 'execute_requires_explicit_confirmation_after_preview_review',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function execute() {
  const context = await prepare('execute');
  stage = 'assert-fresh-corrected-identity';
  await assertNoFile(join(context.evidenceDir, '03-queue-send.attempt.json'), true);
  await assertNoFile(join(context.evidenceDir, 'full-channel-notification-summary.json'), true);
  stage = 'remote-read-only-preflight';
  const beforeD1 = assertLarkWeekly7dNotificationAdmissionBaseline(readD1State(context));
  const beforeLark = await readLarkBaseline(context);
  await privateJson(join(context.evidenceDir, '01-preflight.json'), {
    contractVersion: CONTRACT_VERSION,
    repositoryHead: context.repositoryHead,
    sourceStateSha256: context.sourceStateSha256,
    synthesisStateSha256: context.synthesisStateSha256,
    sourceAiRunKeySha256: sha256(context.admission.sourceAiRunKey),
    synthesisAiRunKeySha256: sha256(context.admission.synthesisAiRunKey),
    correctedAiRunKeySha256: sha256(context.admission.aiRunKey),
    factualReportSha256: context.admission.factualReportSha256,
    sourceReportIds: context.admission.sourceReportIds,
    period: context.factualReport.period,
    channelSectionCount: context.admission.channelSectionCount,
    businessFactChannelCount: context.admission.businessFactChannelCount,
    queueAdmissionCount: 0,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    production: 'BLOCKED',
  });

  stage = 'reconcile-corrected-notification-row';
  await reconcileAdmissionRow(context);
  stage = 'validate-exact-live-delivery-chain';
  const request = await loadLarkNotificationDeliveryRequest({
    repository: context.larkRepository,
    tables: context.tableIds,
    aiRunKey: context.admission.aiRunKey,
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });
  assertDeliveryChain(context, request);
  const message = buildLarkExecutiveNotificationMessage(request);
  const acceptedMessage = assertFullChannelMessage({ admission: context.admission, messageText: message.text });
  const messageBytes = Buffer.byteLength(message.text, 'utf8');
  if (messageBytes > MAX_MESSAGE_BYTES) fail(
    'Corrected Weekly message exceeds the pre-send byte bound',
    'LARK_WEEKLY_7D_FULL_CHANNEL_MESSAGE_TOO_LARGE',
    { messageBytes, maximumBytes: MAX_MESSAGE_BYTES },
  );
  await privateJson(join(context.evidenceDir, '02-message-preview.json'), {
    contractVersion: CONTRACT_VERSION,
    messageSha256: acceptedMessage.messageSha256,
    messageBytes,
    channelSectionCount: acceptedMessage.channelSectionCount,
    businessFactChannelCount: acceptedMessage.businessFactChannelCount,
    synthesisQualityGatePassed: context.admission.qualityGate.passed,
    rawDestinationPersisted: false,
  });
  await assertAuthoritiesUnchanged(context);

  stage = 'build-existing-runtime-job';
  const operationId = `lark_weekly_7d_full_channel_${sha256(context.admission.aiRunKey).slice(0, 32)}`;
  const job = buildLarkWeekly7dNotificationAdmissionJob({
    aiRunKey: context.admission.aiRunKey,
    operationId,
    requestedAt: Date.now(),
  });
  stage = 'record-one-queue-attempt';
  await privateJson(join(context.evidenceDir, '03-queue-send.attempt.json'), {
    contractVersion: CONTRACT_VERSION,
    repositoryHead: context.repositoryHead,
    aiRunKey: context.admission.aiRunKey,
    aiRunKeySha256: sha256(context.admission.aiRunKey),
    synthesisAiRunKeySha256: sha256(context.admission.synthesisAiRunKey),
    operationId,
    jobSha256: sha256(JSON.stringify(job)),
    sourceStateSha256: context.sourceStateSha256,
    synthesisStateSha256: context.synthesisStateSha256,
    factualReportSha256: context.admission.factualReportSha256,
    attemptedAt: new Date().toISOString(),
    maximumQueueAdmissionCount: 1,
    blindRerunAllowedAfterThisFile: false,
  });
  queueAttemptRecorded = true;

  stage = 'send-one-existing-runtime-queue-job';
  await sendQueueOnce(context, job);
  queueAdmissionConfirmed = true;
  stage = 'poll-sent-and-mirrored';
  const delivered = await pollDelivered(context, beforeD1);
  stage = 'verify-lark-mirror-and-authority-immutability';
  const afterLark = await verifyLarkDelivery(context, beforeLark);
  await assertAuthoritiesUnchanged(context);
  stage = 'bounded-no-additional-admission-observation';
  await sleep(readObservationMs(context.env));
  const observed = readD1State(context);
  const stability = assertLarkWeekly7dNotificationAdmissionStable(delivered, observed);
  const observedLark = await verifyLarkDelivery(context, beforeLark);
  if (JSON.stringify(afterLark) !== JSON.stringify(observedLark)) fail(
    'Corrected Weekly Lark mirror changed during no-admission observation',
    'LARK_WEEKLY_7D_FULL_CHANNEL_LARK_STABILITY_FAILED',
  );
  await assertAuthoritiesUnchanged(context);
  const automationAfter = await verifyAutomationState(context.client);
  if (JSON.stringify(context.automation) !== JSON.stringify(automationAfter)) fail(
    'Automation identity/status changed during corrected Weekly notification',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AUTOMATION_DRIFT',
  );
  await assertSettingsActive(context);

  const result = Object.freeze({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    action: 'execute',
    stage: 'complete',
    status: 'weekly_7d_full_channel_notification_sent_and_verified',
    repository: repositoryState,
    sourceV9MutationCount: 0,
    synthesisMutationCount: 0,
    sourceReportIds: context.admission.sourceReportIds,
    period: context.factualReport.period,
    channelSectionCount: context.admission.channelSectionCount,
    businessFactChannelCount: context.admission.businessFactChannelCount,
    comparisonEvidenceChannelCount: context.admission.evidence.comparisonEvidenceChannelCount,
    synthesisAiRunKeySha256: sha256(context.admission.synthesisAiRunKey),
    synthesisQualityGatePassed: context.admission.qualityGate.passed,
    factualReportSha256: context.admission.factualReportSha256,
    correctedAiRunKeySha256: sha256(context.admission.aiRunKey),
    queueAdmissionCount: 1,
    messageSendCount: 1,
    deliveryRowsBefore: delivered.deliveryRowsBefore,
    deliveryRowsAfter: delivered.deliveryRowsAfter,
    additionalDeliveryRows: 1,
    deliveryStatus: delivered.admissionDeliveryStatus,
    mirrorStatus: delivered.admissionMirrorStatus,
    notificationLogRowsBefore: beforeLark.totalSentNotificationLogRows,
    notificationLogRowsAfter: afterLark.totalSentNotificationLogRows,
    additionalNotificationLogRows: 1,
    sentToGroup: afterLark.admissionAiRunMarkedSent,
    exactDeliveryRows: stability.exactDeliveryRows,
    duplicateDeliveryRows: stability.duplicateDeliveryRows,
    additionalMessageSendCountDuringObservation: stability.additionalMessageSendCountDuringObservation,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    runtimeRemainsActive: true,
    reportSettingsRemainActive: true,
    aiAutomationStatus: automationAfter.aiMaterialization.status,
    notificationAutomationStatus: automationAfter.notification.status,
    notificationProducerEnabled: false,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
    nextGate: 'automatic_weekly_notification_admission_requires_separate_approval',
  });
  await privateJson(join(context.evidenceDir, 'full-channel-notification-summary.json'), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function recover() {
  const context = await prepare('recover');
  stage = 'verify-retained-queue-attempt';
  const attemptPath = join(context.evidenceDir, '03-queue-send.attempt.json');
  await requireFile(attemptPath);
  const attempt = JSON.parse(await readFile(attemptPath, 'utf8'));
  if (attempt.aiRunKey !== context.admission.aiRunKey
      || attempt.sourceStateSha256 !== context.sourceStateSha256
      || attempt.synthesisStateSha256 !== context.synthesisStateSha256
      || attempt.factualReportSha256 !== context.admission.factualReportSha256) fail(
    'Recovery evidence differs from current source/synthesis/factual authority',
    'LARK_WEEKLY_7D_FULL_CHANNEL_RECOVERY_EVIDENCE_INVALID',
  );
  queueAttemptRecorded = true;
  queueAdmissionConfirmed = true;
  stage = 'verify-recovery-lark-baseline';
  const beforeLark = await readLarkBaseline(context, { allowAdmissionRow: true });
  await assertSettingsActive(context);
  stage = 'poll-existing-delivery-without-resend';
  const delivered = await pollExistingDelivered(context);
  stage = 'verify-recovered-lark-mirror';
  const afterLark = await verifyRecoveredLarkDelivery(context, beforeLark);
  await assertAuthoritiesUnchanged(context);
  stage = 'recovery-no-admission-observation';
  await sleep(readObservationMs(context.env));
  const observed = readD1State(context);
  const stability = assertLarkWeekly7dNotificationAdmissionStable(delivered, observed);
  const result = Object.freeze({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    action: 'recover',
    mode: 'POLL_ONLY_RECOVERY',
    stage: 'complete',
    status: 'weekly_7d_full_channel_notification_recovered_without_resend',
    repository: repositoryState,
    queueAdmissionCountByRecovery: 0,
    messageSendCountByRecovery: 0,
    deliveryStatus: delivered.admissionDeliveryStatus,
    mirrorStatus: delivered.admissionMirrorStatus,
    sentToGroup: afterLark.admissionAiRunMarkedSent,
    duplicateDeliveryRows: stability.duplicateDeliveryRows,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    sourceV9MutationCount: 0,
    synthesisMutationCount: 0,
    notificationProducerEnabled: false,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });
  await privateJson(join(context.evidenceDir, 'full-channel-notification-summary.json'), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function prepare(mode) {
  stage = 'load-local-environment';
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  if (mode === 'execute') assertLarkWeekly7dFullChannelNotificationConfirmation(env);
  if (mode === 'recover') assertRecoveryConfirmation(env);
  exact(env.MKT_ENV, 'development', 'MKT_ENV');
  exact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  exact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  stage = 'repository-preflight';
  const repositoryHead = exactMainHead();
  repositoryState = Object.freeze({ branch: 'main', head: repositoryHead, originMain: repositoryHead, clean: true });
  if (mode === 'execute') {
    stage = 'local-focused-gates';
    run('node', ['--test',
      'tests/application/lark-weekly-executive-factual-report.test.js',
      'tests/application/lark-weekly-executive-full-channel-ai-evidence.test.js',
      'tests/application/lark-weekly-7d-full-channel-notification.test.js',
      'tests/application/lark-weekly-7d-notification-admission.test.js',
      'tests/application/deliver-lark-executive-notification.test.js',
    ], { stdio: 'inherit' });
    run('npm', ['run', 'check'], { stdio: 'inherit' });
  }

  stage = 'assert-no-automatic-notification-producer';
  const scheduledJobsSource = await readFile(resolve('apps/sync-worker/src/scheduled-jobs.js'), 'utf8');
  if (/LARK_NOTIFICATION_SEND/u.test(scheduledJobsSource)) fail(
    'Corrected Weekly notification requires automatic Schedule admission to remain absent',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SCHEDULE_PRESENT',
  );

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

  stage = 'load-exact-accepted-v9-source';
  const sourceCandidates = await larkRepository.listByFieldValues(
    tableIds.aiRuns,
    'template_version',
    [LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION],
  );
  const matches = sourceCandidates.filter((record) => isExactAcceptedWeekly7dSource(record?.fields));
  if (matches.length !== 1) fail(
    'Expected exactly one accepted finalized V9 weekly Executive source row',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SOURCE_INVALID',
    { candidates: sourceCandidates.length, exactMatches: matches.length },
  );
  const sourceRecord = matches[0];
  const sourceStateSha256 = hashRecordState(sourceRecord.fields, SOURCE_HASH_FIELDS);

  stage = 'collect-exact-aligned-factual-report-source';
  const collected = await collectLarkNativeAiWeekly7dControlledUatSource({ client });
  const expectedSourceReportIds = parseSourceReportIds(sourceRecord.fields.source_report_ids_json);
  const expectedPeriod = sourcePeriod(sourceRecord.fields);
  assertLarkWeekly7dFullChannelSourceAlignment({
    expectedSourceReportIds,
    collectedSourceReportIds: collected.sourceReportIds,
    expectedPeriod,
    collectedPeriod: collected.targetPeriod,
  });
  const factualReport = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: collected.targetPeriod,
    reportBundles: collected.reportBundles,
  });

  stage = 'load-exact-generated-full-channel-ai-synthesis';
  const expectedSynthesis = buildLarkWeekly7dFullChannelAiSynthesis({ sourceRecord, factualReport });
  const synthesisRows = await larkRepository.listByFieldValues(
    tableIds.aiRuns,
    'ai_run_key',
    [expectedSynthesis.aiRunKey],
  );
  const synthesisMatches = synthesisRows.filter((record) => (
    String(readScalar(record?.fields?.ai_run_key) ?? '') === expectedSynthesis.aiRunKey
  ));
  if (synthesisMatches.length !== 1) fail(
    'Corrected Weekly notification requires one generated full-channel AI synthesis row',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SYNTHESIS_MISSING',
    { matchCount: synthesisMatches.length },
  );
  const synthesisRecord = synthesisMatches[0];
  const synthesisAccepted = assertLarkWeekly7dFullChannelAiGenerated(
    synthesisRecord.fields,
    expectedSynthesis,
  );
  const synthesisStateSha256 = hashRecordState(synthesisRecord.fields, SYNTHESIS_HASH_FIELDS);
  const admission = buildLarkWeekly7dFullChannelNotificationRow({
    sourceRecord,
    factualReport,
    synthesisRecord,
  });
  if (!synthesisAccepted.qualityGate.passed || !admission.qualityGate.passed) fail(
    'Corrected Weekly notification requires a passed full-channel AI quality gate',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SYNTHESIS_QUALITY_INVALID',
  );
  const evidenceDir = resolve(OUTPUT_ROOT, sha256(admission.aiRunKey));
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);

  stage = 'resolve-active-runtime-settings-authority';
  const executiveRows = await larkRepository.listByFieldValues(tableIds.aiRuns, 'scope_type', ['executive']);
  const previews = selectLarkNotificationRuntimeExecutivePreviews(executiveRows);
  const runtimeSourceReportIds = [...new Set(previews.flatMap((record) => parseSourceReportIds(record.fields.source_report_ids_json)))].sort();
  const allSourceReportIds = [...new Set([...runtimeSourceReportIds, ...admission.sourceReportIds])].sort();
  const snapshotRows = await larkRepository.listByFieldValues(tableIds.reportSnapshots, 'report_id', allSourceReportIds);
  const settingKeys = resolveSettingKeys(snapshotRows, runtimeSourceReportIds, 'Runtime');
  const sourceSettingKeys = resolveSettingKeys(snapshotRows, admission.sourceReportIds, 'accepted weekly source');
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
  const missing = sourceSettingKeys.filter((key) => !settingsAuthority.settingKeys.includes(key));
  if (missing.length > 0) fail(
    'Accepted Weekly source Reports are outside active Runtime Settings authority',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SETTINGS_INVALID',
    { missingSettingCount: missing.length },
  );

  stage = 'verify-automation-state';
  const automation = await verifyAutomationState(client);
  stage = 'resolve-cloudflare-read-only-authority';
  const sourceText = await readFile(SOURCE_CONFIG, 'utf8');
  const sourceConfig = parseJsoncObject(sourceText);
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

  return Object.freeze({
    env, mode, repositoryHead, evidenceDir, client, tableIds, larkRepository, syncEngine,
    sourceRecord, sourceStateSha256, synthesisRecord, synthesisStateSha256,
    expectedSynthesis, collected, factualReport, admission, previews,
    snapshotRows, settingsAuthority, settingRows, cloudflare, databaseName, queueName, queueId,
    automation,
  });
}

function buildPreviewRequest(context) {
  const fields = context.admission.fields;
  return Object.freeze({
    aiRun: Object.freeze({
      aiRunKey: context.admission.aiRunKey,
      reportId: context.admission.reportId,
      templateVersion: fields.template_version,
      scopeType: 'executive',
      generationStatus: 'generated',
      notificationEligible: true,
      previewMode: false,
      sentToGroup: false,
      dedupeKey: context.admission.dedupeKey,
      windowDays: 7,
      readinessStatus: readScalar(fields.readiness_status),
      severity: readScalar(fields.severity),
      insightSummary: fields.insight_summary,
      strengths: fields.strengths,
      weaknesses: fields.weaknesses,
      recommendations: fields.recommendations,
    }),
    snapshot: Object.freeze({
      reportId: context.admission.reportId,
      reportSettingKey: context.settingsAuthority.settingKeys[0],
      customerProfile: 'integration_workspace',
      periodStart: context.factualReport.period.periodStart,
      periodEnd: context.factualReport.period.periodEnd,
    }),
    settings: Object.freeze({
      enabled: true,
      aiEnabled: true,
      notificationEnabled: true,
      groupId: '[READ_ONLY_PREVIEW_DESTINATION]',
      destinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
    }),
  });
}

async function reconcileAdmissionRow(context) {
  const plan = await context.syncEngine.planByKey({
    repository: context.larkRepository,
    tableId: context.tableIds.aiRuns,
    keyField: 'ai_run_key',
    rows: [context.admission.fields],
  });
  if (plan.createRows.length > 1 || plan.updateRows.length !== 0) fail(
    'Corrected Weekly notification row must be create-or-exact-skip only',
    'LARK_WEEKLY_7D_FULL_CHANNEL_ROW_DRIFT',
    { createRows: plan.createRows.length, updateRows: plan.updateRows.length },
  );
  const result = await context.syncEngine.executePlan(plan);
  if (result.created + result.skipped !== 1 || result.updated !== 0) fail(
    'Corrected Weekly notification row did not reconcile exactly once',
    'LARK_WEEKLY_7D_FULL_CHANNEL_ROW_WRITE_FAILED',
  );
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
    fail('Corrected Weekly delivery chain is not exact and active', 'LARK_WEEKLY_7D_FULL_CHANNEL_DELIVERY_CHAIN_INVALID');
  }
}

async function assertSettingsActive(context) {
  const rows = await context.larkRepository.listByFieldValues(
    context.tableIds.reportSettings,
    'report_setting_key',
    context.settingsAuthority.settingKeys,
  );
  for (const baseline of context.settingsAuthority.baseline) {
    const matches = rows.filter((record) => (
      String(readScalar(record?.fields?.report_setting_key) ?? '') === baseline.reportSettingKey
      && String(readScalar(record?.fields?.customer_profile) ?? '') === baseline.customerProfile
    ));
    if (matches.length !== 1
        || readBoolean(matches[0].fields.enabled) !== true
        || readBoolean(matches[0].fields.ai_enabled) !== true
        || readBoolean(matches[0].fields.notification_enabled) !== true) fail(
      'Corrected Weekly notification requires exact active Report Settings',
      'LARK_WEEKLY_7D_FULL_CHANNEL_SETTINGS_INVALID',
      { reportSettingKey: baseline.reportSettingKey, matchCount: matches.length },
    );
  }
  return true;
}

function readD1State(context) {
  const output = text('npx', [
    'wrangler', 'd1', 'execute', context.databaseName,
    '--remote', '--config', SOURCE_CONFIG,
    '--command', buildLarkWeekly7dNotificationAdmissionReadbackSql(context.admission.aiRunKey),
    '--json',
  ], { env: context.cloudflare.wranglerEnv });
  const row = extractLarkNotificationWranglerD1Rows(output)[0];
  return normalizeLarkWeekly7dNotificationAdmissionReadback(row);
}

async function pollDelivered(context, before) {
  const maxPolls = positiveInteger(context.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_MAX_POLLS ?? MAX_POLLS, 'maxPolls');
  const interval = positiveInteger(context.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_POLL_INTERVAL_MS ?? POLL_INTERVAL_MS, 'pollIntervalMs');
  let last = null;
  for (let index = 1; index <= maxPolls; index += 1) {
    last = readD1State(context);
    process.stdout.write(`${JSON.stringify({
      event: 'lark_weekly_7d_full_channel_progress', poll: index,
      admissionDeliveryRows: last.admissionDeliveryRows,
      admissionDeliveryStatus: last.admissionDeliveryStatus,
      admissionMirrorStatus: last.admissionMirrorStatus,
    })}\n`);
    try { return assertLarkWeekly7dNotificationAdmissionDelivered(before, last); } catch (error) {
      if (error?.code !== 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_NOT_CONFIRMED') throw error;
    }
    if (index < maxPolls) await sleep(interval);
  }
  fail('Corrected Weekly notification delivery verification timed out', 'LARK_WEEKLY_7D_FULL_CHANNEL_VERIFY_TIMEOUT', {
    admissionDeliveryRows: last?.admissionDeliveryRows ?? null,
    admissionDeliveryStatus: last?.admissionDeliveryStatus ?? null,
    admissionMirrorStatus: last?.admissionMirrorStatus ?? null,
  });
}

async function pollExistingDelivered(context) {
  const first = readD1State(context);
  if (first.admissionDeliveryRows === 0) fail(
    'Recovery found no retained corrected Weekly delivery; automatic resend is forbidden',
    'LARK_WEEKLY_7D_FULL_CHANNEL_RECOVERY_DELIVERY_MISSING',
  );
  const syntheticBefore = Object.freeze({
    ...first,
    totalDeliveryRows: first.totalDeliveryRows - 1,
    sentMirroredRows: Math.max(0, first.sentMirroredRows - (first.admissionDeliveryStatus === 'sent' && first.admissionMirrorStatus === 'mirrored' ? 1 : 0)),
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
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(context.cloudflare.accountId)}/queues/${encodeURIComponent(context.queueId)}/messages`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${freshQueueBearer(context.cloudflare)}`, 'content-type': 'application/json' },
      body: JSON.stringify({ body: job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) fail(
    'Cloudflare Queue did not confirm corrected Weekly notification admission',
    'LARK_WEEKLY_7D_FULL_CHANNEL_QUEUE_SEND_FAILED',
    { status: response.status },
  );
}

async function readLarkBaseline(context, options = {}) {
  const [sentRows, admissionAiRows, admissionLogRows] = await Promise.all([
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'attempt_status', ['sent']),
    context.larkRepository.listByFieldValues(context.tableIds.aiRuns, 'ai_run_key', [context.admission.aiRunKey]),
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'ai_run_key', [context.admission.aiRunKey]),
  ]);
  const ai = admissionAiRows.filter((row) => String(readScalar(row?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey);
  const logs = admissionLogRows.filter((row) => String(readScalar(row?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey);
  if (options.allowAdmissionRow === true) {
    if (ai.length !== 1 || logs.length > 1) fail('Recovery corrected Lark state is invalid', 'LARK_WEEKLY_7D_FULL_CHANNEL_RECOVERY_LARK_STATE_INVALID', { aiRows: ai.length, logRows: logs.length });
  } else if (logs.length !== 0 || ai.length > 1 || (ai.length === 1 && readBoolean(ai[0].fields.sent_to_group) !== false)) {
    fail('Corrected Weekly identity already has sent/mirror evidence', 'LARK_WEEKLY_7D_FULL_CHANNEL_ALREADY_ATTEMPTED', { aiRows: ai.length, logRows: logs.length });
  }
  return Object.freeze({ totalSentNotificationLogRows: sentRows.length, admissionAiRowsBefore: ai.length, admissionLogRowsBefore: logs.length });
}

async function verifyLarkDelivery(context, baseline) {
  const [sentRows, aiRows, logRows] = await Promise.all([
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'attempt_status', ['sent']),
    context.larkRepository.listByFieldValues(context.tableIds.aiRuns, 'ai_run_key', [context.admission.aiRunKey]),
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'ai_run_key', [context.admission.aiRunKey]),
  ]);
  const ai = aiRows.filter((row) => String(readScalar(row?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey);
  const logs = logRows.filter((row) => String(readScalar(row?.fields?.ai_run_key) ?? '') === context.admission.aiRunKey);
  if (ai.length !== 1 || logs.length !== 1 || sentRows.length !== baseline.totalSentNotificationLogRows + 1
      || readBoolean(ai[0].fields.sent_to_group) !== true || String(readScalar(logs[0].fields.attempt_status) ?? '') !== 'sent') fail(
    'Corrected Weekly notification Lark mirror parity failed',
    'LARK_WEEKLY_7D_FULL_CHANNEL_LARK_PARITY_FAILED',
    { aiRows: ai.length, logRows: logs.length, totalSentNotificationLogRows: sentRows.length },
  );
  return Object.freeze({ totalSentNotificationLogRows: sentRows.length, admissionAiRunMarkedSent: true, admissionNotificationLogRows: 1 });
}

async function verifyRecoveredLarkDelivery(context, baseline) {
  return verifyLarkDelivery(context, {
    totalSentNotificationLogRows: Math.max(0, baseline.totalSentNotificationLogRows - (baseline.admissionLogRowsBefore ? 1 : 0)),
  });
}

async function assertAuthoritiesUnchanged(context) {
  const [sourceRows, synthesisRows] = await Promise.all([
    context.larkRepository.listByFieldValues(context.tableIds.aiRuns, 'ai_run_key', [context.admission.sourceAiRunKey]),
    context.larkRepository.listByFieldValues(context.tableIds.aiRuns, 'ai_run_key', [context.admission.synthesisAiRunKey]),
  ]);
  const source = sourceRows.filter((row) => String(readScalar(row?.fields?.ai_run_key) ?? '') === context.admission.sourceAiRunKey);
  const synthesis = synthesisRows.filter((row) => String(readScalar(row?.fields?.ai_run_key) ?? '') === context.admission.synthesisAiRunKey);
  if (source.length !== 1 || hashRecordState(source[0].fields, SOURCE_HASH_FIELDS) !== context.sourceStateSha256) fail(
    'Accepted V9 source changed during corrected Weekly notification',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SOURCE_MUTATED',
    { matchCount: source.length },
  );
  if (synthesis.length !== 1 || hashRecordState(synthesis[0].fields, SYNTHESIS_HASH_FIELDS) !== context.synthesisStateSha256) fail(
    'Full-channel AI synthesis changed during corrected Weekly notification',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SYNTHESIS_MUTATED',
    { matchCount: synthesis.length },
  );
}

function hashRecordState(fields, fieldNames) {
  return sha256(JSON.stringify(Object.fromEntries(fieldNames.map((name) => [
    name,
    ['preview_mode', 'notification_eligible', 'sent_to_group'].includes(name)
      ? readBoolean(fields?.[name])
      : optionalText(readScalar(fields?.[name])),
  ]))));
}

function sourcePeriod(fields) {
  return Object.freeze({
    periodStart: dateOnlyInBangkok(readScalar(fields.period_start)),
    periodEnd: dateOnlyInBangkok(readScalar(fields.period_end)),
    compareStart: nullableDateOnlyInBangkok(readScalar(fields.compare_start)),
    compareEnd: nullableDateOnlyInBangkok(readScalar(fields.compare_end)),
    comparisonMode: optionalText(readScalar(fields.comparison_mode)) ?? 'none',
    windowDays: 7,
  });
}

function resolveSettingKeys(snapshotRows, reportIds, label) {
  return [...new Set(reportIds.map((reportId) => {
    const matches = snapshotRows.filter((record) => String(readScalar(record?.fields?.report_id) ?? '') === reportId);
    if (matches.length !== 1) fail(`Could not resolve exact ${label} Report Snapshot`, 'LARK_WEEKLY_7D_FULL_CHANNEL_SOURCE_REPORT_INVALID', { label, matchCount: matches.length });
    return requireText(readScalar(matches[0].fields.report_setting_key), 'report_setting_key');
  }))].sort();
}

async function verifyAutomationState(client) {
  const response = await client.requestBitableJson(`/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}/workflows`, { method: 'GET' });
  const workflows = response?.data?.workflows ?? response?.data?.items ?? response?.workflows ?? [];
  const ai = exactWorkflow(workflows, AI_TITLE);
  const notification = exactWorkflow(workflows, NOTIFICATION_TITLE);
  const expectedAi = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS.find((item) => item.title === AI_TITLE);
  const expectedNotification = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS.find((item) => item.title === NOTIFICATION_TITLE);
  const aiHash = sha256(workflowId(ai));
  const notificationHash = sha256(workflowId(notification));
  const aiStatus = requireText(ai.status ?? ai.state, 'AI automation status').toLowerCase();
  const notificationStatus = requireText(notification.status ?? notification.state, 'Notification automation status').toLowerCase();
  if (aiHash !== expectedAi?.workflowIdSha256 || !ACTIVE.has(aiStatus)) fail('Exact AI Materialization Automation must remain active', 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_AUTOMATION_INVALID', { status: aiStatus });
  if (notificationHash !== expectedNotification?.workflowIdSha256 || !INACTIVE.has(notificationStatus)) fail('Exact Base Notification Automation must remain inactive', 'LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_AUTOMATION_UNSAFE', { status: notificationStatus });
  return Object.freeze({ aiMaterialization: Object.freeze({ status: aiStatus, identitySha256: aiHash }), notification: Object.freeze({ status: notificationStatus, identitySha256: notificationHash }) });
}

function exactWorkflow(workflows, title) {
  const matches = workflows.filter((item) => optionalText(item?.title ?? item?.name) === title);
  if (matches.length !== 1) fail(`Expected one exact Automation: ${title}`, 'LARK_WEEKLY_7D_FULL_CHANNEL_AUTOMATION_IDENTITY_INVALID', { count: matches.length });
  return matches[0];
}
function workflowId(workflow) { return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id'); }

function resolveCloudflareTarget(env, configText) {
  const wranglerEnv = buildWranglerOAuthEnvironment(env);
  const whoami = text('npx', ['wrangler', 'whoami', '--json'], { env: wranglerEnv });
  const accountId = resolveCloudflareAccountId({ explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID, preferredAccount: env.MKT_LARK_NOTIFICATION_RUNTIME_ACCOUNT, configText, whoamiOutput: whoami });
  const selected = Object.freeze({ ...wranglerEnv, CLOUDFLARE_ACCOUNT_ID: accountId });
  const auth = resolveCloudflareBearerAuth({ authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], { env: selected }) });
  return Object.freeze({ accountId, wranglerEnv: selected, authType: auth.type });
}
function freshQueueBearer(cloudflare) {
  const auth = resolveCloudflareBearerAuth({ authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], { env: cloudflare.wranglerEnv }) });
  if (auth.type !== cloudflare.authType) fail('Cloudflare auth type changed during corrected Weekly notification', 'LARK_WEEKLY_7D_FULL_CHANNEL_AUTH_DRIFT');
  return auth.token;
}
function resolveDatabaseName(config) {
  const matches = Array.isArray(config?.d1_databases) ? config.d1_databases.filter((item) => item?.binding === 'MKT_STATE_DB') : [];
  if (matches.length !== 1) fail('Corrected Weekly notification requires one MKT_STATE_DB binding', 'LARK_WEEKLY_7D_FULL_CHANNEL_CONFIG_INVALID');
  return requireText(matches[0].database_name, 'database_name');
}
function resolveQueueName(config) {
  const matches = Array.isArray(config?.queues?.producers) ? config.queues.producers.filter((item) => item?.binding === 'MKT_SYNC_QUEUE') : [];
  if (matches.length !== 1) fail('Corrected Weekly notification requires one MKT_SYNC_QUEUE producer', 'LARK_WEEKLY_7D_FULL_CHANNEL_CONFIG_INVALID');
  return requireText(matches[0].queue, 'queue');
}

function exactMainHead() {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const branch = text('git', ['branch', '--show-current'], { raw: true }).trim();
  const head = text('git', ['rev-parse', 'HEAD']);
  const originMain = text('git', ['rev-parse', 'origin/main']);
  const dirty = text('git', ['status', '--porcelain', '--untracked-files=all'], { raw: true }).trim();
  if (branch !== 'main' || head !== originMain || dirty) fail('Corrected Weekly notification requires clean exact current main', 'LARK_WEEKLY_7D_FULL_CHANNEL_REPOSITORY_INVALID', { branch, head, originMain, dirtyPathCount: dirty ? dirty.split(/\r?\n/u).length : 0 });
  return head;
}

function parseArgs(args) {
  const modes = ['--preview', '--execute', '--recover'].filter((mode) => args.includes(mode));
  const unknown = args.filter((arg) => !['--preview', '--execute', '--recover'].includes(arg));
  if (unknown.length || modes.length > 1) fail('Corrected Weekly terminal accepts one of --preview, --execute, --recover', 'LARK_WEEKLY_7D_FULL_CHANNEL_ARGUMENT_INVALID', { unknown });
  if (modes[0] === '--execute') return 'execute';
  if (modes[0] === '--recover') return 'recover';
  return 'preview';
}
function assertRecoveryConfirmation(env) {
  if (env?.[RECOVERY_CONFIRMATION.envName] !== RECOVERY_CONFIRMATION.value) fail(`Recovery requires ${RECOVERY_CONFIRMATION.envName}=${RECOVERY_CONFIRMATION.value}`, 'LARK_WEEKLY_7D_FULL_CHANNEL_RECOVERY_CONFIRMATION_REQUIRED');
}
async function assertNoFile(path, failIfExists) {
  try { await stat(path); if (failIfExists) fail('Corrected Weekly retained Queue evidence already exists; blind rerun is forbidden', 'LARK_WEEKLY_7D_FULL_CHANNEL_ALREADY_ATTEMPTED', { evidenceName: path.split('/').pop() }); return false; }
  catch (error) { if (error?.code === 'ENOENT') return true; throw error; }
}
async function requireFile(path) { try { await stat(path); } catch (error) { if (error?.code === 'ENOENT') fail('Recovery requires retained Queue-attempt evidence', 'LARK_WEEKLY_7D_FULL_CHANNEL_RECOVERY_EVIDENCE_MISSING'); throw error; } }
async function privateJson(path, value) { await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 }); await chmod(path, 0o600); }
function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: ROOT, encoding: 'utf8', env: { ...process.env, ...(options.env ?? {}) }, stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Command failed: ${command}`, 'LARK_WEEKLY_7D_FULL_CHANNEL_COMMAND_FAILED', { command, status: result.status });
  return Object.freeze({ stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' });
}
function text(command, args, options = {}) { return run(command, args, options).stdout; }
function readObservationMs(env) { const value = Number(env.MKT_LARK_WEEKLY_7D_NOTIFICATION_OBSERVATION_MS ?? OBSERVATION_MS); if (!Number.isSafeInteger(value) || value < 10_000 || value > 120_000) fail('Observation must be 10-120 seconds', 'LARK_WEEKLY_7D_FULL_CHANNEL_INPUT_INVALID'); return value; }
function positiveInteger(value, label) { const number = Number(value); if (!Number.isSafeInteger(number) || number <= 0) fail(`${label} must be positive integer`, 'LARK_WEEKLY_7D_FULL_CHANNEL_INPUT_INVALID'); return number; }
function exact(value, expected, label) { if (value !== expected) fail(`Corrected Weekly notification requires ${label}=${expected}`, 'LARK_WEEKLY_7D_FULL_CHANNEL_ENVIRONMENT_INVALID', { label }); }
function dateOnlyInBangkok(value) { const epoch = Number(value); if (!Number.isFinite(epoch) || epoch <= 0) fail('Source period epoch is invalid', 'LARK_WEEKLY_7D_FULL_CHANNEL_PERIOD_INVALID'); const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(epoch)); const byType = Object.fromEntries(parts.map(({ type, value: part }) => [type, part])); return `${byType.year}-${byType.month}-${byType.day}`; }
function nullableDateOnlyInBangkok(value) { return value === null || value === undefined || value === '' ? null : dateOnlyInBangkok(value); }
function readBoolean(value) { const scalar = readScalar(value); if (scalar === true || scalar === false) return scalar; if (scalar === 1 || scalar === '1' || String(scalar).toLowerCase() === 'true') return true; if (scalar === 0 || scalar === '0' || String(scalar).toLowerCase() === 'false') return false; return null; }
function readScalar(value) { if (value === null || value === undefined) return null; if (Array.isArray(value)) return value.length === 1 ? readScalar(value[0]) : value.map(readScalar).join(''); if (typeof value === 'object') { for (const key of ['text', 'name', 'value']) if (value[key] !== undefined) return readScalar(value[key]); } return value; }
function optionalText(value) { if (value === null || value === undefined) return null; const result = String(value).trim(); return result || null; }
function requireText(value, label) { const result = optionalText(value); if (!result) fail(`${label} is required`, 'LARK_WEEKLY_7D_FULL_CHANNEL_INPUT_INVALID', { label }); return result; }
function sanitize(value) { return String(value).replace(/[\r\n\t]+/gu, ' ').slice(0, 500); }
function scrub(value) { if (Array.isArray(value)) return value.map(scrub); if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitize(value) : value; return Object.fromEntries(Object.entries(value).map(([key, nested]) => [/(?:token|secret|password|authorization|tableId|queueId|accountId|groupId)/iu.test(key) ? `${key}Redacted` : key, /(?:token|secret|password|authorization|tableId|queueId|accountId|groupId)/iu.test(key) ? true : scrub(nested)])); }
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function fail(message, code, details = {}) { const error = new Error(message); error.name = 'LarkWeekly7dFullChannelNotificationTerminalError'; error.code = code; error.details = Object.freeze({ ...details }); throw error; }
function sleep(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }
