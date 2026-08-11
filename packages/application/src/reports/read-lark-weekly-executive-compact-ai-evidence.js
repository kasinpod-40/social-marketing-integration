const PROMPT_SHAPE = 'lark_ai_executive_decision_v1';
const EVIDENCE_SHAPE = 'executive_decision_compact_v1';
const STATUS_COUNT = 9;
const DECISION_SIGNALS = new Set(['+', '-', '0']);

/**
 * Reconstructs the Quality-Gate evidence that is intentionally preserved in the durable
 * `metric_summary_json` written to the accepted Weekly Executive AI row.
 *
 * This is the reader counterpart to buildNativeAiBoundedDecisionSummary. It never invents
 * missing Report facts. Compact evidence cannot re-derive ad CTR from impressions because the
 * compact tuple intentionally omits impressions; callers must reject Insight text that asserts
 * CTR and rely on exact `rb` recommendation blueprints for the reviewed paid CTR action.
 */
export function readLarkWeeklyExecutiveCompactAiEvidence(input = {}) {
  const summary = parseObject(input.metricSummaryJson, 'metricSummaryJson');
  const statusVector = parseArray(input.channelStatusVectorJson, 'channelStatusVectorJson');
  if (summary.promptShape !== PROMPT_SHAPE || summary.evidenceShape !== EVIDENCE_SHAPE) {
    throw evidenceError(
      'Weekly Executive compact evidence shape is not the reviewed decision contract',
      'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_SHAPE_INVALID',
    );
  }
  assertStatusVector(statusVector);
  if (!Array.isArray(summary.channels) || summary.channels.length === 0) {
    throw evidenceError(
      'Weekly Executive compact evidence requires business channel tuples',
      'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_CHANNELS_INVALID',
    );
  }

  const channels = summary.channels.map((tuple, index) => readChannel(tuple, index));
  const businessNames = channels.map(({ displayName }) => displayName);
  if (new Set(businessNames).size !== businessNames.length) {
    throw evidenceError(
      'Weekly Executive compact evidence contains duplicate business channels',
      'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_CHANNELS_INVALID',
    );
  }

  const comparisonChannels = channels.filter(({ comparisonEvidencePresent }) => comparisonEvidencePresent);
  const comparisonFacts = channels.flatMap((channel) => channel.metrics
    .filter(({ changePercent }) => Number.isFinite(changePercent))
    .map((metric) => Object.freeze({
      channel: channel.displayName,
      metric: metric.name,
      changePercent: metric.changePercent,
      signal: metric.signal === '+' ? 'positive' : metric.signal === '-' ? 'negative' : 'neutral',
    })));
  const positiveFacts = comparisonFacts.filter(({ signal }) => signal === 'positive');
  const negativeFacts = comparisonFacts.filter(({ signal }) => signal === 'negative');
  const neutralFacts = comparisonFacts.filter(({ signal }) => signal === 'neutral');
  const contentCandidateNames = unique(channels.flatMap(({ content }) => content.map(({ name }) => name)));
  const adCandidateNames = unique(channels.flatMap(({ ads }) => ads.map(({ name }) => name)));
  const scaleEvidenceAdNames = unique(channels.flatMap(({ ads }) => ads
    .filter(({ scale }) => scale === 1)
    .map(({ name }) => name)));
  const funnelDivergences = readFunnelDivergences(summary.funnelMetrics, positiveFacts, negativeFacts);
  const recommendationBlueprints = readRecommendationBlueprints(summary.rb);
  const summaryRequiredFacts = collectRequiredFacts(channels).slice(0, 3);

  return deepFreeze({
    promptShape: PROMPT_SHAPE,
    businessEvidenceChannelCount: channels.length,
    comparisonEvidenceChannelCount: comparisonChannels.length,
    strengthsMode: positiveFacts.length > 0 ? 'evidence_only' : 'fallback_no_positive_comparison',
    recommendationMode: 'executive_decision_actions',
    businessEvidenceChannelNames: businessNames,
    comparisonEvidenceChannelNames: comparisonChannels.map(({ displayName }) => displayName),
    positiveComparisonChannelNames: unique(positiveFacts.map(({ channel }) => channel)),
    negativeComparisonChannelNames: unique(negativeFacts.map(({ channel }) => channel)),
    positiveComparisonMetricNames: unique(positiveFacts.map(({ metric }) => metric)),
    negativeComparisonMetricNames: unique(negativeFacts.map(({ metric }) => metric)),
    neutralComparisonMetricNames: unique(neutralFacts.map(({ metric }) => metric)),
    positiveComparisonFacts: positiveFacts,
    negativeComparisonFacts: negativeFacts,
    neutralComparisonFacts: neutralFacts,
    contentCandidateNames,
    adCandidateNames,
    scaleEvidenceAdNames,
    funnelDivergences,
    organicPaidMappingAvailable: summary.organicPaidMappingAvailable === false ? false : null,
    summaryRequiredFacts,
    // Compact decision tuples omit impressions. A caller must reject CTR claims in Insight rather
    // than pretend the full derived-CTR proof is still present.
    derivedCtrFacts: [],
    recommendationBlueprints,
    compactDecisionChannels: channels,
    statusVector,
  });
}

function readChannel(value, index) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) {
    throw channelError(index);
  }
  const displayName = requiredText(value[0], `channels[${index}].name`);
  const metrics = readTuples(value[1], (tuple, tupleIndex) => readMetric(tuple, index, tupleIndex));
  const content = readTuples(value[2], (tuple, tupleIndex) => readContent(tuple, index, tupleIndex));
  const ads = readTuples(value[3], (tuple, tupleIndex) => readAd(tuple, index, tupleIndex));
  if (metrics.length === 0 && content.length === 0 && ads.length === 0) throw channelError(index);
  return Object.freeze({
    displayName,
    metrics,
    content,
    ads,
    comparisonEvidencePresent: metrics.some(({ changePercent }) => Number.isFinite(changePercent)),
  });
}
function readMetric(tuple, channelIndex, tupleIndex) {
  if (!Array.isArray(tuple) || tuple.length < 2 || tuple.length > 4) throw tupleError('metric', channelIndex, tupleIndex);
  const signal = tuple[3] ?? '0';
  if (!DECISION_SIGNALS.has(signal)) throw tupleError('metric signal', channelIndex, tupleIndex);
  return Object.freeze({
    name: requiredText(tuple[0], 'metric.name'),
    value: finiteOrNull(tuple[1]),
    changePercent: finiteOrNull(tuple[2]),
    signal,
  });
}
function readContent(tuple, channelIndex, tupleIndex) {
  if (!Array.isArray(tuple) || tuple.length < 2 || tuple.length > 5) throw tupleError('content', channelIndex, tupleIndex);
  return Object.freeze({
    name: requiredText(tuple[0], 'content.name'),
    rank: positiveInteger(tuple[1], 'content.rank'),
    views: finiteOrNull(tuple[2]),
    engagement: finiteOrNull(tuple[3]),
    engagementRate: finiteOrNull(tuple[4]),
  });
}
function readAd(tuple, channelIndex, tupleIndex) {
  if (!Array.isArray(tuple) || tuple.length < 2 || tuple.length > 9) throw tupleError('ad', channelIndex, tupleIndex);
  const scale = tuple[8] ?? 0;
  if (scale !== 0 && scale !== 1) throw tupleError('ad scale', channelIndex, tupleIndex);
  return Object.freeze({
    name: requiredText(tuple[0], 'ad.name'),
    rank: positiveInteger(tuple[1], 'ad.rank'),
    spend: finiteOrNull(tuple[2]),
    clicks: finiteOrNull(tuple[3]),
    derivedCtrPercent: finiteOrNull(tuple[4]),
    conversions: finiteOrNull(tuple[5]),
    conversionValue: finiteOrNull(tuple[6]),
    roas: finiteOrNull(tuple[7]),
    scale,
  });
}
function readTuples(value, reader) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('Compact evidence tuple collection must be an array');
  return Object.freeze(value.map(reader));
}
function readFunnelDivergences(value, positiveFacts, negativeFacts) {
  if (value === undefined) return Object.freeze([]);
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw evidenceError('Weekly Executive funnelMetrics must be an object', 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_FUNNEL_INVALID');
  }
  const up = textList(value.up, 'funnelMetrics.up');
  const down = textList(value.down, 'funnelMetrics.down');
  if (up.length === 0 || down.length === 0) {
    throw evidenceError('Weekly Executive funnelMetrics requires up and down metrics', 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_FUNNEL_INVALID');
  }
  const positive = positiveFacts.filter(({ metric }) => up.includes(metric));
  const negative = negativeFacts.filter(({ metric }) => down.includes(metric));
  if (positive.length === 0 || negative.length === 0) {
    throw evidenceError('Weekly Executive funnelMetrics does not match compact comparison facts', 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_FUNNEL_INVALID');
  }
  return Object.freeze([Object.freeze({
    type: 'awareness_up_outcome_down',
    positiveFacts: Object.freeze(positive),
    negativeFacts: Object.freeze(negative),
    decisionRule: 'do_not_broadly_scale_until_lower_funnel_recovers',
  })]);
}
function readRecommendationBlueprints(value) {
  if (value === undefined) return Object.freeze([]);
  const rows = textList(value, 'rb');
  if (rows.length === 0 || rows.length > 4) {
    throw evidenceError('Weekly Executive rb must contain 1-4 exact action lines', 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_RB_INVALID');
  }
  return rows;
}
function collectRequiredFacts(channels) {
  const ordered = [...channels].sort((left, right) => (
    Number(right.comparisonEvidencePresent) - Number(left.comparisonEvidencePresent)
    || left.displayName.localeCompare(right.displayName)
  ));
  const facts = [];
  for (const channel of ordered) {
    const metric = channel.metrics[0];
    if (metric && Number.isFinite(metric.value)) {
      facts.push(Object.freeze({ channel: channel.displayName, metric: metric.name, value: metric.value }));
    } else if (Number.isFinite(channel.ads[0]?.clicks)) {
      facts.push(Object.freeze({ channel: channel.displayName, metric: 'clicks', value: channel.ads[0].clicks }));
    } else if (Number.isFinite(channel.content[0]?.views)) {
      facts.push(Object.freeze({ channel: channel.displayName, metric: 'views', value: channel.content[0].views }));
    }
    if (facts.length >= 3) break;
  }
  return Object.freeze(facts);
}
function assertStatusVector(rows) {
  if (rows.length !== STATUS_COUNT) {
    throw evidenceError('Weekly Executive compact evidence requires exactly nine status rows', 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_STATUS_INVALID', { observed: rows.length });
  }
  const keys = rows.map((row, index) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) {
      throw evidenceError('Weekly Executive status row must be an object', 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_STATUS_INVALID', { index });
    }
    return requiredText(row.channelKey ?? row.channel_key, `statusVector[${index}].channelKey`);
  });
  if (new Set(keys).size !== keys.length) {
    throw evidenceError('Weekly Executive compact evidence status rows must be unique', 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_STATUS_INVALID');
  }
}
function textList(value, label) {
  if (!Array.isArray(value)) throw new TypeError(`${label} must be an array`);
  const rows = value.map((item) => requiredText(item, label));
  if (new Set(rows).size !== rows.length) throw new TypeError(`${label} must not contain duplicates`);
  return Object.freeze(rows);
}
function parseObject(value, label) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('not object');
    return parsed;
  } catch {
    throw evidenceError(`${label} must be a JSON object`, 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_JSON_INVALID', { label });
  }
}
function parseArray(value, label) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed;
  } catch {
    throw evidenceError(`${label} must be a JSON array`, 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_JSON_INVALID', { label });
  }
}
function finiteOrNull(value) {
  if (value === undefined || value === null) return null;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
function positiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) throw new TypeError(`${label} must be a positive integer`);
  return number;
}
function requiredText(value, label) {
  if (typeof value !== 'string' || value.trim() === '') throw new TypeError(`${label} is required`);
  return value.trim();
}
function unique(values) {
  return Object.freeze([...new Set(values.filter(Boolean))]);
}
function channelError(index) {
  return evidenceError('Weekly Executive compact channel tuple is invalid', 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_CHANNELS_INVALID', { index });
}
function tupleError(kind, channelIndex, tupleIndex) {
  return evidenceError(`Weekly Executive compact ${kind} tuple is invalid`, 'LARK_WEEKLY_EXECUTIVE_COMPACT_EVIDENCE_TUPLE_INVALID', { channelIndex, tupleIndex });
}
function evidenceError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeeklyExecutiveCompactAiEvidenceError';
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
