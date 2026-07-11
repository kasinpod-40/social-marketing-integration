import {
  doesRuleApplyToContext,
  ruleMatchesText,
} from './classification-dictionary.js';

const DEFAULT_NONE_FIELDS = Object.freeze({
  cta_type: 'none',
  promotion_type: 'none',
  urgency_level: 'none',
});

/**
 * Generic marketing content classifier.
 *
 * The classifier intentionally does not hardcode client-specific course names
 * or education-year rules. Business vocabulary must come from
 * MKT_Classification_Dictionary so each client can add words in Lark without
 * changing source code.
 *
 * @param {{caption?: unknown, title?: unknown, campaignName?: unknown, url?: unknown, platform?: unknown, appliesTo?: unknown, dictionaryRules?: unknown[]}} input
 */
export function classifyMarketingContent(input = {}) {
  const humanText = [input?.caption, input?.title, input?.campaignName]
    .filter((value) => value !== null && value !== undefined)
    .join(' ');
  const text = normalizeText([humanText, input?.url]
    .filter((value) => value !== null && value !== undefined)
    .join(' '));

  const dictionaryRules = Array.isArray(input?.dictionaryRules) ? input.dictionaryRules : [];
  const context = {
    platform: input?.platform,
    appliesTo: input?.appliesTo ?? 'organic',
  };

  const matchedRules = dictionaryRules
    .filter((rule) => doesRuleApplyToContext(rule, context))
    .filter((rule) => ruleMatchesText(rule, text));

  const values = collectClassificationValues(matchedRules);
  const matchedFields = new Set(matchedRules.map((rule) => rule.target_field));
  const hasAnyMatch = matchedRules.length > 0;

  return Object.freeze({
    course_name: firstValue(values.course_name),
    course_level: Object.freeze(values.course_level ?? []),
    course_type: firstValue(values.course_type),
    content_theme: firstValue(values.content_theme),
    funnel_stage: firstValue(values.funnel_stage),
    cta_type: firstValue(values.cta_type) ?? DEFAULT_NONE_FIELDS.cta_type,
    cta_destination: extractFirstUrl(normalizeText(humanText)),
    promotion_type: firstValue(values.promotion_type) ?? DEFAULT_NONE_FIELDS.promotion_type,
    urgency_level: firstValue(values.urgency_level) ?? DEFAULT_NONE_FIELDS.urgency_level,
    classification_source: 'rule',
    classification_confidence: computeConfidence(matchedRules),
    manual_tag_note: hasAnyMatch ? null : 'manual_review: no enabled dictionary rule matched',
    matched_rule_keys: Object.freeze(matchedRules.map((rule) => rule.rule_key)),
    matched_fields: Object.freeze([...matchedFields]),
  });
}

function collectClassificationValues(matchedRules) {
  const byField = new Map();
  for (const rule of matchedRules) {
    const current = byField.get(rule.target_field) ?? [];
    if (!current.includes(rule.output_value)) {
      current.push(rule.output_value);
      byField.set(rule.target_field, current);
    }
  }

  return Object.freeze(Object.fromEntries(byField.entries()));
}

function firstValue(values) {
  return Array.isArray(values) && values.length > 0 ? values[0] : null;
}

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/[^\s)]+|www\.[^\s)]+|[a-z0-9-]+\.[a-z]{2,}(?:\/[^\s)]*)?/iu);
  return match?.[0] ?? null;
}

function computeConfidence(matchedRules) {
  if (matchedRules.length === 0) return 0.2;
  const highest = Math.max(...matchedRules.map((rule) => rule.confidence ?? 0));
  const breadthBonus = Math.min(0.09, Math.max(0, matchedRules.length - 1) * 0.015);
  return Math.min(0.99, Number((highest + breadthBonus).toFixed(2)));
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
