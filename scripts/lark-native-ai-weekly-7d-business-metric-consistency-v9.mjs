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
  hardenLarkNativeAiExecutiveBusinessMetricConsistency,
  validateLarkNativeAiExecutiveWriterOutputs,
} from '../packages/application/src/reports/lark-native-ai-executive-writer-quality.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';

const execFileAsync = promisify(execFile);
const CONTRACT_VERSION = 'lark_native_ai_weekly_7d_business_metric_consistency_v9';
const CONFIRMATION = 'RETRY_WEEKLY_7D_NATIVE_AI_BUSINESS_METRIC_V9';
const EXPECTED_PROMPT_VERSION = 'lark_native_ai_automation_prompts_v3';
const SOURCE_PROMPT_SHAPE = 'lark_ai_compact_quality_v5';
const TARGET_PROMPT_SHAPE = 'lark_ai_compact_quality_v6';
const TRIGGER_MARKER = 'CONTROLLED_UAT_NATIVE_AI_BUSINESS_METRIC_TRIGGER_V9';
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
const PREPARATION_FIELDS = Object.freeze([
  'metric_summary_json',
  'insight_summary',
  'strengths',
  'weaknesses',
  'recommendations',
  'generation_status',
  'generated_at',
  'notification_eligible',
  'sent_to_group',
]);
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
    contractVersion: CONTRACT_VERSION,
    stage,
    code: error?.code ?? 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_FAILED',
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
    contractVersion: CONTRACT_VERSION,
    objective: 'replace_inconsistent_ratio_evidence_with_deterministic_derived_ctr_then_revalidate_native_lark_ai_output',
    sourcePromptShape: SOURCE_PROMPT_SHAPE,
    targetPromptShape: TARGET_PROMPT_SHAPE,
    confirmation: CONFIRMATION,
    larkPromptMutationCount: 0,
    maximumOperatorRecordWrites: 2,
    evidenceRewriteCount: 1,
    triggerWrittenFields: ['failure_code'],
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function execute() {
  stage = 'confirmation';
  if (process.env.CONFIRM_LARK_NATIVE_AI_WEEKLY_7D_BUSINESS_METRIC_V9 !== CONFIRMATION) {
    throw failure('Exact Executive Writer V9 confirmation is missing', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_CONFIRMATION_INVALID');
  }
  if (LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION !== EXPECTED_PROMPT_VERSION) {
    throw failure('Repository Prompt contract must remain Prompt v3', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_PROMPT_CONTRACT_INVALID', {
      observedPromptVersion: LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION,
      expectedPromptVersion: EXPECTED_PROMPT_VERSION,
    });
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
    throw failure('Executive Writer V9 requires clean exact current main', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_REPOSITORY_INVALID', repository);
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

  stage = 'load-v8-generated-row';
  const candidates = await client.searchRecordsByFieldValues({
    tableId: aiTableId,
    fieldName: 'template_version',
    values: [LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION],
  });
  const matches = candidates.filter((record) => isExactV8GeneratedRow(record?.fields));
  if (matches.length !== 1) {
    throw failure('Expected exactly one generated V8 Executive UAT row', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_SOURCE_ROW_INVALID', {
      candidates: candidates.length,
      exactMatches: matches.length,
      candidateStates: candidates.slice(0, 3).map((record) => summarizeCandidateState(record?.fields)),
    });
  }

  const record = matches[0];
  const recordId = requireText(record.recordId ?? record.record_id, 'recordId');
  const fields = requireObject(record.fields, 'record.fields');
  const aiRunKey = requireText(fields.ai_run_key, 'ai_run_key');
  const sourceMetricSummaryText = requireText(fields.metric_summary_json, 'metric_summary_json');
  const channelStatusVectorText = requireText(fields.channel_status_vector_json, 'channel_status_vector_json');
  const priorOutputs = readOutputs(fields);

  stage = 'harden-business-metric-consistency';
  const hardened = hardenLarkNativeAiExecutiveBusinessMetricConsistency({
    metricSummaryJson: sourceMetricSummaryText,
    channelStatusVectorJson: channelStatusVectorText,
    maxMetricSummaryChars: 2800,
    maxStatusVectorChars: 700,
  });
  const priorQualityGate = validateLarkNativeAiExecutiveWriterOutputs(priorOutputs, hardened.evidence);
  if (priorQualityGate.passed
    || priorQualityGate.violations.length !== 1
    || priorQualityGate.violations[0] !== 'insight_ctr_inconsistent_with_components') {
    throw failure(
      'V8 output must revalidate to the single confirmed CTR/component consistency violation before V9 retry',
      'LARK_NATIVE_AI_BUSINESS_METRIC_V9_PRIOR_DIAGNOSIS_INVALID',
      { priorQualityGate },
    );
  }

  stage = 'prepare-v9';
  const preparationUpdate = await client.batchUpdateRecords({
    tableId: aiTableId,
    records: [{
      recordId,
      fields: {
        metric_summary_json: hardened.metricSummaryJson,
        insight_summary: null,
        strengths: null,
        weaknesses: null,
        recommendations: null,
        generation_status: 'pending',
        generated_at: null,
        notification_eligible: false,
        sent_to_group: false,
      },
    }],
  });
  if (preparationUpdate.updated !== 1) {
    throw failure('Expected exactly one V9 preparation write', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_PREPARATION_WRITE_COUNT_INVALID', {
      updated: preparationUpdate.updated,
    });
  }

  stage = 'verify-v9-prepared-state';
  const preparedRows = await client.searchRecordsByFieldValues({
    tableId: aiTableId,
    fieldName: 'ai_run_key',
    values: [aiRunKey],
  });
  if (preparedRows.length !== 1) {
    throw failure('V9 prepared row identity drifted', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_PREPARED_READBACK_INVALID', {
      count: preparedRows.length,
    });
  }
  const prepared = requireObject(preparedRows[0].fields, 'prepared.fields');
  if (!isExactPreparedV9Row(prepared, hardened.metricSummaryJson, channelStatusVectorText)) {
    throw failure('V9 row did not converge to the reviewed prepared state', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_PREPARED_STATE_INVALID', {
      candidateState: summarizeCandidateState(prepared),
    });
  }

  stage = 'trigger-v9-failure-code-only';
  const triggerUpdate = await client.batchUpdateRecords({
    tableId: aiTableId,
    records: [{ recordId, fields: { failure_code: TRIGGER_MARKER } }],
  });
  if (triggerUpdate.updated !== 1) {
    throw failure('Expected exactly one failure_code-only V9 trigger write', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_TRIGGER_WRITE_COUNT_INVALID', {
      updated: triggerUpdate.updated,
    });
  }

  stage = 'observe-v9-ai-result';
  let observed = prepared;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    await wait(POLL_MS);
    const rows = await client.searchRecordsByFieldValues({
      tableId: aiTableId,
      fieldName: 'ai_run_key',
      values: [aiRunKey],
    });
    if (rows.length !== 1) {
      throw failure('V9 UAT row identity drifted while observing AI result', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_RESULT_READBACK_INVALID', {
        count: rows.length,
      });
    }
    observed = requireObject(rows[0].fields, 'readback.fields');
    const generationStatus = optionalText(observed.generation_status);
    if (generationStatus === 'generated' || generationStatus === 'failed') break;
  }

  const generated = optionalText(observed.generation_status) === 'generated' && fourOutputsPresent(observed);
  const outputs = generated ? readOutputs(observed) : null;
  const qualityGate = generated
    ? validateLarkNativeAiExecutiveWriterOutputs(outputs, hardened.evidence)
    : Object.freeze({ passed: false, violations: Object.freeze(['generation_not_completed']) });
  const passed = generated && qualityGate.passed;

  const result = Object.freeze({
    ok: passed,
    contractVersion: CONTRACT_VERSION,
    stage: 'complete',
    status: passed
      ? 'weekly_7d_native_ai_business_metric_quality_v9_passed'
      : generated
        ? 'weekly_7d_native_ai_business_metric_quality_v9_failed'
        : 'weekly_7d_native_ai_business_metric_quality_v9_not_completed',
    repository,
    automationState,
    promptContract: {
      version: EXPECTED_PROMPT_VERSION,
      larkPromptMutationCount: 0,
    },
    evidence: {
      beforeMetricSummaryChars: sourceMetricSummaryText.length,
      afterMetricSummaryChars: hardened.metricSummaryChars,
      channelStatusVectorChars: hardened.channelStatusVectorChars,
      sourcePromptShape: SOURCE_PROMPT_SHAPE,
      promptShape: TARGET_PROMPT_SHAPE,
      evidenceRewriteCount: 1,
      businessEvidenceChannelCount: hardened.evidence.businessEvidenceChannelCount,
      comparisonEvidenceChannelCount: hardened.evidence.comparisonEvidenceChannelCount,
      summaryRequiredFacts: hardened.evidence.summaryRequiredFacts,
      derivedCtrFacts: hardened.evidence.derivedCtrFacts,
    },
    priorQualityGate,
    recordWriteCount: 2,
    preparationWriteCount: 1,
    preparationWrittenFields: PREPARATION_FIELDS,
    preparationTouchesFailureCode: false,
    triggerWriteCount: 1,
    triggerWrittenFields: ['failure_code'],
    triggerMarker: TRIGGER_MARKER,
    generationStatus: optionalText(observed.generation_status),
    outputsPresent: outputPresence(observed),
    outputs,
    qualityGate,
    notificationEligible: booleanValue(observed.notification_eligible),
    sentToGroup: booleanValue(observed.sent_to_group),
    aiCallsByOperator: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (!result.ok) process.exitCode = 2;
}

function isExactV8GeneratedRow(fields) {
  if (!fields || typeof fields !== 'object') return false;
  return optionalText(fields.template_version) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION
    && optionalText(fields.scope_type) === 'executive'
    && optionalText(fields.channel_key) === 'executive'
    && Number(optionalText(fields.window_days)) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS
    && optionalText(fields.readiness_status) === 'report_partial'
    && optionalText(fields.generation_status) === 'generated'
    && optionalText(fields.failure_code) === null
    && readPromptShape(fields.metric_summary_json) === SOURCE_PROMPT_SHAPE
    && booleanValue(fields.preview_mode) === true
    && booleanValue(fields.notification_eligible) === false
    && booleanValue(fields.sent_to_group) === false
    && fourOutputsPresent(fields);
}

function isExactPreparedV9Row(fields, metricSummaryText, channelStatusVectorText) {
  return optionalText(fields.generation_status) === 'pending'
    && optionalText(fields.failure_code) === null
    && optionalText(fields.metric_summary_json) === metricSummaryText
    && optionalText(fields.channel_status_vector_json) === channelStatusVectorText
    && readPromptShape(fields.metric_summary_json) === TARGET_PROMPT_SHAPE
    && Object.values(outputPresence(fields)).every((present) => present === false)
    && booleanValue(fields.notification_eligible) === false
    && booleanValue(fields.sent_to_group) === false;
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
    throw failure('Exact AI Materialization automation must be active', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_AI_AUTOMATION_INVALID', {
      identityMatches: aiHash === expectedAi?.workflowIdSha256,
      status: aiStatus,
    });
  }
  if (notificationHash !== expectedNotification?.workflowIdSha256 || !INACTIVE.has(notificationStatus)) {
    throw failure('Exact Notification automation must remain inactive', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_NOTIFICATION_UNSAFE', {
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
  if (matches.length !== 1) throw failure(`Expected one exact Automation: ${title}`, 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_AUTOMATION_IDENTITY_INVALID', { title, count: matches.length });
  return matches[0];
}
function workflowId(workflow) {
  return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id');
}
function exactTableId(tables, name) {
  const matches = tables.filter((table) => table.name === name && table.tableId);
  if (matches.length !== 1) throw failure(`Expected one exact Lark table: ${name}`, 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_TABLE_INVALID', { name, count: matches.length });
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
    throw failure('Reviewed Integration Workspace Lark runtime is incomplete', 'LARK_NATIVE_AI_BUSINESS_METRIC_V9_RUNTIME_INVALID');
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
async function wait(ms) { await new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
async function runGit(args) {
  await execFileAsync('git', args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
}
async function gitText(args) {
  const result = await execFileAsync('git', args, { cwd: repositoryRoot, encoding: 'utf8', timeout: 60_000, maxBuffer: 4 * 1024 * 1024 });
  return String(result.stdout ?? '').trim();
}
