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

/**
 * Decorate Repository เฉพาะแผน MKT_Content:
 * - Prepare Existing ด้วย Ownership fields เพิ่มเติม
 * - ทำให้ Diff มองข้าม Field ที่ Policy ป้องกัน
 * - Strip Field เหล่านั้นอีกครั้งก่อน Update จริง
 *
 * Create path ยังคงใช้ Incoming row เต็มชุด จึงรองรับ Initial classification ตาม Contract
 */
export function createOrganicContentOwnershipRepository(repository) {
  const base = requireRepository(repository);
  const incomingByKey = new Map();
  const existingByRecordId = new Map();
  let keyField = null;

  return Object.freeze({
    async prepareRows(tableId, rows, context = {}) {
      keyField = requireText(context?.keyField, 'keyField');
      const prepared = await base.prepareRows(tableId, rows, context);
      incomingByKey.clear();
      for (const row of prepared) {
        incomingByKey.set(requireText(row?.[keyField], keyField), row);
      }
      return prepared;
    },

    async listByFieldValues(tableId, fieldName, values) {
      if (typeof base.listByFieldValues === 'function') {
        return base.listByFieldValues(tableId, fieldName, values);
      }
      const allowed = new Set(values.map(String));
      const records = await base.listAll(tableId);
      return records.filter((record) => allowed.has(String(record?.fields?.[fieldName] ?? '')));
    },

    async listAll(tableId) {
      return base.listAll(tableId);
    },

    async prepareExistingRecords(tableId, records, context = {}) {
      const incomingFields = uniqueTextValues([
        ...(context?.incomingFieldNames ?? []),
        ...ORGANIC_CONTENT_OWNERSHIP_EXISTING_FIELDS,
      ]);
      const normalized = typeof base.prepareExistingRecords === 'function'
        ? await base.prepareExistingRecords(tableId, records, {
          ...context,
          incomingFieldNames: incomingFields,
        })
        : records;

      existingByRecordId.clear();
      return Object.freeze(normalized.map((record) => {
        const recordId = requireText(record?.recordId ?? record?.record_id, 'recordId');
        const existingFields = requireObject(record?.fields ?? {}, 'record.fields');
        const incoming = incomingByKey.get(requireText(existingFields[keyField], keyField));
        existingByRecordId.set(recordId, existingFields);
        if (!incoming) return record;

        const effective = mergeOrganicContentUpdateFields({
          existingFields,
          incomingFields: incoming,
        });
        const comparisonFields = { ...existingFields };
        for (const [fieldName, value] of Object.entries(incoming)) {
          if (!Object.hasOwn(effective, fieldName)) comparisonFields[fieldName] = value;
        }
        return Object.freeze({ recordId, fields: Object.freeze(comparisonFields) });
      }));
    },

    async createMany(tableId, rows, options = {}) {
      return base.createMany(tableId, rows, options);
    },

    async updateMany(tableId, records, options = {}) {
      const protectedRecords = records.map((record) => {
        const recordId = requireText(record?.recordId, 'recordId');
        const existingFields = requireObject(existingByRecordId.get(recordId) ?? {}, 'existingFields');
        const fields = mergeOrganicContentUpdateFields({
          existingFields,
          incomingFields: requireObject(record?.fields, 'record.fields'),
        });
        return Object.freeze({ recordId, fields });
      });
      return base.updateMany(tableId, protectedRecords, options);
    },
  });
}

/**
 * Routing adapter สำหรับ Runtime จริง: ใช้ Ownership repository เฉพาะ Physical MKT_Content table
 * Table อื่นยังใช้ Repository เดิมทุก Method จึงไม่เปลี่ยน RAW/Daily/Report/Reliability contract
 */
export function createOrganicContentOwnershipRoutingRepository(input = {}) {
  const base = requireRepository(input.repository);
  const mktContentTableId = optionalText(input.mktContentTableId);
  if (!mktContentTableId) return base;
  const owned = createOrganicContentOwnershipRepository(base);
  const route = (tableId) => requireText(tableId, 'tableId') === mktContentTableId ? owned : base;

  return Object.freeze({
    async listAll(tableId) { return route(tableId).listAll(tableId); },
    async listPage(tableId, options = {}) {
      return requireMethod(route(tableId), 'listPage')(tableId, options);
    },
    async searchRecords(tableId, options = {}) {
      return requireMethod(route(tableId), 'searchRecords')(tableId, options);
    },
    async listByFieldValues(tableId, fieldName, values) {
      return route(tableId).listByFieldValues(tableId, fieldName, values);
    },
    async prepareRows(tableId, rows, context = {}) {
      return route(tableId).prepareRows(tableId, rows, context);
    },
    async prepareExistingRecords(tableId, records, context = {}) {
      const selected = route(tableId);
      if (typeof selected.prepareExistingRecords !== 'function') return records;
      return selected.prepareExistingRecords(tableId, records, context);
    },
    async createMany(tableId, rows, options = {}) {
      return route(tableId).createMany(tableId, rows, options);
    },
    async updateMany(tableId, records, options = {}) {
      return route(tableId).updateMany(tableId, records, options);
    },
    async getTableFields(tableId) {
      return requireMethod(route(tableId), 'getTableFields')(tableId);
    },
  });
}

function uniqueTextValues(values) {
  return Object.freeze([...new Set(values.map((value) => requireText(value, 'fieldName')))]);
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

function optionalText(value) {
  if (typeof value !== 'string') return null;
  return value.trim() || null;
}

function requireMethod(value, methodName) {
  if (typeof value?.[methodName] !== 'function') {
    throw new TypeError(`Organic content ownership requires repository.${methodName}`);
  }
  return value[methodName].bind(value);
}

function requireRepository(value) {
  for (const method of ['prepareRows', 'listAll', 'createMany', 'updateMany']) {
    if (typeof value?.[method] !== 'function') {
      throw new TypeError(`Organic content ownership requires repository.${method}`);
    }
  }
  return value;
}

function requireObject(value, fieldName) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`Organic content ownership requires ${fieldName}`);
  }
  return value;
}

function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`Organic content ownership requires ${fieldName}`);
  }
  return value.trim();
}
