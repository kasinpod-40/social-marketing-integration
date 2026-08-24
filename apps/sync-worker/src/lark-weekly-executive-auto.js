import { createHash } from 'node:crypto';

import {
  buildLarkWeeklyExecutiveFactualReport,
} from '../../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkNativeAiWeekly7dControlledUat,
} from '../../../packages/application/src/reports/build-lark-native-ai-weekly-7d-controlled-uat.js';
import {
  REPORT_SOURCE_STATUS,
  listReportPlatformContracts,
} from '../../../packages/application/src/reports/report-platform-adapter-registry.js';
import {
  JOB_TRIGGERS,
  JOB_TYPES,
} from '../../../packages/application/src/jobs/job-catalog.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS,
} from '../../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import {
  LARK_NOTIFICATION_RUNTIME_MODES,
} from '../../../packages/config/src/lark-notification-runtime-config.js';
import {
  createLarkBitableClientFromEnv,
} from '../../../packages/connectors/src/lark/lark-bitable.client.js';
import {
  permanentError,
  transientError,
} from '../../../packages/shared/src/errors/runtime-error.js';
import {
  collectLarkNativeAiWeekly7dControlledUatSource,
} from '../../../scripts/lib/lark-native-ai-weekly-7d-controlled-uat.js';
import {
  LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_MARKER,
  assertFreshWeekly7dDecisionPeriod,
  assertLarkWeekly7dExecutiveDecisionGenerated,
  assertLarkWeekly7dExecutiveDecisionPrepared,
  buildLarkWeekly7dExecutiveDecisionSynthesis,
} from '../../../scripts/lib/lark-weekly-7d-executive-decision-preview.js';
import {
  buildFreshWeekly7dExecutiveDecisionNotificationAdmission,
} from '../../../scripts/lib/lark-weekly-7d-fresh-decision-notification-source.js';
import {
  buildLarkWeekly7dNotificationAdmissionJob,
} from '../../../scripts/lib/lark-weekly-7d-notification-admission.js';

const CONTRACT_VERSION = 'lark_automatic_weekly_executive_notification_v1';
const AI_TITLE = 'AI Materialization → MKT_AI_Report_Runs';
const NOTIFICATION_TITLE = 'Eligible AI Run → Lark Group Notification';
const ACTIVE = new Set(['enable', 'enabled', 'active', 'on']);
const INACTIVE = new Set(['disable', 'disabled', 'inactive', 'off', 'draft']);
const EXPECTED_REPORT_COUNT = listReportPlatformContracts()
  .filter((contract) => contract.sourceStatus === REPORT_SOURCE_STATUS.ACTIVE)
  .length;
const DEFAULT_MAX_QUEUE_ATTEMPTS = 5;
const CREATE_PHASES = Object.freeze({
  synthesis: 'fresh_ai_row_create_attempt',
  admission: 'notification_ai_row_create_attempt',
});

export function createAutomaticWeeklyExecutiveProcessor(dependencies = {}) {
  const collectSource = dependencies.collectSource
    ?? collectLarkNativeAiWeekly7dControlledUatSource;
  const buildSeed = dependencies.buildSeed
    ?? buildLarkNativeAiWeekly7dControlledUat;
  const buildFactualReport = dependencies.buildFactualReport
    ?? buildLarkWeeklyExecutiveFactualReport;
  const buildSynthesis = dependencies.buildSynthesis
    ?? buildLarkWeekly7dExecutiveDecisionSynthesis;
  const buildAdmission = dependencies.buildAdmission
    ?? buildFreshWeekly7dExecutiveDecisionNotificationAdmission;
  const buildNotificationJob = dependencies.buildNotificationJob
    ?? buildLarkWeekly7dNotificationAdmissionJob;
  const createClient = dependencies.createClient
    ?? createLarkBitableClientFromEnv;
  const now = dependencies.now ?? (() => Date.now());

  return async function processAutomaticWeeklyExecutive(jobInput = {}) {
    const body = jobInput.job?.body ?? {};
    assertAutomaticJob(body, jobInput.config);
    const periodEnd = requireDateOnly(body.periodEnd, 'job.periodEnd');
    const aiRunsTableId = requireText(jobInput.config?.tables?.aiRuns, 'config.tables.aiRuns');
    const maximumAttempts = readMaximumAttempts(jobInput.env);
    const mainQueueAttempts = readPositiveInteger(
      jobInput.mainQueueAttempts ?? 1,
      'mainQueueAttempts',
    );
    const infrastructure = jobInput.getInfrastructure();
    const client = createClient(jobInput.env);
    const repository = infrastructure.repository;
    const syncEngine = infrastructure.syncEngine;
    const workStore = infrastructure.getResumableWorkStore();

    await verifyAutomationState(client, jobInput.env);

    const collected = await collectSource({
      client,
      customerProfile: jobInput.config.customerProfile,
    });
    const observedPeriodEnd = requireDateOnly(
      collected?.targetPeriod?.periodEnd,
      'source.targetPeriod.periodEnd',
    );
    if (observedPeriodEnd < periodEnd || collected.selectedChannelCount < EXPECTED_REPORT_COUNT) {
      throwPendingOrTerminal({
        mainQueueAttempts,
        maximumAttempts,
        message: 'Weekly Executive source Reports are not complete for the scheduled period',
        code: 'LARK_WEEKLY_EXECUTIVE_AUTO_REPORTS_PENDING',
        terminalCode: 'LARK_WEEKLY_EXECUTIVE_AUTO_REPORTS_NOT_READY',
        details: {
          expectedReportCount: EXPECTED_REPORT_COUNT,
          observedReportCount: collected.selectedChannelCount,
          expectedPeriodEnd: periodEnd,
          observedPeriodEnd,
        },
      });
    }
    if (observedPeriodEnd !== periodEnd || collected.selectedChannelCount !== EXPECTED_REPORT_COUNT) {
      throw autoError(
        'Weekly Executive source authority advanced beyond the scheduled identity',
        'LARK_WEEKLY_EXECUTIVE_AUTO_SOURCE_DRIFT',
        {
          expectedReportCount: EXPECTED_REPORT_COUNT,
          observedReportCount: collected.selectedChannelCount,
          expectedPeriodEnd: periodEnd,
          observedPeriodEnd,
        },
      );
    }

    const freshPeriod = assertFreshWeekly7dDecisionPeriod(collected.targetPeriod, now());
    if (freshPeriod.periodEnd !== periodEnd) {
      throw autoError(
        'Weekly Executive scheduled period differs from the Fresh decision period',
        'LARK_WEEKLY_EXECUTIVE_AUTO_SOURCE_DRIFT',
      );
    }
    const generatedAt = resolveAuthorityGeneratedAt(collected.reportBundles);
    const seed = await buildSeed({
      generatedAt,
      customerKey: jobInput.config.customerProfile,
      customerProfile: jobInput.config.customerProfile,
      utcOffset: '+07:00',
      targetPeriod: collected.targetPeriod,
      settings: collected.settings,
      reportBundles: collected.reportBundles,
    });
    const sourceRecord = Object.freeze({ recordId: null, fields: seed.executiveRow });
    const factualReport = buildFactualReport({
      targetPeriod: collected.targetPeriod,
      reportBundles: collected.reportBundles,
    });
    if (factualReport.businessFactChannelCount < 1) {
      throw autoError(
        'Weekly Executive automatic source has no observed business facts',
        'LARK_WEEKLY_EXECUTIVE_AUTO_BUSINESS_FACTS_MISSING',
      );
    }
    const synthesis = buildSynthesis({ sourceRecord, factualReport });

    const operation = requireStableOperation(jobInput.operation);
    const work = await workStore.beginWork({
      workKey: operation.workKey,
      cursorKey: `lark-weekly-executive-auto:${periodEnd}`,
      workType: CONTRACT_VERSION,
      operationFingerprint: sha256(JSON.stringify({
        contractVersion: CONTRACT_VERSION,
        periodEnd,
        synthesisAiRunKey: synthesis.aiRunKey,
        factualReportSha256: synthesis.factualReportSha256,
      })),
      generation: operation.generation,
      requestedAt: operation.originalRequestedAt,
    });
    if (work.completed) {
      return Object.freeze({
        ok: true,
        mode: 'automatic_weekly',
        status: 'already_completed',
        periodEnd,
        messageSendCount: 0,
      });
    }
    if (work.superseded) {
      throw autoError(
        'Weekly Executive automatic work was superseded',
        'LARK_WEEKLY_EXECUTIVE_AUTO_SUPERSEDED',
      );
    }

    try {
      const generatedRecord = await ensureFreshAiGenerated({
        aiRunsTableId,
        client,
        repository,
        syncEngine,
        workStore,
        workKey: operation.workKey,
        synthesis,
        mainQueueAttempts,
        maximumAttempts,
      });
      const accepted = assertLarkWeekly7dExecutiveDecisionGenerated(
        generatedRecord.fields,
        synthesis,
      );
      const admission = buildAdmission({
        sourceRecord: generatedRecord,
        synthesis,
      });
      const admissionRecord = await ensureAdmissionRow({
        aiRunsTableId,
        repository,
        syncEngine,
        workStore,
        workKey: operation.workKey,
        admission,
      });

      if (readBoolean(admissionRecord.fields.sent_to_group) === true) {
        await workStore.completeWork({
          workKey: operation.workKey,
          completion: {
            status: 'already_sent',
            periodEnd,
            qualityGatePassed: accepted.qualityGate.passed,
          },
        });
        return Object.freeze({
          ok: true,
          mode: 'automatic_weekly',
          status: 'already_sent',
          periodEnd,
          qualityGatePassed: true,
          messageSendCount: 0,
        });
      }

      const queue = jobInput.env?.MKT_SYNC_QUEUE;
      if (typeof queue?.send !== 'function') {
        throw autoError(
          'Automatic Weekly Executive requires Queue producer binding',
          'MKT_SYNC_QUEUE_BINDING_REQUIRED',
        );
      }
      const dateKey = periodEnd.replaceAll('-', '');
      const notificationJob = buildNotificationJob({
        aiRunKey: admission.aiRunKey,
        operationId: `weekly-executive-send-${dateKey}`,
        requestedAt: operation.originalRequestedAt,
      });
      try {
        await queue.send(notificationJob);
      } catch (cause) {
        if (mainQueueAttempts >= maximumAttempts) {
          throw autoError(
            'Automatic Weekly Executive delivery Queue admission exhausted its bounded attempts',
            'LARK_WEEKLY_EXECUTIVE_AUTO_QUEUE_ADMISSION_EXHAUSTED',
            {},
            cause,
          );
        }
        throw transientError('Automatic Weekly Executive delivery Queue admission must be retried', {
          code: 'LARK_WEEKLY_EXECUTIVE_AUTO_QUEUE_ADMISSION_FAILED',
          cause,
        });
      }

      await workStore.completeWork({
        workKey: operation.workKey,
        completion: {
          status: 'notification_queued',
          periodEnd,
          qualityGatePassed: accepted.qualityGate.passed,
        },
      });
      return Object.freeze({
        ok: true,
        mode: 'automatic_weekly',
        status: 'notification_queued',
        periodEnd,
        qualityGatePassed: true,
        queueAdmissionCount: 1,
        messageSendCount: 0,
      });
    } catch (error) {
      if (error?.retryable === true) throw error;
      try {
        await workStore.abandonWork({
          workKey: operation.workKey,
          reason: error?.code ?? 'LARK_WEEKLY_EXECUTIVE_AUTO_FAILED',
        });
      } catch {
        // Preserve the primary failure. Queue/DLQ evidence remains authoritative if terminalization fails.
      }
      throw error;
    }
  };
}

export const processAutomaticWeeklyExecutiveNotification =
  createAutomaticWeeklyExecutiveProcessor();

async function ensureFreshAiGenerated(input) {
  const aiRunsTableId = requireText(input.aiRunsTableId, 'aiRunsTableId');
  let rows = exactRows(await input.repository.listByFieldValues(
    aiRunsTableId,
    'ai_run_key',
    [input.synthesis.aiRunKey],
  ), input.synthesis.aiRunKey);
  if (rows.length > 1) {
    throw autoError(
      'Fresh Weekly Executive AI identity is duplicated',
      'LARK_WEEKLY_EXECUTIVE_AUTO_AI_DUPLICATE',
    );
  }
  if (rows.length === 0) {
    rows = await guardedCreateExactRow({
      repository: input.repository,
      syncEngine: input.syncEngine,
      workStore: input.workStore,
      workKey: input.workKey,
      phase: CREATE_PHASES.synthesis,
      tableId: aiRunsTableId,
      keyField: 'ai_run_key',
      keyValue: input.synthesis.aiRunKey,
      row: input.synthesis.fields,
      unknownCode: 'LARK_WEEKLY_EXECUTIVE_AUTO_AI_CREATE_OUTCOME_UNKNOWN',
    });
  }
  const row = rows[0];
  const generationStatus = scalar(row.fields.generation_status);
  if (generationStatus === 'generated') return row;
  if (generationStatus === 'failed') {
    throw autoError(
      'Fresh Weekly Executive Native AI generation failed',
      'LARK_WEEKLY_EXECUTIVE_AUTO_AI_FAILED',
      { failureCode: optionalText(scalar(row.fields.failure_code)) },
    );
  }
  assertLarkWeekly7dExecutiveDecisionPrepared(row.fields, input.synthesis);
  const triggerMarker = optionalText(scalar(row.fields.failure_code));
  if (triggerMarker === LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_MARKER) {
    throwPendingOrTerminal({
      mainQueueAttempts: input.mainQueueAttempts,
      maximumAttempts: input.maximumAttempts,
      message: 'Fresh Weekly Executive Native AI is still generating',
      code: 'LARK_WEEKLY_EXECUTIVE_AUTO_AI_PENDING',
      terminalCode: 'LARK_WEEKLY_EXECUTIVE_AUTO_AI_TIMEOUT',
    });
  }
  if (triggerMarker !== null) {
    throw autoError(
      'Fresh Weekly Executive AI row contains an unexpected trigger marker',
      'LARK_WEEKLY_EXECUTIVE_AUTO_AI_TRIGGER_DRIFT',
    );
  }

  const phase = await input.workStore.loadPhase({
    workKey: input.workKey,
    phase: 'native_ai_trigger_attempt',
  });
  if (phase?.state?.attempted === true) {
    throw autoError(
      'Native AI trigger outcome is unknown; blind retrigger is forbidden',
      'LARK_WEEKLY_EXECUTIVE_AUTO_AI_TRIGGER_OUTCOME_UNKNOWN',
    );
  }
  await input.workStore.savePhase({
    workKey: input.workKey,
    phase: 'native_ai_trigger_attempt',
    state: { attempted: true, aiRunKeySha256: sha256(input.synthesis.aiRunKey) },
    expectedItems: 1,
    processedItems: 0,
    complete: false,
  });
  const recordId = requireText(row.recordId ?? row.record_id, 'AI recordId');
  let trigger;
  try {
    trigger = await input.client.batchUpdateRecords({
      tableId: aiRunsTableId,
      records: [{
        recordId,
        fields: { failure_code: LARK_WEEKLY_7D_EXECUTIVE_DECISION_TRIGGER_MARKER },
      }],
    });
  } catch (cause) {
    throw autoError(
      'Native AI trigger outcome is unknown; blind retrigger is forbidden',
      'LARK_WEEKLY_EXECUTIVE_AUTO_AI_TRIGGER_OUTCOME_UNKNOWN',
      {},
      cause,
    );
  }
  if (trigger.updated !== 1) {
    throw autoError(
      'Fresh Weekly Executive Native AI trigger did not update exactly one row',
      'LARK_WEEKLY_EXECUTIVE_AUTO_AI_TRIGGER_FAILED',
      { updated: trigger.updated },
    );
  }
  await input.workStore.savePhase({
    workKey: input.workKey,
    phase: 'native_ai_trigger_attempt',
    state: { attempted: true, aiRunKeySha256: sha256(input.synthesis.aiRunKey) },
    expectedItems: 1,
    processedItems: 1,
    complete: true,
  });
  throw transientError('Fresh Weekly Executive Native AI was triggered and is pending', {
    code: 'LARK_WEEKLY_EXECUTIVE_AUTO_AI_PENDING',
  });
}

async function ensureAdmissionRow(input) {
  const aiRunsTableId = requireText(input.aiRunsTableId, 'aiRunsTableId');
  let rows = exactRows(await input.repository.listByFieldValues(
    aiRunsTableId,
    'ai_run_key',
    [input.admission.aiRunKey],
  ), input.admission.aiRunKey);
  if (rows.length > 1) {
    throw autoError(
      'Weekly Notification admission identity is duplicated',
      'LARK_WEEKLY_EXECUTIVE_AUTO_ADMISSION_DUPLICATE',
    );
  }
  if (rows.length === 0) {
    rows = await guardedCreateExactRow({
      repository: input.repository,
      syncEngine: input.syncEngine,
      workStore: input.workStore,
      workKey: input.workKey,
      phase: CREATE_PHASES.admission,
      tableId: aiRunsTableId,
      keyField: 'ai_run_key',
      keyValue: input.admission.aiRunKey,
      row: input.admission.fields,
      unknownCode: 'LARK_WEEKLY_EXECUTIVE_AUTO_ADMISSION_CREATE_OUTCOME_UNKNOWN',
    });
  }
  assertAdmissionRow(rows[0].fields, input.admission.fields);
  return rows[0];
}

async function guardedCreateExactRow(input) {
  const prior = await input.workStore.loadPhase({ workKey: input.workKey, phase: input.phase });
  if (prior?.state?.attempted === true) {
    const recovered = exactRows(await input.repository.listByFieldValues(
      input.tableId,
      input.keyField,
      [input.keyValue],
    ), input.keyValue);
    if (recovered.length !== 1) {
      throw autoError(
        'Remote row create outcome is unknown; blind recreate is forbidden',
        input.unknownCode,
        { matchCount: recovered.length },
      );
    }
    if (prior.complete !== true) {
      await input.workStore.savePhase({
        workKey: input.workKey,
        phase: input.phase,
        state: { attempted: true, identitySha256: sha256(input.keyValue) },
        expectedItems: 1,
        processedItems: 1,
        complete: true,
      });
    }
    return recovered;
  }

  const plan = await input.syncEngine.planByKey({
    repository: input.repository,
    tableId: input.tableId,
    keyField: input.keyField,
    rows: [input.row],
  });
  if (plan.createRows.length !== 1 || plan.updateRows.length !== 0 || plan.skipped !== 0) {
    throw autoError(
      'Automatic Weekly row create plan is not exactly one create',
      'LARK_WEEKLY_EXECUTIVE_AUTO_CREATE_PLAN_INVALID',
    );
  }
  await input.workStore.savePhase({
    workKey: input.workKey,
    phase: input.phase,
    state: { attempted: true, identitySha256: sha256(input.keyValue) },
    expectedItems: 1,
    processedItems: 0,
    complete: false,
  });
  let result;
  try {
    result = await input.syncEngine.executePlan(plan);
  } catch (cause) {
    throw autoError(
      'Remote row create outcome is unknown; blind recreate is forbidden',
      input.unknownCode,
      {},
      cause,
    );
  }
  if (result.created !== 1 || result.updated !== 0) {
    throw autoError(
      'Automatic Weekly row was not created exactly once',
      'LARK_WEEKLY_EXECUTIVE_AUTO_CREATE_FAILED',
    );
  }
  const rows = exactRows(await input.repository.listByFieldValues(
    input.tableId,
    input.keyField,
    [input.keyValue],
  ), input.keyValue);
  if (rows.length !== 1) {
    throw autoError(
      'Automatic Weekly row readback is not exact',
      input.unknownCode,
      { matchCount: rows.length },
    );
  }
  await input.workStore.savePhase({
    workKey: input.workKey,
    phase: input.phase,
    state: { attempted: true, identitySha256: sha256(input.keyValue) },
    expectedItems: 1,
    processedItems: 1,
    complete: true,
  });
  return rows;
}

function assertAdmissionRow(observed, expected) {
  const fields = [
    'ai_run_key', 'report_id', 'template_version', 'scope_type', 'channel_key',
    'generation_status', 'dedupe_key', 'source_report_ids_json', 'insight_summary',
    'strengths', 'weaknesses', 'recommendations', 'period_start', 'period_end',
  ];
  const drift = fields.filter((field) => (
    String(scalar(observed?.[field]) ?? '') !== String(scalar(expected?.[field]) ?? '')
  ));
  if (readBoolean(observed?.notification_eligible) !== true) drift.push('notification_eligible');
  if (readBoolean(observed?.preview_mode) !== false) drift.push('preview_mode');
  if (optionalText(scalar(observed?.failure_code)) !== null) drift.push('failure_code');
  if (drift.length > 0) {
    throw autoError(
      'Weekly Notification admission row drifted from the generated Fresh authority',
      'LARK_WEEKLY_EXECUTIVE_AUTO_ADMISSION_DRIFT',
      { drift: [...new Set(drift)] },
    );
  }
}

async function verifyAutomationState(client, env = {}) {
  const response = await client.requestBitableJson(
    `/open-apis/bitable/v1/apps/${encodeURIComponent(client.appToken)}/workflows`,
    { method: 'GET' },
  );
  const workflows = response?.data?.workflows ?? response?.data?.items ?? response?.workflows ?? [];
  const ai = exactWorkflow(workflows, AI_TITLE);
  const notification = exactWorkflow(workflows, NOTIFICATION_TITLE);
  const expectedAi = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS
    .find((item) => item.title === AI_TITLE);
  const expectedNotification = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_AUTOMATIONS
    .find((item) => item.title === NOTIFICATION_TITLE);
  const aiStatus = requireText(ai.status ?? ai.state, 'AI Automation status').toLowerCase();
  const notificationStatus = requireText(
    notification.status ?? notification.state,
    'Notification Automation status',
  ).toLowerCase();
  const observedAiHash = sha256(workflowId(ai));
  const observedNotificationHash = sha256(workflowId(notification));
  const expectedAiHash = readWorkflowIdentityHash(
    env.MKT_LARK_AI_MATERIALIZATION_WORKFLOW_ID_SHA256,
    expectedAi?.workflowIdSha256,
    'MKT_LARK_AI_MATERIALIZATION_WORKFLOW_ID_SHA256',
  );
  const expectedNotificationHash = readWorkflowIdentityHash(
    env.MKT_LARK_NOTIFICATION_WORKFLOW_ID_SHA256,
    expectedNotification?.workflowIdSha256,
    'MKT_LARK_NOTIFICATION_WORKFLOW_ID_SHA256',
  );
  if (observedAiHash !== expectedAiHash || !ACTIVE.has(aiStatus)) {
    throw autoError(
      [
        'Automatic Weekly Executive requires the exact active AI Materialization Automation',
        `(observed_sha256=${observedAiHash}, expected_sha256=${expectedAiHash}, status=${aiStatus})`,
      ].join(' '),
      'LARK_WEEKLY_EXECUTIVE_AUTO_AI_AUTOMATION_INVALID',
      {
        observedWorkflowIdSha256: observedAiHash,
        expectedWorkflowIdSha256: expectedAiHash,
        status: aiStatus,
      },
    );
  }
  if (observedNotificationHash !== expectedNotificationHash
      || !INACTIVE.has(notificationStatus)) {
    throw autoError(
      [
        'Base Notification Automation must remain inactive while D1 exact-once Runtime is automatic',
        `(observed_sha256=${observedNotificationHash},`,
        `expected_sha256=${expectedNotificationHash}, status=${notificationStatus})`,
      ].join(' '),
      'LARK_WEEKLY_EXECUTIVE_AUTO_BASE_NOTIFICATION_AUTOMATION_UNSAFE',
      {
        observedWorkflowIdSha256: observedNotificationHash,
        expectedWorkflowIdSha256: expectedNotificationHash,
        status: notificationStatus,
      },
    );
  }
  return true;
}

function readWorkflowIdentityHash(value, fallback, fieldName) {
  const candidate = optionalText(value) ?? fallback;
  if (!/^[a-f0-9]{64}$/u.test(String(candidate ?? ''))) {
    throw autoError(
      `${fieldName} must be a lowercase SHA-256 hex digest`,
      'LARK_WEEKLY_EXECUTIVE_AUTO_WORKFLOW_IDENTITY_CONFIG_INVALID',
      { fieldName },
    );
  }
  return candidate;
}

function assertAutomaticJob(body, config) {
  if (body.type !== JOB_TYPES.LARK_NOTIFICATION_SEND
      || body.trigger !== JOB_TRIGGERS.LARK_NOTIFICATION_RUNTIME
      || body.automaticWeekly !== true
      || body.scheduleCadence !== 'weekly') {
    throw autoError(
      'Automatic Weekly Executive Queue payload is invalid',
      'LARK_WEEKLY_EXECUTIVE_AUTO_JOB_INVALID',
    );
  }
  if (!config?.flags?.runtimeEnabled || !config?.flags?.sendEnabled || !config?.flags?.mirrorEnabled
      || config.mode !== LARK_NOTIFICATION_RUNTIME_MODES.RUNTIME) {
    throw autoError(
      'Automatic Weekly Executive Notification Runtime is not active',
      'LARK_WEEKLY_EXECUTIVE_AUTO_RUNTIME_DISABLED',
    );
  }
}

function resolveAuthorityGeneratedAt(reportBundles) {
  const values = reportBundles
    .map((bundle) => Number(bundle?.payload?.generatedAt))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    throw autoError(
      'Weekly Executive source Report generated_at is missing',
      'LARK_WEEKLY_EXECUTIVE_AUTO_SOURCE_INVALID',
    );
  }
  return Math.max(...values);
}

function throwPendingOrTerminal(input) {
  if (input.mainQueueAttempts >= input.maximumAttempts) {
    throw autoError(input.message, input.terminalCode, input.details);
  }
  throw transientError(input.message, {
    code: input.code,
    details: input.details,
  });
}

function readMaximumAttempts(env = {}) {
  const value = env.MKT_WEEKLY_NOTIFICATION_MAX_QUEUE_ATTEMPTS;
  if (value === null || value === undefined || value === '') return DEFAULT_MAX_QUEUE_ATTEMPTS;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 2 || number > 10) {
    throw autoError(
      'MKT_WEEKLY_NOTIFICATION_MAX_QUEUE_ATTEMPTS must be an integer from 2 to 10',
      'LARK_WEEKLY_EXECUTIVE_AUTO_CONFIG_INVALID',
    );
  }
  return number;
}

function requireStableOperation(value) {
  if (!value?.stable || !value.operationId || !value.workKey
      || !Number.isSafeInteger(value.generation)
      || !Number.isSafeInteger(value.originalRequestedAt)) {
    throw autoError(
      'Automatic Weekly Executive requires stable Queue identity',
      'LARK_WEEKLY_EXECUTIVE_AUTO_JOB_INVALID',
    );
  }
  return value;
}

function exactRows(rows, key) {
  return rows.filter((row) => String(scalar(row?.fields?.ai_run_key) ?? '') === key);
}

function exactWorkflow(workflows, title) {
  const matches = workflows.filter((item) => String(item?.title ?? item?.name ?? '').trim() === title);
  if (matches.length !== 1) {
    throw autoError(
      `Automatic Weekly Executive requires one exact Automation: ${title}`,
      'LARK_WEEKLY_EXECUTIVE_AUTO_AUTOMATION_IDENTITY_INVALID',
      { count: matches.length },
    );
  }
  return matches[0];
}

function workflowId(workflow) {
  return requireText(workflow.workflow_id ?? workflow.workflowId ?? workflow.id, 'workflow_id');
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

function readBoolean(value) {
  const item = scalar(value);
  if (item === true || item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === false || item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  return null;
}

function requireDateOnly(value, fieldName) {
  const text = requireText(value, fieldName);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) {
    throw autoError(`${fieldName} must be date-only`, 'LARK_WEEKLY_EXECUTIVE_AUTO_JOB_INVALID');
  }
  return text;
}

function requireText(value, fieldName) {
  const text = optionalText(value);
  if (!text) {
    throw autoError(`${fieldName} is required`, 'LARK_WEEKLY_EXECUTIVE_AUTO_INPUT_REQUIRED');
  }
  return text;
}

function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}

function readPositiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw autoError(
      `${fieldName} must be a positive integer`,
      'LARK_WEEKLY_EXECUTIVE_AUTO_INPUT_REQUIRED',
    );
  }
  return number;
}

function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}

function autoError(message, code, details = {}, cause = undefined) {
  return permanentError(message, { code, details, cause });
}
