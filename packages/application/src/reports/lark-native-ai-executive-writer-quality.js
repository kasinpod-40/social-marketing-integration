const SOURCE_PROMPT_SHAPE = 'lark_ai_compact_quality_v4';
const TARGET_PROMPT_SHAPE = 'lark_ai_compact_quality_v5';
const BUSINESS_METRIC_SOURCE_PROMPT_SHAPE = TARGET_PROMPT_SHAPE;
const BUSINESS_METRIC_TARGET_PROMPT_SHAPE = 'lark_ai_compact_quality_v6';
const DEFAULT_METRIC_SUMMARY_LIMIT = 2800;
const DEFAULT_STATUS_VECTOR_LIMIT = 700;

export const LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK =
  'ยังไม่มีข้อมูลเปรียบเทียบเพียงพอสำหรับระบุจุดแข็งด้านผลงาน';
export const LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK =
  'ยังไม่พบสัญญาณด้านผลงานที่ควรระวังจากข้อมูลที่มี';

const FACT_KEYS = Object.freeze([
  'current_value',
  'clicks',
  'impressions',
  'derived_ctr_percent',
  'views',
  'likes',
  'comments',
  'shares',
  'engagement',
  'value',
]);

export function upgradeLarkNativeAiExecutiveWriterEvidence(input = {}) {
  const maxMetricSummaryChars = positiveInteger(
    input.maxMetricSummaryChars ?? DEFAULT_METRIC_SUMMARY_LIMIT,
    'maxMetricSummaryChars',
  );
  const maxStatusVectorChars = positiveInteger(
    input.maxStatusVectorChars ?? DEFAULT_STATUS_VECTOR_LIMIT,
    'maxStatusVectorChars',
  );
  const summary = parseObject(input.metricSummaryJson, 'metricSummaryJson');
  const statusVector = parseArray(input.channelStatusVectorJson, 'channelStatusVectorJson');

  if (summary.promptShape !== SOURCE_PROMPT_SHAPE
    || summary.evidenceShape !== 'executive_business_first_v2'
    || !Array.isArray(summary.channelBusinessEvidence)
    || summary.channelBusinessEvidence.length !== 9
    || statusVector.length !== 9) {
    throw qualityError(
      'Executive Writer V8 requires retained quality-v4 evidence for exactly nine channels',
      'LARK_AI_EXECUTIVE_WRITER_V8_SOURCE_INVALID',
    );
  }

  const businessChannels = summary.channelBusinessEvidence
    .filter((item) => item?.businessEvidencePresent === true);
  const summaryRequiredFacts = collectRequiredFacts(businessChannels).slice(0, 3);
  if (businessChannels.length > 0 && summaryRequiredFacts.length === 0) {
    throw qualityError(
      'Business evidence exists but no safe numeric Summary fact could be selected',
      'LARK_AI_EXECUTIVE_WRITER_V8_REQUIRED_FACT_MISSING',
    );
  }

  const qualityContext = {
    ...(objectOrEmpty(summary.qualityContext)),
    summaryRequiredFacts,
    summaryFactRule: 'overview_must_quote_at_least_one_required_fact_value; rank_or_digits_in_names_do_not_count',
  };
  const writerContract = {
    ...(objectOrEmpty(summary.writerContract)),
    overview: 'สรุป business facts 2-4 ประโยค; ถ้ามี summaryRequiredFacts ต้องยกค่าตัวเลขจริงอย่างน้อย 1 ค่า; rank หรือเลขในชื่อไม่ถือเป็น metric; ไม่มี comparison ให้บอกค่าปัจจุบันแบบเป็นกลาง',
  };
  const upgraded = {
    ...summary,
    promptShape: TARGET_PROMPT_SHAPE,
    qualityContext,
    writerContract,
  };
  const metricSummaryJson = stableStringify(upgraded);
  const channelStatusVectorJson = stableStringify(statusVector);

  enforceBudgets({
    metricSummaryJson,
    channelStatusVectorJson,
    maxMetricSummaryChars,
    maxStatusVectorChars,
    metricCode: 'LARK_AI_EXECUTIVE_WRITER_V8_METRIC_LIMIT_EXCEEDED',
    statusCode: 'LARK_AI_EXECUTIVE_WRITER_V8_STATUS_LIMIT_EXCEEDED',
    label: 'Executive Writer V8',
  });

  const evidence = buildEvidence({
    promptShape: TARGET_PROMPT_SHAPE,
    businessChannels,
    qualityContext,
    summaryRequiredFacts,
    derivedCtrFacts: [],
  });

  return deepFreeze({
    metricSummaryJson,
    channelStatusVectorJson,
    metricSummaryChars: metricSummaryJson.length,
    channelStatusVectorChars: channelStatusVectorJson.length,
    evidence,
  });
}

export function hardenLarkNativeAiExecutiveBusinessMetricConsistency(input = {}) {
  const maxMetricSummaryChars = positiveInteger(
    input.maxMetricSummaryChars ?? DEFAULT_METRIC_SUMMARY_LIMIT,
    'maxMetricSummaryChars',
  );
  const maxStatusVectorChars = positiveInteger(
    input.maxStatusVectorChars ?? DEFAULT_STATUS_VECTOR_LIMIT,
    'maxStatusVectorChars',
  );
  const summary = parseObject(input.metricSummaryJson, 'metricSummaryJson');
  const statusVector = parseArray(input.channelStatusVectorJson, 'channelStatusVectorJson');

  if (summary.promptShape !== BUSINESS_METRIC_SOURCE_PROMPT_SHAPE
    || summary.evidenceShape !== 'executive_business_first_v2'
    || !Array.isArray(summary.channelBusinessEvidence)
    || summary.channelBusinessEvidence.length !== 9
    || statusVector.length !== 9) {
    throw qualityError(
      'Executive Writer V9 requires retained quality-v5 evidence for exactly nine channels',
      'LARK_AI_EXECUTIVE_WRITER_V9_SOURCE_INVALID',
    );
  }

  const normalizedChannels = [];
  const derivedCtrFacts = [];
  for (const channel of summary.channelBusinessEvidence) {
    const normalized = normalizeChannelBusinessEvidence(channel, derivedCtrFacts);
    normalizedChannels.push(normalized);
  }
  const businessChannels = normalizedChannels.filter((item) => item?.businessEvidencePresent === true);
  const summaryRequiredFacts = collectRequiredFacts(businessChannels).slice(0, 3);
  if (businessChannels.length > 0 && summaryRequiredFacts.length === 0) {
    throw qualityError(
      'Business evidence exists but no consistent numeric Summary fact could be selected',
      'LARK_AI_EXECUTIVE_WRITER_V9_REQUIRED_FACT_MISSING',
    );
  }

  const qualityContext = {
    ...(objectOrEmpty(summary.qualityContext)),
    summaryRequiredFacts,
    summaryFactRule: 'overview_must_quote_at_least_one_required_fact_value; ratio_metrics_must_match_observed_components',
    businessMetricConsistency: 'derived_ctr_percent=clicks/impressions*100; raw_ctr_removed_when_components_exist',
  };
  const writerContract = {
    ...(objectOrEmpty(summary.writerContract)),
    overview: 'สรุป business facts 2-4 ประโยค; ใช้ summaryRequiredFacts อย่างน้อย 1 ค่า; ถ้ามี derived_ctr_percent ให้ใช้ค่านั้นเป็น CTR (%) เท่านั้น; ห้ามใช้ค่า ctr เดิมที่ขัดกับ clicks/impressions',
  };
  const upgraded = {
    ...summary,
    promptShape: BUSINESS_METRIC_TARGET_PROMPT_SHAPE,
    qualityContext,
    writerContract,
    channelBusinessEvidence: normalizedChannels,
  };
  const metricSummaryJson = stableStringify(upgraded);
  const channelStatusVectorJson = stableStringify(statusVector);

  enforceBudgets({
    metricSummaryJson,
    channelStatusVectorJson,
    maxMetricSummaryChars,
    maxStatusVectorChars,
    metricCode: 'LARK_AI_EXECUTIVE_WRITER_V9_METRIC_LIMIT_EXCEEDED',
    statusCode: 'LARK_AI_EXECUTIVE_WRITER_V9_STATUS_LIMIT_EXCEEDED',
    label: 'Executive Writer V9',
  });

  const evidence = buildEvidence({
    promptShape: BUSINESS_METRIC_TARGET_PROMPT_SHAPE,
    businessChannels,
    qualityContext,
    summaryRequiredFacts,
    derivedCtrFacts,
  });

  return deepFreeze({
    metricSummaryJson,
    channelStatusVectorJson,
    metricSummaryChars: metricSummaryJson.length,
    channelStatusVectorChars: channelStatusVectorJson.length,
    evidence,
  });
}

export function validateLarkNativeAiExecutiveWriterOutputs(outputs = {}, evidence = {}) {
  const normalized = Object.fromEntries([
    'insight_summary',
    'strengths',
    'weaknesses',
    'recommendations',
  ].map((field) => [field, textOrNull(outputs[field]) ?? '']));
  const violations = [];
  const allText = Object.values(normalized).join('\n');

  if (/\breport_partial\b|\breport_missing\b|\bsource_pending\b|\bsource_unavailable\b|\breadiness_status\b|\bdata_status\b|\bCoverage\b/iu.test(allText)) {
    violations.push('internal_status_language');
  }
  if (/^#{1,6}\s/mu.test(allText)) violations.push('markdown_heading');
  if (/หลักฐาน\s*[:：]|\([^\n)]*หลักฐาน[^\n)]*\)/u.test(allText)) violations.push('evidence_footnote');

  if (/แนะนำ|ควร|ติดตาม|ตรวจสอบ(?!แล้ว)|ทดลอง|ต่อยอด|คำนวณ|ใช้เป็น\s*(?:benchmark|baseline)|สิ่งที่ควรทำ/iu.test(normalized.insight_summary)) {
    violations.push('insight_contains_action');
  }
  if (normalized.insight_summary.includes(LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK)) {
    violations.push('insight_contains_strengths_fallback');
  }
  if (normalized.insight_summary.includes(LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK)) {
    violations.push('insight_contains_weaknesses_fallback');
  }
  if (Number(evidence.businessEvidenceChannelCount ?? 0) > 0
    && Array.isArray(evidence.businessEvidenceChannelNames)
    && evidence.businessEvidenceChannelNames.length > 0
    && !evidence.businessEvidenceChannelNames.some((name) => normalized.insight_summary.includes(name))) {
    violations.push('insight_missing_business_channel_name');
  }
  const requiredFacts = Array.isArray(evidence.summaryRequiredFacts) ? evidence.summaryRequiredFacts : [];
  if (requiredFacts.length > 0 && !containsRequiredBusinessFact(normalized.insight_summary, requiredFacts)) {
    violations.push('insight_missing_business_metric_value');
  }
  const derivedCtrFacts = Array.isArray(evidence.derivedCtrFacts) ? evidence.derivedCtrFacts : [];
  if (derivedCtrFacts.length > 0 && containsInconsistentCtrClaim(normalized.insight_summary, derivedCtrFacts)) {
    violations.push('insight_ctr_inconsistent_with_components');
  }

  if (Number(evidence.comparisonEvidenceChannelCount ?? 0) === 0) {
    if (normalized.strengths !== LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK) {
      violations.push('strengths_without_comparison_fallback');
    }
    if (/จำนวนมาก|จำนวนสูง|จำนวนต่ำ|สูงสุด|ต่ำสุด|เด่นที่สุด|โดดเด่น|ทำผลงานดี|ดีที่สุด|คุ้มที่สุด|ดีขึ้น|แย่ลง|เติบโต/u.test(
      `${normalized.insight_summary}\n${normalized.strengths}\n${normalized.weaknesses}`,
    )) {
      violations.push('unsupported_performance_magnitude');
    }
  }

  if (normalized.weaknesses !== LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK) {
    if (/แนะนำ|ควร(?!ระวัง)|ติดตาม|ตรวจสอบ(?!แล้ว)|ทดลอง|ต่อยอด|คำนวณ|รอ|เติม|ใช้เป็น/iu.test(normalized.weaknesses)) {
      violations.push('weaknesses_contains_action');
    }
    if (/ยังไม่พบข้อมูล|ไม่มีข้อมูล|ข้อมูลไม่ครบ|ข้อมูลไม่เพียงพอ|ข้อมูลเต็ม|ความพร้อม|ช่องทางอื่น|รอข้อมูล|coverage/iu.test(normalized.weaknesses)) {
      violations.push('weaknesses_contains_data_quality');
    }
  }

  if (normalized.recommendations.includes(LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK)) {
    violations.push('recommendations_repeats_strengths_fallback');
  }
  if (normalized.recommendations.includes(LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK)) {
    violations.push('recommendations_repeats_weaknesses_fallback');
  }
  if (/สิ่งที่ควรทำสัปดาห์หน้า\s*[:：]?/u.test(normalized.recommendations)) {
    violations.push('recommendations_contains_heading');
  }
  if (/เติมข้อมูล|รอข้อมูล|ยังไม่มีข้อมูล|ยังไม่พบข้อมูล|ข้อมูลไม่เพียงพอ|ข้อมูลไม่ครบ|ข้อมูลเต็ม|ตรวจสอบข้อมูล|ตรวจข้อมูล|ตรวจระบบ|แก้ระบบ|connection|source readiness|coverage|ช่องทางอื่น/iu.test(normalized.recommendations)) {
    violations.push('recommendations_contains_data_ops');
  }
  if (Number(evidence.businessEvidenceChannelCount ?? 0) > 0
    && evidence.recommendationMode === 'observed_only_business_followup'
    && !/(CTR|CPC|อัตราการคลิก|ต้นทุนต่อคลิก|โฆษณา|creative|baseline|เปรียบเทียบ)/iu.test(normalized.recommendations)) {
    violations.push('recommendations_missing_business_action');
  }

  return Object.freeze({
    passed: violations.length === 0,
    violations: Object.freeze(violations),
  });
}

function normalizeChannelBusinessEvidence(channel, derivedCtrFacts) {
  if (!channel || typeof channel !== 'object' || Array.isArray(channel)) return channel;
  const topAds = Array.isArray(channel.topAds)
    ? channel.topAds.map((ad) => normalizeAdEvidence(ad, channel, derivedCtrFacts))
    : channel.topAds;
  return {
    ...channel,
    ...(Array.isArray(channel.topAds) ? { topAds } : {}),
  };
}

function normalizeAdEvidence(ad, channel, derivedCtrFacts) {
  if (!ad || typeof ad !== 'object' || Array.isArray(ad)) return ad;
  const clicks = finiteNumber(ad.clicks);
  const impressions = finiteNumber(ad.impressions);
  if (clicks === null || impressions === null || clicks < 0 || impressions <= 0) return ad;
  const derivedCtrPercent = roundDecimal((clicks / impressions) * 100, 6);
  const { ctr: _discardedRawCtr, ...rest } = ad;
  const channelName = textOrNull(channel.displayName) ?? textOrNull(channel.channelKey) ?? 'unknown';
  derivedCtrFacts.push(Object.freeze({
    channel: channelName,
    adName: textOrNull(ad.ad_name),
    clicks,
    impressions,
    derivedCtrPercent,
  }));
  return {
    ...rest,
    derived_ctr_percent: derivedCtrPercent,
  };
}

function buildEvidence({
  promptShape,
  businessChannels,
  qualityContext,
  summaryRequiredFacts,
  derivedCtrFacts,
}) {
  return Object.freeze({
    promptShape,
    businessEvidenceChannelCount: businessChannels.length,
    comparisonEvidenceChannelCount: Number(qualityContext.comparisonEvidenceChannelCount ?? 0),
    strengthsMode: textOrNull(qualityContext.strengthsMode),
    recommendationMode: textOrNull(qualityContext.recommendationMode),
    businessEvidenceChannelNames: Object.freeze(businessChannels
      .map((item) => textOrNull(item?.displayName))
      .filter(Boolean)),
    summaryRequiredFacts: Object.freeze(summaryRequiredFacts.map((item) => Object.freeze({ ...item }))),
    derivedCtrFacts: Object.freeze(derivedCtrFacts.map((item) => Object.freeze({ ...item }))),
  });
}

function collectRequiredFacts(channels) {
  const facts = [];
  const seen = new Set();
  for (const channel of channels) {
    const channelName = textOrNull(channel?.displayName) ?? textOrNull(channel?.channelKey) ?? 'unknown';
    const sources = [
      ...(Array.isArray(channel?.availableMetrics) ? channel.availableMetrics : []),
      ...(Array.isArray(channel?.topAds) ? channel.topAds : []),
      ...(Array.isArray(channel?.topContent) ? channel.topContent : []),
    ];
    for (const source of sources) {
      if (!source || typeof source !== 'object' || Array.isArray(source)) continue;
      for (const key of FACT_KEYS) {
        const value = source[key];
        if (typeof value !== 'number' || !Number.isFinite(value)) continue;
        const metric = key === 'current_value'
          ? textOrNull(source.metric_key) ?? 'metric'
          : key;
        const signature = `${channelName}\u0000${metric}\u0000${value}`;
        if (seen.has(signature)) continue;
        seen.add(signature);
        facts.push(Object.freeze({ channel: channelName, metric, value }));
      }
    }
  }
  return facts;
}

function containsRequiredBusinessFact(text, facts) {
  const observed = extractNumbers(text);
  return facts.some((fact) => observed.some((number) => numericEquivalent(number, fact.value)));
}

function containsInconsistentCtrClaim(text, facts) {
  const claims = extractCtrClaims(text);
  if (claims.length === 0) return false;
  return claims.some((claim) => !facts.some((fact) => numericEquivalentPercent(claim, fact.derivedCtrPercent)));
}

function extractCtrClaims(text) {
  const source = String(text ?? '');
  const matches = [...source.matchAll(/CTR[^\d-]{0,80}(-?\d[\d,]*(?:\.\d+)?)/giu)];
  return matches
    .map((match) => Number(match[1].replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
}

function extractNumbers(text) {
  const matches = String(text ?? '').match(/-?\d[\d,]*(?:\.\d+)?/gu) ?? [];
  return matches
    .map((value) => Number(value.replace(/,/g, '')))
    .filter((value) => Number.isFinite(value));
}

function numericEquivalent(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const tolerance = Math.max(1e-9, Math.abs(right) * 1e-9);
  return Math.abs(left - right) <= tolerance;
}

function numericEquivalentPercent(left, right) {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return false;
  const tolerance = Math.max(0.001, Math.abs(right) * 0.005);
  return Math.abs(left - right) <= tolerance;
}

function finiteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function roundDecimal(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function enforceBudgets({
  metricSummaryJson,
  channelStatusVectorJson,
  maxMetricSummaryChars,
  maxStatusVectorChars,
  metricCode,
  statusCode,
  label,
}) {
  if (metricSummaryJson.length > maxMetricSummaryChars) {
    throw qualityError(
      `${label} evidence exceeds the reviewed metric-summary budget`,
      metricCode,
      { observedChars: metricSummaryJson.length, maximumChars: maxMetricSummaryChars },
    );
  }
  if (channelStatusVectorJson.length > maxStatusVectorChars) {
    throw qualityError(
      `${label} status vector exceeds the reviewed budget`,
      statusCode,
      { observedChars: channelStatusVectorJson.length, maximumChars: maxStatusVectorChars },
    );
  }
}

function parseObject(value, label) {
  try {
    const parsed = JSON.parse(String(value));
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw qualityError(`${label} must be a JSON object`, 'LARK_AI_EXECUTIVE_WRITER_V8_JSON_INVALID', { label });
  }
}
function parseArray(value, label) {
  try {
    const parsed = JSON.parse(String(value));
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed;
  } catch {
    throw qualityError(`${label} must be a JSON array`, 'LARK_AI_EXECUTIVE_WRITER_V8_JSON_INVALID', { label });
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
function textOrNull(value) {
  if (value === null || value === undefined) return null;
  const text = String(value).trim();
  return text || null;
}
function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}
function qualityError(message, code, details = {}) {
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
