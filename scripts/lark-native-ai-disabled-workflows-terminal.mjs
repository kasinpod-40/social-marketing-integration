#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  chmod,
  mkdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  LARK_NATIVE_AI_DISABLED_WORKFLOW_DEFINITIONS,
  LARK_NATIVE_AI_DISABLED_WORKFLOWS_CONFIRMATION,
  LARK_NATIVE_AI_DISABLED_WORKFLOWS_OUTPUT_ROOT,
  LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
} from '../packages/config/src/lark-native-ai-disabled-workflows-contract.js';
import {
  LARK_NATIVE_AI_WORKFLOW_READINESS_CONFIRMATION,
} from '../packages/config/src/lark-native-ai-workflow-readiness-contract.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const outputRoot = resolve(
  process.env.MKT_LARK_NATIVE_AI_DISABLED_WORKFLOWS_OUTPUT_ROOT
    ?? LARK_NATIVE_AI_DISABLED_WORKFLOWS_OUTPUT_ROOT,
);

let stage = 'init';
let repository = null;
let readinessResult = null;
let attemptDirectory = null;

try {
  const execute = process.argv.slice(2).includes('--execute');
  if (!execute) printPlan();
  else await executeReadOnlyReconciliation();
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    contractVersion: LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_UI_AUTOMATION_RECONCILIATION_FAILED',
    message: sanitizeText(error?.message ?? String(error)),
    details: sanitizeValue(error?.details ?? {}),
    repository,
    readinessAttemptDirectory: readinessResult?.attemptDirectory ?? null,
    remote: readinessResult?.remote ?? null,
    attemptDirectory: attemptDirectory ? relative(repositoryRoot, attemptDirectory) : null,
    recordWriteCount: 0,
    workflowCreateCount: 0,
    workflowUpdateCount: 0,
    workflowStatusChangeCount: 0,
    automationEnabled: false,
    notificationCount: 0,
    webhookActionCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  if (attemptDirectory) {
    try {
      await writePrivateJson(resolve(attemptDirectory, 'failure-summary.json'), failure);
    } catch {
      // Preserve the primary failure.
    }
  }
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
    objective: 'reconcile_documented_inactive_lark_ui_automations_without_create_or_update',
    exactCommand: [
      'cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag &&',
      'git fetch --quiet origin main &&',
      'git pull --ff-only origin main &&',
      'MKT_CONNECTOR_TIKTOK_ENABLED=false',
      'MKT_YOUTUBE_ANALYTICS_ENABLED=false',
      `CONFIRM_LARK_NATIVE_AI_DISABLED_WORKFLOWS=${LARK_NATIVE_AI_DISABLED_WORKFLOWS_CONFIRMATION}`,
      'node scripts/lark-native-ai-disabled-workflows-terminal.mjs --execute',
    ].join(' '),
    uiAutomationAuthority: buildUiAutomationAuthority(),
    mutationBoundary: 'read_only',
    maximumWorkflowCreates: 0,
    recordWriteCount: 0,
    workflowCreateCount: 0,
    workflowUpdateCount: 0,
    workflowStatusChangeCount: 0,
    automationEnabled: false,
    notificationCount: 0,
    webhookActionCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    executed: false,
  }, null, 2)}\n`);
}

async function executeReadOnlyReconciliation() {
  stage = 'confirmation';
  if (process.env.CONFIRM_LARK_NATIVE_AI_DISABLED_WORKFLOWS
    !== LARK_NATIVE_AI_DISABLED_WORKFLOWS_CONFIRMATION) throw reconciliationError(
    'Exact UI Automation reconciliation confirmation is missing',
    'LARK_NATIVE_AI_UI_AUTOMATION_CONFIRMATION_INVALID',
  );

  stage = 'repository-preflight';
  await runGit(['fetch', '--quiet', 'origin', 'main']);
  repository = Object.freeze({
    branch: await gitText(['branch', '--show-current']),
    head: await gitText(['rev-parse', 'HEAD']),
    originMain: await gitText(['rev-parse', 'origin/main']),
    clean: (await gitText(['status', '--porcelain'])) === '',
  });
  if (repository.branch !== 'main' || repository.clean !== true
    || repository.head !== repository.originMain || !/^[a-f0-9]{40}$/u.test(repository.head)) {
    throw reconciliationError(
      'UI Automation reconciliation requires clean current main',
      'LARK_NATIVE_AI_UI_AUTOMATION_REPOSITORY_INVALID',
      repository,
    );
  }

  stage = 'create-immutable-attempt-directory';
  attemptDirectory = await createAttemptDirectory();

  stage = 'run-read-only-workflow-readiness';
  readinessResult = await runWorkflowReadiness();
  const readiness = readinessResult?.readiness ?? {};
  const workflows = readiness?.workflows ?? {};

  stage = 'verify-ui-automation-api-boundary';
  const expected = {
    status: 'ready_to_create_disabled_workflows',
    blockerCount: 0,
    settingsMatch: true,
    inventoryCount: 0,
    targetCount: 2,
    plannedCreateDisabledCount: 2,
    existingDisabledCount: 0,
  };
  const observed = {
    status: readinessResult?.status ?? null,
    blockerCount: readiness?.blockerCount ?? null,
    settingsMatch: readiness?.destination?.settingsMatch ?? null,
    inventoryCount: workflows?.inventoryCount ?? null,
    targetCount: workflows?.targetCount ?? null,
    plannedCreateDisabledCount: workflows?.plannedCreateDisabledCount ?? null,
    existingDisabledCount: workflows?.existingDisabledCount ?? null,
  };
  if (JSON.stringify(observed) !== JSON.stringify(expected)) throw reconciliationError(
    'Workflow API inventory changed; manual UI Automation authority must be reviewed before continuing',
    'LARK_NATIVE_AI_UI_AUTOMATION_API_BOUNDARY_CHANGED',
    { expected, observed },
  );

  stage = 'write-summary';
  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_DISABLED_WORKFLOWS_VERSION,
    stage: 'complete',
    status: 'manual_ui_automations_locked_api_workflow_inventory_empty',
    mode: 'read_only_reconciliation',
    repository,
    uiAutomationAuthority: buildUiAutomationAuthority(),
    apiBoundary: Object.freeze({
      listWorkflowsInventoryCount: 0,
      uiAutomationsExposedByWorkflowList: false,
      createSuppressed: true,
      reason: 'documented_ui_automations_are_not_returned_by_the_current_workflow_list_call',
    }),
    readiness: Object.freeze({
      status: readinessResult.status,
      blockerCount: readiness.blockerCount,
      settingsMatch: readiness.destination.settingsMatch,
      targetGroupName: readiness.targetGroupName,
      notificationLogStatus: readiness.notificationLog?.status ?? null,
    }),
    remote: readinessResult.remote,
    readinessAttemptDirectory: readinessResult.attemptDirectory,
    attemptDirectory: relative(repositoryRoot, attemptDirectory),
    recordWriteCount: 0,
    workflowCreateCount: 0,
    workflowUpdateCount: 0,
    workflowStatusChangeCount: 0,
    automationEnabled: false,
    notificationCount: 0,
    webhookActionCount: 0,
    remoteD1ActionCount: 0,
    queueActionCount: 0,
    workerDeploymentCount: 0,
    providerActionCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  await writePrivateJson(resolve(attemptDirectory, 'summary.json'), summary);
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function buildUiAutomationAuthority() {
  return Object.freeze({
    source: 'user_confirmed_lark_base_ui',
    automationCount: 2,
    activeCount: 0,
    inactiveCount: 2,
    items: LARK_NATIVE_AI_DISABLED_WORKFLOW_DEFINITIONS.map((definition) => Object.freeze({
      title: definition.title,
      status: 'inactive',
      triggerTable: definition.triggerTable,
      watchedField: definition.watchedField,
      action: 'delay',
      delayMinutes: 1,
      nativeAiActionCount: 0,
      recordWriteActionCount: 0,
      messageActionCount: 0,
    })),
  });
}

async function runWorkflowReadiness() {
  const script = resolve(repositoryRoot, 'scripts/lark-native-ai-workflow-readiness-terminal.mjs');
  const env = {
    ...process.env,
    MKT_CONNECTOR_TIKTOK_ENABLED: 'false',
    MKT_YOUTUBE_ANALYTICS_ENABLED: 'false',
    CONFIRM_LARK_NATIVE_AI_WORKFLOW_READINESS:
      LARK_NATIVE_AI_WORKFLOW_READINESS_CONFIRMATION,
  };
  try {
    const result = await execFileAsync(process.execPath, [script, '--execute'], {
      cwd: repositoryRoot,
      env,
      encoding: 'utf8',
      timeout: 180_000,
      maxBuffer: 8 * 1024 * 1024,
      windowsHide: true,
    });
    return parseTerminalJson(result.stdout, 'Workflow Readiness stdout');
  } catch (error) {
    const parsed = parseTerminalJson(error?.stdout ?? error?.stderr ?? '', null);
    throw reconciliationError(
      'Read-only Workflow Readiness failed',
      'LARK_NATIVE_AI_UI_AUTOMATION_READINESS_FAILED',
      {
        childCode: parsed?.code ?? null,
        childStage: parsed?.stage ?? null,
        childMessage: sanitizeText(parsed?.message ?? error?.message ?? 'unknown'),
      },
    );
  }
}

function parseTerminalJson(value, field) {
  const text = String(value ?? '').trim();
  if (!text) {
    if (field) throw reconciliationError(
      `${field} is empty`,
      'LARK_NATIVE_AI_UI_AUTOMATION_CHILD_OUTPUT_INVALID',
    );
    return null;
  }
  const candidates = [text];
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) candidates.push(text.slice(firstBrace, lastBrace + 1));
  for (const candidate of candidates) {
    try { return JSON.parse(candidate); } catch { /* try next */ }
  }
  if (field) throw reconciliationError(
    `${field} is not valid JSON`,
    'LARK_NATIVE_AI_UI_AUTOMATION_CHILD_OUTPUT_INVALID',
  );
  return null;
}

async function createAttemptDirectory() {
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await chmod(outputRoot, 0o700);
  const timestamp = new Date().toISOString().replace(/[-:.]/gu, '');
  const path = resolve(outputRoot, `${timestamp}-${repository.head.slice(0, 12)}-${process.pid}`);
  await mkdir(path, { recursive: false, mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, {
    encoding: 'utf8',
    mode: 0o600,
    flag: 'wx',
  });
  await chmod(path, 0o600);
}

async function runGit(args) {
  try {
    await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
  } catch (error) {
    throw reconciliationError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_UI_AUTOMATION_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}

async function gitText(args) {
  try {
    const result = await execFileAsync('git', args, {
      cwd: repositoryRoot,
      encoding: 'utf8',
      timeout: 60_000,
      maxBuffer: 4 * 1024 * 1024,
      windowsHide: true,
    });
    return String(result.stdout ?? '').trim();
  } catch (error) {
    throw reconciliationError(
      `Git command failed: git ${args.join(' ')}`,
      'LARK_NATIVE_AI_UI_AUTOMATION_GIT_FAILED',
      { exitCode: Number.isInteger(error?.code) ? error.code : null },
    );
  }
}

function reconciliationError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkNativeAiUiAutomationReconciliationError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}

function sanitizeText(value) {
  return String(value ?? '')
    .replace(/https:\/\/open\.larksuite\.com\/[^\s"']+/gu, '[redacted-lark-url]')
    .replace(/\b(?:oc|ou|cli|app|tbl|rec|vew|wkf|fld|opt)_[A-Za-z0-9_-]+\b/gu, '[redacted-id]')
    .slice(0, 1000);
}
function sanitizeValue(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeValue(nested)]));
  }
  return value;
}
