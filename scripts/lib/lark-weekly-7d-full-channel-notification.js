import { createHash } from 'node:crypto';

import {
  LARK_WEEKLY_EXECUTIVE_FACTUAL_REPORT_SHAPE,
  parseLarkWeeklyExecutiveFactualReport,
  renderLarkWeeklyExecutiveChannelSections,
  serializeLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  assertLarkWeekly7dFullChannelAiGenerated,
  buildLarkWeekly7dFullChannelAiSynthesis,
  isLarkWeekly7dFullChannelAiIdentity,
} from './lark-weekly-7d-full-channel-ai-synthesis.js';
import {
  LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
  buildLarkWeekly7dNotificationAdmissionRow,
} from './lark-weekly-7d-notification-admission.js';

export const LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_CONTRACT_VERSION =
  'lark_weekly_7d_full_channel_notification_v2';
export const LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_CONFIRMATION = Object.freeze({
  envName: 'CONFIRM_LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION',
  value: 'SEND_ONE_CORRECTED_FULL_CHANNEL_WEEKLY_7D',
});
export const LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_PREFIX =
  'notification-weekly-7d:full-channel:';

const HASH = /^[a-f0-9]{64}$/u;

export function assertLarkWeekly7dFullChannelNotificationConfirmation(env = {}) {
  const confirmation = LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_CONFIRMATION;
  if (env?.[confirmation.envName] !== confirmation.value) {
    throw fullChannelError(
      `Full-channel Weekly 7D Notification requires ${confirmation.envName}=${confirmation.value}`,
      'LARK_WEEKLY_7D_FULL_CHANNEL_CONFIRMATION_REQUIRED',
      { envName: confirmation.envName },
    );
  }
  return true;
}

export function assertLarkWeekly7dFullChannelSourceAlignment(input = {}) {
  const expectedReportIds = normalizeIds(input.expectedSourceReportIds, 'expectedSourceReportIds');
  const collectedReportIds = normalizeIds(input.collectedSourceReportIds, 'collectedSourceReportIds');
  if (JSON.stringify(expectedReportIds) !== JSON.stringify(collectedReportIds)) {
    throw fullChannelError(
      'Full-channel factual source Report identities no longer match the accepted V9 AI source',
      'LARK_WEEKLY_7D_FULL_CHANNEL_SOURCE_DRIFT',
      { expectedCount: expectedReportIds.length, collectedCount: collectedReportIds.length },
    );
  }
  const expectedPeriod = normalizePeriod(input.expectedPeriod, 'expectedPeriod');
  const collectedPeriod = normalizePeriod(input.collectedPeriod, 'collectedPeriod');
  if (JSON.stringify(expectedPeriod) !== JSON.stringify(collectedPeriod)) {
    throw fullChannelError(
      'Full-channel factual period no longer matches the accepted V9 AI source',
      'LARK_WEEKLY_7D_FULL_CHANNEL_PERIOD_DRIFT',
      { expectedPeriod, collectedPeriod },
    );
  }
  return Object.freeze({
    sourceReportIds: Object.freeze(expectedReportIds),
    period: expectedPeriod,
  });
}

export function buildLarkWeekly7dFullChannelNotificationRow(input = {}) {
  const base = buildLarkWeekly7dNotificationAdmissionRow(input.sourceRecord);
  const factual = parseLarkWeeklyExecutiveFactualReport(input.factualReport);
  if (factual.evidenceShape !== LARK_WEEKLY_EXECUTIVE_FACTUAL_REPORT_SHAPE
      || factual.channelCount !== 9) {
    throw fullChannelError(
      'Corrected Weekly notification requires the reviewed nine-channel factual report',
      'LARK_WEEKLY_7D_FULL_CHANNEL_FACTUAL_REPORT_INVALID',
    );
  }
  if (JSON.stringify([...factual.sourceReportIds].sort())
      !== JSON.stringify([...base.sourceReportIds].sort())) {
    throw fullChannelError(
      'Corrected Weekly factual Report identities differ from accepted V9 source Report identities',
      'LARK_WEEKLY_7D_FULL_CHANNEL_SOURCE_DRIFT',
      {
        factualReportCount: factual.sourceReportIds.length,
        acceptedReportCount: base.sourceReportIds.length,
      },
    );
  }

  const expectedSynthesis = buildLarkWeekly7dFullChannelAiSynthesis({
    sourceRecord: input.sourceRecord,
    factualReport: factual,
  });
  const synthesisRecord = requireObject(input.synthesisRecord, 'synthesisRecord');
  const synthesisFields = requireObject(synthesisRecord.fields, 'synthesisRecord.fields');
  if (readScalar(synthesisFields.ai_run_key) !== expectedSynthesis.aiRunKey
      || !isLarkWeekly7dFullChannelAiIdentity(readScalar(synthesisFields.ai_run_key))) {
    throw fullChannelError(
      'Corrected Weekly notification requires the exact generated full-channel AI synthesis identity',
      'LARK_WEEKLY_7D_FULL_CHANNEL_SYNTHESIS_IDENTITY_INVALID',
    );
  }
  const acceptedSynthesis = assertLarkWeekly7dFullChannelAiGenerated(
    synthesisFields,
    expectedSynthesis,
  );

  const factualJson = serializeLarkWeeklyExecutiveFactualReport(factual);
  const sections = renderLarkWeeklyExecutiveChannelSections(factual);
  const sourceInsight = acceptedSynthesis.outputs.insight_summary;
  const strengths = acceptedSynthesis.outputs.strengths;
  const weaknesses = acceptedSynthesis.outputs.weaknesses;
  const recommendations = acceptedSynthesis.outputs.recommendations;
  const composedInsight = [
    sourceInsight,
    '',
    ...sections.flatMap((section) => [section.heading, ...section.lines, '']),
  ].join('\n').trim();
  const factualSha256 = sha256(factualJson);
  const outputsSha256 = sha256(JSON.stringify(acceptedSynthesis.outputs));
  const identity = sha256(JSON.stringify({
    contractVersion: LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_CONTRACT_VERSION,
    sourceAiRunKey: base.sourceAiRunKey,
    sourceDedupeKey: base.sourceDedupeKey,
    synthesisAiRunKey: expectedSynthesis.aiRunKey,
    sourceReportIds: base.sourceReportIds,
    factualSha256,
    outputsSha256,
  }));
  const aiRunKey = `${LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_PREFIX}${identity}`;
  const dedupeKey = sha256([
    base.sourceDedupeKey,
    LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_CONTRACT_VERSION,
    expectedSynthesis.aiRunKey,
    factualSha256,
    identity,
  ].join(':'));
  const fields = structuredClone(base.fields);
  Object.assign(fields, {
    ai_run_key: aiRunKey,
    report_id: aiRunKey,
    template_version: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    metric_summary_json: factualJson,
    insight_summary: composedInsight,
    strengths,
    weaknesses,
    recommendations,
    dedupe_key: dedupeKey,
    notification_eligible: true,
    notification_reason: 'controlled_uat',
    preview_mode: false,
    generation_status: 'generated',
    failure_code: null,
    sent_to_group: false,
    sent_at: null,
    cooldown_until: null,
    source_report_ids_json: JSON.stringify(base.sourceReportIds),
  });
  return deepFreeze({
    sourceRecordId: base.sourceRecordId,
    sourceAiRunKey: base.sourceAiRunKey,
    sourceDedupeKey: base.sourceDedupeKey,
    synthesisAiRunKey: expectedSynthesis.aiRunKey,
    aiRunKey,
    reportId: aiRunKey,
    dedupeKey,
    notificationAttemptKey: `${aiRunKey}::${dedupeKey}`,
    sourceReportIds: Object.freeze([...base.sourceReportIds]),
    templateVersion: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    factualReportSha256: factualSha256,
    factualReport: factual,
    channelSectionCount: sections.length,
    businessFactChannelCount: factual.businessFactChannelCount,
    composedInsight,
    originalAiOutputs: Object.freeze({ sourceInsight, strengths, weaknesses, recommendations }),
    qualityGate: acceptedSynthesis.qualityGate,
    evidence: expectedSynthesis.evidence.evidence,
    fields,
  });
}

export function assertFullChannelMessage(input = {}) {
  const admission = requireObject(input.admission, 'admission');
  const text = requireText(input.messageText, 'messageText');
  const sections = renderLarkWeeklyExecutiveChannelSections(admission.factualReport);
  const invalid = [];
  if (sections.length !== 9) invalid.push('channelSectionCount');
  for (const section of sections) {
    if (!text.includes(section.heading)) invalid.push(`missing:${section.channelKey}`);
  }
  if (!text.includes(admission.originalAiOutputs.sourceInsight)) invalid.push('sourceInsight');
  if (!text.includes(admission.originalAiOutputs.strengths)) invalid.push('strengths');
  if (!text.includes(admission.originalAiOutputs.weaknesses)) invalid.push('weaknesses');
  if (!text.includes(admission.originalAiOutputs.recommendations)) invalid.push('recommendations');
  if (/report_partial|report_available|readiness_status|data_status|สถานะข้อมูล/iu.test(text)) {
    invalid.push('internalReadinessLeak');
  }
  if (invalid.length > 0) {
    throw fullChannelError(
      'Corrected Weekly full-channel message preview failed',
      'LARK_WEEKLY_7D_FULL_CHANNEL_MESSAGE_INVALID',
      { invalid },
    );
  }
  return Object.freeze({
    channelSectionCount: 9,
    businessFactChannelCount: admission.businessFactChannelCount,
    messageSha256: sha256(text),
  });
}

export function isFullChannelWeeklyIdentity(value) {
  const text = typeof value === 'string' ? value : '';
  return text.startsWith(LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_PREFIX)
    && HASH.test(text.slice(LARK_WEEKLY_7D_FULL_CHANNEL_NOTIFICATION_PREFIX.length));
}

function normalizeIds(value, label) {
  if (!Array.isArray(value) || value.length === 0) throw new TypeError(`${label} must be non-empty array`);
  const ids = value.map((item) => requireText(item, `${label}[]`));
  if (new Set(ids).size !== ids.length) throw new TypeError(`${label} must be unique`);
  return [...ids].sort();
}
function normalizePeriod(value, label) {
  const period = requireObject(value, label);
  const normalized = {
    periodStart: requireDate(period.periodStart ?? period.period_start, `${label}.periodStart`),
    periodEnd: requireDate(period.periodEnd ?? period.period_end, `${label}.periodEnd`),
    compareStart: optionalDate(period.compareStart ?? period.compare_start),
    compareEnd: optionalDate(period.compareEnd ?? period.compare_end),
    comparisonMode: optionalText(period.comparisonMode ?? period.comparison_mode) ?? 'none',
    windowDays: Number(period.windowDays ?? period.window_days ?? 7),
  };
  if (normalized.windowDays !== 7 || normalized.periodStart > normalized.periodEnd) {
    throw new TypeError(`${label} must be exact valid 7D period`);
  }
  return Object.freeze(normalized);
}
function readScalar(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    if (value.length === 0) return null;
    if (value.length === 1) return readScalar(value[0]);
    return value.map(readScalar).join('');
  }
  if (typeof value === 'object') {
    for (const key of ['text', 'name', 'value']) {
      if (value[key] !== undefined) return readScalar(value[key]);
    }
  }
  return value;
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
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function requireText(value, label) {
  const text = optionalText(value);
  if (!text) throw new TypeError(`${label} is required`);
  return text;
}
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError(`${label} must be object`);
  return value;
}
function sha256(value) {
  return createHash('sha256').update(String(value)).digest('hex');
}
function deepFreeze(value, seen = new WeakSet()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return value;
  seen.add(value);
  for (const nested of Object.values(value)) deepFreeze(nested, seen);
  return Object.freeze(value);
}
function fullChannelError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeekly7dFullChannelNotificationError';
  error.code = code;
  error.details = Object.freeze({ ...details });
  return error;
}
