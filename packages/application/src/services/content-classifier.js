const COURSE_LEVEL_RULES = Object.freeze([
  { option: 'ม.4', pattern: /(?:ม\.?\s*4|ม4|m\.?\s*4|m4)/iu },
  { option: 'ม.5', pattern: /(?:ม\.?\s*5|ม5|m\.?\s*5|m5)/iu },
  { option: 'ม.6', pattern: /(?:ม\.?\s*6|ม6|m\.?\s*6|m6)/iu },
  { option: 'ม.ปลาย', pattern: /(?:ม\.?\s*ปลาย|เคมี\s*ม\.?\s*ปลาย|high\s*school)/iu },
  { option: 'สอวน', pattern: /(?:สอวน|สอวน\.?\s*เคมี|olympiad)/iu },
  { option: 'TCAS', pattern: /(?:tcas|a-level|alevel|9\s*วิชา|สอบเข้ามหาวิทยาลัย)/iu },
  { option: 'สอบแข่งขัน', pattern: /(?:สอบแข่งขัน|แข่งขัน|สอบเข้า|เตรียมอุดม|มหิดล)/iu },
  { option: 'DEK70', pattern: /(?:dek\s*70|dek70|เด็ก\s*70)/iu },
  { option: 'DEK71', pattern: /(?:dek\s*71|dek71|เด็ก\s*71)/iu },
  { option: 'DEK72', pattern: /(?:dek\s*72|dek72|เด็ก\s*72)/iu },
]);

const COURSE_NAME_RULES = Object.freeze([
  { value: 'M.4/1', pattern: /(?:m\.?\s*4\s*\/\s*1|ม\.?\s*4\s*\/\s*1)/iu },
  { value: 'M.5/1', pattern: /(?:m\.?\s*5\s*\/\s*1|ม\.?\s*5\s*\/\s*1)/iu },
  { value: 'M.6/1+2', pattern: /(?:m\.?\s*6\s*\/\s*1\s*\+\s*2|ม\.?\s*6\s*\/\s*1\s*\+\s*2)/iu },
  { value: 'Trimission', pattern: /trimission/iu },
  { value: 'Banding', pattern: /banding/iu },
  { value: 'OP-Event', pattern: /(?:op[-\s]?event)/iu },
  { value: 'The Fast Skill', pattern: /the\s*fast\s*skill/iu },
]);

const CONTENT_THEME_RULES = Object.freeze([
  { option: 'ปิดรับสมัคร', pattern: /(?:ปิดรับสมัคร|วันสุดท้าย|หมดเขต|โอกาสสุดท้าย|last\s*chance)/iu },
  { option: 'โปรโมชัน', pattern: /(?:โปร|โปรโมชั่น|ส่วนลด|ลด\s*\d+|ลดราคา|early\s*bird|สมัครคู่)/iu },
  { option: 'รีวิวผู้เรียน', pattern: /(?:รีวิว|ความเห็นนักเรียน|feedback|testimonial)/iu },
  { option: 'ผลลัพธ์นักเรียน', pattern: /(?:ผลลัพธ์|คะแนน|สอบติด|ติด\s*มหาวิทยาลัย|success\s*story)/iu },
  { option: 'เฉลยโจทย์', pattern: /(?:เฉลย|โจทย์|ทำข้อสอบ|แนวข้อสอบ)/iu },
  { option: 'quiz', pattern: /(?:quiz|ควิซ|ตอบคำถาม|ข้อไหน|ทาย)/iu },
  { option: 'FAQ', pattern: /(?:faq|ถามบ่อย|คำถามที่พบบ่อย|สงสัยไหม)/iu },
  { option: 'สรุปเนื้อหา', pattern: /(?:สรุป|เซฟเก็บไว้|ทบทวน|ตารางธาตุ|ชีท|short\s*note)/iu },
  { option: 'สอนฟรี', pattern: /(?:สอนฟรี|ติวฟรี|เรียนฟรี|free\s*class|free\s*trial)/iu },
  { option: 'แนะนำคอร์ส', pattern: /(?:คอร์ส|course|เรียนออนไลน์|รายละเอียดคอร์ส|สมัครเรียน)/iu },
]);

const COURSE_TYPE_RULES = Object.freeze([
  { option: 'free_trial', pattern: /(?:ติวฟรี|เรียนฟรี|ทดลองเรียน|free\s*trial|free\s*class)/iu },
  { option: 'hybrid', pattern: /(?:hybrid|ผสม|ออนไลน์\s*\+\s*สด|สด\s*\+\s*ออนไลน์)/iu },
  { option: 'live', pattern: /(?:live|ไลฟ์|สด|เรียนสด)/iu },
  { option: 'recorded', pattern: /(?:recorded|ย้อนหลัง|บันทึก|ดูย้อนหลัง)/iu },
  { option: 'online', pattern: /(?:online|ออนไลน์|เรียนผ่านเว็บ|เรียนผ่านระบบ)/iu },
]);

const FUNNEL_STAGE_RULES = Object.freeze([
  { option: 'conversion', pattern: /(?:สมัคร|ลงทะเบียน|ปิดรับสมัคร|วันสุดท้าย|หมดเขต|จ่าย|ซื้อ|รับสมัคร)/iu },
  { option: 'consideration', pattern: /(?:ราคา|โปร|ส่วนลด|รายละเอียด|คอร์ส|รีวิว|เปรียบเทียบ|เหมาะกับใคร)/iu },
  { option: 'interest', pattern: /(?:quiz|ควิซ|เฉลย|โจทย์|อยากรู้|ลองทำ)/iu },
  { option: 'retention', pattern: /(?:ทบทวนสำหรับคนเรียน|ห้องเรียน|นักเรียนเก่า|เรียนต่อ)/iu },
  { option: 'awareness', pattern: /(?:สรุป|สอนฟรี|เซฟเก็บไว้|ความรู้|ตารางธาตุ|เคมีมปลาย)/iu },
]);

const CTA_RULES = Object.freeze([
  { option: 'form', pattern: /(?:forms\.gle|google\s*form|แบบฟอร์ม|กรอกฟอร์ม)/iu },
  { option: 'line', pattern: /(?:line|lin\.ee|@\s*chemistry|@chemistry|ไลน์)/iu },
  { option: 'สมัครเลย', pattern: /(?:สมัครเลย|สมัครตอนนี้|กดสมัคร|ลงทะเบียนเลย)/iu },
  { option: 'inbox', pattern: /(?:inbox|ทักแชท|ทักเพจ|dm|direct\s*message)/iu },
  { option: 'comment', pattern: /(?:comment|คอมเมนต์|พิมพ์|เมนต์)/iu },
  { option: 'website', pattern: /(?:https?:\/\/|www\.|chemistryk\.com|เว็บไซต์|เว็บ)/iu },
]);

const PROMOTION_RULES = Object.freeze([
  { option: 'deadline', pattern: /(?:วันสุดท้าย|ปิดรับสมัคร|หมดเขต|deadline|last\s*chance)/iu },
  { option: 'discount', pattern: /(?:ลด\s*\d+|ส่วนลด|discount|คูปอง|coupon)/iu },
  { option: 'bundle', pattern: /(?:สมัครคู่|แพ็กคู่|bundle|combo|ซื้อคู่)/iu },
  { option: 'free_trial', pattern: /(?:ติวฟรี|เรียนฟรี|ทดลองเรียน|free\s*trial|free\s*class)/iu },
  { option: 'early_bird', pattern: /(?:early\s*bird|จองก่อน|สมัครก่อน)/iu },
]);

const URGENCY_RULES = Object.freeze([
  { option: 'high', pattern: /(?:วันสุดท้าย|ปิดรับสมัคร|หมดเขต|โอกาสสุดท้าย|last\s*chance|ด่วน)/iu },
  { option: 'medium', pattern: /(?:เหลือเวลา|รีบ|ใกล้เต็ม|รับจำนวนจำกัด)/iu },
  { option: 'low', pattern: /(?:โปร|ส่วนลด|พิเศษ|early\s*bird)/iu },
]);

/**
 * Classifies course-marketing dimensions that social platforms do not provide
 * as native fields. This is deterministic and side-effect free so mapper tests
 * can lock dashboard semantics before adding an AI enrichment layer.
 *
 * @param {{caption?: unknown, title?: unknown, campaignName?: unknown, url?: unknown}} input
 */
export function classifyMarketingContent(input = {}) {
  const text = normalizeText([
    input?.caption,
    input?.title,
    input?.campaignName,
    input?.url,
  ].filter((value) => value !== null && value !== undefined).join(' '));

  const courseLevels = unique(COURSE_LEVEL_RULES
    .filter((rule) => rule.pattern.test(text))
    .map((rule) => rule.option));

  const matchedRules = [];
  if (courseLevels.length > 0) {
    matchedRules.push('course_level');
  }

  const courseName = findFirst(COURSE_NAME_RULES, text);
  if (courseName) matchedRules.push('course_name');

  const courseType = findFirst(COURSE_TYPE_RULES, text);
  if (courseType) matchedRules.push('course_type');

  const contentTheme = findFirst(CONTENT_THEME_RULES, text);
  if (contentTheme) matchedRules.push('content_theme');

  const funnelStage = findFirst(FUNNEL_STAGE_RULES, text) ?? 'awareness';
  if (funnelStage !== 'awareness' || /(?:สรุป|สอนฟรี|เซฟเก็บไว้|ความรู้|ตารางธาตุ|เคมีมปลาย)/iu.test(text)) {
    matchedRules.push('funnel_stage');
  }

  const ctaType = findFirst(CTA_RULES, text) ?? 'none';
  if (ctaType !== 'none') matchedRules.push('cta_type');

  const promotionType = findFirst(PROMOTION_RULES, text) ?? 'none';
  if (promotionType !== 'none') matchedRules.push('promotion_type');

  const urgencyLevel = findFirst(URGENCY_RULES, text) ?? 'none';
  if (urgencyLevel !== 'none') matchedRules.push('urgency_level');

  const confidence = computeConfidence(matchedRules.length, text.length);

  return Object.freeze({
    course_name: courseName,
    course_level: Object.freeze(courseLevels),
    course_type: courseType,
    content_theme: contentTheme,
    funnel_stage: funnelStage,
    cta_type: ctaType,
    cta_destination: extractFirstUrl(text),
    promotion_type: promotionType,
    urgency_level: urgencyLevel,
    classification_source: 'rule',
    classification_confidence: confidence,
    manual_tag_note: null,
  });
}

function normalizeText(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .replace(/[\u200B-\u200D\uFEFF]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function findFirst(rules, text) {
  const match = rules.find((rule) => rule.pattern.test(text));
  return match?.option ?? match?.value ?? null;
}

function unique(values) {
  return Object.freeze([...new Set(values)]);
}

function extractFirstUrl(text) {
  const match = text.match(/https?:\/\/[^\s)]+|(?:www\.)?chemistryk\.com[^\s)]*/iu);
  return match?.[0] ?? null;
}

function computeConfidence(matchCount, textLength) {
  if (matchCount === 0 || textLength === 0) return 0.35;
  return Math.min(0.95, Number((0.45 + matchCount * 0.08).toFixed(2)));
}
