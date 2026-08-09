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
  buildLarkNotificationRuntimeActivationWranglerConfig,
} from './lib/lark-notification-runtime-activation.js';
import { extractLarkNotificationWranglerD1Rows } from './lib/lark-notification-remote-rollout-operator.js';
import {
  buildLarkWeekly7dFullChannelRepairCompleteSql,
  buildLarkWeekly7dFullChannelRepairDeadLetterSql,
  buildLarkWeekly7dFullChannelRepairPrepareSql,
  buildLarkWeekly7dFullChannelRepairResolveAlertSql,
  selectLarkWeekly7dFullChannelRepairCandidate,
} from './lib/lark-weekly-7d-full-channel-delivery-repair.js';
import {
  assertLarkWeekly7dNotificationAdmissionBaseline,
  assertLarkWeekly7dNotificationAdmissionDelivered,
  assertLarkWeekly7dNotificationAdmissionStable,
  buildLarkWeekly7dNotificationAdmissionReadbackSql,
  normalizeLarkWeekly7dNotificationAdmissionReadback,
} from './lib/lark-weekly-7d-notification-admission.js';
import {
  resolveLarkNotificationControlledUatTables,
} from './lib/lark-notification-controlled-uat.js';
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

import { buildLarkExecutiveNotificationMessage } from '../packages/application/src/notifications/deliver-lark-executive-notification.js';
import { LARK_EXECUTIVE_DESTINATION_KEY_HASH } from '../packages/config/src/lark-notification-runtime-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { loadLarkNotificationDeliveryRequest } from '../packages/connectors/src/lark/lark-notification-delivery-source.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';

const ROOT = resolve(process.cwd());
const WORKER_NAME = 'social-mkt-sync-worker';
const SOURCE_CONFIG = resolve(
  process.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const OUTPUT_ROOT = resolve(
  process.env.MKT_LARK_WEEKLY_7D_FULL_CHANNEL_EVIDENCE_ROOT
    ?? 'outputs/lark-weekly-7d-full-channel-notification',
);
const CONTRACT_VERSION = 'lark_weekly_7d_full_channel_notification_safe_terminal_v1';
const FRESH_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_SEND',
  value: 'REFRESH_RUNTIME_AND_SEND_ONE_FULL_CHANNEL_WEEKLY_7D',
});
const REPAIR_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_WEEKLY_7D_FULL_CHANNEL_DELIVERY_REPAIR',
  value: 'REPAIR_EXACT_RETAINED_FULL_CHANNEL_NOTIFICATION',
});
const REPAIR_RECOVERY_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_WEEKLY_7D_FULL_CHANNEL_DELIVERY_REPAIR_RECOVERY',
  value: 'RECOVER_EXACT_REPAIR_WITHOUT_REPLAY',
});
const MAX_POLLS = 90;
const POLL_INTERVAL_MS = 2_000;
const OBSERVATION_MS = 15_000;

let action = 'plan';
let stage = 'init';
let repository = null;
let workerDeploymentCount = 0;
let repairQueueReplayCount = 0;
let repairAttemptRecorded = false;

try {
  action = parseArgs(process.argv.slice(2));
  if (action === 'plan') printPlan();
  else if (action === 'execute') await safeExecute();
  else if (action === 'repair') await repairDelivery();
  else await recoverRepair();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: CONTRACT_VERSION,
    action,
    stage,
    code: error?.code ?? 'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_TERMINAL_FAILED',
    message: sanitize(error?.message ?? String(error)),
    details: scrub(error?.details ?? {}),
    repository,
    workerDeploymentCount,
    repairQueueReplayCount,
    repairAttemptRecorded,
    newNotificationIdentityCount: 0,
    aiCallCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    action: 'plan',
    stage: 'complete',
    freshSend: 'preview -> active runtime config -> dry-run -> deploy current main -> verify 100% -> existing full-channel execute',
    retainedRepair: 'exact preview -> exact dead letter -> active runtime deploy -> exact retained payload replay once -> sent/mirrored verification',
    repairRecovery: 'poll-only after retained repair replay attempt; no deploy and no Queue replay',
    automaticProducer: false,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function safeExecute() {
  const context = await prepare('execute');
  requireConfirmation(context.env, FRESH_CONFIRMATION, 'safe send');
  stage = 'read-only-full-channel-preview';
  const preview = runFullChannelPreview(context);
  stage = 'assert-fresh-identity-before-runtime-refresh';
  const evidenceDir = resolveEvidenceDir(preview);
  await assertNoFile(join(evidenceDir, '03-queue-send.attempt.json'), true);
  stage = 'dry-run-current-main-notification-runtime';
  dryRunRuntime(context);
  stage = 'deploy-current-main-notification-runtime';
  const deployedVersion = await deployAndVerifyCurrentRuntime(context);
  workerDeploymentCount = 1;
  stage = 'revalidate-preview-after-runtime-refresh';
  const postDeployPreview = runFullChannelPreview(context);
  assertSamePreviewIdentity(preview, postDeployPreview);
  stage = 'execute-existing-full-channel-one-shot';
  run('node', ['scripts/lark-weekly-7d-full-channel-notification.mjs', '--execute'], {
    env: {
      ...runtimeEnv(context),
      CONFIRM_LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION: 'SEND_ONE_CORRECTED_FULL_CHANNEL_WEEKLY_7D',
    },
    stdio: 'inherit',
  });
  process.stdout.write(`${JSON.stringify({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    action: 'execute',
    stage: 'complete',
    status: 'full_channel_safe_terminal_delegated_send_completed',
    repository,
    deployedVersionSha256: sha256(deployedVersion),
    workerDeploymentCount: 1,
    repairQueueReplayCount: 0,
    newNotificationIdentityCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function repairDelivery() {
  const context = await prepare('repair');
  requireConfirmation(context.env, REPAIR_CONFIRMATION, 'delivery repair');
  stage = 'revalidate-full-channel-authority-read-only';
  const preview = runFullChannelPreview(context);
  const evidenceDir = resolveEvidenceDir(preview);
  const attemptPath = join(evidenceDir, '03-queue-send.attempt.json');
  const repairAttemptPath = join(evidenceDir, '04-runtime-repair-queue-replay.attempt.json');
  await requireFile(attemptPath, 'Retained repair requires original Queue-attempt evidence');
  await assertNoFile(repairAttemptPath, true);
  await assertNoFile(join(evidenceDir, 'full-channel-notification-summary.json'), false);
  const attempt = JSON.parse(await readFile(attemptPath, 'utf8'));
  validateOriginalAttempt(context, preview, attempt);

  stage = 'verify-no-delivery-before-repair';
  const beforeD1 = assertLarkWeekly7dNotificationAdmissionBaseline(readD1State(context, attempt.aiRunKey));
  const beforeLark = await readLarkSendState(context, attempt.aiRunKey, false);
  stage = 'load-exact-retained-terminal-failure';
  const candidate = loadRepairCandidate(context, attempt, ['open']);
  const redriveReference = `repair:${sha256(`${attempt.aiRunKey}:${candidate.dlqId}`).slice(0, 40)}`;

  stage = 'validate-exact-live-delivery-request';
  const request = await loadLarkNotificationDeliveryRequest({
    repository: context.larkRepository,
    tables: context.tableIds,
    aiRunKey: attempt.aiRunKey,
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });
  assertRepairDeliveryRequest(request, attempt.aiRunKey);
  const message = buildLarkExecutiveNotificationMessage(request);
  const retainedMessage = JSON.parse(await readFile(join(evidenceDir, '02-message-preview.json'), 'utf8'));
  if (sha256(message.text) !== retainedMessage.messageSha256) fail(
    'Current Notification message differs from retained pre-send preview',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_MESSAGE_DRIFT',
  );

  stage = 'dry-run-current-main-notification-runtime';
  dryRunRuntime(context);
  stage = 'deploy-current-main-notification-runtime';
  const deployedVersion = await deployAndVerifyCurrentRuntime(context);
  workerDeploymentCount = 1;
  stage = 'verify-runtime-refresh-no-delivery-drift';
  const afterDeployD1 = assertLarkWeekly7dNotificationAdmissionBaseline(readD1State(context, attempt.aiRunKey));
  if (JSON.stringify(beforeD1) !== JSON.stringify(afterDeployD1)) fail(
    'Runtime refresh changed Notification delivery evidence before exact replay',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_DEPLOYMENT_DRIFT',
  );
  const postDeployPreview = runFullChannelPreview(context);
  assertSamePreviewIdentity(preview, postDeployPreview);
  const postDeployCandidate = loadRepairCandidate(context, attempt, ['open']);
  if (postDeployCandidate.dlqId !== candidate.dlqId
      || postDeployCandidate.errorCode !== candidate.errorCode) fail(
    'Retained Notification terminal failure changed during Runtime refresh',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_DLQ_DRIFT',
  );

  stage = 'prepare-exact-dead-letter-redrive-state';
  const preparedAt = Date.now();
  executeD1Mutation(context, buildLarkWeekly7dFullChannelRepairPrepareSql(candidate, {
    now: preparedAt,
    redriveReference,
  }));
  const prepared = loadRepairCandidate(context, attempt, ['redrive_pending']);
  if (prepared.dlqId !== candidate.dlqId || prepared.redriveReference !== redriveReference) fail(
    'Exact retained Notification dead letter did not enter redrive_pending',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_PREPARE_FAILED',
  );

  stage = 'record-exact-repair-replay-attempt';
  await privateJson(repairAttemptPath, {
    contractVersion: CONTRACT_VERSION,
    originalRepositoryHead: attempt.repositoryHead,
    repairRepositoryHead: context.repositoryHead,
    aiRunKeySha256: sha256(attempt.aiRunKey),
    operationId: attempt.operationId,
    jobSha256: attempt.jobSha256,
    dlqIdSha256: sha256(candidate.dlqId),
    errorCode: candidate.errorCode,
    redriveReference,
    deployedVersionSha256: sha256(deployedVersion),
    attemptedAt: new Date().toISOString(),
    maximumRepairQueueReplayCount: 1,
    blindReplayAllowedAfterThisFile: false,
  });
  repairAttemptRecorded = true;

  stage = 'replay-exact-retained-queue-payload-once';
  await sendQueueOnce(context, candidate.replayPayload);
  repairQueueReplayCount = 1;
  stage = 'poll-repaired-delivery-sent-and-mirrored';
  const delivered = await pollDelivered(context, attempt.aiRunKey, beforeD1);
  stage = 'verify-repaired-lark-mirror';
  const afterLark = await readLarkSendState(context, attempt.aiRunKey, true);
  if (afterLark.totalSentNotificationLogRows !== beforeLark.totalSentNotificationLogRows + 1) fail(
    'Repaired Notification Lark log count did not increase exactly once',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_LARK_PARITY_FAILED',
  );
  stage = 'bounded-no-additional-replay-observation';
  await sleep(readObservationMs(context.env));
  const observed = readD1State(context, attempt.aiRunKey);
  const stability = assertLarkWeekly7dNotificationAdmissionStable(delivered, observed);
  const observedLark = await readLarkSendState(context, attempt.aiRunKey, true);
  if (JSON.stringify(afterLark) !== JSON.stringify(observedLark)) fail(
    'Repaired Notification Lark state changed during no-replay observation',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_LARK_STABILITY_FAILED',
  );

  stage = 'close-exact-retained-terminal-incident';
  const closeoutAt = Date.now();
  executeD1Mutation(context, buildLarkWeekly7dFullChannelRepairCompleteSql(candidate, {
    now: closeoutAt,
    redriveReference,
  }));
  executeD1Mutation(context, buildLarkWeekly7dFullChannelRepairResolveAlertSql(candidate, {
    now: closeoutAt,
  }));
  const closed = loadRepairCandidate(context, attempt, ['redriven']);
  if (closed.dlqId !== candidate.dlqId || closed.openAlertCount !== 0) fail(
    'Exact retained Notification terminal incident did not close after verified delivery',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_CLOSEOUT_FAILED',
  );

  const result = Object.freeze({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    action: 'repair',
    stage: 'complete',
    status: 'weekly_7d_full_channel_notification_exact_delivery_repaired',
    repository,
    originalFailureCode: candidate.errorCode,
    originalDlqIdSha256: sha256(candidate.dlqId),
    workerDeploymentCount: 1,
    repairQueueReplayCount: 1,
    queueAdmissionCountNewIdentity: 0,
    newNotificationIdentityCount: 0,
    messageSendCount: 1,
    deliveryStatus: delivered.admissionDeliveryStatus,
    mirrorStatus: delivered.admissionMirrorStatus,
    sentToGroup: afterLark.sentToGroup,
    exactDeliveryRows: stability.exactDeliveryRows,
    duplicateDeliveryRows: stability.duplicateDeliveryRows,
    additionalMessageSendCountDuringObservation: stability.additionalMessageSendCountDuringObservation,
    retainedDeadLetterStatus: closed.status,
    retainedAlertOpenCount: closed.openAlertCount,
    automaticProducer: false,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });
  await privateJson(join(evidenceDir, 'full-channel-notification-summary.json'), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function recoverRepair() {
  const context = await prepare('repair-recover');
  requireConfirmation(context.env, REPAIR_RECOVERY_CONFIRMATION, 'repair recovery');
  stage = 'revalidate-full-channel-authority-read-only';
  const preview = runFullChannelPreview(context);
  const evidenceDir = resolveEvidenceDir(preview);
  const attempt = JSON.parse(await readFile(join(evidenceDir, '03-queue-send.attempt.json'), 'utf8'));
  const repairAttempt = JSON.parse(await readFile(
    join(evidenceDir, '04-runtime-repair-queue-replay.attempt.json'),
    'utf8',
  ));
  validateOriginalAttempt(context, preview, attempt);
  repairAttemptRecorded = true;
  stage = 'poll-existing-repair-delivery-without-replay';
  const current = readD1State(context, attempt.aiRunKey);
  if (current.admissionDeliveryRows === 0) fail(
    'Repair recovery found no retained D1 delivery; exact Queue replay was already attempted and cannot be repeated blindly',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_RECOVERY_DELIVERY_MISSING',
    { originalFailureCode: repairAttempt.errorCode },
  );
  const syntheticBefore = Object.freeze({
    ...current,
    totalDeliveryRows: current.totalDeliveryRows - 1,
    sentMirroredRows: Math.max(0, current.sentMirroredRows - (
      current.admissionDeliveryStatus === 'sent' && current.admissionMirrorStatus === 'mirrored' ? 1 : 0
    )),
    unsafeDeliveryRows: 0,
    admissionDeliveryRows: 0,
    admissionDeliveryStatus: null,
    admissionMirrorStatus: null,
    admissionClaimCount: 0,
    admissionSentAt: null,
    admissionMessageIdHash: null,
  });
  const delivered = await pollDelivered(context, attempt.aiRunKey, syntheticBefore);
  const lark = await readLarkSendState(context, attempt.aiRunKey, true);
  await sleep(readObservationMs(context.env));
  const stability = assertLarkWeekly7dNotificationAdmissionStable(
    delivered,
    readD1State(context, attempt.aiRunKey),
  );
  const candidate = loadRepairCandidate(context, attempt, ['redrive_pending', 'redriven']);
  if (candidate.status === 'redrive_pending') {
    stage = 'close-recovered-exact-retained-terminal-incident';
    const closeoutAt = Date.now();
    executeD1Mutation(context, buildLarkWeekly7dFullChannelRepairCompleteSql(candidate, {
      now: closeoutAt,
      redriveReference: repairAttempt.redriveReference,
    }));
    executeD1Mutation(context, buildLarkWeekly7dFullChannelRepairResolveAlertSql(candidate, {
      now: closeoutAt,
    }));
  }
  const closed = loadRepairCandidate(context, attempt, ['redriven']);
  const result = Object.freeze({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    action: 'repair-recover',
    mode: 'POLL_ONLY_REPAIR_RECOVERY',
    stage: 'complete',
    status: 'weekly_7d_full_channel_notification_repair_recovered_without_replay',
    repository,
    workerDeploymentCount: 0,
    repairQueueReplayCount: 0,
    newNotificationIdentityCount: 0,
    messageSendCountByRecovery: 0,
    deliveryStatus: delivered.admissionDeliveryStatus,
    mirrorStatus: delivered.admissionMirrorStatus,
    sentToGroup: lark.sentToGroup,
    duplicateDeliveryRows: stability.duplicateDeliveryRows,
    retainedDeadLetterStatus: closed.status,
    retainedAlertOpenCount: closed.openAlertCount,
    automaticProducer: false,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });
  await privateJson(join(evidenceDir, 'full-channel-notification-summary.json'), result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function prepare(mode) {
  stage = 'load-local-environment';
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  exact(env.MKT_ENV, 'development', 'MKT_ENV');
  exact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  exact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');
  stage = 'repository-preflight';
  const repositoryHead = exactMainHead();
  repository = Object.freeze({ branch: 'main', head: repositoryHead, originMain: repositoryHead, clean: true });

  stage = 'local-focused-gates';
  if (mode !== 'repair-recover') {
    run('node', ['--test',
      'tests/scripts/lark-weekly-7d-full-channel-notification-safe-terminal-source.test.mjs',
      'tests/application/lark-weekly-7d-full-channel-delivery-repair.test.js',
    ], { stdio: 'inherit' });
  }

  stage = 'resolve-lark-and-cloudflare-authority';
  const client = createLarkBitableClientFromEnv(Object.freeze({
    ...env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_MAX_PAGES: '5',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  }));
  const tableIds = resolveLarkNotificationControlledUatTables(await client.listTables());
  const larkRepository = new LarkRecordRepository({ client });
  const sourceText = await readFile(SOURCE_CONFIG, 'utf8');
  const sourceConfig = parseJsoncObject(sourceText);
  const activeConfig = buildLarkNotificationRuntimeActivationWranglerConfig(
    sourceText,
    tableIds,
    { active: true },
  );
  if (!activeConfig.scheduleConfigPreserved || activeConfig.runtimeMode !== 'runtime') fail(
    'Safe Full-channel terminal could not preserve Worker trigger configuration while enabling runtime',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_RUNTIME_CONFIG_INVALID',
  );
  const generatedDir = resolve(OUTPUT_ROOT, '.safe-terminal-generated');
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
  return Object.freeze({
    env,
    mode,
    repositoryHead,
    client,
    tableIds,
    larkRepository,
    sourceText,
    sourceConfig,
    activeConfigPath,
    cloudflare,
    databaseName,
    queueName,
    queueId,
  });
}

function runFullChannelPreview(context) {
  const result = run('node', ['scripts/lark-weekly-7d-full-channel-notification.mjs', '--preview'], {
    env: runtimeEnv(context),
  });
  const parsed = parseLastJson(result.stdout);
  if (parsed?.ok !== true
      || parsed?.status !== 'weekly_7d_full_channel_notification_preview_passed'
      || parsed?.synthesisQualityGatePassed !== true
      || parsed?.queueAdmissionCount !== 0
      || parsed?.messageSendCount !== 0) fail(
    'Safe terminal requires the exact passed read-only Full-channel preview',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_PREVIEW_INVALID',
  );
  return parsed;
}

function runtimeEnv(context) {
  return {
    DEV_VARS_FILE: process.env.DEV_VARS_FILE ?? '.dev.vars',
    MKT_LARK_WEEKLY_7D_NOTIFICATION_WRANGLER_CONFIG: SOURCE_CONFIG,
    MKT_LARK_WEEKLY_7D_FULL_CHANNEL_EVIDENCE_ROOT: OUTPUT_ROOT,
  };
}

function resolveEvidenceDir(preview) {
  const hash = requireHash(preview.correctedAiRunKeySha256, 'correctedAiRunKeySha256');
  return resolve(OUTPUT_ROOT, hash);
}

function validateOriginalAttempt(context, preview, attempt) {
  if (attempt?.contractVersion !== 'lark_weekly_7d_full_channel_notification_terminal_v2'
      || requireHash(attempt.aiRunKeySha256, 'attempt.aiRunKeySha256') !== preview.correctedAiRunKeySha256
      || sha256(requireText(attempt.aiRunKey, 'attempt.aiRunKey')) !== preview.correctedAiRunKeySha256
      || requireHash(attempt.synthesisAiRunKeySha256, 'attempt.synthesisAiRunKeySha256') !== preview.synthesisAiRunKeySha256
      || requireHash(attempt.factualReportSha256, 'attempt.factualReportSha256') !== preview.factualReportSha256
      || !isAncestor(requireCommitSha(attempt.repositoryHead, 'attempt.repositoryHead'), context.repositoryHead)) fail(
    'Retained Full-channel Queue-attempt evidence is not an ancestor-bound match for current authority',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_EVIDENCE_INVALID',
  );
  requireText(attempt.operationId, 'attempt.operationId');
  requireHash(attempt.jobSha256, 'attempt.jobSha256');
}

function loadRepairCandidate(context, attempt, allowedStatuses) {
  const rows = executeD1Read(context, buildLarkWeekly7dFullChannelRepairDeadLetterSql());
  return selectLarkWeekly7dFullChannelRepairCandidate(rows, {
    aiRunKey: attempt.aiRunKey,
    operationId: attempt.operationId,
    jobSha256: attempt.jobSha256,
    allowedStatuses,
  });
}

function assertRepairDeliveryRequest(request, aiRunKey) {
  if (request.aiRun.aiRunKey !== aiRunKey
      || request.aiRun.generationStatus !== 'generated'
      || request.aiRun.notificationEligible !== true
      || request.aiRun.previewMode !== false
      || request.aiRun.sentToGroup !== false
      || request.settings.enabled !== true
      || request.settings.aiEnabled !== true
      || request.settings.notificationEnabled !== true
      || request.settings.destinationKeyHash !== LARK_EXECUTIVE_DESTINATION_KEY_HASH) fail(
    'Exact retained Notification delivery request is no longer safely replayable',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_DELIVERY_CHAIN_INVALID',
  );
}

function readD1State(context, aiRunKey) {
  const rows = executeD1Read(context, buildLarkWeekly7dNotificationAdmissionReadbackSql(aiRunKey));
  return normalizeLarkWeekly7dNotificationAdmissionReadback(rows[0]);
}

function executeD1Read(context, sql) {
  const output = text('npx', [
    'wrangler', 'd1', 'execute', context.databaseName,
    '--remote', '--config', SOURCE_CONFIG,
    '--command', sql,
    '--json',
  ], { env: context.cloudflare.wranglerEnv });
  return extractLarkNotificationWranglerD1Rows(output);
}

function executeD1Mutation(context, sql) {
  run('npx', [
    'wrangler', 'd1', 'execute', context.databaseName,
    '--remote', '--config', SOURCE_CONFIG,
    '--command', sql,
    '--json',
  ], { env: context.cloudflare.wranglerEnv });
}

async function pollDelivered(context, aiRunKey, before) {
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
    last = readD1State(context, aiRunKey);
    process.stdout.write(`${JSON.stringify({
      event: 'lark_weekly_7d_full_channel_repair_progress',
      poll: index,
      admissionDeliveryRows: last.admissionDeliveryRows,
      admissionDeliveryStatus: last.admissionDeliveryStatus,
      admissionMirrorStatus: last.admissionMirrorStatus,
    })}\n`);
    try {
      return assertLarkWeekly7dNotificationAdmissionDelivered(before, last);
    } catch (error) {
      if (error?.code !== 'LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_NOT_CONFIRMED') throw error;
    }
    if (index < maxPolls) await sleep(interval);
  }
  fail(
    'Exact repaired Full-channel Notification delivery verification timed out',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_VERIFY_TIMEOUT',
    {
      admissionDeliveryRows: last?.admissionDeliveryRows ?? null,
      admissionDeliveryStatus: last?.admissionDeliveryStatus ?? null,
      admissionMirrorStatus: last?.admissionMirrorStatus ?? null,
      blindReplayAllowed: false,
    },
  );
}

async function readLarkSendState(context, aiRunKey, expectSent) {
  const [sentRows, aiRows, logRows] = await Promise.all([
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'attempt_status', ['sent']),
    context.larkRepository.listByFieldValues(context.tableIds.aiRuns, 'ai_run_key', [aiRunKey]),
    context.larkRepository.listByFieldValues(context.tableIds.notificationLog, 'ai_run_key', [aiRunKey]),
  ]);
  const ai = aiRows.filter((row) => String(readScalar(row?.fields?.ai_run_key) ?? '') === aiRunKey);
  const logs = logRows.filter((row) => String(readScalar(row?.fields?.ai_run_key) ?? '') === aiRunKey);
  if (ai.length !== 1
      || logs.length !== (expectSent ? 1 : 0)
      || readBoolean(ai[0].fields.sent_to_group) !== expectSent
      || (expectSent && String(readScalar(logs[0]?.fields?.attempt_status) ?? '') !== 'sent')) fail(
    'Exact retained Notification Lark mirror state is invalid',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_LARK_PARITY_FAILED',
    { aiRows: ai.length, logRows: logs.length, expectSent },
  );
  return Object.freeze({
    totalSentNotificationLogRows: sentRows.length,
    sentToGroup: expectSent,
    exactAiRows: 1,
    exactNotificationLogRows: logs.length,
  });
}

async function sendQueueOnce(context, replayPayload) {
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(context.cloudflare.accountId)}`
      + `/queues/${encodeURIComponent(context.queueId)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${freshQueueBearer(context.cloudflare)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: replayPayload, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) fail(
    'Cloudflare Queue did not confirm exact retained Notification replay',
    'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_QUEUE_REPLAY_FAILED',
    { status: response.status },
  );
}

function dryRunRuntime(context) {
  run('npx', ['wrangler', 'deploy', '--dry-run', '--config', context.activeConfigPath], {
    env: context.cloudflare.wranglerEnv,
    stdio: 'inherit',
  });
}

async function deployAndVerifyCurrentRuntime(context) {
  const outputPath = resolve(
    OUTPUT_ROOT,
    `.wrangler-full-channel-safe-runtime-${randomUUID()}.ndjson`,
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
  if (verified.trafficPercentage !== 100) fail(
    'Current-main Notification Runtime is not serving 100 percent of traffic',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_RUNTIME_DEPLOYMENT_INVALID',
  );
  return verified;
}

async function writeGeneratedConfig(path, configText) {
  const rebased = rebaseGeneratedWranglerConfigPaths(configText, {
    sourceDirectory: dirname(SOURCE_CONFIG),
    outputDirectory: dirname(path),
  });
  await writeFile(path, rebased.text, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
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
  if (auth.type !== cloudflare.authType) fail(
    'Cloudflare authentication type changed during Safe Full-channel terminal',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_AUTH_DRIFT',
  );
  return auth.token;
}

function resolveDatabaseName(config) {
  const matches = Array.isArray(config?.d1_databases)
    ? config.d1_databases.filter((item) => item?.binding === 'MKT_STATE_DB')
    : [];
  if (matches.length !== 1) fail(
    'Safe Full-channel terminal requires one MKT_STATE_DB binding',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_CONFIG_INVALID',
  );
  return requireText(matches[0].database_name, 'database_name');
}

function resolveQueueName(config) {
  const matches = Array.isArray(config?.queues?.producers)
    ? config.queues.producers.filter((item) => item?.binding === 'MKT_SYNC_QUEUE')
    : [];
  if (matches.length !== 1) fail(
    'Safe Full-channel terminal requires one MKT_SYNC_QUEUE producer',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_CONFIG_INVALID',
  );
  return requireText(matches[0].queue, 'queue');
}

function assertSamePreviewIdentity(before, after) {
  const fields = [
    'synthesisAiRunKeySha256',
    'factualReportSha256',
    'correctedAiRunKeySha256',
    'messageBytes',
    'messagePreview',
  ];
  const drift = fields.filter((field) => before?.[field] !== after?.[field]);
  if (drift.length > 0) fail(
    'Full-channel read-only preview drifted across Runtime refresh',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_PREVIEW_DRIFT',
    { drift },
  );
}

function exactMainHead() {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const branch = text('git', ['branch', '--show-current'], { raw: true }).trim();
  const head = text('git', ['rev-parse', 'HEAD']);
  const originMain = text('git', ['rev-parse', 'origin/main']);
  const dirty = text('git', ['status', '--porcelain', '--untracked-files=all'], { raw: true }).trim();
  if (branch !== 'main' || head !== originMain || dirty) fail(
    'Safe Full-channel terminal requires clean exact current main',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_REPOSITORY_INVALID',
    { branch, head, originMain, dirtyPathCount: dirty ? dirty.split(/\r?\n/u).length : 0 },
  );
  return head;
}

function isAncestor(ancestor, head) {
  const result = spawnSync('git', ['merge-base', '--is-ancestor', ancestor, head], {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  return result.status === 0;
}

function parseArgs(args) {
  const allowed = ['--execute', '--repair', '--repair-recover'];
  const modes = allowed.filter((mode) => args.includes(mode));
  const unknown = args.filter((arg) => !allowed.includes(arg));
  if (unknown.length > 0 || modes.length > 1) fail(
    'Safe Full-channel terminal accepts one of --execute, --repair, --repair-recover',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_ARGUMENT_INVALID',
    { unknown },
  );
  if (modes[0] === '--execute') return 'execute';
  if (modes[0] === '--repair') return 'repair';
  if (modes[0] === '--repair-recover') return 'repair-recover';
  return 'plan';
}

function requireConfirmation(env, confirmation, label) {
  if (env?.[confirmation.envName] !== confirmation.value) fail(
    `${label} requires ${confirmation.envName}=${confirmation.value}`,
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_CONFIRMATION_REQUIRED',
    { envName: confirmation.envName },
  );
}

function parseLastJson(output) {
  const source = String(output ?? '').trim();
  for (let index = source.lastIndexOf('{'); index >= 0; index = source.lastIndexOf('{', index - 1)) {
    try { return JSON.parse(source.slice(index)); } catch { /* continue */ }
  }
  fail(
    'Could not parse Full-channel preview JSON',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_PREVIEW_PARSE_FAILED',
  );
}

async function assertNoFile(path, failIfExists) {
  try {
    await stat(path);
    if (failIfExists) fail(
      'Retained evidence already exists; blind replay is forbidden',
      'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_ALREADY_ATTEMPTED',
      { evidenceName: path.split('/').pop() },
    );
    return false;
  } catch (error) {
    if (error?.code === 'ENOENT') return true;
    throw error;
  }
}

async function requireFile(path, message) {
  try { await stat(path); } catch (error) {
    if (error?.code === 'ENOENT') fail(
      message,
      'LARK_WEEKLY_7D_FULL_CHANNEL_REPAIR_EVIDENCE_MISSING',
      { evidenceName: path.split('/').pop() },
    );
    throw error;
  }
}

async function privateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
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
  if (result.status !== 0) fail(
    `Command failed: ${command}`,
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_COMMAND_FAILED',
    { command, status: result.status },
  );
  return Object.freeze({ stdout: result.stdout?.trim() ?? '', stderr: result.stderr?.trim() ?? '' });
}

function text(command, args, options = {}) { return run(command, args, options).stdout; }
function readObservationMs(env) {
  const value = Number(env.MKT_LARK_WEEKLY_7D_NOTIFICATION_OBSERVATION_MS ?? OBSERVATION_MS);
  if (!Number.isSafeInteger(value) || value < 10_000 || value > 120_000) fail(
    'Observation must be 10-120 seconds',
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_INPUT_INVALID',
  );
  return value;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail(
    `${label} must be positive integer`,
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_INPUT_INVALID',
  );
  return number;
}
function exact(value, expected, label) {
  if (value !== expected) fail(
    `Safe Full-channel terminal requires ${label}=${expected}`,
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_ENVIRONMENT_INVALID',
    { label },
  );
}
function readBoolean(value) {
  const scalar = readScalar(value);
  if (scalar === true || scalar === false) return scalar;
  if (scalar === 1 || scalar === '1' || String(scalar).toLowerCase() === 'true') return true;
  if (scalar === 0 || scalar === '0' || String(scalar).toLowerCase() === 'false') return false;
  return null;
}
function readScalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return value.length === 1 ? readScalar(value[0]) : value.map(readScalar).join('');
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) if (value[key] !== undefined) return readScalar(value[key]);
  }
  return value;
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const textValue = String(value).trim();
  return textValue || null;
}
function requireText(value, label) {
  const textValue = optionalText(value);
  if (!textValue) fail(`${label} is required`, 'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_INPUT_INVALID', { label });
  return textValue;
}
function requireHash(value, label) {
  const textValue = requireText(value, label);
  if (!/^[a-f0-9]{64}$/u.test(textValue)) fail(
    `${label} must be SHA-256`,
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_INPUT_INVALID',
    { label },
  );
  return textValue;
}
function requireCommitSha(value, label) {
  const textValue = requireText(value, label);
  if (!/^[a-f0-9]{40}$/u.test(textValue)) fail(
    `${label} must be Git SHA-1`,
    'LARK_WEEKLY_7D_FULL_CHANNEL_SAFE_INPUT_INVALID',
    { label },
  );
  return textValue;
}
function sanitize(value) { return String(value).replace(/[\r\n\t]+/gu, ' ').slice(0, 500); }
function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitize(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    /(?:token|secret|password|authorization|tableId|queueId|accountId|groupId|replayPayload)/iu.test(key)
      ? `${key}Redacted`
      : key,
    /(?:token|secret|password|authorization|tableId|queueId|accountId|groupId|replayPayload)/iu.test(key)
      ? true
      : scrub(nested),
  ]));
}
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function fail(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dFullChannelNotificationSafeTerminalError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}
function sleep(milliseconds) { return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds)); }
