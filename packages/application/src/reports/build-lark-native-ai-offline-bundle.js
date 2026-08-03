import {
  LARK_NATIVE_AI_AVAILABILITY_STATUSES,
  LARK_NATIVE_AI_CHANNELS,
  LARK_NATIVE_AI_COVERAGE_STATUSES,
  LARK_NATIVE_AI_EXECUTIVE_CHANNEL,
  LARK_NATIVE_AI_FRESHNESS_STATUSES,
  LARK_NATIVE_AI_INPUT_SCHEMA_VERSION,
  LARK_NATIVE_AI_OFFLINE_CONTRACT_VERSION,
  LARK_NATIVE_AI_RECOMMENDATION_LEVELS,
  LARK_NATIVE_AI_SUPPORTED_WINDOWS,
  resolveLarkNativeAiOfflineChannel,
} from '../../../config/src/lark-native-ai-offline-contract.js';
import { validateReportMaterializationPayload } from './report-materialization-payload.js';
import { stableStringify } from '../use-cases/build-report-snapshot.js';

const REPORT_BACKED_STATUSES = new Set([
  'complete', 'partial', 'no_data_confirmed', 'coverage_incomplete',
]);
const BUSINESS_EVIDENCE_STATUSES = new Set(['complete', 'partial', 'coverage_incomplete']);
const RATIO_UNITS = new Set(['ratio', 'percent', 'percentage', 'rate']);
const VALID_BASELINE_STATUSES = new Set(['complete', 'missing', 'not_applicable']);
const DATA_QUALITY_SEVERITIES = new Set(['info', 'warning', 'critical']);
const STATUS_EVIDENCE_SOURCE = 'shared_report_availability';

export class LarkNativeAiContractError extends TypeError {
  constructor(code, message) {
    super(message);
    this.name = 'LarkNativeAiContractError';
    this.code = code;
  }
}

/**
 * Build a deterministic, deeply frozen, platform-neutral input bundle for an offline Lark Native AI Preview.
 * The function accepts only Shared Report materializations or validated Shared Report availability evidence.
 */
export async function buildLarkNativeAiOfflineBundle(input = {}) {
  const customer = normalizeCustomer(input.customer);
  const window = normalizeWindow(input.window);
  const generation = normalizeGeneration(input.generation);
  const channelInputs = requireArray(input.channels, 'channels');
  const normalizedChannels = channelInputs.map((raw, index) => normalizeChannelEvidence(raw, index, window));
  assertExactChannelRegistry(normalizedChannels);
  assertUniqueEvidenceIdentity(normalizedChannels);

  const traceIndex = {};
  for (const channel of normalizedChannels) {
    for (const trace of channel.traces) {
      if (traceIndex[trace.traceId]) {
        fail('AI_TRACE_ID_DUPLICATE', `Duplicate numeric trace identity: ${trace.traceId}`);
      }
      traceIndex[trace.traceId] = trace;
    }
  }

  const executive = synthesizeExecutiveChannel(normalizedChannels);
  const currencies = Object.freeze([...new Set(normalizedChannels.flatMap((channel) => channel.currencies))].sort());
  const unsignedBundle = {
    schemaVersion: LARK_NATIVE_AI_INPUT_SCHEMA_VERSION,
    contractVersion: LARK_NATIVE_AI_OFFLINE_CONTRACT_VERSION,
    mode: 'offline_preview',
    customer,
    window,
    generation,
    channels: Object.freeze([...normalizedChannels, executive]),
    currencies,
    currencyPolicy: Object.freeze({
      mode: 'segregate',
      crossCurrencyAggregationAllowed: false,
      conversionEvidenceAccepted: false,
    }),
    traceIndex: Object.freeze(traceIndex),
    safety: Object.freeze({
      aiCallCount: 0,
      larkWriteCount: 0,
      remoteActionCount: 0,
      notificationCount: 0,
      scheduleEnabled: false,
      production: 'BLOCKED',
    }),
  };
  const bundleId = await sha256Hex(stableStringify(unsignedBundle));
  return deepFreeze({ ...unsignedBundle, bundleId });
}

function normalizeCustomer(value) {
  const customer = requireObject(value, 'customer');
  return Object.freeze({
    customerKey: requireIdentity(customer.customerKey ?? customer.customer_key, 'customer.customerKey'),
    displayName: requireText(customer.displayName ?? customer.display_name, 'customer.displayName'),
    profile: optionalIdentity(customer.profile) ?? null,
  });
}

function normalizeWindow(value) {
  const window = requireObject(value, 'window');
  const windowDays = positiveInteger(window.windowDays ?? window.window_days, 'window.windowDays');
  if (!LARK_NATIVE_AI_SUPPORTED_WINDOWS.includes(windowDays)) {
    fail('AI_WINDOW_UNSUPPORTED', `Unsupported AI window: ${windowDays}`);
  }
  const periodStart = requireDateOnly(window.periodStart ?? window.period_start, 'window.periodStart');
  const periodEnd = requireDateOnly(window.periodEnd ?? window.period_end, 'window.periodEnd');
  if (periodStart > periodEnd) fail('AI_WINDOW_INVALID', 'window periodStart must not be after periodEnd');
  const comparisonMode = optionalText(window.comparisonMode ?? window.comparison_mode) ?? 'none';
  if (!['none', 'previous_period'].includes(comparisonMode)) {
    fail('AI_COMPARISON_MODE_UNSUPPORTED', `Unsupported comparison mode: ${comparisonMode}`);
  }
  const compareStart = optionalDateOnly(window.compareStart ?? window.compare_start, 'window.compareStart');
  const compareEnd = optionalDateOnly(window.compareEnd ?? window.compare_end, 'window.compareEnd');
  if (comparisonMode === 'none' && (compareStart || compareEnd)) {
    fail('AI_COMPARISON_WINDOW_INVALID', 'comparisonMode=none cannot include comparison dates');
  }
  if (comparisonMode !== 'none' && (!compareStart || !compareEnd)) {
    fail('AI_COMPARISON_WINDOW_INVALID', 'comparison dates are required');
  }
  return Object.freeze({
    windowDays,
    periodStart,
    periodEnd,
    comparisonMode,
    compareStart,
    compareEnd,
  });
}

function normalizeGeneration(value) {
  const generation = requireObject(value, 'generation');
  return Object.freeze({
    generationId: requireIdentity(generation.generationId ?? generation.generation_id, 'generation.generationId'),
    generatedAt: requireEpoch(generation.generatedAt ?? generation.generated_at, 'generation.generatedAt'),
    generatorVersion: requireText(
      generation.generatorVersion ?? generation.generator_version,
      'generation.generatorVersion',
    ),
    language: optionalIdentity(generation.language) ?? 'th',
    timezone: optionalText(generation.timezone) ?? 'Asia/Bangkok',
  });
}

function normalizeChannelEvidence(value, index, window) {
  const raw = requireObject(value, `channels[${index}]`);
  const platform = requireIdentity(raw.platform, `channels[${index}].platform`);
  const channel = resolveLarkNativeAiOfflineChannel(platform);
  if (platform === LARK_NATIVE_AI_EXECUTIVE_CHANNEL.platform) {
    fail('AI_EXECUTIVE_INPUT_FORBIDDEN', 'Executive input is synthesized from channel evidence');
  }
  const capability = requireIdentity(raw.capability, `channels[${index}].capability`);
  if (capability !== channel.capability) {
    fail('AI_CHANNEL_CAPABILITY_MISMATCH', `${platform} capability must be ${channel.capability}`);
  }
  const availabilityStatus = requireChoice(
    raw.availabilityStatus ?? raw.availability_status,
    LARK_NATIVE_AI_AVAILABILITY_STATUSES,
    `channels[${index}].availabilityStatus`,
  );
  const coverageStatus = requireChoice(
    raw.coverageStatus ?? raw.coverage_status,
    LARK_NATIVE_AI_COVERAGE_STATUSES,
    `channels[${index}].coverageStatus`,
  );

  const evidence = REPORT_BACKED_STATUSES.has(availabilityStatus)
    ? normalizeReportEvidence(raw.report, { platform, capability, availabilityStatus, coverageStatus, window, index })
    : normalizeStatusEvidence(raw.statusEvidence ?? raw.status_evidence, {
      platform, capability, availabilityStatus, coverageStatus, index,
    });

  const recommendation = resolveRecommendationEligibility({
    availabilityStatus,
    coverageStatus,
    freshnessStatus: evidence.freshness.status,
    dataQualityIssues: evidence.dataQualityIssues,
    metrics: evidence.summaryMetrics,
  });

  return deepFreeze({
    platform,
    displayName: channel.displayName,
    capability,
    sectionId: channel.sectionId,
    availabilityStatus,
    coverageStatus,
    availabilityMessage: requireText(
      raw.availabilityMessage ?? raw.availability_message,
      `channels[${index}].availabilityMessage`,
    ),
    reportIdentity: evidence.reportIdentity,
    evidenceIdentity: evidence.evidenceIdentity,
    source: evidence.source,
    summaryMetrics: evidence.summaryMetrics,
    dimensionedMetrics: evidence.dimensionedMetrics,
    topContent: evidence.topContent,
    topAds: evidence.topAds,
    commerceRankings: evidence.commerceRankings,
    agentInboxRankings: evidence.agentInboxRankings,
    currencies: evidence.currencies,
    warnings: evidence.warnings,
    freshness: evidence.freshness,
    dataQualityIssues: evidence.dataQualityIssues,
    recommendationEligibility: recommendation,
    traces: evidence.traces,
  });
}

function normalizeReportEvidence(value, context) {
  const label = `channels[${context.index}].report`;
  const report = requireObject(value, label);
  assertValidatedFrozenEvidence(report, label);
  if (report.unvalidatedPreview === true || report.unvalidated_preview === true) {
    fail('AI_UNVALIDATED_PREVIEW_FORBIDDEN', `${label} cannot be an unvalidated Report preview`);
  }
  const payload = validateReportMaterializationPayload(report.payload);
  const reportId = requireIdentity(report.reportId ?? report.report_id ?? payload.sourceReportId, `${label}.reportId`);
  if (payload.sourceReportId && payload.sourceReportId !== reportId) {
    fail('AI_REPORT_IDENTITY_MISMATCH', `${label}.reportId does not match payload.sourceReportId`);
  }
  if (payload.platformScope !== context.platform || payload.capability !== context.capability) {
    fail('AI_REPORT_IDENTITY_MISMATCH', `${label} platform/capability does not match channel identity`);
  }
  if (!matchesWindow(payload.period, context.window)) {
    fail('AI_REPORT_WINDOW_MISMATCH', `${label} period does not match the requested AI window`);
  }
  assertAvailabilityMatchesPayload(context.availabilityStatus, payload.dataStatus, label);
  if (context.availabilityStatus === 'coverage_incomplete'
    && context.coverageStatus !== 'incomplete') {
    fail('AI_COVERAGE_STATUS_MISMATCH', 'coverage_incomplete requires coverageStatus=incomplete');
  }
  if (context.availabilityStatus === 'complete'
    && context.coverageStatus !== 'complete') {
    fail('AI_COVERAGE_STATUS_MISMATCH', 'complete availability requires complete coverage');
  }

  const rawMetrics = requireArray(report.metricValues ?? report.metric_values ?? [], `${label}.metricValues`);
  const metrics = rawMetrics.map((metric, metricIndex) => normalizeMetric(metric, {
    reportId,
    platform: context.platform,
    capability: context.capability,
    label: `${label}.metricValues[${metricIndex}]`,
  }));
  assertMetricIdentitiesUnique(metrics, label);
  assertPaidAdsRatioProvenance(metrics, context, label);
  assertWeightedAverageProvenance(metrics, label);

  const summaryMetrics = metrics.filter((metric) => metric.metricScope === 'summary'
    && metric.dimensionType === 'summary');
  const dimensionedMetrics = metrics.filter((metric) => !summaryMetrics.includes(metric));
  const topContent = normalizeRankingRows(report.topContent ?? report.top_content ?? payload.topContent, `${label}.topContent`);
  const topAds = normalizeRankingRows(report.topAds ?? report.top_ads ?? payload.topAds, `${label}.topAds`);
  const collections = payload.collections ?? {};
  const commerceRankings = normalizeRankingRows(
    report.commerceRankings ?? report.commerce_rankings
      ?? collections.commerce_rankings ?? collections.product_rankings ?? [],
    `${label}.commerceRankings`,
  );
  const agentInboxRankings = normalizeRankingRows(
    report.agentInboxRankings ?? report.agent_inbox_rankings
      ?? collections.agent_inbox_rankings ?? [
        ...(collections.agent_rankings ?? []),
        ...(collections.inbox_rankings ?? []),
      ],
    `${label}.agentInboxRankings`,
  );
  const warnings = normalizeMessages(report.warnings ?? [], `${label}.warnings`);
  const dataQualityIssues = normalizeDataQualityIssues(
    report.dataQualityIssues ?? report.data_quality_issues ?? [],
    `${label}.dataQualityIssues`,
  );
  const freshness = normalizeFreshness(report.freshness, `${label}.freshness`, payload.generatedAt);
  const reportCurrency = optionalCurrency(report.currency);
  const currencies = Object.freeze([...new Set([
    ...(reportCurrency ? [reportCurrency] : []),
    ...metrics.map((metric) => metric.currency).filter(Boolean),
  ])].sort());
  const traces = Object.freeze(metrics.flatMap((metric) => buildMetricTraces(reportId, metric)));

  return deepFreeze({
    reportIdentity: Object.freeze({
      reportId,
      reportSettingKey: requireIdentity(
        report.reportSettingKey ?? report.report_setting_key,
        `${label}.reportSettingKey`,
      ),
      schemaVersion: payload.schemaVersion,
      sourceWatermark: payload.sourceWatermark,
      generatedAt: payload.generatedAt,
    }),
    evidenceIdentity: `report:${reportId}`,
    source: payload.source,
    summaryMetrics,
    dimensionedMetrics,
    topContent,
    topAds,
    commerceRankings,
    agentInboxRankings,
    currencies,
    warnings,
    freshness,
    dataQualityIssues,
    traces,
  });
}

function normalizeStatusEvidence(value, context) {
  const label = `channels[${context.index}].statusEvidence`;
  const status = requireObject(value, label);
  assertValidatedFrozenEvidence(status, label);
  const source = requireIdentity(status.source, `${label}.source`);
  if (source !== STATUS_EVIDENCE_SOURCE) {
    fail('AI_STATUS_EVIDENCE_SOURCE_INVALID', `${label}.source must be ${STATUS_EVIDENCE_SOURCE}`);
  }
  if (status.platform !== context.platform || status.capability !== context.capability) {
    fail('AI_STATUS_IDENTITY_MISMATCH', `${label} platform/capability does not match channel identity`);
  }
  if (status.availabilityStatus !== context.availabilityStatus
    && status.availability_status !== context.availabilityStatus) {
    fail('AI_STATUS_IDENTITY_MISMATCH', `${label} availability status does not match channel identity`);
  }
  const evidenceId = requireIdentity(status.evidenceId ?? status.evidence_id, `${label}.evidenceId`);
  return deepFreeze({
    reportIdentity: null,
    evidenceIdentity: `status:${evidenceId}`,
    source,
    summaryMetrics: [],
    dimensionedMetrics: [],
    topContent: [],
    topAds: [],
    commerceRankings: [],
    agentInboxRankings: [],
    currencies: [],
    warnings: normalizeMessages(status.warnings ?? [], `${label}.warnings`),
    freshness: normalizeFreshness(status.freshness, `${label}.freshness`, status.generatedAt ?? status.generated_at),
    dataQualityIssues: normalizeDataQualityIssues(
      status.dataQualityIssues ?? status.data_quality_issues ?? [],
      `${label}.dataQualityIssues`,
    ),
    traces: [],
  });
}

function normalizeMetric(value, context) {
  const raw = requireObject(value, context.label);
  const metricKey = requireIdentity(raw.metric_key ?? raw.metricKey, `${context.label}.metricKey`);
  const metricScope = optionalIdentity(raw.metric_scope ?? raw.metricScope) ?? 'summary';
  const dimensionType = optionalIdentity(raw.dimension_type ?? raw.dimensionType) ?? 'summary';
  const dimensionValue = normalizeUntrustedText(raw.dimension_value ?? raw.dimensionValue ?? 'all', `${context.label}.dimensionValue`);
  const availabilityStatus = optionalIdentity(raw.availability_status ?? raw.availabilityStatus)
    ?? ((raw.current_value ?? raw.currentValue) == null ? 'not_available' : 'available');
  if (!['available', 'baseline_incomplete', 'coverage_incomplete', 'not_available'].includes(availabilityStatus)) {
    fail('AI_METRIC_AVAILABILITY_UNSUPPORTED', `${context.label} availability status is unsupported`);
  }
  const currentValue = optionalFinite(raw.current_value ?? raw.currentValue, `${context.label}.currentValue`);
  const compareValue = optionalFinite(raw.compare_value ?? raw.compareValue, `${context.label}.compareValue`);
  const changeValue = optionalFinite(raw.change_value ?? raw.changeValue, `${context.label}.changeValue`);
  const changePercent = optionalFinite(raw.change_percent ?? raw.changePercent, `${context.label}.changePercent`);
  if (availabilityStatus === 'available' && currentValue === null) {
    fail('AI_AVAILABLE_METRIC_VALUE_MISSING', `${context.label} available metric must have a value`);
  }
  if (availabilityStatus !== 'available' && currentValue !== null && availabilityStatus !== 'coverage_incomplete') {
    fail('AI_UNAVAILABLE_METRIC_HAS_VALUE', `${context.label} unavailable metric cannot expose a value`);
  }
  const baselineStatus = optionalIdentity(raw.baseline_status ?? raw.baselineStatus)
    ?? (compareValue === null ? 'missing' : 'complete');
  if (!VALID_BASELINE_STATUSES.has(baselineStatus)) {
    fail('AI_BASELINE_STATUS_UNSUPPORTED', `${context.label} baseline status is unsupported`);
  }
  const aggregationMethod = optionalIdentity(raw.aggregation_method ?? raw.aggregationMethod) ?? 'direct_observation';
  const currency = optionalCurrency(raw.currency);
  const metricIdentity = [
    context.reportId,
    metricKey,
    metricScope,
    dimensionType,
    dimensionValue,
  ].join('::');
  return deepFreeze({
    metricIdentity,
    reportId: context.reportId,
    metricKey,
    displayName: normalizeUntrustedText(raw.display_name ?? raw.displayName ?? metricKey, `${context.label}.displayName`),
    currentValue,
    compareValue,
    changeValue,
    changePercent,
    unit: optionalIdentity(raw.unit) ?? 'count',
    currency,
    availabilityStatus,
    availabilityMessage: optionalText(raw.availability_message ?? raw.availabilityMessage),
    metricScope,
    dimensionType,
    dimensionValue,
    rank: positiveInteger(raw.rank ?? 1, `${context.label}.rank`),
    baselineStatus,
    trendEligible: availabilityStatus === 'available' && compareValue !== null && baselineStatus === 'complete',
    aggregationMethod,
    numeratorMetricKey: optionalIdentity(raw.ratio_numerator_metric_key ?? raw.numeratorMetricKey),
    denominatorMetricKey: optionalIdentity(raw.ratio_denominator_metric_key ?? raw.denominatorMetricKey),
    weightMetricKey: optionalIdentity(raw.weight_metric_key ?? raw.weightMetricKey),
    observed: raw.observed !== false,
  });
}

function assertPaidAdsRatioProvenance(metrics, context, label) {
  if (context.capability !== 'paid_ads') return;
  const metricKeys = new Set(metrics.map((metric) => metric.metricKey));
  for (const metric of metrics) {
    if (!RATIO_UNITS.has(metric.unit)) continue;
    if (metric.aggregationMethod !== 'sum_before_ratio') {
      fail('AI_ADS_RATIO_PROVENANCE_INVALID', `${label} paid Ads ratio must use sum_before_ratio`);
    }
    if (!metric.numeratorMetricKey || !metric.denominatorMetricKey
      || !metricKeys.has(metric.numeratorMetricKey)
      || !metricKeys.has(metric.denominatorMetricKey)) {
      fail('AI_ADS_RATIO_PROVENANCE_INVALID', `${label} paid Ads ratio must identify numerator and denominator metrics`);
    }
  }
}

function assertWeightedAverageProvenance(metrics, label) {
  const metricKeys = new Set(metrics.map((metric) => metric.metricKey));
  for (const metric of metrics) {
    if (metric.aggregationMethod !== 'average_of_averages') continue;
    if (!metric.weightMetricKey || !metricKeys.has(metric.weightMetricKey)) {
      fail('AI_AVERAGE_OF_AVERAGES_UNWEIGHTED', `${label} average-of-averages requires an exact weight metric`);
    }
  }
}

function buildMetricTraces(reportId, metric) {
  const traces = [];
  for (const [field, value] of [
    ['current', metric.currentValue],
    ['compare', metric.compareValue],
    ['change', metric.changeValue],
    ['change_percent', metric.changePercent],
  ]) {
    if (value === null) continue;
    traces.push(Object.freeze({
      traceId: `${metric.metricIdentity}::${field}`,
      reportId,
      metricIdentity: metric.metricIdentity,
      metricKey: metric.metricKey,
      field,
      value,
      unit: metric.unit,
      currency: metric.currency,
      aggregationMethod: metric.aggregationMethod,
      trendEligible: field === 'current' ? metric.trendEligible : true,
    }));
  }
  return traces;
}

function normalizeRankingRows(value, label) {
  return Object.freeze(requireArray(value ?? [], label).map((row, index) => {
    const normalized = requireObject(row, `${label}[${index}]`);
    return deepFreeze(JSON.parse(stableStringify(normalized)));
  }));
}

function normalizeMessages(value, label) {
  return Object.freeze(requireArray(value, label).map((item, index) => {
    if (typeof item === 'string') return Object.freeze({ code: null, message: normalizeUntrustedText(item, `${label}[${index}]`) });
    const raw = requireObject(item, `${label}[${index}]`);
    return Object.freeze({
      code: optionalIdentity(raw.code),
      message: normalizeUntrustedText(raw.message, `${label}[${index}].message`),
    });
  }));
}

function normalizeDataQualityIssues(value, label) {
  return Object.freeze(requireArray(value, label).map((item, index) => {
    const raw = requireObject(item, `${label}[${index}]`);
    const severity = requireIdentity(raw.severity, `${label}[${index}].severity`);
    if (!DATA_QUALITY_SEVERITIES.has(severity)) {
      fail('AI_DATA_QUALITY_SEVERITY_UNSUPPORTED', `${label}[${index}] severity is unsupported`);
    }
    return Object.freeze({
      code: requireIdentity(raw.code, `${label}[${index}].code`),
      severity,
      message: normalizeUntrustedText(raw.message, `${label}[${index}].message`),
    });
  }));
}

function normalizeFreshness(value, label, fallbackGeneratedAt) {
  const freshness = requireObject(value ?? {}, label);
  const status = requireChoice(
    freshness.status ?? 'unknown',
    LARK_NATIVE_AI_FRESHNESS_STATUSES,
    `${label}.status`,
  );
  return Object.freeze({
    status,
    asOf: requireEpoch(freshness.asOf ?? freshness.as_of ?? fallbackGeneratedAt, `${label}.asOf`),
    message: optionalText(freshness.message),
  });
}

function resolveRecommendationEligibility(input) {
  let level = 'none';
  let reason = 'availability_not_eligible';
  if (BUSINESS_EVIDENCE_STATUSES.has(input.availabilityStatus)) {
    level = input.availabilityStatus === 'complete' && input.coverageStatus === 'complete' ? 'full' : 'limited';
    reason = level === 'full' ? 'validated_complete_evidence' : 'validated_limited_evidence';
  }
  if (input.freshnessStatus !== 'fresh') {
    level = 'none';
    reason = input.freshnessStatus === 'stale' ? 'stale_report' : 'freshness_unknown';
  }
  if (input.dataQualityIssues.some(({ severity }) => severity === 'critical')) {
    level = 'none';
    reason = 'critical_data_quality_issue';
  }
  if (level === 'full' && input.metrics.some((metric) => metric.baselineStatus === 'missing')) {
    level = 'limited';
    reason = 'baseline_incomplete';
  }
  if (!LARK_NATIVE_AI_RECOMMENDATION_LEVELS.includes(level)) {
    fail('AI_RECOMMENDATION_LEVEL_INVALID', `Unsupported recommendation level: ${level}`);
  }
  return Object.freeze({ level, reason, trendRecommendationsAllowed: level !== 'none'
    && input.metrics.some((metric) => metric.trendEligible) });
}

function synthesizeExecutiveChannel(channels) {
  const usable = channels.filter((channel) => BUSINESS_EVIDENCE_STATUSES.has(channel.availabilityStatus));
  const unavailable = channels.filter((channel) => ['unavailable', 'source_pending'].includes(channel.availabilityStatus));
  const incomplete = channels.filter((channel) => ['partial', 'coverage_incomplete'].includes(channel.availabilityStatus));
  const availabilityStatus = usable.length === 0
    ? (unavailable.length === channels.length ? 'unavailable' : 'source_pending')
    : (usable.length === channels.length && incomplete.length === 0 ? 'complete' : 'partial');
  const coverageStatus = usable.length === channels.length && incomplete.length === 0 ? 'complete' : 'partial';
  const critical = channels.some((channel) => channel.dataQualityIssues.some(({ severity }) => severity === 'critical'));
  const recommendationLevel = critical || usable.length === 0
    ? 'none'
    : (availabilityStatus === 'complete' ? 'full' : 'limited');
  return deepFreeze({
    platform: 'executive',
    displayName: LARK_NATIVE_AI_EXECUTIVE_CHANNEL.displayName,
    capability: LARK_NATIVE_AI_EXECUTIVE_CHANNEL.capability,
    sectionId: LARK_NATIVE_AI_EXECUTIVE_CHANNEL.sectionId,
    availabilityStatus,
    coverageStatus,
    availabilityMessage: executiveAvailabilityMessage(channels, usable),
    reportIdentity: null,
    evidenceIdentity: `executive:${channels.map((channel) => channel.evidenceIdentity).join('|')}`,
    source: 'derived_from_validated_report_bundle',
    summaryMetrics: [],
    dimensionedMetrics: [],
    topContent: [],
    topAds: [],
    commerceRankings: [],
    agentInboxRankings: [],
    currencies: Object.freeze([...new Set(channels.flatMap((channel) => channel.currencies))].sort()),
    warnings: Object.freeze([]),
    freshness: Object.freeze({
      status: channels.every((channel) => channel.freshness.status === 'fresh') ? 'fresh' : 'unknown',
      asOf: Math.min(...channels.map((channel) => channel.freshness.asOf)),
      message: null,
    }),
    dataQualityIssues: Object.freeze([]),
    recommendationEligibility: Object.freeze({
      level: recommendationLevel,
      reason: critical ? 'critical_data_quality_issue' : (usable.length === 0 ? 'availability_not_eligible' : 'cross_channel_evidence'),
      trendRecommendationsAllowed: false,
    }),
    traces: Object.freeze([]),
    channelStatusVector: Object.freeze(channels.map((channel) => Object.freeze({
      platform: channel.platform,
      availabilityStatus: channel.availabilityStatus,
      coverageStatus: channel.coverageStatus,
      freshnessStatus: channel.freshness.status,
      recommendationLevel: channel.recommendationEligibility.level,
    }))),
  });
}

function executiveAvailabilityMessage(channels, usable) {
  const missing = channels.length - usable.length;
  if (missing === 0) return 'Validated Report evidence is available for every channel.';
  if (usable.length === 0) return 'No validated business Report evidence is available for Executive analysis.';
  return `Validated Report evidence is available for ${usable.length} channels; ${missing} channels remain limited or unavailable.`;
}

function assertExactChannelRegistry(channels) {
  const expected = LARK_NATIVE_AI_CHANNELS.map(({ platform }) => platform).sort();
  const actual = channels.map(({ platform }) => platform).sort();
  if (stableStringify(actual) !== stableStringify(expected)) {
    fail('AI_CHANNEL_REGISTRY_INCOMPLETE', `channels must contain exactly: ${expected.join(', ')}`);
  }
}

function assertUniqueEvidenceIdentity(channels) {
  const evidenceIds = new Set();
  const reportIds = new Set();
  for (const channel of channels) {
    const reportId = channel.reportIdentity?.reportId;
    if (reportId && reportIds.has(reportId)) {
      fail('AI_REPORT_IDENTITY_DUPLICATE', `Duplicate Report identity: ${reportId}`);
    }
    if (reportId) reportIds.add(reportId);
    if (evidenceIds.has(channel.evidenceIdentity)) {
      fail('AI_EVIDENCE_IDENTITY_DUPLICATE', `Duplicate evidence identity: ${channel.evidenceIdentity}`);
    }
    evidenceIds.add(channel.evidenceIdentity);
  }
}

function assertMetricIdentitiesUnique(metrics, label) {
  const seen = new Set();
  for (const metric of metrics) {
    if (seen.has(metric.metricIdentity)) {
      fail('AI_METRIC_IDENTITY_DUPLICATE', `${label} contains duplicate metric identity ${metric.metricIdentity}`);
    }
    seen.add(metric.metricIdentity);
  }
}

function assertValidatedFrozenEvidence(evidence, label) {
  if (evidence.validationStatus !== 'validated' && evidence.validation_status !== 'validated') {
    fail('AI_EVIDENCE_NOT_VALIDATED', `${label} must have validationStatus=validated`);
  }
  if (evidence.frozen !== true) {
    fail('AI_EVIDENCE_NOT_FROZEN', `${label} must be marked frozen`);
  }
}

function assertAvailabilityMatchesPayload(availabilityStatus, dataStatus, label) {
  const accepted = {
    complete: new Set(['complete']),
    partial: new Set(['partial', 'revisable']),
    coverage_incomplete: new Set(['partial', 'revisable']),
    no_data_confirmed: new Set(['no_data_confirmed']),
  }[availabilityStatus];
  if (!accepted?.has(dataStatus)) {
    fail('AI_AVAILABILITY_PAYLOAD_MISMATCH', `${label} dataStatus=${dataStatus} does not match ${availabilityStatus}`);
  }
}

function matchesWindow(period, window) {
  return period.periodKind === 'rolling_days'
    && period.windowDays === window.windowDays
    && period.periodStart === window.periodStart
    && period.periodEnd === window.periodEnd
    && period.comparisonMode === window.comparisonMode
    && (period.compareStart ?? null) === window.compareStart
    && (period.compareEnd ?? null) === window.compareEnd;
}

async function sha256Hex(value) {
  if (!globalThis.crypto?.subtle) throw new Error('Web Crypto SHA-256 is required');
  const bytes = new TextEncoder().encode(value);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

function deepFreeze(value, seen = new WeakSet()) {
  if (value && typeof value === 'object') {
    if (seen.has(value)) return value;
    seen.add(value);
    for (const nested of Object.values(value)) deepFreeze(nested, seen);
    Object.freeze(value);
  }
  return value;
}

function normalizeUntrustedText(value, label) {
  const text = requireText(value, label).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/gu, ' ');
  if (text.length > 500) fail('AI_UNTRUSTED_TEXT_TOO_LONG', `${label} exceeds 500 characters`);
  return text;
}

function optionalCurrency(value) {
  const currency = optionalIdentity(value);
  if (!currency) return null;
  if (!/^[A-Z]{3}$/u.test(currency)) fail('AI_CURRENCY_INVALID', `Invalid currency: ${currency}`);
  return currency;
}

function requireDateOnly(value, label) {
  const text = requireText(value, label);
  if (!/^\d{4}-\d{2}-\d{2}$/u.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00.000Z`))) {
    fail('AI_DATE_INVALID', `${label} must be YYYY-MM-DD`);
  }
  return text;
}

function optionalDateOnly(value, label) {
  if (value === null || value === undefined || value === '') return null;
  return requireDateOnly(value, label);
}

function requireEpoch(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 0) fail('AI_EPOCH_INVALID', `${label} must be epoch milliseconds`);
  return number;
}

function optionalFinite(value, label) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) fail('AI_NUMBER_INVALID', `${label} must be finite`);
  return number;
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) fail('AI_INTEGER_INVALID', `${label} must be a positive integer`);
  return number;
}

function requireChoice(value, choices, label) {
  const text = requireIdentity(value, label);
  if (!choices.includes(text)) fail('AI_CHOICE_UNSUPPORTED', `${label} is unsupported: ${text}`);
  return text;
}

function requireIdentity(value, label) {
  const text = requireText(value, label);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,199}$/u.test(text)) {
    fail('AI_IDENTITY_INVALID', `${label} contains an invalid identity`);
  }
  return text;
}

function optionalIdentity(value) {
  if (value === null || value === undefined || value === '') return null;
  return requireIdentity(value, 'identity');
}

function optionalText(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function requireText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') fail('AI_REQUIRED_TEXT_MISSING', `${label} is required`);
  return value.trim();
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail('AI_OBJECT_REQUIRED', `${label} must be an object`);
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) fail('AI_ARRAY_REQUIRED', `${label} must be an array`);
  return value;
}

function fail(code, message) {
  throw new LarkNativeAiContractError(code, message);
}
