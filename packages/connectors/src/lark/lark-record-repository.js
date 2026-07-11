import {
  normalizeExistingRecordsForComparison,
  serializeRowsForLark,
} from './lark-field-serializer.js';

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
    return serializeRowsForLark(requireArray(rows, 'rows'), fields, {
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
  async createMany(tableId, rows) {
    return this.client.batchCreateRecords({
      tableId: requireText(tableId, 'tableId'),
      records: requireArray(rows, 'rows'),
    });
  }

  /** ส่ง Batch Update โดยไม่ทำ Diff ซ้ำกับ Sync Engine */
  async updateMany(tableId, records) {
    return this.client.batchUpdateRecords({
      tableId: requireText(tableId, 'tableId'),
      records: requireArray(records, 'records'),
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
