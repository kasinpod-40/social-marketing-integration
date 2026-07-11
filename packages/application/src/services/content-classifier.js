import {
  doesRuleApplyToContext,
  ruleMatchesText,
} from './classification-dictionary.js';

// ค่าเริ่มต้นของ Field ที่มีความหมายว่า “ไม่พบ CTA/โปรโมชัน/ความเร่งด่วน”
// ใช้ Object.freeze เพื่อไม่ให้โค้ดส่วนอื่นแก้ค่ามาตรฐานระหว่าง Runtime โดยไม่ตั้งใจ
const DEFAULT_NONE_FIELDS = Object.freeze({
  cta_type: 'none',
  promotion_type: 'none',
  urgency_level: 'none',
});

// จำกัดข้อความที่นำไปจัดหมวดหมู่เพื่อป้องกัน Caption/URL ที่ผิดปกติทำให้ใช้ CPU และหน่วยความจำเกินจำเป็น
const MAX_CLASSIFICATION_TEXT_LENGTH = 20_000;

const CONTENT_TARGET_FIELDS = new Set([
  'course_name',
  'course_level',
  'course_type',
  'content_theme',
  'funnel_stage',
  'cta_type',
  'promotion_type',
  'urgency_level',
]);

/**
 * จัดหมวดหมู่คอนเทนต์การตลาดด้วย Rule ที่ลูกค้าแก้ไขได้จาก Lark Base
 *
 * หลักการสำคัญ:
 * - ไม่ Hardcode ชื่อคอร์สหรือคำธุรกิจเฉพาะลูกค้าไว้ใน Source code
 * - ใช้ Dictionary เป็นแหล่งคำศัพท์ทางธุรกิจเพียงจุดเดียว
 * - คืนค่า manual_review เมื่อไม่มี Rule ใด Match แทนการเดาค่าเอง
 * - Normalize CTA URL ให้เป็น absolute http/https URL ก่อนส่งต่อไป Lark
 *
 * @param {{caption?: unknown, title?: unknown, campaignName?: unknown, url?: unknown, platform?: unknown, appliesTo?: unknown, dictionaryRules?: unknown[]}} input ข้อมูลคอนเทนต์และ Rule ที่ใช้จัดหมวดหมู่
 * @returns {Readonly<Record<string, unknown>>} ผลการจัดหมวดหมู่ที่แก้ไขค่าภายหลังไม่ได้
 */
export function classifyMarketingContent(input = {}) {
  // รวมเฉพาะข้อความที่มนุษย์เห็นเพื่อใช้ค้นหา CTA destination โดยไม่ดึง URL ของโพสต์มาเป็น CTA ผิดความหมาย
  const humanText = [input?.caption, input?.title, input?.campaignName]
    .filter((value) => value !== null && value !== undefined)
    .join(' ');

  // รวม URL ของโพสต์เฉพาะสำหรับ Rule matching เช่น Rule ที่ตรวจคำว่าเว็บไซต์หรือโดเมน
  const text = normalizeText([humanText, input?.url]
    .filter((value) => value !== null && value !== undefined)
    .join(' '));

  // ป้องกันค่า Dictionary ที่ไม่ใช่ Array ทำให้ Batch ทั้งชุดล้มโดยไม่จำเป็น
  const dictionaryRules = Array.isArray(input?.dictionaryRules) ? input.dictionaryRules : [];
  const context = {
    platform: input?.platform,
    appliesTo: input?.appliesTo ?? 'organic',
  };

  // กรอง Context ก่อน Match ข้อความเพื่อลดจำนวน Rule ที่ต้องประมวลผลในแต่ละคอนเทนต์
  const matchedRules = dictionaryRules
    .filter((rule) => CONTENT_TARGET_FIELDS.has(rule?.target_field))
    .filter((rule) => doesRuleApplyToContext(rule, context))
    .filter((rule) => ruleMatchesText(rule, text));

  // รวม Output ของ Rule ตาม target_field และรักษาลำดับ Rule ที่ผ่านการจัด Priority มาแล้ว
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
    cta_destination: extractFirstAbsoluteHttpUrl(normalizeText(humanText)),
    promotion_type: firstValue(values.promotion_type) ?? DEFAULT_NONE_FIELDS.promotion_type,
    urgency_level: firstValue(values.urgency_level) ?? DEFAULT_NONE_FIELDS.urgency_level,
    classification_source: hasAnyMatch ? 'rule' : 'manual',
    classification_confidence: computeConfidence(matchedRules),
    manual_tag_note: hasAnyMatch ? null : 'manual_review: no enabled dictionary rule matched',
    matched_rule_keys: Object.freeze(matchedRules.map((rule) => rule.rule_key)),
    matched_fields: Object.freeze([...matchedFields]),
  });
}

/**
 * รวม output_value ของ Rule ตาม target_field โดยตัดค่าซ้ำและเก็บลำดับเดิม
 * ลำดับเดิมสำคัญเพราะ Rule ถูกเรียง Priority/Confidence จาก Dictionary แล้ว
 */
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

/** คืนค่าตัวแรกจากรายการผลลัพธ์ หรือ null เมื่อยังไม่มี Rule ให้ค่า Field นั้น */
function firstValue(values) {
  return Array.isArray(values) && values.length > 0 ? values[0] : null;
}

/**
 * ค้นหา URL ตัวแรกจากข้อความและ Normalize เป็น absolute http/https URL
 * ตัวอย่าง chemistryk.com และ www.chemistryk.com จะถูกเติม https:// ก่อน Validate
 */
function extractFirstAbsoluteHttpUrl(text) {
  const match = text.match(/https?:\/\/[^\s)\]}>"']+|www\.[^\s)\]}>"']+|(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}(?:\/[^\s)\]}>"']*)?/iu);
  if (!match?.[0]) return null;

  // ตัดเครื่องหมายวรรคตอนท้ายประโยคที่มักติดมากับ URL ใน Caption
  const candidate = match[0].replace(/[.,!?;:]+$/u, '');
  const absoluteCandidate = /^https?:\/\//iu.test(candidate)
    ? candidate
    : `https://${candidate}`;

  try {
    const url = new URL(absoluteCandidate);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
    return url.toString();
  } catch {
    // URL ที่ Regex จับได้แต่ Parse ไม่ผ่านจะไม่ถูกส่งไป Lark เพื่อหลีกเลี่ยง URLFieldConvFail
    return null;
  }
}

/**
 * คำนวณ Confidence จาก Rule ที่มีค่ามากที่สุดและเพิ่ม Bonus เล็กน้อยเมื่อมีหลาย Rule สนับสนุนกัน
 * จำกัดเพดานที่ 0.99 เพื่อไม่สื่อว่า Rule-based classification มีความแน่นอน 100%
 */
function computeConfidence(matchedRules) {
  if (matchedRules.length === 0) return 0.2;
  const highest = Math.max(...matchedRules.map((rule) => rule.confidence ?? 0));
  const breadthBonus = Math.min(0.09, Math.max(0, matchedRules.length - 1) * 0.015);
  return Math.min(0.99, Number((highest + breadthBonus).toFixed(2)));
}

/**
 * Normalize ข้อความก่อน Match โดยใช้ Unicode NFKC, ตัด Zero-width และรวมช่องว่าง
 * จำกัดความยาวเพื่อให้เวลาในการ Match Rule มีขอบเขตคาดเดาได้
 */
function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/gu, '')
    .replace(/\s+/gu, ' ')
    .trim()
    .slice(0, MAX_CLASSIFICATION_TEXT_LENGTH);
}
