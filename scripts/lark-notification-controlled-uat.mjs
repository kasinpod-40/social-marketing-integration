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
import { dirname, join, relative, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { listCloudflareQueuesViaApi } from './lib/cloudflare-queue-list-rest.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION,
  LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
  assertLarkNotificationControlledUatConfirmation,
  assertLarkNotificationControlledUatDelivered,
  assertLarkNotificationControlledUatReplayStable,
  buildLarkNotificationControlledUatReadbackSql,
  buildLarkNotificationControlledUatRow,
  buildLarkNotificationControlledUatWranglerConfig,
  normalizeLarkNotificationControlledUatReadback,
  resolveLarkNotificationControlledUatTables,
  selectLarkNotificationExecutivePreview,
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

const ROOT = resolve(process.cwd());
const WORKER_NAME = 'social-mkt-sync-worker';
const SOURCE_CONFIG = resolve(
  process.env.MKT_LARK_NOTIFICATION_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const OUTPUT_ROOT = resolve(
  process.env.MKT_LARK_NOTIFICATION_UAT_EVIDENCE_ROOT
    ?? 'outputs/lark-notification-controlled-uat',
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
      contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
      stage,
      code: primaryError?.code
        ?? safeRestoreError?.code
        ?? settingsRestoreError?.code
        ?? 'LARK_NOTIFICATION_CONTROLLED_UAT_FAILED',
      message: primaryError?.message
        ?? safeRestoreError?.message
        ?? settingsRestoreError?.message
        ?? 'Controlled notification UAT failed',
      details: scrub(primaryError?.details ?? {}),
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
  assertLarkNotificationControlledUatConfirmation(env);
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
    'tests/application/cloudflare-queue-list-rest.test.js',
    'tests/application/lark-notification-controlled-uat.test.js',
    'tests/application/deliver-lark-executive-notification.test.js',
    'tests/application/lark-notification-active-job-router.test.js',
    'tests/connectors/lark-notification-delivery-source.test.js',
    'tests/connectors/d1-lark-notification-delivery-store.test.js',
  ], { stdio: 'inherit' });
  run('npm', ['run', 'check'], { stdio: 'inherit' });

  stage = 'resolve-exact-lark-tables';
  const client = createLarkBitableClientFromEnv(env);
  const tableIds = resolveLarkNotificationControlledUatTables(await client.listTables());
  const repository = new LarkRecordRepository({ client });
  const syncEngine = new TableSyncEngine();
  const executiveRows = await repository.listByFieldValues(
    tableIds.aiRuns,
    'scope_type',
    ['executive'],
  );
  const sourcePreview = selectLarkNotificationExecutivePreview(executiveRows, { windowDays: 1 });
  const uat = buildLarkNotificationControlledUatRow(sourcePreview);

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
      'Controlled notification UAT must not change Wrangler trigger configuration',
      'LARK_NOTIFICATION_CONTROLLED_UAT_CONFIG_INVALID',
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
      bearerToken: queueAuthEnvironment(cloudflare).CLOUDFLARE_API_TOKEN,
    })),
    queueName,
  );

  context = {
    env,
    repositoryHead,
    evidenceDir,
    sourceConfig,
    sourceText,
    activeConfigPath,
    safeConfigPath,
    databaseName,
    queueName,
    queueId,
    tableIds,
    client,
    repository,
    syncEngine,
    cloudflare,
    sourcePreview,
    uat,
    settingsBaseline: null,
  };

  stage = 'remote-read-only-preflight';
  const initialReadback = readD1State(context);
  if (initialReadback.deliveryRows !== 0) {
    fail(
      'Controlled notification UAT requires no prior delivery for this exact identity',
      'LARK_NOTIFICATION_CONTROLLED_UAT_ALREADY_ATTEMPTED',
      { deliveryRows: initialReadback.deliveryRows },
    );
  }
  await privateJson(join(evidenceDir, '01-read-only-preflight.json'), {
    contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    repositoryHead,
    sourcePreviewKeyHash: sha256(context.uat.sourceAiRunKey),
    uatAiRunKeyHash: sha256(context.uat.aiRunKey),
    sourceReportCount: context.uat.sourceReportIds.length,
    notificationSchema: {
      tableCount: initialReadback.notificationTableCount,
      indexCount: initialReadback.notificationIndexCount,
      deliveryRows: initialReadback.deliveryRows,
    },
    activeLocks: initialReadback.activeLocks,
    tableMappingsResolved: true,
    rawTableIdsPersistedInPublicEvidence: false,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });

  stage = 'upsert-dedicated-uat-ai-run';
  const uatPlan = await syncEngine.planByKey({
    repository,
    tableId: tableIds.aiRuns,
    keyField: 'ai_run_key',
    rows: [uat.fields],
  });
  if (uatPlan.updateRows.length !== 0) {
    fail(
      'Existing controlled UAT AI row differs from the reviewed source identity',
      'LARK_NOTIFICATION_CONTROLLED_UAT_ROW_DRIFT',
      { updateRows: uatPlan.updateRows.length },
    );
  }
  const uatWrite = await syncEngine.executePlan(uatPlan);
  if (uatWrite.created + uatWrite.skipped !== 1 || uatWrite.updated !== 0) {
    fail(
      'Controlled UAT AI row did not reconcile exactly once',
      'LARK_NOTIFICATION_CONTROLLED_UAT_ROW_WRITE_FAILED',
    );
  }

  stage = 'validate-source-report-and-destination-chain';
  const requestBeforeSettings = await loadLarkNotificationDeliveryRequest({
    repository,
    tables: tableIds,
    aiRunKey: uat.aiRunKey,
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
  await privateJson(join(evidenceDir, '02-active-deployment.json'), {
    contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    repositoryHead,
    activeVersion,
    trafficPercentage: 100,
    notificationRuntimeEnabled: true,
    notificationSendEnabled: true,
    notificationMirrorEnabled: true,
    allOtherExecutionFlagsFalse: true,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });

  stage = 'build-stable-queue-job';
  const requestedAt = Date.now();
  const operationId = `lark_notification_uat_${sha256(uat.aiRunKey).slice(0, 32)}`;
  const job = buildLarkNotificationControlledUatJob({
    aiRunKey: uat.aiRunKey,
    operationId,
    requestedAt,
  });
  const jobHash = sha256(JSON.stringify(job));

  stage = 'send-first-controlled-message';
  await sendQueueOnce(context, job, join(evidenceDir, '03-first-send.attempt.json'), jobHash);
  const first = await pollDelivered(context);
  const firstLark = await verifyLarkMirror(context);
  await privateJson(join(evidenceDir, '04-first-send-verified.json'), {
    contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    operationIdHash: sha256(operationId),
    jobSha256: jobHash,
    delivery: publicDelivery(first),
    lark: firstLark,
    messageSendCount: 1,
    notificationLogRows: 1,
    aiRunMarkedSent: true,
  });

  stage = 'send-exact-replay';
  await sendQueueOnce(context, job, join(evidenceDir, '05-replay-send.attempt.json'), jobHash);
  await sleep(Number(env.MKT_LARK_NOTIFICATION_UAT_REPLAY_WAIT_MS ?? 10_000));
  const replay = assertLarkNotificationControlledUatReplayStable(first, readD1State(context));
  const replayLark = await verifyLarkMirror(context);
  if (JSON.stringify(firstLark) !== JSON.stringify(replayLark)) {
    fail(
      'Controlled notification replay changed Lark mirror state',
      'LARK_NOTIFICATION_CONTROLLED_UAT_REPLAY_INVALID',
    );
  }
  await privateJson(join(evidenceDir, '06-replay-verified.json'), {
    contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    operationIdHash: sha256(operationId),
    jobSha256: jobHash,
    replay,
    messageSendCount: 0,
    notificationLogRows: 1,
    aiRunMarkedSent: true,
  });

  stage = 'restore-safe-worker';
  const safeVersion = await deployAndVerify(context, safeConfigPath, 'safe-restore');
  activeDeploymentStarted = false;

  stage = 'restore-report-settings';
  await writeSettingsState(context, false);
  await assertSettingsState(context, false);
  settingsActivated = false;

  stage = 'final-readback';
  const final = assertLarkNotificationControlledUatDelivered(readD1State(context));
  const finalLark = await verifyLarkMirror(context);
  const summary = {
    ok: true,
    contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    phase: 'complete',
    repositoryHead,
    activeVersion,
    safeVersion,
    trafficPercentage: 100,
    notificationMessageCount: 1,
    replayMessageCount: 0,
    deliveryRows: final.deliveryRows,
    notificationLogRows: finalLark.notificationLogRows,
    aiRunMarkedSent: finalLark.aiRunMarkedSent,
    exactReplayDeduped: true,
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
    contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    confirmation: LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION,
    sequence: [
      'read-only exact Lark/D1 preflight',
      'create one dedicated 1D Executive UAT AI row without changing Preview rows',
      'temporarily enable exact source Report Settings',
      'deploy one notification-only active Worker window',
      'send one exact Queue job and verify one group message plus one Log row',
      'replay the same job and prove the authoritative sent row is unchanged',
      'restore Worker flags and Report Settings false',
    ],
    group: 'Social MKT Executive Reports',
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    fail(
      'Controlled notification UAT accepts only --execute',
      'LARK_NOTIFICATION_CONTROLLED_UAT_ARGUMENT_INVALID',
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
      'Controlled notification UAT requires clean exact current main',
      'LARK_NOTIFICATION_CONTROLLED_UAT_REPOSITORY_INVALID',
      { branch, head, originMain, dirtyPathCount: dirty ? dirty.split(/\r?\n/u).length : 0 },
    );
  }
  return head;
}

async function assertFreshAttempt(directory) {
  for (const name of ['summary.json', '03-first-send.attempt.json', '05-replay-send.attempt.json']) {
    try {
      await stat(join(directory, name));
      fail(
        'Controlled notification UAT evidence already exists; blind rerun is forbidden',
        'LARK_NOTIFICATION_CONTROLLED_UAT_ALREADY_ATTEMPTED',
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

function queueAuthEnvironment(cloudflare) {
  return {
    ...cloudflare.wranglerEnv,
    CLOUDFLARE_API_TOKEN: freshQueueBearer(cloudflare),
  };
}

function freshQueueBearer(cloudflare) {
  const auth = resolveCloudflareBearerAuth({
    authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], {
      env: cloudflare.wranglerEnv,
    }),
  });
  if (auth.type !== cloudflare.authType) {
    fail(
      'Cloudflare authentication type changed during controlled UAT',
      'LARK_NOTIFICATION_CONTROLLED_UAT_AUTH_DRIFT',
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
      'Controlled notification UAT requires one MKT_STATE_DB binding',
      'LARK_NOTIFICATION_CONTROLLED_UAT_CONFIG_INVALID',
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
      'Controlled notification UAT requires one MKT_SYNC_QUEUE producer',
      'LARK_NOTIFICATION_CONTROLLED_UAT_CONFIG_INVALID',
      { producerCount: matches.length },
    );
  }
  return requireText(matches[0].queue, 'queue');
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
        'Controlled notification UAT requires one exact source Setting',
        'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_INVALID',
        { matchCount: matches.length },
      );
    }
    const fields = matches[0].fields;
    const enabled = boolean(fields.enabled, 'enabled');
    const aiEnabled = boolean(fields.ai_enabled, 'ai_enabled');
    const notificationEnabled = boolean(fields.notification_enabled, 'notification_enabled');
    if (!enabled || aiEnabled || notificationEnabled) {
      fail(
        'Controlled notification UAT requires enabled source Settings with AI/notification initially false',
        'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_INVALID',
        { enabled, aiEnabled, notificationEnabled },
      );
    }
    return Object.freeze({
      recordId: matches[0].recordId,
      reportSettingKey: settingKey,
      customerProfile,
      enabled,
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
      'Controlled notification UAT must not create Report Settings',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_INVALID',
      { createRows: plan.createRows.length },
    );
  }
  const result = await engine.executePlan(plan);
  if (result.created !== 0 || result.updated + result.skipped !== rows.length) {
    fail(
      'Controlled notification UAT Settings parity failed',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_WRITE_FAILED',
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
    if (matches.length !== 1) {
      fail(
        'Controlled notification UAT Settings readback is ambiguous',
        'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_INVALID',
      );
    }
    const expectedAi = active ? true : baseline.aiEnabled;
    const expectedNotification = active ? true : baseline.notificationEnabled;
    if (boolean(matches[0].fields.ai_enabled, 'ai_enabled') !== expectedAi
      || boolean(matches[0].fields.notification_enabled, 'notification_enabled')
        !== expectedNotification) {
      fail(
        'Controlled notification UAT Settings readback drifted',
        'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_READBACK_FAILED',
      );
    }
  }
}

async function deployAndVerify(target, configPath, label) {
  const outputPath = resolve(
    target.evidenceDir,
    `.wrangler-${label}-${randomUUID()}.ndjson`,
  );
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
        'Controlled notification UAT Worker version is not serving 100 percent',
        'LARK_NOTIFICATION_CONTROLLED_UAT_DEPLOYMENT_INVALID',
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
      'Controlled notification Queue attempt is uncertain; blind resend is forbidden',
      'LARK_NOTIFICATION_CONTROLLED_UAT_QUEUE_ATTEMPT_UNCERTAIN',
    );
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  await privateJson(attemptPath, {
    contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    aiRunKeyHash: sha256(target.uat.aiRunKey),
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
      'Cloudflare Queue did not confirm controlled notification admission',
      'LARK_NOTIFICATION_CONTROLLED_UAT_QUEUE_SEND_FAILED',
      { status: response.status },
    );
  }
}

async function pollDelivered(target) {
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
      event: 'lark_notification_uat_progress',
      poll: index,
      deliveryRows: last.deliveryRows,
      deliveryStatus: last.deliveryStatus,
      mirrorStatus: last.mirrorStatus,
      activeLocks: last.activeLocks,
    })}\n`);
    try {
      return assertLarkNotificationControlledUatDelivered(last);
    } catch (error) {
      if (error?.code !== 'LARK_NOTIFICATION_CONTROLLED_UAT_DELIVERY_NOT_CONFIRMED') throw error;
    }
    if (index < maxPolls) await sleep(interval);
  }
  fail(
    'Controlled notification UAT delivery verification timed out',
    'LARK_NOTIFICATION_CONTROLLED_UAT_VERIFY_TIMEOUT',
    {
      deliveryRows: last?.deliveryRows ?? null,
      deliveryStatus: last?.deliveryStatus ?? null,
      mirrorStatus: last?.mirrorStatus ?? null,
    },
  );
}

function readD1State(target) {
  const sql = buildLarkNotificationControlledUatReadbackSql(target.uat.aiRunKey);
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

async function verifyLarkMirror(target) {
  const [aiRows, logRows] = await Promise.all([
    target.repository.listByFieldValues(
      target.tableIds.aiRuns,
      'ai_run_key',
      [target.uat.aiRunKey],
    ),
    target.repository.listByFieldValues(
      target.tableIds.notificationLog,
      'ai_run_key',
      [target.uat.aiRunKey],
    ),
  ]);
  const exactAi = aiRows.filter((record) => (
    String(scalar(record.fields.ai_run_key) ?? '') === target.uat.aiRunKey
  ));
  const exactLog = logRows.filter((record) => (
    String(scalar(record.fields.ai_run_key) ?? '') === target.uat.aiRunKey
  ));
  if (exactAi.length !== 1
      || exactLog.length !== 1
      || boolean(exactAi[0].fields.sent_to_group, 'sent_to_group') !== true
      || String(scalar(exactLog[0].fields.attempt_status) ?? '') !== 'sent') {
    fail(
      'Controlled notification Lark mirror parity failed',
      'LARK_NOTIFICATION_CONTROLLED_UAT_LARK_PARITY_FAILED',
      { aiRows: exactAi.length, notificationLogRows: exactLog.length },
    );
  }
  const sentAt = Number(scalar(exactAi[0].fields.sent_at));
  const logSentAt = Number(scalar(exactLog[0].fields.sent_at));
  if (!Number.isFinite(sentAt) || !Number.isFinite(logSentAt)) {
    fail(
      'Controlled notification Lark sent timestamps are invalid',
      'LARK_NOTIFICATION_CONTROLLED_UAT_LARK_PARITY_FAILED',
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
      'LARK_NOTIFICATION_CONTROLLED_UAT_COMMAND_FAILED',
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
    'LARK_NOTIFICATION_CONTROLLED_UAT_LARK_RESPONSE_INVALID',
    { fieldName },
  );
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    fail(
      `${fieldName} must be a positive integer`,
      'LARK_NOTIFICATION_CONTROLLED_UAT_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return number;
}

function exact(value, expected, fieldName) {
  if (value !== expected) {
    fail(
      `Controlled notification UAT requires ${fieldName}=${expected}`,
      'LARK_NOTIFICATION_CONTROLLED_UAT_ENVIRONMENT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_CONTROLLED_UAT_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
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
  error.name = 'LarkNotificationControlledUatOperatorError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
