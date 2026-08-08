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
import { LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION } from '../packages/config/src/lark-native-ai-automation-prompt-contract.js';
import {
  readLarkNativeAiExecutiveBusinessMetricEvidence,
  validateLarkNativeAiExecutiveWriterOutputs,
} from '../packages/application/src/reports/lark-native-ai-executive-writer-quality.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';

const execFileAsync = promisify(execFile);
const CONTRACT_VERSION = 'lark_native_ai_weekly_7d_v9_read_only_acceptance_v1';
const EXPECTED_PROMPT_VERSION = 'lark_native_ai_automation_prompts_v3';
const EXPECTED_PROMPT_SHAPE = 'lark_ai_compact_quality_v6';
const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';
const ACTIVE = new Set(['enable', 'enabled', 'active', 'on']);
const INACTIVE = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const OUTPUT_FIELDS = Object.freeze([
  'insight_summary',
  'strengths',
  'weaknesses',
  'recommendations',
]);
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
    contractVersion: CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_V9_READ_ONLY_ACCEPTANCE_FAILED',
    message: sanitize(error?.message ?? String(error)),
    details: sanitizeValue(error?.details ?? {}),
    repository,
    recordWriteCount: 0,
    aiCallCount: 0,
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
    contractVersion: CONTRACT_VERSION,
    mode: 'READ_ONLY',
    objective: 'revalidate_retained_generated_v9_output_after_validator_false_positive_correction',
    expectedPromptVersion: EXPECTED_PROMPT_VERSION,
    expectedPromptShape: EXPECTED_PROMPT_SHAPE,
    recordWriteCount: 0,
    evidenceRewriteCount: 0,
    aiCallCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function execute() {
  stage = 'repository-preflight';
  await runGit(['fetch', '--quiet', 'origin', 'main']);
  repository = Object.freeze({
    branch: await gitText(['branch', '--show-current']),
    head: await gitText(['rev-parse', 'HEAD']),
    originMain: await gitText(['rev-parse', 'origin/main']),
    clean: (await gitText(['status', '--porcelain'])) === '',
  });
  if (repository.branch !== 'main' || repository.clean !== true || repository.head !== repository.originMain) {
    throw failure('V9 read-only acceptance requires clean exact current main', 'LARK_NATIVE_AI_V9_ACCEPTANCE_REPOSITORY_INVALID', repository);
  }
  if (LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION !== EXPECTED_PROMPT_VERSION) {
    throw failure('Repository Prompt contract must remain Prompt v3', 'LARK_NATIVE_AI_V9_ACCEPTANCE_PROMPT_CONTRACT_INVALID', {
      observedPromptVersion: LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION,
      expectedPromptVersion: EXPECTED_PROMPT_VERSION,
    });
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

  stage = 'load-finalized-v9-row';
  const candidates = await client.searchRecordsByFieldValues({
    tableId: aiTableId,
    fieldName: 'template_version',
    values: [LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION],
  });
  const matches = candidates.filter((record) => isExactFinalizedV9Row(record?.fields));
  if (matches.length !== 1) {
    throw failure('Expected exactly one finalized generated V9 Executive UAT row', 'LARK_NATIVE_AI_V9_ACCEPTANCE_SOURCE_ROW_INVALID', {
      candidates: candidates.length,
      exactMatches: matches.length,
      candidateStates: candidates.slice(0, 3).map((record) => summarizeCandidateState(record?.fields)),
    });
  }

  const fields = requireObject(matches[0].fields, 'record.fields');
  const metricSummaryText = requireText(fields.metric_summary_json, 'metric_summary_json');
  const channelStatusVectorText = requireText(fields.channel_status_vector_json, 'channel_status_vector_json');
  const outputs = readOutputs(fields);

  stage = 'reconstruct-reviewed-v9-evidence';
  const evidence = readLarkNativeAiExecutiveBusinessMetricEvidence({
    metricSummaryJson: metricSummaryText,
    channelStatusVectorJson: channelStatusVectorText,
  });
  if (evidence.promptShape !== EXPECTED_PROMPT_SHAPE || evidence.derivedCtrFacts.length < 1) {
    throw failure('Retained V9 evidence must contain reviewed derived CTR facts', 'LARK_NATIVE_AI_V9_ACCEPTANCE_EVIDENCE_INVALID', {
      promptShape: evidence.promptShape,
      derivedCtrFactCount: evidence.derivedCtrFacts.length,
    });
  }

  stage = 'validate-generated-output';
  const qualityGate = validateLarkNativeAiExecutiveWriterOutputs(outputs, evidence);
  const passed = qualityGate.passed === true;

  const result = Object.freeze({
    ok: passed,
    contractVersion: CONTRACT_VERSION,
    stage: 'complete',
    mode: 'READ_ONLY',
    status: passed
      ? 'weekly_7d_native_ai_v9_read_only_acceptance_passed'
      : 'weekly_7d_native_ai_v9_read_only_acceptance_failed',
    repository,
    automationState,
    promptContract: {
      version: EXPECTED_PROMPT_VERSION,
      larkPromptMutationCount: 0,
    },
    evidence: {
      promptShape: evidence.promptShape,
      businessEvidenceChannelCount: evidence.businessEvidenceChannelCount,
      comparisonEvidenceChannelCount: evidence.comparisonEvidenceChannelCount,
      businessEvidenceChannelNames: evidence.businessEvidenceChannelNames,
      summaryRequiredFacts: evidence.summaryRequiredFacts,
      derivedCtrFacts: evidence.derivedCtrFacts,
    },
    generationStatus: optionalText(fields.generation_status),
    outputsPresent: outputPresence(fields),
    outputs,
    qualityGate,
    previewMode: booleanValue(fields.preview_mode),
    notificationEligible: booleanValue(fields.notification_eligible),
    sentToGroup: booleanValue(fields.sent_to_group),
    recordWriteCount: 0,
    evidenceRewriteCount: 0,
    aiCallCount: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

function isExactFinalizedV9Row(fields) {
  if (!fields || typeof fields !== 'object') return false;
  return optionalText(fields.template_version) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION
    && optionalText(fields.scope_type) === 'executive'
    && optionalText(fields.channel_key) === 'executive'
    && Number(optionalText(fields.window_days)) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS
    && optionalText(fields.readiness_status) === 'report_partial'
    && optionalText(fields.generation_status) === 'generated'
    && optionalText(fields.failure_code) === null
    && readPromptShape(fields.metric_summary_json) === EXPECTED_PROMPT_SHAPE
    && booleanValue(fields.preview_mode) === true
    && booleanValue(fields.notification_eligible) === false
    && booleanValue(fields.sent_to_group) === false
    && fourOutputsPresent(fields);
}

function summarizeCandidateState(fields) {
  if (!fields || typeof fields !== 'object') return null;
  return Object.freeze({
    scopeType: optionalText(fields.scope_type),
    channelKey: optionalText(fields.channel_key),
    windowDays: Number(optionalText(fields.window_days)),
    readinessStatus: optionalText(fields.readiness_status),
    generationStatus: optionalText(fields.generation_status),
    failureCode: optionalText(fields.failure_code),
    promptShape: readPromptShape(fields.metric_summary_json),
    previewMode: booleanValue(fields.preview_mode),
    notificationEligible: booleanValue(fields.notification_eligible),
    sentToGroup: booleanValue(fields.sent_to_group),
    outputsPresent: outputPresence(fields),
  });
}

function readOutputs(fields) {
  return Object.freeze(Object.fromEntries(OUTPUT_FIELDS.map((field) => [field, optionalText(fields?.[field])])));
}
function readPromptShape(value) {
  const text = optionalText(value);
  if (!text) return null;
  try { return optionalText(JSON.parse(text)?.promptShape); } catch { return null; }
}
function fourOutputsPresent(fields) {
  return OUTPUT_FIELDS.every((field) => Boolean(optionalText(fields?.[field])));
}
function outputPresence(fields) {
  return Object.fromEntries(OUTPUT_FIELDS.map((field) => [field, Boolean(optionalText(fields?.[field]))]));
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
    throw failure('Exact AI Materialization automation must be active', 'LARK_NATIVE_AI_V9_ACCEPTANCE_AI_AUTOMATION_INVALID', {
      identityMatches: aiHash === expectedAi?.workflowIdSha256,
      status: aiStatus,
    });
  }
  if (notificationHash !== expectedNotification?.workflowIdSha256 || !INACTIVE.has(notificationStatus)) {
    throw failure('Exact Notification automation must remain inactive', 'LARK_NATIVE_AI_V9_ACCEPTANCE_NOTIFICATION_UNSAFE', {
      identityMatches: notificationHash === expectedNotification?.workflowIdSha256,
      status: notificationStatus,
    });
  }
  return Object.freeze({
    aiMaterialization: { status: aiStatus, identitySha256: aiHash },
    notification: { status: notificationStatus, identitySha256: notificationHash },
  });
}

function exactWorkflow(workflows, title) {
  const matches = workflows.filter((item) => optionalText(item?.title ?? item?.name) === title);
  if (matches.length !== 1) throw failure(`Expected one exact Automation: ${title}`, 'LARK_NATIVE_AI_V9_ACCEPTANCE_AUTOMATION_IDENTITY_INVALID', { title, count: matches.length });
  return matches[0];
}
function workflowId(workflow) {
  return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id');
}
function exactTableId(tables, name) {
  const matches = tables.filter((table) => table.name === name && table.tableId);
  if (matches.length !== 1) throw failure(`Expected one exact Lark table: ${name}`, 'LARK_NATIVE_AI_V9_ACCEPTANCE_TABLE_INVALID', { name, count: matches.length });
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
    throw failure('Reviewed Integration Workspace Lark runtime is incomplete', 'LARK_NATIVE_AI_V9_ACCEPTANCE_RUNTIME_INVALID');
  }
  return env;
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
async function runGit(args) {
  await execFileAsync('git', args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
}
async function gitText(args) {
  const result = await execFileAsync('git', args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  return String(result.stdout ?? '').trim();
}
