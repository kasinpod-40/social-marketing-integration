#!/usr/bin/env node

import { execFile } from 'node:child_process';
import {
  chmod,
  lstat,
  mkdir,
  open,
  readFile,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { dirname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import {
  assertLarkNativeAiWeekly7dControlledUatReadback,
  buildLarkNativeAiWeekly7dControlledUat,
  planLarkNativeAiWeekly7dControlledUatWrite,
  weekly7dControlledUatError,
} from '../packages/application/src/reports/build-lark-native-ai-weekly-7d-controlled-uat.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_CONFIRMATION,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_OUTPUT_ROOT,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_SAFETY,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_VERSION,
} from '../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import {
  assertLarkNativeAiWeekly7dAutomationAuthority,
  collectLarkNativeAiWeekly7dControlledUatSource,
  createLarkNativeAiWeekly7dControlledUatFetchGuard,
} from './lib/lark-native-ai-weekly-7d-controlled-uat.js';

const execFileAsync = promisify(execFile);
const repositoryRoot = resolve(process.cwd());
const configPath = resolve(
  process.env.MKT_LARK_NATIVE_AI_WEEKLY_7D_UAT_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const devVarsPath = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const outputRoot = resolve(
  process.env.MKT_LARK_NATIVE_AI_WEEKLY_7D_UAT_OUTPUT_ROOT
    ?? LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_OUTPUT_ROOT,
);
const lockPath = resolve(outputRoot, '.weekly-7d-uat.lock');

let stage = 'init';
let repository = null;
let remote = null;
let attemptDirectory = null;
let lockHandle = null;
let summaryWritten = false;

try {
  const args = process.argv.slice(2);
  if (args.length === 0) printPlan();
  else if (args.length === 1 && args[0] === '--execute') await executeUatPreparation();
  else throw uatError(
    'Only --execute is supported',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_ARGUMENT_UNSUPPORTED',
    { argumentCount: args.length },
  );
} catch (error) {
  const failure = Object.freeze({
    ok: false,
    contractVersion: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_FAILED',
    message: sanitizeText(error?.message ?? String(error)),
    details: sanitizeValue(error?.details ?? {}),
    repository,
    remote: remote?.snapshot?.() ?? null,
    attemptDirectory: attemptDirectory ? relative(repositoryRoot, attemptDirectory) : null,
    aiCallCount: 0,
    automationActivationCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  if (attemptDirectory && !summaryWritten) {
    try {
      await writePrivateJson(resolve(attemptDirectory, 'failure-summary.json'), failure);
      summaryWritten = true;
    } catch {
      // Preserve primary failure.
    }
  }
  process.stderr.write(`${JSON.stringify(failure, null, 2)}\n`);
  process.exitCode = 1;
} finally {
  if (lockHandle) {
    try { await lockHandle.close(); } catch { /* no-op */ }
    try { await unlink(lockPath); } catch { /* preserve primary result */ }
  }
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_VERSION,
    objective: 'prepare_one_isolated_business_first_7d_executive_ai_uat_row_from_latest_available_lark_report_evidence',
    exactCommand: [
      'cd /Users/wasanjantawong/Git/social-marketing-integration-woo-diag &&',
      'git fetch --quiet origin main &&',
      'git switch main &&',
      'git pull --ff-only origin main &&',
      `CONFIRM_LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT=${LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_CONFIRMATION}`,
      'node scripts/lark-native-ai-weekly-7d-controlled-uat-terminal.mjs --execute',
    ].join(' '),
    selectionPolicy: 'newest_7d_period_with_maximum_channel_coverage',
    maximumAiRunWrites: 1,
    aiCallCount: 0,
    automationActivationCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    executed: false,
  }, null, 2)}\n`);
}

async function executeUatPreparation() {
  stage = 'confirmation';
  if (process.env.CONFIRM_LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT
    !== LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_CONFIRMATION) {
    throw uatError(
      'Exact weekly 7D AI controlled UAT confirmation is missing',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_CONFIRMATION_INVALID',
    );
  }
  const nodeMajor = Number(process.versions.node.split('.')[0]);
  if (!Number.isInteger(nodeMajor) || nodeMajor < 22) throw uatError(
    'Node.js 22 or newer is required',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_NODE_VERSION_UNSUPPORTED',
    { nodeMajor },
  );

  stage = 'fetch-origin-main';
  await runGit(['fetch', '--quiet', 'origin', 'main']);
  stage = 'repository-preflight';
  repository = Object.freeze({
    branch: await gitText(['branch', '--show-current']),
    head: await gitText(['rev-parse', 'HEAD']),
    originMain: await gitText(['rev-parse', 'origin/main']),
    clean: (await gitText(['status', '--porcelain'])) === '',
  });
  if (repository.branch !== 'main' || repository.clean !== true
    || repository.head !== repository.originMain || !/^[a-f0-9]{40}$/u.test(repository.head)) {
    throw uatError(
      'Weekly 7D AI UAT requires clean current main',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_REPOSITORY_INVALID',
      repository,
    );
  }

  stage = 'local-preflight';
  const runtime = await loadAndValidateRuntime();

  stage = 'acquire-local-lock';
  await mkdir(outputRoot, { recursive: true, mode: 0o700 });
  await chmod(outputRoot, 0o700);
  lockHandle = await acquireLock();

  stage = 'create-immutable-attempt-directory';
  attemptDirectory = await createAttemptDirectory();

  stage = 'initialize-lark-boundary';
  remote = createLarkNativeAiWeekly7dControlledUatFetchGuard(globalThis.fetch.bind(globalThis));
  const rawClient = createLarkBitableClientFromEnv(Object.freeze({
    ...runtime.env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_MAX_PAGES: '10',
    LARK_MAX_FILTER_CONDITIONS: '50',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  }), {
    fetchImpl: remote.fetchImpl,
    onRequest: (event) => process.stderr.write(`${JSON.stringify({
      stage: 'weekly_7d_ai_uat_lark',
      event: sanitizeValue(event),
    })}\n`),
  });

  stage = 'read-table-inventory';
  const tableInventory = await rawClient.listTables();
  const aiRunTableId = resolveTableId(tableInventory, LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES.aiRuns);
  const client = withCachedTableInventory(rawClient, tableInventory);

  stage = 'verify-existing-automation-authority';
  const automationResponse = await rawClient.requestBitableJson(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(rawClient.appToken)}/workflows`,
    { method: 'GET' },
  );
  const automationItems = automationResponse?.data?.workflows
    ?? automationResponse?.data?.items
    ?? automationResponse?.workflows
    ?? [];
  const automationAuthority = await assertLarkNativeAiWeekly7dAutomationAuthority({
    workflows: automationItems,
  });

  stage = 'collect-latest-7d-report-evidence';
  const source = await collectLarkNativeAiWeekly7dControlledUatSource({ client });

  stage = 'build-business-first-executive-uat';
  const uat = await buildLarkNativeAiWeekly7dControlledUat({
    customerKey: 'integration_workspace',
    customerProfile: 'integration_workspace',
    generatedAt: Date.now(),
    utcOffset: '+07:00',
    targetPeriod: source.targetPeriod,
    settings: source.settings,
    reportBundles: source.reportBundles,
  });
  const aiRunKey = uat.executiveRow.ai_run_key;
  const sourceEvidenceSha256 = await sha256Hex(JSON.stringify({
    targetPeriod: source.targetPeriod,
    selectedChannels: source.selectedChannels,
    sourceReportIds: source.sourceReportIds,
    sourceReportChecksum: uat.executiveRow.source_report_checksum,
  }));
  const promptSha256 = await sha256Hex(JSON.stringify(uat.uiConfiguration.actions.map((action) => ({
    targetField: action.targetField,
    promptText: action.promptText,
    referenceSlots: action.referenceSlots,
  }))));

  stage = 'read-existing-uat-row';
  const existingRecords = await client.searchRecordsByFieldValues({
    tableId: aiRunTableId,
    fieldName: 'ai_run_key',
    values: [aiRunKey],
  });
  const plan = planLarkNativeAiWeekly7dControlledUatWrite({
    desiredRow: uat.executiveRow,
    existingRecords,
  });

  stage = 'retain-private-package-before-write';
  const packagePath = resolve(attemptDirectory, 'weekly-7d-ai-uat-package.json');
  const uiPath = resolve(attemptDirectory, 'lark-ui-configuration.md');
  await writePrivateJson(packagePath, {
    contractVersion: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_VERSION,
    repository,
    automationAuthority,
    source,
    uat,
    sourceEvidenceSha256,
    promptSha256,
    plannedWrite: plan,
  });
  await writePrivateText(uiPath, renderUiConfigurationMarkdown({
    uat,
    automationAuthority,
    promptSha256,
  }));

  stage = 'apply-one-isolated-uat-row';
  let writeMode = plan.status;
  let recordWriteCount = 0;
  if (plan.status === 'create') {
    const result = await client.batchCreateRecords({
      tableId: aiRunTableId,
      records: [plan.action.fields],
    });
    if (result.created !== 1) throw uatError(
      'Weekly 7D AI UAT create count mismatch',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WRITE_COUNT_MISMATCH',
      { expected: 1, observed: result.created },
    );
    recordWriteCount = 1;
  } else if (plan.status === 'update') {
    const result = await client.batchUpdateRecords({
      tableId: aiRunTableId,
      records: [{ recordId: plan.action.recordId, fields: plan.action.fields }],
    });
    if (result.updated !== 1) throw uatError(
      'Weekly 7D AI UAT update count mismatch',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WRITE_COUNT_MISMATCH',
      { expected: 1, observed: result.updated },
    );
    recordWriteCount = 1;
  } else if (plan.status !== 'zero_drift') {
    throw uatError(
      'Weekly 7D AI UAT write plan is unsupported',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WRITE_PLAN_INVALID',
      { status: plan.status },
    );
  }

  stage = 'verify-uat-row-readback';
  if (recordWriteCount > 0) await wait(3000);
  const readbackRecords = await client.searchRecordsByFieldValues({
    tableId: aiRunTableId,
    fieldName: 'ai_run_key',
    values: [aiRunKey],
  });
  const readback = assertLarkNativeAiWeekly7dControlledUatReadback({
    desiredRow: uat.executiveRow,
    records: readbackRecords,
  });

  stage = 'write-summary';
  const summary = Object.freeze({
    ok: true,
    contractVersion: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_VERSION,
    stage: 'complete',
    status: 'ready_for_lark_native_ai_test_results',
    repository,
    targetPeriod: source.targetPeriod,
    selectionPolicy: source.selectionPolicy,
    selectedChannelCount: source.selectedChannelCount,
    selectedChannels: source.selectedChannels,
    businessEvidenceSummary: uat.businessEvidenceSummary,
    sourceEvidenceSha256,
    promptVersion: uat.uiConfiguration.promptVersion,
    promptSha256,
    aiRunKeySha256: await sha256Hex(aiRunKey),
    writeMode,
    recordWriteCount,
    readback: {
      verified: readback.ok,
      generationStatus: readback.generationStatus,
    },
    automationAuthority,
    uiConfigurationPath: relative(repositoryRoot, uiPath),
    packagePath: relative(repositoryRoot, packagePath),
    attemptDirectory: relative(repositoryRoot, attemptDirectory),
    remote: remote.snapshot(),
    aiCallCount: 0,
    automationActivationCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
    nextStep: 'configure_or_verify_prompt_v2_in_the_existing_inactive_ai_materialization_automation_then_run_test_results_on_this_7d_uat_row',
  });
  await writePrivateJson(resolve(attemptDirectory, 'summary.json'), summary);
  summaryWritten = true;
  process.stdout.write(`${JSON.stringify(summary, null, 2)}\n`);
}

function withCachedTableInventory(rawClient, tableInventory) {
  return Object.freeze({
    listTables: async () => tableInventory,
    listRecordsPage: (input) => rawClient.listRecordsPage(input),
    searchRecordsByFieldValues: (input) => rawClient.searchRecordsByFieldValues(input),
    batchCreateRecords: (input) => rawClient.batchCreateRecords(input),
    batchUpdateRecords: (input) => rawClient.batchUpdateRecords(input),
  });
}

async function loadAndValidateRuntime() {
  let config;
  try {
    config = parseJsoncObject(await readFile(configPath, 'utf8'));
  } catch (error) {
    throw uatError(
      'Reviewed wrangler.sync.jsonc could not be loaded',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_CONFIG_INVALID',
      { code: error?.code ?? null },
    );
  }
  const devVars = await readOptionalPrivateDevVars(devVarsPath);
  const env = Object.freeze({ ...(config.vars ?? {}), ...devVars, ...process.env });
  const blockers = [];
  if (config.name !== 'social-mkt-sync-worker') blockers.push({ code: 'WORKER_NAME_INVALID' });
  if (env.MKT_ENV !== 'development') blockers.push({ code: 'MKT_ENV_INVALID' });
  if (env.MKT_CUSTOMER_PROFILE !== 'integration_workspace') blockers.push({ code: 'CUSTOMER_PROFILE_INVALID' });
  for (const field of ['LARK_APP_ID', 'LARK_APP_SECRET']) {
    if (!optionalText(env[field])) blockers.push({ code: 'REQUIRED_ENV_MISSING', field });
  }
  if (!optionalText(env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN)) blockers.push({
    code: 'REQUIRED_ENV_MISSING', field: 'LARK_APP_TOKEN|LARK_BASE_APP_TOKEN',
  });
  if (blockers.length > 0) throw uatError(
    'Weekly 7D AI UAT local preflight found blockers',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LOCAL_PREFLIGHT_BLOCKED',
    { blockers },
  );
  return Object.freeze({ config, env });
}

async function readOptionalPrivateDevVars(path) {
  try {
    const metadata = await lstat(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()) throw uatError(
      '.dev.vars must be a regular non-symlink file',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_DEV_VARS_INVALID',
    );
    if ((metadata.mode & 0o077) !== 0) await chmod(path, 0o600);
    return await readDevVars(path);
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
}

function resolveTableId(inventory, name) {
  const matches = inventory.filter((table) => table.name === name && table.tableId);
  if (matches.length !== 1) throw uatError(
    'Weekly 7D AI UAT target table identity is invalid',
    'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLE_INVALID',
    { name, count: matches.length },
  );
  return matches[0].tableId;
}

async function acquireLock() {
  try {
    const handle = await open(lockPath, 'wx', 0o600);
    await handle.writeFile(`${JSON.stringify({
      contractVersion: LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_VERSION,
      head: repository.head,
      pid: process.pid,
      createdAt: Date.now(),
    })}\n`, 'utf8');
    await chmod(lockPath, 0o600);
    return handle;
  } catch (error) {
    if (error?.code === 'EEXIST') throw uatError(
      'A weekly 7D AI UAT local lock already exists',
      'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_LOCK_EXISTS',
      { lockPath: relative(repositoryRoot, lockPath) },
    );
    throw error;
  }
}

async function createAttemptDirectory() {
  const stamp = new Date().toISOString().replace(/[-:.]/gu, '');
  const path = resolve(outputRoot, `${stamp}-${repository.head.slice(0, 12)}-${process.pid}`);
  await mkdir(path, { recursive: false, mode: 0o700 });
  await chmod(path, 0o700);
  return path;
}

function renderUiConfigurationMarkdown({ uat, automationAuthority, promptSha256 }) {
  const lines = [
    '# Lark Native AI Weekly 7D Controlled UAT — UI Configuration',
    '',
    '## Safety',
    '',
    '- Keep `AI Materialization → MKT_AI_Report_Runs` inactive while configuring and testing.',
    '- Do not edit or activate `Eligible AI Run → Lark Group Notification` in this phase.',
    '- Test only the prepared 7D Executive UAT row.',
    '- Do not set `notification_eligible=true` or `preview_mode=false`.',
    '',
    '## Exact Automation authority',
    '',
    ...automationAuthority.map((item) => `- ${item.title}: ${item.status} / identity SHA-256 ${item.workflowIdSha256}`),
    '',
    `Prompt version: \`${uat.uiConfiguration.promptVersion}\``,
    `Prompt package SHA-256: \`${promptSha256}\``,
    '',
    '## Required topology',
    '',
    'Trigger current/new `🧠 MKT_AI_Report_Runs` row → Delay 1 minute → four AI-generated text actions → one Update record action.',
    '',
  ];
  for (const action of uat.uiConfiguration.actions) {
    lines.push(
      `## AI action → ${action.targetField}`,
      '',
      `Reference fields: ${action.referenceSlots.map((slot) => `\`${slot}\``).join(', ')}`,
      '',
      'In Lark, replace every `{{field_name}}` placeholder below with the rich reference token for the current trigger record field of the same name.',
      '',
      '```text',
      action.promptText,
      '```',
      '',
    );
  }
  lines.push(
    '## Final Update record',
    '',
    '- Target: the current trigger row in `🧠 MKT_AI_Report_Runs`.',
    '- `insight_summary` = result from its AI action.',
    '- `strengths` = result from its AI action.',
    '- `weaknesses` = result from its AI action.',
    '- `recommendations` = result from its AI action.',
    '- `generation_status` = `generated`.',
    '- `failure_code` = empty.',
    '- `generated_at` = Automation current time.',
    '',
    'Run Test Results only. Keep the Automation inactive after the test until the generated text is reviewed.',
    '',
  );
  return `${lines.join('\n')}\n`;
}

async function writePrivateJson(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await chmod(path, 0o600);
}
async function writePrivateText(path, value) {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  await writeFile(path, value, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
  await chmod(path, 0o600);
}
async function runGit(args) {
  try {
    await execFileAsync('git', args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
  } catch (error) {
    throw uatError(`Git command failed: git ${args.join(' ')}`, 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_GIT_FAILED', { exitCode: Number.isInteger(error?.code) ? error.code : null });
  }
}
async function gitText(args) {
  try {
    const result = await execFileAsync('git', args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    return String(result.stdout ?? '').trim();
  } catch (error) {
    throw uatError(`Git command failed: git ${args.join(' ')}`, 'LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_GIT_FAILED', { exitCode: Number.isInteger(error?.code) ? error.code : null });
  }
}
async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function wait(delayMs) { return new Promise((resolveWait) => setTimeout(resolveWait, delayMs)); }
function optionalText(value) { return typeof value === 'string' && value.trim() ? value.trim() : null; }
function sanitizeText(value) {
  return String(value ?? '')
    .replace(/https:\/\/open\.larksuite\.com\/[^\s"']+/gu, '[redacted-lark-url]')
    .replace(/\b(?:oc|cli|app|tbl|rec|vew|fld|opt)[A-Za-z0-9_-]+\b/gu, '[redacted-id]')
    .replace(/\b\d{12,40}\b/gu, '[redacted-workflow-id]')
    .slice(0, 2000);
}
function sanitizeValue(value) {
  if (typeof value === 'string') return sanitizeText(value);
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeValue(nested)]));
  return value;
}
function uatError(message, code, details = {}) { return weekly7dControlledUatError(message, code, details); }
