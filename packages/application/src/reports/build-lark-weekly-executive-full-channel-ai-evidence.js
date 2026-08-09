import {
  LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK,
  LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK,
  validateLarkNativeAiExecutiveWriterOutputs,
} from './lark-native-ai-executive-writer-quality.js';
import {
  parseLarkWeeklyExecutiveFactualReport,
} from '../notifications/build-lark-weekly-executive-factual-report.js';
import { stableStringify } from '../use-cases/build-report-snapshot.js';

export const LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE =
  'lark_ai_executive_decision_v1';

const MAX_AI_METRICS_PER_CHANNEL = 3;
const MAX_AI_CONTENT_CANDIDATES_PER_CHANNEL = 3;
const MAX_AI_AD_CANDIDATES_PER_CHANNEL = 3;
const MAX_METRIC_SUMMARY_CHARS = 8_000;
const MAX_STATUS_VECTOR_CHARS = 700;
const LOWER_IS_BETTER = /(?:cpc|cpm|cpa|cost_per|refund)/iu;
const NEUTRAL_DIRECTION = /(?:spend|budget|ค่าใช้จ่าย|งบ)/iu;
const INTERNAL_METRIC_LANGUAGE = /\b(?:metric_key|change_percent|compare_value|current_value|derived_ctr_percent)\b/iu;
const NON_BUSINESS_METRIC_LANGUAGE = /ความทบทวนหน้า/u;
const NON_EXECUTIVE_COMPARISON_LANGUAGE = /ค่าเปรียบเทียบ|พร้อมการเปรียบเทียบ|ข้อมูลการเปรียบเทียบที่มี/u;
const AWARENESS_METRIC = /การแสดงผล|การเข้าถึง|ยอดดู|impressions?|reach|views?/iu;
const ACTION_OR_COMMERCE_METRIC = /การคลิก|คลิก|conversions?|conversion|ยอดขายสุทธิ|ยอดขายรวม|รายได้|clicks?/iu;
const SCALE_LANGUAGE = /\[SCALE\]/iu;
const DECISION_LABEL = /\[(?:CONTENT|SCALE|TEST|KEEP|REDUCE|STOP|NO-SCALE)\]/giu;
const DIRECT_LINKAGE_CLAIM = /(?:คอนเทนต์|โพสต์|organic).{0,50}(?:เดียวกัน|ตัวเดียวกัน|ชิ้นเดียวกัน).{0,50}(?:ad|ads|โฆษณา|creative)/iu;

export function buildLarkWeeklyExecutiveFullChannelAiEvidence(input = {}) {
  const factual = parseLarkWeeklyExecutiveFactualReport(input.factualReport);
  const statusVector = parseStatusVector(input.channelStatusVectorJson);
  if (statusVector.length !== 9) {
    throw evidenceError(
      'Full-channel Weekly AI evidence requires exactly nine channel-status rows',
      'LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_STATUS_INVALID',
      { observed: statusVector.length },
    );
  }

  const channels = factual.channels.map(toAiChannelEvidence);
  const businessChannels = channels.filter(({ businessEvidencePresent }) => businessEvidencePresent);
  const comparisonChannels = businessChannels.filter(({ comparisonEvidencePresent }) => comparisonEvidencePresent);
  const comparisonFacts = businessChannels.flatMap((channel) => channel.availableMetrics
    .filter((metric) => metric.compare_value !== null && Number.isFinite(metric.change_percent))
    .map((metric) => Object.freeze({
      channel: channel.displayName,
      metric: metric.display_name,
      changePercent: metric.change_percent,
      signal: metric.signal,
    })));
  const positiveComparisonFacts = comparisonFacts.filter(({ signal }) => signal === 'positive');
  const negativeComparisonFacts = comparisonFacts.filter(({ signal }) => signal === 'negative');
  const neutralComparisonFacts = comparisonFacts.filter(({ signal }) => signal === 'neutral');
  const positiveComparisonChannelNames = unique(positiveComparisonFacts.map(({ channel }) => channel));
  const negativeComparisonChannelNames = unique(negativeComparisonFacts.map(({ channel }) => channel));
  const contentCandidates = businessChannels.flatMap((channel) => (channel.contentCandidates ?? []).map((content) => Object.freeze({
    channel: channel.displayName,
    ...content,
  })));
  const adCandidates = businessChannels.flatMap((channel) => (channel.adCandidates ?? []).map((ad) => Object.freeze({
    channel: channel.displayName,
    ...ad,
  })));
  const scaleEvidenceAdNames = unique(adCandidates.filter(hasScaleEvidence).map(({ ad_name }) => ad_name));
  const funnelDivergences = collectFunnelDivergences(positiveComparisonFacts, negativeComparisonFacts);
  const summaryRequiredFacts = collectCrossChannelRequiredFacts(businessChannels);
  const derivedCtrFacts = adCandidates
    .filter((ad) => Number.isFinite(ad.clicks) && Number.isFinite(ad.impressions) && ad.impressions > 0)
    .map((ad) => Object.freeze({
      channel: ad.channel,
      adName: ad.ad_name,
      clicks: ad.clicks,
      impressions: ad.impressions,
      derivedCtrPercent: ad.derived_ctr_percent,
    }));

  const qualityContext = Object.freeze({
    businessEvidenceChannelCount: businessChannels.length,
    comparisonEvidenceChannelCount: comparisonChannels.length,
    strengthsMode: positiveComparisonFacts.length > 0 ? 'evidence_only' : 'fallback_no_positive_comparison',
    recommendationMode: 'executive_decision_actions',
    summaryRequiredFacts,
    contentCandidateCount: contentCandidates.length,
    adCandidateCount: adCandidates.length,
    scaleEvidenceAdCount: scaleEvidenceAdNames.length,
    funnelDivergenceCount: funnelDivergences.length,
    organicPaidMappingAvailable: false,
  });
  const metricSummary = Object.freeze({
    evidenceShape: 'executive_decision_v1',
    promptShape: LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE,
    qualityContext,
    writerContract: Object.freeze({
      overview: 'สรุปสถานการณ์ธุรกิจ 2-4 ประโยคจาก facts จริงอย่างน้อย 2 ช่องทางเมื่อมีข้อมูล; ชี้ให้เห็นว่าผลต้น Funnel กับปลาย Funnel ไปทางเดียวกันหรือสวนทางกัน',
      strengths: 'ใช้เฉพาะ metric ที่ signal=positive; signal=neutral เช่น ค่าใช้จ่าย/spend/budget ห้ามเป็น strength',
      weaknesses: 'ใช้เฉพาะ metric ที่ signal=negative; missing data ไม่ใช่ weakness; ถ้า awareness โตแต่ click/sales ลดให้ระบุ divergence เป็นความเสี่ยง',
      recommendations: 'ให้ 2-5 decision bullets และขึ้นต้นแต่ละข้อด้วย [CONTENT], [SCALE], [TEST], [KEEP], [REDUCE], [STOP] หรือ [NO-SCALE]; ระบุชื่อ Content/Ad จริงเมื่อมี candidate; ทุกข้อผูกกับ fact/metric ที่สังเกตได้; ห้าม [SCALE]/เพิ่มงบถ้า scaleEvidenceAdNames ว่าง; Organic winner ที่ยังไม่มี paid result ให้ใช้ [TEST] ไม่ใช่ [SCALE]; ถ้าไม่มี exact Organic↔Paid mapping ห้ามกล่าวว่าเป็น creative/โพสต์เดียวกัน',
      contentDecision: 'Content candidate ใช้ views/engagement/ER/likes/comments/shares และ rank เพื่อแนะนำทำซ้ำ/ต่อยอดหรือ Paid test; ห้ามถือว่า Organic ดี = Paid จะดีแน่นอน',
      paidDecision: 'Paid candidate ใช้ CTR/CPC/CPA/Conversions/Conversion value/ROAS เมื่อมี; upper-funnel อย่าง CTR อย่างเดียวใช้ [TEST]/[KEEP] ได้แต่ห้ามเพิ่มงบแบบ Scale',
      funnelDecision: 'เมื่อ impressions/reach/views เพิ่มแต่ clicks/conversions/sales/revenue ลด ต้องบอกว่าสัญญาณสวนทางและห้ามแนะนำเพิ่มงบรวมจนกว่าจะเห็นปลาย Funnel ดีขึ้น',
      language: 'ใช้ display_name เป็นชื่อ metric ที่แสดงต่อผู้บริหารเท่านั้น; ห้ามชื่อ field ภายในและคำว่า ความทบทวนหน้า',
      comparison: 'ใช้คำว่า เทียบช่วงก่อน หรือ เมื่อเทียบกับช่วงก่อน; ห้ามคำว่า ค่าเปรียบเทียบ, พร้อมการเปรียบเทียบ หรือ ข้อมูลการเปรียบเทียบที่มี',
    }),
    decisionEvidence: Object.freeze({
      contentCandidates,
      adCandidates,
      scaleEvidenceAdNames,
      funnelDivergences,
      organicPaidMappingAvailable: false,
    }),
    channelBusinessEvidence: channels,
  });
  const metricSummaryJson = stableStringify(metricSummary);
  const normalizedStatusVectorJson = stableStringify(statusVector);
  if (metricSummaryJson.length > MAX_METRIC_SUMMARY_CHARS) {
    throw evidenceError(
      'Full-channel Weekly AI evidence exceeds the bounded metric-summary budget',
      'LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_METRIC_LIMIT_EXCEEDED',
      { observedChars: metricSummaryJson.length, maximumChars: MAX_METRIC_SUMMARY_CHARS },
    );
  }
  if (normalizedStatusVectorJson.length > MAX_STATUS_VECTOR_CHARS) {
    throw evidenceError(
      'Full-channel Weekly AI status vector exceeds the reviewed budget',
      'LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_STATUS_LIMIT_EXCEEDED',
      { observedChars: normalizedStatusVectorJson.length, maximumChars: MAX_STATUS_VECTOR_CHARS },
    );
  }

  const evidence = deepFreeze({
    promptShape: LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_PROMPT_SHAPE,
    businessEvidenceChannelCount: businessChannels.length,
    comparisonEvidenceChannelCount: comparisonChannels.length,
    strengthsMode: qualityContext.strengthsMode,
    recommendationMode: qualityContext.recommendationMode,
    businessEvidenceChannelNames: businessChannels.map(({ displayName }) => displayName),
    comparisonEvidenceChannelNames: comparisonChannels.map(({ displayName }) => displayName),
    positiveComparisonChannelNames,
    negativeComparisonChannelNames,
    positiveComparisonMetricNames: unique(positiveComparisonFacts.map(({ metric }) => metric)),
    negativeComparisonMetricNames: unique(negativeComparisonFacts.map(({ metric }) => metric)),
    neutralComparisonMetricNames: unique(neutralComparisonFacts.map(({ metric }) => metric)),
    positiveComparisonFacts,
    negativeComparisonFacts,
    neutralComparisonFacts,
    contentCandidateNames: unique(contentCandidates.map(({ caption }) => caption)),
    adCandidateNames: unique(adCandidates.map(({ ad_name }) => ad_name)),
    scaleEvidenceAdNames,
    funnelDivergences,
    organicPaidMappingAvailable: false,
    summaryRequiredFacts,
    derivedCtrFacts,
  });

  return deepFreeze({
    metricSummaryJson,
    channelStatusVectorJson: normalizedStatusVectorJson,
    metricSummaryChars: metricSummaryJson.length,
    channelStatusVectorChars: normalizedStatusVectorJson.length,
    evidence,
  });
}

export function validateLarkWeeklyExecutiveFullChannelAiOutputs(outputs = {}, evidence = {}) {
  const base = validateLarkNativeAiExecutiveWriterOutputs(outputs, evidence);
  const violations = [...base.violations];
  const insight = text(outputs.insight_summary);
  const strengths = text(outputs.strengths);
  const weaknesses = text(outputs.weaknesses);
  const recommendations = text(outputs.recommendations);
  const allText = [insight, strengths, weaknesses, recommendations].join('\n');

  if (INTERNAL_METRIC_LANGUAGE.test(allText)) violations.push('internal_metric_field_language');
  if (NON_BUSINESS_METRIC_LANGUAGE.test(allText)) violations.push('non_business_metric_language');
  if (NON_EXECUTIVE_COMPARISON_LANGUAGE.test(allText)) violations.push('non_executive_comparison_language');

  const businessNames = Array.isArray(evidence.businessEvidenceChannelNames)
    ? evidence.businessEvidenceChannelNames
    : [];
  if (businessNames.length >= 2) {
    const mentioned = businessNames.filter((name) => insight.includes(name));
    if (mentioned.length < 2) violations.push('insight_missing_cross_channel_coverage');
  }

  const positiveNames = Array.isArray(evidence.positiveComparisonChannelNames)
    ? evidence.positiveComparisonChannelNames
    : [];
  const positiveMetricNames = Array.isArray(evidence.positiveComparisonMetricNames)
    ? evidence.positiveComparisonMetricNames
    : [];
  const neutralMetricNames = Array.isArray(evidence.neutralComparisonMetricNames)
    ? evidence.neutralComparisonMetricNames
    : [];
  if (positiveNames.length > 0) {
    if (strengths === LARK_NATIVE_AI_EXECUTIVE_STRENGTHS_FALLBACK) {
      violations.push('strengths_ignored_positive_comparison');
    } else {
      if (!positiveNames.some((name) => strengths.includes(name))) {
        violations.push('strengths_missing_positive_channel');
      }
      if (positiveMetricNames.length > 0 && !positiveMetricNames.some((name) => strengths.includes(name))) {
        violations.push('strengths_missing_positive_metric');
      }
      if (neutralMetricNames.some((name) => strengths.includes(name))) {
        violations.push('strengths_contains_neutral_metric');
      }
    }
  }

  const negativeNames = Array.isArray(evidence.negativeComparisonChannelNames)
    ? evidence.negativeComparisonChannelNames
    : [];
  const negativeMetricNames = Array.isArray(evidence.negativeComparisonMetricNames)
    ? evidence.negativeComparisonMetricNames
    : [];
  if (negativeNames.length > 0) {
    if (weaknesses === LARK_NATIVE_AI_EXECUTIVE_WEAKNESSES_FALLBACK) {
      violations.push('weaknesses_ignored_negative_comparison');
    } else {
      if (!negativeNames.some((name) => weaknesses.includes(name))) {
        violations.push('weaknesses_missing_negative_channel');
      }
      if (negativeMetricNames.length > 0 && !negativeMetricNames.some((name) => weaknesses.includes(name))) {
        violations.push('weaknesses_missing_negative_metric');
      }
    }
  }

  const decisionLabels = recommendations.match(DECISION_LABEL) ?? [];
  if (Number(evidence.businessEvidenceChannelCount ?? 0) > 0 && decisionLabels.length < 2) {
    violations.push('recommendations_missing_decision_actions');
  }

  const contentCandidateNames = Array.isArray(evidence.contentCandidateNames)
    ? evidence.contentCandidateNames
    : [];
  if (contentCandidateNames.length > 0) {
    if (!/\[CONTENT\]|\[TEST\]/iu.test(recommendations)) {
      violations.push('recommendations_missing_content_action');
    }
    if (!contentCandidateNames.some((name) => mentionsCandidate(recommendations, name))) {
      violations.push('recommendations_missing_content_candidate');
    }
  }

  const adCandidateNames = Array.isArray(evidence.adCandidateNames)
    ? evidence.adCandidateNames
    : [];
  if (adCandidateNames.length > 0) {
    if (!/\[(?:SCALE|TEST|KEEP|REDUCE|STOP|NO-SCALE)\]/iu.test(recommendations)) {
      violations.push('recommendations_missing_paid_action');
    }
    if (!adCandidateNames.some((name) => mentionsCandidate(recommendations, name))) {
      violations.push('recommendations_missing_ad_candidate');
    }
  }

  const scaleEvidenceAdNames = Array.isArray(evidence.scaleEvidenceAdNames)
    ? evidence.scaleEvidenceAdNames
    : [];
  if (SCALE_LANGUAGE.test(recommendations)) {
    if (scaleEvidenceAdNames.length === 0) {
      violations.push('recommendations_unsupported_scale');
    } else if (!scaleEvidenceAdNames.some((name) => mentionsCandidate(recommendations, name))) {
      violations.push('recommendations_scale_candidate_unsupported');
    }
  }

  const divergences = Array.isArray(evidence.funnelDivergences) ? evidence.funnelDivergences : [];
  if (divergences.length > 0) {
    const positiveMetrics = unique(divergences.flatMap(({ positiveFacts }) => positiveFacts?.map(({ metric }) => metric) ?? []));
    const negativeMetrics = unique(divergences.flatMap(({ negativeFacts }) => negativeFacts?.map(({ metric }) => metric) ?? []));
    if (!positiveMetrics.some((metric) => recommendations.includes(metric))
        || !negativeMetrics.some((metric) => recommendations.includes(metric))) {
      violations.push('recommendations_missing_funnel_divergence');
    }
  }

  if (evidence.organicPaidMappingAvailable === false && DIRECT_LINKAGE_CLAIM.test(recommendations)) {
    violations.push('recommendations_fabricated_organic_paid_linkage');
  }

  return Object.freeze({
    passed: violations.length === 0,
    violations: Object.freeze([...new Set(violations)]),
  });
}

function toAiChannelEvidence(channel) {
  if (!channel.hasBusinessFacts) {
    return deepFreeze({
      channelKey: channel.channelKey,
      businessEvidencePresent: false,
    });
  }
  const metrics = selectAiMetrics(channel.metrics.map(toAiMetric));
  const contentCandidates = (channel.contentCandidates ?? [])
    .slice(0, MAX_AI_CONTENT_CANDIDATES_PER_CHANNEL)
    .map(toAiContentCandidate);
  const adCandidates = (channel.adCandidates ?? [])
    .slice(0, MAX_AI_AD_CANDIDATES_PER_CHANNEL)
    .map(toAiAdCandidate);
  const comparisonEvidencePresent = metrics.some(({ compare_value }) => compare_value !== null);
  return deepFreeze({
    channelKey: channel.channelKey,
    displayName: channel.displayName,
    businessEvidencePresent: true,
    comparisonEvidencePresent,
    availableMetrics: metrics,
    ...(contentCandidates.length ? { contentCandidates, topContent: [contentCandidates[0]] } : {}),
    ...(adCandidates.length ? { adCandidates, topAds: [adCandidates[0]] } : {}),
  });
}

function toAiContentCandidate(item) {
  return Object.freeze({
    rank: item.rank,
    caption: item.caption,
    views: item.periodViews ?? item.latestTotalViews,
    likes: item.periodLikes,
    comments: item.periodComments,
    shares: item.periodShares,
    engagement: item.periodEngagement,
    engagement_rate: item.periodEngagementRate,
    performance_status: item.performanceStatus,
  });
}

function toAiAdCandidate(item) {
  return Object.freeze({
    rank: item.rank,
    ad_name: item.adName,
    spend: microsToUnit(item.spendMicros),
    impressions: item.impressions,
    reach: item.reach,
    clicks: item.clicks,
    derived_ctr_percent: item.derivedCtrPercent,
    conversions: item.conversions,
    conversion_value: microsToUnit(item.conversionValueMicros),
    cpc: microsToUnit(item.cpcMicros),
    cpa: microsToUnit(item.cpaMicros),
    roas: item.roas,
  });
}

function toAiMetric(metric) {
  const currentValue = presentationValue(metric.currentValue, metric.metricKey, metric.unit);
  const compareValue = metric.compareValue === null
    ? null
    : presentationValue(metric.compareValue, metric.metricKey, metric.unit);
  const base = {
    metric_key: metric.metricKey,
    display_name: thaiBusinessMetricLabel(metric.metricKey, metric.displayName),
    current_value: currentValue,
    compare_value: compareValue,
    change_percent: deriveChangePercent(metric.currentValue, metric.compareValue),
    unit: metric.unit,
  };
  return Object.freeze({ ...base, signal: metricSignal(base) });
}

function selectAiMetrics(metrics) {
  if (metrics.length <= MAX_AI_METRICS_PER_CHANNEL) return Object.freeze(metrics);
  const selected = [];
  const seen = new Set();
  const add = (metric) => {
    if (!metric || selected.length >= MAX_AI_METRICS_PER_CHANNEL) return;
    const key = metric.metric_key ?? metric.display_name;
    if (seen.has(key)) return;
    seen.add(key);
    selected.push(metric);
  };
  const comparable = metrics.filter((metric) => Number.isFinite(metric.change_percent));
  const strongest = (signal) => comparable
    .filter((metric) => metric.signal === signal)
    .sort((left, right) => Math.abs(right.change_percent) - Math.abs(left.change_percent))[0];

  add(comparable.find((metric) => metric.signal === 'neutral'));
  add(strongest('positive'));
  add(strongest('negative'));
  for (const metric of metrics) add(metric);
  return Object.freeze(selected);
}

function collectCrossChannelRequiredFacts(channels) {
  const ordered = [...channels].sort((left, right) => (
    Number(right.comparisonEvidencePresent) - Number(left.comparisonEvidencePresent)
    || left.displayName.localeCompare(right.displayName)
  ));
  const facts = [];
  for (const channel of ordered) {
    const metric = channel.availableMetrics?.[0];
    if (metric && Number.isFinite(metric.current_value)) {
      facts.push(Object.freeze({
        channel: channel.displayName,
        metric: metric.metric_key,
        value: metric.current_value,
      }));
    } else if (channel.adCandidates?.[0]?.clicks !== null && Number.isFinite(channel.adCandidates?.[0]?.clicks)) {
      facts.push(Object.freeze({ channel: channel.displayName, metric: 'clicks', value: channel.adCandidates[0].clicks }));
    } else if (channel.contentCandidates?.[0]?.views !== null && Number.isFinite(channel.contentCandidates?.[0]?.views)) {
      facts.push(Object.freeze({ channel: channel.displayName, metric: 'views', value: channel.contentCandidates[0].views }));
    }
    if (facts.length >= 3) break;
  }
  return Object.freeze(facts);
}

function collectFunnelDivergences(positiveFacts, negativeFacts) {
  const positiveAwareness = positiveFacts.filter(({ metric }) => AWARENESS_METRIC.test(metric));
  const negativeAction = negativeFacts.filter(({ metric }) => ACTION_OR_COMMERCE_METRIC.test(metric));
  if (positiveAwareness.length === 0 || negativeAction.length === 0) return Object.freeze([]);
  return Object.freeze([Object.freeze({
    type: 'awareness_up_outcome_down',
    positiveFacts: Object.freeze(positiveAwareness.slice(0, 2)),
    negativeFacts: Object.freeze(negativeAction.slice(0, 3)),
    decisionRule: 'do_not_broadly_scale_until_lower_funnel_recovers',
  })]);
}

function hasScaleEvidence(ad) {
  if (!Number.isFinite(ad?.conversions) || ad.conversions <= 0) return false;
  if (Number.isFinite(ad?.roas) && ad.roas > 0) return true;
  return Number.isFinite(ad?.conversion_value)
    && ad.conversion_value > 0
    && Number.isFinite(ad?.spend)
    && ad.spend > 0;
}

function mentionsCandidate(source, candidate) {
  const name = text(candidate);
  if (!name) return false;
  if (source.includes(name)) return true;
  const token = name.replace(/\s+/gu, ' ').slice(0, 28).trim();
  return token.length >= 8 && source.includes(token);
}

function metricSignal(metric) {
  if (['positive', 'negative', 'neutral'].includes(metric?.signal)) return metric.signal;
  const change = metric?.change_percent;
  if (!Number.isFinite(change) || change === 0) return 'neutral';
  const key = `${metric.metric_key ?? ''} ${metric.display_name ?? ''}`;
  if (NEUTRAL_DIRECTION.test(key)) return 'neutral';
  if (LOWER_IS_BETTER.test(key)) return change < 0 ? 'positive' : 'negative';
  return change > 0 ? 'positive' : 'negative';
}

function thaiBusinessMetricLabel(metricKey, fallback) {
  const key = String(metricKey ?? '').toLowerCase();
  if (/(?:^|:)account_followers$|followers?$/u.test(key)) return 'ผู้ติดตาม';
  if (/(?:^|:)account_views$|(?:^|:)views?$/u.test(key)) return 'ยอดดู';
  if (/(?:^|:)accounts_engaged$|(?:^|:)engaged$/u.test(key)) return 'บัญชีที่มีส่วนร่วม';
  if (/(?:^|:)account_interactions$|(?:^|:)interactions$/u.test(key)) return 'การมีส่วนร่วม';
  if (/(?:^|:)account_reach$|(?:^|:)reach$/u.test(key)) return 'การเข้าถึง';
  if (/(?:^|:)impressions?$/u.test(key)) return 'การแสดงผล';
  if (/(?:^|:)clicks?$/u.test(key)) return 'การคลิก';
  if (/(?:^|:)conversions?$/u.test(key)) return 'คอนเวอร์ชัน';
  if (/spend(?:_micros)?$/u.test(key)) return 'ค่าใช้จ่าย';
  if (/net_sales(?:_micros)?$/u.test(key)) return 'ยอดขายสุทธิ';
  if (/gross_sales(?:_micros)?$/u.test(key)) return 'ยอดขายรวม';
  if (/recognized_revenue(?:_micros)?$/u.test(key)) return 'รายได้ที่รับรู้';
  if (/refunds?(?:_micros)?$/u.test(key)) return 'ยอดคืนเงิน';
  return String(fallback ?? metricKey ?? 'Metric').trim();
}

function deriveChangePercent(currentValue, compareValue) {
  if (!Number.isFinite(currentValue) || !Number.isFinite(compareValue) || compareValue === 0) return null;
  return round(((currentValue - compareValue) / Math.abs(compareValue)) * 100, 4);
}

function presentationValue(value, metricKey, unit) {
  if (!Number.isFinite(value)) return null;
  return unit === 'currency' && metricKey.endsWith('_micros')
    ? round(value / 1_000_000, 4)
    : value;
}

function microsToUnit(value) {
  return Number.isFinite(value) ? round(value / 1_000_000, 4) : null;
}

function parseStatusVector(value) {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    if (!Array.isArray(parsed)) throw new Error('not array');
    return parsed;
  } catch {
    throw evidenceError(
      'Full-channel Weekly AI status vector must be valid JSON array',
      'LARK_WEEKLY_EXECUTIVE_FULL_CHANNEL_AI_STATUS_INVALID',
    );
  }
}

function unique(values) {
  return Object.freeze([...new Set(values.filter(Boolean))]);
}
function text(value) {
  return value === null || value === undefined ? '' : String(value).trim();
}
function round(value, digits) {
  const factor = 10 ** digits;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}
function evidenceError(message, code, details = {}) {
  const error = new Error(message);
  error.name = 'LarkWeeklyExecutiveFullChannelAiEvidenceError';
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
