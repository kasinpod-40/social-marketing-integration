const DEFAULT_METRIC_SUMMARY_LIMIT = 2800;
const DEFAULT_STATUS_VECTOR_LIMIT = 700;

const PREFERRED_PRIMITIVE_KEYS = Object.freeze([
  'metric_key', 'metricKey', 'display_name', 'displayName',
  'current_value', 'currentValue', 'previous_value', 'previousValue',
  'change_value', 'changeValue', 'change_percent', 'changePercent',
  'unit', 'currency', 'rank', 'title', 'name', 'permalink', 'url',
  'views', 'likes', 'comments', 'shares', 'engagement', 'engagement_rate',
  'campaign_name', 'campaignName', 'ad_name', 'adName',
  'spend_micros', 'impressions', 'clicks', 'ctr', 'cpc_micros',
  'orders', 'recognized_orders', 'net_sales_micros', 'refund_micros',
  'value', 'count',
]);

const COMPACTION_TIERS = Object.freeze([
  Object.freeze({ metrics: 4, ranked: 1, collections: 2, collectionItems: 1, fields: 7, text: 120 }),
  Object.freeze({ metrics: 2, ranked: 1, collections: 1, collectionItems: 1, fields: 6, text: 100 }),
  Object.freeze({ metrics: 1, ranked: 1, collections: 0, collectionItems: 0, fields: 5, text: 80 }),
]);

export function compactLarkNativeAiWeeklyEvidence(input = {}) {
  const maxMetricSummaryChars = positiveInteger(
    input.maxMetricSummaryChars ?? DEFAULT_METRIC_SUMMARY_LIMIT,
    'maxMetricSummaryChars',
  );
  const maxStatusVectorChars = positiveInteger(
    input.maxStatusVectorChars ?? DEFAULT_STATUS_VECTOR_LIMIT,
    'maxStatusVectorChars',
  );
  const summary = parseJsonObject(input.metricSummaryJson, 'metricSummaryJson');
  if (summary.evidenceShape !== 'executive_business_first_v2'
    || !Array.isArray(summary.channelBusinessEvidence)
    || summary.channelBusinessEvidence.length !== 9) {
    throw evidenceError('Weekly Executive evidence is not business-first v2', 'LARK_AI_EVIDENCE_SHAPE_INVALID');
  }

  let compactSummary = null;
  let metricSummaryJson = null;
  let selectedTier = -1;
  for (let index = 0; index < COMPACTION_TIERS.length; index += 1) {
    compactSummary = buildCompactSummary(summary, COMPACTION_TIERS[index]);
    metricSummaryJson = stableStringify(compactSummary);
    if (metricSummaryJson.length <= maxMetricSummaryChars) {
      selectedTier = index;
      break;
    }
  }
  if (selectedTier < 0) {
    throw evidenceError('Weekly Executive evidence remains above the reviewed AI input budget after compaction', 'LARK_AI_EVIDENCE_COMPACTION_LIMIT_EXCEEDED', {
      observedChars: metricSummaryJson?.length ?? null,
      maximumChars: maxMetricSummaryChars,
    });
  }

  const statusVector = compactStatusVector(summary.channelStatuses ?? parseJsonArray(input.channelStatusVectorJson));
  const channelStatusVectorJson = stableStringify(statusVector);
  if (channelStatusVectorJson.length > maxStatusVectorChars) {
    throw evidenceError('Weekly Executive status vector exceeds the reviewed AI input budget', 'LARK_AI_STATUS_VECTOR_LIMIT_EXCEEDED', {
      observedChars: channelStatusVectorJson.length,
      maximumChars: maxStatusVectorChars,
    });
  }

  return deepFreeze({
    metricSummaryJson,
    channelStatusVectorJson,
    metricSummaryChars: metricSummaryJson.length,
    channelStatusVectorChars: channelStatusVectorJson.length,
    selectedTier,
    evidenceShape: compactSummary.evidenceShape,
    promptShape: compactSummary.promptShape,
  });
}

function buildCompactSummary(summary, tier) {
  return {
    evidenceShape: 'executive_business_first_v2',
    promptShape: 'lark_ai_compact_v1',
    overallCoverageState: textOrNull(summary.overallCoverageState),
    counts: compactCounts(summary.counts),
    channelBusinessEvidence: summary.channelBusinessEvidence.map((channel) => compactChannel(channel, tier)),
  };
}

function compactChannel(channel, tier) {
  const source = objectOrEmpty(channel);
  const output = {
    channelKey: textOrNull(source.channelKey),
    displayName: textOrNull(source.displayName),
    readinessStatus: textOrNull(source.readinessStatus),
  };
  const availableMetrics = arrayOrEmpty(source.availableMetrics)
    .slice(0, tier.metrics)
    .map((item) => compactPrimitiveObject(item, tier));
  const topContent = arrayOrEmpty(source.topContent)
    .slice(0, tier.ranked)
    .map((item) => compactPrimitiveObject(item, tier));
  const topAds = arrayOrEmpty(source.topAds)
    .slice(0, tier.ranked)
    .map((item) => compactPrimitiveObject(item, tier));
  const collections = compactCollections(source.collections, tier);
  if (availableMetrics.length > 0) output.availableMetrics = availableMetrics;
  if (topContent.length > 0) output.topContent = topContent;
  if (topAds.length > 0) output.topAds = topAds;
  if (Object.keys(collections).length > 0) output.collections = collections;
  return output;
}

function compactCollections(value, tier) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || tier.collections === 0) return {};
  const output = {};
  for (const key of Object.keys(value).sort().slice(0, tier.collections)) {
    const item = value[key];
    if (Array.isArray(item)) {
      output[key] = item.slice(0, tier.collectionItems).map((entry) => (
        entry && typeof entry === 'object' && !Array.isArray(entry)
          ? compactPrimitiveObject(entry, tier)
          : compactPrimitive(entry, tier.text)
      ));
    } else if (item && typeof item === 'object') {
      output[key] = compactPrimitiveObject(item, tier);
    } else {
      output[key] = compactPrimitive(item, tier.text);
    }
  }
  return output;
}

function compactPrimitiveObject(value, tier) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return compactPrimitive(value, tier.text);
  const output = {};
  const keys = Object.keys(value);
  const ordered = [
    ...PREFERRED_PRIMITIVE_KEYS.filter((key) => keys.includes(key)),
    ...keys.filter((key) => !PREFERRED_PRIMITIVE_KEYS.includes(key)).sort(),
  ];
  for (const key of ordered) {
    if (Object.keys(output).length >= tier.fields) break;
    const item = value[key];
    if (item === null || ['string', 'number', 'boolean'].includes(typeof item)) {
      output[key] = compactPrimitive(item, tier.text);
    }
  }
  return output;
}

function compactCounts(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const key of Object.keys(value).sort()) {
    if (Number.isFinite(Number(value[key]))) output[key] = Number(value[key]);
  }
  return output;
}

function compactStatusVector(value) {
  return arrayOrEmpty(value).map((item) => {
    const source = objectOrEmpty(item);
    return {
      channelKey: textOrNull(source.channelKey),
      displayName: textOrNull(source.displayName),
      readinessStatus: textOrNull(source.readinessStatus),
      availableMetricCount: finiteNumberOrNull(source.availableMetricCount),
    };
  });
}

function compactPrimitive(value, maxText) {
  if (typeof value !== 'string') return value;
  const normalized = value.trim();
  if (normalized.length <= maxText) return normalized;
  return `${normalized.slice(0, Math.max(0, maxText - 1))}…`;
}

function parseJsonObject(value, label) {
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw evidenceError(`${label} must be a JSON object`, 'LARK_AI_EVIDENCE_JSON_INVALID', { label });
  }
}

function parseJsonArray(value) {
  if (value === null || value === undefined || String(value).trim() === '') return [];
  try {
    const parsed = JSON.parse(String(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new TypeError(`${label} must be a positive integer`);
  return number;
}
function objectOrEmpty(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}
function arrayOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}
function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function finiteNumberOrNull(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
function evidenceError(message, code, details = {}) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
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
