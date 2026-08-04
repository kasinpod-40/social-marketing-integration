import {
  normalizeExistingRecordsForComparison,
  serializeRowsForLark,
} from './lark-field-serializer.js';
import { readLarkText } from '../shared/lark-cell-value.js';

const LARK_TEXT_FIELD_TYPE = 1;
const LARK_TEXT_WRAPPER_KEYS = Object.freeze(['text', 'name', 'value', 'option', 'label']);

/**
 * Repository Adapter สำหรับ Lark Base
 *
 * แยกหน้าที่ Storage ออกจาก TableSyncEngine:
 * - อ่าน Record ทั้งตารางเมื่อจำเป็น
 * - ค้นหาเฉพาะ Record ที่ Stable Key ตรงกับ Input
 * - Cache Schema ต่อ Table ภายในหนึ่ง Runtime
 * - Serialize แถวใหม่ตาม Schema จริงก่อนวางแผน Sync
 * - Normalize ค่าที่อ่านกลับเพื่อป้องกัน Update ปลอมจาก Shape ที่ต่างกัน
 */
export class LarkRecordRepository {
  /** รับ LarkBitableClient ที่ผ่านการสร้างจาก Runtime config แล้ว */
  constructor(input) {
    this.client = requireClient(input?.client);
    this.schemaCache = new Map();
  }

  /** อ่าน Record ทั้งตาราง ใช้กับ RAW source และ Dictionary ที่ต้องประมวลผลทั้งหมด */
  async listAll(tableId) {
    return this.client.listRecords({ tableId: requireText(tableId, 'tableId') });
  }

  /** อ่าน Record หนึ่งหน้าเพื่อให้ Use case เก็บ Durable cursor/page staging ได้ */
  async listPage(tableId, options = {}) {
    if (typeof this.client.listRecordsPage !== 'function') {
      throw new TypeError('LarkRecordRepository requires client.listRecordsPage for paged source reads');
    }
    return this.client.listRecordsPage({
      tableId: requireText(tableId, 'tableId'),
      pageToken: options?.pageToken ?? null,
      pageSize: options?.pageSize,
      includeRecordMetadata: options?.includeRecordMetadata,
    });
  }

  /** อ่าน Record ด้วย Filter/Sort ที่ Server รองรับ พร้อมเพดานและ Early stop */
  async searchRecords(tableId, options = {}) {
    if (typeof this.client.searchRecords !== 'function') {
      throw new TypeError('LarkRecordRepository requires client.searchRecords for bounded filtered reads');
    }
    return this.client.searchRecords({
      tableId: requireText(tableId, 'tableId'),
      filter: options?.filter,
      sort: options?.sort,
      fieldNames: options?.fieldNames,
      pageSize: options?.pageSize,
      maxPages: options?.maxPages,
      maxItems: options?.maxItems,
      stopWhen: options?.stopWhen,
    });
  }

  /**
   * ค้นหา Record ปลายทางตาม Field เดียวหลายค่า เพื่อลด Full table scan ตอน Upsert
   */
  async listByFieldValues(tableId, fieldName, values) {
    const normalizedTableId = requireText(tableId, 'tableId');
    const normalizedFieldName = requireText(fieldName, 'fieldName');
    const normalizedValues = requireArray(values, 'values');

    if (typeof this.client.searchRecordsByFieldValues === 'function') {
      return this.client.searchRecordsByFieldValues({
        tableId: normalizedTableId,
        fieldName: normalizedFieldName,
        values: normalizedValues,
      });
    }

    // Compatibility fallback สำหรับ Test adapter/Client รุ่นเก่าเท่านั้น
    const allowed = new Set(normalizedValues.map((value) => String(value)));
    const records = await this.client.listRecords({ tableId: normalizedTableId });
    return records.filter((record) => allowed.has(String(record?.fields?.[normalizedFieldName] ?? '')));
  }

  /**
   * Serialize แถว Domain ให้ตรงกับ Field type และ Select options ของตารางจริง
   */
  async prepareRows(tableId, rows, context = {}) {
    const normalizedTableId = requireText(tableId, 'tableId');
    const fields = await this.getTableFields(normalizedTableId);
    const normalizedRows = normalizeLarkTextReadbackRows(requireArray(rows, 'rows'), fields);
    return serializeRowsForLark(normalizedRows, fields, {
      tableId: normalizedTableId,
      keyField: context?.keyField,
    });
  }

  /**
   * Normalize Existing records ให้เทียบกับ Prepared rows ได้อย่างถูกต้อง
   */
  async prepareExistingRecords(tableId, records, context = {}) {
    const normalizedTableId = requireText(tableId, 'tableId');
    const fields = await this.getTableFields(normalizedTableId);
    return normalizeExistingRecordsForComparison(requireArray(records, 'records'), fields, {
      tableId: normalizedTableId,
      incomingFieldNames: requireArray(context?.incomingFieldNames ?? [], 'incomingFieldNames'),
    });
  }

  /** ส่ง Batch Create โดยไม่ทำ Business logic ซ้ำกับ Sync Engine */
  async createMany(tableId, rows, options = {}) {
    return this.client.batchCreateRecords({
      tableId: requireText(tableId, 'tableId'),
      records: requireArray(rows, 'rows'),
      beforeChunk: options?.beforeChunk,
    });
  }

  /** ส่ง Batch Update โดยไม่ทำ Diff ซ้ำกับ Sync Engine */
  async updateMany(tableId, records, options = {}) {
    return this.client.batchUpdateRecords({
      tableId: requireText(tableId, 'tableId'),
      records: requireArray(records, 'records'),
      beforeChunk: options?.beforeChunk,
    });
  }

  /**
   * โหลด Schema หนึ่งครั้งต่อ Table ต่อ Runtime และแชร์ Promise ให้คำขอพร้อมกัน
   * หากโหลดล้มเหลวจะลบ Cache เพื่อให้รอบถัดไปขอใหม่ได้
   */
  async getTableFields(tableId) {
    const normalizedTableId = requireText(tableId, 'tableId');
    if (!this.schemaCache.has(normalizedTableId)) {
      const request = Promise.resolve(
        this.client.listFields({ tableId: normalizedTableId }),
      ).catch((error) => {
        this.schemaCache.delete(normalizedTableId);
        throw error;
      });
      this.schemaCache.set(normalizedTableId, request);
    }
    return this.schemaCache.get(normalizedTableId);
  }
}

/**
 * ค่า Text ที่อ่านกลับจาก Lark อาจเป็น Rich-text array/object ขณะที่ payload ฝั่งเขียนต้องเป็น String.
 * Normalize เฉพาะ wrapper ที่พิสูจน์ได้ว่าเป็น Lark readback shape และปล่อย object อื่นให้ serializer
 * ปฏิเสธตาม contract เดิม เพื่อไม่แปลง Business JSON object เป็นข้อความหรือค่าว่างโดยเงียบ ๆ.
 */
function normalizeLarkTextReadbackRows(rows, fields) {
  const textFieldNames = new Set(requireArray(fields, 'fields')
    .filter((field) => Number(field?.type) === LARK_TEXT_FIELD_TYPE)
    .map((field) => requireText(
      field?.fieldName ?? field?.field_name ?? field?.name,
      'field name',
    )));

  return rows.map((row) => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return row;
    let normalized = null;
    for (const fieldName of textFieldNames) {
      const value = row[fieldName];
      if (!isLarkTextReadbackValue(value)) continue;
      normalized ??= { ...row };
      normalized[fieldName] = readLarkText(value, {
        allowNull: true,
        label: fieldName,
      });
    }
    return normalized ?? row;
  });
}

function isLarkTextReadbackValue(value) {
  if (Array.isArray(value)) {
    return value.every((item) => (
      item === null
      || item === undefined
      || ['string', 'number', 'boolean'].includes(typeof item)
      || isLarkTextWrapperObject(item)
    ));
  }
  return isLarkTextWrapperObject(value);
}

function isLarkTextWrapperObject(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && LARK_TEXT_WRAPPER_KEYS.some((key) => Object.hasOwn(value, key)),
  );
}

/** ตรวจว่า Client มี Method ที่ Repository ใช้ครบ */
function requireClient(client) {
  for (const method of [
    'batchCreateRecords',
    'batchUpdateRecords',
    'listRecords',
    'listFields',
  ]) {
    if (typeof client?.[method] !== 'function') {
      throw new TypeError(`LarkRecordRepository requires client.${method}`);
    }
  }
  return client;
}

/** บังคับ Array */
function requireArray(value, fieldName) {
  if (!Array.isArray(value)) throw new TypeError(`LarkRecordRepository requires array ${fieldName}`);
  return value;
}

/** บังคับข้อความที่ไม่ว่าง */
function requireText(value, fieldName) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`LarkRecordRepository requires ${fieldName}`);
  }
  return value.trim();
}
