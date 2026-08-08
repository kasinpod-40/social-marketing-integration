#!/usr/bin/env node

import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
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
const CONFIRMATION = 'TRIGGER_WEEKLY_7D_NATIVE_AI_QUALITY_V4';
const PREVIOUS_MARKER = 'CONTROLLED_UAT_NATIVE_AI_QUALITY_RETRY_V3';
const TRIGGER_MARKER = 'CONTROLLED_UAT_NATIVE_AI_QUALITY_TRIGGER_V4';
const PROMPT_SHAPE = 'lark_ai_compact_quality_v2';
const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';
const ACTIVE = new Set(['enable', 'enabled', 'active', 'on']);
const INACTIVE = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const POLL_MS = 5000;
const POLL_ATTEMPTS = 36;
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
    contractVersion: 'lark_native_ai_weekly_7d_quality_trigger_only_v1',
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_QUALITY_TRIGGER_FAILED',
    message: sanitize(error?.message ?? String(error)),
    details: sanitizeValue(error?.details ?? {}),
    repository,
    remoteWrites: stage === 'observe-ai-result' ? 1 : 0,
    aiCallsByOperator: 0,
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
    contractVersion: 'lark_native_ai_weekly_7d_quality_trigger_only_v1',
    objective: 'wake_prepared_weekly_7d_quality_uat_by_updating_failure_code_only',
    confirmation: CONFIRMATION,
    allowedWriteFields: ['failure_code'],
    maximumRecordWrites: 1,
    evidenceMutation: false,
    outputMutationByOperator: false,
    aiCallsByOperator: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function execute() {
  stage = 'confirmation';
  if (process.env.CONFIRM_LARK_NATIVE_AI_WEEKLY_7D_QUALITY_TRIGGER !== CONFIRMATION) {
    throw failure('Exact one-field weekly AI quality trigger confirmation is missing', 'LARK_NATIVE_AI_QUALITY_TRIGGER_CONFIRMATION_INVALID');
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
    throw failure('Quality trigger requires clean exact current main', 'LARK_NATIVE_AI_QUALITY_TRIGGER_REPOSITORY_INVALID', repository);
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

  stage = 'load-prepared-quality-row';
  const candidates = await client.searchRecordsByFieldValues({
    tableId: aiTableId,
    fieldName: 'template_version',
    values: [LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION],
  });
  const matches = candidates.filter((record) => isPreparedQualityRow(record?.fields));
  if (matches.length !== 1) {
    throw failure('Expected exactly one prepared pending weekly Executive quality row', 'LARK_NATIVE_AI_QUALITY_TRIGGER_UAT_ROW_INVALID', {
      candidates: candidates.length,
      exactMatches: matches.length,
    });
  }

  const record = matches[0];
  const recordId = requireText(record.recordId ?? record.record_id, 'recordId');
  const fields = requireObject(record.fields, 'record.fields');
  const aiRunKey = requireText(fields.ai_run_key, 'ai_run_key');
  const metricSummaryText = requireText(fields.metric_summary_json, 'metric_summary_json');
  const metricSummary = parseJsonObject(metricSummaryText, 'metric_summary_json');
  const channelStatusVectorText = requireText(fields.channel_status_vector_json, 'channel_status_vector_json');
  const channelStatusVector = parseJsonArray(channelStatusVectorText, 'channel_status_vector_json');

  stage = 'verify-prepared-quality-evidence';
  if (metricSummary.evidenceShape !== 'executive_business_first_v2'
    || metricSummary.promptShape !== PROMPT_SHAPE
    || !Array.isArray(metricSummary.channelBusinessEvidence)
    || metricSummary.channelBusinessEvidence.length !== 9
    || channelStatusVector.length !== 9
    || metricSummaryText.length > 2800
    || channelStatusVectorText.length > 700) {
    throw failure('Prepared quality evidence is not the reviewed weekly Executive shape', 'LARK_NATIVE_AI_QUALITY_TRIGGER_EVIDENCE_INVALID', {
      evidenceShape: optionalText(metricSummary.evidenceShape),
      promptShape: optionalText(metricSummary.promptShape),
      businessEvidenceCount: Array.isArray(metricSummary.channelBusinessEvidence) ? metricSummary.channelBusinessEvidence.length : null,
      channelStatusVectorCount: channelStatusVector.length,
      metricSummaryChars: metricSummaryText.length,
      channelStatusVectorChars: channelStatusVectorText.length,
    });
  }

  stage = 'trigger-one-field-only';
  const updateFields = { failure_code: TRIGGER_MARKER };
  if (Object.keys(updateFields).length !== 1 || !Object.hasOwn(updateFields, 'failure_code')) {
    throw failure('One-field trigger write contract drifted', 'LARK_NATIVE_AI_QUALITY_TRIGGER_WRITE_CONTRACT_INVALID');
  }
  const update = await client.batchUpdateRecords({
    tableId: aiTableId,
    records: [{ recordId, fields: updateFields }],
  });
  if (update.updated !== 1) {
    throw failure('Expected exactly one one-field weekly AI quality trigger write', 'LARK_NATIVE_AI_QUALITY_TRIGGER_WRITE_COUNT_INVALID', { updated: update.updated });
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
      throw failure('UAT row identity drifted while observing quality trigger', 'LARK_NATIVE_AI_QUALITY_TRIGGER_READBACK_INVALID', { count: rows.length });
    }
    observed = requireObject(rows[0].fields, 'readback.fields');
    const generationStatus = optionalText(observed.generation_status);
    if (generationStatus === 'generated' || generationStatus === 'failed') break;
  }

  const generated = optionalText(observed?.generation_status) === 'generated' && fourOutputsPresent(observed);
  const result = Object.freeze({
    ok: generated,
    contractVersion: 'lark_native_ai_weekly_7d_quality_trigger_only_v1',
    stage: 'complete',
    status: generated ? 'weekly_7d_native_ai_quality_generated' : 'weekly_7d_native_ai_quality_trigger_not_completed',
    repository,
    automationState,
    evidence: {
      metricSummaryChars: metricSummaryText.length,
      channelStatusVectorChars: channelStatusVectorText.length,
      promptShape: metricSummary.promptShape,
    },
    recordWriteCount: 1,
    writtenFields: ['failure_code'],
    triggerMarker: TRIGGER_MARKER,
    generationStatus: optionalText(observed?.generation_status),
    outputsPresent: outputPresence(observed),
    outputs: generated ? {
      insight_summary: optionalText(observed.insight_summary),
      strengths: optionalText(observed.strengths),
      weaknesses: optionalText(observed.weaknesses),
      recommendations: optionalText(observed.recommendations),
    } : null,
    notificationEligible: booleanValue(observed?.notification_eligible),
    sentToGroup: booleanValue(observed?.sent_to_group),
    aiCallsByOperator: 0,
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
    throw failure('Exact AI Materialization automation must be active', 'LARK_NATIVE_AI_QUALITY_TRIGGER_AI_AUTOMATION_NOT_ACTIVE', {
      identityMatches: aiHash === expectedAi?.workflowIdSha256,
      status: aiStatus,
    });
  }
  if (notificationHash !== expectedNotification?.workflowIdSha256 || !INACTIVE.has(notificationStatus)) {
    throw failure('Exact Notification automation must remain inactive', 'LARK_NATIVE_AI_QUALITY_TRIGGER_NOTIFICATION_NOT_SAFE', {
      identityMatches: notificationHash === expectedNotification?.workflowIdSha256,
      status: notificationStatus,
    });
  }
  return Object.freeze({
    aiMaterialization: { status: aiStatus, identitySha256: aiHash },
    notification: { status: notificationStatus, identitySha256: notificationHash },
  });
}

function isPreparedQualityRow(fields) {
  if (!fields || typeof fields !== 'object') return false;
  return optionalText(fields.template_version) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION
    && optionalText(fields.scope_type) === 'executive'
    && optionalText(fields.channel_key) === 'executive'
    && Number(optionalText(fields.window_days)) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS
    && optionalText(fields.readiness_status) === 'report_partial'
    && optionalText(fields.generation_status) === 'pending'
    && optionalText(fields.failure_code) === PREVIOUS_MARKER
    && booleanValue(fields.preview_mode) === true
    && booleanValue(fields.notification_eligible) === false
    && booleanValue(fields.sent_to_group) === false
    && !fourOutputsPresent(fields);
}

function exactWorkflow(workflows, title) {
  const matches = workflows.filter((item) => optionalText(item?.title ?? item?.name) === title);
  if (matches.length !== 1) throw failure(`Expected one exact Automation: ${title}`, 'LARK_NATIVE_AI_QUALITY_TRIGGER_AUTOMATION_IDENTITY_INVALID', { title, count: matches.length });
  return matches[0];
}
function workflowId(workflow) {
  return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id');
}
function exactTableId(tables, name) {
  const matches = tables.filter((table) => table.name === name && table.tableId);
  if (matches.length !== 1) throw failure(`Expected one exact Lark table: ${name}`, 'LARK_NATIVE_AI_QUALITY_TRIGGER_TABLE_INVALID', { name, count: matches.length });
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
    throw failure('Reviewed Integration Workspace Lark runtime is incomplete', 'LARK_NATIVE_AI_QUALITY_TRIGGER_RUNTIME_INVALID');
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
function parseJsonObject(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw failure(`${label} must be a JSON object`, 'LARK_NATIVE_AI_QUALITY_TRIGGER_JSON_INVALID', { label });
  }
}
function parseJsonArray(value, label) {
  try {
    const parsed = JSON.parse(value);
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed;
  } catch {
    throw failure(`${label} must be a JSON array`, 'LARK_NATIVE_AI_QUALITY_TRIGGER_JSON_INVALID', { label });
  }
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
