import { toFiniteNumber } from '../../../shared/src/number/strict-number.js';

const DEFAULT_RULE_CONFIDENCE = 0.8;
const DEFAULT_RULE_PRIORITY = 0;
const MAX_ALIAS_COUNT = 50;
const MAX_ALIAS_LENGTH = 200;
const MAX_MATCH_TEXT_LENGTH = 20_000;
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
 * วิเคราะห์ Record จาก MKT_Classification_Dictionary พร้อม Diagnostics
 * แถวที่ปิดใช้งานจะไม่นับเป็นข้อผิดพลาด ส่วนแถวที่เปิดใช้งานแต่ Contract ไม่ครบจะถูกรายงาน
 */
export function analyzeClassificationDictionaryRecords(records) {
  if (!Array.isArray(records)) {
    throw new TypeError('classification dictionary records must be an array');
  }

  const rules = [];
  const invalidRows = [];
  const seenRuleKeys = new Set();
  let disabledRows = 0;

  for (let rowIndex = 0; rowIndex < records.length; rowIndex += 1) {
    const record = records[rowIndex];
    const fields = record?.fields && typeof record.fields === 'object' ? record.fields : record;
    const analysis = analyzeClassificationDictionaryRow(fields ?? {});

    if (analysis.status === 'disabled') {
      disabledRows += 1;
      continue;
    }

    if (analysis.status === 'invalid') {
      invalidRows.push(createInvalidDictionaryRow({ record, rowIndex, ...analysis }));
      continue;
    }

    const duplicateKey = analysis.rule.rule_key.toLowerCase();
    if (seenRuleKeys.has(duplicateKey)) {
      invalidRows.push(createInvalidDictionaryRow({
        record,
        rowIndex,
        ruleKey: analysis.rule.rule_key,
        reason: `duplicate rule_key: ${analysis.rule.rule_key}`,
      }));
      continue;
    }

    seenRuleKeys.add(duplicateKey);
    rules.push(analysis.rule);
  }

  return Object.freeze({
    rules: Object.freeze(rules.sort(compareRules)),
    invalidRows: Object.freeze(invalidRows),
    disabledRows,
    totalRows: records.length,
  });
}

/** คืนเฉพาะ Rule เพื่อรักษา API เดิมของผู้เรียกที่ยังไม่ต้องใช้ Diagnostics */
export function mapClassificationDictionaryRecords(records) {
  return analyzeClassificationDictionaryRecords(records).rules;
}

/** แปลง Dictionary หนึ่งแถวเป็น Rule หรือ null เมื่อแถวไม่พร้อมใช้งาน */
export function mapClassificationDictionaryRow(fields) {
  const analysis = analyzeClassificationDictionaryRow(fields ?? {});
  return analysis.status === 'valid' ? analysis.rule : null;
}

/** ตรวจ Contract ของ Dictionary หนึ่งแถวพร้อมเหตุผลที่ใช้แสดงใน Dry run */
function analyzeClassificationDictionaryRow(fields) {
  const enabled = readBoolean(fields?.enabled, true);
  if (!enabled) return Object.freeze({ status: 'disabled' });

  const ruleKey = readText(fields?.rule_key);
  const targetField = readText(fields?.target_field);
  const outputValue = readText(fields?.output_value);
  const aliases = readAliases(fields?.aliases);

  if (!ruleKey) return invalidRule('missing rule_key', null);
  if (!targetField) return invalidRule('missing target_field', ruleKey);
  if (!KNOWN_TARGET_FIELDS.has(targetField)) {
    return invalidRule(`unsupported target_field: ${targetField}`, ruleKey);
  }
  if (!outputValue) return invalidRule('missing output_value', ruleKey);
  if (aliases.length === 0) return invalidRule('missing usable aliases', ruleKey);

  const requestedMatchType = readText(fields?.match_type)?.toLowerCase() || 'contains';
  if (!['contains', 'exact', 'regex'].includes(requestedMatchType)) {
    return invalidRule(`unsupported match_type: ${requestedMatchType}`, ruleKey);
  }

  const compiledRegexes = requestedMatchType === 'regex' ? compileSafeRegexAliases(aliases) : [];
  if (requestedMatchType === 'regex' && compiledRegexes.length !== aliases.length) {
    return invalidRule('invalid or unsafe regex alias', ruleKey);
  }

  return Object.freeze({
    status: 'valid',
    rule: Object.freeze({
      rule_key: ruleKey,
      target_field: targetField,
      output_value: outputValue,
      aliases: Object.freeze(aliases),
      match_type: requestedMatchType,
      compiled_regexes: Object.freeze(compiledRegexes),
      platform: Object.freeze(readTextList(fields?.platform).map((value) => value.toLowerCase())),
      applies_to: Object.freeze(readTextList(fields?.applies_to).map((value) => value.toLowerCase())),
      priority: readNumber(fields?.priority, DEFAULT_RULE_PRIORITY),
      confidence: normalizeConfidence(readNumber(fields?.confidence, DEFAULT_RULE_CONFIDENCE)),
      enabled: true,
      note: readText(fields?.note),
    }),
  });
}

/** สร้างผลวิเคราะห์แถวที่เปิดใช้งานแต่ไม่ผ่าน Contract */
function invalidRule(reason, ruleKey) {
  return Object.freeze({ status: 'invalid', reason, ruleKey });
}

/** สร้างรายละเอียด Invalid row ที่ปลอดภัยต่อการแสดงใน Validation output */
function createInvalidDictionaryRow(input) {
  return Object.freeze({
    rowIndex: input.rowIndex,
    recordId: readText(input.record?.recordId ?? input.record?.record_id),
    ruleKey: input.ruleKey ?? null,
    reason: input.reason,
  });
}

/** ตรวจว่า Rule ใช้กับ Platform และ Scope ปัจจุบันหรือไม่ */
export function doesRuleApplyToContext(rule, context = {}) {
  const platform = readText(context?.platform)?.toLowerCase() ?? null;
  const appliesTo = readText(context?.appliesTo)?.toLowerCase() || 'organic';
  const platforms = rule?.platform ?? [];
  const scopes = rule?.applies_to ?? [];

  const platformMatches = platforms.length === 0 || (platform !== null && platforms.includes(platform));
  const scopeMatches = scopes.length === 0 || scopes.includes('both') || scopes.includes(appliesTo);
  return platformMatches && scopeMatches;
}

/**
 * ตรวจข้อความกับ Alias ของ Rule
 * Regex ถูก Compile เพียงครั้งเดียวตอนโหลด Dictionary เพื่อลด CPU ใน Batch ใหญ่
 */
export function ruleMatchesText(rule, text) {
  const normalizedText = normalizeText(text).slice(0, MAX_MATCH_TEXT_LENGTH);
  if (!normalizedText) return false;

  if (rule?.match_type === 'regex') {
    return (rule.compiled_regexes ?? []).some((regex) => regex.test(normalizedText));
  }

  return (rule?.aliases ?? []).some((alias) => matchAlias({
    alias,
    matchType: rule.match_type,
    text: normalizedText,
  }));
}

/** Match Alias สำหรับ contains/exact โดยไม่สร้าง RegExp ซ้ำ */
function matchAlias(input) {
  const alias = normalizeText(input.alias);
  if (!alias) return false;
  if (input.matchType === 'exact') return input.text === alias;
  return input.text.includes(alias);
}

/** Compile Regex ที่ผ่าน Heuristic ป้องกัน Pattern เสี่ยง ReDoS */
function compileSafeRegexAliases(aliases) {
  const compiled = [];
  for (const alias of aliases) {
    if (!isSafeRegexPattern(alias)) return [];
    try {
      compiled.push(new RegExp(alias, 'iu'));
    } catch {
      return [];
    }
  }
  return compiled;
}

/**
 * ปฏิเสธ Regex ที่ยาวเกินไป, Backreference และ Nested quantifier ที่เสี่ยง Backtracking สูง
 * เป็น Guard สำหรับ Dictionary ที่แก้ไขได้จาก Lark ไม่ใช่ Regex sandbox เต็มรูปแบบ
 */
function isSafeRegexPattern(pattern) {
  if (typeof pattern !== 'string' || pattern.length === 0 || pattern.length > MAX_ALIAS_LENGTH) return false;
  if (/\\[1-9]/u.test(pattern)) return false;
  if (/\([^)]*[*+][^)]*\)\s*(?:[*+]|\{\d*,?\d*\})/u.test(pattern)) return false;
  if (/(?:\.\*|\.\+)\s*(?:[*+]|\{\d*,?\d*\})/u.test(pattern)) return false;
  return true;
}

/** เรียง Rule ตาม Priority, Confidence และ Rule key เพื่อให้ผล Deterministic */
function compareRules(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  if (b.confidence !== a.confidence) return b.confidence - a.confidence;
  return a.rule_key.localeCompare(b.rule_key);
}

/** อ่าน Alias, แยก comma/newline, จำกัดจำนวนและความยาว แล้วตัดค่าซ้ำ */
function readAliases(value) {
  const items = readTextList(value)
    .flatMap((item) => item.split(ALIAS_SEPARATOR_PATTERN))
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item.length <= MAX_ALIAS_LENGTH);

  return Object.freeze([...new Set(items)].slice(0, MAX_ALIAS_COUNT));
}

/** อ่าน Text list จาก Primitive, Rich text, Select หรือ Array ของ Lark */
function readTextList(value) {
  if (Array.isArray(value)) return value.flatMap((item) => readTextList(item));
  if (value && typeof value === 'object') {
    for (const key of ['text', 'name', 'value', 'option', 'label']) {
      const text = readText(value[key]);
      if (text) return readTextList(text);
    }
    return [];
  }

  const text = readText(value);
  if (!text) return [];
  return text.split(',').map((item) => item.trim()).filter(Boolean);
}

/** อ่าน Text จาก Shape ที่ Lark คืนโดยไม่แปลง Object เป็น [object Object] */
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
    for (const key of ['text', 'name', 'value', 'option', 'label']) {
      const text = readText(value[key]);
      if (text) return text;
    }
    return null;
  }
  return null;
}

/** อ่าน Number พร้อม Fallback เมื่อข้อมูลผิดรูปแบบ */
function readNumber(value, fallback) {
  const primitive = typeof value === 'number' ? value : readText(value);
  if (primitive === null) return fallback;
  try {
    return toFiniteNumber(primitive, { label: 'classification rule number' });
  } catch {
    return fallback;
  }
}

/** อ่าน Checkbox/Boolean จาก Lark */
function readBoolean(value, fallback) {
  if (typeof value === 'boolean') return value;
  const text = readText(value)?.toLowerCase();
  if (!text) return fallback;
  if (['true', 'yes', 'y', '1', 'checked', 'enabled'].includes(text)) return true;
  if (['false', 'no', 'n', '0', 'unchecked', 'disabled'].includes(text)) return false;
  return fallback;
}

/** Normalize Confidence จาก 0-100 หรือ 0-1 ให้อยู่ในช่วง 0-0.99 */
function normalizeConfidence(value) {
  if (value > 1) return Math.max(0, Math.min(0.99, Number((value / 100).toFixed(2))));
  return Math.max(0, Math.min(0.99, Number(value.toFixed(2))));
}

/** Normalize ข้อความสำหรับ Match ให้เป็น NFKC, lower-case และตัด Zero-width */
function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(ZERO_WIDTH_PATTERN, '')
    .replace(/\s+/gu, ' ')
    .trim();
}
