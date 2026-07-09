const DEFAULT_RULE_CONFIDENCE = 0.8;
const DEFAULT_RULE_PRIORITY = 0;
const ZERO_WIDTH_PATTERN = /[\u200B-\u200D\uFEFF]/gu;
const ALIAS_SEPARATOR_PATTERN = /[,\n]/u;

const KNOWN_TARGET_FIELDS = new Set([
  'course_name',
  'course_level',
  'course_type',
  'content_theme',
  'funnel_stage',
  'cta_type',
  'promotion_type',
  'urgency_level',
  'campaign_theme',
  'creative_theme',
]);

/**
 * Converts Lark MKT_Classification_Dictionary records into deterministic rule
 * objects that can be used by the generic classifier.
 *
 * @param {Array<{fields?: Record<string, unknown>}|Record<string, unknown>>} records
 * @returns {ReadonlyArray<Object>}
 */
export function mapClassificationDictionaryRecords(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('classification dictionary records must be an array');
  }

  const rules = [];
  for (const record of records) {
    const fields = record?.fields && typeof record.fields === 'object' ? record.fields : record;
    const rule = mapClassificationDictionaryRow(fields ?? {});
    if (rule) rules.push(rule);
  }

  return Object.freeze(rules.sort(compareRules));
}

export function mapClassificationDictionaryRow(fields) {
  const ruleKey = readText(fields?.rule_key);
  const targetField = readText(fields?.target_field);
  const outputValue = readText(fields?.output_value);
  const aliases = readAliases(fields?.aliases);
  const enabled = readBoolean(fields?.enabled, true);

  if (!enabled || !ruleKey || !targetField || !outputValue || aliases.length === 0) {
    return null;
  }

  if (!KNOWN_TARGET_FIELDS.has(targetField)) {
    return null;
  }

  const matchType = readText(fields?.match_type) || 'contains';
  const safeMatchType = ['contains', 'exact', 'regex'].includes(matchType) ? matchType : 'contains';

  return Object.freeze({
    rule_key: ruleKey,
    target_field: targetField,
    output_value: outputValue,
    aliases: Object.freeze(aliases),
    match_type: safeMatchType,
    platform: Object.freeze(readTextList(fields?.platform)),
    applies_to: Object.freeze(readTextList(fields?.applies_to)),
    priority: readNumber(fields?.priority, DEFAULT_RULE_PRIORITY),
    confidence: normalizeConfidence(readNumber(fields?.confidence, DEFAULT_RULE_CONFIDENCE)),
    enabled: true,
    note: readText(fields?.note),
  });
}

export function doesRuleApplyToContext(rule, context = {}) {
  const platform = readText(context?.platform);
  const appliesTo = readText(context?.appliesTo) || 'organic';
  const platforms = rule?.platform ?? [];
  const scopes = rule?.applies_to ?? [];

  const platformMatches = platforms.length === 0 || !platform || platforms.includes(platform);
  const scopeMatches = scopes.length === 0 || scopes.includes('both') || scopes.includes(appliesTo);
  return platformMatches && scopeMatches;
}

export function ruleMatchesText(rule, text) {
  const normalizedText = normalizeText(text);
  if (!normalizedText) return false;

  return rule.aliases.some((alias) => matchAlias({ alias, matchType: rule.match_type, text: normalizedText }));
}

function matchAlias(input) {
  const alias = normalizeText(input.alias);
  if (!alias) return false;

  if (input.matchType === 'exact') {
    return input.text === alias;
  }

  if (input.matchType === 'regex') {
    try {
      return new RegExp(alias, 'iu').test(input.text);
    } catch {
      return false;
    }
  }

  return input.text.includes(alias);
}

function compareRules(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return a.rule_key.localeCompare(b.rule_key);
}

function readAliases(value) {
  const items = readTextList(value)
    .flatMap((item) => item.split(ALIAS_SEPARATOR_PATTERN))
    .map((item) => item.trim())
    .filter(Boolean);

  return Object.freeze([...new Set(items)]);
}

function readTextList(value) {
  if (Array.isArray(value)) {
    return value.flatMap((item) => readTextList(item));
  }

  if (value && typeof value === 'object') {
    const text = readText(value?.text ?? value?.name ?? value?.value ?? value?.option ?? value?.label);
    return text ? [text] : [];
  }

  const text = readText(value);
  if (!text) return [];

  return text
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
}

function readText(value) {
  if (value === null || value === undefined) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const text = readText(item);
      if (text) return text;
    }
    return null;
  }
  if (typeof value === 'string') return value.trim() || null;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value).trim();
  if (typeof value === 'object') {
    return readText(value.text ?? value.name ?? value.value ?? value.option ?? value.label);
  }

  return null;
}

function readNumber(value, fallback) {
  const numberValue = typeof value === 'number' ? value : Number(readText(value));
  return Number.isFinite(numberValue) ? numberValue : fallback;
}

function readBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  const text = readText(value)?.toLowerCase();
  if (!text) return fallback;
  return ['true', 'yes', 'y', '1', 'checked', 'enabled'].includes(text);
}

function normalizeConfidence(value) {
  if (value > 1) return Math.max(0, Math.min(0.99, Number((value / 100).toFixed(2))));
  return Math.max(0, Math.min(0.99, Number(value.toFixed(2))));
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(ZERO_WIDTH_PATTERN, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
