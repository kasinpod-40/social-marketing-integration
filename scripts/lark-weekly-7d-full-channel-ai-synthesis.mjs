#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
} from '../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION } from '../packages/config/src/lark-native-ai-automation-prompt-contract.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { collectLarkNativeAiWeekly7dControlledUatSource } from './lib/lark-native-ai-weekly-7d-controlled-uat.js';
import {
  LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER,
  assertLarkWeekly7dFullChannelAiGenerated,
  assertLarkWeekly7dFullChannelAiPrepared,
  buildLarkWeekly7dFullChannelAiSynthesis,
  isLarkWeekly7dFullChannelAiIdentity,
} from './lib/lark-weekly-7d-full-channel-ai-synthesis.js';
import {
  assertLarkWeekly7dFullChannelSourceAlignment,
} from './lib/lark-weekly-7d-full-channel-notification.js';
import {
  isExactAcceptedWeekly7dSource,
} from './lib/lark-weekly-7d-notification-admission.js';
import {
  resolveLarkNotificationControlledUatTables,
} from './lib/lark-notification-controlled-uat.js';

const ROOT = resolve(process.cwd());
const SOURCE_CONFIG = resolve(
  process.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const DEV_VARS_FILE = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const CONTRACT_VERSION = 'lark_weekly_7d_full_channel_ai_synthesis_terminal_v1';
const CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_WEEKLY_7D_FULL_CHANNEL_AI',
  value: 'GENERATE_ONE_FULL_CHANNEL_WEEKLY_7D_AI',
});
const EXPECTED_PROMPT_VERSION = 'lark_native_ai_automation_prompts_v3';
const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';
const ACTIVE = new Set(['enable', 'enabled', 'active', 'on']);
const INACTIVE = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const OUTPUT_FIELDS = Object.freeze(['insight_summary', 'strengths', 'weaknesses', 'recommendations']);
const SOURCE_HASH_FIELDS = Object.freeze([
  'ai_run_key', 'report_id', 'template_version', 'scope_type', 'channel_key', 'window_days',
  'period_start', 'period_end', 'compare_start', 'compare_end', 'comparison_mode',
  'readiness_status', 'generation_status', 'failure_code', 'preview_mode',
  'notification_eligible', 'sent_to_group', 'dedupe_key', 'source_report_ids_json',
  'metric_summary_json', 'channel_status_vector_json', 'insight_summary', 'strengths',
  'weaknesses', 'recommendations',
]);
const MAX_POLLS = 36;
const POLL_MS = 5_000;

let action = 'preview';
let stage = 'init';
let repository = null;
let recordWriteCount = 0;
let triggerWriteCount = 0;

try {
  action = parseArgs(process.argv.slice(2));
  if (action === 'preview') await preview();
  else if (action === 'execute') await execute();
  else await recover();
} catch (error) {
  process.stderr.write(`${JSON.stringify({
    ok: false,
    contractVersion: CONTRACT_VERSION,
    action,
    stage,
    code: error?.code ?? 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_FAILED',
    message: sanitize(error?.message ?? String(error)),
    details: sanitizeValue(error?.details ?? {}),
    repository,
    recordWriteCount,
    triggerWriteCount,
    aiCallsByOperator: 0,
    notificationCount: 0,
    scheduleEnabled: false,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function preview() {
  const context = await prepare();
  stage = 'inspect-existing-synthesis';
  const rows = await context.repository.listByFieldValues(
    context.tables.aiRuns,
    'ai_run_key',
    [context.synthesis.aiRunKey],
  );
  const existing = exactRows(rows, context.synthesis.aiRunKey);
  if (existing.length > 1) fail(
    'Full-channel AI synthesis identity is duplicated',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_DUPLICATE',
    { count: existing.length },
  );
  let state = 'absent';
  let qualityGate = null;
  if (existing.length === 1) {
    const fields = existing[0].fields;
    if (scalar(fields.generation_status) === 'generated') {
      qualityGate = assertLarkWeekly7dFullChannelAiGenerated(fields, context.synthesis).qualityGate;
      state = 'generated';
    } else if (scalar(fields.failure_code) === LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER) {
      state = 'triggered_pending';
    } else {
      assertLarkWeekly7dFullChannelAiPrepared(fields, context.synthesis);
      state = 'prepared';
    }
  }
  printResult({
    ok: true,
    status: 'weekly_7d_full_channel_ai_synthesis_preview_passed',
    mode: 'READ_ONLY',
    context,
    synthesisState: state,
    qualityGate,
    outputs: existing.length === 1 && state === 'generated'
      ? readOutputs(existing[0].fields)
      : null,
    nextGate: state === 'generated'
      ? 'full_channel_notification_preview'
      : state === 'triggered_pending'
        ? 'poll_only_recovery'
        : 'execute_requires_explicit_confirmation',
  });
}

async function execute() {
  requireConfirmation();
  const context = await prepare();
  stage = 'load-synthesis-identity';
  let rows = await context.repository.listByFieldValues(
    context.tables.aiRuns,
    'ai_run_key',
    [context.synthesis.aiRunKey],
  );
  let existing = exactRows(rows, context.synthesis.aiRunKey);
  if (existing.length > 1) fail(
    'Full-channel AI synthesis identity is duplicated',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_DUPLICATE',
    { count: existing.length },
  );

  if (existing.length === 1 && scalar(existing[0].fields.generation_status) === 'generated') {
    const accepted = assertLarkWeekly7dFullChannelAiGenerated(existing[0].fields, context.synthesis);
    await assertSourceUnchanged(context);
    printResult({
      ok: true,
      status: 'weekly_7d_full_channel_ai_synthesis_already_generated',
      mode: 'IDEMPOTENT_READBACK',
      context,
      synthesisState: 'generated',
      qualityGate: accepted.qualityGate,
      outputs: accepted.outputs,
      nextGate: 'full_channel_notification_preview',
    });
    return;
  }

  if (existing.length === 0) {
    stage = 'create-one-synthesis-preview-row';
    const plan = await context.syncEngine.planByKey({
      repository: context.repository,
      tableId: context.tables.aiRuns,
      keyField: 'ai_run_key',
      rows: [context.synthesis.fields],
    });
    if (plan.createRows.length !== 1 || plan.updateRows.length !== 0 || plan.skipped !== 0) fail(
      'Full-channel AI synthesis must create exactly one fresh preview row',
      'LARK_WEEKLY_7D_FULL_CHANNEL_AI_CREATE_PLAN_INVALID',
      { createRows: plan.createRows.length, updateRows: plan.updateRows.length, skipped: plan.skipped },
    );
    const created = await context.syncEngine.executePlan(plan);
    if (created.created !== 1 || created.updated !== 0) fail(
      'Full-channel AI synthesis preview row was not created exactly once',
      'LARK_WEEKLY_7D_FULL_CHANNEL_AI_CREATE_FAILED',
      created,
    );
    recordWriteCount += 1;
    rows = await context.repository.listByFieldValues(
      context.tables.aiRuns,
      'ai_run_key',
      [context.synthesis.aiRunKey],
    );
    existing = exactRows(rows, context.synthesis.aiRunKey);
  }

  if (existing.length !== 1) fail(
    'Full-channel AI synthesis prepared row readback is invalid',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_READBACK_INVALID',
    { count: existing.length },
  );
  const recordId = requireText(existing[0].recordId ?? existing[0].record_id, 'recordId');
  const fields = existing[0].fields;
  if (scalar(fields.failure_code) === LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER) fail(
    'Full-channel AI synthesis was already triggered; blind retrigger is forbidden',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_ALREADY_TRIGGERED',
    { recoveryRequired: true },
  );
  assertLarkWeekly7dFullChannelAiPrepared(fields, context.synthesis);
  await assertSourceUnchanged(context);

  stage = 'trigger-failure-code-only';
  const trigger = await context.client.batchUpdateRecords({
    tableId: context.tables.aiRuns,
    records: [{ recordId, fields: { failure_code: LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER } }],
  });
  if (trigger.updated !== 1) fail(
    'Full-channel AI synthesis requires exactly one failure_code trigger write',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_FAILED',
    { updated: trigger.updated },
  );
  recordWriteCount += 1;
  triggerWriteCount += 1;

  stage = 'observe-native-ai-result';
  const generated = await pollGenerated(context);
  const accepted = assertLarkWeekly7dFullChannelAiGenerated(generated.fields, context.synthesis);
  await assertSourceUnchanged(context);
  printResult({
    ok: true,
    status: 'weekly_7d_full_channel_ai_synthesis_generated_and_validated',
    mode: 'CONTROLLED_NATIVE_AI',
    context,
    synthesisState: 'generated',
    qualityGate: accepted.qualityGate,
    outputs: accepted.outputs,
    nextGate: 'full_channel_notification_preview',
  });
}

async function recover() {
  const context = await prepare();
  stage = 'load-triggered-synthesis';
  const rows = exactRows(await context.repository.listByFieldValues(
    context.tables.aiRuns,
    'ai_run_key',
    [context.synthesis.aiRunKey],
  ), context.synthesis.aiRunKey);
  if (rows.length !== 1) fail(
    'Full-channel AI recovery requires one retained synthesis row',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_RECOVERY_SOURCE_INVALID',
    { count: rows.length },
  );
  if (scalar(rows[0].fields.generation_status) === 'generated') {
    const accepted = assertLarkWeekly7dFullChannelAiGenerated(rows[0].fields, context.synthesis);
    await assertSourceUnchanged(context);
    printResult({
      ok: true,
      status: 'weekly_7d_full_channel_ai_synthesis_recovered',
      mode: 'POLL_ONLY_RECOVERY',
      context,
      synthesisState: 'generated',
      qualityGate: accepted.qualityGate,
      outputs: accepted.outputs,
      nextGate: 'full_channel_notification_preview',
    });
    return;
  }
  if (scalar(rows[0].fields.failure_code) !== LARK_WEEKLY_7D_FULL_CHANNEL_AI_TRIGGER_MARKER) fail(
    'Full-channel AI recovery requires the retained trigger marker',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_RECOVERY_MARKER_MISSING',
  );
  stage = 'poll-existing-native-ai-without-retrigger';
  const generated = await pollGenerated(context);
  const accepted = assertLarkWeekly7dFullChannelAiGenerated(generated.fields, context.synthesis);
  await assertSourceUnchanged(context);
  printResult({
    ok: true,
    status: 'weekly_7d_full_channel_ai_synthesis_recovered',
    mode: 'POLL_ONLY_RECOVERY',
    context,
    synthesisState: 'generated',
    qualityGate: accepted.qualityGate,
    outputs: accepted.outputs,
    nextGate: 'full_channel_notification_preview',
  });
}

async function prepare() {
  stage = 'repository-preflight';
  const head = exactMainHead();
  repository = Object.freeze({ branch: 'main', head, originMain: head, clean: true });
  if (LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION !== EXPECTED_PROMPT_VERSION) fail(
    'Full-channel AI synthesis requires the approved Prompt v3 contract',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_PROMPT_CONTRACT_INVALID',
    { observed: LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION, expected: EXPECTED_PROMPT_VERSION },
  );

  stage = 'load-runtime';
  const env = await loadRuntime();
  const client = createLarkBitableClientFromEnv(Object.freeze({
    ...env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_MAX_PAGES: '5',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  }));
  const tableInventory = await client.listTables();
  const tables = resolveLarkNotificationControlledUatTables(tableInventory);
  const repositoryAdapter = new LarkRecordRepository({ client });
  const syncEngine = new TableSyncEngine();

  stage = 'verify-automation-state';
  const automation = await verifyAutomationState(client);

  stage = 'load-immutable-v9-source';
  const candidates = await repositoryAdapter.listByFieldValues(
    tables.aiRuns,
    'template_version',
    [LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION],
  );
  const matches = candidates.filter((record) => isExactAcceptedWeekly7dSource(record?.fields));
  if (matches.length !== 1) fail(
    'Full-channel AI synthesis requires exactly one immutable accepted V9 source row',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_V9_SOURCE_INVALID',
    { candidates: candidates.length, exactMatches: matches.length },
  );
  const sourceRecord = matches[0];
  const sourceStateSha256 = hashSourceState(sourceRecord.fields);

  stage = 'collect-aligned-factual-report';
  const collected = await collectLarkNativeAiWeekly7dControlledUatSource({ client });
  assertLarkWeekly7dFullChannelSourceAlignment({
    expectedSourceReportIds: parseSourceReportIdsSafe(sourceRecord.fields.source_report_ids_json),
    collectedSourceReportIds: collected.sourceReportIds,
    expectedPeriod: sourcePeriod(sourceRecord.fields),
    collectedPeriod: collected.targetPeriod,
  });
  const factualReport = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: collected.targetPeriod,
    reportBundles: collected.reportBundles,
  });
  const synthesis = buildLarkWeekly7dFullChannelAiSynthesis({ sourceRecord, factualReport });
  if (!isLarkWeekly7dFullChannelAiIdentity(synthesis.aiRunKey)) fail(
    'Full-channel AI synthesis identity is invalid',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_IDENTITY_INVALID',
  );
  return Object.freeze({
    env, client, tables, repository: repositoryAdapter, syncEngine, automation,
    sourceRecord, sourceStateSha256, factualReport, synthesis,
  });
}

async function pollGenerated(context) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    await sleep(POLL_MS);
    const rows = exactRows(await context.repository.listByFieldValues(
      context.tables.aiRuns,
      'ai_run_key',
      [context.synthesis.aiRunKey],
    ), context.synthesis.aiRunKey);
    if (rows.length !== 1) fail(
      'Full-channel AI synthesis identity drifted while observing Native AI',
      'LARK_WEEKLY_7D_FULL_CHANNEL_AI_OBSERVE_INVALID',
      { count: rows.length },
    );
    last = rows[0];
    const generationStatus = scalar(last.fields.generation_status);
    process.stdout.write(`${JSON.stringify({
      event: 'lark_weekly_7d_full_channel_ai_progress',
      poll: attempt,
      generationStatus,
      outputsPresent: outputPresence(last.fields),
    })}\n`);
    if (generationStatus === 'generated') return last;
    if (generationStatus === 'failed') fail(
      'Full-channel Native AI synthesis failed',
      'LARK_WEEKLY_7D_FULL_CHANNEL_AI_GENERATION_FAILED',
      { failureCode: scalar(last.fields.failure_code) },
    );
  }
  fail(
    'Full-channel Native AI synthesis timed out',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_TIMEOUT',
    { generationStatus: scalar(last?.fields?.generation_status) },
  );
}

async function assertSourceUnchanged(context) {
  const rows = exactRows(await context.repository.listByFieldValues(
    context.tables.aiRuns,
    'ai_run_key',
    [context.synthesis.sourceAiRunKey],
  ), context.synthesis.sourceAiRunKey);
  if (rows.length !== 1 || hashSourceState(rows[0].fields) !== context.sourceStateSha256) fail(
    'Immutable accepted V9 source changed during full-channel AI synthesis',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_SOURCE_MUTATED',
    { matchCount: rows.length },
  );
}

async function verifyAutomationState(client) {
  const response = await client.requestBitableJson(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}/workflows`,
    { method: 'GET' },
  );
  const workflows = response?.data?.workflows ?? response?.data?.items ?? response?.workflows ?? [];
  const ai = exactWorkflow(workflows, AI_TITLE);
  const notification = exactWorkflow(workflows, NOTIFICATION_TITLE);
  const expectedAi = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS.find((item) => item.title === AI_TITLE);
  const expectedNotification = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS.find((item) => item.title === NOTIFICATION_TITLE);
  const aiHash = sha256(workflowId(ai));
  const notificationHash = sha256(workflowId(notification));
  const aiStatus = requireText(ai.status ?? ai.state, 'AI automation status').toLowerCase();
  const notificationStatus = requireText(notification.status ?? notification.state, 'Notification automation status').toLowerCase();
  if (aiHash !== expectedAi?.workflowIdSha256 || !ACTIVE.has(aiStatus)) fail(
    'Exact AI Materialization Automation must remain active',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_AUTOMATION_INVALID',
    { status: aiStatus, identityMatches: aiHash === expectedAi?.workflowIdSha256 },
  );
  if (notificationHash !== expectedNotification?.workflowIdSha256 || !INACTIVE.has(notificationStatus)) fail(
    'Exact Base Notification Automation must remain inactive',
    'LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_AUTOMATION_UNSAFE',
    { status: notificationStatus, identityMatches: notificationHash === expectedNotification?.workflowIdSha256 },
  );
  return Object.freeze({
    aiMaterialization: Object.freeze({ status: aiStatus, identitySha256: aiHash }),
    notification: Object.freeze({ status: notificationStatus, identitySha256: notificationHash }),
  });
}

async function loadRuntime() {
  const config = parseJsoncObject(await readFile(SOURCE_CONFIG, 'utf8'));
  let devVars = {};
  try { devVars = await readDevVars(DEV_VARS_FILE); } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
  const env = Object.freeze({ ...(config.vars ?? {}), ...devVars, ...process.env });
  if (config.name !== 'social-mkt-sync-worker'
      || env.MKT_ENV !== 'development'
      || env.MKT_CUSTOMER_PROFILE !== 'integration_workspace'
      || env.MKT_CONNECTION_CUSTOMER_KEY !== 'chemistry_k'
      || !text(env.LARK_APP_ID)
      || !text(env.LARK_APP_SECRET)
      || !text(env.LARK_APP_TOKEN ?? env.LARK_BASE_APP_TOKEN)) fail(
    'Full-channel AI synthesis requires reviewed Integration Workspace Lark runtime',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_RUNTIME_INVALID',
  );
  return env;
}

function printResult(input) {
  const context = input.context;
  const result = Object.freeze({
    ok: input.ok,
    contractVersion: CONTRACT_VERSION,
    action,
    mode: input.mode,
    stage: 'complete',
    status: input.status,
    repository,
    automationState: context.automation,
    promptContract: Object.freeze({ version: EXPECTED_PROMPT_VERSION, larkPromptMutationCount: 0 }),
    sourceV9MutationCount: 0,
    sourceReportIds: context.synthesis.sourceReportIds,
    period: context.factualReport.period,
    factualReportSha256: context.synthesis.factualReportSha256,
    synthesisAiRunKeySha256: sha256(context.synthesis.aiRunKey),
    synthesisState: input.synthesisState,
    evidence: Object.freeze({
      promptShape: context.synthesis.evidence.evidence.promptShape,
      metricSummaryChars: context.synthesis.evidence.metricSummaryChars,
      channelStatusVectorChars: context.synthesis.evidence.channelStatusVectorChars,
      businessEvidenceChannelCount: context.synthesis.evidence.evidence.businessEvidenceChannelCount,
      comparisonEvidenceChannelCount: context.synthesis.evidence.evidence.comparisonEvidenceChannelCount,
      businessEvidenceChannelNames: context.synthesis.evidence.evidence.businessEvidenceChannelNames,
      positiveComparisonChannelNames: context.synthesis.evidence.evidence.positiveComparisonChannelNames,
      negativeComparisonChannelNames: context.synthesis.evidence.evidence.negativeComparisonChannelNames,
      summaryRequiredFacts: context.synthesis.evidence.evidence.summaryRequiredFacts,
      derivedCtrFacts: context.synthesis.evidence.evidence.derivedCtrFacts,
    }),
    outputs: input.outputs,
    qualityGate: input.qualityGate,
    recordWriteCount,
    triggerWriteCount,
    triggerWrittenFields: triggerWriteCount ? ['failure_code'] : [],
    aiCallsByOperator: 0,
    notificationCount: 0,
    notificationEligible: false,
    sentToGroup: false,
    notificationAutomationStatus: context.automation.notification.status,
    scheduleEnabled: false,
    production: 'BLOCKED',
    nextGate: input.nextGate,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

function exactMainHead() {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const branch = textCommand('git', ['branch', '--show-current']);
  const head = textCommand('git', ['rev-parse', 'HEAD']);
  const originMain = textCommand('git', ['rev-parse', 'origin/main']);
  const dirty = rawCommand('git', ['status', '--porcelain', '--untracked-files=all']).trim();
  if (branch !== 'main' || head !== originMain || dirty) fail(
    'Full-channel AI synthesis requires clean exact current main',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_REPOSITORY_INVALID',
    { branch, head, originMain, dirtyPathCount: dirty ? dirty.split(/\r?\n/u).length : 0 },
  );
  return head;
}

function parseArgs(args) {
  const modes = ['--preview', '--execute', '--recover'].filter((mode) => args.includes(mode));
  const unknown = args.filter((arg) => !['--preview', '--execute', '--recover'].includes(arg));
  if (unknown.length || modes.length > 1) fail(
    'Full-channel AI synthesis accepts one of --preview, --execute, --recover',
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_ARGUMENT_INVALID',
    { unknown },
  );
  if (modes[0] === '--execute') return 'execute';
  if (modes[0] === '--recover') return 'recover';
  return 'preview';
}
function requireConfirmation() {
  if (process.env[CONFIRMATION.envName] !== CONFIRMATION.value) fail(
    `Full-channel AI synthesis requires ${CONFIRMATION.envName}=${CONFIRMATION.value}`,
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_CONFIRMATION_REQUIRED',
    { envName: CONFIRMATION.envName },
  );
}
function exactRows(rows, aiRunKey) {
  return rows.filter((row) => scalar(row?.fields?.ai_run_key) === aiRunKey);
}
function exactWorkflow(workflows, title) {
  const matches = workflows.filter((item) => text(item?.title ?? item?.name) === title);
  if (matches.length !== 1) fail(
    `Expected one exact Automation: ${title}`,
    'LARK_WEEKLY_7D_FULL_CHANNEL_AI_AUTOMATION_IDENTITY_INVALID',
    { count: matches.length },
  );
  return matches[0];
}
function workflowId(workflow) { return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id'); }
function parseSourceReportIdsSafe(value) {
  try {
    const parsed = JSON.parse(requireText(scalar(value), 'source_report_ids_json'));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('invalid');
    return parsed.map((item) => requireText(item, 'source_report_id'));
  } catch {
    fail('source_report_ids_json is invalid', 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_SOURCE_REPORT_IDS_INVALID');
  }
}
function sourcePeriod(fields) {
  return Object.freeze({
    periodStart: dateOnlyInBangkok(scalar(fields.period_start)),
    periodEnd: dateOnlyInBangkok(scalar(fields.period_end)),
    compareStart: nullableDateOnlyInBangkok(scalar(fields.compare_start)),
    compareEnd: nullableDateOnlyInBangkok(scalar(fields.compare_end)),
    comparisonMode: text(scalar(fields.comparison_mode)) ?? 'none',
    windowDays: 7,
  });
}
function hashSourceState(fields) {
  return sha256(JSON.stringify(Object.fromEntries(SOURCE_HASH_FIELDS.map((name) => [
    name,
    ['preview_mode', 'notification_eligible', 'sent_to_group'].includes(name)
      ? booleanValue(fields?.[name])
      : text(scalar(fields?.[name])),
  ]))));
}
function outputPresence(fields) {
  return Object.fromEntries(OUTPUT_FIELDS.map((field) => [field, Boolean(text(scalar(fields?.[field])))]));
}
function readOutputs(fields) {
  return Object.freeze(Object.fromEntries(OUTPUT_FIELDS.map((field) => [field, text(scalar(fields?.[field]))])));
}
function booleanValue(value) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  return null;
}
function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join('');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) if (value[key] !== undefined) return scalar(value[key]);
  }
  return value;
}
function text(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
}
function requireText(value, fieldName) {
  const normalized = text(value);
  if (!normalized) fail(`${fieldName} is required`, 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_INPUT_REQUIRED', { fieldName });
  return normalized;
}
function dateOnlyInBangkok(value) {
  const epoch = Number(value);
  if (!Number.isFinite(epoch) || epoch <= 0) fail('Source period epoch is invalid', 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_PERIOD_INVALID');
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(epoch));
  const byType = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}
function nullableDateOnlyInBangkok(value) {
  return value === null || value === undefined || value === '' ? null : dateOnlyInBangkok(value);
}
function sha256(value) { return createHash('sha256').update(String(value)).digest('hex'); }
function sanitize(value) { return String(value).replace(/[\r\n\t]+/gu, ' ').slice(0, 500); }
function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitize(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeValue(nested)]));
}
function fail(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dFullChannelAiTerminalError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}
function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(`Command failed: ${command}`, 'LARK_WEEKLY_7D_FULL_CHANNEL_AI_COMMAND_FAILED', { command, status: result.status });
  return result;
}
function textCommand(command, args) { return String(run(command, args).stdout ?? '').trim(); }
function rawCommand(command, args) { return String(run(command, args).stdout ?? ''); }
function sleep(ms) { return new Promise((resolvePromise) => setTimeout(resolvePromise, ms)); }
