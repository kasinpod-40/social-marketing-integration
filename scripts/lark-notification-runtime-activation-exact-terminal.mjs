#!/usr/bin/env node

import { randomUUID } from 'node:crypto';
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
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIRMATION,
  LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONTRACT_VERSION,
  LARK_NOTIFICATION_RUNTIME_ROLLBACK_CONFIRMATION,
  assertLarkNotificationRuntimeActivationConfirmation,
  assertLarkNotificationRuntimeActivationStable,
  assertLarkNotificationRuntimeSettingsState,
  buildLarkNotificationRuntimeActivationReadbackSql,
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
} from './lib/woocommerce-final-one-command.js';
import { LARK_EXECUTIVE_DESTINATION_KEY_HASH } from '../packages/config/src/lark-notification-runtime-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';
import { resolveLarkNotificationControlledUatTables } from './lib/lark-notification-controlled-uat.js';

const ROOT = resolve(process.cwd());
const WORKER_NAME = 'social-mkt-sync-worker';
const SOURCE_CONFIG = resolve(
  process.env.MKT_LARK_NOTIFICATION_RUNTIME_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const OUTPUT_ROOT = resolve(
  process.env.MKT_LARK_NOTIFICATION_RUNTIME_EVIDENCE_ROOT
    ?? 'outputs/lark-notification-runtime-activation',
);
const DEFAULT_OBSERVATION_MS = 30_000;

let stage = 'init';
let action = 'plan';
let context = null;
let primaryError = null;
let safeRestoreError = null;
let settingsRestoreError = null;
let activationCompleted = false;
let activeDeploymentMayExist = false;
let settingsMayBeActive = false;

try {
  action = parseArgs(process.argv.slice(2));
  if (action === 'plan') {
    printPlan();
  } else if (action === 'activate') {
    await activate();
  } else {
    await rollback();
  }
} catch (error) {
  primaryError = error;
  process.exitCode = 1;
} finally {
  if (action === 'activate' && primaryError && context && !activationCompleted) {
    if (settingsMayBeActive) {
      try {
        stage = 'failure-restore-report-settings';
        await writeSettingsState(context, false);
        await assertSettingsState(context, false);
        settingsMayBeActive = false;
      } catch (error) {
        settingsRestoreError = error;
        process.exitCode = 1;
      }
    }
    if (activeDeploymentMayExist) {
      try {
        stage = 'failure-restore-safe-worker';
        await deployAndVerify(context, context.safeConfigPath, 'failure-safe-restore');
        activeDeploymentMayExist = false;
      } catch (error) {
        safeRestoreError = error;
        process.exitCode = 1;
      }
    }
  }

  if (primaryError || safeRestoreError || settingsRestoreError) {
    process.stderr.write(`${JSON.stringify({
      ok: false,
      contractVersion: LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONTRACT_VERSION,
      action,
      stage,
      code: primaryError?.code
        ?? settingsRestoreError?.code
        ?? safeRestoreError?.code
        ?? 'LARK_NOTIFICATION_RUNTIME_ACTIVATION_FAILED',
      message: primaryError?.message
        ?? settingsRestoreError?.message
        ?? safeRestoreError?.message
        ?? 'Notification Runtime activation failed',
      details: scrub(primaryError?.details ?? {}),
      safeWorkerRestored: Boolean(context && !activeDeploymentMayExist && !safeRestoreError),
      reportSettingsRestored: Boolean(context && !settingsMayBeActive && !settingsRestoreError),
      queueAdmissionCount: 0,
      additionalMessageSendCount: 0,
      automationActivationCount: 0,
      scheduleActivationCount: 0,
      production: 'BLOCKED',
    }, null, 2)}\n`);
  }
}

async function activate() {
  const setup = await prepare('activate');
  context = setup;

  stage = 'assert-fresh-activation-evidence';
  await assertFreshEvidence(setup.evidenceDir, [
    'activation-summary.json',
    '02-activation.attempt.json',
  ]);

  stage = 'remote-read-only-preflight';
  const beforeD1 = readD1State(setup);
  const beforeLark = await readLarkCloseout(setup);
  await privateJson(join(setup.evidenceDir, '01-read-only-preflight.json'), {
    contractVersion: LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONTRACT_VERSION,
    repositoryHead: setup.repositoryHead,
    notificationDelivery: beforeD1,
    larkCloseout: beforeLark,
    activatedReportSettingCount: setup.settingsAuthority.baseline.length,
    queueAdmissionCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });

  stage = 'record-activation-attempt';
  await privateJson(join(setup.evidenceDir, '02-activation.attempt.json'), {
    contractVersion: LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONTRACT_VERSION,
    repositoryHead: setup.repositoryHead,
    activatedReportSettingCount: setup.settingsAuthority.baseline.length,
    attemptedAt: new Date().toISOString(),
    queueAdmissionCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });

  stage = 'deploy-reviewed-runtime-worker';
  activeDeploymentMayExist = true;
  const activeVersion = await deployAndVerify(
    setup,
    setup.activeConfigPath,
    'runtime-active',
  );

  stage = 'activate-exact-report-settings';
  settingsMayBeActive = true;
  await writeSettingsState(setup, true);
  await assertSettingsState(setup, true);

  stage = 'bounded-no-admission-observation';
  await sleep(readObservationMs(setup.env));

  stage = 'final-readback';
  const afterD1 = readD1State(setup);
  const deliveryStability = assertLarkNotificationRuntimeActivationStable(
    beforeD1,
    afterD1,
  );
  const afterLark = await readLarkCloseout(setup);
  if (JSON.stringify(beforeLark) !== JSON.stringify(afterLark)) {
    fail(
      'Runtime activation changed retained Lark notification closeout state',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_LARK_DRIFT',
      { before: beforeLark, after: afterLark },
    );
  }
  await assertSettingsState(setup, true);

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONTRACT_VERSION,
    phase: 'active',
    repositoryHead: setup.repositoryHead,
    activeVersion,
    trafficPercentage: 100,
    runtimeEnabled: true,
    sendEnabled: true,
    mirrorEnabled: true,
    runtimeMode: 'runtime',
    activatedReportSettingCount: setup.settingsAuthority.baseline.length,
    deliveryRows: deliveryStability.deliveryRows,
    retainedNotificationMessageCount: beforeD1.deliveryRows,
    additionalDeliveryRows: 0,
    additionalMessageSendCount: 0,
    notificationLogRows: afterLark.notificationLogRows,
    controlledUatSentStable: true,
    queueAdmissionCount: 0,
    notificationProducerEnabled: false,
    notificationFlagsActive: true,
    reportSettingsActive: true,
    rollbackAvailable: true,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
    nextGate: 'notification_admission_requires_separate_approval',
  });
  await privateJson(join(setup.evidenceDir, 'activation-summary.json'), summary);
  activationCompleted = true;
  settingsMayBeActive = false;
  activeDeploymentMayExist = false;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function rollback() {
  const setup = await prepare('rollback');
  context = setup;

  stage = 'assert-fresh-rollback-evidence';
  await assertFreshEvidence(setup.evidenceDir, [
    'rollback-summary.json',
    'rollback.attempt.json',
  ]);

  stage = 'rollback-read-only-preflight';
  const beforeD1 = readD1State(setup);
  const beforeLark = await readLarkCloseout(setup);
  await privateJson(join(setup.evidenceDir, 'rollback.attempt.json'), {
    contractVersion: LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONTRACT_VERSION,
    repositoryHead: setup.repositoryHead,
    attemptedAt: new Date().toISOString(),
    queueAdmissionCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });

  stage = 'deploy-safe-worker';
  const safeVersion = await deployAndVerify(setup, setup.safeConfigPath, 'manual-rollback');

  stage = 'restore-exact-report-settings';
  await writeSettingsState(setup, false);
  await assertSettingsState(setup, false);

  stage = 'rollback-final-readback';
  const afterD1 = readD1State(setup);
  assertLarkNotificationRuntimeActivationStable(beforeD1, afterD1);
  const afterLark = await readLarkCloseout(setup);
  if (JSON.stringify(beforeLark) !== JSON.stringify(afterLark)) {
    fail(
      'Runtime rollback changed retained Lark notification closeout state',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_LARK_DRIFT',
    );
  }

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONTRACT_VERSION,
    phase: 'rolled_back',
    repositoryHead: setup.repositoryHead,
    safeVersion,
    trafficPercentage: 100,
    runtimeEnabled: false,
    sendEnabled: false,
    mirrorEnabled: false,
    runtimeMode: 'disabled',
    restoredReportSettingCount: setup.settingsAuthority.baseline.length,
    additionalDeliveryRows: 0,
    additionalMessageSendCount: 0,
    queueAdmissionCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });
  await privateJson(join(setup.evidenceDir, 'rollback-summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function prepare(mode) {
  stage = 'load-local-environment';
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertLarkNotificationRuntimeActivationConfirmation(env, mode);
  exact(env.MKT_ENV, 'development', 'MKT_ENV');
  exact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  exact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  stage = 'repository-preflight';
  const repositoryHead = exactMainHead();
  const evidenceDir = resolve(OUTPUT_ROOT, repositoryHead);
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);

  stage = 'local-focused-gates';
  run('node', ['--test',
    'tests/application/job-catalog.test.js',
    'tests/application/lark-notification-active-job-router.test.js',
    'tests/application/lark-notification-runtime-activation.test.js',
    'tests/config/lark-notification-runtime-config.test.js',
  ], { stdio: 'inherit' });
  run('npm', ['run', 'check'], { stdio: 'inherit' });

  stage = 'assert-no-notification-schedule-producer';
  const scheduledJobsSource = await readFile(
    resolve('apps/sync-worker/src/scheduled-jobs.js'),
    'utf8',
  );
  if (/LARK_NOTIFICATION_SEND/u.test(scheduledJobsSource)) {
    fail(
      'Runtime activation cannot run after Notification schedule admission is implemented',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SCHEDULE_PRESENT',
    );
  }

  stage = 'resolve-exact-lark-authority';
  const client = createLarkBitableClientFromEnv(env);
  const tableIds = resolveLarkNotificationControlledUatTables(await client.listTables());
  const repository = new LarkRecordRepository({ client });
  const syncEngine = new TableSyncEngine();
  const executiveRows = await repository.listByFieldValues(
    tableIds.aiRuns,
    'scope_type',
    ['executive'],
  );
  const previews = selectLarkNotificationRuntimeExecutivePreviews(executiveRows);
  const sourceReportIds = [...new Set(previews.flatMap((record) => (
    parseIds(record.fields.source_report_ids_json)
  )))].sort();
  const snapshotRows = await repository.listByFieldValues(
    tableIds.reportSnapshots,
    'report_id',
    sourceReportIds,
  );
  const settingKeys = [...new Set(sourceReportIds.map((reportId) => {
    const matches = snapshotRows.filter((record) => (
      String(scalar(record?.fields?.report_id) ?? '') === reportId
    ));
    if (matches.length !== 1) {
      fail(
        'Runtime activation could not resolve one exact source Report Snapshot',
        'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SNAPSHOT_INVALID',
        { matchCount: matches.length },
      );
    }
    return requireText(
      scalar(matches[0].fields.report_setting_key),
      'report_setting_key',
    );
  }))].sort();
  const settingRows = await repository.listByFieldValues(
    tableIds.reportSettings,
    'report_setting_key',
    settingKeys,
  );
  const expectedState = mode === 'activate' ? 'inactive' : 'either';
  const settingsAuthority = resolveLarkNotificationRuntimeActivationSettings({
    previews,
    snapshots: snapshotRows,
    settings: settingRows,
    expectedState,
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });

  stage = 'build-private-runtime-configs';
  const sourceText = await readFile(SOURCE_CONFIG, 'utf8');
  const sourceConfig = parseJsoncObject(sourceText);
  const activeConfig = buildLarkNotificationRuntimeActivationWranglerConfig(
    sourceText,
    tableIds,
    { active: true },
  );
  const safeConfig = buildLarkNotificationRuntimeActivationWranglerConfig(
    sourceText,
    tableIds,
    { active: false },
  );
  if (!activeConfig.scheduleConfigPreserved || !safeConfig.scheduleConfigPreserved
      || JSON.stringify(activeConfig.config.triggers ?? null)
        !== JSON.stringify(safeConfig.config.triggers ?? null)) {
    fail(
      'Runtime activation must preserve the existing Worker trigger configuration exactly',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIG_INVALID',
    );
  }
  const generatedDir = resolve(evidenceDir, 'generated-config');
  await mkdir(generatedDir, { recursive: true, mode: 0o700 });
  const activeConfigPath = resolve(generatedDir, 'runtime-active.json');
  const safeConfigPath = resolve(generatedDir, 'runtime-safe.json');
  await writeGeneratedConfig(activeConfigPath, activeConfig.text);
  await writeGeneratedConfig(safeConfigPath, safeConfig.text);

  stage = 'resolve-cloudflare-target';
  const cloudflare = resolveCloudflareTarget(env, sourceText);
  const databaseName = resolveDatabaseName(sourceConfig);

  const prepared = {
    env,
    mode,
    repositoryHead,
    evidenceDir,
    sourceText,
    sourceConfig,
    activeConfigPath,
    safeConfigPath,
    databaseName,
    tableIds,
    client,
    repository,
    syncEngine,
    previews,
    settingsAuthority,
    cloudflare,
  };

  stage = 'dry-run-runtime-configs';
  run('npx', ['wrangler', 'deploy', '--dry-run', '--config', activeConfigPath], {
    env: cloudflare.wranglerEnv,
    stdio: 'inherit',
  });
  run('npx', ['wrangler', 'deploy', '--dry-run', '--config', safeConfigPath], {
    env: cloudflare.wranglerEnv,
    stdio: 'inherit',
  });

  return prepared;
}

async function writeSettingsState(target, active) {
  const rows = target.settingsAuthority.baseline.map((setting) => Object.freeze({
    report_setting_key: setting.reportSettingKey,
    ai_enabled: active,
    notification_enabled: active,
  }));
  const plan = await target.syncEngine.planByKey({
    repository: target.repository,
    tableId: target.tableIds.reportSettings,
    keyField: 'report_setting_key',
    rows,
  });
  if (plan.createRows.length !== 0) {
    fail(
      'Runtime activation must not create Report Settings',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SETTINGS_INVALID',
      { createRows: plan.createRows.length },
    );
  }
  const result = await target.syncEngine.executePlan(plan);
  if (result.created !== 0 || result.updated + result.skipped !== rows.length) {
    fail(
      'Runtime Report Settings did not reconcile every exact row',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SETTINGS_WRITE_FAILED',
    );
  }
}

async function assertSettingsState(target, active) {
  const records = await target.repository.listByFieldValues(
    target.tableIds.reportSettings,
    'report_setting_key',
    target.settingsAuthority.settingKeys,
  );
  return assertLarkNotificationRuntimeSettingsState(
    records,
    target.settingsAuthority,
    active,
  );
}

function readD1State(target) {
  const output = text('npx', [
    'wrangler', 'd1', 'execute', target.databaseName,
    '--remote',
    '--config', target.safeConfigPath,
    '--command', buildLarkNotificationRuntimeActivationReadbackSql(),
    '--json',
  ], { env: target.cloudflare.wranglerEnv });
  const row = extractLarkNotificationWranglerD1Rows(output)[0];
  return normalizeRemoteReadback(row);
}

function normalizeRemoteReadback(row = {}) {
  return Object.freeze({
    notificationTableCount: count(row.notification_table_count),
    notificationIndexCount: count(row.notification_index_count),
    activeLocks: count(row.active_locks),
    deliveryRows: count(row.delivery_rows),
    sentMirroredRows: count(row.sent_mirrored_rows),
    unsafeDeliveryRows: count(row.unsafe_delivery_rows),
    controlledUatRows: count(row.controlled_uat_rows),
    controlledUatSentMirroredRows: count(row.controlled_uat_sent_mirrored_rows),
  });
}

async function readLarkCloseout(target) {
  const [aiRows, logRows] = await Promise.all([
    target.repository.listByFieldValues(
      target.tableIds.aiRuns,
      'scope_type',
      ['executive'],
    ),
    target.repository.listByFieldValues(
      target.tableIds.notificationLog,
      'attempt_status',
      ['sent'],
    ),
  ]);
  const uatAi = aiRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  const uatLogs = logRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  if (uatAi.length !== 1
      || uatLogs.length !== 1
      || readBoolean(uatAi[0].fields.sent_to_group, 'sent_to_group') !== true
      || String(scalar(uatLogs[0].fields.attempt_status) ?? '') !== 'sent') {
    fail(
      'Runtime activation requires the verified Controlled UAT Lark closeout',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_LARK_CLOSEOUT_INVALID',
      { aiRows: uatAi.length, notificationLogRows: uatLogs.length },
    );
  }
  return Object.freeze({
    controlledUatAiRows: 1,
    notificationLogRows: 1,
    aiRunMarkedSent: true,
  });
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
        'Notification Runtime Worker version is not serving 100 percent',
        'LARK_NOTIFICATION_RUNTIME_ACTIVATION_DEPLOYMENT_INVALID',
      );
    }
    return versionId;
  } finally {
    await rm(outputPath, { force: true });
  }
}

function resolveCloudflareTarget(env, configText) {
  const wranglerEnv = buildWranglerOAuthEnvironment(env);
  const whoamiOutput = text('npx', ['wrangler', 'whoami', '--json'], {
    env: wranglerEnv,
  });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    preferredAccount: env.MKT_LARK_NOTIFICATION_RUNTIME_ACCOUNT,
    configText,
    whoamiOutput,
  });
  const selected = Object.freeze({ ...wranglerEnv, CLOUDFLARE_ACCOUNT_ID: accountId });
  resolveCloudflareBearerAuth({
    authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], {
      env: selected,
    }),
  });
  return Object.freeze({ accountId, wranglerEnv: selected });
}

function resolveDatabaseName(config) {
  const matches = Array.isArray(config?.d1_databases)
    ? config.d1_databases.filter((item) => item?.binding === 'MKT_STATE_DB')
    : [];
  if (matches.length !== 1) {
    fail(
      'Runtime activation requires one MKT_STATE_DB binding',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIG_INVALID',
      { bindingCount: matches.length },
    );
  }
  return requireText(matches[0].database_name, 'database_name');
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
      'Notification Runtime activation requires clean exact current main',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_REPOSITORY_INVALID',
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

async function assertFreshEvidence(directory, names) {
  for (const name of names) {
    try {
      await stat(join(directory, name));
      fail(
        'Notification Runtime action already has retained evidence; blind rerun is forbidden',
        'LARK_NOTIFICATION_RUNTIME_ACTIVATION_ALREADY_ATTEMPTED',
        { evidenceName: name },
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function parseArgs(args) {
  const execute = args.includes('--execute');
  const rollbackMode = args.includes('--rollback');
  const unknown = args.filter((arg) => !['--execute', '--rollback'].includes(arg));
  if (unknown.length > 0 || (execute && rollbackMode)) {
    fail(
      'Notification Runtime terminal accepts either --execute or --rollback',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_ARGUMENT_INVALID',
      { unknown },
    );
  }
  if (execute) return 'activate';
  if (rollbackMode) return 'rollback';
  return 'plan';
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONTRACT_VERSION,
    activationConfirmation: LARK_NOTIFICATION_RUNTIME_ACTIVATION_CONFIRMATION,
    rollbackConfirmation: LARK_NOTIFICATION_RUNTIME_ROLLBACK_CONFIRMATION,
    activation: [
      'verify retained one-message Controlled UAT closeout',
      'resolve exact Executive 1D/3D/7D/30D source Report Settings',
      'deploy notification-only Worker runtime mode',
      'enable AI and notification on exact source Settings',
      'prove zero Queue admission and zero additional messages',
    ],
    rollback: [
      'deploy all-false Safe Worker',
      'restore exact source Report Settings false',
    ],
    queueAdmissionCount: 0,
    notificationProducerEnabled: false,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
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
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_COMMAND_FAILED',
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

function parseIds(value) {
  let parsed;
  try {
    parsed = JSON.parse(String(scalar(value) ?? ''));
  } catch {
    fail(
      'Executive source Report list is invalid',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SOURCE_INVALID',
    );
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    fail(
      'Executive source Report list is empty',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_SOURCE_INVALID',
    );
  }
  return parsed.map((item) => requireText(item, 'source_report_id'));
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

function readBoolean(value, fieldName) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  fail(
    `${fieldName} must be Boolean`,
    'LARK_NOTIFICATION_RUNTIME_ACTIVATION_LARK_RESPONSE_INVALID',
    { fieldName },
  );
}

function readObservationMs(env) {
  const number = Number(
    env.MKT_LARK_NOTIFICATION_RUNTIME_OBSERVATION_MS ?? DEFAULT_OBSERVATION_MS,
  );
  if (!Number.isSafeInteger(number) || number < 10_000 || number > 120_000) {
    fail(
      'Runtime activation observation must be 10-120 seconds',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_INPUT_REQUIRED',
      { fieldName: 'MKT_LARK_NOTIFICATION_RUNTIME_OBSERVATION_MS' },
    );
  }
  return number;
}

function count(value) {
  const number = Number(value ?? 0);
  if (!Number.isSafeInteger(number) || number < 0) {
    fail(
      'Runtime activation readback count is invalid',
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_REMOTE_STATE_INVALID',
    );
  }
  return number;
}

function exact(value, expected, fieldName) {
  if (value !== expected) {
    fail(
      `Notification Runtime activation requires ${fieldName}=${expected}`,
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_ENVIRONMENT_INVALID',
      { fieldName },
    );
  }
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_RUNTIME_ACTIVATION_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
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
  error.name = 'LarkNotificationRuntimeActivationTerminalError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
