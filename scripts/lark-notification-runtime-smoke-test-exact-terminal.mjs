#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { listCloudflareQueuesViaApi } from './lib/cloudflare-queue-list-rest.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  assertLarkNotificationRuntimeSettingsState,
  resolveLarkNotificationRuntimeActivationSettings,
  selectLarkNotificationRuntimeExecutivePreviews,
} from './lib/lark-notification-runtime-activation.js';
import {
  LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIRMATION,
  LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION,
  LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_EXPECTED_ACTIVE_VERSION,
  assertLarkNotificationRuntimeSmokeTestBaseline,
  assertLarkNotificationRuntimeSmokeTestConfirmation,
  assertLarkNotificationRuntimeSmokeTestDelivered,
  assertLarkNotificationRuntimeSmokeTestStable,
  buildLarkNotificationRuntimeSmokeTestJob,
  buildLarkNotificationRuntimeSmokeTestReadbackSql,
  buildLarkNotificationRuntimeSmokeTestRow,
  normalizeLarkNotificationRuntimeSmokeTestReadback,
  parseLarkNotificationRuntimeSmokeTestDeploymentStatus,
} from './lib/lark-notification-runtime-smoke-test.js';
import {
  extractLarkNotificationWranglerD1Rows,
} from './lib/lark-notification-remote-rollout-operator.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
  resolveWooCommerceQueueId,
} from './lib/woocommerce-final-one-command.js';
import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../packages/config/src/lark-notification-runtime-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { loadLarkNotificationDeliveryRequest } from '../packages/connectors/src/lark/lark-notification-delivery-source.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';
import {
  parseSourceReportIds,
  resolveLarkNotificationControlledUatTables,
} from './lib/lark-notification-controlled-uat.js';

const ROOT = resolve(process.cwd());
const SOURCE_CONFIG = resolve(
  process.env.MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const OUTPUT_ROOT = resolve(
  process.env.MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_EVIDENCE_ROOT
    ?? 'outputs/lark-notification-runtime-smoke-test',
);
const POLL_INTERVAL_MS = 2_000;
const MAX_POLLS = 90;
const OBSERVATION_MS = 15_000;

let stage = 'init';
let queueAttemptRecorded = false;
let queueAdmissionConfirmed = false;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
  } else {
    await executeSmokeTest();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_FAILED',
    message: error?.message ?? String(error),
    details: scrub(error?.details ?? {}),
    queueAttemptRecorded,
    queueAdmissionCount: queueAdmissionConfirmed ? 1 : 0,
    queueOutcomeUncertain: queueAttemptRecorded && !queueAdmissionConfirmed,
    blindRerunAllowed: !queueAttemptRecorded,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function executeSmokeTest() {
  stage = 'load-local-environment';
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertLarkNotificationRuntimeSmokeTestConfirmation(env);
  exact(env.MKT_ENV, 'development', 'MKT_ENV');
  exact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  exact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  stage = 'repository-preflight';
  const repositoryHead = exactMainHead();
  const evidenceDir = resolve(OUTPUT_ROOT, repositoryHead);
  await mkdir(evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(evidenceDir, 0o700);
  await assertFreshAttempt(evidenceDir);

  stage = 'local-focused-gates';
  run('node', ['--test',
    'tests/application/lark-notification-runtime-smoke-test.test.js',
    'tests/application/lark-notification-runtime-smoke-test-exact-terminal.test.js',
    'tests/application/lark-notification-active-job-router.test.js',
    'tests/application/deliver-lark-executive-notification.test.js',
    'tests/connectors/lark-notification-delivery-source.test.js',
    'tests/connectors/d1-lark-notification-delivery-store.test.js',
  ], { stdio: 'inherit' });
  run('npm', ['run', 'check'], { stdio: 'inherit' });

  stage = 'assert-no-notification-producer';
  const scheduledJobsSource = await readFile(
    resolve('apps/sync-worker/src/scheduled-jobs.js'),
    'utf8',
  );
  if (/LARK_NOTIFICATION_SEND/u.test(scheduledJobsSource)) {
    fail(
      'Runtime smoke test requires Notification schedule admission to remain absent',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_SCHEDULE_PRESENT',
    );
  }

  stage = 'resolve-local-topology';
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
    parseSourceReportIds(record.fields.source_report_ids_json)
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
        'Runtime smoke test could not resolve one exact source Report Snapshot',
        'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_SOURCE_INVALID',
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
  const settingsAuthority = resolveLarkNotificationRuntimeActivationSettings({
    previews,
    snapshots: snapshotRows,
    settings: settingRows,
    expectedState: 'active',
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });
  const sourcePreview = previews.find((record) => (
    Number(scalar(record.fields.window_days)) === 1
  ));
  if (!sourcePreview) {
    fail(
      'Runtime smoke test requires one reviewed 1D Executive Preview',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_SOURCE_INVALID',
    );
  }
  const smoke = buildLarkNotificationRuntimeSmokeTestRow(sourcePreview, repositoryHead);

  const context = Object.freeze({
    env,
    repositoryHead,
    evidenceDir,
    sourceText,
    sourceConfig,
    cloudflare,
    databaseName,
    queueName,
    queueId,
    tableIds,
    repository,
    syncEngine,
    previews,
    settingsAuthority,
    smoke,
  });

  stage = 'verify-reviewed-runtime-worker';
  const deployment = readDeploymentStatus(context);

  stage = 'verify-active-report-settings';
  await assertSettingsActive(context);

  stage = 'remote-read-only-preflight';
  const beforeD1 = assertLarkNotificationRuntimeSmokeTestBaseline(readD1State(context));
  const beforeLark = await readLarkBaseline(context);
  await privateJson(join(evidenceDir, '01-read-only-preflight.json'), {
    contractVersion: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION,
    repositoryHead,
    activeVersion: deployment.activeVersionId,
    trafficPercentage: deployment.trafficPercentage,
    sourceAiRunKeyHash: sha256(smoke.sourceAiRunKey),
    smokeAiRunKeyHash: sha256(smoke.aiRunKey),
    sourceReportCount: smoke.sourceReportIds.length,
    activatedReportSettingCount: settingsAuthority.baseline.length,
    deliveryRowsBefore: beforeD1.totalDeliveryRows,
    notificationLogRowsBefore: beforeLark.totalSentNotificationLogRows,
    controlledUatStable: true,
    queueAdmissionCount: 0,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  });

  stage = 'create-dedicated-runtime-smoke-ai-run';
  const smokePlan = await syncEngine.planByKey({
    repository,
    tableId: tableIds.aiRuns,
    keyField: 'ai_run_key',
    rows: [smoke.fields],
  });
  if (smokePlan.updateRows.length !== 0) {
    fail(
      'Existing Runtime smoke AI row differs from the reviewed source identity',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_ROW_DRIFT',
      { updateRows: smokePlan.updateRows.length },
    );
  }
  const smokeWrite = await syncEngine.executePlan(smokePlan);
  if (smokeWrite.created + smokeWrite.skipped !== 1 || smokeWrite.updated !== 0) {
    fail(
      'Runtime smoke AI row did not reconcile exactly once',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_ROW_WRITE_FAILED',
    );
  }

  stage = 'validate-runtime-delivery-chain';
  const request = await loadLarkNotificationDeliveryRequest({
    repository,
    tables: tableIds,
    aiRunKey: smoke.aiRunKey,
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });
  if (!request.settings.enabled
      || !request.settings.aiEnabled
      || !request.settings.notificationEnabled
      || request.snapshot.customerProfile !== 'integration_workspace'
      || JSON.stringify([...request.snapshot.sourceReportIds].sort())
        !== JSON.stringify([...smoke.sourceReportIds].sort())) {
    fail(
      'Runtime smoke delivery chain is not active or does not match the reviewed source',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_DELIVERY_CHAIN_INVALID',
    );
  }

  stage = 'build-exact-runtime-job';
  const requestedAt = Date.now();
  const operationId = `lark_notification_runtime_smoke_${sha256(smoke.aiRunKey).slice(0, 32)}`;
  const job = buildLarkNotificationRuntimeSmokeTestJob({
    aiRunKey: smoke.aiRunKey,
    operationId,
    requestedAt,
  });
  const jobHash = sha256(JSON.stringify(job));

  stage = 'record-one-queue-attempt';
  const attemptPath = join(evidenceDir, '02-queue-send.attempt.json');
  await privateJson(attemptPath, {
    contractVersion: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION,
    repositoryHead,
    aiRunKeyHash: sha256(smoke.aiRunKey),
    operationIdHash: sha256(operationId),
    jobSha256: jobHash,
    attemptedAt: new Date().toISOString(),
    maximumQueueAdmissionCount: 1,
  });
  queueAttemptRecorded = true;

  stage = 'send-one-runtime-queue-job';
  await sendQueueOnce(context, job);
  queueAdmissionConfirmed = true;

  stage = 'poll-sent-and-mirrored';
  const delivered = await pollDelivered(context, beforeD1);

  stage = 'verify-lark-mirror';
  const afterLark = await verifyLarkDelivery(context, beforeLark);

  stage = 'bounded-no-additional-admission-observation';
  await sleep(readObservationMs(env));
  const observed = readD1State(context);
  const stability = assertLarkNotificationRuntimeSmokeTestStable(delivered, observed);
  const observedLark = await verifyLarkDelivery(context, beforeLark);
  if (JSON.stringify(afterLark) !== JSON.stringify(observedLark)) {
    fail(
      'Runtime smoke test Lark mirror changed during the no-admission observation window',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_STABILITY_FAILED',
    );
  }
  await assertSettingsActive(context);
  const finalDeployment = readDeploymentStatus(context);

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION,
    phase: 'complete',
    repositoryHead,
    activeVersion: finalDeployment.activeVersionId,
    trafficPercentage: finalDeployment.trafficPercentage,
    runtimeEnabled: true,
    sendEnabled: true,
    mirrorEnabled: true,
    runtimeMode: 'runtime',
    activatedReportSettingCount: settingsAuthority.baseline.length,
    queueAdmissionCount: 1,
    deliveryRowsBefore: delivered.deliveryRowsBefore,
    deliveryRowsAfter: delivered.deliveryRowsAfter,
    additionalDeliveryRows: delivered.additionalDeliveryRows,
    additionalMessageSendCount: delivered.additionalMessageSendCount,
    exactSmokeDeliveryRows: stability.exactDeliveryRows,
    duplicateDeliveryRows: stability.duplicateDeliveryRows,
    notificationLogRowsBefore: beforeLark.totalSentNotificationLogRows,
    notificationLogRowsAfter: afterLark.totalSentNotificationLogRows,
    additionalNotificationLogRows: 1,
    deliveryStatus: delivered.smokeDeliveryStatus,
    mirrorStatus: delivered.smokeMirrorStatus,
    aiRunMarkedSent: afterLark.smokeAiRunMarkedSent,
    controlledUatStable: true,
    runtimeRemainsActive: true,
    reportSettingsRemainActive: true,
    notificationProducerEnabled: false,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
    nextGate: 'notification_admission_requires_separate_approval',
  });
  await privateJson(join(evidenceDir, 'smoke-test-summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    fail(
      'Runtime smoke test Terminal accepts only --execute',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONTRACT_VERSION,
    confirmation: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIRMATION,
    expectedActiveVersion: LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_EXPECTED_ACTIVE_VERSION,
    sequence: [
      'verify exact current main and reviewed Runtime Worker at 100 percent',
      'verify four Executive Report Settings remain active',
      'create one dedicated 1D Runtime smoke AI identity',
      'admit exactly one lark_notification_runtime Queue job',
      'verify exactly one sent and mirrored delivery plus one Lark Notification Log row',
      'observe without another Queue admission and prove no duplicate delivery',
    ],
    maximumQueueAdmissionCount: 1,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    notificationProducerEnabled: false,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
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
      'Runtime smoke test requires clean exact current main',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_REPOSITORY_INVALID',
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

async function assertFreshAttempt(directory) {
  for (const name of ['smoke-test-summary.json', '02-queue-send.attempt.json']) {
    try {
      await stat(join(directory, name));
      fail(
        'Runtime smoke test evidence already exists; blind rerun is forbidden',
        'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_ALREADY_ATTEMPTED',
        { evidenceName: name },
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

function resolveCloudflareTarget(env, configText) {
  const wranglerEnv = buildWranglerOAuthEnvironment(env);
  const whoami = text('npx', ['wrangler', 'whoami', '--json'], { env: wranglerEnv });
  const accountId = resolveCloudflareAccountId({
    explicitAccountId: env.CLOUDFLARE_ACCOUNT_ID,
    preferredAccount: env.MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_ACCOUNT,
    configText,
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
      'Cloudflare authentication type changed during Runtime smoke test',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_AUTH_DRIFT',
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
      'Runtime smoke test requires one MKT_STATE_DB binding',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIG_INVALID',
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
      'Runtime smoke test requires one MKT_SYNC_QUEUE producer',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_CONFIG_INVALID',
      { producerCount: matches.length },
    );
  }
  return requireText(matches[0].queue, 'queue');
}

function readDeploymentStatus(target) {
  const output = text('npx', [
    'wrangler', 'deployments', 'status', '--config', SOURCE_CONFIG, '--json',
  ], { env: target.cloudflare.wranglerEnv });
  return parseLarkNotificationRuntimeSmokeTestDeploymentStatus(output);
}

async function assertSettingsActive(target) {
  const records = await target.repository.listByFieldValues(
    target.tableIds.reportSettings,
    'report_setting_key',
    target.settingsAuthority.settingKeys,
  );
  return assertLarkNotificationRuntimeSettingsState(
    records,
    target.settingsAuthority,
    true,
  );
}

function readD1State(target) {
  const output = text('npx', [
    'wrangler', 'd1', 'execute', target.databaseName,
    '--remote',
    '--config', SOURCE_CONFIG,
    '--command', buildLarkNotificationRuntimeSmokeTestReadbackSql(target.smoke.aiRunKey),
    '--json',
  ], { env: target.cloudflare.wranglerEnv });
  const row = extractLarkNotificationWranglerD1Rows(output)[0];
  return normalizeLarkNotificationRuntimeSmokeTestReadback(row);
}

async function readLarkBaseline(target) {
  const [executiveRows, sentLogRows, smokeAiRows, smokeLogRows] = await Promise.all([
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
    target.repository.listByFieldValues(
      target.tableIds.aiRuns,
      'ai_run_key',
      [target.smoke.aiRunKey],
    ),
    target.repository.listByFieldValues(
      target.tableIds.notificationLog,
      'ai_run_key',
      [target.smoke.aiRunKey],
    ),
  ]);
  const controlledAi = executiveRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  const controlledLogs = sentLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  if (controlledAi.length !== 1
      || controlledLogs.length !== 1
      || readBoolean(controlledAi[0].fields.sent_to_group, 'sent_to_group') !== true
      || String(scalar(controlledLogs[0].fields.attempt_status) ?? '') !== 'sent') {
    fail(
      'Runtime smoke test requires the retained Controlled UAT Lark closeout',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_LARK_BASELINE_INVALID',
      { controlledAiRows: controlledAi.length, controlledLogRows: controlledLogs.length },
    );
  }
  if (smokeAiRows.length !== 0 || smokeLogRows.length !== 0) {
    fail(
      'Runtime smoke identity already exists in Lark; blind rerun is forbidden',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_ALREADY_ATTEMPTED',
      { smokeAiRows: smokeAiRows.length, smokeLogRows: smokeLogRows.length },
    );
  }
  return Object.freeze({
    totalSentNotificationLogRows: sentLogRows.length,
    controlledUatAiRows: 1,
    controlledUatNotificationLogRows: 1,
    controlledUatStable: true,
  });
}

async function verifyLarkDelivery(target, baseline) {
  const [sentLogRows, smokeAiRows, smokeLogRows, executiveRows] = await Promise.all([
    target.repository.listByFieldValues(
      target.tableIds.notificationLog,
      'attempt_status',
      ['sent'],
    ),
    target.repository.listByFieldValues(
      target.tableIds.aiRuns,
      'ai_run_key',
      [target.smoke.aiRunKey],
    ),
    target.repository.listByFieldValues(
      target.tableIds.notificationLog,
      'ai_run_key',
      [target.smoke.aiRunKey],
    ),
    target.repository.listByFieldValues(
      target.tableIds.aiRuns,
      'scope_type',
      ['executive'],
    ),
  ]);
  const exactAi = smokeAiRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === target.smoke.aiRunKey
  ));
  const exactLog = smokeLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === target.smoke.aiRunKey
  ));
  const controlledAi = executiveRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  const controlledLogs = sentLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  if (exactAi.length !== 1
      || exactLog.length !== 1
      || sentLogRows.length !== baseline.totalSentNotificationLogRows + 1
      || controlledAi.length !== 1
      || controlledLogs.length !== 1
      || readBoolean(exactAi[0].fields.sent_to_group, 'sent_to_group') !== true
      || String(scalar(exactLog[0].fields.attempt_status) ?? '') !== 'sent'
      || readBoolean(controlledAi[0].fields.sent_to_group, 'sent_to_group') !== true) {
    fail(
      'Runtime smoke test Lark mirror parity failed',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_LARK_PARITY_FAILED',
      {
        smokeAiRows: exactAi.length,
        smokeNotificationLogRows: exactLog.length,
        totalSentNotificationLogRows: sentLogRows.length,
      },
    );
  }
  const sentAt = Number(scalar(exactAi[0].fields.sent_at));
  const logSentAt = Number(scalar(exactLog[0].fields.sent_at));
  if (!Number.isFinite(sentAt) || !Number.isFinite(logSentAt)) {
    fail(
      'Runtime smoke test Lark sent timestamps are invalid',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_LARK_PARITY_FAILED',
    );
  }
  return Object.freeze({
    totalSentNotificationLogRows: sentLogRows.length,
    smokeNotificationLogRows: 1,
    smokeAiRunMarkedSent: true,
    controlledUatStable: true,
    sentAt,
    logSentAt,
  });
}

async function sendQueueOnce(target, job) {
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
      'Cloudflare Queue did not confirm Runtime smoke admission',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_QUEUE_SEND_FAILED',
      { status: response.status },
    );
  }
}

async function pollDelivered(target, before) {
  const maxPolls = positiveInteger(
    target.env.MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_MAX_POLLS ?? MAX_POLLS,
    'maxPolls',
  );
  const interval = positiveInteger(
    target.env.MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_POLL_INTERVAL_MS ?? POLL_INTERVAL_MS,
    'pollIntervalMs',
  );
  let last = null;
  for (let index = 1; index <= maxPolls; index += 1) {
    last = readD1State(target);
    process.stdout.write(`${JSON.stringify({
      event: 'lark_notification_runtime_smoke_progress',
      poll: index,
      totalDeliveryRows: last.totalDeliveryRows,
      smokeDeliveryRows: last.smokeDeliveryRows,
      smokeDeliveryStatus: last.smokeDeliveryStatus,
      smokeMirrorStatus: last.smokeMirrorStatus,
      activeLocks: last.activeLocks,
    })}\n`);
    try {
      return assertLarkNotificationRuntimeSmokeTestDelivered(before, last);
    } catch (error) {
      if (error?.code !== 'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_DELIVERY_NOT_CONFIRMED') {
        throw error;
      }
    }
    if (index < maxPolls) await sleep(interval);
  }
  fail(
    'Runtime smoke test delivery verification timed out',
    'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_VERIFY_TIMEOUT',
    {
      totalDeliveryRows: last?.totalDeliveryRows ?? null,
      smokeDeliveryRows: last?.smokeDeliveryRows ?? null,
      smokeDeliveryStatus: last?.smokeDeliveryStatus ?? null,
      smokeMirrorStatus: last?.smokeMirrorStatus ?? null,
    },
  );
}

function readObservationMs(env) {
  const number = Number(
    env.MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_OBSERVATION_MS ?? OBSERVATION_MS,
  );
  if (!Number.isSafeInteger(number) || number < 10_000 || number > 120_000) {
    fail(
      'Runtime smoke observation must be 10-120 seconds',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_INPUT_REQUIRED',
      { fieldName: 'MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_OBSERVATION_MS' },
    );
  }
  return number;
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
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_COMMAND_FAILED',
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

function readBoolean(value, fieldName) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  fail(
    `${fieldName} must be Boolean`,
    'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_LARK_RESPONSE_INVALID',
    { fieldName },
  );
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    fail(
      `${fieldName} must be a positive integer`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return number;
}

function exact(value, expected, fieldName) {
  if (value !== expected) {
    fail(
      `Runtime smoke test requires ${fieldName}=${expected}`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_ENVIRONMENT_INVALID',
      { fieldName },
    );
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_INPUT_REQUIRED',
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
  error.name = 'LarkNotificationRuntimeSmokeTestTerminalError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
