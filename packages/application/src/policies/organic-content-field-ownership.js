export const ORGANIC_CONTENT_PROTECTED_CLASSIFICATION_FIELDS = Object.freeze([
  'course_name',
  'course_level',
  'course_type',
  'content_theme',
  'funnel_stage',
  'cta_type',
  'cta_destination',
  'promotion_type',
  'urgency_level',
]);

export const ORGANIC_CONTENT_MANUAL_NOTE_FIELD = 'manual_tag_note';

/**
 * Field ที่ต้องอ่านจาก Existing record แม้ Incoming row รอบนั้นไม่ได้ส่งค่าเข้ามา
 * เพื่อให้ Ownership decision ไม่ขึ้นกับ Classifier output shape
 */
export const ORGANIC_CONTENT_OWNERSHIP_EXISTING_FIELDS = Object.freeze([
  ...ORGANIC_CONTENT_PROTECTED_CLASSIFICATION_FIELDS,
  'classification_source',
  'classification_confidence',
  ORGANIC_CONTENT_MANUAL_NOTE_FIELD,
]);

/**
 * สร้าง Partial update สำหรับ MKT_Content โดยรักษาข้อมูลที่ทีมแก้เอง
 *
 * - System-managed fields ที่ไม่อยู่ใน Ownership list ยัง Update ตาม Incoming ปกติ
 * - Existing classification_source=manual ป้องกัน Classification ทั้งชุด
 * - Non-manual row เติม Classification ได้เฉพาะ Existing field ที่ว่าง
 * - manual_tag_note เป็น Create-only และไม่ถูกส่งใน Update ทุกกรณี
 * - null/undefined/ข้อความว่าง/Array ว่าง ไม่สามารถ Clear Existing protected value
 */
export function mergeOrganicContentUpdateFields(input = {}) {
  const existing = requireObject(input.existingFields, 'existingFields');
  const incoming = requireObject(input.incomingFields, 'incomingFields');
  const output = { ...incoming };

  delete output[ORGANIC_CONTENT_MANUAL_NOTE_FIELD];

  if (normalizeText(existing.classification_source) === 'manual') {
    for (const fieldName of ORGANIC_CONTENT_PROTECTED_CLASSIFICATION_FIELDS) {
      delete output[fieldName];
    }
    delete output.classification_source;
    delete output.classification_confidence;
    return Object.freeze(output);
  }

  let fillsClassification = false;
  for (const fieldName of ORGANIC_CONTENT_PROTECTED_CLASSIFICATION_FIELDS) {
    if (!isBlank(existing[fieldName]) || isBlank(output[fieldName])) {
      delete output[fieldName];
      continue;
    }
    fillsClassification = true;
  }

  // Source/Confidence เปลี่ยนได้เฉพาะเมื่อรอบนี้เติม Classification ที่ว่างจริง
  if (!fillsClassification) {
    delete output.classification_source;
    delete output.classification_confidence;
  } else {
    if (isBlank(output.classification_source)) delete output.classification_source;
    if (isBlank(output.classification_confidence)) delete output.classification_confidence;
  }

  return Object.freeze(output);
}

/** คืน Options ชุดเดียวที่ TikTok และ YouTube ต้องส่งให้ TableSyncEngine */
export function organicContentOwnershipPlanOptions() {
  return Object.freeze({
    existingFieldNames: ORGANIC_CONTENT_OWNERSHIP_EXISTING_FIELDS,
    mergeExistingFields: mergeOrganicContentUpdateFields,
  });
}

function isBlank(value) {
  if (value === null || value === undefined) return true;
  if (typeof value === 'string') return value.trim() === '';
  if (Array.isArray(value)) return value.length === 0;
  return false;
}

function normalizeText(value) {
  return typeof value === 'string' ? value.trim().toLowerCase() : '';
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Organic content ownership requires ${fieldName}`);
  }
  return value;
}
