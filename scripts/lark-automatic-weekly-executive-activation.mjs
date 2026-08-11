#!/usr/bin/env node

import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  buildLarkNativeAiWeekly7dControlledUat,
} from '../packages/application/src/reports/build-lark-native-ai-weekly-7d-controlled-uat.js';
import {
  REPORT_SOURCE_STATUS,
  listReportPlatformContracts,
} from '../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  resolveDashboardReportSourceAuthority,
} from '../packages/application/src/reports/dashboard-report-source-authority.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';
import { buildWranglerOAuthEnvironment } from './lib/cloudflare-auth-environment.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  buildAutomaticWeeklyExecutiveActivationConfig,
  buildAutomaticWeeklyExecutiveActiveBaseline,
  buildAutomaticWeeklyExecutiveSettingRows,
  LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_CONFIRMATION,
  LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_VERSION,
} from './lib/lark-automatic-weekly-executive-activation.js';
import {
  collectLarkNativeAiWeekly7dControlledUatSource,
} from './lib/lark-native-ai-weekly-7d-controlled-uat.js';
import {
  resolveLarkNotificationControlledUatTables,
} from './lib/lark-notification-controlled-uat.js';
import {
  assertLarkWeekly7dNotificationSourceSettingsBaseline,
  resolveLarkWeekly7dNotificationSourceSettings,
} from './lib/lark-weekly-7d-notification-source-settings.js';
import { parseLarkNotificationDeploymentStatus } from './lib/lark-notification-safe-worker-deploy.js';
import { parseWranglerDeploymentOutput } from './lib/tiktok-post-lark-rollout-operator.js';
import { extractLarkNotificationWranglerD1Rows } from './lib/lark-notification-remote-rollout-operator.js';

const ROOT = resolve(process.cwd());
const SOURCE_CONFIG = resolve(
  process.env.MKT_LARK_AUTOMATIC_WEEKLY_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const OUTPUT_ROOT = resolve(
  process.env.MKT_LARK_AUTOMATIC_WEEKLY_EVIDENCE_ROOT
    ?? 'outputs/lark-automatic-weekly-executive-activation',
);
const WORKER_NAME = 'social-mkt-sync-worker';
const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';
const ACTIVE = new Set(['enable', 'enabled', 'active', 'on']);
const INACTIVE = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const EXPECTED_PLATFORM_SCOPES = Object.freeze(listReportPlatformContracts()
  .filter((contract) => contract.sourceStatus === REPORT_SOURCE_STATUS.ACTIVE)
  .map((contract) => contract.platformScope));

let stage = 'init';
let action = 'preview';
let repositoryState = null;
let settingsWriteCount = 0;
let workerDeploymentCount = 0;
let deployAttempted = false;

try {
  action = parseAction(process.argv.slice(2));
  const context = await prepare();
  if (action === 'preview') await preview(context);
  else await execute(context);
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_VERSION,
    action,
    stage,
    code: error?.code ?? 'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_FAILED',
    message: sanitize(error?.message ?? String(error)),
    details: scrub(error?.details ?? {}),
    repository: repositoryState,
    settingsWriteCount,
    workerDeploymentCount,
    deployAttempted,
    queueAdmissionCount: 0,
    messageSendCount: 0,
    baseNotificationAutomationActivated: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function prepare() {
  stage = 'verify-repository';
  repositoryState = verifyRepository();
  const sourceText = await readFile(SOURCE_CONFIG, 'utf8');
  const parsedConfig = parseJsoncObject(sourceText);
  const databaseName = requireText(parsedConfig?.d1_databases?.[0]?.database_name, 'd1 database_name');
  const devVars = await readDevVars(resolve(ROOT, '.dev.vars'));
  const env = Object.freeze({ ...devVars, ...process.env });
  const wranglerEnv = buildWranglerOAuthEnvironment(env);

  stage = 'resolve-lark-authority';
  const client = createLarkBitableClientFromEnv(env);
  const larkRepository = new LarkRecordRepository({ client });
  const syncEngine = new TableSyncEngine();
  const tableIds = resolveLarkNotificationControlledUatTables(await client.listTables());
  const source = await collectLarkNativeAiWeekly7dControlledUatSource({ client });
  if (source.selectedChannelCount !== EXPECTED_PLATFORM_SCOPES.length) {
    fail('Automatic Weekly activation requires the complete reviewed 7D Report platform set',
      'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_SOURCE_INCOMPLETE', {
        expectedReportCount: EXPECTED_PLATFORM_SCOPES.length,
        observedReportCount: source.selectedChannelCount,
      });
  }
  const generatedAt = Math.max(...source.reportBundles.map((bundle) => Number(bundle?.payload?.generatedAt)));
  if (!Number.isFinite(generatedAt)) {
    fail('Automatic Weekly activation could not resolve current Report generated_at',
      'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_SOURCE_INVALID');
  }
  const seed = await buildLarkNativeAiWeekly7dControlledUat({
    generatedAt,
    customerKey: 'integration_workspace',
    customerProfile: 'integration_workspace',
    utcOffset: '+07:00',
    targetPeriod: source.targetPeriod,
    settings: source.settings,
    reportBundles: source.reportBundles,
  });
  const sourceReportIds = JSON.parse(requireText(
    seed.executiveRow.source_report_ids_json,
    'source_report_ids_json',
  ));
  const reportAuthority = resolveDashboardReportSourceAuthority({
    sourceReportIds,
    platformScopes: EXPECTED_PLATFORM_SCOPES,
    profileKey: 'integration_workspace',
    accountKey: 'chemistry_k',
    periodKind: 'rolling_days',
    periodStart: source.targetPeriod.periodStart,
    periodEnd: source.targetPeriod.periodEnd,
    windowDays: 7,
  });
  const settingsAuthority = resolveLarkWeekly7dNotificationSourceSettings({
    sourceReportIds,
    sourceAuthorities: reportAuthority.authorities,
    settings: source.settings,
  });
  await verifyAutomationState(client);

  stage = 'build-target-config';
  const target = buildAutomaticWeeklyExecutiveActivationConfig(sourceText, tableIds);
  const settingsRows = buildAutomaticWeeklyExecutiveSettingRows(settingsAuthority);
  const activeBaseline = buildAutomaticWeeklyExecutiveActiveBaseline(settingsAuthority);
  return Object.freeze({
    sourceText,
    parsedConfig,
    databaseName,
    env,
    wranglerEnv,
    client,
    larkRepository,
    syncEngine,
    tableIds,
    source,
    reportAuthority,
    settingsAuthority,
    settingsRows,
    activeBaseline,
    target,
  });
}

async function preview(context) {
  stage = 'preview-read-only';
  process.stdout.write(`${JSON.stringify({
    ok: true,
    contractVersion: LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_VERSION,
    action: 'preview',
    mode: 'READ_ONLY',
    stage: 'complete',
    status: 'automatic_weekly_executive_activation_ready',
    repository: repositoryState,
    sourcePeriod: context.source.targetPeriod,
    sourceReportCount: context.source.selectedChannelCount,
    sourceSettingsState: context.settingsAuthority.state,
    activeSourceSettingCount: context.settingsAuthority.activeSettingCount,
    inactiveSourceSettingCount: context.settingsAuthority.inactiveSettingCount,
    settingsWritesRequired: context.settingsRows.length,
    changedEnabledFlags: context.target.changedEnabledFlags,
    weeklyNotificationTime: context.target.notificationTime,
    maximumQueueAttempts: context.target.maximumAttempts,
    notificationRuntimeWillRemainActive: true,
    automaticWeeklyWillBeEnabled: true,
    baseNotificationAutomationWillRemainOff: true,
    immediateQueueAdmissionCount: 0,
    immediateMessageSendCount: 0,
    production: 'BLOCKED',
    nextGate: 'execute_requires_exact_confirmation',
  }, null, 2)}\n`);
}

async function execute(context) {
  stage = 'assert-exact-confirmation';
  const confirmation = LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_CONFIRMATION;
  if (context.env[confirmation.envName] !== confirmation.value) {
    fail(`Execute requires ${confirmation.envName}=${confirmation.value}`,
      'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_CONFIRMATION_REQUIRED', {
        envName: confirmation.envName,
      });
  }
  assertNotNearAutomaticSchedule(context.env);

  let sourceConfigRewritten = false;
  let settingsMutated = false;
  try {
    stage = 'activate-exact-7d-source-settings';
    if (context.settingsRows.length > 0) {
      const plan = await context.syncEngine.planByKey({
        repository: context.larkRepository,
        tableId: context.tableIds.reportSettings,
        keyField: 'report_setting_key',
        rows: context.settingsRows,
      });
      if (plan.createRows.length !== 0) {
        fail('Automatic Weekly activation cannot create Report Settings',
          'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_SETTINGS_PLAN_INVALID', {
            createRows: plan.createRows.length,
          });
      }
      const result = await context.syncEngine.executePlan(plan);
      settingsWriteCount = result.updated;
      settingsMutated = result.updated > 0;
    }
    await assertSettingsActive(context);

    stage = 'write-persistent-local-config';
    await writeFile(SOURCE_CONFIG, context.target.targetText, { mode: 0o600 });
    sourceConfigRewritten = true;

    stage = 'await-remote-quiescence';
    await awaitRemoteQuiescence(context);

    stage = 'wrangler-dry-run';
    run('npx', ['wrangler', 'deploy', '--dry-run', '--config', SOURCE_CONFIG], {
      env: context.wranglerEnv,
      stdio: 'inherit',
    });

    stage = 'deploy-automatic-weekly-runtime';
    deployAttempted = true;
    const outputPath = resolve(OUTPUT_ROOT, `.wrangler-deploy-${randomUUID()}.ndjson`);
    await mkdir(dirname(outputPath), { recursive: true });
    run('npx', ['wrangler', 'deploy', '--config', SOURCE_CONFIG], {
      env: { ...context.wranglerEnv, WRANGLER_OUTPUT_FILE_PATH: outputPath },
      stdio: 'inherit',
    });
    const deployed = parseWranglerDeploymentOutput(await readFile(outputPath, 'utf8'), {
      workerName: WORKER_NAME,
    });
    workerDeploymentCount = 1;

    stage = 'verify-deployment';
    const status = parseLarkNotificationDeploymentStatus(
      text('npx', ['wrangler', 'deployments', 'status', '--config', SOURCE_CONFIG, '--json'], {
        env: context.wranglerEnv,
      }),
      deployed.deploymentVersionId,
    );
    if (status.trafficPercentage !== 100) {
      fail('Automatic Weekly Worker version is not serving 100 percent of traffic',
        'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_DEPLOYMENT_INVALID');
    }

    stage = 'verify-final-lark-authority';
    await assertSettingsActive(context);
    await verifyAutomationState(context.client);

    const summary = {
      ok: true,
      contractVersion: LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_VERSION,
      action: 'execute',
      stage: 'complete',
      status: 'automatic_weekly_executive_notification_enabled',
      repository: repositoryState,
      activeVersion: deployed.deploymentVersionId,
      trafficPercentage: 100,
      sourcePeriodAtActivation: context.source.targetPeriod,
      sourceReportCount: context.source.selectedChannelCount,
      sourceSettingsStateBefore: context.settingsAuthority.state,
      sourceSettingsActiveAfter: true,
      settingsWriteCount,
      notificationRuntimeEnabled: true,
      notificationSendEnabled: true,
      notificationMirrorEnabled: true,
      runtimeMode: 'runtime',
      automaticWeeklyEnabled: true,
      weeklyNotificationTime: context.target.notificationTime,
      baseNotificationAutomationStatus: 'disable',
      aiMaterializationAutomationStatus: 'enable',
      immediateQueueAdmissionCount: 0,
      immediateMessageSendCount: 0,
      workerDeploymentCount,
      nextExpectedPeriod: '2026-08-10..2026-08-16',
      production: 'BLOCKED',
    };
    await mkdir(OUTPUT_ROOT, { recursive: true });
    await writeFile(resolve(OUTPUT_ROOT, 'activation-summary.json'), `${JSON.stringify(summary, null, 2)}\n`, {
      mode: 0o600,
    });
    process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
  } catch (error) {
    if (!deployAttempted) {
      if (sourceConfigRewritten) {
        try { await writeFile(SOURCE_CONFIG, context.sourceText, { mode: 0o600 }); } catch {}
      }
      if (settingsMutated) {
        try { await restoreSettings(context); } catch {}
      }
    }
    throw error;
  }
}

async function assertSettingsActive(context) {
  const records = await context.larkRepository.listByFieldValues(
    context.tableIds.reportSettings,
    'report_setting_key',
    context.settingsAuthority.settingKeys,
  );
  assertLarkWeekly7dNotificationSourceSettingsBaseline(
    records,
    context.settingsAuthority,
    context.activeBaseline,
  );
}

async function restoreSettings(context) {
  const rows = context.settingsAuthority.restorableBaseline
    .filter((row) => row.aiEnabled !== true || row.notificationEnabled !== true)
    .map((row) => ({
      report_setting_key: row.reportSettingKey,
      ai_enabled: row.aiEnabled,
      notification_enabled: row.notificationEnabled,
    }));
  if (rows.length === 0) return;
  const plan = await context.syncEngine.planByKey({
    repository: context.larkRepository,
    tableId: context.tableIds.reportSettings,
    keyField: 'report_setting_key',
    rows,
  });
  if (plan.createRows.length !== 0) return;
  await context.syncEngine.executePlan(plan);
}

async function verifyAutomationState(client) {
  const response = await client.requestBitableJson(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}/workflows`,
    { method: 'GET' },
  );
  const workflows = response?.data?.workflows ?? response?.data?.items ?? response?.workflows ?? [];
  const ai = exactWorkflow(workflows, AI_TITLE);
  const notification = exactWorkflow(workflows, NOTIFICATION_TITLE);
  const aiStatus = requireText(ai.status ?? ai.state, 'AI Automation status').toLowerCase();
  const notificationStatus = requireText(
    notification.status ?? notification.state,
    'Notification Automation status',
  ).toLowerCase();
  if (!ACTIVE.has(aiStatus) || !INACTIVE.has(notificationStatus)) {
    fail('Automatic Weekly activation requires AI Automation ON and Base Notification Automation OFF',
      'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_AUTOMATION_STATE_INVALID', {
        aiActive: ACTIVE.has(aiStatus),
        baseNotificationInactive: INACTIVE.has(notificationStatus),
      });
  }
}

async function awaitRemoteQuiescence(context) {
  let zero = 0;
  for (let poll = 1; poll <= 90; poll += 1) {
    const output = text('npx', [
      'wrangler', 'd1', 'execute', context.databaseName,
      '--remote', '--config', SOURCE_CONFIG,
      '--command', "SELECT COUNT(*) AS active_locks FROM sync_locks WHERE expires_at > unixepoch('now') * 1000;",
      '--json',
    ], { env: context.wranglerEnv });
    const row = extractLarkNotificationWranglerD1Rows(output)[0];
    const count = Number(row?.active_locks);
    if (!Number.isSafeInteger(count) || count < 0) {
      fail('Automatic Weekly activation could not read active lock count',
        'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_REMOTE_STATE_INVALID');
    }
    zero = count === 0 ? zero + 1 : 0;
    process.stdout.write(`${JSON.stringify({
      event: 'lark_automatic_weekly_activation_quiescence',
      poll,
      activeLocks: count,
      consecutiveZeroSamples: zero,
    })}\n`);
    if (zero >= 3) return true;
    if (poll < 90) await new Promise((resolvePromise) => setTimeout(resolvePromise, 2_000));
  }
  fail('Automatic Weekly activation could not prove remote quiescence',
    'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_REMOTE_QUIESCENCE_TIMEOUT');
}

function assertNotNearAutomaticSchedule(env) {
  const timeZone = env.DEFAULT_TIMEZONE ?? 'Asia/Bangkok';
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(now);
  const byType = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  const weekday = String(byType.weekday ?? '').toLowerCase();
  const minuteOfDay = (Number(byType.hour) * 60) + Number(byType.minute);
  const targetMinute = (8 * 60) + 30;
  if (weekday === 'monday' && Math.abs(minuteOfDay - targetMinute) <= 15) {
    fail('Automatic Weekly activation is blocked near the live weekly send boundary',
      'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ACTIVATION_TIME_UNSAFE');
  }
}

function verifyRepository() {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const branch = text('git', ['branch', '--show-current']);
  const head = text('git', ['rev-parse', 'HEAD']);
  const originMain = text('git', ['rev-parse', 'origin/main']);
  const clean = text('git', ['status', '--porcelain']) === '';
  if (branch !== 'main' || head !== originMain || !clean) {
    fail('Automatic Weekly activation requires clean exact current main',
      'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_REPOSITORY_INVALID', {
        branch,
        headMatchesOriginMain: head === originMain,
        clean,
      });
  }
  return Object.freeze({ branch, head, originMain, clean });
}

function parseAction(args) {
  if (args.length === 0 || (args.length === 1 && args[0] === '--preview')) return 'preview';
  if (args.length === 1 && args[0] === '--execute') return 'execute';
  fail('Use --preview or --execute', 'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_ARGUMENT_INVALID');
}

function exactWorkflow(workflows, title) {
  const matches = workflows.filter((item) => String(item?.title ?? item?.name ?? '').trim() === title);
  if (matches.length !== 1) {
    fail(`Expected exactly one Automation: ${title}`,
      'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_AUTOMATION_IDENTITY_INVALID', {
        count: matches.length,
      });
  }
  return matches[0];
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    env: options.env ?? process.env,
    encoding: 'utf8',
    stdio: options.stdio ?? 'pipe',
  });
  if (result.status !== 0) {
    fail(`${command} command failed`, 'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_COMMAND_FAILED', {
      command,
      status: result.status,
    });
  }
  return result.stdout ?? '';
}

function text(command, args, options = {}) {
  return String(run(command, args, options)).trim();
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    fail(`${fieldName} is required`, 'LARK_AUTOMATIC_WEEKLY_EXECUTIVE_INPUT_REQUIRED', {
      fieldName,
    });
  }
  return value.trim();
}

function fail(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}

function sanitize(value) {
  return String(value ?? '')
    .replace(/cli_[A-Za-z0-9_-]+/gu, '[REDACTED]')
    .replace(/pat-[A-Za-z0-9_-]+/gu, '[REDACTED]')
    .slice(0, 500);
}

function scrub(value) {
  if (Array.isArray(value)) return value.map(scrub);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitize(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, scrub(item)]));
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
