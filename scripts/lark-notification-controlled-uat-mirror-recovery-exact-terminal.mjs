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
  LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
  buildLarkNotificationControlledUatReadbackSql,
  buildLarkNotificationControlledUatWranglerConfig,
  normalizeLarkNotificationControlledUatReadback,
  resolveLarkNotificationControlledUatTables,
} from './lib/lark-notification-controlled-uat.js';
import {
  buildLarkNotificationControlledUatJob,
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
import { LARK_EXECUTIVE_DESTINATION_KEY_HASH } from '../packages/config/src/lark-notification-runtime-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { loadLarkNotificationDeliveryRequest } from '../packages/connectors/src/lark/lark-notification-delivery-source.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';

const CONTRACT_VERSION = 'lark_notification_controlled_uat_mirror_recovery_v1';
const CONFIRMATION_ENV = 'CONFIRM_LARK_NOTIFICATION_MIRROR_RECOVERY';
const CONFIRMATION_VALUE = 'REPAIR_SENT_EXECUTIVE_MIRROR_WITHOUT_RESEND';
const ROOT = resolve(process.cwd());
const WORKER_NAME = 'social-mkt-sync-worker';
const SOURCE_CONFIG = resolve(
  process.env.MKT_LARK_NOTIFICATION_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const OUTPUT_ROOT = resolve(
  process.env.MKT_LARK_NOTIFICATION_MIRROR_RECOVERY_EVIDENCE_ROOT
    ?? 'outputs/lark-notification-controlled-uat-mirror-recovery',
);
const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 90;

let stage = 'init';
let context = null;
let activeDeploymentStarted = false;
let settingsActivated = false;
let primaryError = null;
let safeRestoreError = null;
let settingsRestoreError = null;

try {
  await main();
} catch (error) {
  primaryError = error;
  process.exitCode = 1;
} finally {
  if (context && activeDeploymentStarted) {
    try {
      stage = 'restore-safe-worker';
      await deployAndVerify(context, context.safeConfigPath, 'safe-restore');
      activeDeploymentStarted = false;
    } catch (error) {
      safeRestoreError = error;
      process.exitCode = 1;
    }
  }
  if (context && settingsActivated) {
    try {
      stage = 'restore-report-settings';
      await writeSettingsState(context, false);
      await assertSettingsState(context, false);
      settingsActivated = false;
    } catch (error) {
      settingsRestoreError = error;
      process.exitCode = 1;
    }
  }
  if (primaryError || safeRestoreError || settingsRestoreError) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      contractVersion: CONTRACT_VERSION,
      parentContractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
      stage,
      code: primaryError?.code
        ?? safeRestoreError?.code
        ?? settingsRestoreError?.code
        ?? 'LARK_NOTIFICATION_MIRROR_RECOVERY_FAILED',
      message: primaryError?.message
        ?? safeRestoreError?.message
        ?? settingsRestoreError?.message
        ?? 'Lark notification mirror recovery failed',
      details: scrub(primaryError?.details ?? {}),
      originalMessagePreserved: Boolean(context?.before?.deliveryStatus === 'sent'),
      additionalMessageSendCount: 0,
      safeWorkerRestored: Boolean(context && !activeDeploymentStarted && !safeRestoreError),
      reportSettingsRestored: Boolean(context && !settingsActivated && !settingsRestoreError),
      automationActivationCount: 0,
      scheduleActivationCount: 0,
      production: 'BLOCKED',
    }, null, 2)}\n`);
  }
}

async function main() {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
    return;
  }

  stage = 'load-local-environment';
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  exact(env[CONFIRMATION_ENV], CONFIRMATION_VALUE, CONFIRMATION_ENV);
  exact(env.MKT_ENV, 'development', 'MKT_ENV');
  exact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  exact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  stage = 'repository-preflight';
  const repositoryHead = exactMainHead();
  const sourceText = await readFile(SOURCE_CONFIG, 'utf8');
  const sourceConfig = parseJsoncObject(sourceText);
  const evidenceDir = resolve(OUTPUT_ROOT, repositoryHead);
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);
  await assertFreshAttempt(evidenceDir);

  stage = 'local-focused-gates';
  run('node', ['--test',
    'tests/connectors/lark-notification-state-mirror.test.js',
    'tests/application/deliver-lark-executive-notification.test.js',
    'tests/application/lark-notification-active-job-router.test.js',
    'tests/connectors/lark-notification-delivery-source.test.js',
    'tests/connectors/d1-lark-notification-delivery-store.test.js',
    'tests/application/lark-notification-controlled-uat-mirror-recovery-exact-terminal.test.js',
  ], { stdio: 'inherit' });
  run('npm', ['run', 'check'], { stdio: 'inherit' });

  stage = 'resolve-exact-lark-tables';
  const client = createLarkBitableClientFromEnv(env);
  const tableIds = resolveLarkNotificationControlledUatTables(await client.listTables());
  const repository = new LarkRecordRepository({ client });
  const sourceConfigName = requireText(sourceConfig.name, 'worker name');

  stage = 'build-private-runtime-windows';
  const activeConfig = buildLarkNotificationControlledUatWranglerConfig(
    sourceText,
    tableIds,
    { active: true },
  );
  const safeConfig = buildLarkNotificationControlledUatWranglerConfig(
    sourceText,
    tableIds,
    { active: false },
  );
  if (!activeConfig.scheduleConfigPreserved || !safeConfig.scheduleConfigPreserved) {
    fail(
      'Mirror recovery must preserve the existing trigger configuration exactly',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_CONFIG_INVALID',
    );
  }
  const generatedDir = resolve(evidenceDir, 'generated-config');
  await mkdir(generatedDir, { recursive: true, mode: 0o700 });
  const activeConfigPath = resolve(generatedDir, 'active.json');
  const safeConfigPath = resolve(generatedDir, 'safe.json');
  await writeGeneratedConfig(activeConfigPath, activeConfig.text);
  await writeGeneratedConfig(safeConfigPath, safeConfig.text);

  stage = 'resolve-cloudflare-target';
  const cloudflare = resolveCloudflareTarget(env, sourceText, sourceConfig);
  const databaseName = resolveDatabaseName(sourceConfig);
  const queueName = resolveQueueName(sourceConfig);
  const queueId = resolveWooCommerceQueueId(
    JSON.stringify(await listCloudflareQueuesViaApi({
      accountId: cloudflare.accountId,
      bearerToken: freshQueueBearer(cloudflare),
    })),
    queueName,
  );

  context = {
    env,
    repositoryHead,
    evidenceDir,
    sourceConfig,
    sourceConfigName,
    activeConfigPath,
    safeConfigPath,
    databaseName,
    queueName,
    queueId,
    tableIds,
    client,
    repository,
    cloudflare,
    settingsBaseline: null,
    recovery: null,
    before: null,
  };

  stage = 'discover-retained-sent-mirror-failure';
  context.recovery = discoverRetainedMirrorFailure(context);
  context.before = readD1State(context);
  assertRecoveryBoundary(context.before, context.recovery);
  const partialLark = await inspectLarkMirror(context);
  await privateJson(join(evidenceDir, '01-retained-failure.json'), {
    contractVersion: CONTRACT_VERSION,
    repositoryHead,
    aiRunKeyHash: sha256(context.recovery.aiRunKey),
    notificationAttemptKeyHash: sha256(context.recovery.notificationAttemptKey),
    delivery: publicDelivery(context.before),
    claimCount: context.before.claimCount,
    retainedMirrorErrorCode: context.recovery.errorCode,
    retainedMirrorErrorMessage: context.recovery.redactedErrorMessage,
    partialLark,
    additionalMessageSendCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });

  stage = 'validate-source-report-and-destination-chain';
  const requestBeforeSettings = await loadLarkNotificationDeliveryRequest({
    repository,
    tables: tableIds,
    aiRunKey: context.recovery.aiRunKey,
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });
  context.settingsBaseline = await loadSettingsBaseline(
    context,
    requestBeforeSettings.snapshot.sourceReportSettingKeys,
    requestBeforeSettings.snapshot.customerProfile,
  );

  stage = 'activate-exact-report-settings';
  await writeSettingsState(context, true);
  settingsActivated = true;
  await assertSettingsState(context, true);

  stage = 'dry-run-private-runtime-windows';
  run('npx', ['wrangler', 'deploy', '--dry-run', '--config', activeConfigPath], {
    env: cloudflare.wranglerEnv,
    stdio: 'inherit',
  });
  run('npx', ['wrangler', 'deploy', '--dry-run', '--config', safeConfigPath], {
    env: cloudflare.wranglerEnv,
    stdio: 'inherit',
  });

  stage = 'deploy-controlled-active-worker';
  activeDeploymentStarted = true;
  const activeVersion = await deployAndVerify(context, activeConfigPath, 'active');

  stage = 'send-mirror-repair-replay';
  const operationId = `lark_notification_mirror_recovery_${sha256(
    context.recovery.notificationAttemptKey,
  ).slice(0, 32)}`;
  const job = buildLarkNotificationControlledUatJob({
    aiRunKey: context.recovery.aiRunKey,
    operationId,
    requestedAt: Date.now(),
  });
  const jobHash = sha256(JSON.stringify(job));
  await sendQueueOnce(
    context,
    job,
    join(evidenceDir, '02-mirror-repair-queue.attempt.json'),
    jobHash,
  );
  const recovered = await pollMirrorRecovered(context, context.before);
  const lark = await verifyLarkMirror(context);
  await privateJson(join(evidenceDir, '03-mirror-repair-verified.json'), {
    contractVersion: CONTRACT_VERSION,
    operationIdHash: sha256(operationId),
    jobSha256: jobHash,
    delivery: publicDelivery(recovered),
    firstClaimCount: context.before.claimCount,
    recoveredClaimCount: recovered.claimCount,
    originalSentAtStable: recovered.sentAt === context.before.sentAt,
    originalMessageIdHashStable: recovered.messageIdHash === context.before.messageIdHash,
    lark,
    additionalMessageSendCount: 0,
  });

  stage = 'restore-safe-worker';
  const safeVersion = await deployAndVerify(context, safeConfigPath, 'safe-restore');
  activeDeploymentStarted = false;

  stage = 'restore-report-settings';
  await writeSettingsState(context, false);
  await assertSettingsState(context, false);
  settingsActivated = false;

  stage = 'final-readback';
  const final = readD1State(context);
  assertRecoveredStable(context.before, final);
  const finalLark = await verifyLarkMirror(context);
  const summary = {
    ok: true,
    contractVersion: CONTRACT_VERSION,
    parentContractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    phase: 'complete',
    repositoryHead,
    activeVersion,
    safeVersion,
    trafficPercentage: 100,
    retainedNotificationMessageCount: 1,
    additionalMessageSendCount: 0,
    deliveryRows: final.deliveryRows,
    deliveryStatus: final.deliveryStatus,
    mirrorStatus: final.mirrorStatus,
    firstClaimCount: context.before.claimCount,
    recoveredClaimCount: final.claimCount,
    originalSentAtStable: final.sentAt === context.before.sentAt,
    originalMessageIdHashStable: final.messageIdHash === context.before.messageIdHash,
    notificationLogRows: finalLark.notificationLogRows,
    aiRunMarkedSent: finalLark.aiRunMarkedSent,
    notificationFlagsAllFalseAfterCloseout: true,
    reportSettingsRestored: true,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
    nextGate: 'runtime_activation_requires_separate_approval',
  };
  await privateJson(join(evidenceDir, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: CONTRACT_VERSION,
    parentContractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    confirmation: { envName: CONFIRMATION_ENV, value: CONFIRMATION_VALUE },
    sequence: [
      'discover exactly one retained sent plus mirror-failed controlled UAT delivery',
      'read retained redacted mirror failure and partial Lark state',
      'temporarily enable only the exact source Report Settings',
      'deploy one notification-only active Worker window',
      'submit one replay that D1 must dedupe before transport and use only to repair the mirror',
      'require original sent_at and message hash unchanged while mirror becomes mirrored',
      'restore Worker notification flags and Report Settings false',
    ],
    retainedNotificationMessageCount: 1,
    maximumAdditionalMessageSendCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    fail(
      'Mirror recovery exact terminal accepts only --execute',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function exactMainHead() {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const branch = text('git', ['branch', '--show-current'], { raw: true }).trim();
  const head = text('git', ['rev-parse', 'HEAD']);
  const originMain = text('git', ['rev-parse', 'origin/main']);
  const dirty = text('git', ['status', '--porcelain', '--untracked-files=all'], { raw: true }).trim();
  if (branch !== 'main' || head !== originMain || dirty) {
    fail(
      'Mirror recovery requires clean exact current main',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_REPOSITORY_INVALID',
      { branch, head, originMain, dirtyPathCount: dirty ? dirty.split(/\r?\n/u).length : 0 },
    );
  }
  return head;
}

async function assertFreshAttempt(directory) {
  for (const name of ['summary.json', '02-mirror-repair-queue.attempt.json']) {
    try {
      await stat(join(directory, name));
      fail(
        'Mirror recovery evidence already exists; blind replay is forbidden',
        'LARK_NOTIFICATION_MIRROR_RECOVERY_ALREADY_ATTEMPTED',
        { evidenceName: name },
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

async function writeGeneratedConfig(path, configText) {
  const rebased = rebaseGeneratedWranglerConfigPaths(configText, {
    sourceDirectory: dirname(SOURCE_CONFIG),
    outputDirectory: dirname(path),
  });
  await writeFile(path, rebased.text, { encoding: 'utf8', mode: 0o600 });
  await chmod(path, 0o600);
}

function resolveCloudflareTarget(env, sourceText, sourceConfig) {
  const wranglerEnv = buildWranglerOAuthEnvironment(env);
  const whoami = text('npx', ['wrangler', 'whoami', '--json'], { env: wranglerEnv });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    preferredAccount: env.MKT_LARK_NOTIFICATION_UAT_ACCOUNT,
    configText: sourceText,
    whoamiOutput: whoami,
  });
  const selected = Object.freeze({ ...wranglerEnv, CLOUDFLARE_ACCOUNT_ID: accountId });
  const auth = resolveCloudflareBearerAuth({
    authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], { env: selected }),
  });
  return Object.freeze({
    accountId,
    wranglerEnv: selected,
    authType: auth.type,
    sourceConfigName: sourceConfig.name,
  });
}

function freshQueueBearer(cloudflare) {
  const auth = resolveCloudflareBearerAuth({
    authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], {
      env: cloudflare.wranglerEnv,
    }),
  });
  if (auth.type !== cloudflare.authType) {
    fail(
      'Cloudflare authentication type changed during mirror recovery',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_AUTH_DRIFT',
    );
  }
  return auth.token;
}

function resolveDatabaseName(config) {
  const matches = Array.isArray(config.d1_databases)
    ? config.d1_databases.filter((item) => item?.binding === 'MKT_STATE_DB')
    : [];
  if (matches.length !== 1) {
    fail(
      'Mirror recovery requires one MKT_STATE_DB binding',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_CONFIG_INVALID',
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
      'Mirror recovery requires one MKT_SYNC_QUEUE producer',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_CONFIG_INVALID',
      { producerCount: matches.length },
    );
  }
  return requireText(matches[0].queue, 'queue');
}

function discoverRetainedMirrorFailure(target) {
  const output = text('npx', [
    'wrangler', 'd1', 'execute', target.databaseName,
    '--remote',
    '--config', target.safeConfigPath,
    '--command', `
      SELECT notification_attempt_key, ai_run_key, claim_count, sent_at,
             lark_message_id_hash, error_code, redacted_error_message
      FROM lark_notification_deliveries
      WHERE status = 'sent'
        AND mirror_status = 'failed'
        AND ai_run_key LIKE 'notification-uat:%'
      ORDER BY updated_at DESC
      LIMIT 2;
    `,
    '--json',
  ], { env: target.cloudflare.wranglerEnv });
  const rows = extractLarkNotificationWranglerD1Rows(output);
  if (rows.length !== 1) {
    fail(
      'Mirror recovery requires exactly one retained sent plus mirror-failed UAT delivery',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_IDENTITY_INVALID',
      { matchCount: rows.length },
    );
  }
  const row = rows[0];
  return Object.freeze({
    notificationAttemptKey: requireText(row.notification_attempt_key, 'notification_attempt_key'),
    aiRunKey: requireText(row.ai_run_key, 'ai_run_key'),
    claimCount: positiveInteger(row.claim_count, 'claim_count'),
    sentAt: positiveInteger(row.sent_at, 'sent_at'),
    messageIdHash: requireHash(row.lark_message_id_hash, 'lark_message_id_hash'),
    errorCode: optionalText(row.error_code),
    redactedErrorMessage: optionalText(row.redacted_error_message),
  });
}

function readD1State(target) {
  const sql = buildLarkNotificationControlledUatReadbackSql(target.recovery.aiRunKey);
  const output = text('npx', [
    'wrangler', 'd1', 'execute', target.databaseName,
    '--remote',
    '--config', target.safeConfigPath,
    '--command', sql,
    '--json',
  ], { env: target.cloudflare.wranglerEnv });
  const row = extractLarkNotificationWranglerD1Rows(output)[0];
  return normalizeLarkNotificationControlledUatReadback(row);
}

function assertRecoveryBoundary(readback, retained) {
  if (readback.notificationTableCount !== 1
      || readback.notificationIndexCount !== 3
      || readback.activeLocks !== 0
      || readback.deliveryRows !== 1
      || readback.deliveryStatus !== 'sent'
      || readback.mirrorStatus !== 'failed'
      || readback.claimCount !== retained.claimCount
      || readback.sentAt !== retained.sentAt
      || readback.messageIdHash !== retained.messageIdHash) {
    fail(
      'Retained delivery is outside the exact sent mirror-recovery boundary',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_BOUNDARY_INVALID',
      {
        deliveryRows: readback.deliveryRows,
        deliveryStatus: readback.deliveryStatus,
        mirrorStatus: readback.mirrorStatus,
        activeLocks: readback.activeLocks,
      },
    );
  }
}

async function loadSettingsBaseline(target, settingKeys, customerProfile) {
  const records = await target.repository.listByFieldValues(
    target.tableIds.reportSettings,
    'report_setting_key',
    settingKeys,
  );
  const baseline = settingKeys.map((settingKey) => {
    const matches = records.filter((record) => (
      String(scalar(record.fields.report_setting_key) ?? '') === settingKey
      && String(scalar(record.fields.customer_profile) ?? '') === customerProfile
    ));
    if (matches.length !== 1) {
      fail(
        'Mirror recovery requires one exact source Setting',
        'LARK_NOTIFICATION_MIRROR_RECOVERY_SETTINGS_INVALID',
        { matchCount: matches.length },
      );
    }
    const fields = matches[0].fields;
    const enabled = boolean(fields.enabled, 'enabled');
    const aiEnabled = boolean(fields.ai_enabled, 'ai_enabled');
    const notificationEnabled = boolean(fields.notification_enabled, 'notification_enabled');
    if (!enabled || aiEnabled || notificationEnabled) {
      fail(
        'Mirror recovery requires enabled Settings with AI and notification initially false',
        'LARK_NOTIFICATION_MIRROR_RECOVERY_SETTINGS_INVALID',
        { enabled, aiEnabled, notificationEnabled },
      );
    }
    return Object.freeze({
      reportSettingKey: settingKey,
      customerProfile,
      aiEnabled,
      notificationEnabled,
    });
  });
  return Object.freeze(baseline);
}

async function writeSettingsState(target, active) {
  const rows = target.settingsBaseline.map((setting) => Object.freeze({
    report_setting_key: setting.reportSettingKey,
    ai_enabled: active ? true : setting.aiEnabled,
    notification_enabled: active ? true : setting.notificationEnabled,
  }));
  const engine = new TableSyncEngine();
  const plan = await engine.planByKey({
    repository: target.repository,
    tableId: target.tableIds.reportSettings,
    keyField: 'report_setting_key',
    rows,
  });
  if (plan.createRows.length !== 0) {
    fail(
      'Mirror recovery must not create Report Settings',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_SETTINGS_INVALID',
      { createRows: plan.createRows.length },
    );
  }
  const result = await engine.executePlan(plan);
  if (result.created !== 0 || result.updated + result.skipped !== rows.length) {
    fail(
      'Mirror recovery Settings parity failed',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_SETTINGS_WRITE_FAILED',
    );
  }
}

async function assertSettingsState(target, active) {
  const keys = target.settingsBaseline.map((item) => item.reportSettingKey);
  const records = await target.repository.listByFieldValues(
    target.tableIds.reportSettings,
    'report_setting_key',
    keys,
  );
  for (const baseline of target.settingsBaseline) {
    const matches = records.filter((record) => (
      String(scalar(record.fields.report_setting_key) ?? '') === baseline.reportSettingKey
      && String(scalar(record.fields.customer_profile) ?? '') === baseline.customerProfile
    ));
    const expectedAi = active ? true : baseline.aiEnabled;
    const expectedNotification = active ? true : baseline.notificationEnabled;
    if (matches.length !== 1
      || boolean(matches[0].fields.ai_enabled, 'ai_enabled') !== expectedAi
      || boolean(matches[0].fields.notification_enabled, 'notification_enabled')
        !== expectedNotification) {
      fail(
        'Mirror recovery Settings readback drifted',
        'LARK_NOTIFICATION_MIRROR_RECOVERY_SETTINGS_READBACK_FAILED',
      );
    }
  }
}

async function deployAndVerify(target, configPath, label) {
  const outputPath = resolve(target.evidenceDir, `.wrangler-${label}-${randomUUID()}.ndjson`);
  try {
    run('npx', ['wrangler', 'deploy', '--config', configPath], {
      env: { ...target.cloudflare.wranglerEnv, WRANGLER_OUTPUT_FILE_PATH: outputPath },
      stdio: 'inherit',
    });
    const output = await readFile(outputPath, 'utf8');
    const versionId = parseWranglerDeploymentOutput(output, { workerName: WORKER_NAME })
      .deploymentVersionId;
    const status = text('npx', [
      'wrangler', 'deployments', 'status', '--config', configPath, '--json',
    ], { env: target.cloudflare.wranglerEnv });
    const verified = parseLarkNotificationDeploymentStatus(status, versionId);
    if (verified.trafficPercentage !== 100) {
      fail(
        'Mirror recovery Worker version is not serving 100 percent',
        'LARK_NOTIFICATION_MIRROR_RECOVERY_DEPLOYMENT_INVALID',
      );
    }
    return versionId;
  } finally {
    await rm(outputPath, { force: true });
  }
}

async function sendQueueOnce(target, job, attemptPath, jobHash) {
  try {
    await stat(attemptPath);
    fail(
      'Mirror recovery Queue attempt is uncertain; blind replay is forbidden',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_QUEUE_ATTEMPT_UNCERTAIN',
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await privateJson(attemptPath, {
    contractVersion: CONTRACT_VERSION,
    aiRunKeyHash: sha256(target.recovery.aiRunKey),
    notificationAttemptKeyHash: sha256(target.recovery.notificationAttemptKey),
    jobSha256: jobHash,
    attemptedAt: new Date().toISOString(),
  });
  const response = await fetch(
    `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(target.cloudflare.accountId)}`
      + `/queues/${encodeURIComponent(target.queueId)}/messages`,
    {
      method: 'POST',
      headers: {
        authorization: `Bearer ${freshQueueBearer(target.cloudflare)}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({ body: job, content_type: 'json' }),
      signal: AbortSignal.timeout(30_000),
    },
  );
  const body = await response.json().catch(() => null);
  if (!response.ok || body?.success !== true) {
    fail(
      'Cloudflare Queue did not confirm mirror-repair admission',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_QUEUE_SEND_FAILED',
      { status: response.status },
    );
  }
}

async function pollMirrorRecovered(target, before) {
  const maxPolls = positiveInteger(
    target.env.MKT_LARK_NOTIFICATION_UAT_MAX_POLLS ?? MAX_POLLS,
    'maxPolls',
  );
  const interval = positiveInteger(
    target.env.MKT_LARK_NOTIFICATION_UAT_POLL_INTERVAL_MS ?? POLL_INTERVAL_MS,
    'pollIntervalMs',
  );
  let last = null;
  for (let index = 1; index <= maxPolls; index += 1) {
    last = readD1State(target);
    process.stdout.write(`${JSON.stringify({
      event: 'lark_notification_mirror_recovery_progress',
      poll: index,
      deliveryStatus: last.deliveryStatus,
      mirrorStatus: last.mirrorStatus,
      claimCount: last.claimCount,
      activeLocks: last.activeLocks,
    })}\n`);
    try {
      assertRecoveredStable(before, last);
      return last;
    } catch (error) {
      if (error?.code !== 'LARK_NOTIFICATION_MIRROR_RECOVERY_NOT_COMPLETE') throw error;
    }
    if (index < maxPolls) await sleep(interval);
  }
  fail(
    'Mirror recovery verification timed out',
    'LARK_NOTIFICATION_MIRROR_RECOVERY_VERIFY_TIMEOUT',
    {
      deliveryStatus: last?.deliveryStatus ?? null,
      mirrorStatus: last?.mirrorStatus ?? null,
      claimCount: last?.claimCount ?? null,
    },
  );
}

function assertRecoveredStable(before, after) {
  const pending = after.deliveryStatus === 'sent'
    && after.mirrorStatus !== 'mirrored'
    && after.deliveryRows === 1;
  if (pending) {
    const error = new Error('Mirror recovery is not complete');
    error.code = 'LARK_NOTIFICATION_MIRROR_RECOVERY_NOT_COMPLETE';
    throw error;
  }
  if (after.deliveryRows !== 1
      || after.deliveryStatus !== 'sent'
      || after.mirrorStatus !== 'mirrored'
      || after.activeLocks !== 0
      || after.claimCount !== before.claimCount + 1
      || after.sentAt !== before.sentAt
      || after.messageIdHash !== before.messageIdHash) {
    fail(
      'Mirror recovery changed sent authority or did not reconcile exactly once',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_PARITY_FAILED',
      {
        deliveryRows: after.deliveryRows,
        deliveryStatus: after.deliveryStatus,
        mirrorStatus: after.mirrorStatus,
        firstClaimCount: before.claimCount,
        recoveredClaimCount: after.claimCount,
      },
    );
  }
  return true;
}

async function inspectLarkMirror(target) {
  const [aiRows, logRows] = await Promise.all([
    target.repository.listByFieldValues(
      target.tableIds.aiRuns,
      'ai_run_key',
      [target.recovery.aiRunKey],
    ),
    target.repository.listByFieldValues(
      target.tableIds.notificationLog,
      'ai_run_key',
      [target.recovery.aiRunKey],
    ),
  ]);
  const exactAi = aiRows.filter((record) => (
    String(scalar(record.fields.ai_run_key) ?? '') === target.recovery.aiRunKey
  ));
  const exactLog = logRows.filter((record) => (
    String(scalar(record.fields.ai_run_key) ?? '') === target.recovery.aiRunKey
  ));
  if (exactAi.length !== 1 || exactLog.length > 1) {
    fail(
      'Retained partial Lark mirror identity is ambiguous',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_LARK_IDENTITY_INVALID',
      { aiRows: exactAi.length, notificationLogRows: exactLog.length },
    );
  }
  return Object.freeze({
    aiRows: exactAi.length,
    notificationLogRows: exactLog.length,
    aiRunMarkedSent: boolean(exactAi[0].fields.sent_to_group, 'sent_to_group'),
    notificationLogStatus: exactLog.length === 1
      ? String(scalar(exactLog[0].fields.attempt_status) ?? '')
      : null,
  });
}

async function verifyLarkMirror(target) {
  const state = await inspectLarkMirror(target);
  if (state.notificationLogRows !== 1
      || state.aiRunMarkedSent !== true
      || state.notificationLogStatus !== 'sent') {
    fail(
      'Recovered Lark mirror parity failed',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_LARK_PARITY_FAILED',
      state,
    );
  }
  const [aiRows, logRows] = await Promise.all([
    target.repository.listByFieldValues(
      target.tableIds.aiRuns,
      'ai_run_key',
      [target.recovery.aiRunKey],
    ),
    target.repository.listByFieldValues(
      target.tableIds.notificationLog,
      'ai_run_key',
      [target.recovery.aiRunKey],
    ),
  ]);
  const ai = aiRows.find((record) => (
    String(scalar(record.fields.ai_run_key) ?? '') === target.recovery.aiRunKey
  ));
  const log = logRows.find((record) => (
    String(scalar(record.fields.ai_run_key) ?? '') === target.recovery.aiRunKey
  ));
  const sentAt = Number(scalar(ai.fields.sent_at));
  const logSentAt = Number(scalar(log.fields.sent_at));
  if (!Number.isFinite(sentAt) || !Number.isFinite(logSentAt)) {
    fail(
      'Recovered Lark mirror timestamps are invalid',
      'LARK_NOTIFICATION_MIRROR_RECOVERY_LARK_PARITY_FAILED',
    );
  }
  return Object.freeze({
    notificationLogRows: 1,
    aiRunMarkedSent: true,
    sentAt,
    logSentAt,
  });
}

function publicDelivery(value) {
  return Object.freeze({
    deliveryRows: value.deliveryRows,
    deliveryStatus: value.deliveryStatus,
    mirrorStatus: value.mirrorStatus,
    sentAtPresent: Number.isFinite(value.sentAt),
    messageIdHashPresent: /^[a-f0-9]{64}$/u.test(value.messageIdHash ?? ''),
  });
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
      'LARK_NOTIFICATION_MIRROR_RECOVERY_COMMAND_FAILED',
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

function text(command, args, options = {}) {
  return run(command, args, options).stdout;
}

async function privateJson(path, value) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
  });
  await chmod(path, 0o600);
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

function boolean(value, fieldName) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  fail(
    `${fieldName} must be Boolean`,
    'LARK_NOTIFICATION_MIRROR_RECOVERY_LARK_RESPONSE_INVALID',
    { fieldName },
  );
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    fail(
      `${fieldName} must be a positive integer`,
      'LARK_NOTIFICATION_MIRROR_RECOVERY_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return number;
}

function exact(value, expected, fieldName) {
  if (value !== expected) {
    fail(
      `Mirror recovery requires ${fieldName}=${expected}`,
      'LARK_NOTIFICATION_MIRROR_RECOVERY_ENVIRONMENT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_MIRROR_RECOVERY_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function optionalText(value) {
  if (value === null || value === undefined || value === '') return null;
  return String(value).trim() || null;
}

function requireHash(value, fieldName) {
  const textValue = requireText(value, fieldName);
  if (!/^[a-f0-9]{64}$/u.test(textValue)) {
    fail(
      `${fieldName} must be lowercase SHA-256`,
      'LARK_NOTIFICATION_MIRROR_RECOVERY_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return textValue;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    /(?:token|secret|password|authorization|tableId|queueId|accountId|groupId)/iu.test(key)
      ? `${key}Redacted`
      : key,
    /(?:token|secret|password|authorization|tableId|queueId|accountId|groupId)/iu.test(key)
      ? true
      : scrub(nested),
  ]));
}

function fail(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationMirrorRecoveryExactTerminalError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
