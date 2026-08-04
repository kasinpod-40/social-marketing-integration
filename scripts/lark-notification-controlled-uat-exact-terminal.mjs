#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';

import { readDevVars } from './lib/dev-vars.js';
import {
  LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION,
  LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
  assertLarkNotificationControlledUatConfirmation,
  parseSourceReportIds,
  resolveLarkNotificationControlledUatTables,
  selectLarkNotificationExecutivePreview,
} from './lib/lark-notification-controlled-uat.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';

const ROOT = resolve(process.cwd());
const CHILD = resolve('scripts/lark-notification-controlled-uat.mjs');
let stage = 'init';
let childStarted = false;
let childStatus = null;
let restoreVerified = false;

try {
  const execute = parseArgs(process.argv.slice(2));
  if (!execute) {
    printPlan();
  } else {
    const fileEnv = await readDevVars(process.env.DEV_VARS_FILE ?? '.dev.vars');
    const env = Object.freeze({ ...fileEnv, ...process.env });
    assertLarkNotificationControlledUatConfirmation(env);

    stage = 'run-controlled-uat';
    childStarted = true;
    const child = spawnSync(process.execPath, [CHILD, '--execute'], {
      cwd: ROOT,
      env: {
        ...process.env,
        MKT_LARK_NOTIFICATION_UAT_REPLAY_WAIT_MS:
          process.env.MKT_LARK_NOTIFICATION_UAT_REPLAY_WAIT_MS ?? '30000',
      },
      encoding: 'utf8',
      stdio: 'inherit',
      maxBuffer: 512 * 1024 * 1024,
    });
    if (child.error) throw child.error;
    childStatus = child.status;

    stage = 'verify-and-restore-exact-report-settings';
    await restoreExactSourceSettings(env);
    restoreVerified = true;

    if (childStatus !== 0) {
      throw terminalError(
        'Controlled notification UAT stopped; exact Report Settings were restored false',
        'LARK_NOTIFICATION_CONTROLLED_UAT_CHILD_FAILED',
        { childStatus },
      );
    }

    stage = 'complete';
    process.stdout.write(`${JSON.stringify({
      ok: true,
      contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
      phase: 'exact-terminal-complete',
      childCompleted: true,
      reportSettingsRestored: true,
      automationActivationCount: 0,
      scheduleActivationCount: 0,
      production: 'BLOCKED',
    }, null, 2)}\n`);
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NOTIFICATION_CONTROLLED_UAT_EXACT_TERMINAL_FAILED',
    message: error?.message ?? String(error),
    details: sanitize(error?.details ?? {}),
    childStarted,
    childStatus,
    reportSettingsRestored: restoreVerified,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function parseArgs(args) {
  const unknown = args.filter((arg) => arg !== '--execute');
  if (unknown.length > 0) {
    throw terminalError(
      'Controlled notification exact terminal accepts only --execute',
      'LARK_NOTIFICATION_CONTROLLED_UAT_ARGUMENT_INVALID',
      { unknown },
    );
  }
  return args.includes('--execute');
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    executed: false,
    contractVersion: LARK_NOTIFICATION_CONTROLLED_UAT_CONTRACT_VERSION,
    confirmation: LARK_NOTIFICATION_CONTROLLED_UAT_CONFIRMATION,
    child: 'scripts/lark-notification-controlled-uat.mjs',
    failSafe: 'always_read_back_and_restore_exact_source_report_settings_false',
    replayWaitMs: 30000,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function restoreExactSourceSettings(env) {
  const client = createLarkBitableClientFromEnv(env);
  const tables = resolveLarkNotificationControlledUatTables(await client.listTables());
  const repository = new LarkRecordRepository({ client });
  const executiveRows = await repository.listByFieldValues(
    tables.aiRuns,
    'scope_type',
    ['executive'],
  );
  const preview = selectLarkNotificationExecutivePreview(executiveRows, { windowDays: 1 });
  const sourceReportIds = parseSourceReportIds(preview.fields.source_report_ids_json);
  const snapshotRows = await repository.listByFieldValues(
    tables.reportSnapshots,
    'report_id',
    sourceReportIds,
  );
  const exactSnapshots = sourceReportIds.map((reportId) => {
    const matches = snapshotRows.filter((record) => (
      String(scalar(record?.fields?.report_id) ?? '') === reportId
    ));
    if (matches.length !== 1) {
      throw terminalError(
        'Exact source Report Snapshot could not be resolved during safety restore',
        'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_RESTORE_BLOCKED',
        { matchCount: matches.length },
      );
    }
    return matches[0];
  });
  const customerProfiles = [...new Set(exactSnapshots.map((record) => (
    requireText(scalar(record.fields.customer_profile), 'customer_profile')
  )))];
  const settingKeys = [...new Set(exactSnapshots.map((record) => (
    requireText(scalar(record.fields.report_setting_key), 'report_setting_key')
  )))].sort();
  if (customerProfiles.length !== 1) {
    throw terminalError(
      'Source Report Snapshots do not share one customer profile',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_RESTORE_BLOCKED',
      { customerProfileCount: customerProfiles.length },
    );
  }

  const settingRows = await repository.listByFieldValues(
    tables.reportSettings,
    'report_setting_key',
    settingKeys,
  );
  const exactSettings = settingKeys.map((settingKey) => {
    const matches = settingRows.filter((record) => (
      String(scalar(record?.fields?.report_setting_key) ?? '') === settingKey
      && String(scalar(record?.fields?.customer_profile) ?? '') === customerProfiles[0]
    ));
    if (matches.length !== 1) {
      throw terminalError(
        'Exact source Report Setting could not be resolved during safety restore',
        'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_RESTORE_BLOCKED',
        { matchCount: matches.length },
      );
    }
    return matches[0];
  });

  const rows = exactSettings.map((record) => Object.freeze({
    report_setting_key: requireText(
      scalar(record.fields.report_setting_key),
      'report_setting_key',
    ),
    ai_enabled: false,
    notification_enabled: false,
  }));
  const engine = new TableSyncEngine();
  const plan = await engine.planByKey({
    repository,
    tableId: tables.reportSettings,
    keyField: 'report_setting_key',
    rows,
  });
  if (plan.createRows.length !== 0) {
    throw terminalError(
      'Safety restore must not create Report Settings',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_RESTORE_BLOCKED',
      { createRows: plan.createRows.length },
    );
  }
  const result = await engine.executePlan(plan);
  if (result.created !== 0 || result.updated + result.skipped !== rows.length) {
    throw terminalError(
      'Exact Report Settings safety restore did not reconcile every row',
      'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_RESTORE_FAILED',
    );
  }

  const readback = await repository.listByFieldValues(
    tables.reportSettings,
    'report_setting_key',
    settingKeys,
  );
  for (const settingKey of settingKeys) {
    const matches = readback.filter((record) => (
      String(scalar(record?.fields?.report_setting_key) ?? '') === settingKey
      && String(scalar(record?.fields?.customer_profile) ?? '') === customerProfiles[0]
    ));
    if (matches.length !== 1
        || readBoolean(matches[0].fields.ai_enabled, 'ai_enabled') !== false
        || readBoolean(matches[0].fields.notification_enabled, 'notification_enabled') !== false) {
      throw terminalError(
        'Exact Report Settings safety restore readback failed',
        'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_RESTORE_FAILED',
      );
    }
  }
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
  throw terminalError(
    `${fieldName} must be Boolean`,
    'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_RESTORE_FAILED',
    { fieldName },
  );
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw terminalError(
      `${fieldName} is required`,
      'LARK_NOTIFICATION_CONTROLLED_UAT_SETTINGS_RESTORE_BLOCKED',
      { fieldName },
    );
  }
  return value.trim();
}

function sanitize(value) {
  if (Array.isArray(value)) return value.map(sanitize);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [
    /(?:token|secret|authorization|table|record|queue|account|group)/iu.test(key)
      ? `${key}Redacted`
      : key,
    /(?:token|secret|authorization|table|record|queue|account|group)/iu.test(key)
      ? true
      : sanitize(nested),
  ]));
}

function terminalError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNotificationControlledUatExactTerminalError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
