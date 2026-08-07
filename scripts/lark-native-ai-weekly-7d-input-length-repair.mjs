#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { compactLarkNativeAiWeeklyEvidence } from '../packages/application/src/reports/compact-lark-native-ai-weekly-evidence.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS,
} from '../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';

const execFileAsync = promisify(execFile);
const CONFIRMATION = 'REPAIR_COMPACT_AND_RETRY_WEEKLY_7D_AI_UAT';
const RETRY_MARKER = 'CONTROLLED_UAT_RETRY_COMPACT_V1';
const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';
const ACTIVE = new Set(['enable', 'enabled', 'active', 'on']);
const INACTIVE = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const POLL_MS = 5000;
const POLL_ATTEMPTS = 24;
const repositoryRoot = resolve(process.cwd());

let stage = 'init';
let repository = null;

try {
  if (process.argv.length !== 3 || process.argv[2] !== '--execute') {
    printPlan();
  } else {
    await execute();
  }
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: 'lark_native_ai_weekly_7d_input_length_repair_v1',
    stage,
    code: error?.code ?? 'LARK_AI_INPUT_LENGTH_REPAIR_FAILED',
    message: sanitize(error?.message ?? String(error)),
    details: sanitizeValue(error?.details ?? {}),
    repository,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

function printPlan() {
  process.stdout.write(`${JSON.stringify({
    ok: true,
    planOnly: true,
    contractVersion: 'lark_native_ai_weekly_7d_input_length_repair_v1',
    objective: 'compact_existing_weekly_7d_executive_evidence_and_trigger_exactly_one_real_ai_retry',
    confirmation: CONFIRMATION,
    maximumRecordWrites: 1,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function execute() {
  stage = 'confirmation';
  if (process.env.CONFIRM_LARK_NATIVE_AI_WEEKLY_7D_INPUT_LENGTH_REPAIR !== CONFIRMATION) {
    throw failure('Exact input-length repair confirmation is missing', 'LARK_AI_INPUT_LENGTH_REPAIR_CONFIRMATION_INVALID');
  }

  stage = 'repository-preflight';
  await runGit(['fetch', '--quiet', 'origin', 'main']);
  repository = Object.freeze({
    branch: await gitText(['branch', '--show-current']),
    head: await gitText(['rev-parse', 'HEAD']),
    originMain: await gitText(['rev-parse', 'origin/main']),
    clean: (await gitText(['status', '--porcelain'])) === '',
  });
  if (repository.branch !== 'main' || repository.clean !== true || repository.head !== repository.originMain) {
    throw failure('Input-length repair requires clean exact current main', 'LARK_AI_INPUT_LENGTH_REPAIR_REPOSITORY_INVALID', repository);
  }

  stage = 'runtime-preflight';
  const env = await loadRuntime();
  const client = createLarkBitableClientFromEnv(Object.freeze({
    ...env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_MAX_PAGES: '5',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  }));

  stage = 'resolve-table';
  const tables = await client.listTables();
  const aiTableId = exactTableId(tables, LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES.aiRuns);

  stage = 'verify-automation-states';
  const workflowResponse = await client.requestBitableJson(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}/workflows`,
    { method: 'GET' },
  );
  const workflows = workflowResponse?.data?.workflows ?? workflowResponse?.data?.items ?? workflowResponse?.workflows ?? [];
  const automationState = await verifyAutomationState(workflows);

  stage = 'load-exact-uat-row';
  const candidates = await client.searchRecordsByFieldValues({
    tableId: aiTableId,
    fieldName: 'template_version',
    values: [LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION],
  });
  const matches = candidates.filter((record) => isExactUatRow(record?.fields));
  if (matches.length !== 1) {
    throw failure('Expected exactly one pending weekly Executive UAT row', 'LARK_AI_INPUT_LENGTH_REPAIR_UAT_ROW_INVALID', {
      candidates: candidates.length,
      exactMatches: matches.length,
    });
  }
  const record = matches[0];
  const recordId = requireText(record.recordId ?? record.record_id, 'recordId');
  const fields = requireObject(record.fields, 'record.fields');
  const aiRunKey = requireText(fields.ai_run_key, 'ai_run_key');

  stage = 'compact-business-evidence';
  const compact = compactLarkNativeAiWeeklyEvidence({
    metricSummaryJson: requireText(fields.metric_summary_json, 'metric_summary_json'),
    channelStatusVectorJson: optionalText(fields.channel_status_vector_json),
  });
  const before = Object.freeze({
    metricSummaryChars: String(fields.metric_summary_json).length,
    channelStatusVectorChars: String(fields.channel_status_vector_json ?? '').length,
  });
  if (compact.metricSummaryChars >= before.metricSummaryChars) {
    throw failure('Compaction did not reduce the Executive metric summary', 'LARK_AI_INPUT_LENGTH_REPAIR_NOT_SMALLER', {
      before,
      after: compact,
    });
  }

  stage = 'repair-and-trigger-once';
  const update = await client.batchUpdateRecords({
    tableId: aiTableId,
    records: [{
      recordId,
      fields: {
        metric_summary_json: compact.metricSummaryJson,
        channel_status_vector_json: compact.channelStatusVectorJson,
        failure_code: RETRY_MARKER,
      },
    }],
  });
  if (update.updated !== 1) {
    throw failure('Expected exactly one UAT repair write', 'LARK_AI_INPUT_LENGTH_REPAIR_WRITE_COUNT_INVALID', { updated: update.updated });
  }

  stage = 'observe-ai-result';
  let observed = null;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    await wait(POLL_MS);
    const rows = await client.searchRecordsByFieldValues({
      tableId: aiTableId,
      fieldName: 'ai_run_key',
      values: [aiRunKey],
    });
    if (rows.length !== 1) {
      throw failure('UAT row identity drifted while observing AI retry', 'LARK_AI_INPUT_LENGTH_REPAIR_READBACK_INVALID', { count: rows.length });
    }
    observed = requireObject(rows[0].fields, 'readback.fields');
    const generationStatus = optionalText(observed.generation_status);
    if (generationStatus === 'generated') break;
    if (generationStatus === 'failed') break;
  }

  const result = Object.freeze({
    ok: observed?.generation_status === 'generated'
      && fourOutputsPresent(observed),
    contractVersion: 'lark_native_ai_weekly_7d_input_length_repair_v1',
    stage: 'complete',
    status: observed?.generation_status === 'generated' && fourOutputsPresent(observed)
      ? 'weekly_7d_ai_generated_after_compaction'
      : 'weekly_7d_ai_retry_not_completed',
    repository,
    automationState,
    evidenceLength: {
      before,
      after: {
        metricSummaryChars: compact.metricSummaryChars,
        channelStatusVectorChars: compact.channelStatusVectorChars,
        selectedTier: compact.selectedTier,
      },
    },
    recordWriteCount: 1,
    retryMarker: RETRY_MARKER,
    generationStatus: optionalText(observed?.generation_status),
    outputsPresent: outputPresence(observed),
    notificationEligible: booleanValue(observed?.notification_eligible),
    sentToGroup: booleanValue(observed?.sent_to_group),
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

async function verifyAutomationState(workflows) {
  const ai = exactWorkflow(workflows, AI_TITLE);
  const notification = exactWorkflow(workflows, NOTIFICATION_TITLE);
  const expectedAi = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS.find((item) => item.title === AI_TITLE);
  const expectedNotification = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS.find((item) => item.title === NOTIFICATION_TITLE);
  const aiHash = await sha256Hex(workflowId(ai));
  const notificationHash = await sha256Hex(workflowId(notification));
  const aiStatus = requireText(ai.status ?? ai.state, 'AI automation status').toLowerCase();
  const notificationStatus = requireText(notification.status ?? notification.state, 'Notification automation status').toLowerCase();
  if (aiHash !== expectedAi?.workflowIdSha256 || !ACTIVE.has(aiStatus)) {
    throw failure('Exact AI Materialization automation must be active for the controlled retry', 'LARK_AI_INPUT_LENGTH_REPAIR_AI_AUTOMATION_NOT_ACTIVE', {
      identityMatches: aiHash === expectedAi?.workflowIdSha256,
      status: aiStatus,
    });
  }
  if (notificationHash !== expectedNotification?.workflowIdSha256 || !INACTIVE.has(notificationStatus)) {
    throw failure('Exact Notification automation must remain inactive for the controlled retry', 'LARK_AI_INPUT_LENGTH_REPAIR_NOTIFICATION_NOT_SAFE', {
      identityMatches: notificationHash === expectedNotification?.workflowIdSha256,
      status: notificationStatus,
    });
  }
  return Object.freeze({
    aiMaterialization: { status: aiStatus, identitySha256: aiHash },
    notification: { status: notificationStatus, identitySha256: notificationHash },
  });
}

function isExactUatRow(fields) {
  if (!fields || typeof fields !== 'object') return false;
  return optionalText(fields.template_version) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION
    && optionalText(fields.scope_type) === 'executive'
    && optionalText(fields.channel_key) === 'executive'
    && Number(optionalText(fields.window_days)) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS
    && optionalText(fields.readiness_status) === 'report_partial'
    && optionalText(fields.generation_status) === 'pending'
    && booleanValue(fields.preview_mode) === true
    && booleanValue(fields.notification_eligible) === false
    && booleanValue(fields.sent_to_group) === false;
}

function exactWorkflow(workflows, title) {
  const matches = workflows.filter((item) => optionalText(item?.title ?? item?.name) === title);
  if (matches.length !== 1) throw failure(`Expected one exact Automation: ${title}`, 'LARK_AI_INPUT_LENGTH_REPAIR_AUTOMATION_IDENTITY_INVALID', { title, count: matches.length });
  return matches[0];
}
function workflowId(workflow) {
  return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id');
}
function exactTableId(tables, name) {
  const matches = tables.filter((table) => table.name === name && table.tableId);
  if (matches.length !== 1) throw failure(`Expected one exact Lark table: ${name}`, 'LARK_AI_INPUT_LENGTH_REPAIR_TABLE_INVALID', { name, count: matches.length });
  return matches[0].tableId;
}

async function loadRuntime() {
  const config = parseJsoncObject(await readFile(resolve(repositoryRoot, 'wrangler.sync.jsonc'), 'utf8'));
  let devVars = {};
  try { devVars = await readDevVars(resolve(repositoryRoot, '.dev.vars')); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const env = Object.freeze({ ...(config.vars ?? {}), ...devVars, ...process.env });
  if (config.name !== 'social-mkt-sync-worker'
    || env.MKT_ENV !== 'development'
    || env.MKT_CUSTOMER_PROFILE !== 'integration_workspace'
    || !optionalText(env.LARK_APP_ID)
    || !optionalText(env.LARK_APP_SECRET)
    || !optionalText(env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN)) {
    throw failure('Reviewed Integration Workspace Lark runtime is incomplete', 'LARK_AI_INPUT_LENGTH_REPAIR_RUNTIME_INVALID');
  }
  return env;
}

function fourOutputsPresent(fields) {
  return ['insight_summary', 'strengths', 'weaknesses', 'recommendations']
    .every((field) => Boolean(optionalText(fields?.[field])));
}
function outputPresence(fields) {
  return Object.fromEntries(['insight_summary', 'strengths', 'weaknesses', 'recommendations']
    .map((field) => [field, Boolean(optionalText(fields?.[field]))]));
}
function booleanValue(value) {
  if (value === true || value === false) return value;
  if (typeof value === 'number') return value !== 0;
  const text = optionalText(value)?.toLowerCase();
  if (['true', '1', 'yes', 'checked'].includes(text)) return true;
  if (['false', '0', 'no', 'unchecked', ''].includes(text ?? '')) return false;
  return null;
}
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be an object`);
  return value;
}
function requireText(value, label) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) return optionalText(value[0]);
  if (typeof value === 'object') return optionalText(value.text ?? value.value ?? value.name);
  const text = String(value).trim();
  return text || null;
}
function failure(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}
function sanitize(value) {
  return String(value).replace(/[\r\n\t]+/gu, ' ').slice(0, 500);
}
function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitize(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeValue(nested)]));
}
async function sha256Hex(value) {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(String(value)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
async function wait(ms) { await new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
async function runGit(args) {
  await execFileAsync('git', args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
}
async function gitText(args) {
  const result = await execFileAsync('git', args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  return String(result.stdout ?? '').trim();
}
