import {
  LARK_NATIVE_AI_CHANNELS,
  LARK_NATIVE_AI_TEMPLATE_VERSION,
  LARK_NATIVE_AI_WINDOW_DAYS,
  resolveLarkNativeAiReadiness,
} from '../../../config/src/lark-native-ai-all-channel-contract.js';
import { dateOnlyToEpochMilliseconds, requireDateOnly } from '../../../shared/src/date/date-only.js';
import { escapeReportIdentityPart, stableStringify } from '../use-cases/build-report-snapshot.js';
import { validateReportMaterializationPayload } from './report-materialization-payload.js';

const DASHBOARD_REPORT_TYPE = 'dashboard_performance_report';
const EXECUTIVE_COVERAGE_MESSAGES = Object.freeze({
  complete_coverage: 'มี validated Report ครบทุกช่องทาง',
  partial_coverage: 'มีข้อมูล Report บางช่องทาง และยังมีช่องทางที่ข้อมูลไม่พร้อม',
  no_reports_available: 'ยังไม่มี validated Report ที่พร้อมใช้ในช่วงนี้',
  validation_blocked: 'มีข้อมูล Report ที่ไม่ผ่านการตรวจสอบ จึงต้องหยุดใช้หลักฐานส่วนนั้น',
});
const BUSINESS_AI_READY = new Set(['report_available', 'report_partial']);
const VALIDATED_REPORT_STATES = new Set(['report_available', 'report_partial', 'no_data_confirmed']);
const EXECUTIVE_METRIC_LIMIT = 24;
const EXECUTIVE_RANKING_LIMIT = 3;
const EXECUTIVE_COLLECTION_LIMIT = 8;

/**
 * Build Lark-ready Preview rows for every expected channel plus one Executive row per 1/3/7/30 window.
 * This function never calls AI, Lark, Queue, D1, a Provider or a notification endpoint.
 */
export async function buildAllChannelAiPreviewRows(input = {}) {
  const customerKey = requireText(input.customerKey, 'customerKey');
  requireText(input.customerProfile, 'customerProfile');
  const templateVersion = optionalText(input.templateVersion) ?? LARK_NATIVE_AI_TEMPLATE_VERSION;
  const generatedAt = requireEpoch(input.generatedAt, 'generatedAt');
  const utcOffset = requireText(input.utcOffset ?? '+07:00', 'utcOffset');
  const periods = normalizePeriods(input.periods, utcOffset);
  const settings = normalizeSettings(input.settings ?? []);
  const reportBundles = await normalizeReportBundles(input.reportBundles ?? []);
  const rows = [];

  for (const period of periods) {
    const channelRows = [];
    for (const channel of LARK_NATIVE_AI_CHANNELS) {
      const row = await buildChannelPreviewRow({
        customerKey,
        templateVersion,
        generatedAt,
        utcOffset,
        period,
        channel,
        settings,
        reportBundles,
      });
      channelRows.push(row);
      rows.push(row);
    }
    rows.push(await buildExecutivePreviewRow({
      customerKey,
      templateVersion,
      generatedAt,
      utcOffset,
      period,
      channelRows,
    }));
  }

  return Object.freeze(rows);
}

async function buildChannelPreviewRow(context) {
  const { channel, period, settings, reportBundles } = context;
  const matchedSettings = settings.filter((setting) => (
    setting.enabled
    && setting.reportType === DASHBOARD_REPORT_TYPE
    && setting.platforms.includes(channel.platform)
    && (!setting.capability || setting.capability === channel.capability)
    && setting.windowDays === period.windowDays
  ));

  if (matchedSettings.length === 0) {
    return buildStatusOnlyChannelRow(context, {
      readinessStatus: 'configuration_missing',
      failureCode: null,
    });
  }

  if (matchedSettings.length > 1) {
    return buildStatusOnlyChannelRow(context, {
      readinessStatus: 'validation_failed',
      failureCode: 'AI_SETTING_IDENTITY_CONFLICT',
      setting: matchedSettings[0],
    });
  }

  const setting = matchedSettings[0];
  const channelPeriodBundles = reportBundles.filter((bundle) => (
    bundle.channelKey === channel.channelKey
    && bundle.payload.period.windowDays === period.windowDays
    && matchesPeriod(bundle.payload.period, period)
  ));
  const exactBundles = channelPeriodBundles.filter((bundle) => (
    bundle.reportSettingKey === setting.reportSettingKey
    && bundle.payload.platformScope === channel.platform
    && bundle.payload.capability === channel.capability
    && bundle.payload.reportType === DASHBOARD_REPORT_TYPE
  ));

  if (channelPeriodBundles.length > 0 && exactBundles.length === 0) {
    return buildStatusOnlyChannelRow(context, {
      readinessStatus: 'validation_failed',
      failureCode: 'AI_REPORT_IDENTITY_MISMATCH',
      setting,
    });
  }

  if (exactBundles.length === 0) {
    return buildStatusOnlyChannelRow(context, {
      readinessStatus: 'report_missing',
      failureCode: null,
      setting,
    });
  }

  const uniqueChecksums = [...new Set(exactBundles.map(({ evidenceChecksum }) => evidenceChecksum))];
  if (uniqueChecksums.length !== 1) {
    return buildStatusOnlyChannelRow(context, {
      readinessStatus: 'validation_failed',
      failureCode: 'AI_REPORT_CHECKSUM_CONFLICT',
      setting,
    });
  }

  const bundle = [...exactBundles]
    .sort((left, right) => right.payload.generatedAt - left.payload.generatedAt)[0];
  const readinessStatus = readinessFromDataStatus(bundle.payload.dataStatus);
  return buildReportBackedChannelRow(context, { setting, bundle, readinessStatus });
}

async function buildReportBackedChannelRow(context, state) {
  const { customerKey, templateVersion, generatedAt, utcOffset, period, channel } = context;
  const { setting, bundle, readinessStatus } = state;
  const readiness = resolveLarkNativeAiReadiness(readinessStatus);
  const metricSummary = buildMetricSummary(bundle, readinessStatus);
  const sourceReportIds = Object.freeze([bundle.reportId]);
  const aiRunKey = createAiRunKey({
    customerKey,
    scopeType: 'channel',
    channelKey: channel.channelKey,
    accountId: bundle.accountId ?? setting.accountId,
    period,
    templateVersion,
  });
  const dedupeKey = await buildDedupeKey({
    customerKey,
    scopeType: 'channel',
    channelKey: channel.channelKey,
    period,
    evidenceChecksum: bundle.evidenceChecksum,
    templateVersion,
  });
  const generationStatus = BUSINESS_AI_READY.has(readinessStatus) ? 'pending' : 'skipped';

  return Object.freeze({
    report_id: aiRunKey,
    platforms: Object.freeze([channel.platform]),
    report_type: 'dashboard_channel_status',
    period_start: dateOnlyToEpochMilliseconds(period.periodStart, { utcOffset }),
    period_end: dateOnlyToEpochMilliseconds(period.periodEnd, { utcOffset }),
    compare_start: period.compareStart
      ? dateOnlyToEpochMilliseconds(period.compareStart, { utcOffset })
      : null,
    compare_end: period.compareEnd
      ? dateOnlyToEpochMilliseconds(period.compareEnd, { utcOffset })
      : null,
    comparison_mode: period.comparisonMode,
    metric_summary_json: stableStringify(metricSummary),
    insight_summary: generationStatus === 'pending' ? null : readiness.message,
    strengths: null,
    weaknesses: readinessStatus === 'report_partial' ? readiness.message : null,
    recommendations: generationStatus === 'pending' ? null : dataReadinessRecommendation(readinessStatus),
    course_filter: null,
    sent_to_group: false,
    sent_at: null,
    ai_run_key: aiRunKey,
    scope_type: 'channel',
    channel_key: channel.channelKey,
    capability: channel.capability,
    account_id: bundle.accountId ?? setting.accountId,
    window_days: String(period.windowDays),
    data_status: bundle.payload.dataStatus,
    readiness_status: readinessStatus,
    readiness_message: readiness.message,
    coverage_rate: bundle.payload.coverageRate,
    source_report_ids_json: stableStringify(sourceReportIds),
    source_report_checksum: bundle.evidenceChecksum,
    channel_status_vector_json: null,
    severity: readiness.severity,
    notification_eligible: false,
    notification_reason: 'preview_mode',
    dedupe_key: dedupeKey,
    cooldown_until: null,
    preview_mode: true,
    generation_status: generationStatus,
    failure_code: null,
    template_version: templateVersion,
    generated_at: generatedAt,
  });
}

async function buildStatusOnlyChannelRow(context, state) {
  const { customerKey, templateVersion, generatedAt, utcOffset, period, channel } = context;
  const readiness = resolveLarkNativeAiReadiness(state.readinessStatus);
  const accountId = state.setting?.accountId ?? null;
  const statusEvidence = Object.freeze({
    channelKey: channel.channelKey,
    period,
    readinessStatus: state.readinessStatus,
    reportSettingKey: state.setting?.reportSettingKey ?? null,
    failureCode: state.failureCode,
  });
  const evidenceChecksum = await sha256Hex(stableStringify(statusEvidence));
  const aiRunKey = createAiRunKey({
    customerKey,
    scopeType: 'channel',
    channelKey: channel.channelKey,
    accountId,
    period,
    templateVersion,
  });
  const dedupeKey = await buildDedupeKey({
    customerKey,
    scopeType: 'channel',
    channelKey: channel.channelKey,
    period,
    evidenceChecksum,
    templateVersion,
  });
  const failed = state.readinessStatus === 'validation_failed';

  return Object.freeze({
    report_id: aiRunKey,
    platforms: Object.freeze([channel.platform]),
    report_type: 'dashboard_channel_status',
    period_start: dateOnlyToEpochMilliseconds(period.periodStart, { utcOffset }),
    period_end: dateOnlyToEpochMilliseconds(period.periodEnd, { utcOffset }),
    compare_start: period.compareStart
      ? dateOnlyToEpochMilliseconds(period.compareStart, { utcOffset })
      : null,
    compare_end: period.compareEnd
      ? dateOnlyToEpochMilliseconds(period.compareEnd, { utcOffset })
      : null,
    comparison_mode: period.comparisonMode,
    metric_summary_json: stableStringify({
      readinessStatus: state.readinessStatus,
      readinessMessage: readiness.message,
      availableMetrics: [],
      unavailableMetrics: [],
      topContent: [],
      topAds: [],
      collections: {},
    }),
    insight_summary: readiness.message,
    strengths: null,
    weaknesses: readiness.message,
    recommendations: dataReadinessRecommendation(state.readinessStatus),
    course_filter: null,
    sent_to_group: false,
    sent_at: null,
    ai_run_key: aiRunKey,
    scope_type: 'channel',
    channel_key: channel.channelKey,
    capability: channel.capability,
    account_id: accountId,
    window_days: String(period.windowDays),
    data_status: state.readinessStatus,
    readiness_status: state.readinessStatus,
    readiness_message: readiness.message,
    coverage_rate: null,
    source_report_ids_json: '[]',
    source_report_checksum: evidenceChecksum,
    channel_status_vector_json: null,
    severity: readiness.severity,
    notification_eligible: false,
    notification_reason: 'preview_mode',
    dedupe_key: dedupeKey,
    cooldown_until: null,
    preview_mode: true,
    generation_status: failed ? 'failed' : 'skipped',
    failure_code: state.failureCode,
    template_version: templateVersion,
    generated_at: generatedAt,
  });
}

async function buildExecutivePreviewRow(context) {
  const { customerKey, templateVersion, generatedAt, utcOffset, period, channelRows } = context;
  const statusVector = channelRows.map((row) => Object.freeze({
    channelKey: row.channel_key,
    displayName: resolveChannelDisplayName(row.channel_key),
    readinessStatus: row.readiness_status,
    readinessMessage: row.readiness_message,
    severity: row.severity,
    sourceReportChecksum: row.source_report_checksum,
    availableMetricCount: countAvailableMetrics(row.metric_summary_json),
  }));
  const channelBusinessEvidence = Object.freeze(channelRows.map(buildExecutiveChannelBusinessEvidence));
  const counts = countReadiness(statusVector);
  const overallCoverageState = resolveOverallCoverageState(statusVector);
  const readinessStatus = executiveReadinessStatus(overallCoverageState);
  const readiness = resolveLarkNativeAiReadiness(readinessStatus);
  const sourceReportIds = [...new Set(channelRows.flatMap((row) => JSON.parse(row.source_report_ids_json)))].sort();
  const evidenceChecksum = await sha256Hex(stableStringify({
    statusVector,
    channelBusinessEvidence,
    sourceReportIds,
  }));
  const aiRunKey = createAiRunKey({
    customerKey,
    scopeType: 'executive',
    channelKey: 'executive',
    accountId: null,
    period,
    templateVersion,
  });
  const dedupeKey = await buildDedupeKey({
    customerKey,
    scopeType: 'executive',
    channelKey: 'executive',
    period,
    evidenceChecksum,
    templateVersion,
  });
  const canGenerate = overallCoverageState === 'complete_coverage' || overallCoverageState === 'partial_coverage';
  const failed = overallCoverageState === 'validation_blocked';
  const coverageMessage = EXECUTIVE_COVERAGE_MESSAGES[overallCoverageState];

  return Object.freeze({
    report_id: aiRunKey,
    platforms: Object.freeze([...new Set(LARK_NATIVE_AI_CHANNELS.map(({ platform }) => platform))]),
    report_type: 'dashboard_executive_summary',
    period_start: dateOnlyToEpochMilliseconds(period.periodStart, { utcOffset }),
    period_end: dateOnlyToEpochMilliseconds(period.periodEnd, { utcOffset }),
    compare_start: period.compareStart
      ? dateOnlyToEpochMilliseconds(period.compareStart, { utcOffset })
      : null,
    compare_end: period.compareEnd
      ? dateOnlyToEpochMilliseconds(period.compareEnd, { utcOffset })
      : null,
    comparison_mode: period.comparisonMode,
    metric_summary_json: stableStringify({
      evidenceShape: 'executive_business_first_v2',
      overallCoverageState,
      counts,
      channelStatuses: statusVector,
      channelBusinessEvidence,
      sourceReportIds,
    }),
    insight_summary: canGenerate ? null : coverageMessage,
    strengths: null,
    weaknesses: statusVector
      .filter(({ readinessStatus: status }) => !VALIDATED_REPORT_STATES.has(status))
      .map(({ displayName, readinessMessage }) => `${displayName}: ${readinessMessage}`)
      .join('\n') || null,
    recommendations: canGenerate ? null : 'รอให้มีข้อมูลธุรกิจอย่างน้อยหนึ่งช่องทางก่อนสร้าง Executive Insight',
    course_filter: null,
    sent_to_group: false,
    sent_at: null,
    ai_run_key: aiRunKey,
    scope_type: 'executive',
    channel_key: 'executive',
    capability: 'cross_channel',
    account_id: null,
    window_days: String(period.windowDays),
    data_status: readinessStatus,
    readiness_status: readinessStatus,
    readiness_message: coverageMessage,
    coverage_rate: counts.validated / LARK_NATIVE_AI_CHANNELS.length,
    source_report_ids_json: stableStringify(sourceReportIds),
    source_report_checksum: evidenceChecksum,
    channel_status_vector_json: stableStringify(statusVector),
    severity: readiness.severity,
    notification_eligible: false,
    notification_reason: 'preview_mode',
    dedupe_key: dedupeKey,
    cooldown_until: null,
    preview_mode: true,
    generation_status: failed ? 'failed' : (canGenerate ? 'pending' : 'skipped'),
    failure_code: failed ? 'AI_EXECUTIVE_VALIDATION_BLOCKED' : null,
    template_version: templateVersion,
    generated_at: generatedAt,
  });
}

function buildMetricSummary(bundle, readinessStatus) {
  const availableMetrics = [];
  const unavailableMetrics = [];
  for (const metric of bundle.metricValues) {
    const target = metric.availability_status === 'available' && metric.current_value !== null
      ? availableMetrics
      : unavailableMetrics;
    target.push(metric);
  }
  return Object.freeze({
    readinessStatus,
    sourceReportId: bundle.reportId,
    sourceWatermark: bundle.payload.sourceWatermark,
    availableMetrics: Object.freeze(availableMetrics),
    unavailableMetrics: Object.freeze(unavailableMetrics),
    topContent: bundle.topContent,
    topAds: bundle.topAds,
    collections: bundle.payload.collections,
  });
}

function countAvailableMetrics(metricSummaryJson) {
  const parsed = JSON.parse(metricSummaryJson);
  return Array.isArray(parsed.availableMetrics) ? parsed.availableMetrics.length : 0;
}

function buildExecutiveChannelBusinessEvidence(row) {
  const summary = JSON.parse(row.metric_summary_json);
  const availableMetrics = Array.isArray(summary.availableMetrics)
    ? summary.availableMetrics.filter(isExecutiveSummaryMetric).slice(0, EXECUTIVE_METRIC_LIMIT)
    : [];
  const unavailableMetrics = Array.isArray(summary.unavailableMetrics) ? summary.unavailableMetrics : [];
  const topContent = Array.isArray(summary.topContent)
    ? summary.topContent.slice(0, EXECUTIVE_RANKING_LIMIT)
    : [];
  const topAds = Array.isArray(summary.topAds)
    ? summary.topAds.slice(0, EXECUTIVE_RANKING_LIMIT)
    : [];

  return Object.freeze({
    channelKey: row.channel_key,
    displayName: resolveChannelDisplayName(row.channel_key),
    capability: row.capability,
    readinessStatus: row.readiness_status,
    readinessMessage: row.readiness_message,
    sourceReportId: optionalText(summary.sourceReportId),
    sourceWatermark: optionalText(summary.sourceWatermark),
    availableMetrics: Object.freeze(availableMetrics),
    unavailableMetricCount: unavailableMetrics.length,
    topContent: Object.freeze(topContent),
    topAds: Object.freeze(topAds),
    collections: buildExecutiveCollections(summary.collections),
  });
}

function isExecutiveSummaryMetric(metric) {
  return metric
    && typeof metric === 'object'
    && (metric.metric_scope ?? 'summary') === 'summary'
    && (metric.dimension_type ?? 'summary') === 'summary';
}

function buildExecutiveCollections(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return Object.freeze({});
  const entries = Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .slice(0, EXECUTIVE_COLLECTION_LIMIT)
    .map(([key, item]) => [key, Array.isArray(item) ? item.slice(0, EXECUTIVE_RANKING_LIMIT) : item]);
  return Object.freeze(Object.fromEntries(entries));
}

function resolveChannelDisplayName(channelKey) {
  return LARK_NATIVE_AI_CHANNELS.find((channel) => channel.channelKey === channelKey)?.displayName ?? channelKey;
}

function countReadiness(statusVector) {
  const counts = {
    report_available: 0,
    report_partial: 0,
    no_data_confirmed: 0,
    source_unavailable: 0,
    not_observed: 0,
    report_missing: 0,
    configuration_missing: 0,
    validation_failed: 0,
  };
  for (const { readinessStatus } of statusVector) counts[readinessStatus] += 1;
  counts.validated = counts.report_available + counts.report_partial + counts.no_data_confirmed;
  return Object.freeze(counts);
}

function resolveOverallCoverageState(statusVector) {
  if (statusVector.some(({ readinessStatus }) => readinessStatus === 'validation_failed')) {
    return 'validation_blocked';
  }
  const validatedCount = statusVector.filter(({ readinessStatus }) => VALIDATED_REPORT_STATES.has(readinessStatus)).length;
  if (validatedCount === LARK_NATIVE_AI_CHANNELS.length) return 'complete_coverage';
  if (validatedCount > 0) return 'partial_coverage';
  return 'no_reports_available';
}

function executiveReadinessStatus(overallCoverageState) {
  if (overallCoverageState === 'complete_coverage') return 'report_available';
  if (overallCoverageState === 'partial_coverage') return 'report_partial';
  if (overallCoverageState === 'validation_blocked') return 'validation_failed';
  return 'report_missing';
}

function matchesPeriod(reportPeriod, expectedPeriod) {
  return reportPeriod.windowDays === expectedPeriod.windowDays
    && reportPeriod.periodStart === expectedPeriod.periodStart
    && reportPeriod.periodEnd === expectedPeriod.periodEnd
    && reportPeriod.comparisonMode === expectedPeriod.comparisonMode
    && (reportPeriod.compareStart ?? null) === expectedPeriod.compareStart
    && (reportPeriod.compareEnd ?? null) === expectedPeriod.compareEnd;
}

function readinessFromDataStatus(dataStatus) {
  if (dataStatus === 'complete') return 'report_available';
  if (dataStatus === 'partial' || dataStatus === 'revisable') return 'report_partial';
  if (dataStatus === 'no_data_confirmed') return 'no_data_confirmed';
  if (dataStatus === 'source_unavailable') return 'source_unavailable';
  if (dataStatus === 'not_observed') return 'not_observed';
  throw new TypeError(`Unsupported Report data status for AI Preview: ${dataStatus}`);
}

function dataReadinessRecommendation(readinessStatus) {
  if (readinessStatus === 'configuration_missing') return 'ตั้งค่า Report ที่อนุมัติแล้วสำหรับช่องทางนี้';
  if (readinessStatus === 'report_missing') return 'สร้างหรือรอ validated Report สำหรับช่วงนี้';
  if (readinessStatus === 'source_unavailable') return 'ทำ Source readiness และ UAT ให้ผ่านก่อนสร้าง Insight';
  if (readinessStatus === 'not_observed') return 'รอ trusted observation ก่อนสรุปผล';
  if (readinessStatus === 'no_data_confirmed') return 'ตรวจช่วงถัดไปเมื่อมีข้อมูลใหม่ โดยไม่ตีความเป็นศูนย์';
  if (readinessStatus === 'validation_failed') return 'แก้ Report identity หรือ checksum conflict ก่อนใช้งาน AI';
  return null;
}

async function normalizeReportBundles(value) {
  if (!Array.isArray(value)) throw new TypeError('reportBundles must be an array');
  return Promise.all(value.map(async (raw, index) => {
    const bundle = requireObject(raw, `reportBundles[${index}]`);
    const payload = validateReportMaterializationPayload(bundle.payload);
    const reportId = requireText(bundle.reportId ?? payload.sourceReportId, `reportBundles[${index}].reportId`);
    const metricValues = normalizeMetricValues(bundle.metricValues ?? [], reportId);
    const topContent = freezeJsonArray(bundle.topContent ?? payload.topContent, `reportBundles[${index}].topContent`);
    const topAds = freezeJsonArray(bundle.topAds ?? payload.topAds, `reportBundles[${index}].topAds`);
    const { generatedAt: ignoredGeneratedAt, ...payloadEvidence } = payload;
    void ignoredGeneratedAt;
    const normalized = {
      channelKey: requireText(bundle.channelKey, `reportBundles[${index}].channelKey`),
      reportId,
      reportSettingKey: requireText(bundle.reportSettingKey, `reportBundles[${index}].reportSettingKey`),
      accountId: optionalText(bundle.accountId),
      payload,
      metricValues,
      topContent,
      topAds,
    };
    return Object.freeze({
      ...normalized,
      evidenceChecksum: await sha256Hex(stableStringify({ ...normalized, payload: payloadEvidence })),
    });
  }));
}

function normalizeMetricValues(value, reportId) {
  if (!Array.isArray(value)) throw new TypeError('metricValues must be an array');
  return Object.freeze(value.map((raw, index) => {
    const metric = requireObject(raw, `metricValues[${index}]`);
    const metricReportId = optionalText(metric.report_id ?? metric.reportId);
    if (metricReportId && metricReportId !== reportId) {
      throw new TypeError(`metricValues[${index}] report_id does not match ${reportId}`);
    }
    const availabilityStatus = optionalText(metric.availability_status ?? metric.availabilityStatus)
      ?? ((metric.current_value ?? metric.currentValue) == null ? 'not_available' : 'available');
    const currentValue = optionalFinite(metric.current_value ?? metric.currentValue, `metricValues[${index}].current_value`);
    if (availabilityStatus === 'available' && currentValue === null) {
      throw new TypeError(`metricValues[${index}] available metric must have a value`);
    }
    return Object.freeze({
      metric_key: requireText(metric.metric_key ?? metric.metricKey, `metricValues[${index}].metric_key`),
      display_name: optionalText(metric.display_name ?? metric.displayName),
      current_value: currentValue,
      compare_value: optionalFinite(metric.compare_value ?? metric.compareValue, `metricValues[${index}].compare_value`),
      change_value: optionalFinite(metric.change_value ?? metric.changeValue, `metricValues[${index}].change_value`),
      change_percent: optionalFinite(metric.change_percent ?? metric.changePercent, `metricValues[${index}].change_percent`),
      unit: optionalText(metric.unit),
      availability_status: availabilityStatus,
      availability_message: optionalText(metric.availability_message ?? metric.availabilityMessage),
      metric_scope: optionalText(metric.metric_scope ?? metric.metricScope),
      dimension_type: optionalText(metric.dimension_type ?? metric.dimensionType) ?? 'summary',
      dimension_value: optionalText(metric.dimension_value ?? metric.dimensionValue) ?? 'all',
      rank: normalizeRank(metric.rank, index + 1),
    });
  }).sort((left, right) => (
    left.rank - right.rank
    || left.metric_key.localeCompare(right.metric_key)
    || left.dimension_value.localeCompare(right.dimension_value)
  )));
}

function normalizeSettings(value) {
  if (!Array.isArray(value)) throw new TypeError('settings must be an array');
  return Object.freeze(value.map((raw, index) => {
    const setting = requireObject(raw, `settings[${index}]`);
    return Object.freeze({
      reportSettingKey: requireText(
        setting.reportSettingKey ?? setting.report_setting_key,
        `settings[${index}].reportSettingKey`,
      ),
      platforms: normalizePlatforms(setting.platforms ?? setting.platform),
      reportType: optionalText(setting.reportType ?? setting.report_type) ?? DASHBOARD_REPORT_TYPE,
      capability: optionalText(setting.capability),
      windowDays: positiveInteger(setting.windowDays ?? setting.window_days, `settings[${index}].windowDays`),
      accountId: optionalText(setting.accountId ?? setting.account_id),
      enabled: setting.enabled !== false,
    });
  }));
}

function normalizePeriods(value, utcOffset) {
  if (!Array.isArray(value)) throw new TypeError('periods must be an array');
  const normalized = value.map((raw, index) => {
    const period = requireObject(raw, `periods[${index}]`);
    const windowDays = positiveInteger(period.windowDays ?? period.window_days, `periods[${index}].windowDays`);
    if (!LARK_NATIVE_AI_WINDOW_DAYS.includes(windowDays)) {
      throw new TypeError(`Unsupported AI Preview window: ${windowDays}`);
    }
    const periodStart = requireDateOnly(period.periodStart ?? period.period_start, { label: `periods[${index}].periodStart` });
    const periodEnd = requireDateOnly(period.periodEnd ?? period.period_end, { label: `periods[${index}].periodEnd` });
    if (periodStart > periodEnd) throw new RangeError(`periods[${index}] start must not be after end`);
    const comparisonMode = optionalText(period.comparisonMode ?? period.comparison_mode) ?? 'none';
    const compareStart = optionalDate(period.compareStart ?? period.compare_start, `periods[${index}].compareStart`);
    const compareEnd = optionalDate(period.compareEnd ?? period.compare_end, `periods[${index}].compareEnd`);
    if (comparisonMode === 'none' && (compareStart || compareEnd)) {
      throw new TypeError(`periods[${index}] comparisonMode=none cannot include comparison dates`);
    }
    if (comparisonMode !== 'none' && (!compareStart || !compareEnd)) {
      throw new TypeError(`periods[${index}] comparison dates are required`);
    }
    dateOnlyToEpochMilliseconds(periodStart, { utcOffset });
    dateOnlyToEpochMilliseconds(periodEnd, { utcOffset });
    return Object.freeze({ windowDays, periodStart, periodEnd, comparisonMode, compareStart, compareEnd });
  });
  const windows = normalized.map(({ windowDays }) => windowDays).sort((left, right) => left - right);
  if (stableStringify(windows) !== stableStringify(LARK_NATIVE_AI_WINDOW_DAYS)) {
    throw new TypeError('AI Preview requires exactly one 1D, 3D, 7D and 30D period');
  }
  return Object.freeze(normalized.sort((left, right) => left.windowDays - right.windowDays));
}

function createAiRunKey(input) {
  return [
    'lark_native_ai',
    escapeReportIdentityPart(input.customerKey),
    input.scopeType,
    input.channelKey,
    escapeReportIdentityPart(input.accountId ?? 'unresolved'),
    `${input.period.windowDays}d`,
    input.period.periodStart,
    input.period.periodEnd,
    escapeReportIdentityPart(input.templateVersion),
  ].join('::');
}

async function buildDedupeKey(input) {
  return sha256Hex(stableStringify({
    customerKey: input.customerKey,
    destinationKeyHash: 'preview:none',
    scopeType: input.scopeType,
    channelKey: input.channelKey,
    windowDays: input.period.windowDays,
    periodStart: input.period.periodStart,
    periodEnd: input.period.periodEnd,
    evidenceChecksum: input.evidenceChecksum,
    templateVersion: input.templateVersion,
    language: 'th',
  }));
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function normalizePlatforms(value) {
  const values = Array.isArray(value) ? value : [value];
  const normalized = [...new Set(values.map((item) => requireText(item, 'setting platform').toLowerCase()))].sort();
  if (normalized.length === 0) throw new TypeError('setting platforms must not be empty');
  return Object.freeze(normalized);
}

function freezeJsonArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`${fieldName} must be an array`);
  return Object.freeze(value.map((item, index) => freezeJsonObject(item, `${fieldName}[${index}]`)));
}

function freezeJsonObject(value, fieldName) {
  const object = requireObject(value, fieldName);
  return Object.freeze(JSON.parse(stableStringify(object)));
}

function optionalDate(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  return requireDateOnly(value, { label: fieldName });
}

function normalizeRank(value, fallback) {
  if (value === null || value === undefined || value === '') return fallback;
  return positiveInteger(value, 'metric rank');
}

function optionalFinite(value, fieldName) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${fieldName} must be finite`);
  return number;
}

function positiveInteger(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be a positive integer`);
  return number;
}

function requireEpoch(value, fieldName) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${fieldName} must be epoch milliseconds`);
  return number;
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${fieldName} is required`);
  return value.trim();
}

function requireObject(value, fieldName) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${fieldName} must be an object`);
  }
  return value;
}
