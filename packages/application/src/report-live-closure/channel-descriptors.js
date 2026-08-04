import {
  REPORT_PLATFORM_CAPABILITY,
  getReportPlatformContract,
  listReportPlatformContracts,
} from '../reports/report-platform-adapter-registry.js';

export const REPORT_LIVE_CLOSURE_WINDOWS = Object.freeze([1, 3, 7, 30]);

export const REPORT_LIVE_CLOSURE_LARK_OUTPUTS = Object.freeze({
  SNAPSHOTS: 'mktReportSnapshots',
  METRIC_VALUES: 'mktReportMetricValues',
  TOP_CONTENT: 'mktReportTopContent',
  TOP_ADS: 'mktReportTopAds',
});

const GENERIC_REPORT_ACTIVE_FLAGS = Object.freeze([
  'MKT_REPORT_D1_READ_ENABLED',
  'MKT_REPORT_PRESET_MATERIALIZATION_ENABLED',
]);
const REPORT_FLAGS_THAT_MUST_REMAIN_FALSE = Object.freeze([
  'MKT_REPORT_AI_SUMMARY_ENABLED',
  'MKT_SCHEDULE_DAILY_REPORT_ENABLED',
  'MKT_SCHEDULE_WEEKLY_REPORT_ENABLED',
]);
const KNOWN_OUTPUTS = new Set(Object.values(REPORT_LIVE_CLOSURE_LARK_OUTPUTS));

const SOURCE_DESCRIPTORS = listReportPlatformContracts().map((contract) => {
  const rankingOutput = contract.capability === REPORT_PLATFORM_CAPABILITY.ORGANIC
    ? REPORT_LIVE_CLOSURE_LARK_OUTPUTS.TOP_CONTENT
    : contract.capability === REPORT_PLATFORM_CAPABILITY.PAID_ADS
      ? REPORT_LIVE_CLOSURE_LARK_OUTPUTS.TOP_ADS
      : null;
  const safeRuntimeFlags = contract.platformScope === 'woocommerce'
    ? Object.freeze([...GENERIC_REPORT_ACTIVE_FLAGS, 'MKT_WOOCOMMERCE_REPORT_READ_ENABLED'])
    : GENERIC_REPORT_ACTIVE_FLAGS;
  return Object.freeze({
    platform: contract.platformScope,
    capability: contract.capability,
    sourceStatus: contract.sourceStatus,
    datasetKey: contract.datasetKey,
    formulaVersion: contract.formulaVersion,
    sourceReader: 'createReportPlatformAdapterRegistry',
    topEntityType: contract.capability === REPORT_PLATFORM_CAPABILITY.ORGANIC
      ? 'content'
      : contract.capability === REPORT_PLATFORM_CAPABILITY.PAID_ADS ? 'ad' : null,
    currencyMode: contract.capability === REPORT_PLATFORM_CAPABILITY.PAID_ADS
      ? 'account'
      : contract.capability === REPORT_PLATFORM_CAPABILITY.COMMERCE ? 'dimensioned' : 'none',
    supportedWindows: REPORT_LIVE_CLOSURE_WINDOWS,
    readinessAuthority: 'getReportPlatformContract',
    coverageAuthority: 'data_coverage_runs',
    metricProjection: Object.freeze({
      summary: 'buildReportMetricValueRows',
      ranking: rankingOutput === REPORT_LIVE_CLOSURE_LARK_OUTPUTS.TOP_CONTENT
        ? 'buildReportTopContentRows'
        : rankingOutput === REPORT_LIVE_CLOSURE_LARK_OUTPUTS.TOP_ADS
          ? 'buildReportTopAdsRows'
          : null,
    }),
    requiredLarkOutputs: Object.freeze([
      REPORT_LIVE_CLOSURE_LARK_OUTPUTS.SNAPSHOTS,
      REPORT_LIVE_CLOSURE_LARK_OUTPUTS.METRIC_VALUES,
      ...(rankingOutput ? [rankingOutput] : []),
    ]),
    safeRuntimeFlags,
    mustRemainFalseRuntimeFlags: REPORT_FLAGS_THAT_MUST_REMAIN_FALSE,
    structuralOnly: false,
  });
});

const DERIVED_DESCRIPTORS = Object.freeze([
  Object.freeze({
    platform: 'operations',
    capability: 'operations',
    sourceStatus: 'derived',
    datasetKey: 'report_runtime_evidence',
    formulaVersion: 'operations-report-v1',
    sourceReader: 'validated_report_materializations',
    topEntityType: null,
    currencyMode: 'none',
    supportedWindows: REPORT_LIVE_CLOSURE_WINDOWS,
    readinessAuthority: 'assertReportRuntimeFinalizerEvidence',
    coverageAuthority: 'report_materializations',
    metricProjection: Object.freeze({ summary: 'buildReportMetricValueRows', ranking: null }),
    requiredLarkOutputs: Object.freeze([
      REPORT_LIVE_CLOSURE_LARK_OUTPUTS.SNAPSHOTS,
      REPORT_LIVE_CLOSURE_LARK_OUTPUTS.METRIC_VALUES,
    ]),
    safeRuntimeFlags: GENERIC_REPORT_ACTIVE_FLAGS,
    mustRemainFalseRuntimeFlags: REPORT_FLAGS_THAT_MUST_REMAIN_FALSE,
    structuralOnly: true,
  }),
  Object.freeze({
    platform: 'executive',
    capability: 'aggregation',
    sourceStatus: 'derived',
    datasetKey: 'validated_report_materializations',
    formulaVersion: 'executive-aggregation-v1',
    sourceReader: 'validated_report_materializations',
    topEntityType: null,
    currencyMode: 'dimensioned',
    supportedWindows: REPORT_LIVE_CLOSURE_WINDOWS,
    readinessAuthority: 'assertReportRuntimeFinalizerEvidence',
    coverageAuthority: 'report_materializations',
    metricProjection: Object.freeze({ summary: 'buildReportMetricValueRows', ranking: null }),
    requiredLarkOutputs: Object.freeze([
      REPORT_LIVE_CLOSURE_LARK_OUTPUTS.SNAPSHOTS,
      REPORT_LIVE_CLOSURE_LARK_OUTPUTS.METRIC_VALUES,
    ]),
    safeRuntimeFlags: GENERIC_REPORT_ACTIVE_FLAGS,
    mustRemainFalseRuntimeFlags: REPORT_FLAGS_THAT_MUST_REMAIN_FALSE,
    structuralOnly: true,
  }),
]);

export const REPORT_LIVE_CLOSURE_CHANNELS = Object.freeze([
  ...SOURCE_DESCRIPTORS,
  ...DERIVED_DESCRIPTORS,
]);

const DESCRIPTORS = new Map(REPORT_LIVE_CLOSURE_CHANNELS.map((descriptor) => [
  `${descriptor.platform}:${descriptor.capability}`,
  descriptor,
]));

export function getReportLiveClosureDescriptor(platform, capability) {
  const key = `${normalizeText(platform)}:${normalizeText(capability)}`;
  const descriptor = DESCRIPTORS.get(key);
  if (!descriptor) throw closureDescriptorError(
    `Unsupported Report Live Closure descriptor ${key}`,
    'REPORT_LIVE_CLOSURE_DESCRIPTOR_NOT_FOUND',
    { platform, capability },
  );
  assertReportLiveClosureDescriptor(descriptor);
  return descriptor;
}

export function assertReportLiveClosureDescriptor(descriptor) {
  const requiredText = [
    'platform', 'capability', 'sourceStatus', 'datasetKey', 'formulaVersion',
    'sourceReader', 'currencyMode', 'readinessAuthority', 'coverageAuthority',
  ];
  for (const field of requiredText) {
    if (typeof descriptor?.[field] !== 'string' || descriptor[field].trim() === '') throw closureDescriptorError(
      `Descriptor ${field} is required`,
      'REPORT_LIVE_CLOSURE_DESCRIPTOR_INVALID',
      { field },
    );
  }
  if (JSON.stringify(descriptor.supportedWindows) !== JSON.stringify(REPORT_LIVE_CLOSURE_WINDOWS)) throw closureDescriptorError(
    'Descriptor windows must be exactly 1/3/7/30',
    'REPORT_LIVE_CLOSURE_WINDOWS_INVALID',
    { observed: descriptor.supportedWindows ?? null },
  );
  if (!descriptor.structuralOnly) {
    const contract = getReportPlatformContract(descriptor.platform);
    if (contract.capability !== descriptor.capability
      || contract.datasetKey !== descriptor.datasetKey
      || contract.formulaVersion !== descriptor.formulaVersion) throw closureDescriptorError(
      'Descriptor diverges from the shared Report platform contract',
      'REPORT_LIVE_CLOSURE_PLATFORM_CONTRACT_DRIFT',
      { platform: descriptor.platform },
    );
  }
  if (descriptor.metricProjection?.summary !== 'buildReportMetricValueRows') throw closureDescriptorError(
    'Descriptor must use the existing generic Report metric projection',
    'REPORT_LIVE_CLOSURE_DESCRIPTOR_INVALID',
    { field: 'metricProjection.summary' },
  );
  if (!Array.isArray(descriptor.requiredLarkOutputs)
    || descriptor.requiredLarkOutputs.length < 2
    || descriptor.requiredLarkOutputs.some((output) => !KNOWN_OUTPUTS.has(output))) throw closureDescriptorError(
    'Descriptor may target only existing generic Report Lark outputs',
    'REPORT_LIVE_CLOSURE_DESCRIPTOR_INVALID',
    { field: 'requiredLarkOutputs' },
  );
  if (!Array.isArray(descriptor.safeRuntimeFlags) || descriptor.safeRuntimeFlags.length === 0) throw closureDescriptorError(
    'Descriptor safeRuntimeFlags must bind the reviewed Report runtime window',
    'REPORT_LIVE_CLOSURE_DESCRIPTOR_INVALID',
    { field: 'safeRuntimeFlags' },
  );
  if (!Array.isArray(descriptor.mustRemainFalseRuntimeFlags)
    || descriptor.mustRemainFalseRuntimeFlags.length === 0) throw closureDescriptorError(
    'Descriptor must declare AI and schedule flags that remain false',
    'REPORT_LIVE_CLOSURE_DESCRIPTOR_INVALID',
    { field: 'mustRemainFalseRuntimeFlags' },
  );
  return true;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function closureDescriptorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportLiveClosureDescriptorError';
  error.code = code;
  error.details = details;
  return error;
}
