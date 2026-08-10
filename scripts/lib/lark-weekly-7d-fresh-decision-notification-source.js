import { createHash } from 'node:crypto';

import {
  buildLarkWeeklyExecutiveFactualReport,
  renderLarkWeeklyExecutiveChannelSections,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkExecutiveNotificationMessage,
} from '../../packages/application/src/notifications/deliver-lark-executive-notification.js';
import {
  buildLarkNativeAiWeekly7dControlledUat,
} from '../../packages/application/src/reports/build-lark-native-ai-weekly-7d-controlled-uat.js';
import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../../packages/config/src/lark-notification-runtime-config.js';
import {
  collectLarkNativeAiWeekly7dControlledUatSource,
} from './lark-native-ai-weekly-7d-controlled-uat.js';
import {
  LARK_WEEKLY_7D_EXECUTIVE_DECISION_AI_PREFIX,
  assertFreshWeekly7dDecisionPeriod,
  assertLarkWeekly7dExecutiveDecisionGenerated,
  buildLarkWeekly7dExecutiveDecisionSynthesis,
  isLarkWeekly7dExecutiveDecisionIdentity,
} from './lark-weekly-7d-executive-decision-preview.js';
import {
  LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
  LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
} from './lark-weekly-7d-notification-admission.js';

const ADMISSION_PREFIX = 'notification-weekly-7d:';
const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_SCOPE = 'executive';
const SOURCE_CHANNEL = 'executive';
const PROVEN_NOTIFICATION_REASON = 'controlled_uat';

export async function loadFreshWeekly7dExecutiveDecisionNotificationSource(input = {}) {
  const client = requireClient(input.client);
  const repository = requireRepository(input.repository);
  const tableId = requireText(input.aiRunsTableId, 'aiRunsTableId');

  const collected = await collectLarkNativeAiWeekly7dControlledUatSource({ client });
  assertFreshWeekly7dDecisionPeriod(collected.targetPeriod, input.now ?? Date.now());
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
  const factualReport = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: collected.targetPeriod,
    reportBundles: collected.reportBundles,
  });
  const synthesis = buildLarkWeekly7dExecutiveDecisionSynthesis({
    sourceRecord: Object.freeze({ recordId: null, fields: seed.executiveRow }),
    factualReport,
  });
  if (!isLarkWeekly7dExecutiveDecisionIdentity(synthesis.aiRunKey)) {
    throw sourceError(
      'Fresh Weekly Executive Decision source identity is invalid',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
    );
  }

  const rows = await repository.listByFieldValues(tableId, 'ai_run_key', [synthesis.aiRunKey]);
  const matches = rows.filter((record) => scalar(record?.fields?.ai_run_key) === synthesis.aiRunKey);
  if (matches.length !== 1) {
    throw sourceError(
      'Expected exactly one generated Fresh Weekly Executive Decision source row',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
      { matchCount: matches.length },
    );
  }

  return buildFreshWeekly7dExecutiveDecisionNotificationAdmission({
    sourceRecord: matches[0],
    synthesis,
  });
}

export function buildFreshWeekly7dExecutiveDecisionNotificationAdmission(input = {}) {
  const source = normalizeRecord(input.sourceRecord);
  const synthesis = requireObject(input.synthesis, 'synthesis');
  const sourceAiRunKey = requireText(scalar(source.fields.ai_run_key), 'source.ai_run_key');
  if (!sourceAiRunKey.startsWith(LARK_WEEKLY_7D_EXECUTIVE_DECISION_AI_PREFIX)
      || sourceAiRunKey !== synthesis.aiRunKey
      || !isLarkWeekly7dExecutiveDecisionIdentity(sourceAiRunKey)) {
    throw sourceError(
      'Notification Admission requires the exact Fresh Weekly Executive Decision v4 identity',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
    );
  }

  const accepted = assertLarkWeekly7dExecutiveDecisionGenerated(source.fields, synthesis);
  const sourceDedupeKey = requireHash(scalar(source.fields.dedupe_key), 'source.dedupe_key');
  const sourceReportIds = Object.freeze([...synthesis.sourceReportIds].sort());
  const metricSummaryJson = requireText(scalar(source.fields.metric_summary_json), 'metric_summary_json');
  const outputs = accepted.outputs;
  const sections = renderLarkWeeklyExecutiveChannelSections(synthesis.factualReport);
  const composedInsight = [
    outputs.insight_summary,
    '',
    ...sections.flatMap((section) => [section.heading, ...section.lines, '']),
  ].join('\n').trim();
  const deliveryOutputs = Object.freeze({
    insight_summary: composedInsight,
    strengths: outputs.strengths,
    weaknesses: outputs.weaknesses,
    recommendations: outputs.recommendations,
  });

  const identity = sha256(JSON.stringify({
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    templateVersion: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds,
    factualReportSha256: synthesis.factualReportSha256,
    metricSummarySha256: sha256(metricSummaryJson),
    acceptedOutputsSha256: sha256(JSON.stringify(outputs)),
    deliveryOutputsSha256: sha256(JSON.stringify(deliveryOutputs)),
  }));
  const aiRunKey = `${ADMISSION_PREFIX}${identity}`;
  const fields = structuredClone(source.fields);
  Object.assign(fields, {
    ai_run_key: aiRunKey,
    report_id: aiRunKey,
    template_version: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    scope_type: SOURCE_SCOPE,
    channel_key: SOURCE_CHANNEL,
    capability: 'cross_channel',
    notification_eligible: true,
    notification_reason: PROVEN_NOTIFICATION_REASON,
    preview_mode: false,
    generation_status: 'generated',
    sent_to_group: false,
    sent_at: null,
    cooldown_until: null,
    failure_code: null,
    dedupe_key: sha256(`${sourceDedupeKey}:${LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION}:${identity}`),
    source_report_ids_json: JSON.stringify(sourceReportIds),
    ...deliveryOutputs,
  });

  const message = buildLarkExecutiveNotificationMessage({
    aiRun: Object.freeze({
      aiRunKey,
      reportId: aiRunKey,
      templateVersion: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
      scopeType: SOURCE_SCOPE,
      generationStatus: 'generated',
      notificationEligible: true,
      previewMode: false,
      sentToGroup: false,
      dedupeKey: fields.dedupe_key,
      windowDays: 7,
      readinessStatus: requireText(scalar(source.fields.readiness_status), 'readiness_status'),
      severity: requireText(scalar(source.fields.severity), 'severity'),
      insightSummary: deliveryOutputs.insight_summary,
      strengths: deliveryOutputs.strengths,
      weaknesses: deliveryOutputs.weaknesses,
      recommendations: deliveryOutputs.recommendations,
    }),
    snapshot: Object.freeze({
      reportId: aiRunKey,
      reportSettingKey: 'weekly_7d_read_only_preview',
      customerProfile: 'integration_workspace',
      periodStart: synthesis.factualReport.period.periodStart,
      periodEnd: synthesis.factualReport.period.periodEnd,
    }),
    settings: Object.freeze({
      enabled: true,
      aiEnabled: true,
      notificationEnabled: true,
      groupId: '[READ_ONLY_PREVIEW_DESTINATION]',
      destinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
    }),
  });

  return deepFreeze({
    sourceRecord: source,
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds,
    sourceStateIdentity: sourceAiRunKey,
    factualReport: synthesis.factualReport,
    factualReportSha256: synthesis.factualReportSha256,
    synthesis,
    aiRunKey,
    reportId: aiRunKey,
    dedupeKey: fields.dedupe_key,
    notificationAttemptKey: `${aiRunKey}::${fields.dedupe_key}`,
    templateVersion: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    evidence: synthesis.evidence.evidence,
    qualityGate: accepted.qualityGate,
    acceptedOutputs: outputs,
    deliveryOutputs,
    reviewedMessage: message,
    reviewedMessageSha256: sha256(message.text),
    reviewedMessageBytes: Buffer.byteLength(message.text, 'utf8'),
    fields,
  });
}

function resolveAuthorityGeneratedAt(reportBundles) {
  const values = reportBundles
    .map((bundle) => Number(bundle?.payload?.generatedAt))
    .filter((value) => Number.isFinite(value) && value > 0);
  if (values.length === 0) {
    throw sourceError(
      'Fresh Weekly Executive Decision requires source Report generated_at authority',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
    );
  }
  return Math.max(...values);
}

function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) {
    throw sourceError('sourceRecord is required', 'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID');
  }
  const fields = record.fields;
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    throw sourceError('sourceRecord.fields is required', 'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID');
  }
  return Object.freeze({ recordId: record.recordId ?? record.record_id ?? null, fields });
}
function requireClient(client) {
  if (typeof client?.listTables !== 'function') {
    throw new TypeError('client is required');
  }
  return client;
}
function requireRepository(repository) {
  if (typeof repository?.listByFieldValues !== 'function') {
    throw new TypeError('repository is required');
  }
  return repository;
}
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
function scalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return scalar(value[0]);
    return value.map(scalar).join('');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) {
      if (value[key] !== undefined) return scalar(value[key]);
    }
  }
  return value;
}
function requireText(value, label) {
  const normalized = value === null || value === undefined ? '' : String(value).trim();
  if (!normalized) {
    throw sourceError(`${label} is required`, 'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID', { label });
  }
  return normalized;
}
function requireHash(value, label) {
  const normalized = requireText(value, label);
  if (!HASH.test(normalized)) {
    throw sourceError(`${label} must be SHA-256`, 'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID', { label });
  }
  return normalized;
}
function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
function sourceError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dFreshDecisionNotificationSourceError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
