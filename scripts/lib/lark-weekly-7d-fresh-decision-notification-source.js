import { createHash } from 'node:crypto';

import {
  buildLarkWeeklyExecutiveFactualReport,
  renderLarkWeeklyExecutiveChannelSections,
  serializeLarkWeeklyExecutiveFactualReport,
} from '../../packages/application/src/notifications/build-lark-weekly-executive-factual-report.js';
import {
  buildLarkExecutiveNotificationMessage,
} from '../../packages/application/src/notifications/deliver-lark-executive-notification.js';
import {
  buildLarkWeeklyExecutiveFullChannelAiEvidence,
  validateLarkWeeklyExecutiveFullChannelAiOutputs,
} from '../../packages/application/src/reports/build-lark-weekly-executive-full-channel-ai-evidence.js';
import {
  LARK_NATIVE_AI_CHANNELS,
} from '../../packages/config/src/lark-native-ai-all-channel-contract.js';
import {
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES,
  LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION,
} from '../../packages/config/src/lark-native-ai-weekly-7d-controlled-uat-contract.js';
import {
  LARK_EXECUTIVE_DESTINATION_KEY_HASH,
} from '../../packages/config/src/lark-notification-runtime-config.js';
import {
  resolveLarkNotificationReviewedDestination,
} from '../../packages/connectors/src/lark/lark-notification-reviewed-destination.js';
import {
  LARK_WEEKLY_7D_EXECUTIVE_DECISION_AI_PREFIX,
  assertFreshWeekly7dDecisionPeriod,
  assertLarkWeekly7dExecutiveDecisionGenerated,
  isLarkWeekly7dExecutiveDecisionIdentity,
} from './lark-weekly-7d-executive-decision-preview.js';
import {
  LARK_WEEKLY_7D_NOTIFICATION_ADMISSION_CONTRACT_VERSION,
  LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
} from './lark-weekly-7d-notification-admission.js';

export const LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256 =
  '24ed4cbae0a92e6dd89e850833056ca411781275c53fa9f8d7577c99a3d9c861';
export const LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256 =
  '6b8a2f1d2243c0bb2575082afb4e5ea7a530e8d16de31a02ee666fcf27da2a5f';

const ADMISSION_PREFIX = 'notification-weekly-7d:';
const HASH = /^[a-f0-9]{64}$/u;
const SOURCE_SCOPE = 'executive';
const SOURCE_CHANNEL = 'executive';
const PROVEN_NOTIFICATION_REASON = 'controlled_uat';
const SOURCE_PROFILE = 'integration_workspace';
const REPORT_TYPE = 'dashboard_performance_report';
const LOCKED_PERIOD = Object.freeze({
  periodStart: '2026-08-03',
  periodEnd: '2026-08-09',
  compareStart: '2026-07-27',
  compareEnd: '2026-08-02',
  comparisonMode: 'previous_period',
  windowDays: 7,
});
const LOCKED_GENERATED_AT = 1_786_385_677_223;
const LOCKED_SOURCE_REPORT_COUNT = 8;

export async function loadFreshWeekly7dExecutiveDecisionNotificationSource(input = {}) {
  const client = requireClient(input.client);
  const repository = requireRepository(input.repository);
  const tableId = requireText(input.aiRunsTableId, 'aiRunsTableId');

  const executiveRows = await repository.listByFieldValues(
    tableId,
    'scope_type',
    [SOURCE_SCOPE],
  );
  const matches = executiveRows.filter((record) => {
    const key = optionalText(scalar(record?.fields?.ai_run_key));
    return key
      && isLarkWeekly7dExecutiveDecisionIdentity(key)
      && sha256(key) === LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256;
  });
  if (matches.length !== 1) {
    throw sourceError(
      'Expected exactly one retained accepted Fresh Weekly Executive Decision source row',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
      { matchCount: matches.length },
    );
  }

  const sourceRecord = matches[0];
  const sourceAuthority = assertLockedRetainedFreshSource(
    sourceRecord.fields,
    input.now ?? Date.now(),
  );
  const factualReport = await loadRetainedWeeklyFactualReport({
    client,
    sourceReportIds: sourceAuthority.sourceReportIds,
    expectedPeriod: sourceAuthority.period,
  });
  const rebuiltEvidence = buildLarkWeeklyExecutiveFullChannelAiEvidence({
    factualReport,
    channelStatusVectorJson: sourceAuthority.channelStatusVectorJson,
  });
  if (rebuiltEvidence.metricSummaryJson !== sourceAuthority.metricSummaryJson) {
    throw sourceError(
      'Retained Fresh Weekly Executive Decision evidence no longer matches its exact source Reports',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_EVIDENCE_DRIFT',
      {
        sourceMetricSummarySha256: sha256(sourceAuthority.metricSummaryJson),
        rebuiltMetricSummarySha256: sha256(rebuiltEvidence.metricSummaryJson),
      },
    );
  }
  const qualityGate = validateLarkWeeklyExecutiveFullChannelAiOutputs(
    sourceAuthority.outputs,
    rebuiltEvidence.evidence,
  );
  if (qualityGate.passed !== true) {
    throw sourceError(
      'Retained Fresh Weekly Executive Decision failed the unchanged Executive Decision Quality Gate',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_QUALITY_FAILED',
      { violations: qualityGate.violations },
    );
  }

  const admission = buildFreshWeekly7dExecutiveDecisionNotificationAdmission({
    sourceRecord,
    factualReport,
    evidence: rebuiltEvidence.evidence,
    qualityGate,
    outputs: sourceAuthority.outputs,
  });
  if (admission.reviewedMessageSha256
      !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256) {
    throw sourceError(
      'Weekly Notification reconstructed message differs from the accepted reviewed Fresh v4 message',
      'LARK_WEEKLY_7D_NOTIFICATION_REVIEWED_MESSAGE_DRIFT',
      {
        expectedMessageSha256: LARK_WEEKLY_7D_NOTIFICATION_LOCKED_REVIEWED_MESSAGE_SHA256,
        observedMessageSha256: admission.reviewedMessageSha256,
      },
    );
  }

  const destination = await resolveLarkNotificationReviewedDestination({
    client,
    expectedDestinationKeyHash: LARK_EXECUTIVE_DESTINATION_KEY_HASH,
  });
  return deepFreeze({
    ...admission,
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

  let factualReport;
  let evidence;
  let qualityGate;
  let outputs;
  let sourceReportIds;
  let factualReportSha256;
  let synthesis = null;

  if (input.synthesis) {
    synthesis = requireObject(input.synthesis, 'synthesis');
    if (sourceAiRunKey !== synthesis.aiRunKey) {
      throw sourceError(
        'Notification Admission source identity does not match the supplied synthesis',
        'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
      );
    }
    const accepted = assertLarkWeekly7dExecutiveDecisionGenerated(source.fields, synthesis);
    factualReport = synthesis.factualReport;
    evidence = synthesis.evidence.evidence;
    qualityGate = accepted.qualityGate;
    outputs = accepted.outputs;
    sourceReportIds = Object.freeze([...synthesis.sourceReportIds].sort());
    factualReportSha256 = synthesis.factualReportSha256;
  } else {
    factualReport = requireObject(input.factualReport, 'factualReport');
    evidence = requireObject(input.evidence, 'evidence');
    qualityGate = requireObject(input.qualityGate, 'qualityGate');
    outputs = requireObject(input.outputs, 'outputs');
    sourceReportIds = Object.freeze(parseSourceReportIds(source.fields.source_report_ids_json));
    const reportSourceIds = Object.freeze([...factualReport.sourceReportIds].sort());
    if (JSON.stringify(sourceReportIds) !== JSON.stringify(reportSourceIds)) {
      throw sourceError(
        'Retained Fresh source Report identities differ from the reconstructed factual report',
        'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_REPORT_DRIFT',
      );
    }
    factualReportSha256 = sha256(serializeLarkWeeklyExecutiveFactualReport(factualReport));
    if (qualityGate.passed !== true) {
      throw sourceError(
        'Notification Admission requires a passed Executive Decision Quality Gate',
        'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_QUALITY_FAILED',
        { violations: qualityGate.violations ?? [] },
      );
    }
  }

  const sourceDedupeKey = requireHash(scalar(source.fields.dedupe_key), 'source.dedupe_key');
  const metricSummaryJson = requireText(scalar(source.fields.metric_summary_json), 'metric_summary_json');
  const sections = renderLarkWeeklyExecutiveChannelSections(factualReport);
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
    factualReportSha256,
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
      customerProfile: SOURCE_PROFILE,
      periodStart: factualReport.period.periodStart,
      periodEnd: factualReport.period.periodEnd,
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
    factualReport,
    factualReportSha256,
    synthesis,
    aiRunKey,
    reportId: aiRunKey,
    dedupeKey: fields.dedupe_key,
    notificationAttemptKey: `${aiRunKey}::${fields.dedupe_key}`,
    templateVersion: LARK_WEEKLY_7D_NOTIFICATION_TEMPLATE_VERSION,
    evidence,
    qualityGate,
    acceptedOutputs: outputs,
    deliveryOutputs,
    reviewedMessage: message,
    reviewedMessageSha256: sha256(message.text),
    reviewedMessageBytes: Buffer.byteLength(message.text, 'utf8'),
    fields,
  });
}

function assertLockedRetainedFreshSource(fields = {}, now = Date.now()) {
  const sourceAiRunKey = requireText(scalar(fields.ai_run_key), 'source.ai_run_key');
  const invalid = [];
  if (!isLarkWeekly7dExecutiveDecisionIdentity(sourceAiRunKey)) invalid.push('aiRunKey');
  if (sha256(sourceAiRunKey) !== LARK_WEEKLY_7D_NOTIFICATION_LOCKED_SOURCE_AI_RUN_KEY_SHA256) {
    invalid.push('sourceIdentitySha256');
  }
  if (scalar(fields.template_version) !== LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TEMPLATE_VERSION) invalid.push('templateVersion');
  if (scalar(fields.scope_type) !== SOURCE_SCOPE) invalid.push('scopeType');
  if (scalar(fields.channel_key) !== SOURCE_CHANNEL) invalid.push('channelKey');
  if (Number(scalar(fields.window_days)) !== 7) invalid.push('windowDays');
  if (!['report_available', 'report_partial'].includes(String(scalar(fields.readiness_status) ?? ''))) invalid.push('readinessStatus');
  if (scalar(fields.generation_status) !== 'generated') invalid.push('generationStatus');
  if (optionalText(scalar(fields.failure_code)) !== null) invalid.push('failureCode');
  if (booleanValue(fields.preview_mode) !== true) invalid.push('previewMode');
  if (booleanValue(fields.notification_eligible) !== false) invalid.push('notificationEligible');
  if (booleanValue(fields.sent_to_group) !== false) invalid.push('sentToGroup');
  if (Number(scalar(fields.generated_at)) !== LOCKED_GENERATED_AT) invalid.push('generatedAt');

  const period = Object.freeze({
    periodStart: dateOnlyValue(fields.period_start),
    periodEnd: dateOnlyValue(fields.period_end),
    compareStart: nullableDateOnlyValue(fields.compare_start),
    compareEnd: nullableDateOnlyValue(fields.compare_end),
    comparisonMode: requireText(scalar(fields.comparison_mode) ?? 'none', 'comparison_mode'),
    windowDays: 7,
  });
  assertFreshWeekly7dDecisionPeriod(period, now);
  if (JSON.stringify(period) !== JSON.stringify(LOCKED_PERIOD)) invalid.push('period');

  const sourceReportIds = Object.freeze(parseSourceReportIds(fields.source_report_ids_json));
  if (sourceReportIds.length !== LOCKED_SOURCE_REPORT_COUNT) invalid.push('sourceReportCount');
  const outputs = readOutputs(fields);
  const sourceDedupeKey = requireHash(scalar(fields.dedupe_key), 'source.dedupe_key');
  const metricSummaryJson = requireText(scalar(fields.metric_summary_json), 'metric_summary_json');
  const channelStatusVectorJson = requireText(
    scalar(fields.channel_status_vector_json),
    'channel_status_vector_json',
  );

  if (invalid.length > 0) {
    throw sourceError(
      'Retained Fresh Weekly Executive Decision source drifted from the accepted v4 authority',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
      { invalid },
    );
  }
  return deepFreeze({
    sourceAiRunKey,
    sourceDedupeKey,
    sourceReportIds,
    period,
    outputs,
    metricSummaryJson,
    channelStatusVectorJson,
  });
}

async function loadRetainedWeeklyFactualReport(input = {}) {
  const client = requireClient(input.client);
  const sourceReportIds = Object.freeze([...requireArray(input.sourceReportIds, 'sourceReportIds')].sort());
  const expectedPeriod = requireObject(input.expectedPeriod, 'expectedPeriod');
  const tables = resolveRetainedTables(await client.listTables());

  const snapshotRecords = await client.searchRecordsByFieldValues({
    tableId: tables.snapshots,
    fieldName: 'report_id',
    values: sourceReportIds,
  });
  const snapshots = sourceReportIds.map((reportId) => {
    const matches = snapshotRecords.filter((record) => larkText(record?.fields?.report_id) === reportId);
    if (matches.length !== 1) {
      throw sourceError(
        'Retained Fresh v4 requires one exact Report Snapshot per source Report ID',
        'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_REPORT_INVALID',
        { matchCount: matches.length },
      );
    }
    return normalizeRetainedSnapshot(matches[0].fields);
  });

  const settingKeys = [...new Set(snapshots.map(({ reportSettingKey }) => reportSettingKey))].sort();
  const settingRecords = await client.searchRecordsByFieldValues({
    tableId: tables.settings,
    fieldName: 'report_setting_key',
    values: settingKeys,
  });
  const settingsByKey = new Map(settingKeys.map((settingKey) => {
    const matches = settingRecords.filter((record) => (
      larkText(record?.fields?.report_setting_key) === settingKey
      && larkText(record?.fields?.customer_profile) === SOURCE_PROFILE
    ));
    if (matches.length !== 1) {
      throw sourceError(
        'Retained Fresh v4 requires one exact Report Setting per retained Snapshot',
        'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_REPORT_INVALID',
        { matchCount: matches.length },
      );
    }
    return [settingKey, normalizeRetainedSetting(matches[0].fields)];
  }));

  for (const snapshot of snapshots) {
    if (snapshot.customerProfile !== SOURCE_PROFILE
        || snapshot.reportType !== REPORT_TYPE
        || snapshot.windowDays !== 7
        || snapshot.periodStart !== expectedPeriod.periodStart
        || snapshot.periodEnd !== expectedPeriod.periodEnd
        || snapshot.compareStart !== expectedPeriod.compareStart
        || snapshot.compareEnd !== expectedPeriod.compareEnd
        || snapshot.comparisonMode !== expectedPeriod.comparisonMode) {
      throw sourceError(
        'Retained Fresh v4 source Report Snapshot drifted from its accepted period/profile authority',
        'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_REPORT_INVALID',
        { reportIdentitySha256: sha256(snapshot.reportId) },
      );
    }
  }

  const [metricRecords, topContentRecords, topAdsRecords] = await Promise.all([
    client.searchRecordsByFieldValues({
      tableId: tables.metrics,
      fieldName: 'report_id',
      values: sourceReportIds,
    }),
    client.searchRecordsByFieldValues({
      tableId: tables.topContent,
      fieldName: 'report_id',
      values: sourceReportIds,
    }),
    client.searchRecordsByFieldValues({
      tableId: tables.topAds,
      fieldName: 'report_id',
      values: sourceReportIds,
    }),
  ]);
  const metricsByReport = groupByReport(metricRecords, normalizeRetainedMetric);
  const topContentByReport = groupByReport(topContentRecords, normalizeRetainedTopContent);
  const topAdsByReport = groupByReport(topAdsRecords, normalizeRetainedTopAd);
  const reportBundles = snapshots.map((snapshot) => {
    const setting = settingsByKey.get(snapshot.reportSettingKey);
    if (!setting) {
      throw sourceError(
        'Retained Fresh v4 source Report Setting mapping is missing',
        'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_REPORT_INVALID',
      );
    }
    return Object.freeze({
      channelKey: setting.channelKey,
      reportId: snapshot.reportId,
      payload: Object.freeze({ dataStatus: snapshot.dataStatus }),
      metricValues: metricsByReport.get(snapshot.reportId) ?? [],
      topContent: topContentByReport.get(snapshot.reportId) ?? [],
      topAds: topAdsByReport.get(snapshot.reportId) ?? [],
    });
  });
  const channelKeys = reportBundles.map(({ channelKey }) => channelKey);
  if (new Set(channelKeys).size !== channelKeys.length) {
    throw sourceError(
      'Retained Fresh v4 source Reports contain duplicate channel authority',
      'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_REPORT_INVALID',
    );
  }

  const factualReport = buildLarkWeeklyExecutiveFactualReport({
    targetPeriod: expectedPeriod,
    reportBundles,
  });
  if (JSON.stringify([...factualReport.sourceReportIds].sort()) !== JSON.stringify(sourceReportIds)) {
    throw sourceError(
      'Retained Fresh v4 factual report did not preserve every exact source Report ID',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_REPORT_DRIFT',
    );
  }
  return factualReport;
}

function resolveRetainedTables(inventory) {
  const tables = requireArray(inventory, 'tableInventory');
  const needed = ['settings', 'snapshots', 'metrics', 'topContent', 'topAds'];
  return Object.freeze(Object.fromEntries(needed.map((role) => {
    const exactName = LARK_NATIVE_AI_WEEKLY_7D_CONTROLLED_UAT_TABLES[role];
    const matches = tables.filter((table) => larkText(
      table?.name ?? table?.tableName ?? table?.table_name,
    ) === exactName);
    if (matches.length !== 1) {
      throw sourceError(
        'Retained Fresh v4 requires one exact existing Lark Report table per role',
        'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_REPORT_TABLE_INVALID',
        { tableRole: role, matchCount: matches.length },
      );
    }
    return [role, requireText(
      matches[0].tableId ?? matches[0].table_id ?? matches[0].id,
      `table.${role}`,
    )];
  })));
}

function normalizeRetainedSetting(fieldsInput) {
  const fields = requireObject(fieldsInput, 'setting.fields');
  if (larkBoolean(fields.enabled) !== true
      || larkText(fields.customer_profile) !== SOURCE_PROFILE
      || (larkText(fields.report_type) ?? REPORT_TYPE) !== REPORT_TYPE
      || Number(larkNumber(fields.window_days)) !== 7) {
    throw sourceError(
      'Retained Fresh v4 Report Setting is outside the accepted 7D Integration Workspace authority',
      'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_REPORT_INVALID',
    );
  }
  const platforms = larkMultiText(fields.platforms ?? fields.platform).map((item) => item.toLowerCase());
  const capability = larkText(fields.capability)?.toLowerCase() ?? null;
  const channel = LARK_NATIVE_AI_CHANNELS.find((item) => (
    platforms.includes(item.platform)
    && (!capability || capability === item.capability)
  ));
  if (!channel) {
    throw sourceError(
      'Retained Fresh v4 Report Setting does not map to one canonical channel',
      'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_REPORT_INVALID',
    );
  }
  return Object.freeze({
    reportSettingKey: requireText(larkText(fields.report_setting_key), 'report_setting_key'),
    channelKey: channel.channelKey,
  });
}

function normalizeRetainedSnapshot(fieldsInput) {
  const fields = requireObject(fieldsInput, 'snapshot.fields');
  const comparisonMode = larkText(fields.comparison_mode) ?? 'none';
  const compareStart = nullableDateOnlyValue(fields.compare_start);
  const compareEnd = nullableDateOnlyValue(fields.compare_end);
  return Object.freeze({
    reportId: requireText(larkText(fields.report_id), 'snapshot.report_id'),
    reportSettingKey: requireText(larkText(fields.report_setting_key), 'snapshot.report_setting_key'),
    customerProfile: larkText(fields.customer_profile),
    reportType: larkText(fields.report_type),
    windowDays: Number(larkNumber(fields.window_days)),
    periodStart: dateOnlyValue(fields.period_start),
    periodEnd: dateOnlyValue(fields.period_end),
    compareStart,
    compareEnd,
    comparisonMode: comparisonMode !== 'none' && compareStart && compareEnd ? comparisonMode : 'none',
    dataStatus: normalizeDataStatus(larkText(fields.data_status)),
  });
}

function normalizeRetainedMetric(fieldsInput) {
  const fields = requireObject(fieldsInput, 'metric.fields');
  return Object.freeze({
    report_id: larkText(fields.report_id),
    metric_key: requireText(larkText(fields.metric_key), 'metric.metric_key'),
    display_name: larkText(fields.display_name),
    current_value: larkNumber(fields.current_value),
    compare_value: larkNumber(fields.compare_value),
    change_value: larkNumber(fields.change_value),
    change_percent: larkNumber(fields.change_percent),
    unit: larkText(fields.unit) ?? 'count',
    availability_status: larkText(fields.availability_status) ?? 'not_available',
    availability_message: larkText(fields.availability_message),
    metric_scope: larkText(fields.metric_scope) ?? 'summary',
    dimension_type: larkText(fields.dimension_type) ?? 'summary',
    dimension_value: larkText(fields.dimension_value) ?? 'all',
    rank: larkNumber(fields.rank) ?? 1,
  });
}

function normalizeRetainedTopContent(fieldsInput) {
  const fields = requireObject(fieldsInput, 'topContent.fields');
  return Object.freeze({
    report_id: larkText(fields.report_id),
    rank: larkNumber(fields.rank) ?? 9999,
    external_content_id: larkText(fields.external_content_id),
    caption: larkText(fields.caption),
    content_url: larkText(fields.content_url),
    published_at: larkNumber(fields.published_at),
    period_views: larkNumber(fields.period_views),
    period_likes: larkNumber(fields.period_likes),
    period_comments: larkNumber(fields.period_comments),
    period_shares: larkNumber(fields.period_shares),
    period_engagement: larkNumber(fields.period_engagement),
    period_engagement_rate: larkNumber(fields.period_engagement_rate),
    latest_total_views: larkNumber(fields.latest_total_views),
    performance_status: larkText(fields.performance_status),
    data_status: larkText(fields.data_status),
  });
}

function normalizeRetainedTopAd(fieldsInput) {
  const fields = requireObject(fieldsInput, 'topAds.fields');
  return Object.freeze({
    report_id: larkText(fields.report_id),
    rank: larkNumber(fields.rank) ?? 9999,
    external_ad_id: larkText(fields.external_ad_id),
    external_campaign_id: larkText(fields.external_campaign_id),
    external_ad_group_id: larkText(fields.external_ad_group_id),
    ad_name: larkText(fields.ad_name),
    currency: larkText(fields.currency),
    spend_micros: larkNumber(fields.spend_micros),
    impressions: larkNumber(fields.impressions),
    reach: larkNumber(fields.reach),
    clicks: larkNumber(fields.clicks),
    conversions: larkNumber(fields.conversions),
    conversion_value_micros: larkNumber(fields.conversion_value_micros),
    ctr: larkNumber(fields.ctr),
    cpc_micros: larkNumber(fields.cpc_micros),
    cpa_micros: larkNumber(fields.cpa_micros),
    roas: larkNumber(fields.roas),
    data_status: larkText(fields.data_status),
  });
}

function groupByReport(records, normalizer) {
  const grouped = new Map();
  for (const record of requireArray(records, 'records')) {
    const fields = normalizer(record.fields);
    if (!fields.report_id) continue;
    const list = grouped.get(fields.report_id) ?? [];
    list.push(fields);
    grouped.set(fields.report_id, list);
  }
  for (const list of grouped.values()) {
    list.sort((left, right) => Number(left.rank ?? 9999) - Number(right.rank ?? 9999));
  }
  return grouped;
}

function readOutputs(fields) {
  return Object.freeze({
    insight_summary: requireText(scalar(fields.insight_summary), 'insight_summary'),
    strengths: requireText(scalar(fields.strengths), 'strengths'),
    weaknesses: requireText(scalar(fields.weaknesses), 'weaknesses'),
    recommendations: requireText(scalar(fields.recommendations), 'recommendations'),
  });
}

function parseSourceReportIds(value) {
  try {
    const parsed = JSON.parse(requireText(scalar(value), 'source_report_ids_json'));
    if (!Array.isArray(parsed) || parsed.length === 0) throw new Error('invalid');
    const normalized = parsed.map((item) => requireText(item, 'source_report_id'));
    if (new Set(normalized).size !== normalized.length) throw new Error('duplicate');
    return normalized.sort();
  } catch {
    throw sourceError(
      'Fresh Weekly Executive Decision source Report identities are invalid',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
    );
  }
}

function normalizeDataStatus(value) {
  const status = requireText(value, 'snapshot.data_status');
  if (status === 'no_data') return 'no_data_confirmed';
  if (!['complete', 'partial', 'revisable', 'no_data_confirmed', 'source_unavailable', 'not_observed'].includes(status)) {
    throw sourceError(
      'Retained Fresh v4 Report data_status is unsupported',
      'LARK_WEEKLY_7D_NOTIFICATION_RETAINED_REPORT_INVALID',
      { status },
    );
  }
  return status;
}

function dateOnlyValue(value) {
  const item = scalar(value);
  if (typeof item === 'string' && /^\d{4}-\d{2}-\d{2}$/u.test(item)) return item;
  const epoch = Number(item);
  if (!Number.isFinite(epoch) || epoch <= 0) {
    throw sourceError(
      'Fresh Weekly Executive Decision date authority is invalid',
      'LARK_WEEKLY_7D_NOTIFICATION_FRESH_SOURCE_INVALID',
    );
  }
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Bangkok', year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(new Date(epoch));
  const byType = Object.fromEntries(parts.map(({ type, value: part }) => [type, part]));
  return `${byType.year}-${byType.month}-${byType.day}`;
}

function nullableDateOnlyValue(value) {
  const item = scalar(value);
  return item === null || item === undefined || item === '' ? null : dateOnlyValue(item);
}

function larkMultiText(value) {
  if (Array.isArray(value)) return value.map(larkText).filter(Boolean);
  const text = larkText(value);
  return text ? [text] : [];
}
function larkText(value) {
  if (typeof value === 'string') return value.trim() || null;
  if (Array.isArray(value)) return value.map(larkText).filter(Boolean).join('') || null;
  if (value && typeof value === 'object') return larkText(value.text ?? value.value ?? value.name);
  return value == null ? null : String(value).trim() || null;
}
function larkNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const item = Array.isArray(value) && value.length === 1 ? value[0] : value;
  const candidate = item && typeof item === 'object' ? item.value ?? item.text : item;
  if (candidate === null || candidate === undefined || candidate === '') return null;
  const number = Number(candidate);
  return Number.isFinite(number) ? number : null;
}
function larkBoolean(value) {
  if (typeof value === 'boolean') return value;
  const text = larkText(value)?.toLowerCase();
  if (text === 'true' || text === '1' || text === 'yes') return true;
  if (text === 'false' || text === '0' || text === 'no' || text === null) return false;
  return Boolean(value);
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
  for (const method of ['listTables', 'searchRecordsByFieldValues', 'requestBitableJson']) {
    if (typeof client?.[method] !== 'function') throw new TypeError(`client.${method} is required`);
  }
  return client;
}
function requireRepository(repository) {
  if (typeof repository?.listByFieldValues !== 'function') {
    throw new TypeError('repository is required');
  }
  return repository;
}
function requireArray(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  return value;
}
function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} is required`);
  }
  return value;
}
function optionalText(value) {
  if (value === null || value === undefined) return null;
  const normalized = String(value).trim();
  return normalized || null;
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
function booleanValue(value) {
  const item = scalar(value);
  if (item === true || item === false) return item;
  if (item === 1 || item === '1' || String(item).toLowerCase() === 'true') return true;
  if (item === 0 || item === '0' || String(item).toLowerCase() === 'false') return false;
  return null;
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
