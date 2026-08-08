const DEFAULT_METRIC_SUMMARY_LIMIT = 2800;
const DEFAULT_STATUS_VECTOR_LIMIT = 700;
const QUALITY_PROMPT_SHAPE = 'lark_ai_compact_quality_v4';
const ACCEPTED_SOURCE_PROMPT_SHAPES = new Set([
  'lark_ai_compact_v1',
  'lark_ai_compact_quality_v2',
  'lark_ai_compact_quality_v3',
]);

const PLACEHOLDER_TOKENS = Object.freeze([
  'no_data',
  'no data',
  'ไม่มีข้อมูล',
  'not_available',
  'not available',
  'placeholder',
  'invalid.example',
]);

const WRITER_CONTRACT = Object.freeze({
  role: 'weekly_executive_marketer',
  overview: 'สรุป business facts 2-4 ประโยคก่อน; ค่าปัจจุบันบอกตัวเลขได้แต่ห้ามเรียก มาก สูง ต่ำ เด่น ดี แย่ หากไม่มี comparison; ช่องทางไม่มีข้อมูลรวมสั้นๆ ท้ายสรุป',
  strengths: 'ถ้า strengthsMode=fallback_no_comparison ให้ตอบ exactly “ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน”',
  weaknesses: 'performance-only; ห้าม recommendation/คำว่า แนะนำ ควร ติดตาม ตรวจสอบ ทดลอง; ถ้าไม่มีสัญญาณลบให้ใช้ fallback เดิม และกล่าว missing channels ได้ไม่เกิน 1 ข้อ',
  recommendations: 'business-action-only จาก evidence ที่มี; ห้ามเติม/รอ/ตรวจข้อมูลหรือระบบ; observed-only ads ที่มี clicks+impressions+spend ให้เสนอคำนวณ CTR/CPC และใช้เป็น baseline เทียบสัปดาห์ถัดไป',
  output: 'ไม่ใส่ Markdown heading, เชิงอรรถ, วงเล็บหลักฐาน, JSON, field name หรือศัพท์สถานะภายใน',
});

export function hardenLarkNativeAiWeeklyEvidence(input = {}) {
  const maxMetricSummaryChars = positiveInteger(
    input.maxMetricSummaryChars ?? DEFAULT_METRIC_SUMMARY_LIMIT,
    'maxMetricSummaryChars',
  );
  const maxStatusVectorChars = positiveInteger(
    input.maxStatusVectorChars ?? DEFAULT_STATUS_VECTOR_LIMIT,
    'maxStatusVectorChars',
  );
  const summary = parseJsonObject(input.metricSummaryJson, 'metricSummaryJson');
  const statusVector = parseJsonArray(input.channelStatusVectorJson, 'channelStatusVectorJson');

  if (summary.evidenceShape !== 'executive_business_first_v2'
    || !ACCEPTED_SOURCE_PROMPT_SHAPES.has(summary.promptShape)
    || !Array.isArray(summary.channelBusinessEvidence)
    || summary.channelBusinessEvidence.length !== 9
    || statusVector.length !== 9) {
    throw evidenceError(
      'Weekly Executive quality hardening requires reviewed compact evidence for nine channels',
      'LARK_AI_QUALITY_EVIDENCE_SHAPE_INVALID',
    );
  }

  const channelBusinessEvidence = summary.channelBusinessEvidence.map(hardenChannel);
  const businessEvidenceChannelCount = channelBusinessEvidence
    .filter((item) => item.businessEvidencePresent).length;
  const comparisonEvidenceChannelCount = channelBusinessEvidence
    .filter((item) => item.comparisonEvidencePresent).length;
  const qualityContext = Object.freeze({
    businessEvidenceChannelCount,
    comparisonEvidenceChannelCount,
    strengthsMode: comparisonEvidenceChannelCount === 0
      ? 'fallback_no_comparison'
      : 'comparison_supported',
    recommendationMode: businessEvidenceChannelCount === 0
      ? 'no_business_action'
      : comparisonEvidenceChannelCount === 0
        ? 'observed_only_business_followup'
        : 'comparison_supported_action',
  });
  const hardenedSummary = {
    evidenceShape: 'executive_business_first_v2',
    promptShape: QUALITY_PROMPT_SHAPE,
    qualityContext,
    writerContract: WRITER_CONTRACT,
    channelBusinessEvidence,
  };
  const metricSummaryJson = stableStringify(hardenedSummary);
  const channelStatusVectorJson = stableStringify(statusVector.map((item) => ({
    channelKey: textOrNull(item?.channelKey),
    readinessStatus: textOrNull(item?.readinessStatus),
  })));

  if (metricSummaryJson.length > maxMetricSummaryChars) {
    throw evidenceError('Quality-hardened weekly Executive evidence exceeds the reviewed AI input budget', 'LARK_AI_QUALITY_EVIDENCE_LIMIT_EXCEEDED', {
      observedChars: metricSummaryJson.length,
      maximumChars: maxMetricSummaryChars,
    });
  }
  if (channelStatusVectorJson.length > maxStatusVectorChars) {
    throw evidenceError('Quality-hardened weekly Executive status vector exceeds the reviewed AI input budget', 'LARK_AI_QUALITY_STATUS_VECTOR_LIMIT_EXCEEDED', {
      observedChars: channelStatusVectorJson.length,
      maximumChars: maxStatusVectorChars,
    });
  }

  return deepFreeze({
    metricSummaryJson,
    channelStatusVectorJson,
    metricSummaryChars: metricSummaryJson.length,
    channelStatusVectorChars: channelStatusVectorJson.length,
    promptShape: QUALITY_PROMPT_SHAPE,
    businessEvidenceChannelCount,
    comparisonEvidenceChannelCount,
    strengthsMode: qualityContext.strengthsMode,
    recommendationMode: qualityContext.recommendationMode,
  });
}

function hardenChannel(value) {
  const source = objectOrEmpty(value);
  const availableMetrics = arrayOrEmpty(source.availableMetrics)
    .map(hardenMetric)
    .filter(Boolean);
  const topContent = arrayOrEmpty(source.topContent)
    .map((item) => hardenRanked(item, 'content'))
    .filter(Boolean);
  const topAds = arrayOrEmpty(source.topAds)
    .map((item) => hardenRanked(item, 'ad'))
    .filter(Boolean);
  const collections = hardenCollections(source.collections);
  const businessEvidencePresent = availableMetrics.length > 0
    || topContent.length > 0
    || topAds.length > 0
    || Object.keys(collections).length > 0;
  const comparisonEvidencePresent = availableMetrics.some((item) => (
    item.previous_value !== undefined
    || item.compare_value !== undefined
    || item.change_value !== undefined
    || item.change_percent !== undefined
  ));
  const output = {
    channelKey: textOrNull(source.channelKey),
    businessEvidencePresent,
    comparisonEvidencePresent,
  };
  const displayName = textOrNull(source.displayName);
  if (businessEvidencePresent && displayName) output.displayName = displayName;
  if (availableMetrics.length > 0) output.availableMetrics = availableMetrics;
  if (topContent.length > 0) output.topContent = topContent;
  if (topAds.length > 0) output.topAds = topAds;
  if (Object.keys(collections).length > 0) output.collections = collections;
  return output;
}

function hardenMetric(value) {
  const source = objectOrEmpty(value);
  const current = firstDefined(source.current_value, source.currentValue, source.value);
  if (current === null || current === undefined || containsPlaceholder(source)) return null;
  return omitEmpty({
    metric_key: firstText(source.metric_key, source.metricKey, source.display_name, source.displayName),
    current_value: current,
    previous_value: firstDefined(source.previous_value, source.previousValue),
    compare_value: firstDefined(source.compare_value, source.compareValue),
    change_value: firstDefined(source.change_value, source.changeValue),
    change_percent: firstDefined(source.change_percent, source.changePercent),
    unit: firstText(source.unit, source.currency),
  });
}

function hardenRanked(value, kind) {
  const source = objectOrEmpty(value);
  if (containsPlaceholder(source)) return null;
  const rank = positiveRank(source.rank);
  const title = kind === 'ad'
    ? firstText(source.ad_name, source.adName, source.campaign_name, source.campaignName, source.title, source.name)
    : firstText(source.title, source.caption, source.name);
  const observed = kind === 'ad'
    ? omitEmpty({
      rank,
      ad_name: title,
      clicks: finiteOrNull(source.clicks),
      impressions: finiteOrNull(source.impressions),
      spend_micros: finiteOrNull(firstDefined(source.spend_micros, source.spendMicros)),
      ctr: finiteOrNull(source.ctr),
    })
    : omitEmpty({
      rank,
      title,
      views: finiteOrNull(firstDefined(source.views, source.latest_total_views, source.view_count, source.viewCount)),
      likes: finiteOrNull(firstDefined(source.likes, source.like_count, source.likeCount)),
      comments: finiteOrNull(source.comments),
      shares: finiteOrNull(source.shares),
      engagement: finiteOrNull(firstDefined(source.engagement, source.engagement_rate, source.engagementRate)),
    });
  const hasObservedValue = Object.entries(observed)
    .some(([key, item]) => !['rank', 'ad_name', 'title'].includes(key) && item !== null && item !== undefined);
  if (!hasObservedValue && !(rank && title)) return null;
  return observed;
}

function hardenCollections(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const output = {};
  for (const [key, raw] of Object.entries(value).sort(([left], [right]) => left.localeCompare(right))) {
    const items = Array.isArray(raw) ? raw : [raw];
    const hardened = items.map((item) => hardenCollectionItem(item)).filter(Boolean).slice(0, 1);
    if (hardened.length > 0) output[key] = hardened;
  }
  return output;
}

function hardenCollectionItem(value) {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'object' || Array.isArray(value)) {
    return isPlaceholderText(value) ? null : value;
  }
  if (containsPlaceholder(value)) return null;
  const item = omitEmpty({
    name: firstText(value.name, value.title, value.label, value.key),
    value: firstDefined(value.value, value.count, value.orders, value.current_value, value.currentValue),
  });
  return Object.keys(item).length > 0 ? item : null;
}

function containsPlaceholder(value) {
  return Object.values(objectOrEmpty(value)).some((item) => (
    typeof item === 'string' && isPlaceholderText(item)
  ));
}

function isPlaceholderText(value) {
  const text = String(value ?? '').trim().toLowerCase();
  return text !== '' && PLACEHOLDER_TOKENS.some((token) => text.includes(token));
}

function positiveRank(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : null;
}
function finiteOrNull(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function firstText(...values) {
  for (const value of values) {
    const text = textOrNull(value);
    if (text) return text;
  }
  return null;
}
function firstDefined(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== '') return value;
  }
  return null;
}
function omitEmpty(value) {
  return Object.fromEntries(Object.entries(value).filter(([, item]) => item !== null && item !== undefined && item !== ''));
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
function parseJsonObject(value, label) {
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw evidenceError(`${label} must be a JSON object`, 'LARK_AI_QUALITY_JSON_INVALID', { label });
  }
}
function parseJsonArray(value, label) {
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed;
  } catch {
    throw evidenceError(`${label} must be a JSON array`, 'LARK_AI_QUALITY_JSON_INVALID', { label });
  }
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new TypeError(`${label} must be a positive integer`);
  return number;
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
