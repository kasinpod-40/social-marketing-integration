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
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';

const execFileAsync = promisify(execFile);
const CONTRACT_VERSION = 'lark_native_ai_weekly_7d_quality_retry_v4';
const CONFIRMATION = 'RETRY_WEEKLY_7D_NATIVE_AI_PROMPT_V3';
const PROMPT_APPLIED_CONFIRMATION = 'LARK_NATIVE_AI_AUTOMATION_PROMPTS_V3_APPLIED';
const SOURCE_PROMPT_SHAPE = 'lark_ai_compact_quality_v4';
const TARGET_PROMPT_SHAPE = SOURCE_PROMPT_SHAPE;
const EXPECTED_PROMPT_VERSION = 'lark_native_ai_automation_prompts_v3';
const TRIGGER_MARKER = 'CONTROLLED_UAT_NATIVE_AI_PROMPT_V3_TRIGGER_V7';
const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';
const ACTIVE = new Set(['enable', 'enabled', 'active', 'on']);
const INACTIVE = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const STRENGTHS_FALLBACK = 'ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน';
const WEAKNESSES_FALLBACK = 'ยังไม่พบสัญญาณด้านผลงานที่ควรระวังจากข้อมูลที่มี';
const PREPARATION_FIELDS = Object.freeze([
  'insight_summary',
  'strengths',
  'weaknesses',
  'recommendations',
  'generation_status',
  'generated_at',
  'notification_eligible',
  'sent_to_group',
]);
const OUTPUT_FIELDS = Object.freeze([
  'insight_summary',
  'strengths',
  'weaknesses',
  'recommendations',
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
    code: error?.code ?? 'LARK_NATIVE_AI_PROMPT_V3_RETRY_FAILED',
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
    objective: 'reuse_quality_v4_evidence_after_manual_prompt_v3_refresh_then_validate_field_isolated_native_lark_ai_output',
    sourcePromptShape: SOURCE_PROMPT_SHAPE,
    targetPromptShape: TARGET_PROMPT_SHAPE,
    expectedPromptVersion: EXPECTED_PROMPT_VERSION,
    confirmation: CONFIRMATION,
    promptAppliedConfirmation: PROMPT_APPLIED_CONFIRMATION,
    maximumOperatorRecordWrites: 2,
    evidenceRewriteCount: 0,
    preparationTouchesFailureCode: false,
    triggerWrittenFields: ['failure_code'],
    localQualityGate: true,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
}

async function execute() {
  stage = 'confirmation';
  if (process.env.CONFIRM_LARK_NATIVE_AI_WEEKLY_7D_QUALITY_RETRY !== CONFIRMATION) {
    throw failure('Exact weekly AI Prompt v3 retry confirmation is missing', 'LARK_NATIVE_AI_PROMPT_V3_RETRY_CONFIRMATION_INVALID');
  }
  if (process.env.CONFIRM_LARK_NATIVE_AI_PROMPTS_V3_APPLIED !== PROMPT_APPLIED_CONFIRMATION) {
    throw failure('Manual Lark Prompt v3 application confirmation is missing', 'LARK_NATIVE_AI_PROMPT_V3_NOT_CONFIRMED');
  }
  if (LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION !== EXPECTED_PROMPT_VERSION) {
    throw failure('Repository Prompt contract is not Prompt v3', 'LARK_NATIVE_AI_PROMPT_V3_REPOSITORY_CONTRACT_INVALID', {
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
    throw failure('Weekly AI Prompt v3 retry requires clean exact current main', 'LARK_NATIVE_AI_PROMPT_V3_REPOSITORY_INVALID', repository);
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

  stage = 'load-generated-quality-v4-row';
  const candidates = await client.searchRecordsByFieldValues({
    tableId: aiTableId,
    fieldName: 'template_version',
    values: [LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION],
  });
  const matches = candidates.filter((record) => isExactGeneratedUatRow(record?.fields));
  if (matches.length !== 1) {
    throw failure('Expected exactly one generated weekly Executive UAT row for Prompt v3 retry', 'LARK_NATIVE_AI_PROMPT_V3_UAT_ROW_INVALID', {
      candidates: candidates.length,
      exactMatches: matches.length,
    });
  }

  const record = matches[0];
  const recordId = requireText(record.recordId ?? record.record_id, 'recordId');
  const fields = requireObject(record.fields, 'record.fields');
  const aiRunKey = requireText(fields.ai_run_key, 'ai_run_key');
  const metricSummaryText = requireText(fields.metric_summary_json, 'metric_summary_json');
  const channelStatusVectorText = requireText(fields.channel_status_vector_json, 'channel_status_vector_json');
  const evidence = readQualityV4Evidence(metricSummaryText, channelStatusVectorText);

  stage = 'prepare-prompt-v3-retry-without-evidence-rewrite';
  const preparationUpdate = await client.batchUpdateRecords({
    tableId: aiTableId,
    records: [{
      recordId,
      fields: {
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
    throw failure('Expected exactly one Prompt v3 preparation write', 'LARK_NATIVE_AI_PROMPT_V3_PREPARATION_WRITE_COUNT_INVALID', {
      updated: preparationUpdate.updated,
    });
  }

  stage = 'verify-prepared-prompt-v3-row';
  const preparedRows = await client.searchRecordsByFieldValues({
    tableId: aiTableId,
    fieldName: 'ai_run_key',
    values: [aiRunKey],
  });
  if (preparedRows.length !== 1) {
    throw failure('Prepared UAT row identity drifted before Prompt v3 trigger', 'LARK_NATIVE_AI_PROMPT_V3_PREPARED_READBACK_INVALID', {
      count: preparedRows.length,
    });
  }
  const prepared = requireObject(preparedRows[0].fields, 'prepared.fields');
  if (!isPreparedPromptV3Row(prepared, metricSummaryText, channelStatusVectorText)) {
    throw failure('Weekly Executive UAT row did not converge to exact Prompt v3 prepared state', 'LARK_NATIVE_AI_PROMPT_V3_PREPARED_STATE_INVALID', {
      generationStatus: optionalText(prepared.generation_status),
      promptShape: readPromptShape(optionalText(prepared.metric_summary_json)),
      outputsPresent: outputPresence(prepared),
      notificationEligible: booleanValue(prepared.notification_eligible),
      sentToGroup: booleanValue(prepared.sent_to_group),
    });
  }

  stage = 'trigger-prompt-v3-v7-failure-code-only';
  const triggerUpdate = await client.batchUpdateRecords({
    tableId: aiTableId,
    records: [{
      recordId,
      fields: { failure_code: TRIGGER_MARKER },
    }],
  });
  if (triggerUpdate.updated !== 1) {
    throw failure('Expected exactly one failure_code-only Prompt v3 trigger write', 'LARK_NATIVE_AI_PROMPT_V3_TRIGGER_WRITE_COUNT_INVALID', {
      updated: triggerUpdate.updated,
    });
  }

  stage = 'observe-ai-result';
  let observed = prepared;
  for (let attempt = 1; attempt <= POLL_ATTEMPTS; attempt += 1) {
    await wait(POLL_MS);
    const rows = await client.searchRecordsByFieldValues({
      tableId: aiTableId,
      fieldName: 'ai_run_key',
      values: [aiRunKey],
    });
    if (rows.length !== 1) {
      throw failure('UAT row identity drifted while observing Prompt v3 retry', 'LARK_NATIVE_AI_PROMPT_V3_READBACK_INVALID', { count: rows.length });
    }
    observed = requireObject(rows[0].fields, 'readback.fields');
    const generationStatus = optionalText(observed.generation_status);
    if (generationStatus === 'generated' || generationStatus === 'failed') break;
  }

  const generated = optionalText(observed?.generation_status) === 'generated' && fourOutputsPresent(observed);
  const outputs = generated ? readOutputs(observed) : null;
  const qualityGate = generated
    ? validateExecutiveWriterOutputs(outputs, evidence)
    : Object.freeze({ passed: false, violations: ['generation_not_completed'] });
  const passed = generated && qualityGate.passed;
  const result = Object.freeze({
    ok: passed,
    contractVersion: CONTRACT_VERSION,
    stage: 'complete',
    status: passed
      ? 'weekly_7d_native_ai_prompt_v3_quality_passed'
      : generated
        ? 'weekly_7d_native_ai_prompt_v3_quality_failed'
        : 'weekly_7d_native_ai_prompt_v3_retry_not_completed',
    repository,
    automationState,
    promptContract: {
      version: EXPECTED_PROMPT_VERSION,
      manuallyAppliedConfirmed: true,
      livePromptContentReadbackSupported: false,
    },
    evidence: {
      metricSummaryChars: metricSummaryText.length,
      channelStatusVectorChars: channelStatusVectorText.length,
      sourcePromptShape: evidence.promptShape,
      promptShape: evidence.promptShape,
      evidenceRewriteCount: 0,
      businessEvidenceChannelCount: evidence.businessEvidenceChannelCount,
      comparisonEvidenceChannelCount: evidence.comparisonEvidenceChannelCount,
      strengthsMode: evidence.strengthsMode,
      recommendationMode: evidence.recommendationMode,
      businessEvidenceChannelNames: evidence.businessEvidenceChannelNames,
      hasNumericBusinessEvidence: evidence.hasNumericBusinessEvidence,
    },
    recordWriteCount: 2,
    preparationWriteCount: 1,
    preparationWrittenFields: PREPARATION_FIELDS,
    preparationTouchesEvidence: false,
    preparationTouchesFailureCode: false,
    triggerWriteCount: 1,
    triggerWrittenFields: ['failure_code'],
    triggerMarker: TRIGGER_MARKER,
    generationStatus: optionalText(observed?.generation_status),
    outputsPresent: outputPresence(observed),
    outputs,
    qualityGate,
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

function readQualityV4Evidence(metricSummaryText, channelStatusVectorText) {
  let summary;
  let statusVector;
  try { summary = JSON.parse(metricSummaryText); } catch {
    throw failure('metric_summary_json must be valid JSON', 'LARK_NATIVE_AI_PROMPT_V3_EVIDENCE_JSON_INVALID');
  }
  try { statusVector = JSON.parse(channelStatusVectorText); } catch {
    throw failure('channel_status_vector_json must be valid JSON', 'LARK_NATIVE_AI_PROMPT_V3_STATUS_VECTOR_JSON_INVALID');
  }
  if (!summary || typeof summary !== 'object' || Array.isArray(summary)
    || summary.promptShape !== SOURCE_PROMPT_SHAPE
    || !Array.isArray(summary.channelBusinessEvidence)
    || summary.channelBusinessEvidence.length !== 9
    || !Array.isArray(statusVector)
    || statusVector.length !== 9) {
    throw failure('Prompt v3 retry requires retained quality-v4 evidence for nine channels', 'LARK_NATIVE_AI_PROMPT_V3_EVIDENCE_SHAPE_INVALID', {
      promptShape: optionalText(summary?.promptShape),
      channelEvidenceCount: Array.isArray(summary?.channelBusinessEvidence) ? summary.channelBusinessEvidence.length : null,
      statusVectorCount: Array.isArray(statusVector) ? statusVector.length : null,
    });
  }
  if (metricSummaryText.length > 2800 || channelStatusVectorText.length > 700) {
    throw failure('Retained Prompt v3 evidence exceeds reviewed input budget', 'LARK_NATIVE_AI_PROMPT_V3_EVIDENCE_LIMIT_EXCEEDED', {
      metricSummaryChars: metricSummaryText.length,
      channelStatusVectorChars: channelStatusVectorText.length,
    });
  }
  const qualityContext = summary.qualityContext && typeof summary.qualityContext === 'object'
    ? summary.qualityContext
    : {};
  const businessChannels = summary.channelBusinessEvidence.filter((item) => item?.businessEvidencePresent === true);
  return Object.freeze({
    promptShape: summary.promptShape,
    businessEvidenceChannelCount: Number(qualityContext.businessEvidenceChannelCount ?? businessChannels.length),
    comparisonEvidenceChannelCount: Number(qualityContext.comparisonEvidenceChannelCount ?? 0),
    strengthsMode: optionalText(qualityContext.strengthsMode),
    recommendationMode: optionalText(qualityContext.recommendationMode),
    businessEvidenceChannelNames: Object.freeze(businessChannels
      .map((item) => optionalText(item?.displayName))
      .filter(Boolean)),
    hasNumericBusinessEvidence: businessChannels.some(hasNumericEvidence),
  });
}

function hasNumericEvidence(channel) {
  const candidates = [
    ...(Array.isArray(channel?.availableMetrics) ? channel.availableMetrics : []),
    ...(Array.isArray(channel?.topContent) ? channel.topContent : []),
    ...(Array.isArray(channel?.topAds) ? channel.topAds : []),
  ];
  return candidates.some((item) => item && typeof item === 'object'
    && Object.values(item).some((value) => typeof value === 'number' && Number.isFinite(value)));
}

function validateExecutiveWriterOutputs(outputs, evidence) {
  const violations = [];
  const allText = OUTPUT_FIELDS.map((field) => outputs[field] ?? '').join('\n');
  if (/\breport_partial\b|\breport_missing\b|\bsource_pending\b|\bsource_unavailable\b|\breadiness_status\b|\bdata_status\b|\bCoverage\b/iu.test(allText)) {
    violations.push('internal_status_language');
  }
  if (/^#{1,6}\s/mu.test(allText)) violations.push('markdown_heading');
  if (/หลักฐาน\s*[:：]|\([^\n)]*หลักฐาน[^\n)]*\)/u.test(allText)) violations.push('evidence_footnote');

  if (/แนะนำ|ควร|ติดตาม|ตรวจสอบ|ทดลอง|ต่อยอด|คำนวณ|ใช้เป็น\s*(?:benchmark|baseline)|สิ่งที่ควรทำ/iu.test(outputs.insight_summary)) {
    violations.push('insight_contains_action');
  }
  if (outputs.insight_summary.includes(STRENGTHS_FALLBACK)) violations.push('insight_contains_strengths_fallback');
  if (outputs.insight_summary.includes(WEAKNESSES_FALLBACK)) violations.push('insight_contains_weaknesses_fallback');
  if (evidence.businessEvidenceChannelCount > 0
    && evidence.businessEvidenceChannelNames.length > 0
    && !evidence.businessEvidenceChannelNames.some((name) => outputs.insight_summary.includes(name))) {
    violations.push('insight_missing_business_channel_name');
  }
  if (evidence.hasNumericBusinessEvidence && !/\d/u.test(outputs.insight_summary)) {
    violations.push('insight_missing_business_number');
  }

  if (evidence.comparisonEvidenceChannelCount === 0) {
    if (outputs.strengths !== STRENGTHS_FALLBACK) violations.push('strengths_without_comparison_fallback');
    if (/จำนวนมาก|จำนวนสูง|จำนวนต่ำ|สูงสุด|ต่ำสุด|เด่นที่สุด|โดดเด่น|ทำผลงานดี|ดีที่สุด|คุ้มที่สุด|ดีขึ้น|แย่ลง|เติบโต/u.test(`${outputs.insight_summary}\n${outputs.strengths}\n${outputs.weaknesses}`)) {
      violations.push('unsupported_performance_magnitude');
    }
  }

  if (/แนะนำ|ควร|ติดตาม|ตรวจสอบ|ทดลอง|ต่อยอด|คำนวณ|รอ|เติม|ใช้เป็น/iu.test(outputs.weaknesses)) {
    violations.push('weaknesses_contains_action');
  }
  if (/ยังไม่พบข้อมูล|ไม่มีข้อมูล|ข้อมูลไม่ครบ|ข้อมูลไม่เพียงพอ|ข้อมูลเต็ม|ความพร้อม|ช่องทางอื่น|รอข้อมูล|coverage/iu.test(outputs.weaknesses)) {
    violations.push('weaknesses_contains_data_quality');
  }

  if (outputs.recommendations.includes(STRENGTHS_FALLBACK)) violations.push('recommendations_repeats_strengths_fallback');
  if (outputs.recommendations.includes(WEAKNESSES_FALLBACK)) violations.push('recommendations_repeats_weaknesses_fallback');
  if (/สิ่งที่ควรทำสัปดาห์หน้า\s*[:：]?/u.test(outputs.recommendations)) {
    violations.push('recommendations_contains_heading');
  }
  if (/เติมข้อมูล|รอข้อมูล|ยังไม่มีข้อมูล|ยังไม่พบข้อมูล|ข้อมูลไม่เพียงพอ|ข้อมูลไม่ครบ|ข้อมูลเต็ม|ตรวจสอบข้อมูล|ตรวจข้อมูล|ตรวจระบบ|แก้ระบบ|connection|source readiness|coverage|ช่องทางอื่น/iu.test(outputs.recommendations)) {
    violations.push('recommendations_contains_data_ops');
  }
  if (evidence.businessEvidenceChannelCount > 0
    && evidence.recommendationMode === 'observed_only_business_followup'
    && !/(CTR|CPC|อัตราการคลิก|ต้นทุนต่อคลิก|โฆษณา|creative|baseline|เปรียบเทียบ)/iu.test(outputs.recommendations)) {
    violations.push('recommendations_missing_business_action');
  }

  return Object.freeze({
    passed: violations.length === 0,
    violations: Object.freeze(violations),
  });
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
    throw failure('Exact AI Materialization automation must be active', 'LARK_NATIVE_AI_PROMPT_V3_AI_AUTOMATION_NOT_ACTIVE', {
      identityMatches: aiHash === expectedAi?.workflowIdSha256,
      status: aiStatus,
    });
  }
  if (notificationHash !== expectedNotification?.workflowIdSha256 || !INACTIVE.has(notificationStatus)) {
    throw failure('Exact Notification automation must remain inactive', 'LARK_NATIVE_AI_PROMPT_V3_NOTIFICATION_NOT_SAFE', {
      identityMatches: notificationHash === expectedNotification?.workflowIdSha256,
      status: notificationStatus,
    });
  }
  return Object.freeze({
    aiMaterialization: { status: aiStatus, identitySha256: aiHash },
    notification: { status: notificationStatus, identitySha256: notificationHash },
  });
}

function isExactGeneratedUatRow(fields) {
  if (!fields || typeof fields !== 'object') return false;
  return optionalText(fields.template_version) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION
    && optionalText(fields.scope_type) === 'executive'
    && optionalText(fields.channel_key) === 'executive'
    && Number(optionalText(fields.window_days)) === LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_WINDOW_DAYS
    && optionalText(fields.readiness_status) === 'report_partial'
    && optionalText(fields.generation_status) === 'generated'
    && booleanValue(fields.preview_mode) === true
    && booleanValue(fields.notification_eligible) === false
    && booleanValue(fields.sent_to_group) === false
    && fourOutputsPresent(fields);
}

function isPreparedPromptV3Row(fields, metricSummaryText, channelStatusVectorText) {
  return optionalText(fields.generation_status) === 'pending'
    && optionalText(fields.metric_summary_json) === metricSummaryText
    && optionalText(fields.channel_status_vector_json) === channelStatusVectorText
    && readPromptShape(optionalText(fields.metric_summary_json)) === TARGET_PROMPT_SHAPE
    && Object.values(outputPresence(fields)).every((present) => present === false)
    && booleanValue(fields.notification_eligible) === false
    && booleanValue(fields.sent_to_group) === false;
}

function readPromptShape(value) {
  const text = optionalText(value);
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    return optionalText(parsed?.promptShape);
  } catch {
    return null;
  }
}

function readOutputs(fields) {
  return Object.freeze(Object.fromEntries(OUTPUT_FIELDS.map((field) => [field, optionalText(fields?.[field])])));
}
function exactWorkflow(workflows, title) {
  const matches = workflows.filter((item) => optionalText(item?.title ?? item?.name) === title);
  if (matches.length !== 1) throw failure(`Expected one exact Automation: ${title}`, 'LARK_NATIVE_AI_PROMPT_V3_AUTOMATION_IDENTITY_INVALID', { title, count: matches.length });
  return matches[0];
}
function workflowId(workflow) {
  return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id');
}
function exactTableId(tables, name) {
  const matches = tables.filter((table) => table.name === name && table.tableId);
  if (matches.length !== 1) throw failure(`Expected one exact Lark table: ${name}`, 'LARK_NATIVE_AI_PROMPT_V3_TABLE_INVALID', { name, count: matches.length });
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
    throw failure('Reviewed Integration Workspace Lark runtime is incomplete', 'LARK_NATIVE_AI_PROMPT_V3_RUNTIME_INVALID');
  }
  return env;
}
function fourOutputsPresent(fields) {
  return OUTPUT_FIELDS.every((field) => Boolean(optionalText(fields?.[field])));
}
function outputPresence(fields) {
  return Object.fromEntries(OUTPUT_FIELDS.map((field) => [field, Boolean(optionalText(fields?.[field]))]));
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
