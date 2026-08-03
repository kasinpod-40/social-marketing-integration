export const REPORT_LIVE_CLOSURE_WINDOWS = Object.freeze([1, 3, 7, 30]);

export const REPORT_LIVE_CLOSURE_CHANNELS = Object.freeze([
  Object.freeze({ platform: 'tiktok', capability: 'organic', sourceReader: 'tiktok_organic', topEntityType: 'content', currencyMode: 'none' }),
  Object.freeze({ platform: 'youtube', capability: 'organic', sourceReader: 'youtube_organic', topEntityType: 'content', currencyMode: 'none' }),
  Object.freeze({ platform: 'instagram', capability: 'organic', sourceReader: 'instagram_organic', topEntityType: 'content', currencyMode: 'none' }),
  Object.freeze({ platform: 'facebook', capability: 'organic', sourceReader: 'facebook_organic', topEntityType: 'content', currencyMode: 'none' }),
  Object.freeze({ platform: 'meta', capability: 'ads', sourceReader: 'meta_ads', topEntityType: 'ad', currencyMode: 'account' }),
  Object.freeze({ platform: 'google', capability: 'ads', sourceReader: 'google_ads', topEntityType: 'ad', currencyMode: 'account' }),
  Object.freeze({ platform: 'tiktok', capability: 'ads', sourceReader: 'tiktok_ads', topEntityType: 'ad', currencyMode: 'account' }),
  Object.freeze({ platform: 'woocommerce', capability: 'commerce', sourceReader: 'woocommerce_commerce', topEntityType: 'product', currencyMode: 'dimensioned' }),
  Object.freeze({ platform: 'chatwoot', capability: 'customer_service', sourceReader: 'chatwoot', topEntityType: 'inbox', currencyMode: 'none' }),
  Object.freeze({ platform: 'operations', capability: 'operations', sourceReader: 'operations', topEntityType: 'operation', currencyMode: 'none' }),
  Object.freeze({ platform: 'executive', capability: 'aggregation', sourceReader: 'executive', topEntityType: 'channel', currencyMode: 'dimensioned' }),
].map((descriptor) => Object.freeze({
  ...descriptor,
  supportedWindows: REPORT_LIVE_CLOSURE_WINDOWS,
  readinessAuthority: `${descriptor.sourceReader}_readiness`,
  coverageAuthority: `${descriptor.sourceReader}_coverage`,
  metricProjection: `${descriptor.sourceReader}_metric_projection`,
  requiredLarkOutputs: Object.freeze(['report_snapshot', 'report_metric', `report_${descriptor.topEntityType}`]),
  safeRuntimeFlags: Object.freeze([]),
})));

const DESCRIPTORS = new Map(REPORT_LIVE_CLOSURE_CHANNELS.map((descriptor) => [
  `${descriptor.platform}:${descriptor.capability}`,
  descriptor,
]));

export function getReportLiveClosureDescriptor(platform, capability) {
  const descriptor = DESCRIPTORS.get(`${platform}:${capability}`);
  if (!descriptor) throw closureDescriptorError(
    `Unsupported Report Live Closure descriptor ${platform}:${capability}`,
    'REPORT_LIVE_CLOSURE_DESCRIPTOR_NOT_FOUND',
    { platform, capability },
  );
  return descriptor;
}

export function assertReportLiveClosureDescriptor(descriptor) {
  const requiredText = [
    'platform', 'capability', 'sourceReader', 'topEntityType', 'currencyMode',
    'readinessAuthority', 'coverageAuthority', 'metricProjection',
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
  if (!Array.isArray(descriptor.requiredLarkOutputs) || descriptor.requiredLarkOutputs.length < 2) throw closureDescriptorError(
    'Descriptor requiredLarkOutputs must be declared',
    'REPORT_LIVE_CLOSURE_DESCRIPTOR_INVALID',
    { field: 'requiredLarkOutputs' },
  );
  return true;
}

function closureDescriptorError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'ReportLiveClosureDescriptorError';
  error.code = code;
  error.details = details;
  return error;
}
