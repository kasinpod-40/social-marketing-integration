import { createHash } from 'node:crypto';

import {
  renderLarkWeeklyExecutiveChannelSections,
  serializeLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkExecutiveNotificationMessage,
} from '../../packages/application/src/notifications/deliver-lark-executive-notification.js';
import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../../packages/config/src/lark-notification-runtime-config.js';
import {
  resolveLarkNotificationReviewedDestination,
} from '../../packages/connectors/src/lark/lark-notification-reviewed-destination.js';
import {
  LARK_WEEKLY_7D_EXECUTIVE_DECISION_AI_PREFIX,
  assertLarkWeekly7dExecutiveDecisionGenerated,
  isLarkWeekly7dExecutiveDecisionIdentity,
} from './lark-weekly-7d-executive-decision-preview.js';
import {
  LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
  LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
} from './lark-weekly-7d-notification-admission.js';
import {
  LARK_WEEKLY_7D_NOTIFICATION_LOCKED_FACTUAL_REPORT_SHA256,
  LARK_WEEKLY_7D_NOTIFICATION_LOCKED_PLATFORM_SCOPES,
  LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_BYTES,
  LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256,
  LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256,
  loadLockedFreshWeekly7dDecisionEvidence,
} from './lark-weekly-7d-retained-decision-evidence.js';

export {
  LARK_WEEKLY_7D_NOTIFICATION_LOCKED_FACTUAL_REPORT_SHA256,
  LARK_WEEKLY_7D_NOTIFICATION_LOCKED_PLATFORM_SCOPES,
  LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_BYTES,
  LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256,
  LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256,
};

const ADMISSION_PREFIX = 'notification-weekly-7d:';
const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_SCOPE = 'executive';
const SOURCE_CHANNEL = 'executive';
const SOURCE_PROFILE = 'integration_workspace';
const PROVEN_NOTIFICATION_REASON = 'controlled_uat';

export async function loadFreshWeekly7dExecutiveDecisionNotificationSource(input = {}) {
  const client = requireClient(input.client);
  const retained = await loadLockedFreshWeekly7dDecisionEvidence({
    repository: input.repository,
    aiRunsTableId: input.aiRunsTableId,
    decisionEvidenceRoot: input.decisionEvidenceRoot,
    now: input.now,
  });
  const admission = buildFreshWeekly7dExecutiveDecisionNotificationAdmission({
    sourceRecord: retained.sourceRecord,
    retainedSummary: retained.retainedSummary,
    sourceAuthorities: retained.reportAuthority.authorities,
  });
  if (admission.reviewedMessageSha256
      !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256
      || admission.reviewedMessageBytes
        !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_BYTES) {
    throw sourceError(
      'Weekly Notification message differs from the accepted reviewed Fresh v4 message',
      'LARK_WEEKLY_7D_NOTIFICATION_REVIEWED_MESSAGE_DRIFT',
      {
        expectedMessageSha256: LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256,
        observedMessageSha256: admission.reviewedMessageSha256,
        expectedMessageBytes: LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_BYTES,
        observedMessageBytes: admission.reviewedMessageBytes,
      },
    );
  }

  const destination = await resolveLarkNotificationReviewedDestination({
    client,
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });
  return deepFreeze({
    ...admission,
    sourceAuthorities: retained.reportAuthority.authorities,
    sourceReportSettingKeys: retained.reportAuthority.reportSettingKeys,
    retainedDecisionEvidence: {
      factualReportSha256: retained.retainedSummary.factualReportSha256,
      messageSha256: retained.retainedSummary.messageSha256,
      messageBytes: retained.retainedSummary.messageBytes,
      qualityGatePassed: retained.retainedSummary.qualityGate.passed,
    },
    reviewedDestination: {
      name: destination.name,
      destinationKeyHash: destination.destinationKeyHash,
      resolved: true,
    },
  });
}

export function buildFreshWeekly7dExecutiveDecisionNotificationAdmission(input = {}) {
  const source = normalizeRecord(input.sourceRecord);
  const sourceAiRunKey = requireText(scalar(source.fields.ai_run_key), 'source.ai_run_key');
  if (!sourceAiRunKey.startsWith(LARK_WEEKLY_7D_EXECUTIVE_DECISION_AI_PREFIX)
      || !isLarkWeekly7dExecutiveDecisionIdentity(sourceAiRunKey)) {
    throw sourceError(
      'Notification Admission requires a Fresh Weekly Executive Decision v4 identity',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
    );
  }

  const authority = resolveBuildAuthority(source, input);
  const sourceDedupeKey = requireHash(scalar(source.fields.dedupe_key), 'source.dedupe_key');
  const metricSummaryJson = requireText(scalar(source.fields.metric_summary_json), 'metric_summary_json');
  const identity = sha256(JSON.stringify({
    contractVersion: LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
    templateVersion: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds: authority.sourceReportIds,
    factualReportSha256: authority.factualReportSha256,
    metricSummarySha256: sha256(metricSummaryJson),
    acceptedOutputsSha256: sha256(JSON.stringify(authority.outputs)),
    deliveryOutputsSha256: sha256(JSON.stringify(authority.deliveryOutputs)),
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
    source_report_ids_json: JSON.stringify(authority.sourceReportIds),
    ...authority.deliveryOutputs,
  });

  const message = buildLarkExecutiveNotificationMessage({
    aiRun: {
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
      insightSummary: authority.deliveryOutputs.insight_summary,
      strengths: authority.deliveryOutputs.strengths,
      weaknesses: authority.deliveryOutputs.weaknesses,
      recommendations: authority.deliveryOutputs.recommendations,
    },
    snapshot: {
      reportId: aiRunKey,
      reportSettingKey: authority.sourceAuthorities[0]?.reportSettingKey
        ?? 'weekly_7d_read_only_preview',
      customerProfile: SOURCE_PROFILE,
      periodStart: authority.period.periodStart,
      periodEnd: authority.period.periodEnd,
    },
    settings: {
      enabled: true,
      aiEnabled: true,
      notificationEnabled: true,
      groupId: '[READ_ONLY_PREVIEW_DESTINATION]',
      destinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
    },
  });
  const reviewedMessageSha256 = sha256(message.text);
  const reviewedMessageBytes = Buffer.byteLength(message.text, 'utf8');
  if (authority.retainedMessage !== null && message.text !== authority.retainedMessage) {
    throw sourceError(
      'Retained Weekly Notification message does not reproduce through the shared renderer',
      'LARK_WEEKLY_7D_NOTIFICATION_REVIEWED_MESSAGE_DRIFT',
      {
        retainedMessageSha256: sha256(authority.retainedMessage),
        renderedMessageSha256: reviewedMessageSha256,
      },
    );
  }

  return deepFreeze({
    sourceRecord: source,
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds: authority.sourceReportIds,
    sourceAuthorities: authority.sourceAuthorities,
    sourceStateIdentity: sourceAiRunKey,
    factualReport: authority.factualReport,
    factualReportSha256: authority.factualReportSha256,
    synthesis: authority.synthesis,
    aiRunKey,
    reportId: aiRunKey,
    dedupeKey: fields.dedupe_key,
    notificationAttemptKey: `${aiRunKey}::${fields.dedupe_key}`,
    templateVersion: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    evidence: authority.evidence,
    qualityGate: authority.qualityGate,
    acceptedOutputs: authority.outputs,
    deliveryOutputs: authority.deliveryOutputs,
    reviewedMessage: message,
    reviewedMessageSha256,
    reviewedMessageBytes,
    fields,
  });
}

function resolveBuildAuthority(source, input) {
  if (input.synthesis) {
    const synthesis = requireObject(input.synthesis, 'synthesis');
    if (requireText(scalar(source.fields.ai_run_key), 'source.ai_run_key') !== synthesis.aiRunKey) {
      throw sourceError(
        'Notification Admission source identity does not match the supplied synthesis',
        'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
      );
    }
    const accepted = assertLarkWeekly7dExecutiveDecisionGenerated(source.fields, synthesis);
    return deepFreeze({
      synthesis,
      factualReport: synthesis.factualReport,
      factualReportSha256: synthesis.factualReportSha256,
      sourceReportIds: Object.freeze([...synthesis.sourceReportIds].sort()),
      sourceAuthorities: Object.freeze([]),
      period: synthesis.factualReport.period,
      evidence: synthesis.evidence.evidence,
      qualityGate: accepted.qualityGate,
      outputs: accepted.outputs,
      deliveryOutputs: buildDeliveryOutputs(
        accepted.outputs,
        renderLarkWeeklyExecutiveChannelSections(synthesis.factualReport),
      ),
      retainedMessage: null,
    });
  }

  if (input.retainedSummary) {
    const summary = requireObject(input.retainedSummary, 'retainedSummary');
    const outputs = readOutputs(source.fields);
    const period = normalizePeriod(summary.period);
    const sourceReportIds = parseSourceReportIds(source.fields.source_report_ids_json);
    const retainedMessage = requireText(summary.messagePreview, 'retainedSummary.messagePreview');
    const composedInsight = extractRetainedOverviewBody(retainedMessage, period, outputs);
    return deepFreeze({
      synthesis: null,
      factualReport: null,
      factualReportSha256: requireHash(summary.factualReportSha256, 'factualReportSha256'),
      sourceReportIds,
      sourceAuthorities: Object.freeze([...(input.sourceAuthorities ?? [])]),
      period,
      evidence: requireObject(summary.evidence, 'retainedSummary.evidence'),
      qualityGate: requireObject(summary.qualityGate, 'retainedSummary.qualityGate'),
      outputs,
      deliveryOutputs: {
        insight_summary: composedInsight,
        strengths: outputs.strengths,
        weaknesses: outputs.weaknesses,
        recommendations: outputs.recommendations,
      },
      retainedMessage,
    });
  }

  const factualReport = requireObject(input.factualReport, 'factualReport');
  const evidence = requireObject(input.evidence, 'evidence');
  const qualityGate = requireObject(input.qualityGate, 'qualityGate');
  const outputs = requireObject(input.outputs, 'outputs');
  if (qualityGate.passed !== true) {
    throw sourceError(
      'Notification Admission requires a passed Executive Decision Quality Gate',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_QUALITY_FAILED',
    );
  }
  const sourceReportIds = parseSourceReportIds(source.fields.source_report_ids_json);
  if (JSON.stringify(sourceReportIds) !== JSON.stringify([...factualReport.sourceReportIds].sort())) {
    throw sourceError(
      'Retained Fresh source Report identities differ from the reconstructed factual report',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_REPORT_DRIFT',
    );
  }
  return deepFreeze({
    synthesis: null,
    factualReport,
    factualReportSha256: sha256(serializeLarkWeeklyExecutiveFactualReport(factualReport)),
    sourceReportIds,
    sourceAuthorities: Object.freeze([]),
    period: factualReport.period,
    evidence,
    qualityGate,
    outputs,
    deliveryOutputs: buildDeliveryOutputs(outputs, renderLarkWeeklyExecutiveChannelSections(factualReport)),
    retainedMessage: null,
  });
}

function buildDeliveryOutputs(outputsInput, sections) {
  const outputs = readOutputs(outputsInput);
  return Object.freeze({
    insight_summary: [
      outputs.insight_summary,
      '',
      ...sections.flatMap((section) => [section.heading, ...section.lines, '']),
    ].join('\n').trim(),
    strengths: outputs.strengths,
    weaknesses: outputs.weaknesses,
    recommendations: outputs.recommendations,
  });
}

function extractRetainedOverviewBody(message, period, outputsInput) {
  const outputs = readOutputs(outputsInput);
  const prefix = `📊 Social MKT Weekly Executive Report — 7D\nช่วง ${period.periodStart} ถึง ${period.periodEnd}\n\nภาพรวมสัปดาห์นี้\n`;
  const suffix = `\n\n🏆 สิ่งที่เด่นที่สุดประจำสัปดาห์\n${outputs.strengths}\n\n⚠️ สิ่งที่ต้องจับตา\n${outputs.weaknesses}\n\n🎯 สิ่งที่ควรทำสัปดาห์หน้า\n${outputs.recommendations}`;
  if (!message.startsWith(prefix) || !message.endsWith(suffix)) {
    throw sourceError(
      'Retained reviewed message structure differs from the shared business-first renderer',
      'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_EVIDENCE_INVALID',
    );
  }
  const body = message.slice(prefix.length, message.length - suffix.length);
  if (!body.startsWith(outputs.insight_summary)
      || body === outputs.insight_summary
      || !body.includes('\n\n')) {
    throw sourceError(
      'Retained reviewed message does not contain the accepted insight plus full channel sections',
      'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_EVIDENCE_INVALID',
    );
  }
  return body;
}

function normalizePeriod(value) {
  const period = requireObject(value, 'period');
  return Object.freeze({
    periodStart: requireDate(period.periodStart ?? period.period_start, 'periodStart'),
    periodEnd: requireDate(period.periodEnd ?? period.period_end, 'periodEnd'),
    compareStart: optionalDate(period.compareStart ?? period.compare_start),
    compareEnd: optionalDate(period.compareEnd ?? period.compare_end),
    comparisonMode: requireText(period.comparisonMode ?? period.comparison_mode ?? 'none', 'comparisonMode'),
    windowDays: Number(period.windowDays ?? period.window_days ?? 7),
  });
}
function parseSourceReportIds(value) {
  try {
    const parsed = JSON.parse(requireText(scalar(value), 'source_report_ids_json'));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('invalid');
    const rows = parsed.map((item) => requireText(item, 'source_report_id'));
    if (new Set(rows).size !== rows.length) throw new Error('duplicate');
    return Object.freeze(rows.sort());
  } catch {
    throw sourceError(
      'Fresh Weekly Executive Decision source Report identities are invalid',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
    );
  }
}
function readOutputs(fields = {}) {
  return Object.freeze({
    insight_summary: requireText(scalar(fields.insight_summary), 'insight_summary'),
    strengths: requireText(scalar(fields.strengths), 'strengths'),
    weaknesses: requireText(scalar(fields.weaknesses), 'weaknesses'),
    recommendations: requireText(scalar(fields.recommendations), 'recommendations'),
  });
}
function normalizeRecord(record) {
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw new TypeError('sourceRecord is required');
  if (!record.fields || typeof record.fields !== 'object' || Array.isArray(record.fields)) throw new TypeError('sourceRecord.fields is required');
  return Object.freeze({ recordId: record.recordId ?? record.record_id ?? null, fields: record.fields });
}
function requireClient(client) {
  if (typeof client?.requestBitableJson !== 'function') throw new TypeError('client.requestBitableJson is required');
  return client;
}
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} is required`);
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
    for (const key of ['text', 'name', 'value']) if (value[key] !== undefined) return scalar(value[key]);
  }
  return value;
}
function requireText(value, label) {
  const text = value === null || value === undefined ? '' : String(scalar(value) ?? '').trim();
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}
function requireHash(value, label) {
  const text = requireText(value, label);
  if (!HASH.test(text)) throw new TypeError(`${label} must be SHA-256 hex`);
  return text;
}
function requireDate(value, label) {
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text)) throw new TypeError(`${label} must be date-only`);
  return text;
}
function optionalDate(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireDate(value, 'optionalDate');
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
