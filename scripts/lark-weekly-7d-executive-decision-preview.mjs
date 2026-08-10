#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { chmod, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';

import {
  buildLarkWeeklyExecutiveFactualReport,
  renderLarkWeeklyExecutiveChannelSections,
} from '../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import { buildLarkExecutiveNotificationMessage } from '../packages/application/src/notifications/deliver-lark-executive-notification.js';
import {
  buildLarkNativeAiWeekly7dControlledUat,
} from '../packages/application/src/reports/build-lark-native-ai-weekly-7d-controlled-uat.js';
import { LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION } from '../packages/config/src/lark-native-ai-automation-prompt-contract.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS,
} from '../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import { LARK_EXECUTIVE_DESTINATION_KEY_HASH } from '../packages/config/src/lark-notification-runtime-config.js';
import { createLarkBitableClientFromEnv } from '../packages/connectors/src/lark/lark-bitable.client.js';
import { LarkRecordRepository } from '../packages/connectors/src/lark/lark-record-repository.js';
import { TableSyncEngine } from '../packages/sync-engine/src/table-sync-engine.js';
import { parseJsoncObject } from './lib/chatwoot-safe-wrangler-config.js';
import { readDevVars } from './lib/dev-vars.js';
import { collectLarkNativeAiWeekly7dControlledUatSource } from './lib/lark-native-ai-weekly-7d-controlled-uat.js';
import {
  LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_MARKER,
  assertFreshWeekly7dDecisionPeriod,
  assertLarkWeekly7dExecutiveDecisionGenerated,
  assertLarkWeekly7dExecutiveDecisionPrepared,
  buildLarkWeekly7dExecutiveDecisionSynthesis,
  isLarkWeekly7dExecutiveDecisionIdentity,
} from './lib/lark-weekly-7d-executive-decision-preview.js';
import { assertFullChannelMessage } from './lib/lark-weekly-7d-full-channel-notification.js';
import { resolveLarkNotificationControlledUatTables } from './lib/lark-notification-controlled-uat.js';

const ROOT = resolve(process.cwd());
const SOURCE_CONFIG = resolve(
  process.env.MKT_LARK_WEEKLY_7D_NOTIFICATION_WRANGLER_CONFIG ?? 'wrangler.sync.jsonc',
);
const DEV_VARS_FILE = resolve(process.env.DEV_VARS_FILE ?? '.dev.vars');
const OUTPUT_ROOT = resolve(
  process.env.MKT_LARK_WEEKLY_7D_EXECUTIVE_DECISION_EVIDENCE_ROOT
    ?? 'outputs/lark-weekly-7d-executive-decision-preview',
);
const CONTRACT_VERSION = 'lark_weekly_7d_executive_decision_preview_terminal_v1';
const CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_WEEKLY_7D_EXECUTIVE_DECISION_PREVIEW',
  value: 'GENERATE_FRESH_WEEKLY_EXECUTIVE_DECISION_PREVIEW',
});
const EXPECTED_PROMPT_VERSION = 'lark_native_ai_automation_prompts_v3';
const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';
const WEEKLY_NOTIFICATION_TEMPLATE_VERSION = 'executive_weekly_7d_notification_v1';
const ACTIVE = new Set(['enable', 'enabled', 'active', 'on']);
const INACTIVE = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const MAX_POLLS = 36;
const POLL_MS = 5_000;
const MAX_MESSAGE_BYTES = 18_000;

let action = 'preview';
let stage = 'init';
let repositoryState = null;
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
    code: error?.code ?? 'LARK_WEEKLY_7D_EXECUTIVE_DECISION_PREVIEW_FAILED',
    message: sanitize(error?.message ?? String(error)),
    details: sanitizeValue(error?.details ?? {}),
    repository: repositoryState,
    recordWriteCount,
    triggerWriteCount,
    queueAdmissionCount: 0,
    messageSendCount: 0,
    notificationAutomationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
  }, null, 2)}\n`);
  process.exitCode = 1;
}

async function preview() {
  const context = await prepare('preview');
  stage = 'inspect-fresh-decision-identity';
  const rows = exactRows(await context.repository.listByFieldValues(
    context.tables.aiRuns,
    'ai_run_key',
    [context.authority.synthesis.aiRunKey],
  ), context.authority.synthesis.aiRunKey);
  if (rows.length > 1) fail(
    'Fresh Executive Decision identity is duplicated',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_DUPLICATE',
    { count: rows.length },
  );
  let synthesisState = 'absent';
  let outputs = null;
  let qualityGate = null;
  let messagePreview = null;
  if (rows.length === 1) {
    const fields = rows[0].fields;
    if (scalar(fields.generation_status) === 'generated') {
      const accepted = assertLarkWeekly7dExecutiveDecisionGenerated(fields, context.authority.synthesis);
      synthesisState = 'generated';
      outputs = accepted.outputs;
      qualityGate = accepted.qualityGate;
      messagePreview = renderDecisionMessage(context, outputs).message.text;
    } else if (scalar(fields.failure_code) === LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_MARKER) {
      synthesisState = 'triggered_pending';
    } else {
      assertLarkWeekly7dExecutiveDecisionPrepared(fields, context.authority.synthesis);
      synthesisState = 'prepared';
    }
  }
  printResult({
    context,
    status: 'weekly_7d_executive_decision_preview_read_only_passed',
    mode: 'READ_ONLY',
    synthesisState,
    outputs,
    qualityGate,
    messagePreview,
    nextGate: synthesisState === 'generated'
      ? 'review_message_before_automatic_weekly_admission'
      : synthesisState === 'triggered_pending'
        ? 'poll_only_recovery'
        : 'execute_requires_exact_confirmation',
  });
}

async function execute() {
  requireConfirmation();
  const context = await prepare('execute');
  stage = 'inspect-fresh-decision-identity';
  let rows = exactRows(await context.repository.listByFieldValues(
    context.tables.aiRuns,
    'ai_run_key',
    [context.authority.synthesis.aiRunKey],
  ), context.authority.synthesis.aiRunKey);
  if (rows.length > 1) fail(
    'Fresh Executive Decision identity is duplicated',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_DUPLICATE',
    { count: rows.length },
  );

  if (rows.length === 1 && scalar(rows[0].fields.generation_status) === 'generated') {
    const accepted = assertLarkWeekly7dExecutiveDecisionGenerated(rows[0].fields, context.authority.synthesis);
    await assertAuthorityUnchanged(context);
    const rendered = renderDecisionMessage(context, accepted.outputs);
    const result = buildResult({
      context,
      status: 'weekly_7d_executive_decision_preview_already_generated',
      mode: 'IDEMPOTENT_READBACK',
      synthesisState: 'generated',
      outputs: accepted.outputs,
      qualityGate: accepted.qualityGate,
      messagePreview: rendered.message.text,
      messageSha256: rendered.accepted.messageSha256,
      nextGate: 'review_message_before_automatic_weekly_admission',
    });
    await retainSummary(context, result);
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }

  if (rows.length === 0) {
    stage = 'create-one-fresh-decision-preview-row';
    const plan = await context.syncEngine.planByKey({
      repository: context.repository,
      tableId: context.tables.aiRuns,
      keyField: 'ai_run_key',
      rows: [context.authority.synthesis.fields],
    });
    if (plan.createRows.length !== 1 || plan.updateRows.length !== 0 || plan.skipped !== 0) fail(
      'Fresh Executive Decision Preview must create exactly one new AI row',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_CREATE_PLAN_INVALID',
      { createRows: plan.createRows.length, updateRows: plan.updateRows.length, skipped: plan.skipped },
    );
    const created = await context.syncEngine.executePlan(plan);
    if (created.created !== 1 || created.updated !== 0) fail(
      'Fresh Executive Decision Preview row was not created exactly once',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_CREATE_FAILED',
      created,
    );
    recordWriteCount += 1;
    rows = exactRows(await context.repository.listByFieldValues(
      context.tables.aiRuns,
      'ai_run_key',
      [context.authority.synthesis.aiRunKey],
    ), context.authority.synthesis.aiRunKey);
  }

  if (rows.length !== 1) fail(
    'Fresh Executive Decision Preview readback is invalid',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_READBACK_INVALID',
    { count: rows.length },
  );
  if (scalar(rows[0].fields.failure_code) === LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_MARKER) fail(
    'Fresh Executive Decision Preview was already triggered; blind retrigger is forbidden',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_ALREADY_TRIGGERED',
    { recoveryRequired: true },
  );
  assertLarkWeekly7dExecutiveDecisionPrepared(rows[0].fields, context.authority.synthesis);
  await assertAuthorityUnchanged(context);

  stage = 'trigger-native-ai-by-failure-code-only';
  const recordId = requireText(rows[0].recordId ?? rows[0].record_id, 'recordId');
  const trigger = await context.client.batchUpdateRecords({
    tableId: context.tables.aiRuns,
    records: [{
      recordId,
      fields: { failure_code: LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_MARKER },
    }],
  });
  if (trigger.updated !== 1) fail(
    'Fresh Executive Decision Preview requires exactly one failure_code trigger write',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_FAILED',
    { updated: trigger.updated },
  );
  recordWriteCount += 1;
  triggerWriteCount += 1;

  stage = 'observe-native-ai-decision-output';
  const generated = await pollGenerated(context);
  const accepted = assertLarkWeekly7dExecutiveDecisionGenerated(generated.fields, context.authority.synthesis);
  await assertAuthorityUnchanged(context);
  const rendered = renderDecisionMessage(context, accepted.outputs);
  const result = buildResult({
    context,
    status: 'weekly_7d_executive_decision_preview_generated_and_validated',
    mode: 'CONTROLLED_NATIVE_AI_PREVIEW',
    synthesisState: 'generated',
    outputs: accepted.outputs,
    qualityGate: accepted.qualityGate,
    messagePreview: rendered.message.text,
    messageSha256: rendered.accepted.messageSha256,
    nextGate: 'review_message_before_automatic_weekly_admission',
  });
  await retainSummary(context, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function recover() {
  const context = await prepare('recover');
  stage = 'load-triggered-fresh-decision-preview';
  const rows = exactRows(await context.repository.listByFieldValues(
    context.tables.aiRuns,
    'ai_run_key',
    [context.authority.synthesis.aiRunKey],
  ), context.authority.synthesis.aiRunKey);
  if (rows.length !== 1) fail(
    'Fresh Executive Decision recovery requires one retained AI row',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_RECOVERY_SOURCE_INVALID',
    { count: rows.length },
  );
  let generated = rows[0];
  if (scalar(generated.fields.generation_status) !== 'generated') {
    if (scalar(generated.fields.failure_code) !== LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_MARKER) fail(
      'Fresh Executive Decision recovery requires the retained trigger marker',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_RECOVERY_MARKER_MISSING',
    );
    stage = 'poll-existing-native-ai-without-retrigger';
    generated = await pollGenerated(context);
  }
  const accepted = assertLarkWeekly7dExecutiveDecisionGenerated(generated.fields, context.authority.synthesis);
  await assertAuthorityUnchanged(context);
  const rendered = renderDecisionMessage(context, accepted.outputs);
  const result = buildResult({
    context,
    status: 'weekly_7d_executive_decision_preview_recovered_without_retrigger',
    mode: 'POLL_ONLY_RECOVERY',
    synthesisState: 'generated',
    outputs: accepted.outputs,
    qualityGate: accepted.qualityGate,
    messagePreview: rendered.message.text,
    messageSha256: rendered.accepted.messageSha256,
    nextGate: 'review_message_before_automatic_weekly_admission',
  });
  await retainSummary(context, result);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function prepare(mode) {
  stage = 'repository-preflight';
  const head = exactMainHead();
  repositoryState = Object.freeze({ branch: 'main', head, originMain: head, clean: true });
  if (LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION !== EXPECTED_PROMPT_VERSION) fail(
    'Fresh Executive Decision Preview requires the approved Prompt v3 contract',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_PROMPT_CONTRACT_INVALID',
    { observed: LARK_NATIVE_AI_AUTOMATION_PROMPT_VERSION, expected: EXPECTED_PROMPT_VERSION },
  );
  if (mode === 'execute') {
    stage = 'local-focused-gates';
    run('node', ['--test',
      'tests/application/lark-weekly-7d-full-channel-ai-synthesis.test.js',
      'tests/application/lark-weekly-executive-full-channel-ai-evidence.test.js',
      'tests/scripts/lark-weekly-7d-executive-decision-preview-source.test.mjs',
    ], { stdio: 'inherit' });
    run('npm', ['run', 'check'], { stdio: 'inherit' });
  }

  stage = 'assert-no-automatic-notification-producer';
  const scheduledSource = await readFile(resolve('apps/sync-worker/src/scheduled-jobs.js'), 'utf8');
  if (/LARK_NOTIFICATION_SEND/u.test(scheduledSource)) fail(
    'Fresh Executive Decision Preview requires automatic Notification admission to remain absent',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_AUTOMATIC_PRODUCER_PRESENT',
  );

  stage = 'load-integration-workspace-runtime';
  const env = await loadRuntime();
  const client = createLarkBitableClientFromEnv(Object.freeze({
    ...env,
    LARK_MAX_ATTEMPTS: '1',
    LARK_MAX_PAGES: '5',
    LARK_REQUEST_TIMEOUT_MS: '30000',
    LARK_MIN_REQUEST_INTERVAL_MS: '150',
  }));
  const tables = resolveLarkNotificationControlledUatTables(await client.listTables());
  const repository = new LarkRecordRepository({ client });
  const syncEngine = new TableSyncEngine();

  stage = 'verify-automation-state';
  const automation = await verifyAutomationState(client);
  stage = 'build-fresh-period-authority';
  const authority = await buildFreshAuthority(client);
  const evidenceDir = resolve(OUTPUT_ROOT, sha256(authority.synthesis.aiRunKey));

  return Object.freeze({
    env, client, tables, repository, syncEngine, automation, authority, evidenceDir,
  });
}

async function buildFreshAuthority(client) {
  const collected = await collectLarkNativeAiWeekly7dControlledUatSource({ client });
  const freshPeriod = assertFreshWeekly7dDecisionPeriod(collected.targetPeriod, Date.now());
  const generatedAt = resolveAuthorityGeneratedAt(collected.reportBundles);
  const seed = await buildLarkNativeAiWeekly7dControlledUat({
    generatedAt,
    customerKey: 'integration_workspace',
    customerProfile: 'integration_workspace',
    utcOffset: '+07:00',
    targetPeriod: collected.targetPeriod,
    settings: collected.settings,
    reportBundles: collected.reportBundles,
  });
  const sourceRecord = Object.freeze({ recordId: null, fields: seed.executiveRow });
  const factualReport = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: collected.targetPeriod,
    reportBundles: collected.reportBundles,
  });
  if (factualReport.businessFactChannelCount < 1) fail(
    'Fresh Executive Decision Preview requires at least one channel with observed business facts',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_BUSINESS_FACTS_MISSING',
  );
  const synthesis = buildLarkWeekly7dExecutiveDecisionSynthesis({ sourceRecord, factualReport });
  if (!isLarkWeekly7dExecutiveDecisionIdentity(synthesis.aiRunKey)) fail(
    'Fresh Executive Decision Preview identity is invalid',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_IDENTITY_INVALID',
  );
  return Object.freeze({ collected, freshPeriod, generatedAt, sourceRecord, factualReport, synthesis });
}

async function assertAuthorityUnchanged(context) {
  const current = await buildFreshAuthority(context.client);
  if (current.synthesis.aiRunKey !== context.authority.synthesis.aiRunKey
      || current.synthesis.factualReportSha256 !== context.authority.synthesis.factualReportSha256
      || JSON.stringify(current.synthesis.sourceReportIds) !== JSON.stringify(context.authority.synthesis.sourceReportIds)
      || JSON.stringify(current.factualReport.period) !== JSON.stringify(context.authority.factualReport.period)) fail(
    'Fresh Weekly Report authority changed while generating the Executive Decision Preview',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_SOURCE_DRIFT',
    {
      originalPeriod: context.authority.factualReport.period,
      currentPeriod: current.factualReport.period,
      originalReportCount: context.authority.synthesis.sourceReportIds.length,
      currentReportCount: current.synthesis.sourceReportIds.length,
    },
  );
  return true;
}

function renderDecisionMessage(context, outputs) {
  const sections = renderLarkWeeklyExecutiveChannelSections(context.authority.factualReport);
  const composedInsight = [
    outputs.insight_summary,
    '',
    ...sections.flatMap((section) => [section.heading, ...section.lines, '']),
  ].join('\n').trim();
  const sourceFields = context.authority.sourceRecord.fields;
  const request = Object.freeze({
    aiRun: Object.freeze({
      aiRunKey: context.authority.synthesis.aiRunKey,
      reportId: context.authority.synthesis.aiRunKey,
      templateVersion: WEEKLY_NOTIFICATION_TEMPLATE_VERSION,
      scopeType: 'executive',
      generationStatus: 'generated',
      notificationEligible: true,
      previewMode: false,
      sentToGroup: false,
      dedupeKey: context.authority.synthesis.dedupeKey,
      windowDays: 7,
      readinessStatus: requireText(scalar(sourceFields.readiness_status), 'readiness_status'),
      severity: requireText(scalar(sourceFields.severity) ?? 'info', 'severity'),
      insightSummary: composedInsight,
      strengths: outputs.strengths,
      weaknesses: outputs.weaknesses,
      recommendations: outputs.recommendations,
    }),
    snapshot: Object.freeze({
      reportId: context.authority.synthesis.aiRunKey,
      reportSettingKey: 'weekly_7d_read_only_preview',
      customerProfile: 'integration_workspace',
      periodStart: context.authority.factualReport.period.periodStart,
      periodEnd: context.authority.factualReport.period.periodEnd,
    }),
    settings: Object.freeze({
      enabled: true,
      aiEnabled: true,
      notificationEnabled: true,
      groupId: '[READ_ONLY_PREVIEW_DESTINATION]',
      destinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
    }),
  });
  const message = buildLarkExecutiveNotificationMessage(request);
  const accepted = assertFullChannelMessage({
    admission: {
      factualReport: context.authority.factualReport,
      businessFactChannelCount: context.authority.factualReport.businessFactChannelCount,
      originalAiOutputs: {
        sourceInsight: outputs.insight_summary,
        strengths: outputs.strengths,
        weaknesses: outputs.weaknesses,
        recommendations: outputs.recommendations,
      },
    },
    messageText: message.text,
  });
  const messageBytes = Buffer.byteLength(message.text, 'utf8');
  if (messageBytes > MAX_MESSAGE_BYTES) fail(
    'Fresh Executive Decision message preview exceeds the reviewed byte bound',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_MESSAGE_TOO_LARGE',
    { messageBytes, maximumBytes: MAX_MESSAGE_BYTES },
  );
  return Object.freeze({ message, accepted, messageBytes });
}

async function pollGenerated(context) {
  let last = null;
  for (let attempt = 1; attempt <= MAX_POLLS; attempt += 1) {
    await sleep(POLL_MS);
    const rows = exactRows(await context.repository.listByFieldValues(
      context.tables.aiRuns,
      'ai_run_key',
      [context.authority.synthesis.aiRunKey],
    ), context.authority.synthesis.aiRunKey);
    if (rows.length !== 1) fail(
      'Fresh Executive Decision identity drifted while observing Native AI',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_OBSERVE_INVALID',
      { count: rows.length },
    );
    last = rows[0];
    const generationStatus = scalar(last.fields.generation_status);
    process.stdout.write(`${JSON.stringify({
      event: 'lark_weekly_7d_executive_decision_progress',
      poll: attempt,
      generationStatus,
      outputPresence: outputPresence(last.fields),
    })}\n`);
    if (generationStatus === 'generated') return last;
    if (generationStatus === 'failed') fail(
      'Fresh Executive Decision Native AI generation failed',
      'LARK_WEEKLY_7D_EXECUTIVE_DECISION_GENERATION_FAILED',
      { failureCode: scalar(last.fields.failure_code) },
    );
  }
  fail(
    'Fresh Executive Decision Native AI generation timed out',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_TIMEOUT',
    { generationStatus: scalar(last?.fields?.generation_status) },
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
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_AI_AUTOMATION_INVALID',
    { status: aiStatus, identityMatches: aiHash === expectedAi?.workflowIdSha256 },
  );
  if (notificationHash !== expectedNotification?.workflowIdSha256 || !INACTIVE.has(notificationStatus)) fail(
    'Exact Base Notification Automation must remain inactive',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_NOTIFICATION_AUTOMATION_UNSAFE',
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
    'Fresh Executive Decision Preview requires reviewed Integration Workspace Lark runtime',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_RUNTIME_INVALID',
  );
  return env;
}

function resolveAuthorityGeneratedAt(reportBundles) {
  const values = reportBundles
    .map((bundle) => Number(bundle?.payload?.generatedAt))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) fail(
    'Fresh Executive Decision Preview requires source Report generated_at authority',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_GENERATED_AT_MISSING',
  );
  return Math.max(...values);
}

function buildResult(input) {
  const { context } = input;
  const messageBytes = input.messagePreview ? Buffer.byteLength(input.messagePreview, 'utf8') : 0;
  return Object.freeze({
    ok: true,
    contractVersion: CONTRACT_VERSION,
    action,
    mode: input.mode,
    stage: 'complete',
    status: input.status,
    repository: repositoryState,
    period: context.authority.factualReport.period,
    previousCompletedBangkokDay: context.authority.freshPeriod.previousCompletedBangkokDay,
    sourceReportIds: context.authority.synthesis.sourceReportIds,
    sourceReportCount: context.authority.synthesis.sourceReportIds.length,
    selectedChannelCount: context.authority.collected.selectedChannelCount,
    businessFactChannelCount: context.authority.factualReport.businessFactChannelCount,
    factualReportSha256: context.authority.synthesis.factualReportSha256,
    synthesisAiRunKeySha256: sha256(context.authority.synthesis.aiRunKey),
    synthesisState: input.synthesisState,
    evidence: Object.freeze({
      promptShape: context.authority.synthesis.evidence.evidence.promptShape,
      businessEvidenceChannelCount: context.authority.synthesis.evidence.evidence.businessEvidenceChannelCount,
      comparisonEvidenceChannelCount: context.authority.synthesis.evidence.evidence.comparisonEvidenceChannelCount,
      businessEvidenceChannelNames: context.authority.synthesis.evidence.evidence.businessEvidenceChannelNames,
      contentCandidateNames: context.authority.synthesis.evidence.evidence.contentCandidateNames,
      paidCandidateNames: context.authority.synthesis.evidence.evidence.paidCandidateNames,
      funnelDivergences: context.authority.synthesis.evidence.evidence.funnelDivergences,
      organicPaidMappingAvailable: context.authority.synthesis.evidence.evidence.organicPaidMappingAvailable,
    }),
    outputs: input.outputs,
    qualityGate: input.qualityGate,
    messagePreview: input.messagePreview,
    messageSha256: input.messageSha256 ?? (input.messagePreview ? sha256(input.messagePreview) : null),
    messageBytes,
    recordWriteCount,
    triggerWriteCount,
    triggerWrittenFields: triggerWriteCount ? ['failure_code'] : [],
    aiCallsByOperator: 0,
    persistedPreviewMode: true,
    persistedNotificationEligible: false,
    persistedSentToGroup: false,
    renderOnlyNotificationEligibility: input.messagePreview ? true : false,
    queueAdmissionCount: 0,
    messageSendCount: 0,
    workerDeploymentCount: 0,
    reportSettingWriteCount: 0,
    notificationAutomationStatus: context.automation.notification.status,
    automaticNotificationProducer: false,
    automationActivationCount: 0,
    scheduleActivationCount: 0,
    production: 'BLOCKED',
    nextGate: input.nextGate,
  });
}

function printResult(input) {
  const result = buildResult(input);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}

async function retainSummary(context, result) {
  await mkdir(context.evidenceDir, { recursive: true, mode: 0o700 });
  await chmod(context.evidenceDir, 0o700);
  const path = join(context.evidenceDir, 'decision-preview-summary.json');
  await writeFile(path, `${JSON.stringify(result, null, 2)}\n`, { mode: 0o600 });
  await chmod(path, 0o600);
}

function exactMainHead() {
  run('git', ['fetch', '--quiet', 'origin', 'main']);
  const branch = textCommand('git', ['branch', '--show-current']);
  const head = textCommand('git', ['rev-parse', 'HEAD']);
  const originMain = textCommand('git', ['rev-parse', 'origin/main']);
  const dirty = rawCommand('git', ['status', '--porcelain', '--untracked-files=all']).trim();
  if (branch !== 'main' || head !== originMain || dirty) fail(
    'Fresh Executive Decision Preview requires clean exact current main',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_REPOSITORY_INVALID',
    { branch, head, originMain, dirtyPathCount: dirty ? dirty.split(/\r?\n/u).length : 0 },
  );
  return head;
}

function parseArgs(args) {
  const modes = ['--preview', '--execute', '--recover'].filter((mode) => args.includes(mode));
  const unknown = args.filter((arg) => !['--preview', '--execute', '--recover'].includes(arg));
  if (unknown.length || modes.length > 1) fail(
    'Fresh Executive Decision Preview accepts one of --preview, --execute, --recover',
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_ARGUMENT_INVALID',
    { unknown },
  );
  if (modes[0] === '--execute') return 'execute';
  if (modes[0] === '--recover') return 'recover';
  return 'preview';
}

function requireConfirmation() {
  if (process.env[CONFIRMATION.envName] !== CONFIRMATION.value) fail(
    `Fresh Executive Decision Preview requires ${CONFIRMATION.envName}=${CONFIRMATION.value}`,
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_CONFIRMATION_REQUIRED',
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
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_AUTOMATION_IDENTITY_INVALID',
    { count: matches.length },
  );
  return matches[0];
}

function workflowId(workflow) {
  return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id');
}

function outputPresence(fields) {
  return Object.fromEntries(['insight_summary', 'strengths', 'weaknesses', 'recommendations'].map((field) => [
    field,
    Boolean(text(scalar(fields?.[field]))),
  ]));
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

function requireText(value, label) {
  const normalized = text(value);
  if (!normalized) fail(`${label} is required`, 'LARK_WEEKLY_7D_EXECUTIVE_DECISION_INPUT_REQUIRED', { label });
  return normalized;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function sanitize(value) {
  return String(value).replace(/[\r\n\t]+/gu, ' ').slice(0, 500);
}

function sanitizeValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== 'object') return typeof value === 'string' ? sanitize(value) : value;
  return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeValue(nested)]));
}

function fail(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dExecutiveDecisionPreviewTerminalError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  throw error;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: ROOT,
    encoding: 'utf8',
    env: process.env,
    stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
    maxBuffer: 512 * 1024 * 1024,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) fail(
    `Command failed: ${command}`,
    'LARK_WEEKLY_7D_EXECUTIVE_DECISION_COMMAND_FAILED',
    { command, status: result.status },
  );
  return result;
}

function textCommand(command, args) {
  return String(run(command, args).stdout ?? '').trim();
}

function rawCommand(command, args) {
  return String(run(command, args).stdout ?? '');
}

function sleep(ms) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, ms));
}
