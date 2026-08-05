#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import {
  chmod,
  mkdir,
  readFile,
  readdir,
  stat,
  writeFile,
} from 'node:fs/promises';
import { join, resolve } from 'node:path';

import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_EXPECTED_ACTIVE_VERSION,
  buildLarkNotificationRuntimeSmokeTestReadbackSql,
  parseLarkNotificationRuntimeSmokeTestDeploymentStatus,
} from './lib/lark-notification-runtime-smoke-test.js';
import {
  LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONFIRMATION,
  LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONTRACT_VERSION,
  assertLarkNotificationRuntimeSmokeRecoveryConfirmation,
  assertLarkNotificationRuntimeSmokeRecoveryDelivered,
  assertLarkNotificationRuntimeSmokeRecoveryEvidence,
  assertLarkNotificationRuntimeSmokeRecoveryStable,
  classifyLarkNotificationRuntimeSmokeRecoveryReadback,
  normalizeLarkNotificationRuntimeSmokeRecoveryReadback,
  selectLarkNotificationRuntimeSmokeRecoveryAiRow,
} from './lib/lark-notification-runtime-smoke-recovery.js';
import {
  extractLarkNotificationWranglerD1Rows,
} from './lib/lark-notification-remote-rollout-operator.js';
import {
  resolveCloudflareAccountId,
  resolveCloudflareBearerAuth,
} from './lib/woocommerce-final-one-command.js';
import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../packages/config/src/lark-notification-runtime-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { loadLarkNotificationDeliveryRequest } from '../packages/connectors/src/lark/lark-notification-delivery-source.js';
import {
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
const SHA = /^[a-f0-9]{40}$/u;

let stage = 'init';
let retainedEvidenceFound = false;

try {
  const recover = parseArgs(process.argv.slice(2));
  if (!recover) {
    printPlan();
  } else {
    await recoverSmokeTest();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_FAILED',
    message: error?.message ?? String(error),
    details: scrub(error?.details ?? {}),
    retainedEvidenceFound,
    queueAdmissionCount: 0,
    additionalMessageSendCount: 0,
    blindRerunAllowed: false,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function recoverSmokeTest() {
  stage = 'load-local-environment';
  const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
  const env = Object.freeze({ ...fileEnv, ...process.env });
  assertLarkNotificationRuntimeSmokeRecoveryConfirmation(env);
  exact(env.MKT_ENV, 'development', 'MKT_ENV');
  exact(env.MKT_CUSTOMER_PROFILE, 'integration_workspace', 'MKT_CUSTOMER_PROFILE');
  exact(env.MKT_CONNECTION_CUSTOMER_KEY, 'chemistry_k', 'MKT_CONNECTION_CUSTOMER_KEY');

  stage = 'repository-preflight';
  const recoveryRepositoryHead = exactMainHead();

  stage = 'local-focused-gates';
  run('node', ['--test',
    'tests/application/lark-notification-runtime-smoke-recovery.test.js',
    'tests/application/lark-notification-runtime-smoke-recovery-exact-terminal.test.js',
    'tests/application/lark-notification-runtime-smoke-test.test.js',
    'tests/application/lark-notification-active-job-router.test.js',
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
      'Runtime smoke recovery requires Notification schedule admission to remain absent',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_SCHEDULE_PRESENT',
    );
  }

  stage = 'load-retained-smoke-evidence';
  const retained = await loadRetainedEvidence();
  retainedEvidenceFound = true;
  const evidence = assertLarkNotificationRuntimeSmokeRecoveryEvidence({
    directoryHead: retained.directoryHead,
    preflight: retained.preflight,
    attempt: retained.attempt,
  });

  stage = 'resolve-local-topology';
  const sourceText = await readFile(SOURCE_CONFIG, 'utf8');
  const sourceConfig = parseJsoncObject(sourceText);
  const cloudflare = resolveCloudflareTarget(env, sourceText);
  const databaseName = resolveDatabaseName(sourceConfig);

  stage = 'resolve-retained-lark-identity';
  const client = createLarkBitableClientFromEnv(env);
  const tableIds = resolveLarkNotificationControlledUatTables(await client.listTables());
  const repository = new LarkRecordRepository({ client });
  const executiveRows = await repository.listByFieldValues(
    tableIds.aiRuns,
    'scope_type',
    ['executive'],
  );
  const smoke = selectLarkNotificationRuntimeSmokeRecoveryAiRow(
    executiveRows,
    evidence.smokeAiRunKeyHash,
  );

  const context = Object.freeze({
    env,
    recoveryRepositoryHead,
    retainedRepositoryHead: evidence.repositoryHead,
    evidenceDir: retained.evidenceDir,
    evidence,
    sourceText,
    sourceConfig,
    cloudflare,
    databaseName,
    tableIds,
    repository,
    smoke,
  });

  stage = 'verify-reviewed-runtime-worker';
  const deployment = readDeploymentStatus(context);

  stage = 'verify-active-runtime-chain';
  const request = await loadLarkNotificationDeliveryRequest({
    repository,
    tables: tableIds,
    aiRunKey: smoke.aiRunKey,
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });
  if (!request.settings.enabled
      || !request.settings.aiEnabled
      || !request.settings.notificationEnabled
      || request.snapshot.customerProfile !== 'integration_workspace') {
    fail(
      'Runtime smoke recovery requires the retained delivery chain to remain active',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_DELIVERY_CHAIN_INVALID',
    );
  }

  stage = 'poll-existing-delivery-without-resend';
  const delivered = await pollDelivered(context);

  stage = 'verify-retained-lark-mirror';
  const lark = await verifyLarkDelivery(context);

  stage = 'bounded-poll-only-observation';
  await sleep(readObservationMs(env));
  const observed = readD1State(context);
  const stability = assertLarkNotificationRuntimeSmokeRecoveryStable(delivered, observed);
  const observedLark = await verifyLarkDelivery(context);
  if (JSON.stringify(lark) !== JSON.stringify(observedLark)) {
    fail(
      'Runtime smoke Lark mirror changed during poll-only recovery observation',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_STABILITY_FAILED',
    );
  }
  const finalDeployment = readDeploymentStatus(context);

  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONTRACT_VERSION,
    phase: 'recovered_complete',
    retainedRepositoryHead: evidence.repositoryHead,
    recoveryRepositoryHead,
    activeVersion: finalDeployment.activeVersionId,
    trafficPercentage: finalDeployment.trafficPercentage,
    runtimeEnabled: true,
    sendEnabled: true,
    mirrorEnabled: true,
    runtimeMode: 'runtime',
    activatedReportSettingCount: evidence.activatedReportSettingCount,
    originalQueueAdmissionCount: 1,
    recoveryQueueAdmissionCount: 0,
    totalQueueAdmissionCount: 1,
    deliveryRowsBefore: delivered.deliveryRowsBefore,
    deliveryRowsAfter: delivered.deliveryRowsAfter,
    additionalDeliveryRows: delivered.additionalDeliveryRows,
    additionalMessageSendCount: delivered.additionalMessageSendCount,
    recoveryAdditionalMessageSendCount: 0,
    exactSmokeDeliveryRows: stability.exactSmokeDeliveryRows,
    duplicateDeliveryRows: stability.duplicateDeliveryRows,
    notificationLogRowsBefore: evidence.notificationLogRowsBefore,
    notificationLogRowsAfter: lark.totalSentNotificationLogRows,
    additionalNotificationLogRows: 1,
    deliveryStatus: delivered.smokeDeliveryStatus,
    mirrorStatus: delivered.smokeMirrorStatus,
    aiRunMarkedSent: lark.smokeAiRunMarkedSent,
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
  await privateJson(join(retained.evidenceDir, 'smoke-test-recovery-summary.json'), summary);
  await privateJson(join(retained.evidenceDir, 'smoke-test-summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

async function loadRetainedEvidence() {
  let entries;
  try {
    entries = await readdir(OUTPUT_ROOT, { withFileTypes: true });
  } catch (cause) {
    fail(
      'Runtime smoke recovery evidence root cannot be read',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_EVIDENCE_MISSING',
      { sourceCode: cause?.code ?? null },
    );
  }
  const candidates = [];
  for (const entry of entries) {
    if (!entry.isDirectory() || !SHA.test(entry.name)) continue;
    const evidenceDir = resolve(OUTPUT_ROOT, entry.name);
    const attemptPath = join(evidenceDir, '02-queue-send.attempt.json');
    const preflightPath = join(evidenceDir, '01-read-only-preflight.json');
    const summaryPath = join(evidenceDir, 'smoke-test-summary.json');
    if (!(await exists(attemptPath)) || !(await exists(preflightPath))) continue;
    if (await exists(summaryPath)) continue;
    let preflight;
    let attempt;
    try {
      preflight = JSON.parse(await readFile(preflightPath, 'utf8'));
      attempt = JSON.parse(await readFile(attemptPath, 'utf8'));
    } catch (cause) {
      fail(
        'Retained Runtime smoke evidence is not valid JSON',
        'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_EVIDENCE_INVALID',
        { sourceCode: cause?.code ?? null },
      );
    }
    candidates.push(Object.freeze({
      directoryHead: entry.name,
      evidenceDir,
      preflight,
      attempt,
    }));
  }
  if (candidates.length !== 1) {
    fail(
      'Runtime smoke recovery requires exactly one incomplete retained attempt chain',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_EVIDENCE_AMBIGUOUS',
      { candidateCount: candidates.length },
    );
  }
  return candidates[0];
}

async function pollDelivered(context) {
  const maxPolls = positiveInteger(
    context.env.MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_MAX_POLLS ?? MAX_POLLS,
    'maxPolls',
  );
  const interval = positiveInteger(
    context.env.MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_POLL_INTERVAL_MS
      ?? POLL_INTERVAL_MS,
    'pollIntervalMs',
  );
  let last = null;
  for (let index = 1; index <= maxPolls; index += 1) {
    last = readD1State(context);
    const classified = classifyLarkNotificationRuntimeSmokeRecoveryReadback(last);
    process.stdout.write(`${JSON.stringify({
      event: 'lark_notification_runtime_smoke_recovery_progress',
      poll: index,
      state: classified.state,
      totalDeliveryRows: last.totalDeliveryRows,
      unsafeDeliveryRows: last.unsafeDeliveryRows,
      smokeDeliveryRows: last.smokeDeliveryRows,
      smokeDeliveryStatus: last.smokeDeliveryStatus,
      smokeMirrorStatus: last.smokeMirrorStatus,
      activeLocks: last.activeLocks,
      queueAdmissionCount: 0,
    })}\n`);
    if (classified.state === 'delivered') {
      return assertLarkNotificationRuntimeSmokeRecoveryDelivered(context.evidence, last);
    }
    if (index < maxPolls) await sleep(interval);
  }
  fail(
    'Runtime smoke poll-only recovery timed out; automatic resend remains forbidden',
    'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_VERIFY_TIMEOUT',
    {
      totalDeliveryRows: last?.totalDeliveryRows ?? null,
      unsafeDeliveryRows: last?.unsafeDeliveryRows ?? null,
      smokeDeliveryStatus: last?.smokeDeliveryStatus ?? null,
      smokeMirrorStatus: last?.smokeMirrorStatus ?? null,
    },
  );
}

function readD1State(context) {
  const output = text('npx', [
    'wrangler', 'd1', 'execute', context.databaseName,
    '--remote',
    '--config', SOURCE_CONFIG,
    '--command', buildLarkNotificationRuntimeSmokeTestReadbackSql(context.smoke.aiRunKey),
    '--json',
  ], { env: context.cloudflare.wranglerEnv });
  const row = extractLarkNotificationWranglerD1Rows(output)[0];
  return normalizeLarkNotificationRuntimeSmokeRecoveryReadback(row);
}

async function verifyLarkDelivery(context) {
  const [sentLogRows, smokeAiRows, smokeLogRows, executiveRows] = await Promise.all([
    context.repository.listByFieldValues(
      context.tableIds.notificationLog,
      'attempt_status',
      ['sent'],
    ),
    context.repository.listByFieldValues(
      context.tableIds.aiRuns,
      'ai_run_key',
      [context.smoke.aiRunKey],
    ),
    context.repository.listByFieldValues(
      context.tableIds.notificationLog,
      'ai_run_key',
      [context.smoke.aiRunKey],
    ),
    context.repository.listByFieldValues(
      context.tableIds.aiRuns,
      'scope_type',
      ['executive'],
    ),
  ]);
  const exactAi = smokeAiRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === context.smoke.aiRunKey
  ));
  const exactLog = smokeLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '') === context.smoke.aiRunKey
  ));
  const controlledAi = executiveRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  const controlledLogs = sentLogRows.filter((record) => (
    String(scalar(record?.fields?.ai_run_key) ?? '').startsWith('notification-uat:')
  ));
  if (exactAi.length !== 1
      || exactLog.length !== 1
      || sentLogRows.length !== context.evidence.notificationLogRowsBefore + 1
      || controlledAi.length !== 1
      || controlledLogs.length !== 1
      || readBoolean(exactAi[0].fields.sent_to_group, 'sent_to_group') !== true
      || String(scalar(exactLog[0].fields.attempt_status) ?? '') !== 'sent'
      || readBoolean(controlledAi[0].fields.sent_to_group, 'sent_to_group') !== true) {
    fail(
      'Runtime smoke poll-only recovery Lark parity failed',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_LARK_PARITY_FAILED',
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
      'Runtime smoke recovery Lark sent timestamps are invalid',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_LARK_PARITY_FAILED',
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

function readDeploymentStatus(context) {
  const output = text('npx', [
    'wrangler', 'deployments', 'status', '--config', SOURCE_CONFIG, '--json',
  ], { env: context.cloudflare.wranglerEnv });
  return parseLarkNotificationRuntimeSmokeTestDeploymentStatus(
    output,
    LARK_NOTIFICATION_RUNTIME_SMOKE_TEST_EXPECTED_ACTIVE_VERSION,
  );
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
  resolveCloudflareBearerAuth({
    authOutput: text('npx', ['wrangler', 'auth', 'token', '--json'], { env: selected }),
  });
  return Object.freeze({ accountId, wranglerEnv: selected });
}

function resolveDatabaseName(config) {
  const matches = Array.isArray(config?.d1_databases)
    ? config.d1_databases.filter((item) => item?.binding === 'MKT_STATE_DB')
    : [];
  if (matches.length !== 1) {
    fail(
      'Runtime smoke recovery requires one MKT_STATE_DB binding',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONFIG_INVALID',
      { bindingCount: matches.length },
    );
  }
  return requireText(matches[0].database_name, 'database_name');
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--recover');
  if (unknown.length > 0) {
    fail(
      'Runtime smoke recovery Terminal accepts only --recover',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--recover');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONTRACT_VERSION,
    confirmation: LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_CONFIRMATION,
    sequence: [
      'load exactly one retained preflight plus Queue-attempt chain',
      'resolve the original Runtime smoke AI identity by SHA-256',
      'poll existing D1 delivery while tolerating only that exact in-flight row',
      'verify one sent/mirrored delivery and one Lark Notification Log row',
      'observe stability without Queue admission, replay or message resend',
    ],
    queueAdmissionCount: 0,
    additionalMessageSendCount: 0,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
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
      'Runtime smoke recovery requires clean exact current main',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_REPOSITORY_INVALID',
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

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') return false;
    throw error;
  }
}

async function privateJson(path, value) {
  await mkdir(resolve(path, '..'), { recursive: true, mode: 0o700 }).catch(() => {});
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
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_COMMAND_FAILED',
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

function readObservationMs(env) {
  const number = Number(
    env.MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_OBSERVATION_MS ?? OBSERVATION_MS,
  );
  if (!Number.isSafeInteger(number) || number < 10_000 || number > 120_000) {
    fail(
      'Runtime smoke recovery observation must be 10-120 seconds',
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_INPUT_REQUIRED',
      { fieldName: 'MKT_LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_OBSERVATION_MS' },
    );
  }
  return number;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    fail(
      `${fieldName} must be a positive integer`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return number;
}

function exact(value, expected, fieldName) {
  if (value !== expected) {
    fail(
      `Runtime smoke recovery requires ${fieldName}=${expected}`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_ENVIRONMENT_INVALID',
      { fieldName },
    );
  }
}

function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join('');
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
    'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_LARK_RESPONSE_INVALID',
    { fieldName },
  );
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_RUNTIME_SMOKE_RECOVERY_INPUT_REQUIRED',
      { fieldName },
    );
  }
  return value.trim();
}

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    /(?:token|secret|password|authorization|tableId|queueId|accountId|groupId|aiRunKey)/iu.test(key)
      ? `${key}Redacted`
      : key,
    /(?:token|secret|password|authorization|tableId|queueId|accountId|groupId|aiRunKey)/iu.test(key)
      ? true
      : scrub(nested),
  ]));
}

function fail(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationRuntimeSmokeRecoveryTerminalError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}

function sleep(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}
