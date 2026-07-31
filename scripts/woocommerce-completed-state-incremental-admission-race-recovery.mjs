#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { readDevVars } from './lib/dev-vars.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import {
  buildWooCommerceConfigWindows,
  buildWooCommerceFinalJob,
  buildWooCommerceFinalSnapshotSql,
  compareWooCommerceParity,
  listWooCommerceTableBindings,
} from './lib/woocommerce-final-rollout-operator.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import {
  assertWooCommerce2026RemoteSafeFlags,
  collectEnabledMktFlags,
  selectExactlyOneActiveWorkerVersion,
} from './lib/woocommerce-2026-completion-one-command.js';
import { assertWooCommerceQueueConsumerTopology } from './lib/woocommerce-queue-consumer-topology.js';
import { bootstrapWooCommerceFinalQueueId } from './lib/woocommerce-final-queue-bootstrap.js';
import {
  WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONTRACT_VERSION,
  WOOCOMMERCE_COMPLETED_STATE_HISTORY_START,
  WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
  classifyWooCommerceCompletedStatePoll,
  sanitizeWooCommerceCompletedStateEvidence,
  selectWooCommerceCompletedState,
  validateWooCommerceCompletedStateLarkTables,
  validateWooCommerceCompletedStateRemotePreflight,
} from './lib/woocommerce-final-completed-state-closeout.js';
import {
  WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONFIRMATION,
  WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONTRACT_VERSION,
  WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_SOURCE_HEAD,
  assertWooCommerceIncrementalAdmissionRaceRecoveryConfirmation,
  buildWooCommerceIncrementalAdmissionRaceClosureSql,
  buildWooCommerceIncrementalAdmissionRaceStateSql,
  fingerprintWooCommerceIncrementalAdmissionRaceValue,
  parseWooCommerceIncrementalAdmissionRaceRecoveryArgs,
  sanitizeWooCommerceIncrementalAdmissionRaceEvidence,
  validateWooCommerceIncrementalAdmissionRaceIncident,
  validateWooCommerceIncrementalAdmissionRaceRecovered,
} from './lib/woocommerce-completed-state-incremental-admission-race-recovery.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_WOOCOMMERCE_COMPLETED_STATE_EVIDENCE_DIR
    ?? 'outputs/woocommerce-completed-state-closeout-v1',
);
const sourceEvidenceRoot = join(
  dirname(outputRoot),
  WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_SOURCE_HEAD,
);
const REQUIRED_SECRET_NAMES = Object.freeze([
  'WOOCOMMERCE_CONSUMER_KEY',
  'WOOCOMMERCE_CONSUMER_SECRET',
  'LARK_APP_SECRET',
]);
const VERIFY_INTERVAL_MS = 5_000;
const VERIFY_MAX_POLLS = 2_160;
const D1_READ_DELAYS_MS = Object.freeze([0, 1_000, 2_000, 5_000, 10_000]);
let target = null;
let latestSafeConfig = null;
let currentStage = 'init';

try {
  const options = parseWooCommerceIncrementalAdmissionRaceRecoveryArgs(
    process.argv.slice(2),
  );
  if (!options.execute) printPlan();
  else await executeRecovery();
} catch (error) {
  let automaticSafeRestore = null;
  if (latestSafeConfig && target) {
    try {
      automaticSafeRestore = await deployAndVerify(
        latestSafeConfig,
        [],
        'incremental-race-automatic-safe-restore',
      );
    } catch (restoreError) {
      automaticSafeRestore = Object.freeze({
        ok: false,
        code: restoreError?.code ?? 'WOOCOMMERCE_INCREMENTAL_RACE_RESTORE_FAILED',
        message: restoreError instanceof Error ? restoreError.message : String(restoreError),
      });
    }
  }
  process.stderr.write(`${JSON.stringify({
    ok: false,
    stage: currentStage,
    code: error?.code ?? 'WOOCOMMERCE_INCREMENTAL_RACE_RECOVERY_FAILED',
    message: error instanceof Error ? error.message : String(error),
    details: sanitizeWooCommerceIncrementalAdmissionRaceEvidence(error?.details ?? {}),
    automaticSafeRestore,
    metaExecutionCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONTRACT_VERSION,
    sourceEvidenceHead: WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_SOURCE_HEAD,
    requiredEntry:
      'scripts/woocommerce-completed-state-incremental-admission-race-recovery-launcher.mjs',
    confirmation: {
      envName: 'CONFIRM_WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY',
      value: WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONFIRMATION,
    },
    sequence: [
      'exact-source-evidence-admission',
      'read-only-remote-incident-admission',
      'fresh-d1-backup',
      'temporary-woo-uat-window',
      'same-incremental-operation-recovery-send-or-verify',
      'incremental-completion-and-d1-lark-parity',
      'exact-dlq-metadata-closeout',
      'automatic-all-false-safe-restore',
      'final-zero-active-verification',
    ],
    safety: {
      replacementIncrementalOperation: false,
      replacementFullOperation: false,
      blindQueueResend: false,
      businessFactDelete: false,
      directBusinessMutation: false,
      metadataMutationOnlyAfterCompletion: true,
      scheduleEnabled: false,
      metaStarted: false,
      production: false,
      remoteActionsPerformed: false,
    },
  }, null, 2)}\n`);
}

async function executeRecovery() {
  const env = {
    ...await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars'),
    ...process.env,
  };
  assertWooCommerceIncrementalAdmissionRaceRecoveryConfirmation(env);
  requireExact(
    env.MKT_WOOCOMMERCE_INCREMENTAL_RACE_PUBLIC_LAUNCHER,
    '1',
    'MKT_WOOCOMMERCE_INCREMENTAL_RACE_PUBLIC_LAUNCHER',
  );
  requireExact(env.MKT_ENV, 'development', 'MKT_ENV');
  requireExact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  requireExact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  currentStage = 'repository-and-local-verification';
  await assertRepositoryState();
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await runLocalVerification();
  await assertRepositoryState();

  const repositoryHead = await gitText(['rev-parse', 'HEAD']);
  assertEvidenceHeadBinding(repositoryHead);
  const sourceEvidence = await readAndValidateSourceEvidence();

  const configPath = resolveRepositoryFile(
    env.MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
  );
  const configText = await readFile(configPath, 'utf8');
  const parsedConfig = parseJsoncObject(configText);
  const runtimeConfig = Object.freeze({ ...(parsedConfig.vars ?? {}), ...env });
  const databaseName = env.MKT_WOOCOMMERCE_ROLLOUT_DATABASE_NAME
    ?? 'social-mkt-state-dev';
  const workerName = env.MKT_WOOCOMMERCE_ROLLOUT_WORKER_NAME
    ?? 'social-mkt-sync-worker';
  const mainQueueName = env.MKT_MAIN_QUEUE_NAME ?? 'social-mkt-sync-jobs';
  const dlqName = env.MKT_DLQ_QUEUE_NAME ?? 'social-mkt-sync-dlq';

  const queueBootstrapEnv = {
    ...env,
    MKT_WOOCOMMERCE_ROLLOUT_WRANGLER_CONFIG: configPath,
    MKT_MAIN_QUEUE_NAME: mainQueueName,
  };
  delete queueBootstrapEnv.MKT_WOOCOMMERCE_FINAL_QUEUE_ID;
  const queueBootstrap = await bootstrapWooCommerceFinalQueueId({
    env: queueBootstrapEnv,
    repositoryRoot,
  });
  if (queueBootstrap.source !== 'cloudflare_queue_rest') {
    throw recoveryError(
      'WooCommerce Incremental race recovery Queue must be resolved by exact-name REST discovery',
      'WOOCOMMERCE_INCREMENTAL_RACE_QUEUE_DISCOVERY_INVALID',
      { source: queueBootstrap.source ?? null },
    );
  }

  const baseWranglerEnv = compactCloudflareEnv(env);
  const whoamiOutput = await wranglerText(['whoami', '--json'], {
    env: baseWranglerEnv,
  });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    configText,
    whoamiOutput,
    preferredAccount: env.MKT_WOOCOMMERCE_ROLLOUT_ACCOUNT,
  });
  const selectedEnv = Object.freeze({
    ...baseWranglerEnv,
    CLOUDFLARE_ACCOUNT_ID: accountId,
  });
  await wranglerText(['whoami', '--account', accountId, '--json'], {
    env: selectedEnv,
  });
  const auth = resolveCloudflareBearerAuth({
    explicitApiToken: env.CLOUDFLARE_API_TOKEN,
    authOutput: optionalText(env.CLOUDFLARE_API_TOKEN)
      ? null
      : await wranglerText(['auth', 'token', '--json'], { env: selectedEnv }),
  });
  const authenticatedEnv = Object.freeze({
    ...selectedEnv,
    CLOUDFLARE_API_TOKEN: auth.token,
  });

  target = Object.freeze({
    env: authenticatedEnv,
    runtimeConfig,
    configPath,
    configText,
    databaseName,
    workerName,
    mainQueueName,
    dlqName,
    accountId,
    queueId: queueBootstrap.queueId,
    repositoryHead,
    accountKey: 'chemistry_k',
    orderHistoryStart: Date.parse(WOOCOMMERCE_COMPLETED_STATE_HISTORY_START),
  });

  currentStage = 'read-only-remote-incident-admission';
  const readiness = await readRemoteReadiness();
  validateWooCommerceCompletedStateRemotePreflight(readiness.state);
  const safeBefore = assertWooCommerce2026RemoteSafeFlags(readiness.versionView);
  const missingSecrets = REQUIRED_SECRET_NAMES.filter(
    (name) => !readiness.secretNames.includes(name),
  );
  if (missingSecrets.length > 0) {
    throw recoveryError(
      'WooCommerce Incremental race recovery is missing required Worker Secret names',
      'WOOCOMMERCE_INCREMENTAL_RACE_SECRET_MISSING',
      { missingSecrets },
    );
  }

  const fullBefore = selectWooCommerceCompletedState({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: await readSnapshot(WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID),
    fullReconciliation: true,
    requireCurrentSourceParity: false,
  });
  requireExact(
    fullBefore.completionFingerprint,
    sourceEvidence.fullCompletionFingerprint,
    'fullCompletionFingerprint',
  );

  const incident = validateWooCommerceIncrementalAdmissionRaceIncident({
    operationId: sourceEvidence.operation.operationId,
    requestedAt: sourceEvidence.operation.requestedAt,
    state: await readIncidentState(sourceEvidence.operation.operationId),
  });
  const lark = createLarkBitableClientFromEnv(env);
  const tableIds = validateWooCommerceCompletedStateLarkTables({
    env: runtimeConfig,
    liveTables: await lark.listTables(),
  });
  await writeEvidence('01-incremental-race-preflight', {
    repositoryHead,
    sourceEvidenceHead: WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_SOURCE_HEAD,
    fullCompletionFingerprint: fullBefore.completionFingerprint,
    incidentAccepted: incident.accepted,
    workerAllFalse: safeBefore.allFalse,
    activeWorkerVersion: readiness.activeVersion,
    queueDiscoverySource: queueBootstrap.source,
    remoteMutationCount: 0,
  });

  const windows = buildWooCommerceConfigWindows({ configText, tableIds });
  assertExactFlags(windows.safeTrueFlags, []);
  assertExactFlags(windows.uatTrueFlags, [
    'MKT_CONNECTOR_WOOCOMMERCE_ENABLED',
    'MKT_WOOCOMMERCE_D1_WRITE_ENABLED',
    'MKT_WOOCOMMERCE_FULL_RECONCILIATION_ENABLED',
    'MKT_WOOCOMMERCE_LARK_WRITE_ENABLED',
  ]);
  assertExactFlags(windows.closeoutTrueFlags, []);

  currentStage = 'fresh-d1-backup';
  const backup = await backupD1();
  await writeEvidence('02-incremental-race-d1-backup', backup);
  latestSafeConfig = windows.safe;

  currentStage = 'temporary-woo-uat-window';
  const uatDeployment = await deployAndVerify(
    windows.uat,
    windows.uatTrueFlags,
    'incremental-race-recovery-uat',
  );
  await writeEvidence('03-incremental-race-uat-deployment', uatDeployment);

  currentStage = 'same-incremental-operation-recovery-send-or-verify';
  const send = await sendOrReuseExactRecoveryAttempt(sourceEvidence);

  currentStage = 'incremental-completion-and-d1-lark-parity';
  const completed = await pollCompletedState({
    operationId: sourceEvidence.operation.operationId,
    fullReconciliation: false,
    requireCurrentSourceParity: false,
    minimumQueueAttempts: 2,
  });
  const parity = await verifyParity(lark, tableIds, completed.snapshot.counts);
  await bridgeReplayCheckpoint(sourceEvidence, fullBefore, lark, tableIds);
  await writeEvidence('06-incremental-uat', {
    accepted: true,
    repositoryHead,
    operationId: sourceEvidence.operation.operationId,
    requestedAt: sourceEvidence.operation.requestedAt,
    modifiedAfter: sourceEvidence.operation.modifiedAfter,
    minimumQueueAttempts: 2,
    completionFingerprint: completed.completionFingerprint,
    recoveredFromAdmissionRace: true,
    recoveryQueueEvidenceReused: send.reusedEvidence,
    parity,
  });

  currentStage = 'exact-dlq-metadata-closeout';
  const recoveryReference = `woocommerce-incremental-race:${repositoryHead}`;
  const completedAt = Date.now();
  await executeD1Mutation(buildWooCommerceIncrementalAdmissionRaceClosureSql({
    operationId: sourceEvidence.operation.operationId,
    requestedAt: sourceEvidence.operation.requestedAt,
    completedAt,
    recoveryReference,
  }));
  const recoveredIncident = validateWooCommerceIncrementalAdmissionRaceRecovered({
    operationId: sourceEvidence.operation.operationId,
    requestedAt: sourceEvidence.operation.requestedAt,
    state: await readIncidentState(sourceEvidence.operation.operationId),
  });
  await writeEvidence('07-incremental-race-dlq-closeout', {
    accepted: recoveredIncident.accepted,
    queueAttempts: recoveredIncident.state.queueAttempts,
    recoveryStatus: recoveredIncident.state.recoveryStatus,
    terminalDlqStatus: recoveredIncident.state.terminalDlqStatus,
    metadataMutationCount: 2,
    businessMutationCount: 0,
  });

  currentStage = 'automatic-all-false-safe-restore';
  const safeCloseout = await deployAndVerify(
    windows.closeout,
    windows.closeoutTrueFlags,
    'incremental-race-safe-closeout',
  );
  latestSafeConfig = null;
  await writeEvidence('08-incremental-race-safe-closeout', safeCloseout);

  currentStage = 'final-zero-active-verification';
  const finalReadiness = await readRemoteReadiness();
  const finalRemote = validateWooCommerceCompletedStateRemotePreflight(
    finalReadiness.state,
  );
  const finalSafe = assertWooCommerce2026RemoteSafeFlags(finalReadiness.versionView);
  const finalFull = selectWooCommerceCompletedState({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: await readSnapshot(WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID),
    fullReconciliation: true,
    requireCurrentSourceParity: false,
  });
  requireExact(
    finalFull.completionFingerprint,
    sourceEvidence.fullCompletionFingerprint,
    'finalFullCompletionFingerprint',
  );

  currentStage = 'final-summary';
  const summary = Object.freeze({
    accepted: true,
    decision: 'WOOCOMMERCE_2026_COMPLETED_SAFE',
    closeoutDecision: 'WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE',
    recoveryDecision: 'WOO_INCREMENTAL_ADMISSION_RACE_RECOVERED_SAFE',
    contractVersion: WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONTRACT_VERSION,
    repositoryHead,
    sourceEvidenceHead: WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_SOURCE_HEAD,
    workerVersion: safeCloseout.activeVersion,
    d1Backup: backup,
    fullCompletionFingerprint: finalFull.completionFingerprint,
    sameIncrementalOperationRecovered: true,
    replacementIncrementalOperation: false,
    queueAttempts: recoveredIncident.state.queueAttempts,
    incrementalCompletionFingerprint: completed.completionFingerprint,
    parityVerified: true,
    exactDlqClosed: true,
    executionFlagsAllFalse: finalSafe.allFalse,
    scheduleEnabled: false,
    production: false,
    remote: finalRemote,
    safety: Object.freeze({
      replacementFullOperation: false,
      replacementIncrementalOperation: false,
      blindQueueResend: false,
      businessFactDelete: false,
      directBusinessMutation: false,
      exactMetadataMutationCount: 2,
      metaExecutionCount: 0,
    }),
    nextStep: 'resume_pinned_meta_finalizer',
  });
  await writeEvidence('09-incremental-race-summary', summary);
  await writePrivateJson(join(outputRoot, '11-summary.json'), summary);
  process.stdout.write(`${JSON.stringify({
    ok: true,
    ...summary,
    evidenceRoot: relative(repositoryRoot, outputRoot),
    WooCommerce: 'WOOCOMMERCE_2026_COMPLETED_SAFE',
    ExactCompletedStateCloseout: true,
    marker: 'WOO_EXACT_COMPLETED_STATE_CLOSED_SAFE',
    recoveryMarker: 'WOO_INCREMENTAL_ADMISSION_RACE_RECOVERED_SAFE',
  }, null, 2)}\n`);
}

async function readAndValidateSourceEvidence() {
  const preflight = await readSourceEvidenceData('01-completed-state-preflight');
  const replay = await readSourceEvidenceData('05-idempotent-replay');
  const operation = await readJsonIfExists(
    join(sourceEvidenceRoot, 'incremental-operation.json'),
  );
  if (!operation) {
    throw recoveryError(
      'WooCommerce Incremental race source operation evidence is missing',
      'WOOCOMMERCE_INCREMENTAL_RACE_SOURCE_EVIDENCE_MISSING',
    );
  }
  requireExact(
    operation.repositoryHead,
    WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_SOURCE_HEAD,
    'sourceOperation.repositoryHead',
  );
  const normalizedOperation = Object.freeze({
    operationId: requireIncrementalOperationId(operation.operationId),
    requestedAt: requireTimestamp(operation.requestedAt, 'sourceOperation.requestedAt'),
    modifiedAfter: requireTimestamp(operation.modifiedAfter, 'sourceOperation.modifiedAfter'),
    minimumQueueAttempts: requirePositiveInteger(
      operation.minimumQueueAttempts,
      'sourceOperation.minimumQueueAttempts',
    ),
  });
  requireExact(normalizedOperation.minimumQueueAttempts, 1, 'sourceOperation.minimumQueueAttempts');
  requireExact(
    preflight.operationId,
    WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    'sourcePreflight.operationId',
  );
  requireExact(
    replay.operationId,
    WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    'sourceReplay.operationId',
  );
  requireExact(replay.accepted, true, 'sourceReplay.accepted');
  requireExact(
    replay.completionFingerprint,
    preflight.completionFingerprint,
    'sourceReplay.completionFingerprint',
  );

  const job = buildWooCommerceFinalJob({
    operationId: normalizedOperation.operationId,
    requestedAt: normalizedOperation.requestedAt,
    trigger: 'manual_uat',
    fullReconciliation: false,
    modifiedAfter: normalizedOperation.modifiedAfter,
    orderCreatedAfter: Date.parse(WOOCOMMERCE_COMPLETED_STATE_HISTORY_START),
    orderCreatedBefore: normalizedOperation.requestedAt,
  });
  const queueEvidence = await findSourceQueueEvidence(normalizedOperation.operationId);
  requireExact(
    queueEvidence.repositoryHead,
    WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_SOURCE_HEAD,
    'sourceQueue.repositoryHead',
  );
  requireExact(queueEvidence.accepted, true, 'sourceQueue.accepted');
  requireExact(
    queueEvidence.attemptKey,
    `${normalizedOperation.operationId}:incremental-uat`,
    'sourceQueue.attemptKey',
  );
  requireExact(
    queueEvidence.operationId,
    normalizedOperation.operationId,
    'sourceQueue.operationId',
  );
  requireExact(
    Number(queueEvidence.minimumQueueAttempts),
    1,
    'sourceQueue.minimumQueueAttempts',
  );
  requireExact(
    queueEvidence.jobSha256,
    fingerprintWooCommerceIncrementalAdmissionRaceValue(job),
    'sourceQueue.jobSha256',
  );
  return Object.freeze({
    fullCompletionFingerprint: requireText(
      preflight.completionFingerprint,
      'sourcePreflight.completionFingerprint',
    ),
    replay,
    operation: normalizedOperation,
    queueEvidence,
    job,
  });
}

async function findSourceQueueEvidence(operationId) {
  const directory = join(sourceEvidenceRoot, 'queue-attempts');
  const files = await readdir(directory);
  const matches = [];
  for (const file of files.filter((name) => name.endsWith('.json'))) {
    const value = await readJsonIfExists(join(directory, file));
    if (value?.operationId === operationId
      && value?.attemptKey === `${operationId}:incremental-uat`) {
      matches.push(value);
    }
  }
  if (matches.length !== 1) {
    throw recoveryError(
      'WooCommerce Incremental race requires exactly one source Queue acceptance evidence file',
      'WOOCOMMERCE_INCREMENTAL_RACE_SOURCE_QUEUE_EVIDENCE_INVALID',
      { matchCount: matches.length },
    );
  }
  return matches[0];
}

async function sendOrReuseExactRecoveryAttempt(sourceEvidence) {
  const path = join(outputRoot, 'incremental-race-recovery-queue-attempt.json');
  const jobSha256 = fingerprintWooCommerceIncrementalAdmissionRaceValue(sourceEvidence.job);
  const existing = await readJsonIfExists(path);
  if (existing) {
    requireExact(existing.repositoryHead, target.repositoryHead, 'recoveryAttempt.repositoryHead');
    requireExact(existing.operationId, sourceEvidence.operation.operationId, 'recoveryAttempt.operationId');
    requireExact(existing.requestedAt, sourceEvidence.operation.requestedAt, 'recoveryAttempt.requestedAt');
    requireExact(existing.jobSha256, jobSha256, 'recoveryAttempt.jobSha256');
    if (existing.accepted !== true) {
      throw recoveryError(
        'WooCommerce Incremental recovery Queue attempt is uncertain; blind resend is blocked',
        'WOOCOMMERCE_INCREMENTAL_RACE_QUEUE_ATTEMPT_UNCERTAIN',
      );
    }
    return Object.freeze({ accepted: true, reusedEvidence: true, jobSha256 });
  }

  const evidence = {
    repositoryHead: target.repositoryHead,
    sourceEvidenceHead: WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_SOURCE_HEAD,
    operationId: sourceEvidence.operation.operationId,
    requestedAt: sourceEvidence.operation.requestedAt,
    accepted: false,
    jobSha256,
    attemptedAt: new Date().toISOString(),
  };
  await writePrivateJson(path, evidence);
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.accountId)}/queues/${encodeURIComponent(target.queueId)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${target.env.CLOUDFLARE_API_TOKEN}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: sourceEvidence.job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    throw recoveryError(
      `Cloudflare Queue rejected WooCommerce Incremental race recovery (HTTP ${response.status})`,
      'WOOCOMMERCE_INCREMENTAL_RACE_QUEUE_SEND_FAILED',
    );
  }
  await writePrivateJson(path, { ...evidence, accepted: true });
  return Object.freeze({ accepted: true, reusedEvidence: false, jobSha256 });
}

async function bridgeReplayCheckpoint(sourceEvidence, fullBefore, lark, tableIds) {
  const current = selectWooCommerceCompletedState({
    operationId: WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID,
    snapshot: await readSnapshot(WOOCOMMERCE_COMPLETED_STATE_OPERATION_ID),
    fullReconciliation: true,
    requireCurrentSourceParity: false,
  });
  requireExact(
    current.completionFingerprint,
    sourceEvidence.fullCompletionFingerprint,
    'bridgeReplay.fullCompletionFingerprint',
  );
  if (current.priorQueueAttempts < Number(sourceEvidence.replay.minimumQueueAttempts)) {
    throw recoveryError(
      'WooCommerce source replay checkpoint is ahead of current durable Queue attempts',
      'WOOCOMMERCE_INCREMENTAL_RACE_REPLAY_BRIDGE_INVALID',
    );
  }
  const parity = await verifyParity(lark, tableIds, current.snapshot.counts);
  await writeEvidence('05-idempotent-replay', {
    ...sourceEvidence.replay,
    repositoryHead: target.repositoryHead,
    completionFingerprint: fullBefore.completionFingerprint,
    bridgedFromSourceHead: WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_SOURCE_HEAD,
    parity,
  });
}

async function runLocalVerification() {
  const steps = [
    ['npm', ['ci']],
    ['npm', ['run', 'check']],
    ['node', [
      '--test',
      'tests/application/woocommerce-final-completed-state-closeout.test.js',
      'tests/application/woocommerce-completed-state-incremental-admission-race.test.js',
      'tests/application/woocommerce-final-rollout-operator.test.js',
      'tests/application/woocommerce-runtime-wiring.test.js',
    ]],
    ['npm', ['test']],
    ['npm', ['run', 'test:report-reliability']],
    ['npm', ['audit', '--audit-level=high']],
    ['npm', ['run', 'deploy:dry-run']],
  ];
  for (const [commandName, args] of steps) {
    await command(commandName, args, { timeout: 900_000 });
  }
}

async function assertRepositoryState() {
  await gitText(['fetch', 'origin', 'main', '--quiet']);
  const branch = await gitText(['branch', '--show-current']);
  const head = await gitText(['rev-parse', 'HEAD']);
  const originMain = await gitText(['rev-parse', 'origin/main']);
  const status = await gitText(['status', '--porcelain', '--untracked-files=all']);
  if (branch !== 'main' || head !== originMain || status.trim() !== '') {
    throw recoveryError(
      'WooCommerce Incremental race recovery requires clean current main',
      'WOOCOMMERCE_INCREMENTAL_RACE_REPOSITORY_INVALID',
      {
        branch,
        headMatchesOriginMain: head === originMain,
        workingTreeClean: status.trim() === '',
      },
    );
  }
}

function assertEvidenceHeadBinding(repositoryHead) {
  const relativeOutput = relative(repositoryRoot, outputRoot).split('\\').join('/');
  if (!relativeOutput.split('/').includes(repositoryHead)) {
    throw recoveryError(
      'WooCommerce Incremental race evidence directory is not bound to exact Repository Head',
      'WOOCOMMERCE_INCREMENTAL_RACE_EVIDENCE_HEAD_MISMATCH',
    );
  }
}

async function readRemoteReadiness() {
  const [deploymentRaw, secretsRaw, state] = await Promise.all([
    wranglerJson([
      'deployments', 'status',
      '--name', target.workerName,
      '--config', target.configPath,
      '--json',
    ]),
    wranglerJson([
      'secret', 'list',
      '--name', target.workerName,
      '--config', target.configPath,
      '--format', 'json',
    ]),
    readD1Row(buildRemoteReadinessSql()),
  ]);
  const deployment = Array.isArray(deploymentRaw) ? deploymentRaw[0] : deploymentRaw;
  const activeVersion = selectExactlyOneActiveWorkerVersion(deployment);
  const versionView = await wranglerJson([
    'versions', 'view', activeVersion,
    '--name', target.workerName,
    '--config', target.configPath,
    '--json',
  ]);
  return Object.freeze({
    activeVersion,
    versionView,
    secretNames: parseSecretNames(secretsRaw),
    state,
  });
}

function buildRemoteReadinessSql() {
  const historyStart = Date.parse(WOOCOMMERCE_COMPLETED_STATE_HISTORY_START);
  return `SELECT
    (SELECT COUNT(*) FROM sync_work_runs WHERE lifecycle_status='active') AS active_work,
    (SELECT COUNT(*) FROM sync_locks WHERE expires_at>unixepoch('now')*1000) AS active_locks,
    (SELECT COUNT(DISTINCT q.operation_id) FROM queue_operation_attempts q
      JOIN sync_work_runs w ON w.work_key=q.work_key
      WHERE w.lifecycle_status='active') AS active_queue_operations,
    (SELECT COUNT(*) FROM raw_commerce_order_items WHERE account_key='chemistry_k'
      AND raw_order_key IN (SELECT raw_order_key FROM raw_commerce_orders
        WHERE account_key='chemistry_k' AND source_created_at<${historyStart})) AS old_raw_order_items,
    (SELECT COUNT(*) FROM raw_commerce_refunds WHERE account_key='chemistry_k'
      AND raw_order_key IN (SELECT raw_order_key FROM raw_commerce_orders
        WHERE account_key='chemistry_k' AND source_created_at<${historyStart})) AS old_raw_refunds,
    (SELECT COUNT(*) FROM raw_commerce_orders
      WHERE account_key='chemistry_k' AND source_created_at<${historyStart}) AS old_raw_orders,
    (SELECT COUNT(*) FROM commerce_order_status_observations WHERE account_key='chemistry_k'
      AND order_key IN (SELECT order_key FROM commerce_order_state
        WHERE account_key='chemistry_k' AND source_created_at<${historyStart})) AS old_order_status_observations,
    (SELECT COUNT(*) FROM commerce_order_line_facts WHERE account_key='chemistry_k'
      AND order_key IN (SELECT order_key FROM commerce_order_state
        WHERE account_key='chemistry_k' AND source_created_at<${historyStart})) AS old_order_line_facts,
    (SELECT COUNT(*) FROM commerce_order_state
      WHERE account_key='chemistry_k' AND source_created_at<${historyStart}) AS old_order_state,
    (SELECT COUNT(*) FROM commerce_daily_sales_facts
      WHERE account_key='chemistry_k' AND metric_date<'2026-01-01') AS old_daily,
    (SELECT COUNT(*) FROM commerce_product_daily_facts
      WHERE account_key='chemistry_k' AND metric_date<'2026-01-01') AS old_product_daily;`;
}

async function readSnapshot(operationId) {
  return readD1Row(buildWooCommerceFinalSnapshotSql({
    accountKey: target.accountKey,
    operationId,
  }));
}

async function readIncidentState(operationId) {
  return readD1Row(buildWooCommerceIncrementalAdmissionRaceStateSql({ operationId }));
}

async function pollCompletedState(input) {
  for (let poll = 0; poll < VERIFY_MAX_POLLS; poll += 1) {
    const snapshot = await readSnapshot(input.operationId);
    const classification = classifyWooCommerceCompletedStatePoll({ ...input, snapshot });
    if (classification.complete) return classification.selected;
    if (classification.terminalFailure) {
      throw recoveryError(
        'WooCommerce Incremental recovery reached permanent terminal failure',
        'WOOCOMMERCE_INCREMENTAL_RACE_OPERATION_TERMINAL_FAILURE',
        {
          syncRunStatus: classification.snapshot.syncRunStatus,
          syncRunErrorCode: classification.snapshot.syncRunErrorCode,
          queueOperationAttempts: classification.snapshot.queueOperationAttempts,
        },
      );
    }
    if (poll + 1 < VERIFY_MAX_POLLS) await sleep(VERIFY_INTERVAL_MS);
  }
  throw recoveryError(
    'WooCommerce Incremental race recovery exceeded bounded verification',
    'WOOCOMMERCE_INCREMENTAL_RACE_VERIFY_TIMEOUT',
  );
}

async function verifyParity(client, tableIds, d1Counts) {
  const larkCounts = {};
  for (const binding of listWooCommerceTableBindings()) {
    const records = await client.listRecords({
      tableId: tableIds[binding.tableKey],
      pageSize: 500,
    });
    larkCounts[binding.tableKey] = records.filter(
      (record) => normalizeLarkScalar(record.fields?.account_key) === target.accountKey,
    ).length;
  }
  return compareWooCommerceParity({ d1Counts, larkCounts });
}

async function backupD1() {
  const directory = join(outputRoot, 'backups');
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const path = join(directory, `social-mkt-state-dev-before-incremental-race-${Date.now()}.sql`);
  await wranglerText([
    'd1', 'export', target.databaseName,
    '--remote', '--config', target.configPath,
    '--output', path, '--skip-confirmation',
  ], { timeout: 600_000 });
  await chmod(path, 0o600);
  const bytes = await readFile(path);
  if (bytes.length === 0) {
    throw recoveryError(
      'WooCommerce Incremental race D1 backup is empty',
      'WOOCOMMERCE_INCREMENTAL_RACE_BACKUP_EMPTY',
    );
  }
  return Object.freeze({
    file: relative(repositoryRoot, path),
    bytes: bytes.length,
    sha256: createHash('sha256').update(bytes).digest('hex'),
  });
}

async function deployAndVerify(configText, expectedTrueFlags, label) {
  await withGeneratedConfig(configText, async (configPath) => {
    await wranglerText([
      'deploy', '--config', configPath,
      '--message', `${WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONTRACT_VERSION} stage=${label} git=${target.repositoryHead}`,
    ], { timeout: 600_000 });
  });
  const deploymentRaw = await wranglerJson([
    'deployments', 'status',
    '--name', target.workerName,
    '--config', target.configPath,
    '--json',
  ]);
  const deployment = Array.isArray(deploymentRaw) ? deploymentRaw[0] : deploymentRaw;
  const activeVersion = selectExactlyOneActiveWorkerVersion(deployment);
  const versionView = await wranglerJson([
    'versions', 'view', activeVersion,
    '--name', target.workerName,
    '--config', target.configPath,
    '--json',
  ]);
  const observedTrueFlags = collectEnabledMktFlags(versionView);
  assertExactFlags(observedTrueFlags, expectedTrueFlags);
  if (expectedTrueFlags.length === 0) assertWooCommerce2026RemoteSafeFlags(versionView);
  const [mainConsumersRaw, dlqConsumersRaw] = await Promise.all([
    wranglerJson(['queues', 'consumer', 'list', target.mainQueueName, '--json']),
    wranglerJson(['queues', 'consumer', 'list', target.dlqName, '--json']),
  ]);
  assertWooCommerceQueueConsumerTopology(
    consumerEntries(mainConsumersRaw),
    target.mainQueueName,
    {
      maxConcurrency: 1,
      maxBatchSize: 10,
      maxBatchTimeout: 30,
      maxRetries: 5,
      deadLetterQueue: target.dlqName,
    },
  );
  assertWooCommerceQueueConsumerTopology(
    consumerEntries(dlqConsumersRaw),
    target.dlqName,
    {
      maxConcurrency: 1,
      maxBatchSize: 10,
      maxBatchTimeout: 30,
      maxRetries: 10,
      deadLetterQueue: null,
    },
  );
  return Object.freeze({
    label,
    activeVersion,
    configSha256: fingerprintWooCommerceIncrementalAdmissionRaceValue(configText),
    expectedTrueFlags: Object.freeze([...expectedTrueFlags].sort()),
  });
}

async function withGeneratedConfig(configText, callback) {
  const path = join(repositoryRoot, `.woocommerce-incremental-race-${process.pid}-${Date.now()}.jsonc`);
  await writeFile(path, configText, { mode: 0o600, flag: 'wx' });
  try {
    return await callback(path);
  } finally {
    await rm(path, { force: true });
  }
}

async function executeD1Mutation(sql) {
  await wranglerText([
    'd1', 'execute', target.databaseName,
    '--remote', '--config', target.configPath,
    '--command', sql,
  ], { timeout: 120_000 });
}

async function readD1Row(sql) {
  let lastError = null;
  for (const delayMs of D1_READ_DELAYS_MS) {
    if (delayMs > 0) await sleep(delayMs);
    try {
      const parsed = await wranglerJson([
        'd1', 'execute', target.databaseName,
        '--remote', '--json', '--config', target.configPath,
        '--command', sql,
      ], { timeout: 120_000 });
      const row = Array.isArray(parsed)
        ? parsed.flatMap((entry) => entry?.results ?? [])[0]
        : parsed?.results?.[0];
      if (!row) {
        throw recoveryError(
          'WooCommerce Incremental race Remote D1 query returned no row',
          'WOOCOMMERCE_INCREMENTAL_RACE_D1_QUERY_EMPTY',
        );
      }
      return row;
    } catch (error) {
      lastError = error;
    }
  }
  throw recoveryError(
    'WooCommerce Incremental race Remote D1 read failed after bounded retries',
    'WOOCOMMERCE_INCREMENTAL_RACE_D1_READ_FAILED',
    { causeCode: lastError?.code ?? null },
  );
}

async function wranglerJson(args, options = {}) {
  const text = await wranglerText(args, options);
  try {
    return JSON.parse(text);
  } catch {
    throw recoveryError(
      'Wrangler returned invalid JSON during WooCommerce Incremental race recovery',
      'WOOCOMMERCE_INCREMENTAL_RACE_WRANGLER_JSON_INVALID',
      { commandClass: args[0] ?? null },
    );
  }
}

async function wranglerText(args, options = {}) {
  return commandText('npx', ['wrangler', ...args], {
    env: options.env ?? target?.env ?? process.env,
    timeout: options.timeout ?? 180_000,
  });
}

async function command(commandName, args, options = {}) {
  const result = await commandText(commandName, args, options);
  if (result) process.stdout.write(`${result}\n`);
}

async function commandText(commandName, args, options = {}) {
  try {
    const result = await execFileAsync(commandName, args, {
      cwd: repositoryRoot,
      env: options.env ?? process.env,
      encoding: 'utf8',
      timeout: options.timeout ?? 180_000,
      maxBuffer: 128 * 1024 * 1024,
    });
    if (result.stderr) process.stderr.write(result.stderr);
    return String(result.stdout ?? '').trim();
  } catch (cause) {
    throw recoveryError(
      `Command failed during WooCommerce Incremental race recovery: ${commandName}`,
      'WOOCOMMERCE_INCREMENTAL_RACE_COMMAND_FAILED',
      {
        commandClass: commandName === 'npx' ? args[1] ?? args[0] : commandName,
        exitCode: cause?.code ?? cause?.exitCode ?? 1,
        killed: cause?.killed === true,
        signal: cause?.signal ?? null,
      },
    );
  }
}

async function gitText(args) {
  return commandText('git', args, { timeout: 60_000 });
}

function consumerEntries(value) {
  if (Array.isArray(value)) return value;
  if (Array.isArray(value?.result)) return value.result;
  if (Array.isArray(value?.consumers)) return value.consumers;
  throw recoveryError(
    'WooCommerce Incremental race Queue consumer output has no supported collection',
    'WOOCOMMERCE_INCREMENTAL_RACE_QUEUE_CONSUMER_SHAPE_INVALID',
  );
}

function parseSecretNames(value) {
  const entries = Array.isArray(value) ? value : (value?.result ?? []);
  return Object.freeze(entries.map((item) => item?.name).filter(Boolean).sort());
}

function assertExactFlags(actual, expected) {
  const left = [...actual].sort();
  const right = [...expected].sort();
  if (JSON.stringify(left) !== JSON.stringify(right)) {
    throw recoveryError(
      'WooCommerce Incremental race Worker flags differ from the exact window contract',
      'WOOCOMMERCE_INCREMENTAL_RACE_FLAGS_INVALID',
      { expected: right, observed: left },
    );
  }
  return true;
}

function compactCloudflareEnv(env) {
  const output = { ...env };
  for (const name of [
    'CLOUDFLARE_API_TOKEN',
    'CLOUDFLARE_API_KEY',
    'CLOUDFLARE_EMAIL',
    'CF_API_TOKEN',
    'CF_API_KEY',
    'CF_EMAIL',
  ]) {
    if (!optionalText(env[name])) delete output[name];
  }
  return output;
}

function normalizeLarkScalar(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return normalizeLarkScalar(value[0]);
  if (typeof value === 'object') {
    return normalizeLarkScalar(value.text ?? value.value ?? value.name ?? null);
  }
  return String(value);
}

async function writeEvidence(name, value) {
  await writePrivateJson(join(outputRoot, `${name}.json`), {
    contractVersion: WOOCOMMERCE_INCREMENTAL_ADMISSION_RACE_RECOVERY_CONTRACT_VERSION,
    writtenAt: new Date().toISOString(),
    data: sanitizeWooCommerceCompletedStateEvidence(
      sanitizeWooCommerceIncrementalAdmissionRaceEvidence(value),
    ),
  });
}

async function readSourceEvidenceData(name) {
  const value = await readJsonIfExists(join(sourceEvidenceRoot, `${name}.json`));
  if (!value
    || value.contractVersion !== WOOCOMMERCE_COMPLETED_STATE_CLOSEOUT_CONTRACT_VERSION
    || !value.data
    || typeof value.data !== 'object'
    || Array.isArray(value.data)) {
    throw recoveryError(
      'WooCommerce Incremental race source stage checkpoint has invalid contract metadata',
      'WOOCOMMERCE_INCREMENTAL_RACE_SOURCE_CHECKPOINT_INVALID',
      { stage: name },
    );
  }
  return value.data;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
    flag: 'wx',
  });
  await rename(temporary, path);
  await chmod(path, 0o600);
}

async function readJsonIfExists(path) {
  try {
    await stat(path);
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

function resolveRepositoryFile(value) {
  const path = resolve(repositoryRoot, requireText(value, 'repositoryFile'));
  if (path !== repositoryRoot && !path.startsWith(`${repositoryRoot}/`)) {
    throw recoveryError(
      'WooCommerce Incremental race repository file escapes the Repository root',
      'WOOCOMMERCE_INCREMENTAL_RACE_PATH_INVALID',
    );
  }
  return path;
}

function requireExact(value, expected, fieldName) {
  if (value !== expected) {
    throw recoveryError(
      `WooCommerce Incremental race ${fieldName} differs from the exact contract`,
      'WOOCOMMERCE_INCREMENTAL_RACE_TARGET_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw recoveryError(
      `WooCommerce Incremental race requires ${fieldName}`,
      'WOOCOMMERCE_INCREMENTAL_RACE_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function requireIncrementalOperationId(value) {
  const text = requireText(value, 'operationId').toLowerCase();
  if (!/^woo-final-incremental-[0-9a-f]{12}$/u.test(text)) {
    throw recoveryError(
      'WooCommerce Incremental race operation ID is invalid',
      'WOOCOMMERCE_INCREMENTAL_RACE_OPERATION_INVALID',
    );
  }
  return text;
}

function requireTimestamp(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < Date.UTC(2020, 0, 1)) {
    throw recoveryError(
      `WooCommerce Incremental race ${fieldName} is invalid`,
      'WOOCOMMERCE_INCREMENTAL_RACE_TIMESTAMP_INVALID',
      { fieldName },
    );
  }
  return number;
}

function requirePositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw recoveryError(
      `WooCommerce Incremental race ${fieldName} must be a positive integer`,
      'WOOCOMMERCE_INCREMENTAL_RACE_VALUE_INVALID',
      { fieldName },
    );
  }
  return number;
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}

function recoveryError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'WooCommerceIncrementalAdmissionRaceRecoveryOperatorError';
  error.code = code;
  error.details = details;
  return error;
}
